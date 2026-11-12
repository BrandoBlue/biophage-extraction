/**
 * Reinforcements in zones that place their own creatures (the Marrow Pit): one more of a species that lives there,
 * walking out of its own home on the host's level (never a layer above or below), out of the host's view, between
 * `min` and `ai.json reinforce.maxDistance` away. No generic wave kinds appear on the rim.
 */
import { AI } from '../../data';

export interface HomeSpot { kind: string; x: number; z: number }

export function pickReinforcement<T extends HomeSpot>(
  homes: readonly T[], host: { x: number; y: number; z: number }, fwd: { x: number; z: number }, min: number,
  ground: (x: number, z: number) => number, R = AI.reinforce,
): T | null {
  let best: T | null = null, bestD = Infinity;
  for (const s of homes) {
    const dx = s.x - host.x, dz = s.z - host.z, d = Math.hypot(dx, dz);
    if (d < min || d > R.maxDistance || d >= bestD) continue;
    if (Math.abs(ground(s.x, s.z) - host.y) > R.sameLevel) continue;
    if (d < 60 && (dx * fwd.x + dz * fwd.z) / (d || 1) > 0.5) continue; // in front of the host: it would see it appear
    best = s; bestD = d;
  }
  return best;
}
