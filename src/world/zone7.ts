import * as THREE from 'three';
import { HIVE, ORGANIC, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, crystal, fungusCap, fungusStem, liquidLight, membrane, zoneRock, bioTime } from '../render/materials';
import { capGeometry, crystalClusterGeometry, floatingIslandGeometry, ISLAND_TOP, noise3, ribbonGeometry, stemGeometry } from '../render/geometry';
import { cloudSea, planet, sporeField, starField, zone7Sky } from '../render/sky';
import { horizonLands } from '../render/horizon';
import { groundCover } from '../render/cover';
import { ZONE7_SITES } from '../../data';
import { mulberry32 } from './rng';
import { CATALOGUE, zone7Layout, type Zone7Layout } from './layout';
import { buildSites, clearings, type SiteDressing } from './sites';
import { CollisionWorld } from './collision';
import { caveDistance, fungalCaves, type CaveLair } from './cave';
import { bakeEcology, wanderingTrail, type Ecology } from './ecology';
import { hollowSpire, longSeedDebris, oldBone, reliquaryBowl, rootSkirt, type ArenaInfo, type BuiltStructures } from './structures';

export { mulberry32 } from './rng';

/** Main island radius. Walkable to about 0.84 of this (~150 m), matching data/raid.json playableRadius. */
export const ISLAND_RADIUS = 180;

/**
 * Spots that must be flat and walkable, from the site catalogue (src/world/layout.ts): the spawn, every
 * candidate Seed Spire pad (index 1 is the Spore extract at bearing 20), Bio-Pod clearings and Gene Bloom sites.
 * Every candidate is shaped whatever the seed, so groundHeight never depends on the raid.
 */
export const FLAT_SPOTS: readonly { name: string; x: number; z: number; radius: number }[] = [
  { name: 'spawn', ...xz(CATALOGUE.spawn), radius: 9 },
  ...CATALOGUE.pads.map((p) => ({ name: p.id, ...xz(p), radius: ZONE7_SITES.padRadius })),
  ...CATALOGUE.pods.map((p, i) => ({ name: p.id, ...xz(p), radius: i === 0 ? 13 : ZONE7_SITES.podClearingRadius })),
  ...CATALOGUE.blooms.map((p) => ({ name: p.id, ...xz(p), radius: ZONE7_SITES.geneBlooms.clearingRadius })),
  { name: CATALOGUE.spire.id, ...xz(CATALOGUE.spire), radius: CATALOGUE.spire.radius },
  { name: CATALOGUE.debris.id, ...xz(CATALOGUE.debris), radius: CATALOGUE.debris.radius },
];

/** The Reliquary Bowl's terrain: a sunken arena with sheer sides except at its two entrances. */
export const BOWL = CATALOGUE.bowl;

/** Bowl blend weight and target height at (x, z), or null outside it. */
function bowlAt(x: number, z: number): { w: number; floor: number } | null {
  const dx = x - BOWL.x, dz = z - BOWL.z;
  const dist = Math.hypot(dx, dz), d = dist / BOWL.radius;
  if (d > 1.15) return null;
  // Entrances lie along the bowl's local u axis (see structures.ts reliquaryBowl).
  const u = dx * Math.cos(BOWL.yaw) - dz * Math.sin(BOWL.yaw);
  const e = dist > 0.01 ? smooth(0.86, 0.97, Math.abs(u) / dist) : 0;
  const r0 = 0.75 + (0.25 - 0.75) * e, r1 = 0.95 + (1.12 - 0.95) * e;
  // Entrances blend toward a straight ramp (constant slope) so the climb out is never a wall.
  const lin = Math.min(1, Math.max(0, (d - r0) / (r1 - r0)));
  const t = smooth(r0, r1, d) * (1 - e) + lin * e;
  return { w: 1 - t, floor: rawHeight(BOWL.x, BOWL.z) - BOWL.depth };
}

/** World height of the Reliquary Bowl's floor. */
export function bowlFloor(): number { return rawHeight(BOWL.x, BOWL.z) - BOWL.depth; }

/** Static colliders of the zone's structures (walls, decks, ramps). Filled by buildZone7. */
export const SOLIDS = new CollisionWorld((x, z) => groundHeight(x, z));

function xz(p: { x: number; z: number }) { return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }; }

/** Brood Heart craters: a bowl with a raised lip, half-burying the nest (docs/gdd/larva-milestone.md). */
export const CRATERS = CATALOGUE.nests.map((n) => ({ name: n.id, ...xz(n), ...ZONE7_SITES.broodCrater }));

/** Liquid-light pools: Mirror Shallows mid-route, Westfall Mere, and the Rimfall Pool fed by a cascade off the south-west rim. */
export const POOLS = [
  { x: -24, z: 42, radius: 11, fall: false },
  { x: -132, z: -58, radius: 13, fall: false },
  { x: -106, z: 52, radius: 9, fall: true },
] as const;

const POOL_DEPTH = 1.2;

/** World height of a pool's liquid surface. */
export function poolLevel(p: { x: number; z: number }): number {
  return rawHeight(p.x, p.z) - POOL_DEPTH + 0.6;
}

/** Distance from (x, z) to the polyline `pts`, and how far along it (0..1 of its length) the nearest point lies. */
function polyDist(x: number, z: number, pts: [number, number][]): { d: number; at: [number, number] } {
  let best = Infinity, at: [number, number] = pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; at = [px, pz]; }
  }
  return { d: best, at };
}

