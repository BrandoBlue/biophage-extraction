/**
 * Interim habitat areas for Zone 7, read off what World has already built (the giant-fungus groves, the liquid-light
 * pools, the Hollow Spire and Long Seed debris, the Brood Heart craters, and open ground clear of all of them).
 * World's landscape PR adds `habitats` to the layout from data/zone7.json; the raid prefers that list and this goes.
 */
import type { Habitat } from '../ai/habitats';
import type { Zone7Layout } from '../world/layout';
import { CATALOGUE } from '../world/layout';
import { BOWL, CRATERS, POOLS, isReserved } from '../world/zone7';

/** Grove centres from zone7.ts buildZone7 (giant-fungus stands flanking the spawn-to-extract route). */
const GROVES: [number, number][] = [[-30, 75], [10, 70], [-5, 25], [40, 35], [-10, -40], [30, -70], [60, -95]];

export function interimHabitats(layout: Zone7Layout & { habitats?: Habitat[] }, playable: number): Habitat[] {
  if (layout.habitats?.length) return layout.habitats;
  if (layout.area) return []; // not the island (the Wreck): raid.json placement until World names its rooms
  const out: Habitat[] = [];
  GROVES.forEach(([x, z], i) => out.push({ id: `grove-${i}`, tag: 'grove', x, z, radius: 12 }));
  POOLS.forEach((p, i) => out.push({ id: `pool-${i}`, tag: 'pool', x: p.x, z: p.z, radius: p.radius + 6 }));
  for (const s of [CATALOGUE.spire, CATALOGUE.debris]) out.push({ id: s.id, tag: 'interior', x: s.x, z: s.z, radius: s.radius * 0.8 });
  CRATERS.forEach((c) => out.push({ id: c.name, tag: 'crater', x: c.x, z: c.z, radius: c.radius * 1.6 }));
  // Open ground: well clear of groves, structures, pools, craters and the bowl, spread out across the island.
  const busy = [...GROVES.map(([x, z]) => ({ x, z, r: 22 })), ...[CATALOGUE.spire, CATALOGUE.debris].map((s) => ({ x: s.x, z: s.z, r: s.radius + 15 })), { x: BOWL.x, z: BOWL.z, r: BOWL.radius * 1.3 }];
  const open: { x: number; z: number }[] = [];
  for (let r = playable * 0.3; r <= playable * 0.75; r += playable * 0.15) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (isReserved(x, z, 12) || busy.some((b) => Math.hypot(x - b.x, z - b.z) < b.r)) continue;
      if (open.some((o) => Math.hypot(x - o.x, z - o.z) < 45)) continue;
      open.push({ x, z });
    }
  }
  open.forEach((o, i) => out.push({ id: `open-${i}`, tag: 'open', x: o.x, z: o.z, radius: 14 }));
  return out;
}
