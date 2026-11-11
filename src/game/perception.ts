/** Perception rules shared by gameplay and (from wave 2) src/ai. Pure functions, unit-tested. */
import type { Perception } from '../../data';

export interface Noise { x: number; z: number; radius: number }

/** Can a creature at (cx, cz) facing `yaw` see a target at (tx, tz)? Yaw 0 faces +Z. No occlusion in Spore. */
export function sees(p: Perception, cx: number, cz: number, yaw: number, tx: number, tz: number, sightScale = 1): boolean {
  const dx = tx - cx, dz = tz - cz;
  const d = Math.hypot(dx, dz);
  if (d > p.sight * sightScale) return false;
  if (p.fov >= 360 || d < 0.001) return true;
  let a = Math.atan2(dx, dz) - yaw;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) <= (p.fov * Math.PI) / 360;
}

/** A creature hears a noise if it is inside the noise's radius and within its own hearing range. */
export function hears(p: Perception, cx: number, cz: number, n: Noise): boolean {
  const d = Math.hypot(n.x - cx, n.z - cz);
  return d <= n.radius && d <= Math.max(p.hearing, n.radius * 0.5);
}

/** Footstep noise radius for the host this frame. */
export function footstepRadius(o: { moving: boolean; sprinting: boolean; crouched: boolean; classNoise: number; walk: number; sprint: number }): number {
  if (!o.moving) return 0;
  const base = o.sprinting ? o.sprint : o.walk;
  return base * o.classNoise * (o.crouched ? 0.5 : 1);
}

