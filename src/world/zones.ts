import type * as THREE from 'three';
import { ZONE7_SITES } from '../../data';
import { CATALOGUE, zone7Layout } from './layout';
import { buildZone7, setTerrain, type Zone7World } from './zone7';
import { buildWreck } from './wreck';
import { buildOchre } from './ochre';
import { buildPit } from './pit';
import { buildWeepingFen } from './weepingfen';

/**
 * Zone registry (World & Level). Each raid map is built from its zone id (Design's data/zones.json ids; geometry in
 * data/zone7.json under the same id). main.ts builds the profile's chosen zone once at boot.
 */
export type ZoneId = 'glowmireIsle' | 'longSeedWreck' | string;

export interface ZoneWorld extends Zone7World {
  /** The zone actually built (an unbuilt zone falls back to glowmireIsle). */
  zone: ZoneId;
  /** The landmark (zones.json id) whose area contains (x, z), or null. `y` (feet) separates stacked places (the pit). */
  landmarkAt(x: number, z: number, y?: number): string | null;
}

/** Zones whose maps exist. */
export const BUILT_ZONES: ZoneId[] = ['glowmireIsle', 'longSeedWreck', 'ochreReach', 'marrowPit', 'weepingFen'];

/** Landmark areas of Glowmire Isle, resolved to world positions. */
export function glowmireLandmarks(): { id: string; x: number; z: number; radius: number }[] {
  const sites: Record<string, { x: number; z: number }> = {
    hollowSpire: CATALOGUE.spire, reliquaryBowl: CATALOGUE.bowl, longSeedDebris: CATALOGUE.debris,
    ...Object.fromEntries(CATALOGUE.pads.map((p) => [p.id, p])),
  };
  return Object.entries(ZONE7_SITES.landmarks)
    .filter(([id, l]) => id !== '_note' && sites[l.site])
    .map(([id, l]) => ({ id, x: sites[l.site].x, z: sites[l.site].z, radius: l.radius }));
}

export function buildZone(scene: THREE.Scene, zone: ZoneId, seed: number): ZoneWorld {
  if (zone === 'longSeedWreck') {
    setTerrain(null);
    const w = buildWreck(scene, seed);
    return { layout: w.layout, sites: w.sites, structures: w.structures, zone, landmarkAt: w.landmarkAt };
  }
  if (zone === 'ochreReach') {
    const w = buildOchre(scene, seed);
    return { layout: w.layout, sites: w.sites, structures: w.structures, zone, landmarkAt: w.landmarkAt };
  }
  if (zone === 'marrowPit') {
    const w = buildPit(scene, seed);
    return { layout: w.layout, sites: w.sites, structures: w.structures, zone, landmarkAt: w.landmarkAt };
  }
  if (zone === 'weepingFen') {
    const w = buildWeepingFen(scene, seed);
    return { layout: w.layout, sites: w.sites, structures: w.structures, zone, landmarkAt: w.landmarkAt };
  }
  if (!BUILT_ZONES.includes(zone)) console.warn(`zone ${zone} has no map yet; building glowmireIsle`);
  setTerrain(null);
  const world = buildZone7(scene, zone7Layout(seed));
  const marks = glowmireLandmarks();
  return {
    ...world,
    zone: 'glowmireIsle',
    landmarkAt(x, z) {
      let best: string | null = null, bd = Infinity;
      for (const m of marks) { const d = Math.hypot(x - m.x, z - m.z); if (d <= m.radius && d < bd) { bd = d; best = m.id; } }
      return best;
    },
  };
}
