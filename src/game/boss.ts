/**
 * The Reliquary in a raid (PvE AI). Joins the renderer-free brain (src/ai/reliquary.ts), Creature's body
 * (src/creatures/reliquary.ts) and World's bowl arena (src/world/structures.ts ArenaInfo): Biomass and weak points,
 * hit tests, the brain's events turned into what they do to the host (stamp, sweep, hymn ring, grab pin, the flood),
 * cover breaking and brood spawns. Every number comes from data/bosses.json. The raid applies the results
 * (src/game/raid.ts): host damage, hazards, spawns, rewards and the HUD.
 */
import * as THREE from 'three';
import { BOSSES, type Boss } from '../../data';
import { ReliquaryBrain, type BossEvent } from '../ai';
import { wrapAngle } from '../ai/brain';
import type { HostView } from '../ai';
import { Reliquary, type ReliquaryHit } from '../creatures/reliquary';
import { segmentSphere } from './projectiles';
import type { ArenaInfo } from '../world/structures';

export interface BossHit { t: number; sphere: ReliquaryHit }

/** Something the boss did to the host this frame. */
export interface HostStrike { damage: number; source: string; from: THREE.Vector3 | null; knock?: number; pin?: number }

/** What the raid has to act on after a frame. */
export interface BossFrame {
  strikes: HostStrike[];
  /** Needlemaws to spawn (brood drops), with their eject point. */
  brood: { type: string; x: number; z: number }[];
  /** Spore clouds to lay (rear and vent). */
  vents: { x: number; y: number; z: number; radius: number; damagePerSecond: number; overloadPerSecond: number; duration: number }[];
  /** Hymn rings started this frame (for the FX). */
  hymns: { x: number; z: number; maxRadius: number; speed: number }[];
  /** Pillars broken this frame. */
  broken: string[];
  events: BossEvent[];
}

/** How far past the outer body surface a shot can still reach an exposed weak point (hearts sit in the throat cage). */
const WEAK_DEPTH = 2;

export class RaidBoss {
  readonly t: Boss;
  readonly brain: ReliquaryBrain;
  readonly body: Reliquary;
  biomass: number;
  /** Remaining Biomass per heart, the brood sac, and per leg. */
  readonly hearts: number[];
  sac: number;
  readonly legs: number[];
  /** Seconds the host stays pinned by a tendril grab, and the damage it takes the boss to let go. */
  pinned = 0;
  private pinBreak = 0;
  private rings: { x: number; z: number; r: number; speed: number; max: number; damage: number; height: number; hit: boolean }[] = [];
  private readonly spot = new THREE.Vector3();

  constructor(readonly arena: ArenaInfo, scene?: THREE.Object3D, seed = 7, readonly ground: (x: number, z: number) => number = () => arena.floorY, readonly id = 'reliquary') {
    this.t = BOSSES[id];
    if (!this.t) throw new Error(`no boss ${id}`);
    const s = arena.bossSpawn;
    this.brain = new ReliquaryBrain(s.x, s.z, Math.atan2(arena.x - s.x, arena.z - s.z), id);
    this.body = new Reliquary(seed, scene);
    this.body.ground = ground;
    const wp = this.t.weakPoints as { hearts: { count: number; biomassEach: number }; broodSac: { biomass: number }; legs: { count: number; biomassEach: number } };
    this.biomass = this.t.biomass;
    this.hearts = Array.from({ length: wp.hearts.count }, () => wp.hearts.biomassEach);
    this.sac = wp.broodSac.biomass;
    this.legs = Array.from({ length: wp.legs.count }, () => wp.legs.biomassEach);
    this.sync();
    this.body.plant();
  }

  get alive(): boolean { return this.brain.state !== 'dead'; }
  get awake(): boolean { return this.brain.state === 'awake'; }
  get fraction(): number { return this.biomass / this.t.biomass; }
  get position(): THREE.Vector3 { return this.body.root.position; }
  /** Light pool radius on the bowl floor (collapse flood; the whole bowl when enraged). */
  get poolRadius(): number { return this.brain.pool * this.arena.radius; }
  /** Live rings (for the FX): centre, radius, height. */
  get hymnRings(): readonly { x: number; z: number; r: number; height: number }[] { return this.rings; }

  /** Body centre in world space. */
  centre(out = this.spot): THREE.Vector3 { return out.copy(this.body.body.centre).applyMatrix4(this.body.root.matrixWorld); }

