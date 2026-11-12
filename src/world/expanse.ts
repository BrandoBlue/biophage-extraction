import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HIVE, ORGANIC, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, chitin, liquidLight, livingFlesh, zoneRock } from '../render/materials';
import { floatingIslandGeometry, ISLAND_TOP } from '../render/geometry';
import { planet, sporeField, starField, zone7Sky } from '../render/sky';
import { horizonLands } from '../render/horizon';
import { groundCover } from '../render/cover';
import { RAID, layoutPosition } from '../../data';
import DATA from '../../data/expanse.json';
import { mulberry32 } from './rng';
import { terrainTiles } from './terrain';
import { roughen } from './organic';
import { Kit, hollowSpire, longSeedDebris, oldBone, rootSkirt, type BuiltStructures, type LootSpot } from './structures';
import { buildSites, clearings, type SiteDressing } from './sites';
import type { ExtractSite, PodSite, Zone7Layout } from './layout';
import { SOLIDS, fall, fungusMeshes, scatterFungi, setTerrain, type Fungus } from './zone7';

/**
 * The Expanse (World & Level): the full 1 km of Zone 7, Design's Host raid (data/raid.json `host`, zones.json
 * `expanse`). Five biomes round the map, each shaped into the ground rather than scattered on it:
 *  - Glowmire Flats (centre-north): a low marsh basin with liquid-light pools and giant fungi, the drop zone.
 *  - Chitin Spires (north-east): a raised plateau forested with grown chitin towers and three Hollow Spires.
 *  - Wreck of the Long Seed (south): the seedship's furrow ploughed through the plain, the split hull at its end.
 *  - Choir Chasm (west): a 90 m rift with floating islands, liquid-light falls and two bone bridges.
 *  - Brood Hollow (north-west): a fleshy crater field with two Brood Hearts round a tall stalk.
 * A rim of ridges closes the map beyond the playable radius. Geometry lives in data/expanse.json; biome positions,
 * extracts and rival spawns come from Design's raid.json `host`.
 *
 * Frame: +x east, +z south (bearing 0 is north). The ground is one height function (setTerrain) so the player,
 * creatures, loot and the mesh agree; the chasm walls are steeper than maxSlope, so they block walking up, and a
 * lip of chitin teeth (colliders) keeps hosts from stepping off the edge. Both chasm ends ramp down to its floor.
 */

type Pt = { x: number; z: number };
const H = RAID.host;
export const EXPANSE = DATA;
const D = DATA;
/** Playable radius (Design: 500 m). */
export const EXPANSE_RADIUS = H.playableRadius;

const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
const deg = (d: number) => (d * Math.PI) / 180;
const biome = (id: string): Pt => {
  const b = H.biomes.find((x) => x.id === id);
  if (!b) throw new Error(`raid.json host has no biome ${id}`);
  const [x, z] = layoutPosition(b, EXPANSE_RADIUS);
  return { x, z };
};
export const BIOMES = {
  glowmireFlats: biome('glowmireFlats'), chitinSpires: biome('chitinSpires'), wreckOfTheLongSeed: biome('wreckOfTheLongSeed'),
  choirChasm: biome('choirChasm'), broodHollow: biome('broodHollow'),
};

// ------------------------------------------------------------------ noise

function hash2(ix: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Rolling hills in -1..1. */
function hills(x: number, z: number): number {
  return (vnoise(x * 0.006, z * 0.006) - 0.5) * 1.3 + (vnoise(x * 0.015 + 17, z * 0.015 - 9) - 0.5) * 0.55 + (vnoise(x * 0.04 - 5, z * 0.04 + 3) - 0.5) * 0.15;
}

// ------------------------------------------------------------------ the chasm

const CH = D.chasm;
const CH_LEN = (() => { let l = 0; for (let i = 1; i < CH.points.length; i++) l += Math.hypot(CH.points[i].x - CH.points[i - 1].x, CH.points[i].z - CH.points[i - 1].z); return l; })();
/** Fraction of the rift's length over which each end ramps from the plain down to the full depth (walkable). */
const CH_RAMP = 0.3;

export interface ChasmPoint {
  /** Distance from the rift's centre line (m). */
  d: number;
  /** 0..1 along the rift, north end first. */
  s: number;
  /** Half width of the rift at s (m). */
  halfWidth: number;
  /** 0 at the ends, 1 in the full-depth middle. */
  depth: number;
  /** Unit tangent (north to south) and the centre-line point nearest (x, z). */
  tx: number; tz: number; cx: number; cz: number;
}

/** Where (x, z) sits relative to the Choir Chasm. */
export function chasmAt(x: number, z: number): ChasmPoint {
  let best = Infinity, bs = 0, btx = 0, btz = 1, bcx = 0, bcz = 0, run = 0;
  for (let i = 1; i < CH.points.length; i++) {
    const a = CH.points[i - 1], b = CH.points[i];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (len * len)));
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bs = (run + t * len) / CH_LEN; btx = dx / len; btz = dz / len; bcx = px; bcz = pz; }
    run += len;
  }
  const depth = Math.min(1, bs / CH_RAMP, (1 - bs) / CH_RAMP);
  return { d: best, s: bs, halfWidth: CH.halfWidth * (0.5 + 0.5 * smooth(0, 0.5, depth)), depth, tx: btx, tz: btz, cx: bcx, cz: bcz };
}