const RIDGES = ZONE7_SITES.ridges, VALLEYS = ZONE7_SITES.valleys;

/** The mountains that wall the playable basin: they rise from the rim of the walkable area and roll on out of sight. */
function rimHeight(x: number, z: number, r: number): number {
  if (r < 0.8) return 0;
  const a = Math.atan2(z, x);
  const crag = noise3(Math.cos(a) * 3.1, Math.sin(a) * 3.1, r * 2.2) * 0.6 + noise3(Math.cos(a) * 9, Math.sin(a) * 9, r * 6) * 0.25;
  const near = smooth(0.84, 1.1, r) * (26 + 30 * crag);
  const far = smooth(1.1, 2.2, r) * (40 + 70 * noise3(Math.cos(a) * 1.7 + 5, Math.sin(a) * 1.7, r * 0.8));
  return near + far;
}

function rawHeight(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const r = d / ISLAND_RADIUS;
  const hills = Math.sin(x * 0.035) * Math.cos(z * 0.03) * 6 + Math.sin(x * 0.011 + z * 0.017 + 1.3) * 9;
  const detail = Math.sin(x * 0.11) * Math.cos(z * 0.09) * 1.2 + Math.sin(x * 0.31 + z * 0.27) * 0.35;
  // Gentle spawn basin at the centre, full relief further out, then the mountains of the rim.
  const relief = hills * (0.15 + 0.85 * Math.min(1, d / 45)) + detail;
  let h = relief * Math.max(0, 1 - r * r) + rimHeight(x, z, r);
  // Hummocks and creases: uneven ground between the areas, so open land is never a smooth sheet.
  const hum = (noise3(x * 0.055, 3.1, z * 0.055) - 0.5) * 3.4 + (noise3(x * 0.16, 5.7, z * 0.16) - 0.5) * 0.9;
  const crease = Math.pow(1 - Math.abs(noise3(x * 0.028 + 11, 0.7, z * 0.028) * 2 - 1), 6) * 2.4;
  h += (hum - crease) * Math.max(0, 1 - r * r) * Math.min(1, d / 30);
  // Ridges: rounded spines of high ground between areas, dipping at their passes.
  for (const rg of RIDGES) {
    const { d: rd, at } = polyDist(x, z, rg.points);
    if (rd > rg.halfWidth * 1.6) continue;
    const pass = rg.passes.reduce((m, [px, pz]) => Math.max(m, 1 - smooth(4, 16, Math.hypot(at[0] - px, at[1] - pz))), 0);
    const crest = 0.85 + 0.15 * noise3(at[0] * 0.08, at[1] * 0.08, 7);
    h += rg.height * crest * (1 - pass * 0.85) * (1 - smooth(0, rg.halfWidth * 1.6, rd));
  }
  // Valleys: a shallow, wide run carved through the middle, the natural path between the pools and the bowl.
  for (const v of VALLEYS) {
    const { d: vd } = polyDist(x, z, v.points);
    if (vd < v.halfWidth * 1.8) h -= v.depth * (1 - smooth(v.halfWidth * 0.3, v.halfWidth * 1.8, vd));
  }
  return h;
}

const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/** The active map's ground, when it is not the island (the Long Seed wreck is a flat deck). */
let terrain: ((x: number, z: number) => number) | null = null;
/** Steepest ground (rise per metre) a body may walk up on the active map; Infinity means no limit (the island). */
let maxSlope = Infinity;
/**
 * Swap the ground every system reads through groundHeight(); null restores the island. `maxSlope` makes cliff faces
 * in the terrain itself block walking (the Marrow Pit's walls); maps without it keep the old free-climbing ground.
 */
export function setTerrain(fn: ((x: number, z: number) => number) | null, opts: { maxSlope?: number } = {}): void {
  terrain = fn;
  maxSlope = opts.maxSlope ?? Infinity;
}

/**
 * True when a body with feet at `feetY` moving from (x0, z0) to (x1, z1) would walk up terrain steeper than the
 * map allows. The Player reverts that part of its move, so terrain cliffs act as walls.
 */
export function climbBlocked(feetY: number, x0: number, z0: number, x1: number, z1: number): boolean {
  if (maxSlope === Infinity) return false;
  const rise = groundHeight(x1, z1) - feetY;
  if (rise <= 0.05) return false;
  return rise > Math.hypot(x1 - x0, z1 - z0) * maxSlope;
}

