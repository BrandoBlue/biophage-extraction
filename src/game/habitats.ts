/**
 * Creature habitats (Design's data/habitats.json): every species lives somewhere that fits it, and nothing spawns
 * at random. This turns a habitat `where` (landmark, room, biome, nearExtract, guards, band) into a home point on
 * the built map, and plans the raid's opening population from it. Pure: the Raid places the bodies and PvE AI's
 * `setHome` keeps them there.
 */
import { HABITATS, RAID, ZONE_SITES, habitatGroups, layoutPosition, type HabitatGroup, type HabitatWhere } from '../../data';
import { glowmireLandmarks } from '../world/zones';
import { CURRENT_MILESTONE } from './economy';

export interface HabitatMap {
  zone: string;
  /** Walkable radius the band fractions are measured against. */
  playable: number;
  extract: { x: number; z: number };
  /** Container positions by container type, for `guards`. */
  pods: { type: string; x: number; z: number }[];
  rand: () => number;
}

export interface Home { x: number; z: number; spread: number }

interface Rect { id: string; x0: number; x1: number; z0: number; z1: number }
const wreckRooms = (): Rect[] => ((ZONE_SITES.longSeedWreck as { rooms?: Rect[] }).rooms ?? []);

/** A point for one `where`, or null when the map does not have that place (then the group's fallback is tried). */
export function resolveWhere(w: HabitatWhere, m: HabitatMap, index = 0): Home | null {
  const r = m.rand;
  if ('landmark' in w) {
    const l = m.zone === 'glowmireIsle' ? glowmireLandmarks().find((x) => x.id === w.landmark) : undefined;
    return l ? { x: l.x, z: l.z, spread: l.radius * 0.5 } : null;
  }
  if ('room' in w) {
    const room = wreckRooms().find((x) => x.id === w.room);
    if (!room || m.zone !== 'longSeedWreck') return null;
    return { x: (room.x0 + room.x1) / 2, z: (room.z0 + room.z1) / 2, spread: Math.min(room.x1 - room.x0, room.z1 - room.z0) * 0.35 };
  }
  if ('biome' in w) {
    const b = RAID.host?.biomes.find((x) => x.id === w.biome);
    if (!b || m.zone !== 'expanse') return null;
    const [x, z] = layoutPosition(b, m.playable);
    return { x, z, spread: m.playable * 0.08 };
  }
  if ('nearExtract' in w) {
    const a = r() * Math.PI * 2, d = 8 + r() * 8;
    return { x: m.extract.x + Math.cos(a) * d, z: m.extract.z + Math.sin(a) * d, spread: 4 };
  }
  if ('guards' in w) {
    const pods = m.pods.filter((p) => p.type === w.guards);
    if (!pods.length) return null;
    const p = pods[index % pods.length], a = r() * Math.PI * 2;
    return { x: p.x + Math.cos(a) * 5, z: p.z + Math.sin(a) * 5, spread: 2 };
  }
  if ('band' in w) {
    if (m.zone !== 'glowmireIsle') return null;
    const [r0, r1] = w.band.radius, [b0, b1] = w.band.bearing;
    const [x, z] = layoutPosition({ radius: r0 + r() * (r1 - r0), bearing: b0 + r() * (b1 - b0) }, m.playable);
    return { x, z, spread: 0 };
  }
  return null;
}

export interface PlannedGroup { kind: string; group: HabitatGroup; home: Home; roam: number }

/** Every habitat group of this zone and milestone with its home point. Groups whose place is not built are dropped. */
export function planHabitats(m: HabitatMap, milestone: string = CURRENT_MILESTONE): PlannedGroup[] {
  const out: PlannedGroup[] = [];
  const zone = HABITATS.zones[m.zone];
  if (!zone) return out;
  for (const kind of Object.keys(zone)) {
    const h = zone[kind];
    if (!h) continue;
    for (const g of habitatGroups(m.zone, kind, milestone)) {
      for (let i = 0; i < g.count; i++) {
        const home = resolveWhere(g.where, m, i) ?? (g.fallback ? resolveWhere(g.fallback, m, i) : null);
        if (home) out.push({ kind, group: g, home: { ...home, spread: g.spread ?? home.spread }, roam: h.roam });
      }
    }
  }
  return out;
}

/** Whether this zone places its creatures from habitats (no random spawns). */
export const usesHabitats = (zone: string): boolean => !!HABITATS.zones[zone] && HABITATS.rules?.noRandomSpawns !== false;