// ------------------------------------------------------------------ terrain

const T = D.terrain;
const FL = D.flats, SP = D.spires, WR = D.wreck, BR = D.brood;
const FLATS = BIOMES.glowmireFlats, SPIRES = BIOMES.chitinSpires;
const POOL_DEPTH = 1.4;
const BASIN_FLOOR = -3;

/** The plain before the chasm cuts it (islands and bridge ends are placed against this). */
function plain(x: number, z: number): number {
  let h = hills(x, z) * T.hills;
  // Glowmire Flats: a low, nearly level marsh basin.
  const df = Math.hypot(x - FLATS.x, z - FLATS.z);
  const wf = 1 - smooth(FL.basinRadius * 0.65, FL.basinRadius, df);
  if (wf > 0) h += (BASIN_FLOOR + (vnoise(x * 0.03, z * 0.03) - 0.5) * 1.2 - h) * wf;
  // Chitin Spires: a raised, broken plateau.
  const ds = Math.hypot(x - SPIRES.x, z - SPIRES.z);
  const wp = 1 - smooth(SP.plateauRadius * 0.7, SP.plateauRadius * 1.08, ds);
  if (wp > 0) h += wp * (SP.plateau + (vnoise(x * 0.05 + 3, z * 0.05) - 0.5) * 2.5);
  // The rim: ridges rise beyond the playable edge so the map reads as a great valley.
  const d = Math.hypot(x, z), R = EXPANSE_RADIUS;
  if (d > R * T.rimStart) {
    const ridge = 0.6 + 0.4 * (1 - Math.abs(Math.sin(Math.atan2(z, x) * 7 + vnoise(x * 0.01, z * 0.01) * 4)));
    h += T.rimHeight * smooth(R * T.rimStart, R * 1.25, d) * ridge;
  }
  return h;
}

/** Everything but the flattened gameplay spots. */
function shaped(x: number, z: number): number {
  let h = plain(x, z);
  // Pools sit in shallow basins below the marsh.
  for (const p of FL.pools) {
    const w = 1 - smooth(p.r * 0.6, p.r + 8, Math.hypot(x - p.x, z - p.z));
    if (w > 0) h += (BASIN_FLOOR - POOL_DEPTH - h) * w;
  }
  // The Long Seed's furrow: deepening from the first impact to where the hull came to rest, banked by a berm.
  {
    const ax = WR.from.x, az = WR.from.z, dx = WR.to.x - ax, dz = WR.to.z - az, L2 = dx * dx + dz * dz;
    const t = ((x - ax) * dx + (z - az) * dz) / L2;
    if (t > -0.1 && t < 1.15) {
      const tc = Math.max(0, Math.min(1, t));
      const p = Math.hypot(x - ax - dx * tc, z - az - dz * tc) + Math.max(0, -t, t - 1) * Math.sqrt(L2) * 0.6;
      const half = WR.furrowWidth / 2, along = smooth(-0.05, 0.3, t);
      const cut = Math.max(0, 1 - (p / half) ** 2);
      const berm = Math.exp(-(((p - half * 1.25) / (half * 0.35)) ** 2));
      h += along * (-WR.furrowDepth * cut + 2.2 * berm);
    }
  }
  // Brood Hollow craters: bowls with raised fleshy lips.
  for (const c of BR.craters) {
    const k = Math.hypot(x - c.x, z - c.z) / c.r;
    if (k < 1.7) {
      h -= c.d * (1 - smooth(0.25, 1, k));
      h += c.d * 0.35 * Math.exp(-((k - 1.05) ** 2) / 0.05);
    }
  }
  // The Choir Chasm.
  const ch = chasmAt(x, z);
  if (ch.d < ch.halfWidth) {
    const k = smooth(ch.halfWidth, ch.halfWidth * 0.62, ch.d);
    h -= CH.depth * ch.depth * k * (0.92 + vnoise(x * 0.08, z * 0.08) * 0.16);
  }
  return h;
}

/** Design's ring of squad spawns (raid.json host.spawns), kept level for rival hosts when they arrive. */
export function rivalSpawns(): Pt[] {
  return Array.from({ length: H.spawns.count }, (_, i) => {
    const [x, z] = layoutPosition({ radius: H.spawns.radius, bearing: (i * 360) / H.spawns.count }, EXPANSE_RADIUS);
    return { x, z };
  });
}

/** Where the host can land: points round the Glowmire Flats (Design: "the drop zone"), clear of the pools. */
export const DROP_POINTS: Pt[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + 0.2;
  return { x: BIOMES.glowmireFlats.x + Math.cos(a) * 58, z: BIOMES.glowmireFlats.z + Math.sin(a) * 58 };
}).filter((p) => FL.pools.every((q) => Math.hypot(p.x - q.x, p.z - q.z) > q.r + 10));