/** Height of the island surface at (x, z). Shared by the mesh and the player controller. */
export function groundHeight(x: number, z: number): number {
  if (terrain) return terrain(x, z);
  let h = rawHeight(x, z);
  for (const s of FLAT_SPOTS) {
    const w = 1 - smooth(s.radius, s.radius + 14, Math.hypot(x - s.x, z - s.z));
    if (w > 0) h += (rawHeight(s.x, s.z) - h) * w;
  }
  for (const c of CRATERS) {
    const d = Math.hypot(x - c.x, z - c.z) / c.radius;
    if (d < 1.6) {
      const floor = rawHeight(c.x, c.z);
      const bowl = 1 - smooth(0.3, 1, d);
      h += (floor - c.depth - h) * bowl;
      h += c.rimHeight * Math.exp(-((d - 1.05) ** 2) / 0.04);
    }
  }
  // Caves: the chamber, its tunnels and the apron at the mouth sit on one level floor.
  for (const c of ZONE7_SITES.caves) {
    const d = caveDistance(c, x, z);
    if (d < 12) h += (rawHeight(c.x, c.z) - h) * (1 - smooth(1, 12, d));
  }
  const bowl = bowlAt(x, z);
  if (bowl && bowl.w > 0) h += (bowl.floor - h) * bowl.w;
  // Pools sit in shallow basins so the liquid surface is never buried by the terrain.
  for (const p of POOLS) {
    const d = Math.hypot(x - p.x, z - p.z);
    const w = 1 - smooth(p.radius * 0.6, p.radius + 10, d);
    if (w > 0) h += (rawHeight(p.x, p.z) - POOL_DEPTH - h) * w;
  }
  return h;
}

/** True if (x, z) is inside a flat gameplay spot or pool (plus margin): keep big flora out. */
export function isReserved(x: number, z: number, margin = 0): boolean {
  return onTrail(x, z, margin) || FLAT_SPOTS.some((s) => Math.hypot(x - s.x, z - s.z) < s.radius + margin)
    || CRATERS.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius * 0.8 + margin)
    || Math.hypot(x - BOWL.x, z - BOWL.z) < BOWL.radius * 1.1 + margin
    || POOLS.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + 1 + margin)
    || ZONE7_SITES.caves.some((c) => caveDistance(c, x, z) < 1 + margin);
}

/** Flora glow tints (Art Bible, "Grounded and eerie"): cold mist and bruised flesh, a little amber; no neon bodies. */
const GLOWS = [ORGANIC.mist, ORGANIC.mist, ORGANIC.vein, ORGANIC.amber, ZONE7_SHADE.moss];

interface Fungus { pos: THREE.Vector3; height: number; cap: number; yaw: number; tilt: number; colour: string }

/** Fungus placement for a disc. Exported for tests: deterministic and clear of the spawn and pool. */
export function scatterFungi(rand: () => number, opts: { count: number; minR: number; maxR: number; height: [number, number]; cap: [number, number] }, at: (x: number, z: number) => number, centre = new THREE.Vector3()): Fungus[] {
  const out: Fungus[] = [];
  let guard = 0;
  while (out.length < opts.count && guard++ < opts.count * 20) {
    const a = rand() * Math.PI * 2;
    const d = opts.minR + Math.sqrt(rand()) * (opts.maxR - opts.minR);
    const x = centre.x + Math.cos(a) * d, z = centre.z + Math.sin(a) * d;
    if (centre.lengthSq() === 0 && isReserved(x, z, opts.cap[1] > 1 ? 3 : -2)) continue;
    const t = rand();
    const height = opts.height[0] + t * (opts.height[1] - opts.height[0]);
    out.push({
      pos: new THREE.Vector3(x, at(x, z) - 0.15, z), height, cap: opts.cap[0] + t * (opts.cap[1] - opts.cap[0]) * (0.7 + rand() * 0.6),
      yaw: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.25, colour: GLOWS[Math.floor(rand() * GLOWS.length)],
    });
  }
  return out;
}

const BEND = 0.22;

function fungusMeshes(list: Fungus[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'fungi';
  const stems = new THREE.InstancedMesh(stemGeometry(BEND, 8), fungusStem(), list.length);
  const caps = new THREE.InstancedMesh(capGeometry(20), fungusCap(), list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), top = new THREE.Vector3(), col = new THREE.Color();
  list.forEach((f, i) => {
    e.set(f.tilt, f.yaw, f.tilt * 0.5);
    q.setFromEuler(e);
    const w = Math.max(0.6, f.cap * 0.9);
    m.compose(f.pos, q, s.set(w, f.height, w));
    stems.setMatrixAt(i, m);
    top.set(BEND, 0.97, 0).applyMatrix4(m);
    e.set(f.tilt * 2, f.yaw, -0.18 + f.tilt);
    q.setFromEuler(e);
    caps.setMatrixAt(i, m.compose(top, q, s.set(f.cap, f.cap * 0.85, f.cap)));
    col.set(f.colour);
    stems.setColorAt(i, col);
    caps.setColorAt(i, col);
  });
  stems.castShadow = caps.castShadow = false;
  g.add(stems, caps);
  return g;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: { pos: THREE.Vector3; scale: number; yaw: number; colour: string; tilt?: number }[], name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), col = new THREE.Color();
  items.forEach((it, i) => {
    q.setFromEuler(e.set(it.tilt ?? 0, it.yaw, (it.tilt ?? 0) * 0.7));
    mesh.setMatrixAt(i, m.compose(it.pos, q, s.setScalar(it.scale)));
    mesh.setColorAt(i, col.set(it.colour));
  });
  mesh.name = name;
  return mesh;
}