  /**
   * What a segment hits. An exposed weak point (an open heart, the brood sac, a leg once they can be severed) wins
   * when the shot reaches it within WEAK_DEPTH past the first body surface; otherwise the nearest sphere.
   */
  hit(a: THREE.Vector3, b: THREE.Vector3): BossHit | null {
    if (!this.alive) return null;
    const len = a.distanceTo(b) || 1;
    let near: BossHit | null = null, weak: BossHit | null = null;
    for (const s of this.body.hitSpheres) {
      if (s.r <= 0) continue;
      const t = segmentSphere(a, b, s.world, s.r);
      if (t === null) continue;
      if (this.exposed(s)) { if (!weak || t < weak.t) weak = { t, sphere: s }; }
      else if (s.tag !== 'heart' && (!near || t < near.t)) near = { t, sphere: s };
    }
    if (weak && (!near || (weak.t - near.t) * len <= WEAK_DEPTH)) return weak;
    return near;
  }

  /** True when this sphere takes weak-point damage right now. */
  exposed(s: ReliquaryHit): boolean {
    if (s.tag === 'heart') return this.brain.heartsOpen && (this.hearts[s.index] ?? 0) > 0;
    if (s.tag === 'broodSac') return this.sac > 0;
    if (s.tag === 'leg') return this.brain.phase.id !== 'stalk' && (this.legs[s.index] ?? 0) > 0;
    return false;
  }

  /**
   * Applies a hit. `sphere` null is splash or a blast on the body. Returns the Biomass dealt, whether it killed,
   * and what broke.
   */
  damage(amount: number, sphere: ReliquaryHit | null, fromX: number, fromZ: number): { dealt: number; killed: boolean; weak: boolean; popped: string | null } {
    if (!this.alive || amount <= 0) return { dealt: 0, killed: false, weak: false, popped: null };
    const wp = this.t.weakPoints as { hearts: { multiplier: number }; broodSac: { multiplier: number } };
    let dealt = amount * this.brain.bodyMultiplier(fromX, fromZ), weak = false, popped: string | null = null;
    if (sphere && this.exposed(sphere)) {
      weak = true;
      if (sphere.tag === 'heart') {
        dealt = amount * wp.hearts.multiplier;
        this.hearts[sphere.index] = Math.max(0, this.hearts[sphere.index] - dealt);
        if (this.hearts[sphere.index] === 0) { this.body.popWeakPoint(sphere.index); popped = `heart${sphere.index}`; }
      } else if (sphere.tag === 'broodSac') {
        dealt = amount * wp.broodSac.multiplier;
        this.sac = Math.max(0, this.sac - dealt);
        if (this.sac === 0) { this.body.popWeakPoint(this.hearts.length); popped = 'broodSac'; }
      } else if (sphere.tag === 'leg') {
        dealt = amount;
        this.legs[sphere.index] = Math.max(0, this.legs[sphere.index] - dealt);
        if (this.legs[sphere.index] === 0) { this.body.severLeg(sphere.index); popped = `leg${sphere.index}`; }
      }
    }
    this.biomass = Math.max(0, this.biomass - dealt);
    this.brain.hurt();
    this.body.hurt(1 - this.fraction);
    if (this.pinned > 0) { this.pinBreak -= dealt; if (this.pinBreak <= 0) this.pinned = 0; }
    if (this.biomass > 0) return { dealt, killed: false, weak, popped };
    this.brain.kill();
    this.body.destroy();
    this.pinned = 0;
    this.rings.length = 0;
    return { dealt, killed: true, weak, popped };
  }

  get legsIntact(): number { return this.legs.filter((l) => l > 0).length; }

