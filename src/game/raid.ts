import * as THREE from 'three';
import { ABILITIES, ABOMINATIONS, CLASSES, HOST, LOOT, RAID, WEAPONS, extractTimeFor, layoutPosition, projectileDamage, rollContainer, type ClassId } from '../../data';
import { groundHeight, ISLAND_RADIUS, mulberry32 } from '../world/zone7';
import { Abomination, type AbominationContext, type AbominationKind, type HitSphere } from './abominations';
import { AbilitySystem } from './abilities';
import { EventBus } from './events';
import { ExtractionPoint } from './extraction';
import { Fx, GORE } from './fx';
import { Carried } from './inventory';
import type { Noise } from './perception';
import { Player } from './player';
import { Projectiles, segmentSphere, type Projectile } from './projectiles';
import { BioPod, Hazards, SeedSpire } from './props';
import { NeuralOverload, Biomass } from './vitals';
import { SynapseBurster, projectileLooks } from './weapon';

export type Phase = 'briefing' | 'raid' | 'extracted' | 'lost';

/** Optional hooks into the render pipeline (Rendering & Tech Art). Missing methods are ignored. */
export interface PipelineHooks { setOverload?(v: number): void; hitPulse?(strength: number): void }

export interface ScannerPing { x: number; z: number; kind: string; revealed: boolean }

/** Everything the HUD needs each frame; UI reads this and never touches game objects. */
export interface HudState {
  phase: Phase;
  biomass: number; biomassMax: number;
  overload: number; overloaded: boolean;
  ammo: number; magazine: number; reloading: number; ego: number; egoReady: boolean; aiming: boolean;
  timeLeft: number; collapse: boolean;
  slots: ReturnType<AbilitySystem['slots']>;
  carried: { item: string; label: string; count: number; kind: string }[];
  dna: number; value: number; kills: number;
  extract: { progress: number; inside: boolean; distance: number; label: string };
  interact: { text: string; progress: number } | null;
  scanner: { x: number; z: number; yaw: number; extract: { x: number; z: number }; pods: { x: number; z: number; opened: boolean }[]; pings: ScannerPing[]; range: number };
  healing: boolean;
}

const tmp = new THREE.Vector3();
const CHEST = 1.2;
const PLAYER_RADIUS = 0.55;

/**
 * One Spore raid: spawns the host, Abominations, Bio-Pods and the Seed Spire from data/raid.json, runs combat,
 * looting, extraction, the timer and the result. Emits every gameplay event on `bus`.
 */
export class Raid {
  readonly bus = new EventBus();
  phase: Phase = 'briefing';
  readonly player: Player;
  readonly biomass: Biomass;
  readonly overload: NeuralOverload;
  readonly weapon: SynapseBurster;
  readonly abilities: AbilitySystem;
  readonly carried = new Carried();
  readonly creatures: Abomination[] = [];
  readonly pods: BioPod[] = [];
  readonly spire: SeedSpire;
  readonly extract: ExtractionPoint;
  readonly fx: Fx;
  readonly projectiles: Projectiles;
  readonly hazards: Hazards;
  /** Walkable radius actually used for layout (data radius clamped to the island that exists). */
  readonly playable: number;
  kills = 0;
  elapsed = 0;
  timeLeft = RAID.raidTime;
  timeScale = 1;
  pipeline: PipelineHooks = {};

  private rand = mulberry32(2026);
  private noises: Noise[] = [];
  private trigger = false;
  private aimHeld = false;
  private egoQueued = false;
  private debugTrigger: boolean | null = null;
  private debugAim: THREE.Vector3 | null = null;
  private interactTarget: BioPod | null = null;
  private healLeft = 0;
  private healRate = 0;
  private useLeft = 0;
  private pendingHeal = { amount: 0, duration: 0 };
  private nextReinforce = RAID.reinforcements.firstAt;
  private collapseWarned = false;
  private spireSignal = 0;
  private sinceHit = 99;
  private result: { items: { item: string; count: number }[]; dna: number; value: number; cause?: string } | null = null;
  private classId: ClassId = 'neuroInfiltrator';
  private spawnScale: number;