/** Drifting medusoid floaters: tri-lobed bells with a pulsing core and trailing veined tendrils. */
function floater(rand: () => number, colour: string, size: number): THREE.Group {
  const g = new THREE.Group();
  const bellGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = bellGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
    const lobe = 1 + 0.18 * Math.cos(Math.atan2(z, x) * 3) * (1 - y);
    p.setXYZ(i, x * lobe, y * 0.8, z * lobe);
  }
  bellGeo.computeVertexNormals();
  const bell = new THREE.Mesh(bellGeo, membrane(colour, 0.6));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), bioNode(colour, 3));
  core.position.y = 0.3;
  g.add(bell, core);
  const tendrilMat = membrane(colour, 0.5);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = 0.55 + rand() * 0.3;
    const len = 3 + rand() * 4;
    const pts = [0, 1, 2, 3, 4].map((k) => new THREE.Vector3(Math.cos(a) * r * (1 - k * 0.1) + Math.sin(k * 1.7 + i) * 0.25, -k * (len / 4), Math.sin(a) * r * (1 - k * 0.1) + Math.cos(k * 1.3 + i) * 0.25));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.05 + rand() * 0.04, 5), tendrilMat));
  }
  g.scale.setScalar(size);
  const base = new THREE.Vector3();
  const phase = rand() * 10;
  const animate = () => {
    if (base.lengthSq() === 0) base.copy(g.position);
    const t = bioTime.value + phase;
    g.position.set(base.x + Math.sin(t * 0.11) * 4, base.y + Math.sin(t * 0.6) * 1.2, base.z + Math.cos(t * 0.09) * 4);
    g.scale.set(size * (1 + Math.sin(t * 1.8) * 0.05), size * (1 - Math.sin(t * 1.8) * 0.06), size * (1 + Math.sin(t * 1.8) * 0.05));
    g.updateMatrixWorld();
  };
  // onBeforeRender only fires on renderables, so hang the group's animation on the bell.
  bell.onBeforeRender = animate;
  return g;
}

interface IslandSpec { pos: THREE.Vector3; radius: number; falls?: boolean }

/** Two far islands only: the map is ground you drop onto, not a platform hovering in a void. */
const FLOATING: IslandSpec[] = [
  { pos: new THREE.Vector3(-46, 136, -529), radius: 57, falls: true },
  { pos: new THREE.Vector3(218, 176, -644), radius: 51 },
];

function fall(from: THREE.Vector3, outward: THREE.Vector3, drop: number, width: number): THREE.Mesh {
  const o = outward.clone().setY(0).normalize();
  const curve = new THREE.CatmullRomCurve3([
    from.clone(),
    from.clone().addScaledVector(o, width * 0.6).add(new THREE.Vector3(0, -0.5, 0)),
    from.clone().addScaledVector(o, width * 1.1).add(new THREE.Vector3(0, -drop * 0.25, 0)),
    from.clone().addScaledVector(o, width * 1.4).add(new THREE.Vector3(0, -drop, 0)),
  ]);
  const mesh = new THREE.Mesh(ribbonGeometry(curve, width, 80, 1.3), liquidLight({ flow: 0.5, fall: true }));
  mesh.name = 'liquid-light-fall';
  return mesh;
}

/** Liquid light spilling down the rim mountains and running in over the ground to a pool. */
function rimCascade(pd: { x: number; z: number; radius: number }, level: number): THREE.Mesh {
  const r = Math.hypot(pd.x, pd.z), dx = pd.x / r, dz = pd.z / r;
  const pts: THREE.Vector3[] = [];
  const from = ISLAND_RADIUS * 0.98, to = r + pd.radius * 0.6;
  for (let i = 0; i <= 28; i++) {
    const d = from + (to - from) * (i / 28);
    const x = dx * d, z = dz * d;
    pts.push(new THREE.Vector3(x, Math.max(rawHeight(x, z) + 0.25, level + 0.05), z));
  }
  const mesh = new THREE.Mesh(ribbonGeometry(new THREE.CatmullRomCurve3(pts), 3.2, 120, 1.8), liquidLight({ flow: 0.6, fall: true, a: ZONE7_SHADE.rockDeep, b: ZONE7_SHADE.moss, c: ORGANIC.mist }));
  mesh.name = 'rim-cascade';
  return mesh;
}

/** Inner terrain grid radius; the mountain ring takes over beyond it. */
const MOUNTAIN_SEAM = ISLAND_RADIUS * 1.05;

