/**
 * Audio director logic (pure, unit-tested): how scared the music should be, when a footstep lands, what the ground
 * is made of. No Web Audio here so Vitest can run it in Node.
 */
import { AUDIO, type Weight } from './config';
import type { Surface } from './sfx';

export interface Threat { x: number; z: number; engaged: boolean }

/**
 * Raw danger 0..1 from creatures around the listener: engaged ones count most, the closer the more; idle ones nearby
 * add a little unease. Several hunters stack.
 */
export function threatLevel(threats: Threat[], x: number, z: number, radius = AUDIO.music.threatRadius): number {
  let sum = 0;
  for (const t of threats) {
    const d = Math.hypot(t.x - x, t.z - z);
    if (d > radius * (t.engaged ? 1.5 : 1)) continue;
    const near = 1 - Math.min(1, d / (radius * (t.engaged ? 1.5 : 1)));
    sum += t.engaged ? 0.45 + 0.45 * near : 0.12 * near;
  }
  return Math.min(1, sum);
}

/** Intensity follower: rises fast when danger appears, drains slowly after it is gone. */
export class Intensity {
  value = 0;
  private bump = 0;
  /** A sudden scare (being hit) pushes intensity up for a while. */
  kick(amount = AUDIO.music.damageBump): void { this.bump = Math.min(1, this.bump + amount); }
  update(dt: number, target: number): number {
    const M = AUDIO.music;
    this.bump = Math.max(0, this.bump - dt * 0.08);
    const want = Math.min(1, Math.max(target, this.bump));
    this.value += want > this.value ? Math.min(want - this.value, M.rise * dt) : -Math.min(this.value - want, M.fall * dt);
    return this.value;
  }
}

/** Counts stride distance and says when a foot lands. */
export class Stride {
  private travelled = 0;
  update(distance: number, weight: Weight, sprinting: boolean, grounded: boolean): boolean {
    if (!grounded) { this.travelled = 0; return false; }
    const F = AUDIO.footsteps;
    this.travelled += distance;
    const len = F.stride[weight] * (sprinting ? F.sprintStride : 1);
    if (this.travelled < len) return false;
    this.travelled -= len;
    if (this.travelled > len) this.travelled = 0;
    return true;
  }
}

/** Footstep level for the host's weight and stance (crouching is how you sneak). */
export function stepLevel(weight: Weight, crouched: boolean, sprinting: boolean): number {
  const F = AUDIO.footsteps;
  return F.level[weight] * (crouched ? F.crouchLevel : 1) * (sprinting ? 1.25 : 1);
}

/** What the ground is made of, from the zone and whether the host is indoors / underground. */
export function surfaceFor(zone: string, enclosed: boolean): Surface {
  const z = zone.toLowerCase();
  if (/wreck|hull|ship/.test(z)) return enclosed ? 'metal' : 'stone';
  if (/ochre|desert|sand|dune|savann?ah?|waste/.test(z)) return enclosed ? 'stone' : 'sand';
  if (/pit|abyss/.test(z)) return 'stone';
  if (/fen$|fen[^a-z]|swamp|bog|weeping/.test(z)) return enclosed ? 'moss' : 'water';
  return enclosed ? 'stone' : 'moss';
}

/** Host class weight → footstep and landing character. */
export function weightOf(classId: string): Weight {
  if (classId === 'venomWraith') return 'light';
  if (classId === 'goreBehemoth') return 'heavy';
  return 'medium';
}

/** True when a creature at (cx, cz) is behind the listener looking along (fx, fz) and inside `radius`. */
export function behind(cx: number, cz: number, x: number, z: number, fx: number, fz: number, radius: number): boolean {
  const dx = cx - x, dz = cz - z, d = Math.hypot(dx, dz);
  if (d > radius || d < 0.01) return false;
  return (dx * fx + dz * fz) / (d * (Math.hypot(fx, fz) || 1)) < -0.3;
}