  constructor(private scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera, private canvas: HTMLCanvasElement) {
    const cls = CLASSES[this.classId];
    this.playable = Math.min(RAID.playableRadius, ISLAND_RADIUS * 0.84);
    this.spawnScale = this.playable / RAID.playableRadius;
    scene.add(camera);

    this.player = new Player(camera, cls, HOST, canvas);
    this.biomass = new Biomass(cls.biomass);
    this.overload = new NeuralOverload(HOST.neuralOverload, cls.overloadDecayMultiplier);
    this.fx = new Fx(scene);
    this.hazards = new Hazards(scene);
    this.projectiles = new Projectiles(scene, projectileLooks());
    this.weapon = new SynapseBurster(WEAPONS.synapseBurster, camera, this.projectiles);

    // Layout from data.
    const [ex, ez] = layoutPosition(RAID.extract, this.playable);
    this.extract = new ExtractionPoint(ex, ez, RAID.extract.zoneRadius, extractTimeFor(this.classId), RAID.extract.cancelOnLeave);
    this.spire = new SeedSpire(ex, ez, RAID.extract.zoneRadius);
    scene.add(this.spire.root);
    const beacon = scene.getObjectByName('extraction-beacon');
    if (beacon) beacon.position.set(ex, 40 + groundHeight(ex, ez), ez);

    RAID.containers.forEach((c, i) => {
      const [x, z] = layoutPosition(c, this.playable);
      const pod = new BioPod(`${c.type}-${i}`, c.type, x, z);
      this.pods.push(pod);
      scene.add(pod.root);
    });

    const [sx, sz] = layoutPosition(RAID.spawn, this.playable);
    this.player.spawn(sx, sz, Math.atan2(-(ex - sx), -(ez - sz)));
    this.player.onJump = () => { this.overload.add(HOST.neuralOverload.jumpFill); };
    this.player.onLand = (h) => {
      this.noise(this.player.position, HOST.noiseRadius.jumpLand, 'land');
      const over = h - HOST.fallDamage.safeHeight;
      if (over > 0) this.hurt(over * HOST.fallDamage.damagePerMetre, 'limb', 'fall', null);
    };

    this.spawnInitial();

    this.abilities = new AbilitySystem(ABILITIES, { overload: this.overload, count: (i) => this.carried.count(i), consume: (i) => this.carried.consume(i) });
    this.abilities.register('neuralPulse', (a) => this.psychWavePulse(a as typeof ABILITIES.neuralPulse));
    this.abilities.register('clotGel', (a) => {
      this.useLeft = Number(a.useTime ?? 1.2);
      this.pendingHeal = { amount: Number(a.heal ?? 70), duration: Number(a.healDuration ?? 3) };
      this.abilities.setActive('clotGel', this.useLeft + this.pendingHeal.duration);
    });

    this.bindInput();
  }

  // ------------------------------------------------------------------ setup
  private spawnInitial(): void {
    const minFromSpawn = Math.max(15, RAID.spawn.noEnemyWithin * this.spawnScale);
    const spawn = this.player.position;
    const [ex, ez] = [this.extract.x, this.extract.z];
    for (const g of RAID.spawnGroups) {
      const kind = g.type as AbominationKind;
      const data = ABOMINATIONS[kind];
      for (let n = 0; n < g.count; n++) {
        let cx = 0, cz = 0;
        for (let tries = 0; tries < 30; tries++) {
          if (g.guardsContainer && this.pods.length) {
            const p = this.pods[n % this.pods.length].position, a = this.rand() * Math.PI * 2;
            cx = p.x + Math.cos(a) * 5; cz = p.z + Math.sin(a) * 5;
          } else if (g.nearExtract) {
            const a = this.rand() * Math.PI * 2, d = 8 + this.rand() * 8;
            cx = ex + Math.cos(a) * d; cz = ez + Math.sin(a) * d;
          } else {
            const [lo, hi] = g.radius;
            const [x, z] = layoutPosition({ radius: lo + this.rand() * (hi - lo), bearing: this.rand() * 360 }, this.playable);
            cx = x; cz = z;
          }
          if (Math.hypot(cx - spawn.x, cz - spawn.z) >= minFromSpawn) break;
        }
        const size = g.packed ? data.packSize[0] + Math.floor(this.rand() * (data.packSize[1] - data.packSize[0] + 1)) : 1;
        for (let k = 0; k < size; k++) {
          const a = this.rand() * Math.PI * 2, d = size > 1 ? 1.5 + this.rand() * 2.5 : 0;
          this.addCreature(kind, cx + Math.cos(a) * d, cz + Math.sin(a) * d);
        }
      }
    }
  }

