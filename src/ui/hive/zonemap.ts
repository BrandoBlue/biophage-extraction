/**
 * Raid-select map discs, one per zone, read from World's layout data (the same files the zones are built from), so the
 * map a player studies is the map they drop into. Positions are metres: +x east, +z south (north is up on the disc).
 * Zones without a layout yet draw as an uncharted disc.
 */
import { BOSSES, RAID, ZONES, ZONE_SITES, layoutPosition } from '../../../data';
import OCHRE_MAP from '../../../data/ochre.json';
import FEN_MAP from '../../../data/weepingfen.json';
import { FAUNA, OCHRE, ORGANIC, ZONE7, ZONE7_SHADE } from '../../render/palette';

export type MapShape = 'isle' | 'desert' | 'fen' | 'pit' | 'hull' | 'uncharted';
export interface MapMark { kind: 'extract' | 'drop' | 'boss' | 'nest' | 'pod' | 'site'; x: number; z: number; label: string; opensAt?: number | null; guard?: boolean; r?: number }
export interface ZoneMap {
  id: string;
  shape: MapShape;
  /** Metres from the centre to the disc rim. */
  radius: number;
  marks: MapMark[];
  /** Pit depth layers: ring radius (m) and name, outermost first. */
  layers?: { r: number; label: string }[];
  /** Wreck rooms (m), drawn as the hull plan. */
  rooms?: { x0: number; x1: number; z0: number; z1: number; label: string }[];
  /** Two tones for the ground (centre, edge) and one for its texture. */
  tone: [string, string, string];
}

const words = (id: string) => id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const polar = (bearing: number, radius: number): [number, number] => [Math.cos((bearing * Math.PI) / 180) * radius, Math.sin((bearing * Math.PI) / 180) * radius];

type XZ = { x: number; z: number };
interface Exit { label: string; opensAt?: number | null }

function bossMark(zone: string, at: XZ | null): MapMark[] {
  const id = ZONES[zone]?.boss;
  return id && at ? [{ kind: 'boss', x: at.x, z: at.z, label: (BOSSES[id]?.label ?? words(id)).replace(/^The /, '').toUpperCase() }] : [];
}