/** Flat spots: extract pads, spawn and drop points, pods, the Hollow Spires and the debris (centre, flat radius, blend). */
const FLAT_SPOTS: { x: number; z: number; r: number; blend: number; y?: number }[] = [
  ...H.extracts.pool.map((p) => { const [x, z] = layoutPosition(p, EXPANSE_RADIUS); return { x, z, r: 9, blend: 14 }; }),
  ...rivalSpawns().map((p) => ({ ...p, r: 7, blend: 12 })),
  ...DROP_POINTS.map((p) => ({ ...p, r: 5, blend: 8 })),
  ...D.pods.map((p) => ({ x: p.x, z: p.z, r: 2.5, blend: 5 })),
  ...SP.hollow.map((s) => ({ x: s.x, z: s.z, r: 10, blend: 10 })),
  ...WR.debris.map((d) => ({ x: d.x, z: d.z, r: 17, blend: 10 })),
];

/** Ground height of The Expanse at (x, z): what the mesh shows and every body stands on. */
export function expanseGround(x: number, z: number): number {
  let h = shaped(x, z);
  for (const f of FLAT_SPOTS) {
    const w = 1 - smooth(f.r, f.r + f.blend, Math.hypot(x - f.x, z - f.z));
    if (w > 0) { f.y ??= shaped(f.x, f.z); h += (f.y - h) * w; }
  }
  return h;
}

/** Liquid-light surface level of a Flats pool. */
export const POOL_LEVEL = BASIN_FLOOR - POOL_DEPTH * 0.45;

/** Ground slope (rise over run) at (x, z). */
export function expanseSlope(x: number, z: number): number {
  const e = 1.5;
  return Math.hypot(expanseGround(x + e, z) - expanseGround(x - e, z), expanseGround(x, z + e) - expanseGround(x, z - e)) / (2 * e);
}

// ------------------------------------------------------------------ layout

const EXTRACT_NAMES = ['North Rim', 'East Rim', 'South Rim', 'West Rim'];

/**
 * The raid layout: the host drops into the Glowmire Flats (Design's drop zone) at one of the DROP_POINTS and fights
 * outward; two rim extracts open at the start and another every `shiftEvery` seconds, in a seeded order. Design's
 * ring of squad spawns is kept level for rival hosts (rivalSpawns). Creatures come from the biome habitats, not
 * `spawns`. Design's paid extract (raid.json host.extracts.paidExtract) is open from the start and costs DNA to use.
 */
export function expanseLayout(seed: number): Zone7Layout {
  const rand = mulberry32(seed * 7919 + 13);
  const drop = DROP_POINTS[Math.floor(rand() * DROP_POINTS.length)];
  const pool = H.extracts.pool.filter((p) => p.radius > 0.5).map((p, i) => { const [x, z] = layoutPosition(p, EXPANSE_RADIUS); return { id: `rim-${i}`, label: `${EXTRACT_NAMES[i] ?? 'Rim'} Spire`, x, z }; });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const open = H.extracts.openAtStart, shift = H.extracts.shiftEvery;
  const extracts: ExtractSite[] = pool.map((e, i) => ({ ...e, opensAt: i < open ? 0 : (i - open + 1) * shift }));
  const paid = H.extracts.paidExtract, at = H.extracts.pool.find((p) => p.bearing === paid?.bearing);
  if (paid && at) {
    const [x, z] = layoutPosition(at, EXPANSE_RADIUS);
    extracts.push({ id: 'paid-tether', label: 'Paid Tether', x, z, opensAt: 0, costDna: paid.costDna, time: paid.extractTime });
  }
  return {
    seed,
    spawn: { id: 'spawn', x: drop.x, z: drop.z },
    extracts,
    dormantPads: [],
    pods: D.pods.map((p, i): PodSite => ({ id: `expanse-pod-${i}`, type: p.type, x: p.x, z: p.z })),
    nests: BR.craters.filter((c) => c.nest).map((c, i) => ({ id: `brood-heart-${i}`, type: 'broodHeart', x: c.x, z: c.z })),
    nodes: [],
    anomaly: { id: 'none', kind: 'none', x: 1e5, z: 1e5, radius: 1, gravityMultiplier: 1 },
    dropIn: D.dropIn,
    playableRadius: EXPANSE_RADIUS,
  };
}

const LANDMARK_RADIUS: Record<keyof typeof BIOMES, number> = { glowmireFlats: 140, chitinSpires: 140, wreckOfTheLongSeed: 110, choirChasm: 120, broodHollow: 120 };

/** The biome (raid.json host biome id) whose area holds (x, z), or null on the open plain between them. */
export function expanseLandmarkAt(x: number, z: number): string | null {
  let best: string | null = null, bd = Infinity;
  for (const [id, b] of Object.entries(BIOMES)) {
    // The chasm biome follows the rift itself, not just its centre.
    const d = id === 'choirChasm' ? Math.min(Math.hypot(x - b.x, z - b.z), chasmAt(x, z).d + 40) : Math.hypot(x - b.x, z - b.z);
    if (d <= LANDMARK_RADIUS[id as keyof typeof BIOMES] && d < bd) { bd = d; best = id; }
  }
  return best;
}

// ------------------------------------------------------------------ bridges and the chasm lip

export interface BridgeSpan { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; width: number }

/** Each bridge runs straight across the rift, square to it, from bank to bank. */
export function bridgeSpans(): BridgeSpan[] {
  return CH.bridges.map((b) => {
    const c = chasmAt(b.x, b.z);
    const nx = -c.tz, nz = c.tx, reach = c.halfWidth + 5;
    const x0 = c.cx - nx * reach, z0 = c.cz - nz * reach, x1 = c.cx + nx * reach, z1 = c.cz + nz * reach;
    return { x0, z0, x1, z1, y0: expanseGround(x0, z0), y1: expanseGround(x1, z1), width: b.width };
  });
}