  private addCreature(kind: AbominationKind, x: number, z: number): Abomination {
    const r = Math.hypot(x, z), edge = this.playable * 0.95;
    if (r > edge) { x *= edge / r; z *= edge / r; }
    const c = new Abomination(kind, ABOMINATIONS[kind], x, z, Math.floor(this.rand() * 1e9));
    this.creatures.push(c);
    this.scene.add(c.root);
    return c;
  }

  private reinforce(): void {
    const alive = this.creatures.filter((c) => c.alive).length;
    const min = Math.max(15, RAID.reinforcements.spawnMinDistanceFromPlayer * this.spawnScale);
    for (const w of RAID.reinforcements.wave) {
      const kind = w.type as AbominationKind;
      for (let n = 0; n < w.count; n++) {
        const size = w.packed ? ABOMINATIONS[kind].packSize[0] + Math.floor(this.rand() * (ABOMINATIONS[kind].packSize[1] - ABOMINATIONS[kind].packSize[0] + 1)) : 1;
        if (alive + size > RAID.reinforcements.maxAlive) return;
        // Behind the host, out of view, at least `min` away.
        const back = this.player.yaw + (this.rand() - 0.5) * 1.6;
        const d = min + this.rand() * 10;
        const cx = this.player.position.x + Math.sin(back) * d, cz = this.player.position.z + Math.cos(back) * d;
        for (let k = 0; k < size; k++) {
          const c = this.addCreature(kind, cx + (this.rand() - 0.5) * 4, cz + (this.rand() - 0.5) * 4);
          c.alert();
        }
      }
    }
  }

  private bindInput(): void {
    const locked = () => document.pointerLockElement === this.canvas;
    addEventListener('mousedown', (e) => {
      if (!locked() || this.phase !== 'raid') return;
      if (e.button === 0) this.trigger = true;
      if (e.button === 2) this.aimHeld = true;
      if (e.button === 1) { this.egoQueued = true; e.preventDefault(); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.trigger = false;
      if (e.button === 2) this.aimHeld = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (this.phase === 'briefing' && !e.repeat) this.begin();
      if (this.phase !== 'raid' || e.repeat) return;
      if (e.code === 'KeyR') { if (this.weapon.reload()) this.onReload(); }
      if (e.code === 'KeyF') this.egoQueued = true;
      if (e.code === 'Digit1' || e.code === 'KeyQ') this.useAbility(1);
      if (e.code === 'Digit2') this.useAbility(2);
    });
    this.canvas.addEventListener('click', () => { if (this.phase === 'briefing') this.begin(); });
  }

  /** Starts the raid clock (first click or key). */
  begin(): void {
    if (this.phase !== 'briefing') return;
    this.phase = 'raid';
    this.bus.emit('raidStart', { raidTime: RAID.raidTime });
  }

  // ------------------------------------------------------------------ actions
  private useAbility(slot: number): void {
    const id = this.abilities.bySlot(slot);
    if (!id) return;
    const r = this.abilities.use(id);
    if (r === 'ok') this.bus.emit('ability', { id, slot });
    else if (r !== 'unknown') this.bus.emit('abilityDenied', { id, reason: r });
  }

  private psychWavePulse(a: typeof ABILITIES.neuralPulse): void {
    const p = this.player.position;
    const radius = Number(a.radius), dmgR = Number(a.damageRadius), reveal = Number(a.revealDuration);
    this.fx.ring(p, GORE.cyanFluid, radius, 1.1);
    this.fx.ring(p, GORE.violetFluid, dmgR, 0.4);
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const d = Math.hypot(c.position.x - p.x, c.position.z - p.z);
      if (d <= radius) c.revealed = reveal;
      if (d <= dmgR) {
        const dir = tmp.set(c.position.x - p.x, 0, c.position.z - p.z).normalize().clone();
        this.damageCreature(c, Number(a.damage), false, dir, c.centre, 'pulse');
        c.stagger(Number(a.staggerDuration));
      }
    }
    this.player.addTrauma(0.25);
  }

  private onReload(): void {
    this.bus.emit('reload', { weapon: this.weapon.id, time: this.weapon.w.reloadTime });
    this.noise(this.player.position, HOST.noiseRadius.reload, 'reload');
  }

