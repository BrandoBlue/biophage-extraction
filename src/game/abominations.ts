import * as THREE from 'three';
import { groundHeight, mulberry32 } from '../world/zone7';
import type { Abomination as AbominationData } from '../../data';
import type { Noise } from './perception';
import { createBrain, tokensFor, type Brain, type BrainWorld, type Vec3 } from '../ai';
import { Creature } from '../creatures/creature';
import { creatureGore } from '../creatures/gore';
import type { SpeciesId } from '../creatures/plan';

/**
 * Abominations in a raid. The body is Creature & Mutation's procedural generator (src/creatures): a skinned,
 * IK-walking creature with weak points, severable limbs and glowing gore. Behaviour is PvE AI's brain (src/ai):
 * one archetype per kind, fed each frame from AbominationContext, its outputs copied onto Creature.drive and its
 * events turned into the callbacks below. Gameplay talks to them only through this class: update(), damage(),
 * hit spheres and callbacks in AbominationContext.
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
  /** How easy the host is to see (src/ai/light.ts hostVisibility). Default 1. */
  playerVisibility?: number;
  /** Unit XZ direction the host is looking. Stalkers freeze when watched. */
  playerForward?: { x: number; z: number } | null;
  /** Shove the host away from `from` (Mournback horns and slam). */
  onKnockback?(a: Abomination, strength: number): void;
  /** An Oculimoth screeched: everything within `radius` was alerted. */
  onScreech?(a: Abomination, radius: number): void;
  /** It burst from its tank or dropped its disguise (PvE AI habitats): play the burst, make the noise. */
  onReveal?(a: Abomination, how: 'hatch' | 'disguise' | 'ambush'): void;
}

/** Coarse state for HUD, tests and debug (derived from the brain). */
type State = 'idle' | 'alert' | 'chase' | 'windup' | 'lunge' | 'recover' | 'stagger' | 'dead';

let nextId = 1;
/** Seconds a burrower takes to haul itself out of the sand. */
const BURROW_EMERGE_TIME = 0.9;