/** Posts along both lips of the deep middle of the rift (gaps where the bridges land). */
export function chasmLip(spacing = 5): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  const spans = bridgeSpans();
  let run = 0;
  for (let i = 1; i < CH.points.length; i++) {
    const a = CH.points[i - 1], b = CH.points[i], len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let t = 0; t < len; t += spacing) {
      const s = (run + t) / CH_LEN;
      const depth = Math.min(1, s / CH_RAMP, (1 - s) / CH_RAMP);
      if (depth < 0.35) continue; // the shallow ends are a walkable ramp
      const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len, cx = a.x + tx * t, cz = a.z + tz * t;
      const half = CH.halfWidth * (0.5 + 0.5 * smooth(0, 0.5, depth)) + 0.8;
      for (const side of [-1, 1]) {
        const x = cx - tz * side * half, z = cz + tx * side * half;
        if (spans.some((sp) => segDist(x, z, sp) < sp.width / 2 + 1.5)) continue;
        out.push({ x, z, yaw: Math.atan2(-tz, tx) });
      }
    }
    run += len;
  }
  return out;
}

function segDist(x: number, z: number, s: { x0: number; z0: number; x1: number; z1: number }): number {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0, t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - s.x0 - dx * t, z - s.z0 - dz * t);
}

/** A grown bone bridge with rails: deck and rail colliders; ribs hang beneath it. */
function boneBridge(span: BridgeSpan, deckMat: THREE.Material, ribMat: THREE.Material): THREE.Group {
  // Local +X runs from the low bank to the high one, so the deck's `rise` climbs the right way.
  const flip = span.y0 > span.y1;
  const [ax, az, ay, bx, bz, by] = flip ? [span.x1, span.z1, span.y1, span.x0, span.z0, span.y0] : [span.x0, span.z0, span.y0, span.x1, span.z1, span.y1];
  const cx = (ax + bx) / 2, cz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az);
  const yaw = Math.atan2(-(bz - az), bx - ax);
  const base = ay;
  const rise = by - ay, top = rise + 0.15;
  const k = new Kit(SOLIDS, cx, cz, yaw, base);
  k.group.name = 'chasm-bridge';
  const hw = span.width / 2;
  k.box(0, 0, len / 2, hw, top - 0.7, top, deckMat, { rise, flatTop: true, tag: 'bridge' });
  // Rails: bone horns growing up from the deck edge, joined by a sagging sinew; a thin collider along each side.
  const posts = Math.max(4, Math.round(len / 2.4));
  for (const side of [-1, 1]) {
    const v = side * (hw - 0.15);
    const [cx, cz] = k.at(0, v);
    SOLIDS.add({ cx, cz, hx: len / 2 - 0.5, hz: 0.15, yaw, y0: base + top - 0.5, y1: base + top + 1.1, rise, tag: 'bridge-rail' });
    const tops: THREE.Vector3[] = [];
    for (let i = 0; i <= posts; i++) {
      const u = -len / 2 + 0.5 + (i / posts) * (len - 1), y = top - rise * (0.5 - u / len);
      const h = 1.05 + 0.12 * Math.sin(i * 2.3);
      const tip = new THREE.Vector3(u + 0.1 * Math.sin(i), y + h, v + side * 0.25);
      const horn = new THREE.CatmullRomCurve3([new THREE.Vector3(u, y - 0.2, v - side * 0.05), new THREE.Vector3(u, y + h * 0.5, v + side * 0.18), tip]);
      k.group.add(new THREE.Mesh(new THREE.TubeGeometry(horn, 6, 0.1 + 0.03 * Math.cos(i * 1.7), 5), ribMat));
      tops.push(tip.clone().add(new THREE.Vector3(0, -0.08, 0)));
    }
    k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tops), posts * 6, 0.06, 5), ribMat));
  }
  // Ribs: arcs under the deck, like a spine laid across the rift.
  const ribs = Math.max(4, Math.round(len / 4));
  for (let i = 0; i <= ribs; i++) {
    const u = -len / 2 + (i / ribs) * len, y = top - 0.6 - rise * (0.5 - i / ribs);
    const sag = 1.4 + 2.2 * Math.sin((i / ribs) * Math.PI);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(u, y, -hw - 0.3), new THREE.Vector3(u + 0.3, y - sag, 0), new THREE.Vector3(u, y, hw + 0.3)]);
    k.group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.22, 6), ribMat));
  }
  // A keel tendon along the bottom.
  const keel = new THREE.CatmullRomCurve3([new THREE.Vector3(-len / 2, -0.9, 0), new THREE.Vector3(0, rise / 2 - 3.4, 0), new THREE.Vector3(len / 2, rise - 0.9, 0)]);
  k.group.add(new THREE.Mesh(new THREE.TubeGeometry(keel, 24, 0.35, 7), ribMat));
  return k.group;
}

// ------------------------------------------------------------------ build