function mountainGeometry(): THREE.BufferGeometry {
  const rings = 70, segs = 192, inner = MOUNTAIN_SEAM - 12, outer = 1100;
  const geo = new THREE.BufferGeometry();
  const posArr: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    // Rings bunch up near the seam (where you see them close) and spread out toward the horizon.
    const t = j / rings, r = inner + (outer - inner) * t * t;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      posArr.push(x, groundHeight(x, z), z);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + segs + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

type Area = (typeof ZONE7_SITES.areas)[number];
const AREAS = ZONE7_SITES.areas;

/** Worn trails between the named areas (data/zone7.json `trails`), wandering a little. */
export const TRAILS: [number, number][][] = ZONE7_SITES.trails.map((ids) => wanderingTrail(ids.map((id) => {
  const a = AREAS.find((q) => q.id === id);
  if (!a) throw new Error(`trail names unknown area ${id}`);
  return [a.x, a.z] as [number, number];
}), (x, z) => noise3(x * 0.05, 4.4, z * 0.05)));

let ecology: Ecology | null = null;
/** Glowmire's ground ecology (src/world/ecology.ts), baked on first use. */
export function zone7Ecology(): Ecology {
  ecology ??= bakeEcology({ height: groundHeight, pools: POOLS, valleys: VALLEYS, ridges: RIDGES, trails: TRAILS, noise: (x, z) => noise3(x * 0.045, 9.3, z * 0.045), extent: ISLAND_RADIUS });
  return ecology;
}

/** True within a trail's worn strip (plus margin): big flora and rock keep off the routes. */
export function onTrail(x: number, z: number, margin = 0): boolean {
  return Math.hypot(x, z) < ISLAND_RADIUS && zone7Ecology().trailDist(x, z) < 1.8 + margin * 0.5;
}

export interface Outcrop { x: number; z: number; y: number; size: number; yaw: number; tilt: number }

/**
 * Bare rock breaking through where the ground is steep or along the ridge flanks (data/zone7.json `outcrops`),
 * in small clusters that work as hard cover between the areas. Kept off trails, sites, pools and the caves.
 */
export function outcrops(rand: () => number): Outcrop[] {
  const o = ZONE7_SITES.outcrops, eco = zone7Ecology();
  const centres: [number, number][] = [];
  for (let tries = 0; centres.length < o.clusters && tries < 4000; tries++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * ISLAND_RADIUS * 0.8;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const flank = RIDGES.some((r) => { const q = polyDist(x, z, r.points).d; return q > r.halfWidth * 0.3 && q < r.halfWidth * 1.3; });
    if (eco.slope(x, z) < 0.2 && !flank && rand() > 0.12) continue;
    if (isReserved(x, z, 4) || ZONE7_SITES.caves.some((c) => caveDistance(c, x, z) < 6)) continue;
    if (centres.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < o.spacing)) continue;
    centres.push([x, z]);
  }
  const out: Outcrop[] = [];
  for (const [cx, cz] of centres) {
    const n = o.rocks[0] + Math.floor(rand() * (o.rocks[1] - o.rocks[0] + 1));
    for (let i = 0; i < n; i++) {
      const size = o.size[0] + (o.size[1] - o.size[0]) * (i === 0 ? 0.6 + rand() * 0.4 : rand() * 0.6);
      const a = rand() * Math.PI * 2, d = i === 0 ? 0 : 1.2 + rand() * 2.2;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (isReserved(x, z, size)) continue;
      out.push({ x, z, y: groundHeight(x, z) - size * 0.25, size, yaw: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.4 });
    }
  }
  return out;
}

/** One weathered boulder shape, sheared and dented so instances do not read as spheres. */
function boulderGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const b = 0.78 + noise3(x * 1.7 + 3, y * 1.7, z * 1.7) * 0.42 + noise3(x * 5, y * 5, z * 5) * 0.08;
    p.setXYZ(i, x * b * 1.15, Math.max(-0.3, y * b * 0.72), z * b);
  }
  g.computeVertexNormals();
  return g;
}

/** A point in an area, denser toward its middle; null if it lands in a reserved gameplay spot. */
function inArea(rand: () => number, a: { x: number; z: number; radius: number }, spread = 1, margin = 0): [number, number] | null {
  const ang = rand() * Math.PI * 2, d = a.radius * spread * Math.sqrt(rand()) * (0.4 + 0.6 * rand());
  const x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
  return isReserved(x, z, margin) ? null : [x, z];
}

function fungusAt(rand: () => number, x: number, z: number, height: [number, number], cap: [number, number], colour?: string): Fungus {
  const t = rand();
  return {
    pos: new THREE.Vector3(x, groundHeight(x, z) - 0.15, z), height: height[0] + t * (height[1] - height[0]),
    cap: cap[0] + t * (cap[1] - cap[0]) * (0.7 + rand() * 0.6), yaw: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.25,
    colour: colour ?? GLOWS[Math.floor(rand() * GLOWS.length)],
  };
}

