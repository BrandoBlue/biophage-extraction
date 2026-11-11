import { RAID, ZONE7_SITES, layoutPosition, type Placement } from '../../data';
import { mulberry32 } from './rng';

/**
 * Zone 7 raid layout (World & Level). The island has a fixed catalogue of sites, all pre-shaped in the
 * terrain (data/zone7.json + RAID.larva); each raid's seed decides which of them are live:
 * which two Seed Spire pads open (and in which order), which Gene Blooms grow, where the anomaly sits.
 * Gameplay reads positions from here; it owns what happens at them.
 */

export interface Site { id: string; x: number; z: number }
export interface ExtractSite extends Site { label: string; opensAt: number }
export interface PodSite extends Site { type: string; guard?: string }
export interface NestSite extends Site { type: string }
export interface AnomalySite extends Site { kind: string; radius: number; gravityMultiplier: number }

export interface Zone7Layout {
  seed: number;
  spawn: Site;
  /** Live Seed Spires, in opening order. */
  extracts: ExtractSite[];
  /** Pads that stay dead this raid (dressed as broken spires so players learn the candidates). */
  dormantPads: Site[];
  pods: PodSite[];
  nests: NestSite[];
  /** Harvest nodes (Gene Blooms), opened like a container of type `geneBloom`. */
  nodes: Site[];
  anomaly: AnomalySite;
}

/** Walkable radius the layout is resolved against (same clamp the Raid uses). */
export const PLAYABLE = RAID.playableRadius;

const at = (p: Placement): [number, number] => layoutPosition(p, PLAYABLE);
const site = (id: string, p: Placement): Site => { const [x, z] = at(p); return { id, x, z }; };

/** Every site that ever exists, regardless of seed: the terrain is shaped for all of them. */
export const CATALOGUE = {
  spawn: site('spawn', RAID.spawn),
  pads: ZONE7_SITES.extractPool.map((p) => site(p.id, p)),
  pods: RAID.larva.containers.map((c, i) => ({ ...site(`${c.type}-${i}`, c), type: c.type, guard: c.guard })) as PodSite[],
  nests: RAID.larva.nests.map((n, i) => ({ ...site(`${n.type}-${i}`, n), type: n.type })) as NestSite[],
  blooms: ZONE7_SITES.geneBlooms.sites.map((p) => site(p.id, p)),
  anomalies: ZONE7_SITES.anomaly.sites.map((p) => site(p.id, p)),
  /** Enterable structures: the Hollow Spire tower and the Reliquary Bowl boss arena. */
  spire: { ...site('hollow-spire', ZONE7_SITES.structures.hollowSpire), yaw: deg(ZONE7_SITES.structures.hollowSpire.yaw), radius: ZONE7_SITES.structures.hollowSpire.footprint },
  debris: { ...site('long-seed-debris', ZONE7_SITES.structures.longSeedDebris), yaw: deg(ZONE7_SITES.structures.longSeedDebris.yaw), radius: ZONE7_SITES.structures.longSeedDebris.footprint },
  bowl: { ...site('reliquary-bowl', ZONE7_SITES.structures.reliquaryBowl), yaw: deg(ZONE7_SITES.structures.reliquaryBowl.yaw), radius: ZONE7_SITES.structures.reliquaryBowl.size, depth: ZONE7_SITES.structures.reliquaryBowl.depth },
};

function deg(d: number): number { return (d * Math.PI) / 180; }

const GRAVITY_BLOOM = RAID.host.anomalies.find((a) => a.id === ZONE7_SITES.anomaly.id);
const ANOMALY_GRAVITY = Number(GRAVITY_BLOOM?.effect.gravityMultiplier ?? 1);

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** The layout for one raid. Same seed, same raid. */
export function zone7Layout(seed: number): Zone7Layout {
  const rand = mulberry32(seed * 7919 + 17);
  const timing = RAID.larva.extracts;
  // Two spires, far enough apart that the late one is a real route change.
  const pairs: [Site, Site][] = [];
  for (const a of CATALOGUE.pads) for (const b of CATALOGUE.pads) {
    if (a !== b && Math.hypot(a.x - b.x, a.z - b.z) >= ZONE7_SITES.extractMinSeparation) pairs.push([a, b]);
  }
  const [first, second] = pairs[Math.floor(rand() * pairs.length)];
  const extracts = [first, second].slice(0, timing.length).map((p, i) => ({ ...p, label: timing[i].label, opensAt: timing[i].opensAt }));
  const nodes = shuffle(CATALOGUE.blooms, rand).slice(0, ZONE7_SITES.geneBlooms.perRaid);
  const an = CATALOGUE.anomalies[Math.floor(rand() * CATALOGUE.anomalies.length)];
  return {
    seed,
    spawn: CATALOGUE.spawn,
    extracts,
    dormantPads: CATALOGUE.pads.filter((p) => !extracts.some((e) => e.id === p.id)),
    pods: CATALOGUE.pods,
    nests: CATALOGUE.nests,
    nodes,
    anomaly: { ...an, kind: ZONE7_SITES.anomaly.id, radius: ZONE7_SITES.anomaly.size, gravityMultiplier: ANOMALY_GRAVITY },
  };
}

/**
 * Gravity scale at (x, z): the anomaly's multiplier in its core, easing back to 1 at its edge.
 * The player controller multiplies its gravity by this.
 */
export function gravityAt(layout: Zone7Layout, x: number, z: number): number {
  const a = layout.anomaly;
  const d = Math.hypot(x - a.x, z - a.z) / a.radius;
  if (d >= 1) return 1;
  const k = d < 0.6 ? 1 : 1 - (d - 0.6) / 0.4;
  return 1 + (a.gravityMultiplier - 1) * k * k * (3 - 2 * k);
}
