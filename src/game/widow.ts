/**
 * The Sandwidow in a raid (PvE AI). Joins the renderer-free brain (src/ai/widow.ts), Creature's body
 * (src/creatures/zones/sandwidow.ts) and World's Skyfall Crater (src/world/structures.ts WidowArena): Biomass and weak
 * points (throat sacs, jaw petals), hit tests (nothing reaches her under the sand), and the brain's events turned into
 * what they do to the host. Standing on a debris rock keeps a host out of her bites from below and out of the
 * quicksand. Every number comes from data/bosses.json `sandwidow` and data/ai.json `widow`; the raid applies the
 * results (src/game/raid.ts): host damage, the slow, the blinding, the Dunewake brood and rewards.
 */
import * as THREE from 'three';
import { BOSSES, type Boss } from '../../data';
import { WidowBrain, type HostView, type WidowCrater, type WidowEvent } from '../ai';
import { Sandwidow, type WidowHit } from '../creatures/zones/sandwidow';
import type { WidowArena } from '../world/structures';
import { segmentSphere } from './projectiles';
import type { HostStrike } from './boss';

export interface WidowFrame {
  strikes: HostStrike[];
  events: WidowEvent[];
  /** Dunewake to call out of her throat: `count` of `type` at (x, z). */
  brood: { type: string; x: number; z: number; count: number }[];
  /** Movement multiplier for the host this frame (quicksand), 1 for none. */
  slow: number;
  /** Seconds the host is blinded by a sand blast this frame (0 for none). */
  blind: number;
}

/** How far past the first body surface a shot can still reach an exposed weak point. */
const WEAK_DEPTH = 1.5;
/** A host this far above the sand under them stands on a rock: safe from bites from below and the quicksand. */
const ON_ROCK = 0.9;

export class RaidWidow {
  readonly t: Boss;
  readonly brain: WidowBrain;
  readonly body: Sandwidow;
  readonly id = 'sandwidow';
  readonly crater: WidowCrater;
  biomass: number;
  readonly sacs: number[];
  readonly petals: number[];
  private qs = { slow: 1, dps: 0 };

  constructor(readonly arena: WidowArena, private ground: (x: number, z: number) => number, scene?: THREE.Object3D, seed = 17) {
    this.t = BOSSES[this.id];
    this.crater = { x: arena.x, z: arena.z, radius: arena.radius, floorY: arena.floorY };
    this.brain = new WidowBrain(arena.bossSpawn.x, arena.bossSpawn.z, seed);
    this.body = new Sandwidow(seed, scene);
    this.body.ground = ground;
    const wp = this.t.weakPoints as { throatSacs: { count: number; biomassEach: number }; jawPetals: { count: number; biomassEach: number } };
    this.biomass = this.t.biomass;
    this.sacs = Array.from({ length: wp.throatSacs.count }, () => wp.throatSacs.biomassEach);
    this.petals = Array.from({ length: wp.jawPetals.count }, () => wp.jawPetals.biomassEach);
    this.sync();
    this.body.plant();
  }

  get alive(): boolean { return this.brain.state !== 'dead'; }
  get awake(): boolean { return this.brain.state === 'awake'; }
  get fraction(): number { return this.biomass / this.t.biomass; }
  get position(): THREE.Vector3 { return this.body.root.position; }

  centre(out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.body.hitSpheres.find((x) => x.tag === 'head');
    return h ? out.copy(h.world) : out.copy(this.position);
  }

  /** True when this sphere takes weak-point damage right now. */
  exposed(s: WidowHit): boolean {
    if (s.tag === 'throatSac') return this.brain.sacsExposed && (this.sacs[s.index] ?? 0) > 0;
    if (s.tag === 'petal') return this.brain.petalsSeverable && (this.petals[s.index] ?? 0) > 0;
    return false;
  }

  /** What a segment hits. Nothing while she swims under the sand. */
  hit(a: THREE.Vector3, b: THREE.Vector3): { t: number; sphere: WidowHit } | null {
    if (!this.alive || this.brain.submerged) return null;
    const len = a.distanceTo(b) || 1;
    let near: { t: number; sphere: WidowHit } | null = null, weak: { t: number; sphere: WidowHit } | null = null;
    for (const s of this.body.hitSpheres) {
      if (s.r <= 0) continue;
      const t = segmentSphere(a, b, s.world, s.r);
      if (t === null) continue;
      if (this.exposed(s)) { if (!weak || t < weak.t) weak = { t, sphere: s }; }
      else if (!near || t < near.t) near = { t, sphere: s };
    }
    if (weak && (!near || (weak.t - near.t) * len <= WEAK_DEPTH)) return weak;
    return near;
  }