/** Every fungus on the island, area by area. Each grove keeps one colour family so it reads as a place. */
export function areaFungi(rand: () => number): Fungus[] {
  const out: Fungus[] = [];
  const add = (a: { x: number; z: number; radius: number }, n: number, h: [number, number], c: [number, number], spread: number, margin: number, colours: string[]) => {
    for (let i = 0, tries = 0; i < n && tries < n * 8; tries++) {
      const p = inArea(rand, a, spread, margin);
      if (p) { out.push(fungusAt(rand, p[0], p[1], h, c, colours[i % colours.length])); i++; }
    }
  };
  AREAS.forEach((a: Area, k) => {
    const family = [[ORGANIC.mist, ZONE7_SHADE.moss], [ORGANIC.vein, ORGANIC.wetFlesh], [ORGANIC.mist, ORGANIC.amber]][k % 3];
    if (a.dress.includes('giantFungi')) {
      add(a, 6, [9, 17], [3.5, 7], 0.75, 3, family);
      add(a, 22, [1.6, 4.5], [0.8, 1.9], 1, 1, family);
      add(a, 60, [0.25, 0.9], [0.18, 0.5], 1.15, -2, family);
    }
    if (a.dress.includes('fungi')) {
      add(a, 14, [1.4, 4], [0.7, 1.8], 1, 1, family);
      add(a, 40, [0.25, 0.9], [0.18, 0.5], 1.1, -2, family);
    }
    if (a.dress.includes('meadow')) add(a, 70, [0.25, 1.1], [0.18, 0.6], 1.2, -2, family);
  });
  // Pool fringes so they glow like reference 04.
  for (const pd of POOLS) for (let i = 0; i < 40; i++) {
    const ang = rand() * Math.PI * 2, d = pd.radius + 0.5 + rand() * 4;
    out.push(fungusAt(rand, pd.x + Math.cos(ang) * d, pd.z + Math.sin(ang) * d, [0.4, 2], [0.25, 0.95], i % 2 ? ORGANIC.vein : ORGANIC.mist));
  }
  // Valley banks: a broken line of mid fungi on each side of the run marks the path from the pools to the bowl.
  for (const v of VALLEYS) {
    for (let i = 0; i < v.points.length - 1; i++) {
      const [ax, az] = v.points[i], [bx, bz] = v.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let s = 0; s < len; s += 7) {
        for (const side of [-1, 1]) {
          if (rand() < 0.35) continue;
          const off = side * v.halfWidth * (1.05 + rand() * 0.4);
          const x = ax + ((bx - ax) * s) / len + nx * off, z = az + ((bz - az) * s) / len + nz * off;
          if (!isReserved(x, z, 2)) out.push(fungusAt(rand, x, z, [1.6, 5.5], [0.8, 2.2], side > 0 ? ORGANIC.mist : ORGANIC.vein));
        }
      }
    }
  }
  // A sparse sprinkle of small growth between areas so open ground is never bare.
  for (let i = 0; i < 260; i++) {
    const ang = rand() * Math.PI * 2, d = 6 + Math.sqrt(rand()) * ISLAND_RADIUS * 0.82;
    const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
    if (!isReserved(x, z, -2)) out.push(fungusAt(rand, x, z, [0.25, 0.8], [0.18, 0.45]));
  }
  return out;
}

/** Crystal clusters and bone litter by area, plus ridge crests. */
function areaShards(rand: () => number): { crystals: { pos: THREE.Vector3; scale: number; yaw: number; tilt: number; colour: string }[]; shards: { pos: THREE.Vector3; scale: number; yaw: number; tilt: number; colour: string }[] } {
  const crystals: ReturnType<typeof areaShards>['crystals'] = [], shards: ReturnType<typeof areaShards>['shards'] = [];
  const put = (x: number, z: number, bone: boolean, big = 1) => {
    const scale = (0.35 + rand() * rand() * 1.8) * big;
    const item = { pos: new THREE.Vector3(x, groundHeight(x, z) - 0.25 * scale - 0.1, z), scale, yaw: rand() * 6.28, tilt: (rand() - 0.5) * 1.1 };
    if (bone) shards.push({ ...item, scale: scale * 1.3, colour: rand() < 0.6 ? HIVE.bone : ZONE7_SHADE.rock });
    else crystals.push({ ...item, colour: rand() < 0.7 ? ORGANIC.mist : ORGANIC.amber });
  };
  for (const a of AREAS) {
    if (a.dress.includes('crystals')) for (let i = 0; i < 34; i++) { const p = inArea(rand, a, 1, 1); if (p) put(p[0], p[1], rand() < 0.2, 1.2); }
    if (a.dress.includes('bones')) for (let i = 0; i < 40; i++) { const p = inArea(rand, a, 1.25, 0.5); if (p) put(p[0], p[1], true, 1.1); }
  }
  for (const rg of RIDGES) {
    for (let i = 0; i < rg.points.length - 1; i++) {
      const [ax, az] = rg.points[i], [bx, bz] = rg.points[i + 1];
      for (let t = 0; t < 1; t += 0.06) {
        const x = ax + (bx - ax) * t + (rand() - 0.5) * 6, z = az + (bz - az) * t + (rand() - 0.5) * 6;
        if (!isReserved(x, z, 1)) put(x, z, rand() < 0.45, 1.4);
      }
    }
  }
  for (let i = 0; i < 90; i++) {
    const ang = rand() * Math.PI * 2, d = 8 + Math.sqrt(rand()) * ISLAND_RADIUS * 0.8;
    const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
    if (!isReserved(x, z, 1)) put(x, z, rand() < 0.5, 0.7);
  }
  return { crystals, shards };
}

export interface Zone7World { layout: Zone7Layout; sites: SiteDressing; structures: BuiltStructures }

/**
 * Zone 7: one floating island over the void, bioluminescent flora, cosmic sky, and the raid's sites
 * (Seed Spire pads, Brood Heart crater, Gene Blooms, the anomaly) from `layout`. `seed` drives the dressing only.
 */
