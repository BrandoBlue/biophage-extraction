import * as THREE from 'three';
import { groundHeight, mulberry32 } from '../world/zone7';
import type { Abomination as AbominationData } from '../../data';
import { hears, sees, type Noise } from './perception';
import { Creature } from '../creatures/creature';
import { creatureGore } from '../creatures/gore';
import type { SpeciesId } from '../creatures/plan';

/**
 * Abominations in a raid. The body is Creature & Mutation's procedural generator (src/creatures): a skinned,
 * IK-walking creature with weak points, severable limbs and glowing gore. The behaviour below is the interim
 * Spore state machine generalised to the five Larva kinds until PvE AI (src/ai) takes it over. Gameplay talks
 * to them only through this class: update(), damage(), hit spheres and callbacks in AbominationContext.
 */

export type AbominationKind = SpeciesId;

export interface HitSphere {
  local: THREE.Vector3; r: number; weak: boolean; world: THREE.Vector3; bone: THREE.Object3D;
  /** Bile Cantor song pustule index. */
  pustule?: number;
  /** Limb this sphere sits on: enough damage there shoots it off (cosmetic). */
  limb?: string;
}

export interface AbominationContext {
  player: THREE.Vector3;
  playerVelocity: THREE.Vector3;
  playerAlive: boolean;
  /** Host is protected (spawn safety): creatures cannot notice it. */
  playerHidden: boolean;
  noises: Noise[];
  others: Abomination[];
  playableRadius: number;
  onAlert(a: Abomination): void;
  onMelee(a: Abomination, damage: number): void;
  onSpit(a: Abomination, from: THREE.Vector3, vel: THREE.Vector3): void;
}

type State = 'idle' | 'alert' | 'chase' | 'windup' | 'lunge' | 'recover' | 'stagger' | 'dead';

let nextId = 1;

interface Pustule { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; hp: number; popped: boolean }

/** Turn rate (rad/s) per kind: small things whip around, the tank does not. */
const TURN: Record<AbominationKind, number> = { needlemaw: 8, bilecantor: 2, glasswalker: 5, oculimoth: 10, mournback: 1.4 };
/** Shape variants per species: instances share SDF meshes and shader programs, packs still vary. */
const VARIANTS = 3;

export class Abomination {
  readonly id = nextId++;
  readonly root = new THREE.Group();
  readonly creature: Creature;
  readonly hitSpheres: HitSphere[] = [];
  biomass: number;
  state: State = 'idle';
  yaw = 0;
  readonly velocity = new THREE.Vector3();
  /** Seconds left of Psych-Wave reveal (outlined and pinned on the scanner). */
  revealed = 0;
  readonly pustules: Pustule[] = [];
  private stateTime = 0;
  private cooldown = 0;
  private flinch = 0;
  private recentDamage = 0;
  private wander = new THREE.Vector3();
  private lostFor = 0;
  private deadFor = 0;
  private hover = 0;
  private strafe = 1;
  private lastHit = 0;
  private limbDamage = new Map<string, number>();
  private rand: () => number;
  readonly home: THREE.Vector3;
  private readonly melee: boolean;

  constructor(readonly kind: AbominationKind, readonly t: AbominationData, x: number, z: number, seed: number) {
    this.biomass = t.biomass;
    this.rand = mulberry32(seed);
    this.home = new THREE.Vector3(x, 0, z);
    this.root.position.set(x, groundHeight(x, z), z);
    this.yaw = this.rand() * Math.PI * 2;
    this.root.rotation.y = this.yaw;
    this.melee = kind !== 'bilecantor';
    this.creature = new Creature(kind, 1 + (seed % VARIANTS), 0);
    this.creature.ground = groundHeight;
    this.root.add(this.creature.root);
    const fly = (t.flightHeight ?? t.hoverHeight) as [number, number] | undefined;
    if (fly) { this.hover = fly[0] + this.rand() * (fly[1] - fly[0]); this.creature.drive.altitude = this.hover; }
    this.strafe = this.rand() < 0.5 ? -1 : 1;
    this.root.updateMatrixWorld(true);
    this.creature.plant();

    // Hit spheres: body spheres first (centre = the first), then weak points and limbs.
    const hits = [...this.creature.rig.hits].sort((a, b) => rank(a.spec) - rank(b.spec));
    for (const h of hits) {
      const part = h.spec.part;
      const pustule = part?.startsWith('pustule') ? Number(part.slice(7)) : undefined;
      const limb = part && this.creature.rig.limbs.has(part) ? part : undefined;
      this.hitSpheres.push({ local: h.local, r: h.spec.r, weak: h.spec.weak, world: h.world, bone: h.bone, pustule, limb });
    }
    for (const p of this.creature.rig.parts.values()) {
      if (!p.spec.id.startsWith('pustule')) continue;
      this.pustules[Number(p.spec.id.slice(7))] = { mesh: p.mesh, mat: p.mesh.material as THREE.MeshStandardMaterial, hp: Number((t.weakPoint as { biomassEach?: number }).biomassEach ?? 45), popped: false };
    }
    this.pickWander();
  }