export interface ExpanseWorld {
  layout: Zone7Layout;
  sites: SiteDressing;
  structures: BuiltStructures;
  landmarkAt(x: number, z: number): string | null;
}

const M4 = (x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx, tilt = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, tilt * 0.5)), new THREE.Vector3(sx, sy, sz));

function stripTo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const key of Object.keys(n.attributes)) if (key !== 'position' && key !== 'normal' && key !== 'uv') n.deleteAttribute(key);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  return n;
}

/** A tapering, ribbed chitin tower (unit height, base radius 1), lathed then grown lumpy. */
function towerGeometry(rand: () => number, seed: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const kinks = 2 + Math.floor(rand() * 3);
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const ring = 1 + 0.12 * Math.max(0, Math.sin(t * Math.PI * kinks * 2)); // growth rings
    pts.push(new THREE.Vector2(Math.max(0.04, (1 - t * 0.86) * (1 + 0.5 * Math.exp(-t * 14)) * ring), t));
  }
  return roughen(new THREE.LatheGeometry(pts, 12), 1.4, seed);
}

/** A small curved chitin spine (unit height, base radius 1) for the chasm lip: few vertices, it is placed hundreds of times. */
function spineGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 7; i++) { const t = i / 7; pts.push(new THREE.Vector2(Math.max(0.03, (1 - t) ** 1.4 * (1 + 0.15 * Math.sin(t * 9))), t)); }
  const g = new THREE.LatheGeometry(pts, 7);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + 0.9 * p.getY(i) ** 2); // the hook
  return roughen(g, 0.8, 2);
}

