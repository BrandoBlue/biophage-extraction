/**
 * The Mire Regent in a raid. Joins the renderer-free brain (src/ai/regent.ts), Creature's body
 * (src/creatures/zones/mireRegent.ts) and the Swamp zone's Regent's Pool (src/world/weepingfen.ts): Biomass, weak
 * points (pearls while it rears, eyes whenever they are above the water), hit tests (nothing under the water can be
 * hit), and the brain's events turned into what they do to the host: the arm's pin (shoot the arm to break it), the
 * tongue's pull, moss clouds, Mirebrood and the flood. Every number comes from data/bosses.json `mireRegent` and
 * data/ai.json `regent`; the raid applies the results (src/game/raid.ts).
 */
import * as THREE from 'three';
import { AI, BOSSES, type Boss } from '../../data';
import { RegentBrain, type HostView, type RegentEvent, type RegentPoolView } from '../ai';
import { MireRegent, type RegentHit } from '../creatures/zones/mireRegent';
import type { BuiltStructures } from '../world/structures';
import { segmentSphere } from './projectiles';
import type { HostStrike } from './boss';

export type RegentPool = NonNullable<BuiltStructures['regent']>;

export interface RegentFrame {
  strikes: HostStrike[];
  events: RegentEvent[];
  /** Mirebrood to call out of the water: `count` of `type` at (x, z). */
  brood: { type: string; x: number; z: number; count: number }[];
  /** Moss clouds to lay. */
  clouds: { x: number; y: number; z: number; radius: number; damagePerSecond: number; overloadPerSecond: number; duration: number }[];
  /** Biomass to drain from the host this frame (the enraged flood). */
  drain: number;
}

/** How far past the first body surface a shot can still reach an exposed weak point. */
const WEAK_DEPTH = 1.5;

export class RaidRegent {
  readonly t: Boss;
  readonly brain: RegentBrain;
  readonly body: MireRegent;
  readonly id = 'mireRegent';
  readonly view: RegentPoolView;
  biomass: number;
  readonly pearls: number[];
  readonly eyes: number[];
  /** Seconds the host is still held under by an arm (0 when free). */
  pinned = 0;
  private pinDps = 0;
  private pinArm = -1;
  private pinHealth = 0;

  constructor(readonly pool: RegentPool, scene?: THREE.Object3D, seed = 29) {
    this.t = BOSSES[this.id];
    this.view = { x: pool.x, z: pool.z, radius: pool.radius, waterY: pool.waterY };
    this.brain = new RegentBrain(pool.x, pool.z, seed);
    this.body = new MireRegent(seed, scene);
    const wp = this.t.weakPoints as { pearls: { count: number; biomassEach: number }; eyes: { count: number } };
    this.biomass = this.t.biomass;
    this.pearls = Array.from({ length: wp.pearls.count }, () => wp.pearls.biomassEach);
    this.eyes = Array.from({ length: wp.eyes.count }, () => AI.regent.eyeBiomass);
    this.sync();
    this.body.update(1 / 60);
  }

  get alive(): boolean { return this.brain.state !== 'dead'; }
  get awake(): boolean { return this.brain.state === 'awake'; }
  get fraction(): number { return this.biomass / this.t.biomass; }
  get position(): THREE.Vector3 { return this.body.root.position; }
  /** The water level now (the flood raises it). */
  get waterY(): number { return this.pool.waterY + this.brain.flood; }

  centre(out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.body.hitSpheres.find((x) => x.tag === 'head');
    return h ? out.copy(h.world) : out.copy(this.position);
  }

  /** True when this sphere takes weak-point damage right now. */
  exposed(s: RegentHit): boolean {
    if (s.tag === 'pearl') return this.body.risen > 0.5 && (this.pearls[s.index] ?? 0) > 0;
    if (s.tag === 'eye') return this.brain.eyesUp && (this.eyes[s.index] ?? 0) > 0;
    return false;
  }

  /** Under the water nothing can be hit. */
  private above(s: RegentHit): boolean { return s.world.y + s.r * 0.4 > this.waterY; }