  get alive(): boolean { return this.state !== 'dead'; }
  get position(): THREE.Vector3 { return this.root.position; }
  get centre(): THREE.Vector3 { return this.hitSpheres[0].world; }
  get removable(): boolean { return this.state === 'dead' && this.deadFor > 40; }
  get engaged(): boolean { return this.state !== 'idle' && this.state !== 'dead'; }
  get radius(): number { return this.creature.plan.radius; }
  get fluid(): THREE.Color { return new THREE.Color(this.creature.plan.palette.fluid); }

  // ---------------------------------------------------------------- Behaviour
  private pickWander(): void {
    const a = this.rand() * Math.PI * 2, d = this.rand() * 8;
    this.wander.set(this.home.x + Math.cos(a) * d, 0, this.home.z + Math.sin(a) * d);
  }

  private setState(s: State): void { this.state = s; this.stateTime = 0; }

  /** Updates world-space hit spheres; call after moving. */
  refreshHitSpheres(): void {
    this.root.updateMatrixWorld(true);
    for (const h of this.hitSpheres) h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
  }

  /** Called by nearby creatures (alertShare) or damage. */
  alert(): void { if (this.state === 'idle') this.setState('alert'); }

  stagger(seconds: number): void {
    if (!this.alive) return;
    this.setState('stagger');
    this.cooldown = Math.max(this.cooldown, 0.3);
    this.stateTime = -seconds + 0.6; // stagger state lasts `seconds`
  }

  /** Applies damage. `sphere` is the hit sphere struck, if any. Returns true if this killed the creature. */
  damage(amount: number, dir: THREE.Vector3 | null, sphere?: HitSphere): boolean {
    if (!this.alive) return false;
    // Mournback: the bone shield turns most damage from the front (weak points excepted).
    const armour = this.t.frontArmour as { arc: number; multiplier: number } | undefined;
    if (armour && dir && !sphere?.weak) {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const toShooter = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
      if (fwd.dot(toShooter) > Math.cos(THREE.MathUtils.degToRad(armour.arc / 2))) amount *= armour.multiplier;
    }
    this.biomass -= amount;
    this.flinch = Math.min(1, this.flinch + amount / 40);
    this.recentDamage += amount;
    if (dir && (this.kind === 'needlemaw' || this.kind === 'oculimoth')) this.velocity.addScaledVector(dir, Math.min(4, amount / 10));
    this.lastHit = amount;
    this.alert();
    // Limb hits: enough damage on one limb shoots it off (the creature fights on without it).
    if (sphere?.limb && this.root.parent) {
      const d = (this.limbDamage.get(sphere.limb) ?? 0) + amount;
      this.limbDamage.set(sphere.limb, d);
      if (d >= this.t.biomass * 0.3) creatureGore.sever(this.root.parent, this.creature, sphere.limb, (dir ?? new THREE.Vector3()).clone().multiplyScalar(4));
    }
    if (sphere?.pustule !== undefined) {
      const p = this.pustules[sphere.pustule];
      if (!p.popped) {
        p.hp -= amount;
        if (p.hp <= 0) {
          p.popped = true;
          p.mesh.userData.popped = true;
          p.mesh.scale.setScalar(0.35);
          p.mat.emissive.set(this.creature.plan.palette.fluid);
          p.mat.emissiveIntensity = 0.15;
        }
      }
      const all = (this.t.weakPoint as { allPoppedKills?: boolean }).allPoppedKills;
      if (all && this.pustules.every((x) => x.popped)) this.biomass = 0;
    }
    if (this.recentDamage >= this.t.staggerThreshold && this.state !== 'stagger') { this.recentDamage = 0; this.stagger(0.6); }
    if (this.biomass <= 0) { this.die(); return true; }
    return false;
  }

  /** The pustule a weak-point sphere belongs to has already burst: hits there count as body hits. */
  isLiveWeakPoint(h: HitSphere): boolean { return h.weak && (h.pustule === undefined || !this.pustules[h.pustule].popped); }

  private die(): void {
    this.setState('dead');
    this.deadFor = 0;
    this.creature.die();
    // Death gore: small fliers burst apart; a heavy killing blow takes a limb with it.
    const scene = this.root.parent;
    if (!scene) return;
    if (this.kind === 'oculimoth') creatureGore.burstAll(scene, this.creature, new THREE.Vector3(0, 2, 0));
    else if (this.lastHit >= 30) {
      const limbs = [...this.creature.rig.limbs.values()].filter((l) => !l.severed && l.spec.severable);
      const l = limbs[Math.floor(this.rand() * limbs.length)];
      if (l) creatureGore.sever(scene, this.creature, l.spec.id, new THREE.Vector3(0, 3, 0));
    }
  }