/** Builds The Expanse into `scene` (SOLIDS reset; terrain set to the Expanse ground). */
export function buildExpanse(scene: THREE.Scene, seed: number): ExpanseWorld {
  setTerrain(expanseGround, { maxSlope: T.maxSlope });
  SOLIDS.clear();
  const rand = mulberry32(4211);
  const layout = expanseLayout(seed);
  const G = expanseGround;

  // ---- Sky and light: Glowmire's night, wider and hazier for the long sightlines.
  const sky = zone7Sky();
  sky.userData.bake = true;
  scene.add(sky);
  scene.background = new THREE.Color(ZONE7.void);
  scene.fog = new THREE.FogExp2(ZONE7_SHADE.skyHorizon, 0.0021);
  scene.add(new THREE.HemisphereLight(ORGANIC.mist, ZONE7_SHADE.rock, 1.3));
  const key = new THREE.DirectionalLight(ORGANIC.mist, 2.3);
  key.position.set(60, 80, -120);
  const rim = new THREE.DirectionalLight(ORGANIC.wetFlesh, 0.5);
  rim.position.set(-120, 40, 80);
  scene.add(key, rim);
  const lightDir = new THREE.Vector3(1, 0.4, 0.6);
  const giant = planet({ radius: 40, band: ORGANIC.mist, rim: ORGANIC.mist, lightDir, seed: 5 });
  giant.position.set(-560, 430, -980);
  scene.add(giant, starField(rand), horizonLands({ seed, lightDir, radii: [700, 830], base: -10, height: 150 }));
  scene.add(sporeField(rand, 900, 60, 40, [ORGANIC.mist, ORGANIC.amber, ZONE7.lime]));

  // ---- Ground: fine 100 m tiles over the playable square, a coarse ring out to the ridgeline.
  const groundMat = zoneRock({ veinColour: ORGANIC.vein, mossColour: ORGANIC.mist });
  const inner = terrainTiles(G, groundMat, { extent: EXPANSE_RADIUS, tile: 100, cells: 64, levels: 3, distances: [0, 160, 320], name: 'ground' });
  const outer = terrainTiles(G, groundMat, {
    extent: 800, tile: 100, cells: 16, levels: 2, distances: [0, 400], name: 'ground-rim',
    skip: (x, z) => (Math.abs(x) <= EXPANSE_RADIUS && Math.abs(z) <= EXPANSE_RADIUS) || Math.hypot(x, z) > 860,
  });
  scene.add(inner.group, outer.group);

  const statics = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (mat: THREE.Material, g: THREE.BufferGeometry, m?: THREE.Matrix4) => {
    const p = stripTo(g);
    if (m) p.applyMatrix4(m);
    const l = statics.get(mat);
    if (l) l.push(p); else statics.set(mat, [p]);
  };
  const structures = new THREE.Group();
  structures.name = 'expanse-structures';
  const loot: LootSpot[] = [];

  // ---- Glowmire Flats: liquid-light pools in the marsh, giant fungi standing over them, smaller growth between.
  const poolMat = liquidLight({ pool: true, a: ZONE7_SHADE.rockDeep, b: ZONE7_SHADE.moss, c: ORGANIC.mist, flow: 0.25 });
  for (const [i, p] of FL.pools.entries()) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(p.r, 48).rotateX(-Math.PI / 2), poolMat);
    pool.position.set(p.x, POOL_LEVEL, p.z);
    pool.name = `liquid-light-pool-${i}`;
    scene.add(pool);
    if (i < 4) {
      const l = new THREE.PointLight(ORGANIC.mist, 26, 30, 2);
      l.position.set(p.x, POOL_LEVEL + 2.5, p.z);
      scene.add(l);
    }
  }
  const clear = clearings(layout);
  const wet = (x: number, z: number, m: number) => FL.pools.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + m);
  const blocked = (x: number, z: number, m: number) => wet(x, z, m) || clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius + m) || D.pods.some((p) => Math.hypot(x - p.x, z - p.z) < 3 + m);
  const centre = new THREE.Vector3(FLATS.x, 0, FLATS.z);
  const fungi: Fungus[] = [
    ...scatterFungi(rand, { count: FL.giantFungi, minR: 10, maxR: FL.basinRadius * 0.85, height: [9, 19], cap: [3, 6.5] }, G, centre).filter((f) => !blocked(f.pos.x, f.pos.z, 3)),
    ...scatterFungi(rand, { count: FL.fungi, minR: 4, maxR: FL.basinRadius, height: [1.2, 5], cap: [0.5, 1.8] }, G, centre).filter((f) => !blocked(f.pos.x, f.pos.z, 0.5)),
  ];
  // A few stands on the open plain so the walk between biomes is never bare.
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2, d = 160 + rand() * 260, x = Math.sin(a) * d, z = -Math.cos(a) * d;
    if (expanseLandmarkAt(x, z) || chasmAt(x, z).d < CH.halfWidth + 10) continue;
    fungi.push(...scatterFungi(rand, { count: 4 + Math.floor(rand() * 5), minR: 0, maxR: 9, height: [2, 9], cap: [0.8, 3] }, G, new THREE.Vector3(x, 0, z)));
  }
  for (const f of fungi.filter((f) => f.height > 13).slice(0, 5)) {
    const l = new THREE.PointLight(f.colour, 40, 28, 2);
    l.position.copy(f.pos).add(new THREE.Vector3(0, f.height * 0.85, 0));
    scene.add(l);
  }

  // ---- Chitin Spires: a forest of grown towers on the plateau round three Hollow Spires you can climb.
  const towerMat = chitin(ZONE7_SHADE.stem, ORGANIC.vein, 0.5);
  const towers: { x: number; z: number; r: number }[] = [];
  const nearSpire = (x: number, z: number, m: number) => SP.hollow.some((s) => Math.hypot(x - s.x, z - s.z) < 14 + m);
  for (let tries = 0; towers.length < SP.towers && tries < SP.towers * 30; tries++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * SP.plateauRadius * 0.9;
    const x = SPIRES.x + Math.cos(a) * d, z = SPIRES.z + Math.sin(a) * d;
    const r = SP.towerRadius[0] + rand() * (SP.towerRadius[1] - SP.towerRadius[0]);
    if (nearSpire(x, z, r) || blocked(x, z, r + 2) || towers.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + r + 7)) continue;
    towers.push({ x, z, r });
  }
  for (const [i, t] of towers.entries()) {
    const h = SP.towerHeight[0] + rand() * (SP.towerHeight[1] - SP.towerHeight[0]);
    const y = G(t.x, t.z) - 0.6;
    add(towerMat, towerGeometry(rand, i + 3), M4(t.x, y, t.z, rand() * 6, t.r, h, t.r));
    SOLIDS.add({ cx: t.x, cz: t.z, hx: t.r * 0.78, hz: t.r * 0.78, yaw: 0, y0: y, y1: y + h * 0.6, tag: 'chitin-tower' });
    // Side spurs on the tall ones: horns curling off the trunk.
    if (h > 30) {
      const a = rand() * Math.PI * 2, sy = y + h * (0.35 + rand() * 0.25);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(t.x, sy, t.z),
        new THREE.Vector3(t.x + Math.cos(a) * t.r * 2.2, sy + 3, t.z + Math.sin(a) * t.r * 2.2),
        new THREE.Vector3(t.x + Math.cos(a) * t.r * 3, sy + 8, t.z + Math.sin(a) * t.r * 3),
      ]);
      add(towerMat, new THREE.TubeGeometry(curve, 10, t.r * 0.28, 6));
    }
  }
  for (const [i, s] of SP.hollow.entries()) {
    const spire = hollowSpire(SOLIDS, s.x, s.z, deg(s.yaw), G, 11 + i * 7);
    rootSkirt(spire.group, 8.6, 12, 5 + i);
    structures.add(spire.group);
    loot.push(...spire.loot.map((l) => ({ ...l, id: `spires-${i}-${l.id}` })));
  }

  // ---- Wreck of the Long Seed: the split hull lying at the end of its furrow, ribs bared where it tore open.
  const hullMat = chitin(ZONE7_SHADE.rock, ORGANIC.mist, 0.8);
  (hullMat as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
  const ribMat = oldBone(ORGANIC.mist, 0.3);
  {
    const ax = WR.from.x, az = WR.from.z, dx = WR.to.x - ax, dz = WR.to.z - az, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, yaw = Math.atan2(-uz, ux);
    const R = WR.hullRadius;
    const at = (t: number): [number, number] => [ax + dx * t, az + dz * t];
    // Hull: an open tube from 55% of the furrow to its end, sunk to 40% in the ground, its roof torn away.
    const t0 = 0.55, len = L * (1 - t0) + R * 0.3;
    const [hx, hz] = at(t0 + (1 - t0) / 2);
    const floorY = G(hx, hz);
    const hull = roughen(new THREE.CylinderGeometry(R, R * 0.92, len, 30, 14, true, deg(-150), deg(300)), 1.6, 7);
    // Cylinder axis is y; lay it along local +X and sink it.
    hull.rotateZ(Math.PI / 2);
    add(hullMat, hull, M4(hx, floorY + R * 0.2, hz, yaw));
    // The sealed stern: a dished cap at the far end.
    const cap = roughen(new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), 1.2, 9);
    cap.rotateZ(-Math.PI / 2);
    const [ex, ez] = at(1);
    add(hullMat, cap, M4(ex + ux * (R * 0.3 - 1), floorY + R * 0.2, ez + uz * (R * 0.3 - 1), yaw));
    // Bared ribs ahead of the hull, where the skin peeled off in the skid.
    for (let i = 0; i < WR.ribs; i++) {
      const t = 0.3 + (i / WR.ribs) * (t0 - 0.3);
      const [rx, rz] = at(t);
      const rr = R * (0.75 + 0.25 * (i / WR.ribs));
      const tor = new THREE.TorusGeometry(rr, 0.5 + 0.3 * rand(), 7, 24, deg(150 + rand() * 50));
      tor.rotateZ(deg(10 + rand() * 20));
      tor.rotateY(Math.PI / 2);
      add(ribMat, roughen(tor, 0.6, i), M4(rx, G(rx, rz) - 1.2, rz, yaw + (rand() - 0.5) * 0.15));
    }
    // Hull walls: colliders down both flanks with gaps you can slip through, and across the stern.
    const k = new Kit(SOLIDS, hx, hz, yaw, floorY);
    const wallH = R * 1.05;
    const gaps = [-len * 0.22, len * 0.18];
    for (const v of [-R * 0.95, R * 0.95]) {
      let u0 = -len / 2;
      for (const g of [...gaps, len / 2 + 3]) {
        const u1 = Math.min(len / 2, g - 3);
        if (u1 > u0 + 1) { const [cx, cz] = k.at((u0 + u1) / 2, v); SOLIDS.add({ cx, cz, hx: (u1 - u0) / 2, hz: 0.8, yaw, y0: floorY - 2, y1: floorY + wallH, tag: 'wreck-hull' }); }
        u0 = g + 3;
      }
    }
    { const [cx, cz] = k.at(len / 2 + R * 0.25, 0); SOLIDS.add({ cx, cz, hx: 1, hz: R, yaw, y0: floorY - 2, y1: floorY + wallH, tag: 'wreck-stern' }); }
    // Inside: a light where the reactor bled out, so the hull reads from the furrow.
    const glow = new THREE.PointLight(ORGANIC.amber, 60, 40, 2);
    glow.position.set(hx + ux * len * 0.3, floorY + 4, hz + uz * len * 0.3);
    scene.add(glow);
  }
  for (const [i, d] of WR.debris.entries()) {
    const deb = longSeedDebris(SOLIDS, d.x, d.z, deg(d.yaw), G, 31 + i * 5);
    structures.add(deb.group);
    loot.push(...deb.loot.map((l) => ({ ...l, id: `wreck-${i}-${l.id}` })));
  }

  // ---- Choir Chasm: islands hang over the rift, liquid light falls from them into the dark; two bone bridges.
  const rockMat = zoneRock({ veinColour: ORGANIC.vein, mossColour: ZONE7_SHADE.moss, scale: 1.6 });
  for (const [i, isl] of CH.islands.entries()) {
    const geo = floatingIslandGeometry(seed + i * 13, 2.2 + rand() * 1.4);
    const y = plain(isl.x, isl.z) + isl.y;
    const mesh = new THREE.Mesh(geo, rockMat);
    mesh.scale.setScalar(isl.r);
    mesh.position.set(isl.x, y, isl.z);
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.name = `chasm-island-${i}`;
    scene.add(mesh);
    const topY = y + ISLAND_TOP * isl.r * 0.5;
    fungi.push(...scatterFungi(rand, { count: Math.round(isl.r * 0.8), minR: 0, maxR: isl.r * 0.65, height: [1.5, isl.r * 0.4], cap: [0.7, isl.r * 0.15] }, () => topY, new THREE.Vector3(isl.x, 0, isl.z)));
    const c = chasmAt(isl.x, isl.z);
    const out = new THREE.Vector3(c.cx - isl.x, 0, c.cz - isl.z);
    if (out.lengthSq() < 1) out.set(c.tz, 0, -c.tx);
    out.normalize();
    scene.add(fall(new THREE.Vector3(isl.x, topY, isl.z).addScaledVector(out, isl.r * 0.7), out, isl.y + CH.depth, Math.min(6, isl.r * 0.3)));
  }
  // Glow from the rift floor, so its depth reads.
  for (let s = 0.15; s < 0.9; s += 0.18) {
    const i = Math.min(CH.points.length - 2, Math.floor(s * (CH.points.length - 1)));
    const a = CH.points[i], b = CH.points[i + 1], f = s * (CH.points.length - 1) - i;
    const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
    const l = new THREE.PointLight(ORGANIC.mist, 90, 70, 2);
    l.position.set(x, G(x, z) + 6, z);
    scene.add(l);
  }
  const deck = chitin(HIVE.bone, ORGANIC.mist, 0.6);
  for (const span of bridgeSpans()) structures.add(boneBridge(span, deck, ribMat));
  // The lip: chitin teeth along both edges of the deep rift; each is a collider, so nobody walks off.
  const lip = chasmLip();
  const spine = spineGeometry();
  for (const [i, p] of lip.entries()) {
    const y = G(p.x, p.z);
    SOLIDS.add({ cx: p.x, cz: p.z, hx: 2.7, hz: 0.7, yaw: p.yaw, y0: y - 2, y1: y + 2.2, tag: 'chasm-lip' });
    // Two or three grown spines per post, jittered along the edge and leaning every way, so the lip reads as growth.
    const n = 2 + (hash2(i, 1) > 0.6 ? 1 : 0);
    for (let j = 0; j < n; j++) {
      const off = (hash2(i, 11 + j) - 0.5) * 3.6, sx = p.x + Math.cos(p.yaw) * off, sz = p.z - Math.sin(p.yaw) * off;
      const h = 1.8 + hash2(i, 7 + j) * 2.2, r = 0.35 + hash2(i, 3 + j) * 0.3;
      add(towerMat, spine, M4(sx, G(sx, sz) - 0.3, sz, hash2(i, 5 + j) * 6.28, r, h, r, (hash2(i, 9 + j) - 0.5) * 0.7));
    }
  }

  // ---- Brood Hollow: the crater field, a fleshy stalk rising from it, pustules seeping on every lip.
  const flesh = livingFlesh(ZONE7_SHADE.flesh, ORGANIC.vein, ORGANIC.wetFlesh);
  {
    const S = BR.stalk, y = G(S.x, S.z);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector3(S.x + Math.sin(t * 3.1) * 4 * t, y - 1 + t * S.height, S.z + Math.cos(t * 2.3) * 3 * t));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const stalk = new THREE.TubeGeometry(curve, 48, 1, 10);
    // Taper it: thick at the root, thin at the crown.
    const p = stalk.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = Math.floor(i / 11) / 48;
      const c = curve.getPoint(t);
      const k = 3.2 * (1 - t * 0.75);
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
    }
    stalk.computeVertexNormals();
    add(flesh, stalk);
    SOLIDS.add({ cx: S.x, cz: S.z, hx: 2.6, hz: 2.6, yaw: 0, y0: y - 1, y1: y + S.height * 0.5, tag: 'brood-stalk' });
    const crown = new THREE.PointLight(ORGANIC.amber, 70, 60, 2);
    crown.position.copy(pts[pts.length - 1]).add(new THREE.Vector3(0, 2, 0));
    scene.add(crown);
    // Sacs hanging off the stalk.
    for (let i = 0; i < 9; i++) {
      const c = curve.getPoint(0.25 + rand() * 0.65), a = rand() * Math.PI * 2, r = 1.6 + rand() * 1.4;
      add(flesh, roughen(new THREE.SphereGeometry(r, 12, 9), 0.8, i), M4(c.x + Math.cos(a) * 2.6, c.y - r * 0.3, c.z + Math.sin(a) * 2.6, 0, 1, 1.3, 1));
    }
  }
  const pustules = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), bioNode(ORGANIC.amber), 900);
  pustules.name = 'brood-pustules';
  let np = 0;
  for (const c of BR.craters) {
    for (let i = 0; i < 160 && np < 900; i++) {
      const a = rand() * Math.PI * 2, d = c.r * (0.4 + rand() * 1.0), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const s = 0.12 + rand() * 0.35;
      pustules.setMatrixAt(np++, M4(x, G(x, z) + s * 0.3, z, 0, s));
    }
  }
  pustules.count = np;
  scene.add(pustules);

  scene.add(fungusMeshes(fungi));
  for (const [mat, list] of statics) {
    const mesh = new THREE.Mesh(mergeGeometries(list), mat);
    mesh.name = 'expanse-static';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.noOrganic = true;
    scene.add(mesh);
  }
  scene.add(structures);

  // ---- Ground cover: lush in the marsh, sparse on the plateau and in the furrow, none on cliffs or in the rift.
  const density = (x: number, z: number) => {
    const b = expanseLandmarkAt(x, z);
    const mul = b === 'glowmireFlats' ? 1.35 : b === 'chitinSpires' ? 0.55 : b === 'wreckOfTheLongSeed' ? 0.45 : b === 'broodHollow' ? 0.8 : 1;
    return mul * Math.max(0, 1 - expanseSlope(x, z) * 1.3);
  };
  scene.add(groundCover({
    height: G, density,
    tints: [ORGANIC.mist, ORGANIC.amber, ORGANIC.vein, ZONE7_SHADE.moss],
    exclude: (x, z) => wet(x, z, 0.6) || clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius) || chasmAt(x, z).d < chasmAt(x, z).halfWidth + 0.5 || towers.some((t) => Math.hypot(x - t.x, z - t.z) < t.r),
  }).group);

  // ---- Gameplay sites: extract pads, pods and the Brood Hearts' craters.
  const sites = buildSites(layout, G, seed);
  scene.add(sites.group);

  return {
    layout,
    sites,
    structures: { group: structures, loot, arena: null, breakPillar() { /* no boss arena here */ } },
    landmarkAt: expanseLandmarkAt,
  };
}