  /** Applies a hit (`sphere` null: splash on the body). Under the sand she takes nothing. */
  damage(amount: number, sphere: WidowHit | null): { dealt: number; killed: boolean; weak: boolean; popped: string | null } {
    if (!this.alive || amount <= 0 || this.brain.submerged) return { dealt: 0, killed: false, weak: false, popped: null };
    const wp = this.t.weakPoints as { throatSacs: { multiplier: number } };
    let dealt = amount * this.brain.bodyMultiplier(), weak = false, popped: string | null = null;
    if (sphere && this.exposed(sphere)) {
      weak = true;
      if (sphere.tag === 'throatSac') {
        dealt = amount * wp.throatSacs.multiplier;
        this.sacs[sphere.index] = Math.max(0, this.sacs[sphere.index] - dealt);
        if (this.sacs[sphere.index] === 0) { this.body.popWeakPoint(sphere.index); popped = `throatSac${sphere.index}`; }
      } else {
        dealt = amount;
        this.petals[sphere.index] = Math.max(0, this.petals[sphere.index] - dealt);
        if (this.petals[sphere.index] === 0) { this.body.popWeakPoint(this.sacs.length + sphere.index); this.brain.severPetal(); popped = `petal${sphere.index}`; }
      }
    }
    this.biomass = Math.max(0, this.biomass - dealt);
    this.brain.hurt();
    this.body.hurt(1 - this.fraction);
    if (this.biomass > 0) return { dealt, killed: false, weak, popped };
    this.brain.kill();
    this.body.destroy();
    return { dealt, killed: true, weak, popped };
  }

  /** Is (x, z) sucking quicksand right now (and the host's feet on the sand, not a rock)? */
  quicksandAt(x: number, y: number, z: number): boolean {
    const q = this.brain.quicksand;
    if (q <= 0 || !this.alive) return false;
    return Math.hypot(x - this.crater.x, z - this.crater.z) <= q * this.crater.radius && y - this.ground(x, z) < ON_ROCK;
  }

  update(dt: number, host: HostView): WidowFrame {
    const out: WidowFrame = { strikes: [], events: [], brood: [], slow: 1, blind: 0 };
    if (this.alive) {
      const b = this.brain;
      b.step(dt, { host, fraction: this.fraction, crater: this.crater });
      this.sync();
      const head = this.position.clone();
      const feetUp = host.y - this.ground(host.x, host.z);
      const onSand = feetUp < ON_ROCK;
      const within = (at: { x: number; z: number }, r: number) => Math.hypot(host.x - at.x, host.z - at.z) <= r;
      for (const e of b.events) {
        out.events.push(e);
        switch (e.type) {
          case 'undertow':
            if (host.alive && onSand && within(e.at, e.radius)) out.strikes.push({ damage: e.damage, source: 'undertow', from: new THREE.Vector3(e.at.x, this.ground(e.at.x, e.at.z), e.at.z), knock: 6 });
            break;
          case 'breach':
            this.body.breach();
            if (host.alive && feetUp < ON_ROCK * 2.5 && within(e.at, e.radius)) out.strikes.push({ damage: e.damage, source: 'breach', from: new THREE.Vector3(e.at.x, this.ground(e.at.x, e.at.z), e.at.z), knock: 10 });
            break;
          case 'thrash':
            if (host.alive && onSand && within(e.at, e.radius)) out.strikes.push({ damage: e.damage, source: 'thrash', from: head.clone(), knock: 8 });
            break;
          case 'blast': {
            this.body.blast();
            const dx = host.x - e.from.x, dz = host.z - e.from.z, d = Math.hypot(dx, dz);
            let off = Math.atan2(dx, dz) - e.yaw;
            off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
            if (host.alive && d <= e.range && off <= (e.cone * Math.PI) / 360) {
              out.strikes.push({ damage: e.damage, source: 'sand blast', from: head.clone(), knock: 3 });
              out.blind = Math.max(out.blind, e.blind);
            }
            break;
          }
          case 'brood': {
            this.body.call();
            const p = this.body.broodPoint.getWorldPosition(new THREE.Vector3());
            const cx = p.x - this.crater.x, cz = p.z - this.crater.z, cd = Math.hypot(cx, cz), lim = this.crater.radius * 0.85;
            const k = cd > lim ? lim / cd : 1;
            out.brood.push({ type: e.spawnType, count: e.count, x: this.crater.x + cx * k, z: this.crater.z + cz * k });
            break;
          }
          case 'quicksand': this.qs = { slow: e.slow, dps: e.damagePerSecond }; break;
          default: break;
        }
      }
      b.events.length = 0;
      // The sucking sand: slows and grinds whoever stands in it.
      if (host.alive && this.quicksandAt(host.x, host.y, host.z)) {
        out.slow = this.qs.slow;
        out.strikes.push({ damage: this.qs.dps * dt, source: 'quicksand', from: null });
      }
    }
    this.body.update(dt);
    return out;
  }

  /** Copies the brain onto Creature's body. */
  private sync(): void {
    const b = this.brain, r = this.body.root, d = this.body.drive;
    r.position.set(b.head.x, this.ground(b.head.x, b.head.z), b.head.z);
    r.rotation.set(0, b.yaw, 0);
    r.updateMatrixWorld(true);
    d.surface = b.surface;
    d.open = b.open;
    d.windup = b.windup;
    d.thrash = b.thrash;
    d.phase = b.phase.id as typeof d.phase;
    d.strike = b.strike ? (d.strike ?? new THREE.Vector3()).set(b.strike.x, this.ground(b.strike.x, b.strike.z) + 1, b.strike.z) : null;
    d.look = b.look ? (d.look ?? new THREE.Vector3()).set(b.look.x, this.ground(b.look.x, b.look.z) + 1.5, b.look.z) : null;
  }
}