export function buildZone7(scene: THREE.Scene, layout: Zone7Layout = zone7Layout(1), seed = 7): Zone7World {
  const rand = mulberry32(seed);

  // Sky: baked to a cubemap (background + image-based lighting) by the render pipeline on first frame.
  const sky = zone7Sky();
  sky.userData.bake = true;
  scene.add(sky);
  scene.background = new THREE.Color(ZONE7.void);
  scene.fog = new THREE.FogExp2(ZONE7_SHADE.skyHorizon, 0.0016);

  // A cool moonlight key (the shadow caster on the high tier) over a soft cyan/violet sky fill; the magenta rim
  // is an accent, so form comes from light and shadow rather than coloured glow.
  scene.add(new THREE.HemisphereLight(ORGANIC.mist, ZONE7_SHADE.rockDeep, 1.4));
  const key = new THREE.DirectionalLight(ORGANIC.mist, 2.3);
  key.position.set(60, 80, -120);
  const rim = new THREE.DirectionalLight(ORGANIC.wetFlesh, 0.5);
  rim.position.set(-120, 40, 80);
  scene.add(key, rim);

  // Main island surface and the craggy spire hanging beneath it.
  const ringGeo = new THREE.PlaneGeometry(ISLAND_RADIUS * 2.2, ISLAND_RADIUS * 2.2, 220, 220);
  ringGeo.rotateX(-Math.PI / 2);
  const pos = ringGeo.attributes.position;
  // The fine inner grid stops at the mountains' foot; its corners tuck under the coarser mountain ring.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z) - (Math.hypot(x, z) > MOUNTAIN_SEAM ? 30 : 0));
  }
  ringGeo.computeVertexNormals();
  const ground = new THREE.Mesh(ringGeo, zoneRock({ veinColour: ORGANIC.vein, mossColour: ORGANIC.mist }));
  ground.name = 'ground';
  scene.add(ground);
  const rockMat = zoneRock({ veinColour: ORGANIC.vein });
  // The mountains that wall the basin: a coarser ring from the seam out past the fog, so the island reads as a valley
  // floor among peaks rather than a platform over the void.
  const mountains = new THREE.Mesh(mountainGeometry(), zoneRock({ veinColour: ORGANIC.vein, mossColour: ZONE7_SHADE.moss, scale: 2.4 }));
  mountains.name = 'mountains';
  scene.add(mountains);

  // Liquid-light pools; the rim pool spills into the void as a fall.
  for (const [k, pd] of POOLS.entries()) {
    const level = poolLevel(pd);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(pd.radius, 48).rotateX(-Math.PI / 2), liquidLight({ pool: true, a: ZONE7_SHADE.rockDeep, b: ZONE7_SHADE.moss, c: ORGANIC.mist, flow: 0.25 }));
    pool.position.set(pd.x, level, pd.z);
    pool.name = `liquid-light-pool-${k}`;
    scene.add(pool);
    const light = new THREE.PointLight(ORGANIC.mist, 22, 24, 2);
    light.position.set(pd.x, level + 2.5, pd.z);
    scene.add(light);
    if (pd.fall) scene.add(rimCascade(pd, level));
  }

  // Flora, placed by area: giant stands in the named groves, fringes round the pools, lines along the valley banks.
  // Open ground between areas stays mostly clear so each place reads on its own (data/zone7.json `areas`).
  const structures = buildStructures(scene);
  const fungi = areaFungi(rand);
  // Inside the Fungal Caves: low glowing growth, a few tall stems reaching for the roof.
  for (const g of structures.caveGlow) fungi.push(fungusAt(rand, g.x, g.z, g.big ? [3, 5] : [0.3, 1.6], g.big ? [1.2, 2] : [0.2, 0.8], ORGANIC.mist));
  // Floating islands with their own flora and falls.
  for (const [k, isl] of FLOATING.entries()) {
    const mesh = new THREE.Mesh(floatingIslandGeometry(seed + k * 13, 2 + rand() * 1.5), rockMat);
    mesh.scale.setScalar(isl.radius);
    mesh.position.copy(isl.pos);
    mesh.rotation.y = rand() * Math.PI * 2;
    scene.add(mesh);
    const topY = isl.pos.y + ISLAND_TOP * isl.radius * 0.5;
    fungi.push(...scatterFungi(rand, { count: Math.round(isl.radius * 0.9), minR: 0, maxR: isl.radius * 0.7, height: [1.5, isl.radius * 0.35], cap: [0.8, isl.radius * 0.14] }, () => topY, isl.pos));
    if (isl.falls) {
      const dir = new THREE.Vector3(-isl.pos.x, 0, -isl.pos.z).normalize();
      scene.add(fall(isl.pos.clone().setY(topY).addScaledVector(dir, isl.radius * 0.75), dir, 200, Math.min(10, isl.radius * 0.18)));
    }
  }
  scene.add(fungusMeshes(fungi));

  // Crystal fields and bone litter, also by area: crystals on the ridge crests, the lens basin and the run; old bone
  // round the crater and the wreck; a sparse sprinkle elsewhere so nothing looks pasted on.
  const { crystals, shards } = areaShards(rand);
  scene.add(instanced(crystalClusterGeometry(rand, 6), crystal(), crystals, 'crystals'));
  scene.add(instanced(crystalClusterGeometry(rand, 4), oldBone(ORGANIC.mist, 0.15), shards, 'bone-shards'));

  // Rock outcrops on the slopes and ridge flanks: hard cover between the areas, colliders for the bigger stones.
  const rocks = outcrops(rand);
  const rockMesh = new THREE.InstancedMesh(boulderGeometry(), zoneRock({ veinColour: ORGANIC.vein, mossColour: ZONE7_SHADE.moss, scale: 1.8 }), rocks.length);
  rockMesh.name = 'outcrops';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  rocks.forEach((r, i) => {
    rockMesh.setMatrixAt(i, m4.compose(new THREE.Vector3(r.x, r.y, r.z), q.setFromEuler(e.set(r.tilt, r.yaw, r.tilt * 0.5)), new THREE.Vector3(r.size, r.size, r.size)));
    if (r.size > 0.9) SOLIDS.add({ cx: r.x, cz: r.z, hx: r.size * 0.8, hz: r.size * 0.7, yaw: r.yaw, y0: r.y - 1, y1: r.y + r.size * 0.75, tag: 'outcrop' });
  });
  rockMesh.castShadow = true;
  scene.add(rockMesh);
  const pustules = [];
  for (let i = 0; i < 1400; i++) {
    const a = rand() * Math.PI * 2, d = 4 + Math.sqrt(rand()) * ISLAND_RADIUS * 0.84;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const s = 0.08 + rand() * 0.22;
    pustules.push({ pos: new THREE.Vector3(x, groundHeight(x, z) + s * 0.3, z), scale: s, yaw: 0, colour: rand() < 0.5 ? ORGANIC.amber : ORGANIC.vein });
  }
  const pustuleMesh = instanced(new THREE.SphereGeometry(1, 8, 6), bioNode(ORGANIC.amber), pustules, 'pustules');
  scene.add(pustuleMesh);

  // Dense foreground growth around the viewer (reference 04's busy ground); clear of pools, pads, nodes and the crater bed.
  const clear = clearings(layout);
  const eco = zone7Ecology();
  scene.add(groundCover({
    height: groundHeight,
    density: (x, z) => eco.density(x, z),
    tints: [ORGANIC.mist, ORGANIC.amber, ORGANIC.vein, ZONE7_SHADE.moss],
    exclude: (x, z) => POOLS.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + 0.6) || clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius) || Math.hypot(x - CATALOGUE.spire.x, z - CATALOGUE.spire.z) < 8.8 || Math.hypot(x - CATALOGUE.debris.x, z - CATALOGUE.debris.z) < CATALOGUE.debris.radius || ZONE7_SITES.caves.some((c) => caveDistance(c, x, z) < 0.5),
  }).group);

  // Gameplay sites for this raid.
  const sites = buildSites(layout, groundHeight, seed);
  scene.add(sites.group);

  // A handful of real lights where the glow is strongest; everything else is emissive + bloom.
  const big = fungi.filter((f) => f.height > 9).sort((a, b) => b.height - a.height).slice(0, 6);
  for (const f of big) {
    const l = new THREE.PointLight(f.colour, 40, 26, 2);
    l.position.copy(f.pos).add(new THREE.Vector3(0, f.height * 0.85, 0));
    scene.add(l);
  }

  // Floaters in the sky lanes.
  for (let i = 0; i < 14; i++) {
    const f = floater(rand, i % 2 ? ORGANIC.vein : ORGANIC.mist, 1.5 + rand() * 2.5);
    const a = -Math.PI / 2 + (rand() - 0.5) * 3.2, d = 30 + rand() * 220;
    f.position.set(Math.cos(a) * d, 16 + rand() * 45, Math.sin(a) * d);
    scene.add(f);
  }

  // Cosmos: one small, far planet (no ring, no second moon), a sea of cloud far below, drifting spores.
  const lightDir = new THREE.Vector3(1, 0.4, 0.6);
  const giant = planet({ radius: 34, band: ORGANIC.mist, rim: ORGANIC.mist, lightDir, seed: 3 });
  giant.position.set(-520, 470, -1060);
  // Distant ridges and mesas rising out of the valley mist: the island reads as a plateau in a larger world.
  scene.add(giant, cloudSea(-240), starField(rand), horizonLands({ seed, lightDir }));
  scene.add(sporeField(rand, 700, 60, 40, [ORGANIC.mist, ORGANIC.amber, ZONE7.lime]));

  return { layout, sites, structures };
}

