import * as THREE from 'three';
import { ABILITIES, ABOMINATIONS, BOSSES, CLASSES, HOST, KITS, LOOT, RAID, VIRUSES, VIRUS_RULES, WEAPONS, extractTimeFor, itemDef, layoutPosition, projectileDamage, rollContainer, type ClassId } from '../../data';
import { groundHeight, ISLAND_RADIUS, mulberry32 } from '../world/zone7';
import { Abomination, type AbominationContext, type AbominationKind, type HitSphere } from './abominations';
import { AbilitySystem } from './abilities';
import { EventBus } from './events';
import { ExtractionPoint } from './extraction';
import { Fx, GORE } from './fx';
import { Carried, type CarriedSnapshot } from './inventory';
import type { Deployment } from './profile';
import type { Placed } from './grid';
import { Injection, SporeInfection, virusForItem, virusModifiers } from './virus';
import { Grenade, huskRules, Mine, throwVelocity } from './gear';
import type { Noise } from './perception';
import { hostVisibility } from '../ai';
import { BroodNest } from './nest';
import { RaidBoss } from './boss';
import type { ReliquaryHit } from '../creatures/reliquary';
import { liquidLight } from '../render/materials';
import { BroodHeart } from '../creatures/broodheart';
import { Player } from './player';
import { Projectiles, segmentSphere, type Projectile } from './projectiles';
import { BioPod, Hazards, SeedSpire } from './props';
import { gravityAt, zone7Layout, type Zone7Layout } from '../world/layout';
import type { SiteDressing } from '../world/sites';
import type { ArenaInfo, BuiltStructures } from '../world/structures';

/** One Seed Spire of the raid: the World layout says where and when it opens (src/world/layout.ts). */
export interface SpireSite { id: string; label: string; opensAt: number; open: boolean; point: ExtractionPoint; spire: SeedSpire }
import { gore } from '../render/gore';
import { simplifyForSoftware } from '../render/pipeline';
import { creatureGore } from '../creatures/gore';
import { HostArm, VIRUS_LOOKS, attachToViewmodel, type VirusLook } from '../creatures/hostarm';
import { HarvestFx } from '../creatures/organs';
import { HIVE, ZONE7 } from '../render/palette';
import { NeuralOverload, Biomass } from './vitals';
import { SynapseBurster, projectileLooks } from './weapon';
import { DEFAULT_ZONE, RaidLog } from './economy';

export type Phase = 'briefing' | 'raid' | 'extracted' | 'lost';