  /** What a segment hits: an exposed pearl or eye first (within reach), else whatever is above the water. */
  hit(a: THREE.Vector3, b: THREE.Vector3): { t: number; sphere: RegentHit } | null {
    if (!this.alive) return null;
    const len = a.distanceTo(b) || 1;
    let near: { t: number; sphere: RegentHit } | null = null, weak: { t: number; sphere: RegentHit } | null = null;
    for (const s of this.body.hitSpheres) {
      if (s.r <= 0 || !this.above(s)) continue;
      if (s.tag === 'eye' && !this.brain.eyesUp) continue;
      const t = segmentSphere(a, b, s.world, s.r);
      if (t === null) continue;
      if (this.exposed(s)) { if (!weak || t < weak.t) weak = { t, sphere: s }; }
      else if (!near || t < near.t) near = { t, sphere: s };
    }
    if (weak && (!near || (weak.t - near.t) * len <= WEAK_DEPTH)) return weak;
    return near;
  }

  /** Applies a hit (`sphere` null: splash on whatever is above the water). */
  damage(amount: number, sphere: RegentHit | null): { dealt: number; killed: boolean; weak: boolean; popped: string | null; freed: boolean } {
    const none = { dealt: 0, killed: false, weak: false, popped: null, freed: false };
    if (!this.alive || amount <= 0) return none;
    if (!sphere && this.body.risen < 0.2 && !this.brain.eyesUp) return none;
    const wp = this.t.weakPoints as { pearls: { multiplier: number }; eyes: { multiplier: number } };
    let dealt = amount * this.brain.bodyMultiplier(), weak = false, popped: string | null = null, freed = false;
    if (sphere && this.exposed(sphere)) {
      weak = true;
      if (sphere.tag === 'pearl') {
        dealt = amount * wp.pearls.multiplier;
        this.pearls[sphere.index] = Math.max(0, this.pearls[sphere.index] - dealt);
        if (this.pearls[sphere.index] === 0) { this.body.popWeakPoint(sphere.index); popped = `pearl${sphere.index}`; }
      } else {
        dealt = amount * wp.eyes.multiplier;
        this.eyes[sphere.index] = Math.max(0, this.eyes[sphere.index] - dealt);
        if (this.eyes[sphere.index] === 0) { this.body.popWeakPoint(this.pearls.length + sphere.index); popped = `eye${sphere.index}`; }
        this.brain.dive();
      }
    }
    // Shooting the arm that holds the host breaks its grip.
    if (sphere?.tag === 'arm' && this.pinned > 0 && sphere.index === this.pinArm) {
      this.pinHealth -= amount;
      if (this.pinHealth <= 0) { this.release(); freed = true; }
    }
    this.biomass = Math.max(0, this.biomass - dealt);
    this.brain.hurt();
    this.body.hurt(1 - this.fraction);
    if (this.biomass > 0) return { dealt, killed: false, weak, popped, freed };
    this.release();
    this.brain.kill();
    this.body.destroy();
    return { dealt, killed: true, weak, popped, freed };
  }

  release(): void { this.pinned = 0; this.pinArm = -1; this.body.drive.reach = [null, null]; }