  update(dt: number, ctx: AbominationContext): void {
    this.stateTime += dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.recentDamage = Math.max(0, this.recentDamage - dt * this.t.staggerThreshold * 0.5);
    this.revealed = Math.max(0, this.revealed - dt);
    const t = this.t;
    const pos = this.root.position;
    const toPlayer = new THREE.Vector3(ctx.player.x - pos.x, 0, ctx.player.z - pos.z);
    const dist = toPlayer.length();
    if (dist > 0.001) toPlayer.divideScalar(dist);

    if (this.state === 'dead') { this.animateDeath(dt); return; }

    const contact = ctx.playerAlive && !ctx.playerHidden && (
      sees(t.perception, pos.x, pos.z, this.yaw, ctx.player.x, ctx.player.z) ||
      ctx.noises.some((n) => hears(t.perception, pos.x, pos.z, n)));

    let wantSpeed = 0;
    let face: THREE.Vector3 | null = null;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const windup = t.windup;

    switch (this.state) {
      case 'idle': {
        const w = new THREE.Vector3(this.wander.x - pos.x, 0, this.wander.z - pos.z);
        if (w.length() < 0.8 || this.stateTime > 10) { this.pickWander(); this.stateTime = 0; }
        else { wantSpeed = t.speed * 0.22; face = w.normalize(); }
        if (contact) this.setState('alert');
        break;
      }
      case 'alert':
        face = toPlayer;
        if (this.stateTime <= dt + 1e-6) ctx.onAlert(this);
        if (this.stateTime > (this.melee ? 0.3 : 0.5)) this.setState('chase');
        break;
      case 'chase': {
        face = toPlayer;
        if (!ctx.playerAlive || ctx.playerHidden) { this.setState('idle'); break; }
        if (contact) this.lostFor = 0; else if ((this.lostFor += dt) > t.perception.loseInterest) { this.lostFor = 0; this.home.copy(pos); this.setState('idle'); break; }
        if (this.melee) {
          wantSpeed = t.speed;
          // Zig-zag approach (the small ones weave hard, the tank comes straight on).
          const weave = this.kind === 'mournback' ? 0 : this.kind === 'glasswalker' ? 0.25 : 0.55;
          const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(Math.sin(this.stateTime * 4 + this.id) * weave * Math.min(1, dist / 8));
          face = toPlayer.clone().add(side).normalize();
          if (dist < t.attackRange * 1.8 && this.cooldown === 0) this.setState('windup');
        } else {
          const [near, far] = (t.preferredRange as [number, number]) ?? [18, 35];
          let move = new THREE.Vector3();
          if (dist > far) move.copy(toPlayer);
          else if (dist < near) move.copy(toPlayer).negate();
          // Drift sideways around the host.
          move.add(new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(0.6 * this.strafe));
          if (this.rand() < dt * 0.15) this.strafe *= -1;
          if (move.lengthSq() > 0) { move.normalize(); this.velocity.x = THREE.MathUtils.damp(this.velocity.x, move.x * t.speed, 2, dt); this.velocity.z = THREE.MathUtils.damp(this.velocity.z, move.z * t.speed, 2, dt); }
          if (dist < t.attackRange && this.cooldown === 0) this.setState('windup');
        }
        break;
      }
      case 'windup':
        face = toPlayer;
        if (this.stateTime >= windup) {
          if (this.melee) {
            this.velocity.copy(toPlayer).multiplyScalar(Number(t.lungeSpeed ?? t.chargeSpeed ?? 10));
            this.velocity.y = 0;
            this.setState('lunge');
          } else {
            this.spit(ctx);
            this.cooldown = t.cooldown;
            this.setState('recover');
          }
        }
        break;
      case 'lunge':
        face = toPlayer;
        if (dist < t.attackRange * 0.75 && this.stateTime < this.lungeTime && this.cooldown === 0) {
          ctx.onMelee(this, t.damage);
          this.cooldown = t.cooldown;
        }
        if (this.stateTime > this.lungeTime) { this.cooldown = Math.max(this.cooldown, t.cooldown * 0.7); this.setState('recover'); }
        break;
      case 'recover':
        face = toPlayer;
        if (this.stateTime > 0.45) this.setState('chase');
        break;
      case 'stagger':
        if (this.stateTime > 0.6) this.setState('chase');
        break;
    }

    // Steering.
    if (face) {
      const target = Math.atan2(face.x, face.z);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = TURN[this.kind];
      this.yaw += THREE.MathUtils.clamp(d, -turn * dt, turn * dt);
    }
    if (this.melee && this.state !== 'lunge') {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const desired = fwd.multiplyScalar(wantSpeed * (1 - this.flinch * 0.7) * (this.state === 'stagger' ? 0 : 1));
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, desired.x, 7, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, desired.z, 7, dt);
    } else if (this.kind === 'bilecantor' && this.state === 'idle') {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(wantSpeed);
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, fwd.x, 2, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, fwd.z, 2, dt);
    } else if (this.kind === 'bilecantor' && this.state !== 'chase') {
      this.velocity.multiplyScalar(Math.exp(-2 * dt));
    }

    // Separation from other creatures; needlemaws cannot overlap the host.
    for (const o of ctx.others) {
      if (o === this || !o.alive || o.kind !== this.kind) continue;
      const dx = pos.x - o.position.x, dz = pos.z - o.position.z;
      const d = Math.hypot(dx, dz), min = this.radius + o.radius;
      if (d > 0.001 && d < min) { pos.x += (dx / d) * (min - d) * 0.5; pos.z += (dz / d) * (min - d) * 0.5; }
    }
    if (this.melee) {
      const min = this.radius + 0.35;
      if (dist < min && dist > 0.001) { pos.x -= toPlayer.x * (min - dist); pos.z -= toPlayer.z * (min - dist); }
    }

    pos.x += this.velocity.x * dt;
    pos.z += this.velocity.z * dt;
    const r = Math.hypot(pos.x, pos.z), edge = ctx.playableRadius * 0.98;
    if (r > edge) { pos.x *= edge / r; pos.z *= edge / r; }
    pos.y = groundHeight(pos.x, pos.z);
    this.root.rotation.y = this.yaw;
    this.animate(dt, ctx, dist);
  }

  /** Lunge or charge length: long enough to cover the strike range at lunge speed. */
  private get lungeTime(): number {
    const speed = Number(this.t.lungeSpeed ?? this.t.chargeSpeed ?? 10);
    return THREE.MathUtils.clamp((this.t.attackRange * 2) / speed, 0.3, 0.9);
  }

  private spit(ctx: AbominationContext): void {
    const throat = this.creature.rig.bones.find((b) => b.name === 'throat') ?? this.creature.rig.bones[0];
    const from = throat.getWorldPosition(new THREE.Vector3());
    from.y -= 0.3;
    const proj = (this.t.projectile as { speed: number; gravity: number; leadTarget: number }) ?? { speed: 22, gravity: 9.8, leadTarget: 0.5 };
    const g = proj.gravity;
    const flat0 = new THREE.Vector3(ctx.player.x - from.x, 0, ctx.player.z - from.z);
    const vh = proj.speed * 0.8;
    const T = Math.max(0.4, flat0.length() / vh);
    // Lead the moving host by `leadTarget` of its travel during the flight.
    const target = ctx.player.clone().addScaledVector(ctx.playerVelocity, T * proj.leadTarget);
    target.y += 0.9;
    const flat = new THREE.Vector3(target.x - from.x, 0, target.z - from.z);
    const T2 = Math.max(0.4, flat.length() / vh);
    const vel = flat.normalize().multiplyScalar(vh);
    vel.y = (target.y - from.y + 0.5 * g * T2 * T2) / T2;
    ctx.onSpit(this, from, vel);
  }

  private animate(dt: number, ctx: AbominationContext, dist: number): void {
    const c = this.creature, d = c.drive;
    d.velocity.copy(this.velocity).setY(0);
    d.excite = this.engaged ? 1 : 0.25;
    d.windup = this.state === 'windup' ? Math.min(1, this.stateTime / this.t.windup) : this.state === 'lunge' ? 1 : 0;
    d.reveal = this.revealed > 0 ? 1.8 : 1;
    d.look = this.engaged ? ctx.player.clone().setY(ctx.player.y + 1.5) : null;
    d.strike = d.windup > 0 ? ctx.player.clone().setY(ctx.player.y + 1.1) : null;
    if (this.kind === 'oculimoth') {
      // Swoop down to head height to peck, climb back to its patrol height otherwise.
      const want = this.engaged && dist < 8 ? 1.4 : this.hover;
      d.altitude = THREE.MathUtils.damp(d.altitude ?? this.hover, want, 3, dt);
    } else if (this.kind === 'bilecantor') {
      d.altitude = this.hover - this.flinch * 0.4;
    }
    if (this.state === 'stagger') this.creature.root.rotation.z = Math.sin(this.stateTime * 30) * 0.08;
    else this.creature.root.rotation.z = 0;
    c.update(dt);
  }

  private animateDeath(dt: number): void {
    this.deadFor += dt;
    this.creature.update(dt);
    if (this.deadFor > 30) this.root.position.y -= dt * 0.12;
  }
}

function rank(h: { weak: boolean; part?: string; bone: unknown }): number {
  if (!h.weak && !h.part && typeof h.bone === 'number') return 0;
  if (h.weak) return 1;
  return 2;
}