/** The Reliquary's arena once the zone is built (PvE AI's boss reads it); null before buildZone7 runs. */
export let reliquaryArena: ArenaInfo | null = null;
/** The Pale Vigil's lair in the Fungal Caves once the zone is built (PvE AI's boss reads it); null before. */
export let paleVigilLair: CaveLair | null = null;

/** Builds the enterable structures and their colliders (SOLIDS is reset first). */
export function buildStructures(scene: THREE.Scene): BuiltStructures & { caveGlow: { x: number; z: number; big: boolean }[] } {
  SOLIDS.clear();
  const group = new THREE.Group();
  group.name = 'structures';
  const sp = CATALOGUE.spire;
  const spire = hollowSpire(SOLIDS, sp.x, sp.z, sp.yaw, groundHeight);
  rootSkirt(spire.group, 8.6, 14, 5);
  const bowl = reliquaryBowl(SOLIDS, BOWL.x, BOWL.z, BOWL.yaw, BOWL.radius, bowlFloor(), groundHeight);
  const db = CATALOGUE.debris;
  const debris = longSeedDebris(SOLIDS, db.x, db.z, db.yaw, groundHeight);
  const cv = ZONE7_SITES.caves[0];
  const cave = fungalCaves(SOLIDS, cv, groundHeight(cv.x, cv.z));
  paleVigilLair = cave.lair;
  group.add(spire.group, bowl.group, debris.group, cave.group);
  reliquaryArena = bowl.arena;
  scene.add(group);
  return {
    group,
    loot: [...spire.loot, ...debris.loot, ...cave.loot],
    caveGlow: cave.glow,
    arena: bowl.arena,
    lair: cave.lair,
    breakPillar(id) {
      bowl.arena.pillars.find((p) => p.id === id)?.destroy();
    },
  };
}