  /**
   * Advances the fight. `feet` is the host's feet height above the ground under it (a jump clears the hymn ring;
   * the ledge counts as high ground). Returns what the raid has to apply this frame.
   */
  update(dt: number, host: HostView, feet: number): BossFrame {
    const out: BossFrame = { strikes: [], brood: [], vents: [], hymns: [], broken: [], events: [] };
    this.body.update(dt);
    if (!this.alive) return out;
    const b = this.brain;
    b.step(dt, { host, fraction: this.fraction, broodSacAlive: this.sac > 0, legsIntact: this.legsIntact, arena: { x: this.arena.x, z: this.arena.z } });
    // The bowl walls: keep the body inside the floor.
    const lim = this.arena.radius * 0.72 - this.t.size.length * 0.25;
    const dx = b.body.x - this.arena.x, dz = b.body.z - this.arena.z, d = Math.hypot(dx, dz);
    if (d > lim) { b.body.x = this.arena.x + (dx / d) * lim; b.body.z = this.arena.z + (dz / d) * lim; }
    this.sync();
    this.pinned = Math.max(0, this.pinned - dt);

    const me = this.position;
    const toHost = Math.hypot(host.x - me.x, host.z - me.z);
    for (const e of b.events) {
      out.events.push(e);
      switch (e.type) {
        case 'stamp':
          this.body.slam();
          if (host.alive && Math.hypot(host.x - e.at.x, host.z - e.at.z) <= e.radius) out.strikes.push({ damage: e.damage, source: 'stamp', from: new THREE.Vector3(e.at.x, host.y, e.at.z), knock: 7 });
          break;
        case 'sweep': {
          const off = Math.abs(wrapAngle(Math.atan2(host.x - me.x, host.z - me.z) - b.body.yaw));
          if (host.alive && toHost <= e.range && off <= (e.arc * Math.PI) / 360) out.strikes.push({ damage: e.damage, source: 'sweep', from: me.clone(), knock: 10 });
          break;
        }
        case 'brood': {
          this.body.birth();
          const sac = this.body.sacBone.getWorldPosition(new THREE.Vector3());
          for (let i = 0; i < e.count; i++) {
            const a = (i / e.count) * Math.PI * 2 + b.body.yaw;
            out.brood.push({ type: e.spawnType, x: sac.x + Math.sin(a) * 2, z: sac.z + Math.cos(a) * 2 });
          }
          break;
        }
        case 'vent':
          this.body.vent();
          out.vents.push({ x: me.x, y: me.y, z: me.z, radius: e.radius, damagePerSecond: e.damagePerSecond, overloadPerSecond: e.overloadPerSecond, duration: e.duration });
          break;
        case 'hymn':
          this.rings.push({ x: me.x, z: me.z, r: 0, speed: e.speed, max: e.maxRadius, damage: e.damage, height: e.height, hit: false });
          out.hymns.push({ x: me.x, z: me.z, maxRadius: e.maxRadius, speed: e.speed });
          break;
        case 'coverBreak':
          for (const p of this.arena.pillars) {
            if (p.broken || Math.hypot(p.x - me.x, p.z - me.z) > e.reach + p.radius) continue;
            p.destroy();
            out.broken.push(p.id);
          }
          break;
        case 'drag':
          if (host.alive) out.strikes.push({ damage: e.damage, source: 'drag', from: me.clone(), knock: 9 });
          break;
        case 'grab':
          if (host.alive) {
            this.pinned = e.pin;
            this.pinBreak = e.freedByDamage;
            out.strikes.push({ damage: e.damage, source: 'grab', from: me.clone(), pin: e.pin });
          }
          break;
        default:
          break;
      }
    }
    b.events.length = 0;

    // Hymn rings expand along the floor; the host takes the hit once when the front passes unless airborne.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i], prev = r.r;
      r.r = Math.min(r.max, r.r + r.speed * dt);
      const hd = Math.hypot(host.x - r.x, host.z - r.z);
      if (!r.hit && host.alive && hd > prev && hd <= r.r && feet <= r.height) {
        r.hit = true;
        out.strikes.push({ damage: r.damage, source: 'hymn', from: new THREE.Vector3(r.x, host.y, r.z), knock: 4 });
      }
      if (r.r >= r.max) this.rings.splice(i, 1);
    }

    // The light pool floods the bowl floor (collapse, then everything on enrage); the ledge is safe.
    const pool = this.poolRadius;
    if (pool > 0 && host.alive && !this.arena.onLedge(host.x, host.z) && host.y - this.arena.floorY < 1.5
      && Math.hypot(host.x - this.arena.pool.x, host.z - this.arena.pool.z) <= Math.max(pool, this.arena.pool.radius)) {
      const f = (b.t.phases.find((p) => p.id === 'collapse')?.attacks as { lightFlood?: { damagePerSecond: number } } | undefined)?.lightFlood;
      if (f) out.strikes.push({ damage: f.damagePerSecond * dt, source: 'light pool', from: null });
    }
    return out;
  }

  /** Copies the brain's body and tells onto Creature's body. */
  private sync(): void {
    const b = this.brain, r = this.body.root, d = this.body.drive;
    r.position.set(b.body.x, this.ground(b.body.x, b.body.z), b.body.z);
    r.rotation.y = b.body.yaw;
    r.updateMatrixWorld(true);
    d.windup = b.windup;
    d.rear = b.rear;
    d.heartsOpen = b.heartsOpen;
    d.phase = b.phase.id as typeof d.phase;
    d.strike = b.strike ? (d.strike ?? new THREE.Vector3()).set(b.strike.x, this.ground(b.strike.x, b.strike.z), b.strike.z) : null;
    d.look = b.look ? (d.look ?? new THREE.Vector3()).set(b.look.x, b.look.y, b.look.z) : null;
  }
}
