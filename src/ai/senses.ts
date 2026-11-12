/**
 * Awareness: a 0..1 meter fed by sight (scaled by host visibility, distance and where in the field of view the host
 * is) and by noise (scaled by how deep inside the noise radius the creature stands). Suspicious creatures turn toward
 * and walk to the stimulus; at 1 they hunt. This gives the host a readable window: a head snap and a chirp before the
 * charge, and a way to break contact by crouching out of sight.
 */
import { AI, type Perception } from '../../data';
import type { HostView, Vec2 } from './types';
import type { Noise } from '../game/perception';

export interface SenseResult {
  /** The host itself was seen this sense tick. */
  sawHost: boolean;
  /** Something was heard; `heardAt` is the loudest noise position. */
  heard: boolean;
  heardAt: Vec2 | null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Distance for the senses, with height: a few metres of slope are free, but a sheer drop (the Marrow Pit's layers,
 * a cliff) counts `verticalWeight` times over, since rock and shelf edges block the view and the sound.
 */
export function reach3(d: number, dy: number, A = AI.awareness): number {
  const v = Math.max(0, Math.abs(dy) - (A.verticalFree ?? Infinity)) * (A.verticalWeight ?? 1);
  return v > 0 ? Math.hypot(d, v) : d;
}

/** Sight fill rate per second for this host, or 0 if not visible. Yaw 0 faces +Z. */
export function sightRate(p: Perception, cx: number, cz: number, yaw: number, host: HostView, A = AI.awareness, cy = host.y): number {
  const dx = host.x - cx, dz = host.z - cz;
  const d = reach3(Math.hypot(dx, dz), host.y - cy, A);
  if (d <= A.closeSight) return A.sightRate * 4; // you can feel it breathing on you
  const range = p.sight * host.visibility;
  if (d > range) return 0;
  let edge = 0;
  if (p.fov < 360) {
    const half = (p.fov * Math.PI) / 360;
    const a = Math.abs(wrap(Math.atan2(dx, dz) - yaw));
    if (a > half) return 0;
    edge = a / half;
  }
  const falloff = 1 - d / range;
  const peripheral = edge > 0.5 ? A.peripheralFactor : 1;
  return A.sightRate * host.visibility * (0.25 + falloff) * peripheral;
}

/** Awareness gain from one noise, or 0 if out of earshot. */
export function noiseGain(p: Perception, cx: number, cz: number, n: Noise, A = AI.awareness, dy = 0): number {
  const d = reach3(Math.hypot(n.x - cx, n.z - cz), dy, A);
  const reach = Math.max(p.hearing, n.radius * 0.5);
  if (d > n.radius || d > reach) return 0;
  const depth = 1 - d / n.radius;
  return depth > 0.5 ? A.loudNoiseGain : A.noiseGain * (0.4 + depth);
}

export class Awareness {
  level = 0;
  /** Where the creature believes the host is. */
  lastKnown: Vec2 | null = null;
  /** Seconds since the host was last seen. */
  sinceSeen = Infinity;
  private acc = Math.random();
  private heardMax = 0;
  private heardAt: Vec2 | null = null;

  constructor(readonly p: Perception, private A = AI.awareness) {}

  /**
   * Hearing runs every frame (raid noises live for one frame); sight runs at `senseHz`, staggered per creature.
   * Each sense tick turns the loudest noise heard since the last tick into one impulse of awareness, so a gunshot
   * makes a creature suspicious and two or three bring it running. Returns null on frames with no sense tick.
   */
  update(dt: number, cx: number, cz: number, yaw: number, host: HostView, noises: readonly Noise[], cy = host.y): SenseResult | null {
    this.sinceSeen += dt;
    if (host.alive && !host.hidden) {
      for (const n of noises) {
        const g = noiseGain(this.p, cx, cz, n, this.A, host.y - cy); // raid noises are the host's: they carry its height
        if (g > this.heardMax) { this.heardMax = g; this.heardAt = { x: n.x, z: n.z }; }
      }
    }
    this.acc += dt * this.A.senseHz;
    if (this.acc < 1) return null;
    const step = Math.min(this.acc, 3) / this.A.senseHz;
    this.acc = 0;
    const res: SenseResult = { sawHost: false, heard: this.heardMax > 0, heardAt: this.heardAt };
    let gained = this.heardMax * this.A.noiseImpulse;
    if (host.alive && !host.hidden) {
      const s = sightRate(this.p, cx, cz, yaw, host, this.A, cy);
      if (s > 0) {
        gained += s * step;
        res.sawHost = true;
        this.sinceSeen = 0;
        this.lastKnown = { x: host.x, z: host.z };
      }
    }
    if (res.heard && !res.sawHost && this.heardAt) this.lastKnown = this.heardAt;
    this.heardMax = 0; this.heardAt = null;
    if (gained > 0) this.level = Math.min(1, this.level + gained);
    else this.level = Math.max(0, this.level - this.A.decayRate * step);
    return res;
  }

  /** Told by a packmate, a screech or a wound: full awareness. */
  alert(at: Vec2 | null): void {
    this.level = 1;
    if (at) this.lastKnown = { x: at.x, z: at.z };
  }

  get suspicious(): boolean { return this.level >= this.A.suspicious; }
  get hunting(): boolean { return this.level >= 1; }
}
