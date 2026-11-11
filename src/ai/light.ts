/** Host visibility ("light"): how far away and how fast creatures can see the host. Pure, unit-tested. */
import { AI } from '../../data';

export interface VisibilityInput {
  moving: boolean;
  sprinting: boolean;
  crouched: boolean;
  /** Seconds since the host last fired (Infinity if never). Muzzle flashes light the host up. */
  sinceShot: number;
  /** Virus multiplier on visibility (Plague-Stalker glowing footprints: 1.5). */
  virus: number;
}

export function hostVisibility(i: VisibilityInput, L = AI.light): number {
  let v = L.base;
  if (i.crouched) v *= L.crouched;
  else if (i.sprinting) v *= L.sprinting;
  else if (!i.moving) v *= L.still;
  // Glowing prints only show when you leave them, but a lit host is lit either way.
  if (i.moving) v *= i.virus;
  if (i.sinceShot < L.flashTime) v = Math.max(v, L.muzzleFlash * (1 - i.sinceShot / L.flashTime) + v * (i.sinceShot / L.flashTime));
  return Math.max(L.minimum, v);
}