  private noise(at: THREE.Vector3, radius: number, source: string): void {
    this.noises.push({ x: at.x, z: at.z, radius });
    this.bus.emit('noise', { position: { x: at.x, y: at.y, z: at.z }, radius, source });
  }

  hurt(amount: number, zone: 'head' | 'torso' | 'limb', source: string, from: THREE.Vector3 | null): void {
    if (this.phase !== 'raid' || amount <= 0) return;
    const applied = this.biomass.damage(amount * HOST.hitZones[zone]);
    let direction = null;
    if (from) {
      const d = from.clone().sub(this.player.position); d.y = 0; d.normalize();
      direction = { x: d.x, y: 0, z: d.z };
    }
    this.sinceHit = 0;
    this.player.addTrauma(Math.min(0.6, applied / 40));
    this.pipeline.hitPulse?.(Math.min(1, applied / 30));
    this.bus.emit('damaged', { amount: applied, biomass: this.biomass.current, zone, source, direction });
    if (this.biomass.dead) this.lose(source);
  }

  private damageCreature(c: Abomination, amount: number, weak: boolean, dir: THREE.Vector3 | null, at: THREE.Vector3, _source: string, sphere?: HitSphere): void {
    if (!c.alive) return;
    const kill = c.damage(amount, dir, sphere);
    this.fx.bleed(at, dir ?? new THREE.Vector3(0, -1, 0), c.fluid, weak ? 18 : 8);
    this.bus.emit('hit', { target: c.kind, id: c.id, damage: amount, weakPoint: weak, kill, position: { x: at.x, y: at.y, z: at.z } });
    if (kill) {
      this.kills++;
      const dna = ABOMINATIONS[c.kind].dnaDrop;
      this.carried.dna += dna;
      this.fx.burst(c.centre.clone(), c.fluid, c.kind === 'bilecantor' ? 1.8 : 1);
      if (c.kind === 'bilecantor') {
        const cloud = ABOMINATIONS.bilecantor.deathCloud as { radius: number; duration: number; damagePerSecond: number; overloadPerSecond: number };
        this.hazards.deathCloud(c.position.x, c.centre.y - 1.5, c.position.z, cloud.radius, cloud.damagePerSecond, cloud.overloadPerSecond, cloud.duration);
      }
      this.bus.emit('creatureDeath', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z }, dna });
    }
  }

  private lose(cause: string): void {
    if (this.phase !== 'raid') return;
    this.phase = 'lost';
    this.result = { ...this.carried.snapshot(), cause };
    this.player.enabled = false;
    this.trigger = false;
    this.bus.emit('death', { cause, items: this.result.items, dna: this.result.dna, value: this.result.value });
    this.bus.emit('raidEnd', { result: 'lost', value: this.result.value, kills: this.kills, time: this.elapsed });
    document.exitPointerLock?.();
  }

  private win(): void {
    if (this.phase !== 'raid') return;
    this.phase = 'extracted';
    this.result = this.carried.snapshot();
    this.player.enabled = false;
    this.trigger = false;
    this.spire.launch();
    this.bus.emit('extractDone', { items: this.result.items, dna: this.result.dna, value: this.result.value });
    this.bus.emit('raidEnd', { result: 'extracted', value: this.result.value, kills: this.kills, time: this.elapsed });
    document.exitPointerLock?.();
  }

  get outcome(): typeof this.result { return this.result; }

  // ------------------------------------------------------------------ frame
  /** First creature along the crosshair ray, or a far point. Used to converge spores from the muzzle. */
  aimPoint(): THREE.Vector3 {
    if (this.debugAim) return this.debugAim.clone();
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const far = origin.clone().addScaledVector(dir, 80);
    let best = 1;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      for (const h of c.hitSpheres) {
        const t = segmentSphere(origin, far, h.world, h.r);
        if (t !== null && t < best && t > 0.002) best = t;
      }
    }
    // March the ground so spores land where the crosshair points at terrain.
    for (let i = 1; i <= 40; i++) {
      const t = i / 40;
      if (t >= best) break;
      const p = origin.clone().lerp(far, t);
      if (p.y < groundHeight(p.x, p.z)) { best = t; break; }
    }
    return origin.lerp(far, best);
  }

  update(rawDt: number): void {
    const dt = rawDt * this.timeScale;
    const p = this.player;
    const live = this.phase === 'raid';
    if (live) { this.elapsed += dt; this.timeLeft = Math.max(0, RAID.raidTime - this.elapsed); }
    this.noises.length = 0;

    // Movement and Overload.
    p.canSprint = !this.overload.overloaded && this.useLeft <= 0;
    p.slowed = this.useLeft > 0 ? Number(ABILITIES.clotGel.movementMultiplierWhileUsing ?? 0.6) : 1;
    p.speedMultiplier = 1;
    const wasOver = this.overload.overloaded;
    p.update(dt);
    if (live && p.sprinting) this.overload.add(HOST.neuralOverload.sprintFillPerSecond * dt);
    this.overload.update(dt);
    if (!wasOver && this.overload.overloaded) this.bus.emit('overload', { duration: HOST.neuralOverload.overloadedDuration });
    this.pipeline.setOverload?.(this.overload.overloaded ? 1 : this.overload.fraction);
    const steps = p.footstepNoise;
    if (live && steps > 0) this.noises.push({ x: p.position.x, z: p.position.z, radius: steps });

    // Clot Gel: apply, then heal over time.
    if (this.useLeft > 0) {
      this.useLeft -= dt;
      if (this.useLeft <= 0) { this.healLeft = this.pendingHeal.duration; this.healRate = this.pendingHeal.amount / this.pendingHeal.duration; }
    } else if (this.healLeft > 0) {
      const step = Math.min(this.healLeft, dt);
      this.healLeft -= step;
      const h = this.biomass.heal(this.healRate * step);
      if (h > 0) this.bus.emit('healed', { amount: h, biomass: this.biomass.current });
    }

    // Weapon.
    for (const c of this.creatures) c.refreshHitSpheres();
    const trigger = live && (this.debugTrigger ?? this.trigger);
    const fire = this.weapon.update(dt, trigger, live && this.aimHeld, { aimPoint: this.aimPoint(), moving: p.moving, sprinting: p.sprinting });
    if (fire.shots > 0) {
      const w = this.weapon.w;
      p.kick(w.recoil.pitch * (Math.PI / 180) * fire.shots * (1 - this.weapon.aim * 0.5));
      p.yaw += (this.rand() - 0.5) * w.recoil.yawJitter * (Math.PI / 180) * fire.shots;
      p.addTrauma(0.03);
      this.noise(p.position, HOST.noiseRadius.gunfire, 'gunfire');
      this.bus.emit('shot', { weapon: this.weapon.id, ammo: this.weapon.state.ammo, position: { x: p.position.x, y: p.position.y, z: p.position.z }, ego: false });
    }
    if (fire.startedReload) this.onReload();
    if (fire.reloaded) this.bus.emit('reloaded', { weapon: this.weapon.id, ammo: this.weapon.state.ammo });
    if (this.egoQueued) {
      this.egoQueued = false;
      if (live && this.weapon.egoReady) {
        if (this.overload.overloaded) this.bus.emit('abilityDenied', { id: 'egoCharge', reason: 'overloaded' });
        else if (this.weapon.fireEgo(this.aimPoint())) {
          this.overload.add(this.weapon.w.egoCharge.overloadFill);
          this.noise(p.position, HOST.noiseRadius.egoCharge, 'egoCharge');
          p.addTrauma(0.3);
          p.kick(0.05);
          this.bus.emit('shot', { weapon: this.weapon.id, ammo: this.weapon.state.ammo, position: { x: p.position.x, y: p.position.y, z: p.position.z }, ego: true });
        }
      }
    }
    this.weapon.view.update(dt, { yaw: p.yaw, pitch: p.pitch, speed: Math.hypot(p.velocity.x, p.velocity.z), sprinting: p.sprinting, grounded: p.grounded }, this.weapon.state.ammo / this.weapon.w.magazine, this.weapon.egoFraction, this.lookTarget());

    // Abilities.
    this.abilities.update(dt);

    // Projectiles.
    this.projectiles.update(dt, (pr, a, b) => this.projectileHit(pr, a, b), (pr, at) => this.projectileLand(pr, at), (pr, sdt) => this.steer(pr, sdt));

    // Creatures.
    const ctx: AbominationContext = {
      player: p.position, playerVelocity: p.velocity, playerAlive: live, playerHidden: this.elapsed < RAID.spawn.safeTime,
      noises: this.noises, others: this.creatures, playableRadius: this.playable,
      onAlert: (c) => {
        this.bus.emit('alert', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z } });
        for (const o of this.creatures) if (o !== c && o.alive && o.position.distanceTo(c.position) <= c.t.perception.alertShare) o.alert();
      },
      onMelee: (c, dmg) => {
        this.bus.emit('attack', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z } });
        this.hurt(dmg, 'torso', c.kind, c.position);
        this.fx.bleed(p.eyePosition.clone().add(new THREE.Vector3(0, -0.4, 0)), c.position.clone().sub(p.position).normalize(), GORE.flesh, 6);
      },
      onSpit: (c, from, vel) => {
        this.bus.emit('attack', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z } });
        const proj = ABOMINATIONS.bilecantor.projectile as { gravity: number };
        this.projectiles.fire('bile', 'enemy', from, vel, { damage: c.t.damage, gravity: proj.gravity, life: 6 });
      },
    };
    for (const c of this.creatures) c.update(dt, ctx);
    for (let i = this.creatures.length - 1; i >= 0; i--) if (this.creatures[i].removable) { this.scene.remove(this.creatures[i].root); this.creatures.splice(i, 1); }
    if (live && this.elapsed >= this.nextReinforce) { this.nextReinforce += RAID.reinforcements.interval; this.reinforce(); }

    // Hazards.
    const hz = this.hazards.update(dt, p.position.x, p.position.z);
    if (live && hz.source) {
      this.hurt(hz.dps * dt * (1 - CLASSES[this.classId].toxinResistance), 'limb', hz.source, null);
      if (hz.overloadPerSecond > 0) this.overload.add(hz.overloadPerSecond * dt);
    }

    // Bio-Pods: hold E.
    this.interactTarget = null;
    for (const pod of this.pods) {
      pod.update(dt);
      if (pod.opened || !live) continue;
      if (Math.hypot(pod.position.x - p.position.x, pod.position.z - p.position.z) < 2.4) this.interactTarget = pod;
    }
    for (const pod of this.pods) if (pod !== this.interactTarget && !pod.opened) pod.progress = 0;
    if (this.interactTarget) {
      const pod = this.interactTarget;
      const c = LOOT.containers[pod.type];
      if (p.keys.has('KeyE')) {
        if (pod.progress === 0) { this.bus.emit('containerOpenStart', { container: pod.type }); this.noise(pod.position, c.noiseOnOpen, 'container'); }
        pod.progress = Math.min(1, pod.progress + dt / c.openTime);
        if (pod.progress >= 1) this.openPod(pod);
      } else pod.progress = 0;
    }

    // Seed Spire.
    if (live) {
      const change = this.extract.update(p.position.x, p.position.z, dt);
      if (change === 'start') {
        this.bus.emit('extractStart', { label: RAID.extract.label, time: this.extract.time });
        this.noise(this.spire.position, RAID.extract.signalNoise, 'extract');
        this.spireSignal = 0;
      }
      if (this.extract.inside) {
        this.spireSignal += dt;
        if (this.spireSignal > 2) { this.spireSignal = 0; this.noise(this.spire.position, RAID.extract.signalNoise, 'extract'); }
        this.bus.emit('extractProgress', { progress: this.extract.progress, timeLeft: this.extract.timeLeft });
      }
      if (change === 'cancel') this.bus.emit('extractCancel', {});
      if (change === 'done') this.win();
    }
    this.spire.update(dt, this.extract.progress, this.extract.inside);

    // Raid clock and zone collapse.
    if (live) {
      if (!this.collapseWarned && this.timeLeft <= RAID.zoneCollapse.warningAt) { this.collapseWarned = true; this.bus.emit('collapseWarning', { timeLeft: this.timeLeft }); }
      if (this.timeLeft <= 0) this.hurt(RAID.zoneCollapse.damagePerSecondAfterTimeout * dt, 'torso', 'zone collapse', null);
    }

    this.sinceHit += dt;
    this.fx.update(dt);
  }

  private lookTarget(): THREE.Vector3 | null {
    // Eyes on the gun track the nearest engaged creature (in camera space).
    let best: Abomination | null = null, bd = 30;
    for (const c of this.creatures) {
      if (!c.alive || !c.engaged) continue;
      const d = c.position.distanceTo(this.player.position);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    const v = best.centre.clone();
    this.camera.worldToLocal(v);
    return v.normalize();
  }

  private openPod(pod: BioPod): void {
    pod.open();
    const items = rollContainer(pod.type, this.rand);
    for (const s of items) this.carried.add(s.item, s.count);
    this.fx.burst(pod.position.clone().add(new THREE.Vector3(0, 0.7, 0)), GORE.cyanFluid, 0.6);
    this.bus.emit('pickup', { items, dna: 0, source: pod.type });
  }

  private steer(pr: Projectile, dt: number): void {
    let best: Abomination | null = null, bd = pr.seek!.radius;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const d = c.centre.distanceTo(pr.pos);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    const speed = pr.vel.length();
    const want = best.centre.clone().sub(pr.pos).normalize().multiplyScalar(speed);
    pr.vel.lerp(want, Math.min(1, pr.seek!.turnRate * dt)).setLength(speed);
  }

  private projectileHit(pr: Projectile, a: THREE.Vector3, b: THREE.Vector3): { point: THREE.Vector3; t: number } | null {
    if (pr.owner === 'enemy') {
      if (this.phase !== 'raid') return null;
      const chest = this.player.position.clone(); chest.y += CHEST;
      const t = segmentSphere(a, b, chest, PLAYER_RADIUS + 0.25);
      if (t === null) return null;
      const point = a.clone().lerp(b, t);
      this.hurt(pr.damage, 'torso', 'bilecantor', pr.origin);
      this.projectileLand(pr, point);
      return { point, t };
    }
    let bestT = Infinity, bestC: Abomination | null = null, bestS: HitSphere | null = null;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      let weakHit: { t: number; s: HitSphere } | null = null;
      let bodyHit: { t: number; s: HitSphere } | null = null;
      for (const h of c.hitSpheres) {
        const t = segmentSphere(a, b, h.world, h.r);
        if (t === null) continue;
        if (c.isLiveWeakPoint(h)) { if (!weakHit || t < weakHit.t) weakHit = { t, s: h }; }
        else if (!bodyHit || t < bodyHit.t) bodyHit = { t, s: h };
      }
      const hit = weakHit ?? bodyHit;
      if (hit && hit.t < bestT) { bestT = hit.t; bestC = c; bestS = hit.s; }
    }
    if (!bestC || !bestS) return null;
    const point = a.clone().lerp(b, bestT);
    const weak = bestC.isLiveWeakPoint(bestS);
    const dist = point.distanceTo(pr.origin);
    const mult = weak ? (bestC.t.weakPoint.multiplier ?? this.weapon.w.weakPointMultiplier) : 1;
    const dmg = pr.kind === 'ego' ? pr.damage * mult : projectileDamage(this.weapon.w, dist, mult);
    const dir = pr.vel.clone().normalize();
    this.damageCreature(bestC, dmg, weak, dir, point, pr.kind, bestS);
    if (pr.kind === 'spore') this.weapon.credit(weak);
    this.fx.impact(point, weak ? GORE.limeFluid : GORE.spore, weak ? 12 : 6);
    this.splash(pr, point, bestC);
    return { point, t: bestT };
  }

  private splash(pr: Projectile, at: THREE.Vector3, except: Abomination | null): void {
    if (pr.splashRadius <= 0) return;
    for (const c of this.creatures) {
      if (!c.alive || c === except) continue;
      const d = c.centre.distanceTo(at) - c.radius;
      if (d <= pr.splashRadius) this.damageCreature(c, pr.splashDamage, false, null, c.centre, 'splash');
    }
    if (pr.kind === 'ego') { this.fx.ring(at, GORE.cyanFluid, pr.splashRadius, 0.35); this.fx.impact(at, GORE.cyanFluid, 24, 9); }
  }

  private projectileLand(pr: Projectile, at: THREE.Vector3): void {
    if (pr.owner === 'enemy') {
      const pool = ABOMINATIONS.bilecantor.acidPool as { radius: number; damagePerSecond: number; duration: number };
      this.hazards.acidPool(at.x, at.z, pool.radius, pool.damagePerSecond, pool.duration);
      this.fx.impact(at, GORE.limeFluid, 20, 6);
      return;
    }
    this.fx.impact(at, pr.kind === 'ego' ? GORE.cyanFluid : GORE.spore, pr.kind === 'ego' ? 16 : 5, 4);
    this.splash(pr, at, null);
  }

  // ------------------------------------------------------------------ HUD + test hooks
  hud(): HudState {
    const p = this.player.position;
    const w = this.weapon;
    const nearestPod = this.interactTarget;
    return {
      phase: this.phase,
      biomass: this.biomass.current, biomassMax: this.biomass.max,
      overload: this.overload.fraction, overloaded: this.overload.overloaded,
      ammo: w.state.ammo, magazine: w.w.magazine, reloading: w.state.isReloading ? 1 - w.state.reloading / w.w.reloadTime : 0,
      ego: w.egoFraction, egoReady: w.egoReady, aiming: w.aim > 0.5,
      timeLeft: this.timeLeft, collapse: this.timeLeft <= RAID.zoneCollapse.warningAt,
      slots: this.abilities.slots(),
      carried: this.carried.items.map((s) => ({ item: s.item, label: LOOT.items[s.item].label, count: s.count, kind: LOOT.items[s.item].kind })),
      dna: this.carried.dna, value: this.carried.value, kills: this.kills,
      extract: { progress: this.extract.progress, inside: this.extract.inside, distance: Math.hypot(this.extract.x - p.x, this.extract.z - p.z), label: RAID.extract.label },
      interact: nearestPod ? { text: `HOLD E · TEAR OPEN ${LOOT.containers[nearestPod.type].label.toUpperCase()}`, progress: nearestPod.progress } : null,
      scanner: {
        x: p.x, z: p.z, yaw: this.player.yaw, range: 60,
        extract: { x: this.extract.x, z: this.extract.z },
        pods: this.pods.map((q) => ({ x: q.position.x, z: q.position.z, opened: q.opened })),
        pings: this.creatures.filter((c) => c.alive && (c.revealed > 0 || (c.engaged && c.position.distanceTo(p) < 25))).map((c) => ({ x: c.position.x, z: c.position.z, kind: c.kind, revealed: c.revealed > 0 })),
      },
      healing: this.useLeft > 0 || this.healLeft > 0,
    };
  }

  /** State for tests/raid.mjs and tooling. */
  testState(): Record<string, unknown> {
    return {
      phase: this.phase, biomass: this.biomass.current, overload: this.overload.value, overloaded: this.overload.overloaded,
      ammo: this.weapon.state.ammo, ego: this.weapon.ego, timeLeft: this.timeLeft, kills: this.kills,
      carried: this.carried.snapshot(), extractProgress: this.extract.progress,
      extractPosition: [this.extract.x, this.extract.z], pods: this.pods.map((q) => ({ id: q.id, position: [q.position.x, q.position.z], opened: q.opened })),
      enemies: this.creatures.map((c) => ({ id: c.id, kind: c.kind, alive: c.alive, state: c.state, biomass: c.biomass, position: [c.position.x, c.position.y, c.position.z], centre: [c.centre.x, c.centre.y, c.centre.z] })),
      result: this.result,
    };
  }

  debug() {
    return {
      begin: () => this.begin(),
      teleport: (x: number, z: number) => { this.player.position.set(x, groundHeight(x, z), z); this.player.velocity.set(0, 0, 0); },
      aimAt: (x: number, y: number, z: number) => {
        const eye = this.player.eyePosition;
        const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
        this.player.yaw = Math.atan2(-dx, -dz);
        this.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        this.debugAim = new THREE.Vector3(x, y, z);
      },
      clearAim: () => { this.debugAim = null; },
      trigger: (on: boolean | null) => { this.debugTrigger = on; },
      ego: () => { this.weapon.ego = this.weapon.w.egoCharge.chargeToFire; this.egoQueued = true; },
      ability: (slot: number) => this.useAbility(slot),
      hold: (code: string, on: boolean) => { if (on) this.player.keys.add(code); else this.player.keys.delete(code); },
      killAll: () => { for (const c of this.creatures) if (c.alive) this.damageCreature(c, 1e6, false, null, c.centre, 'debug'); },
      damage: (n: number) => this.hurt(n, 'torso', 'debug', null),
      extractNow: () => { const ex = this.extract; this.player.position.set(ex.x, groundHeight(ex.x, ex.z), ex.z); },
      setTimeScale: (k: number) => { this.timeScale = k; },
      setTimeLeft: (t: number) => { this.elapsed = RAID.raidTime - t; },
      give: (item: string, n = 1) => this.carried.add(item, n),
    };
  }
}