  update(dt: number, host: HostView): RegentFrame {
    const out: RegentFrame = { strikes: [], events: [], brood: [], clouds: [], drain: 0 };
    if (this.alive) {
      const b = this.brain, P = this.view;
      b.step(dt, { host, fraction: this.fraction, pool: P });
      this.sync();
      const wading = b.wading(host, P);
      const within = (at: { x: number; z: number }, r: number) => Math.hypot(host.x - at.x, host.z - at.z) <= r;
      const water = (x: number, z: number) => new THREE.Vector3(x, this.waterY, z);
      for (const e of b.events) {
        out.events.push(e);
        switch (e.type) {
          case 'grab':
            if (host.alive && wading && within(e.at, e.radius)) {
              out.strikes.push({ damage: e.damage, source: 'dragged under', from: null, pin: e.pin });
              this.pinned = e.pin; this.pinDps = e.damagePerSecond; this.pinArm = e.arm; this.pinHealth = e.freedByDamage;
            }
            break;
          case 'ripple':
            this.body.ripple();
            if (host.alive && wading && within(e.at, e.radius)) out.strikes.push({ damage: e.damage, source: 'ripple', from: water(e.at.x, e.at.z), knock: 5 });
            break;
          case 'croak': this.body.call(); break;
          case 'brood': {
            const p = this.body.broodPoint.getWorldPosition(new THREE.Vector3());
            const cx = p.x - P.x, cz = p.z - P.z, cd = Math.hypot(cx, cz), lim = P.radius * 0.9, k = cd > lim ? lim / cd : 1;
            out.brood.push({ type: e.spawnType, count: e.count, x: P.x + cx * k, z: P.z + cz * k });
            break;
          }
          case 'slam':
            this.body.slam();
            if (host.alive && host.y - this.waterY < 2.5 && within(e.at, e.radius)) out.strikes.push({ damage: e.damage, source: 'belly slam', from: water(e.at.x, e.at.z), knock: 10 });
            break;
          case 'tongue': {
            const dx = host.x - e.from.x, dz = host.z - e.from.z, d = Math.hypot(dx, dz);
            let off = Math.atan2(dx, dz) - e.yaw;
            off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
            // Within the tongue's line (wider up close, where the tip is fat).
            if (host.alive && d <= e.range && off <= (e.cone * Math.PI) / 180 + Math.atan2(1, Math.max(1, d))) {
              // The pull: knocked toward the mouth (from a point past the host).
              const from = e.pull ? new THREE.Vector3(host.x + (dx / (d || 1)) * 3, host.y, host.z + (dz / (d || 1)) * 3) : water(e.from.x, e.from.z);
              out.strikes.push({ damage: e.damage, source: 'tongue', from, knock: e.pull ? Math.min(14, d * 0.7) : 4 });
            }
            break;
          }
          case 'moss': out.clouds.push({ x: e.at.x, y: this.waterY, z: e.at.z, radius: e.radius, damagePerSecond: e.damagePerSecond, overloadPerSecond: e.overloadPerSecond, duration: e.duration }); break;
          case 'thrash':
            if (host.alive && wading && within(e.at, e.radius)) out.strikes.push({ damage: e.damage, source: 'thrash', from: water(e.at.x, e.at.z), knock: 8 });
            break;
          default: break;
        }
      }
      b.events.length = 0;
      // Held under: the arm grinds until it lets go or is shot off.
      if (this.pinned > 0) {
        this.pinned = Math.max(0, this.pinned - dt);
        if (host.alive) out.strikes.push({ damage: this.pinDps * dt, source: 'held under', from: null });
        const hand = this.body.drive.reach;
        hand[this.pinArm] = (hand[this.pinArm] ?? new THREE.Vector3()).set(host.x, this.waterY, host.z);
        if (this.pinned === 0 || !host.alive) this.release();
      }
      // Enraged, the whole fen is its pool.
      if (b.enraged && host.alive && wading) out.drain = AI.regent.enrageDrain * dt;
    }
    this.body.update(dt);
    return out;
  }

  /** Copies the brain onto Creature's body. */
  private sync(): void {
    const b = this.brain, r = this.body.root, d = this.body.drive;
    r.position.set(b.pos.x, this.waterY, b.pos.z);
    r.rotation.set(0, b.yaw, 0);
    r.updateMatrixWorld(true);
    d.rise = b.rise;
    d.open = b.open;
    d.tongue = b.tongue;
    d.thrash = b.thrash;
    d.phase = b.phase.id as typeof d.phase;
    if (this.pinned <= 0) for (const k of [0, 1] as const) { const p = b.reach[k]; d.reach[k] = p ? (d.reach[k] ?? new THREE.Vector3()).set(p.x, this.waterY + 0.5, p.z) : null; }
    d.look = b.look ? (d.look ?? new THREE.Vector3()).set(b.look.x, this.waterY + 1.5, b.look.z) : null;
  }
}