/** Optional hooks into the render pipeline (Rendering & Tech Art). Missing methods are ignored. */
export interface PipelineHooks { setOverload?(v: number): void; hitPulse?(strength: number): void; readonly quality?: 'low' | 'high' }

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
  /** Awake boss nest (Brood Heart) in range: label, Biomass fraction, wave progress. */
  boss: { label: string; fraction: number; wave: number; waves: number } | null;
  /** Larva: active virus id, the virus being injected, and channel progress 0..1. */
  activeVirus: string | null;
  injecting: string | null;
  injectProgress: number;
  harvestProgress: number;
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
  readonly hostArm = new HostArm();
  private harvestFx = new HarvestFx();
  /** Raid-select zone and the contract log for this raid (src/game/economy.ts). */
  zone = DEFAULT_ZONE;
  log = new RaidLog();
  readonly abilities: AbilitySystem;
  readonly carried = new Carried();
  readonly creatures: Abomination[] = [];
  readonly pods: BioPod[] = [];
  /** Every Seed Spire this raid, in opening order. `extract`/`spire` are the one the host is at or nearest to. */
  readonly spires: SpireSite[] = [];
  /** The zone's boss arena (World & Level): bounds, entrances, pillars, pool and boss spawn. Null if none. */
  readonly arena: ArenaInfo | null;
  /** Brood Heart nests (PvE AI): wave-spawning set pieces placed from the World layout (RAID.larva.nests). */
  readonly nests: BroodNest[] = [];
  /** The zone boss in its arena (PvE AI): the Reliquary in World's bowl. Null when the zone has none. */
  readonly boss: RaidBoss | null = null;
  private bossPool: THREE.Mesh | null = null;
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
  private raycaster = new THREE.Raycaster();
  private lastDecal = new Map<number, number>();
  private noises: Noise[] = [];
  private trigger = false;
  private aimHeld = false;
  private egoQueued = false;
  private debugTrigger: boolean | null = null;
  private debugAim: THREE.Vector3 | null = null;
  private interactTarget: BioPod | null = null;
  private interactText: { text: string; progress: number } | null = null;
  /** Mid-raid virus: the injection channel and the active virus (Larva). */
  readonly injection = new Injection();
  private injectingItem: string | null = null;
  private spores = new SporeInfection();
  private parasites: { mesh: THREE.Mesh; target: Abomination | null; life: number }[] = [];
  private parasiteMat = new THREE.MeshBasicMaterial({ color: GORE.limeFluid });
  private parasiteGeo = new THREE.SphereGeometry(0.12, 8, 6);
  /** Corpse harvesting (Larva). */
  private harvestTarget: Abomination | null = null;
  private harvestProgress = 0;
  private harvested = new Set<number>();
  /** Melee and Flesh Market gear (grenades, mines, Heart Husk). */
  private meleeCooldown = 0;
  private meleeQueued = false;
  private grenades: { g: Grenade; mesh: THREE.Mesh }[] = [];
  private mines: { m: Mine; mesh: THREE.Mesh }[] = [];
  private gearMat = new THREE.MeshStandardMaterial({ color: GORE.bone, emissive: GORE.cyanFluid, emissiveIntensity: 1.5 });
  private gearGeo = new THREE.IcosahedronGeometry(0.12, 1);
  private reviveLeft = 0;
  private healLeft = 0;
  private healRate = 0;
  private useLeft = 0;
  private pendingHeal = { amount: 0, duration: 0 };
  private nextReinforce = RAID.reinforcements.firstAt;
  private collapseWarned = false;
  private spireSignal = 0;
  private sinceHit = 99;
  private result: (CarriedSnapshot & { cause?: string }) | null = null;
  private classId: ClassId = 'neuroInfiltrator';
  private spawnScale: number;

  constructor(
    private scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera, private canvas: HTMLCanvasElement,
    /** Live sites for this raid (World & Level). Seed 1 is Design's RAID.larva layout. */
    readonly layout: Zone7Layout = zone7Layout(1),
    private sites?: SiteDressing,
    structures?: BuiltStructures,
  ) {
    this.arena = structures?.arena ?? null;
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
    // Creature & Mutation: the host's forearm dissolve-grows into the injected virus's look.
    attachToViewmodel(this.weapon.view, this.hostArm);
    // Contracts: what happened this raid (settled in the Hive by economy.settleContracts).
    this.bus.on('harvestDone', (e) => this.log.harvest(e.item));
    this.bus.on('creatureDeath', (e) => this.log.kill(e.type));
    this.bus.on('virusInjected', (e) => {
      if ((VIRUS_LOOKS as string[]).includes(e.virus)) this.hostArm.mutate(e.virus as VirusLook, VIRUS_RULES.mutationGrowTime);
    });

    // Sites from the World layout: Seed Spires (a late one opens mid-raid), Bio-Pods, Gene Blooms.
    for (const e of layout.extracts) {
      const point = new ExtractionPoint(e.x, e.z, RAID.extract.zoneRadius, extractTimeFor(this.classId), RAID.extract.cancelOnLeave);
      const spire = new SeedSpire(e.x, e.z, RAID.extract.zoneRadius);
      const open = e.opensAt <= 0;
      spire.root.visible = open;
      scene.add(spire.root);
      this.spires.push({ id: e.id, label: e.label, opensAt: e.opensAt, open, point, spire });
    }
    const [ex, ez] = [this.spires[0].point.x, this.spires[0].point.z];
    for (const s of [...layout.pods, ...layout.nodes.map((n) => ({ ...n, type: 'geneBloom' }))]) {
      this.dropContainer(s.type, s.x, s.z, s.id);
    }
    // Caches inside structures stand on their decks, not on the terrain.
    for (const spot of structures?.loot ?? []) {
      const pod = new BioPod(spot.id, spot.container && LOOT.containers[spot.container] ? spot.container : 'bioPod', spot.x, spot.z);
      pod.root.position.y = spot.y;
      this.pods.push(pod);
      scene.add(pod.root);
    }

    for (const n of layout.nests) this.addNest(n.id, n.type, n.x, n.z);
    if (this.arena?.id === 'reliquaryBowl' && BOSSES.reliquary) {
      this.boss = new RaidBoss(this.arena, scene, Math.floor(this.rand() * 1e6), groundHeight);
      scene.add(this.boss.body.root);
      // The collapse flood: a sheet of liquid light spreading from the centre pool.
      this.bossPool = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), liquidLight({ pool: true }));
      this.bossPool.position.set(this.arena.pool.x, this.arena.floorY + 0.12, this.arena.pool.z);
      this.bossPool.visible = false;
      scene.add(this.bossPool);
    }

    const [sx, sz] = [layout.spawn.x, layout.spawn.z];
    this.player.spawn(sx, sz, Math.atan2(-(ex - sx), -(ez - sz)));
    this.player.onJump = () => { this.overload.add(HOST.neuralOverload.jumpFill); };
    this.player.onLand = (h) => {
      this.noise(this.player.position, HOST.noiseRadius.jumpLand, 'land');
      // Impact energy scales with gravity: falls inside the Gravity Bloom land softly.
      const over = h * this.player.gravityScale - HOST.fallDamage.safeHeight;
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

  /** The open Seed Spire the host is channelling, else the nearest open one. */
  get currentSpire(): SpireSite {
    const p = this.player.position;
    const open = this.spires.filter((s) => s.open);
    if (!open.length) return this.spires[0];
    return open.find((s) => s.point.inside)
      ?? open.reduce((a, b) => (Math.hypot(a.point.x - p.x, a.point.z - p.z) <= Math.hypot(b.point.x - p.x, b.point.z - p.z) ? a : b));
  }
  get extract(): ExtractionPoint { return this.currentSpire.point; }
  get spire(): SeedSpire { return this.currentSpire.spire; }

  // ------------------------------------------------------------------ setup
  private spawnInitial(): void {
    const minFromSpawn = Math.max(15, RAID.spawn.noEnemyWithin * this.spawnScale);
    const spawn = this.player.position;
    const [ex, ez] = [this.extract.x, this.extract.z];
    // Spore spawns plus the Larva roster (Glasswalkers, an Oculimoth swarm, a Mournback).
    for (const g of [...RAID.spawnGroups, ...(RAID.larva?.spawnGroups ?? [])]) {
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
            const ar = this.layout.area;
            const [x, z] = ar ? [ar.x0 + this.rand() * (ar.x1 - ar.x0), ar.z0 + this.rand() * (ar.z1 - ar.z0)]
              : layoutPosition({ radius: lo + this.rand() * (hi - lo), bearing: this.rand() * 360 }, this.playable);
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
    const r = Math.hypot(x, z), edge = this.playable * 0.95, ar = this.layout.area;
    if (ar) { x = Math.min(ar.x1, Math.max(ar.x0, x)); z = Math.min(ar.z1, Math.max(ar.z0, z)); }
    else if (r > edge) { x *= edge / r; z *= edge / r; }
    const c = new Abomination(kind, ABOMINATIONS[kind], x, z, Math.floor(this.rand() * 1e9));
    this.creatures.push(c);
    this.scene.add(c.root);
    // Creatures spawned after the first frame miss the pipeline's one-time software-tier simplification.
    if (this.pipeline.quality === 'low') simplifyForSoftware(c.root);
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
      if (this.phase !== 'raid' || e.repeat) return;
      if (e.code === 'KeyR') { if (this.weapon.reload()) this.onReload(); }
      if (e.code === 'KeyF') this.egoQueued = true;
      if (e.code === 'Digit1' || e.code === 'KeyQ') this.useAbility(1);
      if (e.code === 'Digit2') this.useAbility(2);
      if (e.code === 'KeyV') this.meleeQueued = true;
      if (e.code === 'KeyG') this.throwGrenade();
      if (e.code === 'KeyX') this.placeMine();
    });
  }

  /** Deploys from the Hive with the profile's loadout and starts the raid clock. */
  deploy(d: Deployment): void {
    if (this.phase !== 'briefing') return;
    this.carried.load(d.loadout, d.cavitySize, d.pouchSize);
    this.zone = d.zone ?? DEFAULT_ZONE;
    this.log = new RaidLog(this.zone);
    this.begin();
  }

  /** Starts the raid clock with whatever is carried (the Hive menu calls `deploy`). */
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
    if (this.phase !== 'raid' || amount <= 0 || this.reviveLeft > 0) return;
    const applied = this.biomass.damage(amount * HOST.hitZones[zone]);
    let direction = null;
    if (from) {
      const d = from.clone().sub(this.player.position); d.y = 0; d.normalize();
      direction = { x: d.x, y: 0, z: d.z };
    }
    this.sinceHit = 0;
    this.player.addTrauma(Math.min(0.6, applied / 40));
    if (applied >= 3 && from) {
      // The host's own blood: a spray in front of the camera toward the attacker (red is reserved for player damage).
      const eye = this.player.eyePosition.clone();
      const toward = from.clone().sub(eye); toward.y = 0; toward.normalize();
      const at = eye.addScaledVector(toward, 0.7).add(new THREE.Vector3(0, -0.35, 0));
      gore.burst(this.scene, { point: at, normal: toward.clone().negate().setY(0.4), colour: HIVE.danger, count: Math.min(60, 10 + applied * 2), speed: 3.5 });
      const p = this.player.position;
      gore.splat(this.scene, { point: new THREE.Vector3(p.x, groundHeight(p.x, p.z), p.z), normal: new THREE.Vector3(0, 1, 0), size: 0.6 + applied / 30, colour: HIVE.danger });
    }
    this.pipeline.hitPulse?.(Math.min(1, applied / 30));
    this.bus.emit('damaged', { amount: applied, biomass: this.biomass.current, zone, source, direction });
    if (this.biomass.dead && !this.tryRevive()) this.lose(source);
  }

  /**
   * Wound VFX from Rendering's gore library: a glowing splat that sticks to the creature mesh that was hit
   * (decals follow it as it moves) plus a droplet spray. Decals are throttled per creature to keep CPU cost flat.
   */
  private wound(c: Abomination, at: THREE.Vector3, dir: THREE.Vector3 | null, weak: boolean): void {
    const colour = `#${c.fluid.getHexString()}`;
    const back = (dir ?? new THREE.Vector3(0, -1, 0)).clone().normalize();
    gore.burst(this.scene, { point: at, normal: back.clone().negate(), colour, count: weak ? 34 : 16, speed: weak ? 7 : 4.5 });
    const now = this.elapsed;
    if (now - (this.lastDecal.get(c.id) ?? -1) < 0.15) return;
    this.lastDecal.set(c.id, now);
    this.raycaster.set(at.clone().addScaledVector(back, -0.8), back);
    this.raycaster.far = 2;
    const hit = this.raycaster.intersectObject(c.root, true).find((h) => (h.object as THREE.Mesh).isMesh && h.object.name !== 'gore-splat' && h.face);
    if (!hit) return;
    const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
    gore.splat(this.scene, { point: hit.point, normal, target: hit.object as THREE.Mesh, size: weak ? 0.45 : 0.3, colour });
  }

  private damageCreature(c: Abomination, amount: number, weak: boolean, dir: THREE.Vector3 | null, at: THREE.Vector3, source: string, sphere?: HitSphere): void {
    if (!c.alive) return;
    const kill = c.damage(amount, dir, sphere);
    this.fx.bleed(at, dir ?? new THREE.Vector3(0, -1, 0), c.fluid, weak ? 12 : 5);
    this.wound(c, at, dir, weak);
    this.bus.emit('hit', { target: c.kind, id: c.id, damage: amount, weakPoint: weak, kill, position: { x: at.x, y: at.y, z: at.z } });
    if (!kill && this.injection.active === 'plagueStalkerStrain' && source !== 'debug') this.spores.infect(c.id);
    if (kill) this.onKill(c);
  }

  private onKill(c: Abomination): void {
    {
      this.kills++;
      const dna = ABOMINATIONS[c.kind].dnaDrop;
      this.carried.dna += dna;
      this.fx.burst(c.centre.clone(), c.fluid, c.kind === 'bilecantor' ? 1.8 : 1);
      // Death: a big fountain and a glowing pool where the body falls.
      const colour = `#${c.fluid.getHexString()}`;
      const big = c.kind === 'bilecantor';
      gore.burst(this.scene, { point: c.centre.clone(), colour, count: big ? 160 : 90, speed: big ? 10 : 8 });
      const g = new THREE.Vector3(c.position.x, groundHeight(c.position.x, c.position.z), c.position.z);
      gore.splat(this.scene, { point: g, normal: new THREE.Vector3(0, 1, 0), size: big ? 5 : 2.6, colour });
      this.lastDecal.delete(c.id);
      if (c.kind === 'bilecantor') {
        const cloud = ABOMINATIONS.bilecantor.deathCloud as { radius: number; duration: number; damagePerSecond: number; overloadPerSecond: number };
        this.hazards.deathCloud(c.position.x, c.centre.y - 1.5, c.position.z, cloud.radius, cloud.damagePerSecond, cloud.overloadPerSecond, cloud.duration);
      }
      this.bus.emit('creatureDeath', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z }, dna });
      // Plague-Stalker: an infected death spreads spores to its neighbours.
      if (this.spores.stacksOf(c.id) > 0) {
        this.spores.clear(c.id);
        for (const o of this.creatures) if (o.alive && o.position.distanceTo(c.position) <= this.spores.r.spreadOnDeathRadius) this.spores.infect(o.id);
        this.fx.burst(c.centre.clone(), GORE.violetFluid, 1.2);
      }
      if (this.injection.active === 'splicedParasites') this.spawnParasite(c.centre);
      this.hostArm.onKill(this.scene);
    }
  }

  // ------------------------------------------------------------------ viruses
  /** Starts injecting the virus stack at `index` of a cavity or pouch zone. Returns false if it cannot. */
  inject(zone: 'cavity' | 'pouch', index: number): boolean {
    if (this.phase !== 'raid' || this.injection.injecting) return false;
    const grid = zone === 'cavity' ? this.carried.cavity : this.carried.pouch;
    const e = grid.entries[index];
    const virus = e ? virusForItem(e.item) : null;
    if (!e || !virus || !this.injection.start(virus)) return false;
    if (--e.count <= 0) grid.take(e);
    this.injectingItem = e.item;
    this.noise(this.player.position, VIRUS_RULES.injectNoise, 'inject');
    this.bus.emit('virusInjectStart', { virus, time: VIRUS_RULES.injectTime });
    return true;
  }

  /** Aborts an injection; the vial goes back into the cavities (or pouch). */
  cancelInject(): boolean {
    const virus = this.injection.cancel();
    if (!virus) return false;
    if (this.injectingItem) this.carried.add(this.injectingItem, 1);
    this.injectingItem = null;
    this.bus.emit('virusInjectCancel', { virus });
    return true;
  }

  private onVirus(virus: string): void {
    this.biomass.scaleMax(virusModifiers(virus).biomassMax);
    const item = this.injectingItem ?? VIRUSES[virus].item;
    this.injectingItem = null;
    this.bus.emit('virusInjected', { virus, item });
  }

  private spawnParasite(at: THREE.Vector3): void {
    const mesh = new THREE.Mesh(this.parasiteGeo, this.parasiteMat);
    mesh.position.copy(at);
    this.scene.add(mesh);
    const r = (VIRUSES.splicedParasites.effect as { parasiteOnKill: { lifetime: number } }).parasiteOnKill;
    this.parasites.push({ mesh, target: null, life: r.lifetime });
  }

  private updateVirusEffects(dt: number): void {
    // Spore infection damage over time (no hit gore per tick, just the kill).
    for (const [id, dmg] of this.spores.update(dt)) {
      const c = this.creatures.find((x) => x.id === id);
      if (!c?.alive) { this.spores.clear(id); continue; }
      if (c.damage(dmg, null)) { this.bus.emit('hit', { target: c.kind, id: c.id, damage: dmg, weakPoint: false, kill: true, position: { x: c.centre.x, y: c.centre.y, z: c.centre.z } }); this.onKill(c); }
    }
    // Parasites seek the nearest Abomination and bite once.
    if (!this.parasites.length) return;
    const r = (VIRUSES.splicedParasites.effect as { parasiteOnKill: { damage: number; seekRadius: number; speed: number } }).parasiteOnKill;
    const drain = Number((VIRUSES.splicedParasites.cost as { biomassDrainPerSecondWhileParasiteAlive?: number }).biomassDrainPerSecondWhileParasiteAlive ?? 0);
    for (let i = this.parasites.length - 1; i >= 0; i--) {
      const q = this.parasites[i];
      q.life -= dt;
      if (!q.target?.alive) {
        q.target = null;
        let bd = r.seekRadius;
        for (const c of this.creatures) { const d = c.alive ? c.centre.distanceTo(q.mesh.position) : Infinity; if (d < bd) { bd = d; q.target = c; } }
      }
      let bit = false;
      if (q.target) {
        const to = q.target.centre.clone().sub(q.mesh.position);
        const d = to.length();
        if (d < 0.7) {
          this.damageCreature(q.target, r.damage, false, to.normalize(), q.target.centre.clone(), 'parasite');
          bit = true;
        } else q.mesh.position.addScaledVector(to, Math.min(1, (r.speed * dt) / d));
      }
      if (bit || q.life <= 0) { this.scene.remove(q.mesh); this.parasites.splice(i, 1); }
    }
    if (this.parasites.length && drain > 0) {
      this.biomass.damage(drain * dt);
      if (this.biomass.dead && !this.tryRevive()) this.lose('spliced parasites');
    }
  }

  // ------------------------------------------------------------------ melee and Flesh Market gear
  private updateGear(dt: number): void {
    const p = this.player;
    // Heart Husk revive: frozen and untouchable while the husk regrows you.
    if (this.reviveLeft > 0) {
      this.reviveLeft -= dt;
      p.speedMultiplier = 0;
      if (this.reviveLeft <= 0) {
        this.biomass.current = this.biomass.max * huskRules().reviveFraction;
        this.fx.burst(p.position.clone().add(new THREE.Vector3(0, 1, 0)), GORE.flesh, 1.4);
        this.bus.emit('revived', { biomass: this.biomass.current });
      }
    }
    // Melee: a short lunge and a strike on the nearest Abomination in front.
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    if (this.meleeQueued) {
      this.meleeQueued = false;
      const k = KITS[this.classId].melee;
      if (this.meleeCooldown <= 0 && this.reviveLeft <= 0) {
        this.meleeCooldown = k.cooldown;
        const fwd = p.forward(new THREE.Vector3()).setY(0).normalize();
        p.velocity.addScaledVector(fwd, Number(k.lunge ?? 0) * 4);
        let best: Abomination | null = null, bd = k.range + 0.6;
        for (const c of this.creatures) {
          if (!c.alive) continue;
          const to = c.centre.clone().sub(p.eyePosition);
          const d = Math.hypot(to.x, to.z) - c.radius * 0.5;
          if (d < bd && to.setY(0).normalize().dot(fwd) > 0.55) { bd = d; best = c; }
        }
        if (best) {
          this.damageCreature(best, k.damage, false, fwd.clone(), best.centre.clone(), 'melee');
          best.stagger(0.4);
          p.addTrauma(0.25);
        }
        this.noise(p.position, HOST.noiseRadius.gunfire * 0.3, 'melee');
        this.bus.emit('melee', { id: k.id, hit: best ? best.id : null });
      }
    }
    // Grenades in flight.
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const q = this.grenades[i];
      const boom = q.g.update(dt, groundHeight);
      q.mesh.position.set(q.g.pos.x, q.g.pos.y, q.g.pos.z);
      if (!boom) continue;
      this.scene.remove(q.mesh);
      this.grenades.splice(i, 1);
      const at = q.mesh.position.clone();
      this.fx.ring(at, GORE.cyanFluid, q.g.r.radius, 0.6);
      this.fx.burst(at, GORE.violetFluid, 1.2);
      gore.burst(this.scene, { point: at, colour: `#${GORE.cyanFluid.getHexString()}`, count: 80, speed: 9 });
      this.noise(at, HOST.noiseRadius.egoCharge, 'grenade');
      for (const c of this.creatures) {
        if (!c.alive) continue;
        const dmg = q.g.damageAt(c.centre.distanceTo(at));
        if (dmg <= 0) continue;
        this.damageCreature(c, dmg, false, c.centre.clone().sub(at).normalize(), c.centre.clone(), 'grenade');
        c.stagger(q.g.r.overload / 40);
      }
      for (const n of this.nests) {
        if (!n.alive) continue;
        const core = n.core(new THREE.Vector3()), dmg = q.g.damageAt(core.distanceTo(at));
        if (dmg > 0) this.damageNest(n, dmg, null, core);
      }
      if (this.boss?.alive) {
        const core = this.boss.centre(new THREE.Vector3()), dmg = q.g.damageAt(Math.max(0, core.distanceTo(at) - this.boss.body.body.radius));
        if (dmg > 0) this.damageBoss(dmg, null, at, core);
      }
      const self = p.position.distanceTo(at);
      if (self <= q.g.r.radius) { this.overload.add(q.g.r.overload); this.hurt(q.g.damageAt(self) * 0.5, 'torso', 'own grenade', at); }
      this.bus.emit('explosion', { item: 'neuroSpikeGrenade', position: { x: at.x, y: at.y, z: at.z } });
    }
    // Mines.
    const alive = this.creatures.filter((c) => c.alive);
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const q = this.mines[i];
      const hit = q.m.update(dt, alive.map((c) => c.position));
      (q.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = q.m.armed ? 2.5 + Math.sin(this.elapsed * 8) : 0.4;
      if (hit < 0) continue;
      const c = alive[hit];
      this.scene.remove(q.mesh);
      this.mines.splice(i, 1);
      this.damageCreature(c, q.m.r.damage, false, new THREE.Vector3(0, 1, 0), c.centre.clone(), 'mine');
      c.stagger(q.m.r.root);
      gore.burst(this.scene, { point: c.centre.clone(), colour: `#${c.fluid.getHexString()}`, count: 70, speed: 7 });
      this.noise(c.position, HOST.noiseRadius.gunfire, 'mine');
      this.bus.emit('explosion', { item: 'mawSeedMine', position: { x: c.position.x, y: c.position.y, z: c.position.z } });
    }
  }

  /** Throws a Neuro-Spike Grenade from the cavities (or pouch). */
  throwGrenade(): boolean {
    if (this.phase !== 'raid' || this.reviveLeft > 0 || !this.carried.consume('neuroSpikeGrenade')) return false;
    const eye = this.player.eyePosition, dir = this.player.forward(new THREE.Vector3());
    const g = new Grenade({ x: eye.x + dir.x * 0.6, y: eye.y + dir.y * 0.6 - 0.1, z: eye.z + dir.z * 0.6 }, throwVelocity(dir));
    const mesh = new THREE.Mesh(this.gearGeo, this.gearMat);
    this.scene.add(mesh);
    this.grenades.push({ g, mesh });
    this.bus.emit('gearUsed', { item: 'neuroSpikeGrenade' });
    return true;
  }

  /** Plants a Maw-Seed Mine at the host's feet. */
  placeMine(): boolean {
    if (this.phase !== 'raid' || this.reviveLeft > 0 || !this.carried.consume('mawSeedMine')) return false;
    const p = this.player.position;
    const m = new Mine({ x: p.x, y: groundHeight(p.x, p.z), z: p.z });
    const mesh = new THREE.Mesh(this.gearGeo, this.gearMat.clone());
    mesh.scale.set(2.2, 0.6, 2.2);
    mesh.position.set(m.pos.x, m.pos.y + 0.05, m.pos.z);
    this.scene.add(mesh);
    this.mines.push({ m, mesh });
    this.bus.emit('gearUsed', { item: 'mawSeedMine' });
    return true;
  }

  /** Heart Husk: on lethal damage, spend one and regrow after a delay instead of dying. */
  private tryRevive(): boolean {
    if (this.reviveLeft > 0) return true;
    if (!this.carried.consume('heartHusk')) return false;
    this.reviveLeft = huskRules().reviveDelay;
    this.biomass.current = 0.001;
    this.bus.emit('reviving', { time: this.reviveLeft });
    return true;
  }

  // ------------------------------------------------------------------ in-raid inventory (UI & HUD's Tab overlay)
  /** The opened Bio-Pod within reach, as the third inventory zone, or null. */
  openContainer(): { id: string; type: string; items: { item: string; count: number }[] } | null {
    const pod = this.nearOpenPod();
    return pod ? { id: pod.id, type: pod.type, items: pod.remaining.map((s) => ({ ...s })) } : null;
  }

  private nearOpenPod(): BioPod | null {
    const p = this.player.position;
    return this.pods.find((q) => q.opened && Math.hypot(q.position.x - p.x, q.position.z - p.z) < 2.4 && Math.abs(q.position.y - p.y) < 2) ?? null;
  }

  /**
   * Moves the stack at `index` of zone `from` into zone `to`: at (x, y, rotated) when given, otherwise stacked and
   * first-fit. 'pod' is the opened Bio-Pod in reach (`openContainer`). Returns how many moved; never drops anything.
   */
  transfer(from: 'cavity' | 'pouch' | 'pod', index: number, to: 'cavity' | 'pouch' | 'pod', x?: number, y?: number, rotated = false): number {
    if (this.phase !== 'raid' || from === to) return 0;
    const pod = this.nearOpenPod();
    const grid = (z: string) => (z === 'cavity' ? this.carried.cavity : z === 'pouch' ? this.carried.pouch : null);
    let src: Placed | { item: string; count: number } | undefined;
    if (from === 'pod') src = pod?.remaining[index]; else src = grid(from)!.entries[index];
    if (!src || (to === 'pod' && !pod) || (from === 'pod' && !pod)) return 0;
    let moved: number;
    const dst = grid(to);
    if (dst) {
      if (x !== undefined && y !== undefined) moved = dst.place(src.item, src.count, x, y, rotated) ? src.count : 0;
      else moved = src.count - dst.add(src.item, src.count);
    } else {
      const s = pod!.remaining.find((r) => r.item === src!.item);
      if (s) s.count += src.count; else pod!.remaining.push({ item: src.item, count: src.count });
      moved = src.count;
    }
    if (moved <= 0) return 0;
    src.count -= moved;
    if (src.count <= 0) {
      if (from === 'pod') pod!.remaining.splice(index, 1); else grid(from)!.take(src as Placed);
    }
    this.bus.emit('inventoryChanged', { from, to, item: src.item, count: moved });
    return moved;
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
    p.speedMultiplier = (this.injection.injecting ? VIRUS_RULES.injectMovementMultiplier : 1) * (this.boss && this.boss.pinned > 0 ? 0 : 1);
    const mods = virusModifiers(this.injection.active);
    p.sprintBoost = mods.sprint;
    p.footstepScale = mods.footstep;
    this.overload.decayBoost = mods.overloadDecay;
    const wasOver = this.overload.overloaded;
    // Gravity Bloom anomaly: lighter gravity in its field (World layout).
    p.gravityScale = gravityAt(this.layout, p.position.x, p.position.z);
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

    // Virus: injection channel, spore infection ticks, parasites.
    if (live) {
      const done = this.injection.update(dt);
      if (done) this.onVirus(done);
      this.updateVirusEffects(dt);
    }

    if (live) this.updateGear(dt);

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
      // PvE AI senses: how lit up the host is, and where it is looking (src/ai).
      playerVisibility: hostVisibility({ moving: p.moving, sprinting: p.sprinting, crouched: p.crouched, sinceShot: p.sinceFired, virus: p.footstepScale }),
      playerForward: { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) },
      onKnockback: (c, strength) => {
        const d = new THREE.Vector3(p.position.x - c.position.x, 0, p.position.z - c.position.z);
        if (d.lengthSq() < 1e-6) d.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
        d.normalize();
        p.velocity.x += d.x * strength; p.velocity.z += d.z * strength;
        p.velocity.y = Math.max(p.velocity.y, strength * 0.45);
        p.grounded = false;
        p.addTrauma(Math.min(0.8, strength / 12));
      },
      onScreech: (c, radius) => {
        this.bus.emit('alert', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z } });
        this.noise(c.position, radius, 'screech');
      },
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
    if (live) this.updateNests(dt);
    if (this.boss) this.updateBoss(dt, live);
    creatureGore.update(dt);
    this.hostArm.update(dt);
    this.harvestFx.update(dt);
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
      if (!pod.lootable || !live) continue;
      if (Math.hypot(pod.position.x - p.position.x, pod.position.z - p.position.z) < 2.4 && Math.abs(pod.position.y - p.position.y) < 2) this.interactTarget = pod;
    }
    for (const pod of this.pods) if (pod !== this.interactTarget && pod.lootable) pod.progress = 0;
    if (this.interactTarget) {
      const pod = this.interactTarget;
      const c = pod.fixed ? { openTime: pod.fixed.openTime, noiseOnOpen: pod.fixed.noise } : LOOT.containers[pod.type];
      if (p.keys.has('KeyE')) {
        if (pod.progress === 0) { this.bus.emit('containerOpenStart', { container: pod.type }); this.noise(pod.position, c.noiseOnOpen, 'container'); }
        pod.progress = Math.min(1, pod.progress + dt / c.openTime);
        if (pod.progress >= 1) this.openPod(pod);
      } else pod.progress = 0;
    }

    // Corpse harvesting: hold E on a dead Abomination (when no Bio-Pod is in reach).
    let corpse: Abomination | null = null;
    if (live && !this.interactTarget) {
      let bd = 2.6;
      for (const c of this.creatures) {
        if (c.alive || this.harvested.has(c.id) || !ABOMINATIONS[c.kind].harvest) continue;
        const d = Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z);
        if (d < bd) { bd = d; corpse = c; }
      }
    }
    if (corpse !== this.harvestTarget) { this.harvestTarget = corpse; this.harvestProgress = 0; }
    if (corpse) {
      const h = ABOMINATIONS[corpse.kind].harvest!;
      if (p.keys.has('KeyE')) {
        if (this.harvestProgress === 0) { this.bus.emit('harvestStart', { type: corpse.kind, time: h.time }); this.noise(corpse.position, h.noise, 'harvest'); }
        this.harvestProgress = Math.min(1, this.harvestProgress + dt / h.time);
        this.bus.emit('harvestProgress', { progress: this.harvestProgress });
        if (this.harvestProgress >= 1) this.harvest(corpse);
      } else this.harvestProgress = 0;
    }
    // Creature & Mutation: the wet, glowing cut grows with the hold.
    if (this.harvestTarget && this.harvestProgress > 0) this.harvestFx.progress(this.scene, this.harvestTarget, this.harvestProgress);
    else this.harvestFx.cancel();
    this.interactText = this.interactTarget
      ? { text: this.interactTarget.opened ? 'HOLD E · TAKE WHAT IS LEFT' : `HOLD E · ${this.interactTarget.fixed?.verb ?? 'TEAR OPEN'} ${(this.interactTarget.fixed?.label ?? LOOT.containers[this.interactTarget.type]?.label ?? 'container').toUpperCase()}`, progress: this.interactTarget.progress }
      : this.harvestTarget ? { text: `HOLD E · HARVEST ${LOOT.items[ABOMINATIONS[this.harvestTarget.kind].harvest!.item].label.toUpperCase()}`, progress: this.harvestProgress } : null;

    // Seed Spires: late ones open on the clock; every open one can be channelled.
    for (const sp of this.spires) {
      if (!sp.open && live && this.elapsed >= sp.opensAt) {
        sp.open = true;
        sp.spire.root.visible = true;
        this.sites?.setExtractOpen(sp.id, true);
        this.bus.emit('extractOpened', { label: sp.label, x: sp.point.x, z: sp.point.z });
      }
      if (live && sp.open) {
        const change = sp.point.update(p.position.x, p.position.z, dt);
        if (change === 'start') {
          this.bus.emit('extractStart', { label: sp.label, time: sp.point.time });
          this.noise(sp.spire.position, RAID.extract.signalNoise, 'extract');
          this.spireSignal = 0;
        }
        if (sp.point.inside) {
          this.spireSignal += dt;
          if (this.spireSignal > 2) { this.spireSignal = 0; this.noise(sp.spire.position, RAID.extract.signalNoise, 'extract'); }
          this.bus.emit('extractProgress', { progress: sp.point.progress, timeLeft: sp.point.timeLeft });
        }
        if (change === 'cancel') this.bus.emit('extractCancel', {});
        if (change === 'done') this.win();
      }
      if (sp.open) sp.spire.update(dt, sp.point.progress, sp.point.inside);
    }

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

  private harvest(c: Abomination): void {
    const item = ABOMINATIONS[c.kind].harvest!.item;
    this.harvestProgress = 0;
    if (this.carried.add(item, 1) > 0) { this.bus.emit('cavityFull', { items: [{ item, count: 1 }] }); return; }
    this.harvested.add(c.id);
    this.harvestTarget = null;
    const colour = `#${c.fluid.getHexString()}`;
    gore.burst(this.scene, { point: c.centre.clone(), colour, count: 50, speed: 4 });
    this.harvestFx.done(this.scene, item, c.centre, this.hostArm.root);
    this.bus.emit('harvestDone', { item, type: c.kind });
    this.bus.emit('pickup', { items: [{ item, count: 1 }], dna: 0, source: c.kind });
  }

  private openPod(pod: BioPod): void {
    if (pod.type === 'geneBloom') this.sites?.setNodeHarvested(pod.id, true);
    const rolled = pod.opened ? pod.remaining : pod.fixed ? pod.fixed.items.map((s) => ({ ...s })) : rollContainer(pod.type, this.rand);
    if (!pod.opened && !pod.fixed) { this.log.open(pod.type); this.bus.emit('containerOpened', { id: pod.id, container: pod.type }); }
    pod.open();
    pod.remaining = [];
    const items: typeof rolled = [], left: typeof rolled = [];
    for (const s of rolled) {
      const miss = this.carried.add(s.item, s.count);
      if (s.count - miss > 0) items.push({ item: s.item, count: s.count - miss });
      if (miss > 0) left.push({ item: s.item, count: miss });
    }
    this.fx.burst(pod.position.clone().add(new THREE.Vector3(0, 0.7, 0)), GORE.cyanFluid, 0.6);
    if (items.length) this.bus.emit('pickup', { items, dna: 0, source: pod.type });
    // Never auto-drop what is carried: what does not fit stays in the pod (swap UI comes with the cavity overlay).
    if (left.length) { pod.reseal(left); this.bus.emit('cavityFull', { items: left }); }
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

  // ------------------------------------------------------------------ nests (Brood Heart)
  /** Places a nest. World's layout can call this with its own crater position. */
  addNest(id: string, type: string, x: number, z: number): BroodNest {
    const n = new BroodNest(id, type, x, z, new BroodHeart(Math.floor(this.rand() * 1e6), this.scene), this.rand);
    this.scene.add(n.body.root);
    if (this.pipeline.quality === 'low') simplifyForSoftware(n.body.root);
    this.nests.push(n);
    return n;
  }

  private updateNests(dt: number): void {
    const p = this.player.position;
    for (const n of this.nests) {
      const wasDormant = n.state === 'dormant';
      let alive = 0;
      for (const c of this.creatures) if (c.alive && n.brood.has(c.id)) alive++;
      const spawns = n.update(dt, Math.hypot(n.position.x - p.x, n.position.z - p.z), alive);
      if (wasDormant && (n.state as string) === 'active') this.bus.emit('nestAwake', { id: n.id, type: n.type, label: n.t.label });
      if (!spawns.length) continue;
      const waveBefore = n.brood.size;
      for (const s of spawns) {
        if (!ABOMINATIONS[s.type]) continue;
        const c = this.addCreature(s.type as AbominationKind, s.x, s.z);
        c.place(s.x, s.z, s.vx, s.vz);
        c.alert({ x: p.x, z: p.z });
        n.brood.add(c.id);
      }
      this.fx.burst(n.core(new THREE.Vector3()), GORE.violetFluid, 1.6);
      if (n.brood.size > waveBefore) this.bus.emit('nestWave', { id: n.id, wave: n.wave, of: n.waves });
    }
  }

  // ------------------------------------------------------------------ zone boss (the Reliquary)
  private updateBoss(dt: number, live: boolean): void {
    const b = this.boss!, p = this.player;
    const host = {
      x: p.position.x, y: p.position.y, z: p.position.z, vx: p.velocity.x, vz: p.velocity.z,
      alive: live, hidden: this.elapsed < RAID.spawn.safeTime, visibility: 1, forward: null,
    };
    const f = b.update(dt, host, p.position.y - groundHeight(p.position.x, p.position.z));
    const at = (x: number, z: number) => new THREE.Vector3(x, groundHeight(x, z) + 0.2, z);
    for (const e of f.events) {
      switch (e.type) {
        case 'wake': this.bus.emit('bossAwake', { boss: b.id, label: b.t.label, songRadius: e.songRadius }); p.addTrauma(0.35); break;
        case 'phase': this.bus.emit('bossPhase', { boss: b.id, phase: e.id }); p.addTrauma(0.5); this.fx.burst(b.centre(new THREE.Vector3()), GORE.violetFluid, 2.2); break;
        case 'enrage': this.bus.emit('bossEnraged', { boss: b.id }); break;
        case 'stamp': this.fx.ring(at(e.at.x, e.at.z), GORE.bone, e.radius, 0.45); this.noise(at(e.at.x, e.at.z), 30, 'boss'); break;
        case 'sweep': this.fx.ring(at(b.position.x, b.position.z), GORE.bone, e.range, 0.35); break;
        default: break;
      }
      if (e.type !== 'wake' && e.type !== 'phase' && e.type !== 'enrage') this.bus.emit('bossAttack', { boss: b.id, attack: e.type });
    }
    for (const s of f.strikes) {
      this.hurt(s.damage, 'torso', s.source === 'light pool' ? 'the light pool' : `${b.t.label} ${s.source}`, s.from);
      if (s.knock && s.from) {
        const d = new THREE.Vector3(p.position.x - s.from.x, 0, p.position.z - s.from.z);
        if (d.lengthSq() < 1e-6) d.set(Math.sin(b.brain.body.yaw), 0, Math.cos(b.brain.body.yaw));
        d.normalize();
        p.velocity.x += d.x * s.knock; p.velocity.z += d.z * s.knock;
        p.velocity.y = Math.max(p.velocity.y, s.knock * 0.45);
        p.grounded = false;
        p.addTrauma(Math.min(0.8, s.knock / 12));
      }
      if (s.pin) p.addTrauma(0.5);
    }
    for (const s of f.brood) {
      if (!ABOMINATIONS[s.type]) continue;
      const c = this.addCreature(s.type as AbominationKind, s.x, s.z);
      c.place(s.x, s.z, (s.x - b.position.x) * 1.5, (s.z - b.position.z) * 1.5);
      c.alert({ x: p.position.x, z: p.position.z });
    }
    for (const v of f.vents) this.hazards.deathCloud(v.x, v.y + 1, v.z, v.radius, v.damagePerSecond, v.overloadPerSecond, v.duration);
    for (const h of f.hymns) this.fx.ring(at(h.x, h.z), GORE.violetFluid, h.maxRadius, h.maxRadius / h.speed);
    for (const id of f.broken) {
      const q = this.arena!.pillars.find((x) => x.id === id)!;
      this.fx.burst(at(q.x, q.z).add(new THREE.Vector3(0, 2, 0)), GORE.bone, 2);
      gore.burst(this.scene, { point: at(q.x, q.z).add(new THREE.Vector3(0, 1.5, 0)), colour: HIVE.bone, count: 60, speed: 8 });
      this.bus.emit('bossCoverBroken', { boss: b.id, pillar: id });
    }
    if (this.bossPool) {
      const r = b.poolRadius;
      this.bossPool.visible = r > this.arena!.pool.radius;
      if (this.bossPool.visible) this.bossPool.scale.setScalar(r);
    }
  }

  /** Damages the boss. Returns true on a weak-point hit. */
  private damageBoss(amount: number, sphere: ReliquaryHit | null, from: THREE.Vector3, at: THREE.Vector3): boolean {
    const b = this.boss;
    if (!b?.alive) return false;
    const r = b.damage(amount, sphere, from.x, from.z);
    this.fx.impact(at, r.weak ? GORE.limeFluid : GORE.bone, r.weak ? 12 : 5);
    this.bus.emit('bossDamaged', { boss: b.id, biomass: b.biomass, fraction: b.fraction, weakPoint: r.weak, part: sphere?.tag ?? 'body' });
    if (r.popped) this.bus.emit('bossPartDestroyed', { boss: b.id, part: r.popped });
    if (r.killed) {
      const rw = b.t.rewards, c = b.position;
      this.kills++;
      this.noise(c, HOST.noiseRadius.egoCharge, 'boss');
      // Rewards (DNA, loot container, the hold-E heart) are paid by bossKilled, in front of the body.
      this.bossKilled(b.id, c.x + Math.sin(b.brain.body.yaw) * 8, c.z + Math.cos(b.brain.body.yaw) * 8);
      const container = rw.container && LOOT.containers[rw.container] ? rw.container : null;
      this.bus.emit('bossDefeated', { boss: b.id, dna: rw.dna, container });
    }
    return r.weak;
  }

  private damageNest(n: BroodNest, amount: number, vent: number | null, at: THREE.Vector3): void {
    const killed = n.damage(amount, vent);
    this.fx.impact(at, vent !== null ? GORE.limeFluid : GORE.violetFluid, vent !== null ? 12 : 6);
    this.bus.emit('nestDamaged', { id: n.id, biomass: n.biomass, fraction: n.fraction, weakPoint: vent !== null });
    if (!killed) return;
    const o = n.t.onDestroyed, c = n.position;
    this.fx.ring(c.clone().setY(c.y + 0.5), GORE.violetFluid, o.shockwave.radius, 0.8);
    if (this.player.position.distanceTo(c) <= o.shockwave.radius) this.overload.add(o.shockwave.overload);
    this.carried.dna += o.dnaDrop;
    this.kills++;
    this.dropContainer(o.container, c.x + 3.5, c.z, `${o.container}-${n.id}`);
    this.noise(c, HOST.noiseRadius.egoCharge, 'nest');
    this.bus.emit('nestDestroyed', { id: n.id, type: n.type, dna: o.dnaDrop, container: o.container });
  }

  private bossHud(): HudState['boss'] {
    const p = this.player.position;
    const b = this.boss;
    if (b?.awake && Math.hypot(b.position.x - p.x, b.position.z - p.z) <= b.t.songRadius) {
      const phase = b.brain.phase.id.toUpperCase();
      return { label: `${b.t.label} · ${b.brain.enraged ? 'ENRAGED' : phase}`, fraction: b.fraction, wave: 0, waves: 0 };
    }
    for (const n of this.nests) {
      if (n.state !== 'active' && n.state !== 'spent') continue;
      if (Math.hypot(n.position.x - p.x, n.position.z - p.z) > n.t.activationRadius * 1.5) continue;
      return { label: n.t.label, fraction: n.fraction, wave: n.wave, waves: n.waves };
    }
    return null;
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
    let nestHit: { n: BroodNest; t: number; vent: number | null } | null = null;
    for (const n of this.nests) {
      const h = n.hit(a, b);
      if (h && h.t < (nestHit?.t ?? bestT)) nestHit = { n, ...h };
    }
    const bh = this.boss?.hit(a, b) ?? null;
    if (bh && bh.t < (nestHit?.t ?? bestT)) {
      const point = a.clone().lerp(b, bh.t);
      const dmg = pr.kind === 'ego' ? pr.damage : projectileDamage(this.weapon.w, point.distanceTo(pr.origin), 1);
      const weak = this.damageBoss(dmg, bh.sphere, pr.origin, point);
      if (pr.kind === 'spore') this.weapon.credit(weak);
      return { point, t: bh.t };
    }
    if (nestHit) {
      const point = a.clone().lerp(b, nestHit.t);
      const dmg = pr.kind === 'ego' ? pr.damage : projectileDamage(this.weapon.w, point.distanceTo(pr.origin), 1);
      this.damageNest(nestHit.n, dmg, nestHit.vent, point);
      if (pr.kind === 'spore') this.weapon.credit(nestHit.vent !== null);
      return { point, t: nestHit.t };
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
      gore.burst(this.scene, { point: at, colour: ZONE7.lime, count: 30, speed: 5 });
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
    return {
      phase: this.phase,
      biomass: this.biomass.current, biomassMax: this.biomass.max,
      overload: this.overload.fraction, overloaded: this.overload.overloaded,
      ammo: w.state.ammo, magazine: w.w.magazine, reloading: w.state.isReloading ? 1 - w.state.reloading / w.w.reloadTime : 0,
      ego: w.egoFraction, egoReady: w.egoReady, aiming: w.aim > 0.5,
      timeLeft: this.timeLeft, collapse: this.timeLeft <= RAID.zoneCollapse.warningAt,
      slots: this.abilities.slots(),
      carried: this.carried.items.map((s) => ({ item: s.item, label: itemDef(s.item)!.label, count: s.count, kind: itemDef(s.item)!.kind })),
      dna: this.carried.dna, value: this.carried.value, kills: this.kills,
      extract: { progress: this.extract.progress, inside: this.extract.inside, distance: Math.hypot(this.extract.x - p.x, this.extract.z - p.z), label: this.currentSpire.label },
      interact: this.interactText,
      scanner: {
        x: p.x, z: p.z, yaw: this.player.yaw, range: 60,
        extract: { x: this.extract.x, z: this.extract.z },
        pods: this.pods.map((q) => ({ x: q.position.x, z: q.position.z, opened: q.opened })),
        pings: this.creatures.filter((c) => c.alive && (c.revealed > 0 || (c.engaged && c.position.distanceTo(p) < 25))).map((c) => ({ x: c.position.x, z: c.position.z, kind: c.kind, revealed: c.revealed > 0 })),
      },
      healing: this.useLeft > 0 || this.healLeft > 0,
      boss: this.bossHud(),
      activeVirus: this.injection.active,
      injecting: this.injection.pending,
      injectProgress: this.injection.progress,
      harvestProgress: this.harvestTarget ? this.harvestProgress : 0,
    };
  }

  /** World & Level calls this when the host reaches a named landmark (zones.json landmarks); contracts count it. */
  visit(landmark: string): void {
    if (this.log.visited.has(landmark)) return;
    this.log.visit(landmark);
    this.bus.emit('landmarkVisited', { landmark });
  }

  /**
   * PvE AI calls this when a bosses.json boss dies at (x, z): contracts count it, its kill DNA is carried, its loot
   * container drops beside the body and its organ (e.g. the Reliquary Heart) becomes a hold-E harvest. Once per raid.
   */
  bossKilled(boss: string, x = this.player.position.x, z = this.player.position.z): void {
    if (this.log.bosses.has(boss)) return;
    this.log.killBoss(boss);
    const r = BOSSES[boss]?.rewards;
    if (r) {
      // bosses.json rewards: kill DNA, the boss's loot container, and its harvestable organ (hold E, loud).
      this.carried.dna += r.dna;
      if (r.container) this.dropContainer(r.container, x + 3, z, `${r.container}-${boss}`);
      if (r.items?.length) {
        const spoils = new BioPod(`${boss}-spoils`, 'spoils', x, z + 3);
        const n = (c: number | [number, number]) => (Array.isArray(c) ? c[0] + Math.floor(this.rand() * (c[1] - c[0] + 1)) : c);
        spoils.fixed = { items: r.items.map((i) => ({ item: i.item, count: n(i.count) })), openTime: LOOT.containers.bioPod.openTime, noise: 0, verb: 'TEAR OPEN', label: `${BOSSES[boss].label} spoils` };
        this.pods.push(spoils);
        this.scene.add(spoils.root);
      }
      if (r.harvest) {
        const heart = new BioPod(`${boss}-harvest`, 'harvest', x - 3, z);
        heart.fixed = { items: [{ item: r.harvest.item, count: 1 }], openTime: r.harvest.time, noise: r.harvest.noise, verb: 'CUT OUT', label: itemDef(r.harvest.item)?.label ?? r.harvest.item };
        this.pods.push(heart);
        this.scene.add(heart.root);
      }
    }
    this.bus.emit('bossKilled', { boss, dna: r?.dna ?? 0, container: r?.container ?? null, harvest: r?.harvest?.item ?? null });
  }

  /**
   * Places a lootable container (any id in data/loot.json containers) on the ground: its contents roll from the
   * loot table when it is first opened, through the same hold-E and transfer flow as the map's pods. PvE AI's
   * Brood Heart calls this with 'broodCache' when it dies.
   */
  dropContainer(type: string, x: number, z: number, id = `${type}-drop-${this.pods.length}`): BioPod {
    if (!LOOT.containers[type]) throw new Error(`unknown container ${type}`);
    const pod = new BioPod(id, type, x, z);
    this.pods.push(pod);
    this.scene.add(pod.root);
    return pod;
  }

  /** State for tests/raid.mjs and tooling. */
  testState(): Record<string, unknown> {
    return {
      phase: this.phase, zone: this.zone, log: { harvested: Object.fromEntries(this.log.harvested), killed: Object.fromEntries(this.log.killed), opened: Object.fromEntries(this.log.opened), visited: [...this.log.visited], bosses: [...this.log.bosses] }, armLook: this.hostArm.current, biomass: this.biomass.current, overload: this.overload.value, overloaded: this.overload.overloaded,
      ammo: this.weapon.state.ammo, ego: this.weapon.ego, timeLeft: this.timeLeft, kills: this.kills,
      carried: this.carried.snapshot(), extractProgress: this.extract.progress,
      extractPosition: [this.extract.x, this.extract.z], pods: this.pods.map((q) => ({ id: q.id, position: [q.position.x, q.position.z], opened: q.opened })),
      enemies: this.creatures.map((c) => ({ id: c.id, kind: c.kind, alive: c.alive, state: c.state, biomass: c.biomass, position: [c.position.x, c.position.y, c.position.z], centre: [c.centre.x, c.centre.y, c.centre.z] })),
      result: this.result, gore: gore.stats(),
      boss: this.boss ? { state: this.boss.brain.state, phase: this.boss.brain.phase.id, action: this.boss.brain.action, biomass: this.boss.biomass, fraction: this.boss.fraction, hearts: [...this.boss.hearts], sac: this.boss.sac, legs: [...this.boss.legs], pinned: this.boss.pinned, pool: this.boss.poolRadius, position: [this.boss.position.x, this.boss.position.y, this.boss.position.z], centre: this.boss.centre(new THREE.Vector3()).toArray() } : null,
      arena: this.arena ? { x: this.arena.x, z: this.arena.z, radius: this.arena.radius, floorY: this.arena.floorY, entrances: this.arena.entrances, pillars: this.arena.pillars.map((q) => ({ id: q.id, broken: q.broken })) } : null,
      nests: this.nests.map((n) => ({ id: n.id, state: n.state, biomass: n.biomass, wave: n.wave, brood: n.brood.size, position: [n.position.x, n.position.z] })),
      reviving: this.reviveLeft > 0, grenades: this.grenades.length, mines: this.mines.length, virus: this.injection.active, injecting: this.injection.pending, parasites: this.parasites.length, harvested: [...this.harvested], maxBiomass: this.biomass.max,
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
      /** Damages nest `i` directly (ventricle index or null for the body). */
      hitNest: (i: number, amount: number, vent: number | null = null) => { const n = this.nests[i]; if (n) this.damageNest(n, amount, vent, n.core(new THREE.Vector3())); },
      /** Damages the boss directly: a tagged sphere ('heart', 'broodSac', 'leg', 'body') or null for a blast. */
      hitBoss: (amount: number, tag: string | null = null, index = 0) => {
        const b = this.boss;
        if (!b) return null;
        const s = tag ? b.body.hitSpheres.find((h) => h.tag === tag && h.index === index) ?? null : null;
        const at = s ? s.world.clone() : b.centre(new THREE.Vector3());
        return this.damageBoss(amount, s, this.player.position, at);
      },
      killAll: () => { for (const c of this.creatures) if (c.alive) this.damageCreature(c, 1e6, false, null, c.centre, 'debug'); },
      damage: (n: number) => this.hurt(n, 'torso', 'debug', null),
      extractNow: () => { const ex = this.extract; this.player.position.set(ex.x, groundHeight(ex.x, ex.z), ex.z); },
      setTimeScale: (k: number) => { this.timeScale = k; },
      setTimeLeft: (t: number) => { this.elapsed = RAID.raidTime - t; },
      give: (item: string, n = 1) => this.carried.add(item, n),
      melee: () => { this.meleeQueued = true; },
      grenade: () => this.throwGrenade(),
      mine: () => this.placeMine(),
      pouch: (item: string, n = 1) => this.carried.pouch.add(item, n),
      /** Drops a container at the host's feet (offset 1.2 m on x); returns its id. */
      dropContainer: (type: string) => this.dropContainer(type, this.player.position.x - 1.2, this.player.position.z).id,
      openContainer: () => this.openContainer(),
      visit: (landmark: string) => this.visit(landmark),
      bossKilled: (boss: string, x?: number, z?: number) => this.bossKilled(boss, x, z),
      /** Injects the first carried vial of `item` (cavities, then pouch). */
      inject: (item: string) => {
        for (const zone of ['cavity', 'pouch'] as const) {
          const i = (zone === 'cavity' ? this.carried.cavity : this.carried.pouch).entries.findIndex((e) => e.item === item);
          if (i >= 0) return this.inject(zone, i);
        }
        return false;
      },
      transfer: (from: 'cavity' | 'pouch' | 'pod', i: number, to: 'cavity' | 'pouch' | 'pod', x?: number, y?: number, r?: boolean) => this.transfer(from, i, to, x, y, r),
    };
  }
}