interface Pustule { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; hp: number; popped: boolean }

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
  readonly brain: Brain;
  private stateTime = 0;
  private flinch = 0;
  private recentDamage = 0;
  private deadFor = 0;
  private lastHit = 0;
  private tokensReleased = false;
  private limbDamage = new Map<string, number>();
  private rand: () => number;
  readonly home: THREE.Vector3;
  /** Waits under the sand (layout.spawns `buried`): sunk out of sight while lurking, then claws its way up. */
  burrowed = false;
  /** 0 = fully under, 1 = out. */
  private emerged = 1;

  constructor(readonly kind: AbominationKind, readonly t: AbominationData, x: number, z: number, seed: number) {
    this.biomass = t.biomass;
    this.rand = mulberry32(seed);
    this.home = new THREE.Vector3(x, 0, z);
    this.root.position.set(x, groundHeight(x, z), z);
    this.yaw = this.rand() * Math.PI * 2;
    this.root.rotation.y = this.yaw;
    this.creature = new Creature(kind, 1 + (seed % VARIANTS), 0);
    this.creature.ground = groundHeight;
    this.root.add(this.creature.root);
    this.brain = createBrain(kind, this.id, x, z, seed, this.creature.plan.radius);
    this.yaw = this.brain.body.yaw;
    this.root.rotation.y = this.yaw;
    if (this.brain.body.altitude > 0) this.creature.drive.altitude = this.brain.body.altitude;
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
  }

  get alive(): boolean { return this.state !== 'dead'; }
  get position(): THREE.Vector3 { return this.root.position; }
  get centre(): THREE.Vector3 { return this.hitSpheres[0].world; }
  get removable(): boolean { return this.state === 'dead' && this.deadFor > 40; }
  get engaged(): boolean { return this.alive && this.brain.engaged; }
  get radius(): number { return this.creature.plan.radius; }
  get fluid(): THREE.Color { return new THREE.Color(this.creature.plan.palette.fluid); }

  // ---------------------------------------------------------------- Behaviour
  private setState(s: State): void { if (this.state !== s) { this.state = s; this.stateTime = 0; } }

  /** Moves the creature (spawn, nest ejection) and keeps its brain in step. */
  place(x: number, z: number, vx = 0, vz = 0): void {
    const b = this.brain.body;
    b.x = x; b.z = z; b.vx = vx; b.vz = vz;
    this.root.position.set(x, groundHeight(x, z), z);
    this.root.updateMatrixWorld(true);
    this.creature.plant();
  }

  /** Updates world-space hit spheres; call after moving. */
  refreshHitSpheres(): void {
    this.root.updateMatrixWorld(true);
    for (const h of this.hitSpheres) h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
  }

  /**
   * Where it lives (Gameplay's placement from data/habitats.json): wander within `roam` of home and drift back,
   * wait in a tank (`hatchOnApproach` metres), pose as a crate (`disguise`), or roost at `height` (PvE AI).
   */
  setHome(x: number, z: number, o: { roam?: number; hatchOnApproach?: number; disguise?: string; height?: number } = {}): void { this.brain.setHome(x, z, o); }
  /** Still in its tank or disguise: Creature/World show the tank or the crate instead of the hunting body. */
  get lurking(): boolean { return this.brain.lurking; }

  /** Called by nearby creatures (alertShare), screeches, nests and reinforcements: hunt the host. */
  alert(at: { x: number; z: number } | null = null): void { if (this.alive) this.brain.alert(at); }

  stagger(seconds: number): void {
    if (!this.alive) return;
    this.brain.stagger(seconds);
    this.setState('stagger');
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
    if (dir && (this.kind === 'needlemaw' || this.kind === 'oculimoth')) this.brain.impulse(dir.x * Math.min(4, amount / 10), dir.z * Math.min(4, amount / 10));
    this.lastHit = amount;
    this.brain.wound(this.biomass / this.t.biomass);
    this.brain.hurt();
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
    this.brain.kill();
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
    const tokens = tokensFor(ctx.others);
    if (this.state === 'dead') {
      if (!this.tokensReleased) { tokens.release(this.id); this.tokensReleased = true; }
      this.animateDeath(dt);
      return;
    }
    // The first living creature advances the raid's shared attack-token clock once per frame.
    if (ctx.others.find((o) => o.alive) === this) tokens.tick(dt);

    const p = ctx.player, brain = this.brain;
    const world: BrainWorld = {
      host: {
        x: p.x, y: p.y, z: p.z, vx: ctx.playerVelocity.x, vz: ctx.playerVelocity.z,
        alive: ctx.playerAlive, hidden: ctx.playerHidden,
        visibility: ctx.playerVisibility ?? 1, forward: ctx.playerForward ?? null,
      },
      noises: ctx.noises, allies: ctx.others, tokens, playableRadius: ctx.playableRadius,
    };
    brain.step(dt, world);
    this.handleEvents(ctx);

    const b = brain.body, pos = this.root.position;
    pos.set(b.x, groundHeight(b.x, b.z) - this.burrowSink(dt), b.z);
    this.yaw = b.yaw;
    this.velocity.set(b.vx, 0, b.vz);
    this.root.rotation.y = this.yaw;
    this.setState(this.coarseState());
    this.animate(dt);
  }

  /** How far below the ground a burrower sits this frame: under while lurking, rising with a lurch once revealed. */
  private burrowSink(dt: number): number {
    if (!this.burrowed) return 0;
    if (this.brain.lurking) this.emerged = 0;
    else this.emerged = Math.min(1, this.emerged + dt / BURROW_EMERGE_TIME);
    if (this.emerged >= 1) return 0;
    const t = this.emerged, ease = 1 - (1 - t) * (1 - t) * (1 - t);
    // Claws up in two heaves rather than a smooth lift.
    const heave = Math.sin(t * Math.PI * 4) * 0.08 * (1 - t);
    return (this.radius * 2.2 + 0.6) * (1 - ease) + heave;
  }

  private coarseState(): State {
    const brain = this.brain;
    if (brain.mode === 'stagger') return 'stagger';
    if (brain.mode === 'calm') return 'idle';
    if (brain.mode === 'investigate') return 'alert';
    if (brain.windup > 0.05 && brain.strike) return 'windup';
    if (/lunge|charge|dive|strike/.test(brain.phase)) return 'lunge';
    if (/recover|winded|fade|climb/.test(brain.phase)) return 'recover';
    return 'chase';
  }

  /** Turns the brain's one-shot events into damage, projectiles and alerts through the raid's callbacks. */
  private handleEvents(ctx: AbominationContext): void {
    const p = ctx.player, pos = this.root.position;
    for (const e of this.brain.events) {
      switch (e.type) {
        case 'alert': ctx.onAlert(this); break;
        case 'melee':
          ctx.onMelee(this, e.damage);
          if (e.knockback > 0) ctx.onKnockback?.(this, e.knockback);
          break;
        case 'spit': this.spit(ctx, e.target); break;
        case 'screech':
          this.pulse('screech');
          for (const o of ctx.others) if (o !== this && o.alive && o.position.distanceTo(pos) <= e.radius) o.alert({ x: p.x, z: p.z });
          ctx.onScreech?.(this, e.radius);
          break;
        case 'slam':
          this.pulse('slam');
          if (ctx.playerAlive && Math.hypot(p.x - pos.x, p.z - pos.z) <= e.radius) {
            ctx.onMelee(this, e.damage);
            ctx.onKnockback?.(this, e.knockback);
          }
          break;
        case 'reveal': ctx.onReveal?.(this, e.how); break;
        case 'charge': case 'notice': case 'dodge': break; // read by audio through the bus later
      }
    }
    this.brain.events.length = 0;
  }

  /** Fires a one-frame body pulse on the drive if Creature exposes it (screech pose, slam stomp). */
  private pulse(field: 'screech' | 'slam'): void {
    const d = this.creature.drive as unknown as Record<string, unknown>;
    if (field in d) d[field] = 1;
  }

  private spit(ctx: AbominationContext, target: Vec3): void {
    const throat = this.creature.rig.bones.find((b) => b.name === 'throat') ?? this.creature.rig.bones[0];
    const from = throat.getWorldPosition(new THREE.Vector3());
    from.y -= 0.3;
    const proj = (this.t.projectile as { speed: number; gravity: number }) ?? { speed: 22, gravity: 9.8 };
    const g = proj.gravity, vh = proj.speed * 0.8;
    // The brain already led the moving host; the target's y is relative to the host's feet.
    const flat = new THREE.Vector3(target.x - from.x, 0, target.z - from.z);
    const T = Math.max(0.4, flat.length() / vh);
    const vel = flat.normalize().multiplyScalar(vh);
    vel.y = (target.y - from.y + 0.5 * g * T * T) / T;
    ctx.onSpit(this, from, vel);
  }

  private animate(dt: number): void {
    const c = this.creature, d = c.drive, brain = this.brain;
    d.velocity.set(brain.body.vx, 0, brain.body.vz);
    d.excite = 0.25 + brain.excite * 0.75;
    d.windup = brain.windup;
    d.reveal = this.revealed > 0 ? 1.8 : 1;
    d.look = brain.look ? new THREE.Vector3(brain.look.x, brain.look.y + 0.3, brain.look.z) : null;
    d.strike = brain.strike ? new THREE.Vector3(brain.strike.x, brain.strike.y, brain.strike.z) : null;
    if (brain.body.altitude > 0 || d.altitude !== null) d.altitude = Math.max(0.2, brain.body.altitude - this.flinch * 0.4);
    // Camouflage (Glasswalker): fully visible while revealed by the Psych-Wave Pulse.
    const dr = d as unknown as Record<string, unknown>;
    if ('camo' in dr) dr.camo = this.revealed > 0 ? 1 : brain.visibility;
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