export function zoneMap(id: string): ZoneMap {
  if (id === 'glowmireIsle') {
    const at = (p: { radius: number; bearing: number }) => { const [x, z] = layoutPosition(p); return { x, z }; };
    const extracts = RAID.larva?.extracts ?? [{ label: RAID.extract.label, radius: RAID.extract.radius, bearing: RAID.extract.bearing, opensAt: 0 }];
    return {
      id, shape: 'isle', radius: RAID.playableRadius, tone: [ZONE7_SHADE.moss, ZONE7_SHADE.rockDeep, ORGANIC.mist],
      marks: [
        ...(RAID.larva?.containers ?? RAID.containers).map((c): MapMark => ({ kind: 'pod', ...at(c), label: '', guard: !!(c as { guard?: unknown }).guard })),
        ...(RAID.larva?.nests ?? []).map((n): MapMark => ({ kind: 'nest', ...at(n), label: 'BROOD HEART' })),
        ...extracts.map((e): MapMark => ({ kind: 'extract', ...at(e), label: e.label, opensAt: e.opensAt })),
        { kind: 'drop', ...at(RAID.spawn), label: 'DROP' },
      ],
    };
  }
  if (id === 'ochreReach') {
    const m = OCHRE_MAP as unknown as { playableRadius: number; spawn: XZ; extracts: (XZ & Exit)[]; landmarks: Record<string, XZ & { radius: number }> };
    const lm = Object.entries(m.landmarks).filter(([k]) => !k.startsWith('_'));
    return {
      id, shape: 'desert', radius: m.playableRadius, tone: [OCHRE.sand, OCHRE.clayDark, OCHRE.dust],
      marks: [
        ...lm.map(([k, l]): MapMark => ({ kind: 'site', x: l.x, z: l.z, r: l.radius, label: words(k) })),
        ...bossMark(id, m.landmarks.skyfallCrater ?? null),
        ...m.extracts.map((e): MapMark => ({ kind: 'extract', x: e.x, z: e.z, label: e.label, opensAt: e.opensAt })),
        { kind: 'drop', ...m.spawn, label: 'DROP' },
      ],
    };
  }
  if (id === 'weepingFen') {
    const m = FEN_MAP as unknown as { radius: number; spawn: XZ; extracts: (XZ & Exit)[]; areas: (XZ & { id: string; label: string; radius: number })[]; regentPool: XZ };
    return {
      id, shape: 'fen', radius: m.radius, tone: [FAUNA.fenMoss, FAUNA.peat, FAUNA.water],
      marks: [
        ...m.areas.filter((a) => a.id !== 'fenLanding').map((a): MapMark => ({ kind: 'site', x: a.x, z: a.z, r: a.radius, label: a.label.replace(/^The /, '') })),
        ...bossMark(id, m.regentPool),
        ...m.extracts.map((e): MapMark => ({ kind: 'extract', x: e.x, z: e.z, label: e.label, opensAt: e.opensAt })),
        { kind: 'drop', ...m.spawn, label: 'DROP' },
      ],
    };
  }
  if (id === 'marrowPit') {
    const m = ZONE_SITES.marrowPit as unknown as { outerRadius: number; playableRadius: number; spawn: { bearing: number; radius: number };
      layers: { label: string; edge?: number }[]; extracts: (Exit & { bearing: number; radius: number; opensOn?: string })[] };
    const at = (b: number, r: number) => { const [x, z] = polar(b, r); return { x, z }; };
    return {
      id, shape: 'pit', radius: m.playableRadius, tone: [ZONE7_SHADE.rock, FAUNA.soot, FAUNA.sickGreen],
      layers: m.layers.map((l, i) => ({ r: l.edge ?? m.layers[i - 1]?.edge! * 0.5, label: l.label })),
      marks: [
        ...bossMark(id, { x: 0, z: 0 }),
        ...m.extracts.map((e): MapMark => ({ kind: 'extract', ...at(e.bearing, e.radius), label: e.label, opensAt: e.opensOn ? null : e.opensAt })),
        { kind: 'drop', ...at(m.spawn.bearing, m.spawn.radius), label: 'DROP' },
      ],
    };
  }
  if (id === 'longSeedWreck') {
    const m = ZONE_SITES.longSeedWreck as unknown as { hull: { halfLength: number }; spawn: XZ; extracts: (XZ & Exit)[]; rooms: { id: string; x0: number; x1: number; z0: number; z1: number }[] };
    const reactor = m.rooms.find((r) => r.id === 'reactorChamber');
    return {
      id, shape: 'hull', radius: m.hull.halfLength * 1.3, tone: [ZONE7_SHADE.stem, ZONE7_SHADE.rockDeep, ORGANIC.amber],
      rooms: m.rooms.map((r) => ({ ...r, label: words(r.id) })),
      marks: [
        ...bossMark(id, reactor ? { x: (reactor.x0 + reactor.x1) / 2, z: (reactor.z0 + reactor.z1) / 2 } : null),
        ...m.extracts.map((e): MapMark => ({ kind: 'extract', x: e.x, z: e.z, label: e.label, opensAt: e.opensAt })),
        { kind: 'drop', ...m.spawn, label: 'DROP' },
      ],
    };
  }
  return { id, shape: 'uncharted', radius: 100, tone: [ZONE7_SHADE.planet, ZONE7.void, ORGANIC.mist], marks: [] };
}

/** Extract count and their names, from the map when it has them, else from Design's zone text. */
export function zoneExtracts(id: string): { count: number; later: MapMark[] } {
  const ex = zoneMap(id).marks.filter((m) => m.kind === 'extract');
  if (ex.length) return { count: ex.length, later: ex.filter((e) => e.opensAt !== 0) };
  const text = String(ZONES[id]?.extracts ?? '');
  const n = ['one', 'two', 'three', 'four', 'five'].indexOf(text.split(/[:\s]/)[0]?.toLowerCase() ?? '') + 1;
  return { count: n, later: [] };
}
