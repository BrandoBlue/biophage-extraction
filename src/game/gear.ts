/**
 * Flesh Market gear used in raid (data/market.json contraband): the Neuro-Spike Grenade (thrown, bounces, fuses),
 * the Maw-Seed Mine (placed, arms, roots and bites), and melee timing. Pure logic over plain vectors so it is
 * unit-tested; Raid owns the meshes, damage and events.
 */
import { MARKET } from '../../data';

export interface V3 { x: number; y: number; z: number }

export interface GrenadeRules { fuse: number; radius: number; damage: number; overload: number }
export interface MineRules { armTime: number; triggerRadius: number; damage: number; root: number }
export interface HuskRules { reviveDelay: number; reviveFraction: number }

export const grenadeRules = (): GrenadeRules => MARKET.contraband.neuroSpikeGrenade as unknown as GrenadeRules;
export const mineRules = (): MineRules => MARKET.contraband.mawSeedMine as unknown as MineRules;
export const huskRules = (): HuskRules => MARKET.contraband.heartHusk as unknown as HuskRules;

const GRAVITY = 14;
const BOUNCE = 0.35;
const FRICTION = 0.6;

/** A thrown grenade: ballistic arc, damped bounces off the ground, explodes when the fuse runs out. */
export class Grenade {
  left: number;
  constructor(public pos: V3, public vel: V3, readonly r: GrenadeRules = grenadeRules()) { this.left = r.fuse; }

  /** Steps the flight. Returns true on the frame it explodes. */
  update(dt: number, ground: (x: number, z: number) => number): boolean {
    this.vel.y -= GRAVITY * dt;
    this.pos.x += this.vel.x * dt; this.pos.y += this.vel.y * dt; this.pos.z += this.vel.z * dt;
    const g = ground(this.pos.x, this.pos.z) + 0.08;
    if (this.pos.y < g) {
      this.pos.y = g;
      this.vel.y = Math.abs(this.vel.y) * BOUNCE;
      this.vel.x *= FRICTION; this.vel.z *= FRICTION;
    }
    this.left -= dt;
    return this.left <= 0;
  }

  /** Damage at distance d: full at the centre, half at the edge, none outside. */
  damageAt(d: number): number { return d > this.r.radius ? 0 : this.r.damage * (1 - 0.5 * (d / this.r.radius)); }
}

/** A placed mine: arms after `armTime`, then triggers once on the first target inside `triggerRadius`. */
export class Mine {
  armLeft: number;
  spent = false;
  constructor(readonly pos: V3, readonly r: MineRules = mineRules()) { this.armLeft = r.armTime; }
  get armed(): boolean { return this.armLeft <= 0 && !this.spent; }

  /** Returns the index of the target that set it off, or -1. */
  update(dt: number, targets: V3[]): number {
    if (this.spent) return -1;
    if (this.armLeft > 0) { this.armLeft -= dt; return -1; }
    const i = targets.findIndex((t) => Math.hypot(t.x - this.pos.x, t.z - this.pos.z) <= this.r.triggerRadius);
    if (i >= 0) this.spent = true;
    return i;
  }
}

/** Throw velocity along a look direction with a little loft. */
export function throwVelocity(dir: V3, speed = 16, loft = 4): V3 {
  return { x: dir.x * speed, y: dir.y * speed + loft, z: dir.z * speed };
}
