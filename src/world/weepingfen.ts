import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HIVE, ORGANIC, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, bioTime, fungusCap, grownWall, membrane, zoneRock } from '../render/materials';
import { capGeometry, noise3 } from '../render/geometry';
import { lightShaft } from '../render/atmos';
import { zone7Sky } from '../render/sky';
import { groundCover } from '../render/cover';
import FEN_JSON from '../../data/weepingfen.json';
import { mulberry32 } from './rng';
import type { Collider } from './collision';
import { oldBone, type BuiltStructures, type LootSpot } from './structures';
import type { SiteDressing } from './sites';
import type { ExtractSite, PodSite, Site, SpawnPlacement, Zone7Layout } from './layout';
import { SOLIDS, setTerrain } from './zone7';
import { FEN_WATER_Y, fenBark, fenMud, fenWater } from './fenmaterials';

/**
 * The Weeping Fen (World & Level): a drowned forest of giant root-footed trees. Design's zone `weepingFen`
 * (docs/gdd/10-new-zones.md); every position is in data/weepingfen.json.
 *
 * The ground is mud under still water (surface y 0): knee-deep shallows, darker channels, raised moss islets.
 * Titan trees stand on arching prop roots; one of them, the Hollow Elder, has a dwelling grown into its trunk (the
 * Root Hut: a ground room, an outside ramp spiralling up to an upper room with windows). Stilt Village is huts on
 * platforms joined by boardwalks. Spider Hollow is an old campfire under the Elder, webbed over. The Drowned Pod is
 * a seedship pod sunk on its side. The Regent's Pool is a deep black pool ringed by drowned bone arches (the boss
 * arena). Mist, canopy and hanging moss keep it dark; glow is lichen, fungus and one fire (Art Bible standing rule).
 */

type XZ = { x: number; z: number };
interface Islet extends XZ { id: string; radius: number; height: number }
interface Channel { id: string; halfWidth: number; points: [number, number][] }
interface Titan extends XZ { id: string; radius: number; height: number; roots: number; hollow?: boolean }
interface Grove extends XZ { id: string; radius: number; trees: number; caps?: boolean }
interface Hut extends XZ { id: string; radius: number; yaw: number }
interface Log { id: string; x0: number; z0: number; x1: number; z1: number; radius: number }
interface Area extends XZ { id: string; label: string; radius: number }
interface FenData {
  radius: number;
  water: { level: number; shallow: number; channel: number; mudRise: number };
  spawn: XZ;
  extracts: { id: string; label: string; x: number; z: number; opensAt: number | null }[];
  islets: Islet[];
  channels: Channel[];
  titans: Titan[];
  groves: Grove[];
  rootHut: { doorBearing: number; roomRadius: number; deck: number; lookout: number };
  stiltVillage: { deck: number; huts: Hut[]; walks: [string, string][]; ramps: { from: string; x: number; z: number }[] };
  spiderHollow: { fire: XZ; shelters: (XZ & { yaw: number })[] };
  drownedPod: XZ & { yaw: number; length: number; radius: number };
  regentPool: XZ & { radius: number; arches: number; depth: number };
  loot: { id: string; container: string; site: string; onFloorOf: string }[];
  pods: { id: string; type: string; x: number; z: number }[];
  blooms: Site[];
  areas: Area[];
  logs: Log[];
  waders: { count: number; ring: [number, number]; height: [number, number] };
  spawns: SpawnPlacement[];
}

export const FEN = FEN_JSON as unknown as FenData;
/** Container type for a structure loot spot (data/weepingfen.json `loot`, matching Design's habitats.json). */
const lootContainer = (id: string) => FEN.loot.find((l) => l.id === id)?.container ?? 'bioPod';
const deg = (d: number) => (d * Math.PI) / 180;
const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function polyDist(x: number, z: number, pts: [number, number][]): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}

// ------------------------------------------------------------------ terrain

/** The fen floor at (x, z): mud under the water, islets above it, channels and the Regent's Pool below. */
export function fenHeight(x: number, z: number): number {
  const W = FEN.water;
  let h = W.shallow + (noise3(x * 0.045, 0.5, z * 0.045) - 0.5) * 0.35 + (noise3(x * 0.2, 2.5, z * 0.2) - 0.5) * 0.08;
  for (const c of FEN.channels) {
    const d = polyDist(x, z, c.points);
    if (d < c.halfWidth * 2) h += (W.channel - h) * (1 - smooth(c.halfWidth * 0.4, c.halfWidth * 2, d));
  }
  for (const t of FEN.titans) {
    // Roots trap silt: a low mound round every titan, just breaking the surface.
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < t.radius * 3) h += (0.25 - h) * (1 - smooth(t.radius * 1.2, t.radius * 3, d)) * 0.85;
  }
  for (const i of FEN.islets) {
    const dx = x - i.x, dz = z - i.z, d = Math.hypot(dx, dz);
    if (d > i.radius * 1.5) continue;
    const a = Math.atan2(dz, dx);
    const rim = i.radius * (0.85 + 0.3 * noise3(Math.cos(a) * 1.3 + i.x, Math.sin(a) * 1.3, i.z * 0.1));
    const w = 1 - smooth(rim * 0.6, rim * 1.12, d);
    const top = i.height + (noise3(x * 0.15, 4.0, z * 0.15) - 0.5) * 0.35;
    if (w > 0) h += (top - h) * w;
  }
  const p = FEN.regentPool;
  const pd = Math.hypot(x - p.x, z - p.z);
  if (pd < p.radius * 1.4) h += (p.depth - h) * (1 - smooth(p.radius * 0.5, p.radius * 1.3, pd));
  // Past the walkable ring the floor climbs into a bank of roots and mud that walls the fen.
  const r = Math.hypot(x, z);
  if (r > FEN.radius - 6) h += (2.5 + noise3(x * 0.04, 7.0, z * 0.04) * 5 - h) * smooth(FEN.radius - 6, FEN.radius + 22, r);
  return h;
}

/** Which named area of the fen contains (x, z), nearest centre wins; null in between. */
export function fenAreaAt(x: number, z: number): Area | null {
  let best: Area | null = null, bd = Infinity;
  for (const a of FEN.areas) { const d = Math.hypot(x - a.x, z - a.z); if (d <= a.radius && d < bd) { bd = d; best = a; } }
  return best;
}

/** The fen's layout in the Raid's terms. */
export function fenLayout(seed: number): Zone7Layout {
  const extracts: ExtractSite[] = FEN.extracts.map((e) => ({ id: e.id, label: e.label, x: e.x, z: e.z, opensAt: e.opensAt ?? Infinity }));
  const R = FEN.radius - 18;
  return {
    seed,
    spawn: { id: 'spawn', ...FEN.spawn },
    extracts,
    dormantPads: [],
    pods: FEN.pods.map((p): PodSite => ({ id: p.id, x: p.x, z: p.z, type: p.type })),
    nests: [],
    nodes: FEN.blooms.map((b) => ({ id: b.id, x: b.x, z: b.z })),
    anomaly: { id: 'none', kind: 'none', x: 1e5, z: 1e5, radius: 1, gravityMultiplier: 1 },
    area: { x0: -R, x1: R, z0: -R, z1: R },
    playableRadius: FEN.radius,
    // Every creature has a home (Design's habitats.json weepingFen); fenstalkers wait under the water.
    spawns: FEN.spawns.map((s) => ({ ...s })),
  };
}

// ------------------------------------------------------------------ geometry helpers

/**
 * A trunk from y0 to y1 (absolute heights above `base`): radius R tapering with height, root buttresses flaring at
 * the foot (`roots` lobes), slow bark undulation, a lean. Optionally a partial shell (theta range) for the Root Hut.
 */
function trunkGeometry(R: number, H: number, roots: number, seed: number, o: { y0?: number; y1?: number; theta?: [number, number]; flare?: number; radial?: number } = {}): THREE.BufferGeometry {
  const y0 = o.y0 ?? -1.5, y1 = o.y1 ?? H;
  const rings = Math.max(4, Math.round((y1 - y0) / 2.2));
  const geo = new THREE.CylinderGeometry(1, 1, 1, o.radial ?? 22, rings, true, o.theta?.[0] ?? 0, o.theta?.[1] ?? Math.PI * 2);
  geo.translate(0, 0.5, 0);
  const pos = geo.attributes.position;
  const lean = (noise3(seed, 1, 2) - 0.5) * 0.12 * H, leanA = noise3(seed, 3, 4) * Math.PI * 2;
  const flare = o.flare ?? 1;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i), Y = y0 + t * (y1 - y0);
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const lobe = Math.pow(0.5 + 0.5 * Math.cos(a * roots + seed), 3);
    const foot = Math.exp(-Math.max(0, Y) / (R * 0.7)) * (0.25 + 0.95 * lobe) * flare;
    const taper = 1 - 0.5 * Math.min(1, Math.max(0, Y) / H);
    const bark = 1 + (noise3(Math.cos(a) * 2 + seed, Y * 0.12, Math.sin(a) * 2) - 0.5) * 0.16;
    const r = R * taper * (1 + foot) * bark;
    const bend = Math.pow(Math.max(0, Y) / H, 2) * lean;
    pos.setXYZ(i, Math.cos(a) * r + Math.cos(leanA) * bend, Y, Math.sin(a) * r + Math.sin(leanA) * bend);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Tube along points whose radius tapers from r0 to r1. */
function taperedTube(points: THREE.Vector3[], r0: number, r1: number, seg = 18, radial = 7): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / (radial + 1)) / seg;
    curve.getPointAt(t, c);
    v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(r0 + (r1 - r0) * t).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Strip a geometry to position/normal/uv so differently built parts merge. */
function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((out.attributes.position.count) * 2), 2));
  return out;
}

/** Collect parts per material, merge into one mesh each at the end. */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, geo: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    if (m) geo.applyMatrix4(m);
    const list = this.parts.get(mat);
    if (list) list.push(clean(geo)); else this.parts.set(mat, [clean(geo)]);
  }
  meshes(name: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    let k = 0;
    for (const [mat, list] of this.parts) {
      // Merge in chunks so no single buffer gets enormous and frustum culling still has something to cull.
      for (let i = 0; i < list.length; i += 40) {
        const merged = mergeGeometries(list.slice(i, i + 40), false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = `${name}-${k++}`;
        out.push(mesh);
      }
    }
    return out;
  }
}

const M4 = (x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(sx, sy, sz));

/**
 * A solid box whose local +u points along world angle `dir` (radians, atan2(z, x)); optional ramp `rise` along +u.
 * Adds the collider; adds the mesh to `batch` when a material is given.
 */
function solid(batch: Batch | null, mat: THREE.Material | null, cx: number, cz: number, hu: number, hv: number, dir: number, y0: number, y1: number, rise = 0, tag?: string): Collider {
  if (batch && mat) {
    const H = y1 - y0;
    const geo = new THREE.BoxGeometry(hu * 2, H, hv * 2, Math.max(2, Math.round(hu * 2)), Math.max(2, Math.round(H * 1.5)), Math.max(2, Math.round(hv * 2)));
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i);
      if (rise && y > 0) y -= rise * (0.5 - p.getX(i) / (2 * hu));
      p.setY(i, y);
    }
    roughen(geo, Math.min(0.12, Math.min(hu, hv) * 0.6 + 0.03), cx * 0.37 + cz * 0.11, hu, hv);
    geo.computeVertexNormals();
    batch.add(mat, geo, M4(cx, (y0 + y1) / 2, cz, -dir));
  }
  return SOLIDS.add({ cx, cz, hx: hu, hz: hv, yaw: -dir, y0, y1, rise: rise || undefined, tag });
}

/**
 * Organic shapes (Brandon 2026-11-12: grown, sagging, weathered, never clean boxes). Pushes a subdivided box out of
 * true: edges round off, faces bulge and dip with noise, the bottom flares a little like a root. Walkable tops stay
 * level (vertices on the top face only move sideways), so the collider underneath still matches what you stand on.
 */
function roughen(geo: THREE.BufferGeometry, amt: number, seed: number, hu: number, hv: number): void {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!, top = bb.max.y, bot = bb.min.y;
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n1 = noise3(x * 0.9 + seed, y * 0.9, z * 0.9) - 0.5, n2 = noise3(x * 2.3, y * 2.3 + seed, z * 2.3) - 0.5;
    // Round the vertical edges: pull corners in toward the middle of each face.
    const ex = Math.abs(x) / (hu + 1e-6), ez = Math.abs(z) / (hv + 1e-6);
    const corner = Math.max(0, Math.min(ex, ez) - 0.6) * 2.5;
    const flare = 1 + Math.max(0, 1 - (y - bot) / 0.8) * 0.12;
    let nx = x * (1 - corner * amt / (hu + 0.5)) * flare + (n1 + n2 * 0.4) * amt * 1.6;
    let nz = z * (1 - corner * amt / (hv + 0.5)) * flare + (noise3(z * 0.9 - seed, y * 0.9, x * 0.9) - 0.5) * amt * 1.6;
    nx = Math.max(-hu - amt * 2, Math.min(hu + amt * 2, nx)); nz = Math.max(-hv - amt * 2, Math.min(hv + amt * 2, nz));
    const onTop = Math.abs(y - top) < 1e-3 || y > top - 0.01;
    const ny = onTop ? y : y + n2 * amt * 0.8 * (y > bot + 1e-3 ? 1 : 0);
    p.setXYZ(i, nx, ny, nz);
  }
}

/** Octagonal solid (two crossed boxes) for round trunks and platforms. */
function octagon(cx: number, cz: number, r: number, y0: number, y1: number, tag: string): void {
  SOLIDS.add({ cx, cz, hx: r, hz: r, yaw: 0, y0, y1, tag });
  SOLIDS.add({ cx, cz, hx: r, hz: r, yaw: Math.PI / 4, y0, y1, tag });
}

// ------------------------------------------------------------------ build

export interface FenWorld {
  layout: Zone7Layout;
  sites: SiteDressing;
  structures: BuiltStructures;
  landmarkAt(x: number, z: number): string | null;
}

/** The Regent's Pool for PvE AI's boss (Design's mireRegent): centre, water floor, gaps between arches. */
export interface RegentPool { x: number; z: number; radius: number; floorY: number; waterY: number; entrances: XZ[]; arches: XZ[] }
export let regentPool: RegentPool | null = null;

/** Builds the Weeping Fen into `scene`: terrain set to the fen floor, SOLIDS reset. */
export function buildWeepingFen(scene: THREE.Scene, seed: number): FenWorld {
  const rand = mulberry32(seed * 17 + 3);
  const fixed = mulberry32(911); // the forest itself never changes between raids
  setTerrain(fenHeight);
  SOLIDS.clear();
  const layout = fenLayout(seed);
  const root = new THREE.Group();
  root.name = 'weeping-fen';
  const batch = new Batch();
  const loot: LootSpot[] = [];

  // ---- Sky, mist and light: overcast night under a canopy; cold moon key, mossy bounce, fog that eats distance.
  const sky = zone7Sky();
  sky.userData.bake = true;
  scene.add(sky);
  scene.background = new THREE.Color(ZONE7_SHADE.skyHorizon);
  scene.fog = new THREE.FogExp2(ZONE7_SHADE.skyHorizon, 0.0025); // the shared height fog thickens this ~13x at the waterline
  scene.add(new THREE.HemisphereLight(ORGANIC.mist, ZONE7_SHADE.moss, 4.0));
  const moon = new THREE.DirectionalLight(ORGANIC.mist, 7.5);
  moon.position.set(50, 110, -70);
  scene.add(moon);
  // A faint cold back light so trunks separate from the mist behind them.
  const back = new THREE.DirectionalLight(ORGANIC.mist, 1.6);
  back.position.set(-60, 30, 90);
  scene.add(back);

  // ---- Ground and water.
  const span = (FEN.radius + 80) * 2, segs = 200;
  const ground = new THREE.PlaneGeometry(span, span, segs, segs).rotateX(-Math.PI / 2);
  const gp = ground.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, fenHeight(gp.getX(i), gp.getZ(i)));
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(ground, fenMud());
  groundMesh.name = 'ground';
  scene.add(groundMesh);
  const water = new THREE.PlaneGeometry(span, span, 120, 120).rotateX(-Math.PI / 2);
  const wp = water.attributes.position;
  const depth = new Float32Array(wp.count * 3);
  for (let i = 0; i < wp.count; i++) depth[i * 3] = Math.min(1, Math.max(0, (FEN_WATER_Y - fenHeight(wp.getX(i), wp.getZ(i))) / 1.2));
  water.setAttribute('color', new THREE.Float32BufferAttribute(depth, 3));
  water.translate(0, FEN_WATER_Y, 0);
  const waterMesh = new THREE.Mesh(water, fenWater());
  waterMesh.name = 'fen-water';
  waterMesh.renderOrder = 1;
  waterMesh.userData.noShadow = true;
  scene.add(waterMesh);

  // ---- Materials (three shader families of our own plus the zone's shared ones).
  const bark = fenBark({ base: ZONE7_SHADE.rock });
  const paleBark = fenBark({ base: HIVE.bone, deep: ZONE7_SHADE.stem, mossy: 0.5 });
  // Drowned ribs: finer plated, stained bone, a shade darker than the hut bone so they read old, not plastic.
  const ribBone = oldBone(ORGANIC.mist, 0.9);
  ribBone.color.multiplyScalar(0.7);
  ribBone.roughness = 0.75;
  const mossMass = fenBark({ base: ZONE7_SHADE.moss, deep: ZONE7_SHADE.rockDeep, scale: 1.6 });
  const plank = fenBark({ base: ZONE7_SHADE.stem, deep: ZONE7_SHADE.rockDeep, plank: true, mossy: 0.6, scale: 1.4 });
  const hide = fenBark({ base: ZONE7_SHADE.flesh, deep: ZONE7_SHADE.rockDeep, mossy: 0.8, scale: 2.2 });
  const bone = oldBone(ZONE7.cyan, 0.12);
  const caps = fungusCap(ZONE7.cyan);
  const amber = bioNode(ORGANIC.amber, 0.7);

  // Keep-outs: big trees never grow through a built place.
  const keep: (XZ & { r: number })[] = [
    { ...FEN.spawn, r: 12 }, ...FEN.extracts.map((e) => ({ x: e.x, z: e.z, r: 12 })),
    ...FEN.stiltVillage.huts.map((h) => ({ x: h.x, z: h.z, r: h.radius + 5 })),
    { x: FEN.spiderHollow.fire.x, z: FEN.spiderHollow.fire.z, r: 13 },
    { x: FEN.drownedPod.x, z: FEN.drownedPod.z, r: FEN.drownedPod.length * 0.6 },
    { x: FEN.regentPool.x, z: FEN.regentPool.z, r: FEN.regentPool.radius + 5 },
    ...FEN.pods.map((p) => ({ x: p.x, z: p.z, r: 5 })), ...FEN.blooms.map((b) => ({ x: b.x, z: b.z, r: 6 })),
    ...FEN.titans.map((t) => ({ x: t.x, z: t.z, r: t.radius * 2.6 })),
  ];
  const clear = (x: number, z: number, r: number) => keep.every((k) => Math.hypot(x - k.x, z - k.z) > k.r + r)
    && FEN.stiltVillage.walks.every(([a, b]) => {
      const A = hutById(a), B = hutById(b);
      return segDist(x, z, A.x, A.z, B.x, B.z) > r + 2;
    });

  // ---- Trees: the named titans, then each grove's own stand. Moss hangs from branches; canopy masses close the sky.
  const hanging: THREE.Matrix4[] = [];
  const capMats: THREE.Matrix4[] = [];
  function tree(t: { x: number; z: number; radius: number; height: number; roots: number; hollow?: boolean }, s: number, cathedral = false): void {
    const base = fenHeight(t.x, t.z);
    const R = t.radius, H = t.height;
    if (cathedral) {
      // Mushroom-tree: a pale fibrous stalk with a vast cap; gills carry a faint cold light.
      batch.add(paleBark, trunkGeometry(R, H, t.roots, s, { flare: 0.6, radial: 16 }), M4(t.x, base, t.z));
      const capR = R * (4.5 + noise3(s, 9, 1) * 2);
      capMats.push(M4(t.x, base + H * 0.92, t.z, s, capR, capR * 0.55, capR));
      octagon(t.x, t.z, R * 1.1, base - 2, base + H, `cap-tree`);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + s, rr = capR * (0.7 + noise3(s, k, 2) * 0.25);
        hanging.push(M4(t.x + Math.cos(a) * rr, base + H * 0.92, t.z + Math.sin(a) * rr, a, 0.5, 3 + noise3(k, s, 3) * 6, 0.5));
      }
      return;
    }
    if (!t.hollow) {
      batch.add(bark, trunkGeometry(R, H, t.roots, s), M4(t.x, base, t.z));
      octagon(t.x, t.z, R * 1.15, base - 2, base + H * 0.8, `trunk`);
    }
    // Prop roots: arching from the trunk out into the water, the "feet" the fen is named for.
    const nRoots = t.roots + (R > 3 ? 3 : 0);
    for (let k = 0; k < nRoots; k++) {
      const a = (k / nRoots) * Math.PI * 2 + noise3(s, k, 5) * 0.5;
      if (t.hollow && inHollowGap(a)) continue;
      const out = R * (2.0 + noise3(k, s, 7) * 1.1), up = R * (0.8 + noise3(s, k, 8) * 1.2);
      const c = Math.cos(a), sn = Math.sin(a);
      const pts = [
        new THREE.Vector3(t.x + c * R * 0.7, base + up * 1.4, t.z + sn * R * 0.7),
        new THREE.Vector3(t.x + c * R * 1.25, base + up * 1.05, t.z + sn * R * 1.25),
        new THREE.Vector3(t.x + c * out * 0.75, base + up * 0.55, t.z + sn * out * 0.75),
        new THREE.Vector3(t.x + c * out, fenHeight(t.x + c * out, t.z + sn * out) + 0.1, t.z + sn * out),
        new THREE.Vector3(t.x + c * out * 1.06, fenHeight(t.x + c * out, t.z + sn * out) - 1.2, t.z + sn * out * 1.06),
      ];
      batch.add(bark, taperedTube(pts, R * 0.2, R * 0.07, 16, 7));
      const fx = t.x + c * out, fz = t.z + sn * out;
      SOLIDS.add({ cx: fx, cz: fz, hx: R * 0.12 + 0.2, hz: R * 0.12 + 0.2, yaw: a, y0: fenHeight(fx, fz) - 1, y1: fenHeight(fx, fz) + R * 0.35, tag: 'root-foot' });
      // The arch's shoulder: you cannot walk through the root near the trunk.
      const mx = t.x + c * R * 1.4, mz = t.z + sn * R * 1.4;
      SOLIDS.add({ cx: mx, cz: mz, hx: R * 0.35, hz: R * 0.2 + 0.2, yaw: -a, y0: base - 1, y1: base + up * 1.1, tag: 'root' });
    }
    // Branches and canopy.
    const nb = R > 3 ? 5 : 3;
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2 + noise3(s, k, 11) * 1.2;
      const y = H * (0.55 + noise3(k, s, 12) * 0.35), len = R * (2.5 + noise3(s, k, 13) * 2.5);
      const c = Math.cos(a), sn = Math.sin(a);
      const pts = [
        new THREE.Vector3(t.x + c * R * 0.2, base + y, t.z + sn * R * 0.2),
        new THREE.Vector3(t.x + c * len * 0.45, base + y + len * 0.35, t.z + sn * len * 0.45),
        new THREE.Vector3(t.x + c * len, base + y + len * 0.4, t.z + sn * len),
      ];
      batch.add(bark, taperedTube(pts, R * 0.3, R * 0.08, 12, 6));
      const bx = t.x + c * len, bz = t.z + sn * len, by = base + y + len * 0.45;
      const blob = new THREE.IcosahedronGeometry(1, 2);
      const bp = blob.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const n = 0.6 + noise3(bp.getX(i) * 2.2 + s + k, bp.getY(i) * 2.2, bp.getZ(i) * 2.2) * 0.7;
        bp.setXYZ(i, bp.getX(i) * n, bp.getY(i) * n * 0.8, bp.getZ(i) * n);
      }
      blob.computeVertexNormals();
      const br = R * (1.3 + noise3(k, s, 14) * 0.8);
      batch.add(mossMass, blob, M4(bx, by, bz, a, br * 1.3, br, br * 1.3));
      // A second, smaller clump hanging off the first breaks the silhouette.
      batch.add(mossMass, blob.clone(), M4(bx - c * br * 0.9, by - br * 0.35, bz - sn * br * 0.9, a + 1, br * 0.7, br * 0.6, br * 0.7));
      for (let m = 0; m < 6; m++) {
        const ma = noise3(s, k, m + 20) * Math.PI * 2, mr = br * 1.3 * noise3(m, k, s + 21);
        hanging.push(M4(bx + Math.cos(ma) * mr, by - br * 0.3, bz + Math.sin(ma) * mr, ma, 0.35 + R * 0.06, 3 + noise3(m, s, k) * (5 + R), 0.35 + R * 0.06));
      }
      // Shelf fungus brackets on the trunk below each branch.
      if (R > 2.5) {
        const fy = base + 3 + noise3(k, s, 30) * y * 0.6, fr = R * (0.28 + noise3(s, k, 31) * 0.2);
        capMats.push(M4(t.x + c * R * 0.9, fy, t.z + sn * R * 0.9, -a, fr, fr * 0.35, fr));
      }
    }
  }
  FEN.titans.forEach((t, i) => { if (!t.hollow) tree(t, 13 + i * 7.3); });
  let gi = 0;
  for (const g of FEN.groves) {
    let placed = 0;
    for (let tries = 0; placed < g.trees && tries < g.trees * 30; tries++) {
      const a = fixed() * Math.PI * 2, d = Math.sqrt(fixed()) * g.radius;
      const x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
      const R = g.caps ? 1.2 + fixed() * 1.1 : 1.1 + fixed() * 1.6;
      if (Math.hypot(x, z) > FEN.radius - 8 || !clear(x, z, R * 2.2)) continue;
      keep.push({ x, z, r: R * 2.2 });
      tree({ x, z, radius: R, height: g.caps ? 22 + fixed() * 14 : 16 + R * 6 + fixed() * 6, roots: 4 + Math.floor(fixed() * 3) }, 100 + gi++ * 3.1, g.caps);
      placed++;
    }
  }
  // The wall of trunks beyond the walkable ring: dense, dark, half lost in fog.
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + fixed() * 0.1, d = FEN.radius + 8 + fixed() * 40;
    const R = 1.6 + fixed() * 2.6;
    tree({ x: Math.cos(a) * d, z: Math.sin(a) * d, radius: R, height: 22 + R * 6, roots: 5 }, 400 + i * 1.7);
  }

  // ---- The Root Hut: a dwelling grown into the Hollow Elder.
  const elder = FEN.titans.find((t) => t.hollow)!;
  const rh = FEN.rootHut;
  const doorA = deg(rh.doorBearing);
  const rampSweep = deg(150), rampStart = doorA + deg(28);
  const upperA = rampStart + rampSweep + deg(8);
  function inHollowGap(a: number): boolean {
    const da = (b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    return da(doorA) < deg(26) || (da(rampStart + rampSweep / 2) < rampSweep / 2 + deg(14));
  }
  tree(elder, 13);
  {
    const ex = elder.x, ez = elder.z, base = fenHeight(ex, ez);
    const Rout = elder.radius, Rin = rh.roomRadius + 0.6, top = rh.lookout + 1;
    const N = 18, seg = (Math.PI * 2) / N;
    const segOf = (a: number) => ((Math.round((a - seg / 2) / seg) % N) + N) % N;
    const doorSeg = segOf(doorA), upperSeg = segOf(upperA);
    const windowSegs = new Set([(upperSeg + 5) % N, (upperSeg + 9) % N, (upperSeg + 13) % N]);
    // Above the rooms the trunk is solid and climbs on into the canopy.
    batch.add(bark, trunkGeometry(Rout, elder.height, elder.roots, 13, { y0: top - 0.5, flare: 0 }), M4(ex, base, ez));
    octagon(ex, ez, Rout * 1.05, base + top - 0.5, base + elder.height * 0.8, 'elder-upper');
    batch.add(bark, new THREE.CylinderGeometry(Rin + 0.3, Rin + 0.3, 0.6, 24), M4(ex, base + top - 0.2, ez)); // ceiling
    for (let i = 0; i < N; i++) {
      const a0 = i * seg, a = a0 + seg / 2;
      // Wall pieces by height band: [y0, y1] spans where the wall is solid.
      const bands: [number, number][] = i === doorSeg ? [[3.2, top]] : i === upperSeg ? [[-1, rh.deck], [rh.deck + 3, top]]
        : windowSegs.has(i) ? [[-1, rh.deck + 1.2], [rh.deck + 2.6, top]] : [[-1, top]];
      for (const [y0, y1] of bands) {
        batch.add(bark, trunkGeometry(Rout, elder.height, elder.roots, 13, { y0, y1, theta: [Math.PI / 2 - a0 - seg, seg + 0.01], flare: 0, radial: 3 }), M4(ex, base, ez));
        const inner = new THREE.CylinderGeometry(Rin, Rin, y1 - y0, 3, 2, true, Math.PI / 2 - a0 - seg, seg + 0.01);
        batch.add(plank, inner, M4(ex, base + (y0 + y1) / 2, ez));
        const mid = (Rin + Rout) / 2;
        solid(null, null, ex + Math.cos(a) * mid, ez + Math.sin(a) * mid, (Rout - Rin) / 2 + 0.1, mid * Math.tan(seg / 2) + 0.15, a, base + y0, base + y1, 0, 'elder-wall');
      }
      // Jambs where a wall stops at an opening.
      if (i === doorSeg || i === upperSeg || windowSegs.has(i)) {
        for (const edge of [a0, a0 + seg]) {
          const mid = (Rin + Rout) / 2;
          batch.add(plank, new THREE.BoxGeometry(Rout - Rin + 0.4, top + 1, 0.25), M4(ex + Math.cos(edge) * mid, base + top / 2 - 0.5, ez + Math.sin(edge) * mid, -edge));
        }
      }
    }
    // Floors: the ground room on packed earth; the upper room on a plank deck.
    batch.add(plank, new THREE.CylinderGeometry(Rin + 0.2, Rin + 0.2, 0.4, 24), M4(ex, base + rh.deck - 0.2, ez));
    octagon(ex, ez, Rin * 0.95, base + rh.deck - 0.4, base + rh.deck, 'elder-deck');
    batch.add(plank, new THREE.CylinderGeometry(Rin, Rin, 0.6, 24), M4(ex, base - 0.15, ez));
    octagon(ex, ez, Rin * 0.95, base - 0.6, base + 0.15, 'elder-floor');
    // The outside ramp spiralling up from beside the door to the upper doorway.
    const Rr = Rout + 1.5, n = 14, dh = rh.deck / n;
    for (let i = 0; i < n; i++) {
      const a0 = rampStart + (i / n) * rampSweep, a1 = rampStart + ((i + 1) / n) * rampSweep;
      const x0 = ex + Math.cos(a0) * Rr, z0 = ez + Math.sin(a0) * Rr, x1 = ex + Math.cos(a1) * Rr, z1 = ez + Math.sin(a1) * Rr;
      const len = Math.hypot(x1 - x0, z1 - z0) / 2 + 0.2;
      const y0 = base + i * dh;
      solid(batch, plank, (x0 + x1) / 2, (z0 + z1) / 2, len, 1.15, Math.atan2(z1 - z0, x1 - x0), Math.max(base - 0.6, y0 - 0.45), y0 + dh, dh, 'elder-ramp');
      if (i % 2 === 0) {
        // Struts down to the ground and a rope rail on the outer edge.
        const sx = ex + Math.cos(a0) * (Rr + 0.9), sz = ez + Math.sin(a0) * (Rr + 0.9);
        batch.add(bark, new THREE.CylinderGeometry(0.14, 0.2, y0 + 1.6 - fenHeight(sx, sz) + base, 6), M4(sx, (y0 + 1.6 + fenHeight(sx, sz)) / 2, sz));
      }
    }
    // Landing at the upper doorway.
    const lx = ex + Math.cos(upperA) * (Rout + 1.2), lz = ez + Math.sin(upperA) * (Rout + 1.2);
    solid(batch, plank, lx, lz, 1.8, 2.2, upperA, base + rh.deck - 0.4, base + rh.deck, 0, 'elder-landing');
    // A lantern in each room and the lookout's light through the windows.
    const lantern = (x: number, y: number, z: number, power: number) => {
      const l = new THREE.PointLight(ORGANIC.amber, power, 12, 2);
      l.position.set(x, y, z);
      root.add(l);
      batch.add(amber, new THREE.SphereGeometry(0.22, 10, 8), M4(x, y, z));
    };
    lantern(ex - Math.cos(doorA) * 2.5, base + 2.6, ez - Math.sin(doorA) * 2.5, 9);
    lantern(ex + Math.cos(upperA + Math.PI) * 2.5, base + rh.deck + 2.4, ez + Math.sin(upperA + Math.PI) * 2.5, 7);
    for (const w of windowSegs) {
      const a = w * seg + seg / 2;
      root.add(lightShaft({ from: new THREE.Vector3(ex + Math.cos(a) * Rout, base + rh.deck + 2, ez + Math.sin(a) * Rout), to: new THREE.Vector3(ex - Math.cos(a) * 2, base + rh.deck, ez - Math.sin(a) * 2), width: 1, colour: ORGANIC.mist, strength: 0.06 }));
    }
    // Things the dwellers left: a bone frame bed, a table of bark slabs, baskets.
    solid(batch, plank, ex - Math.cos(doorA) * 3.4, ez - Math.sin(doorA) * 3.4, 1.1, 0.6, doorA + Math.PI / 2, base, base + 0.9, 0, 'elder-table');
    loot.push({ id: 'roothut-room', container: lootContainer('roothut-room'), x: ex + Math.cos(doorA + 1.6) * 3, y: base + 0.15, z: ez + Math.sin(doorA + 1.6) * 3 });
    loot.push({ id: 'roothut-lookout', container: lootContainer('roothut-lookout'), x: ex + Math.cos(upperA + Math.PI) * 3, y: base + rh.deck, z: ez + Math.sin(upperA + Math.PI) * 3 });
  }

  // ---- Stilt Village: huts on platforms over the water, boardwalks between, ramps down to the mud.
  function hutById(id: string): Hut { return FEN.stiltVillage.huts.find((h) => h.id === id)!; }
  {
    const D = FEN.stiltVillage.deck;
    for (const h of FEN.stiltVillage.huts) {
      const pr = h.radius + 2.0, yaw = deg(h.yaw);
      const deck = new THREE.CylinderGeometry(pr, pr * 0.94, 0.35, 22, 1);
      { const dp = deck.attributes.position; for (let i = 0; i < dp.count; i++) { const a = Math.atan2(dp.getZ(i), dp.getX(i)), r = Math.hypot(dp.getX(i), dp.getZ(i)); if (r < 0.01) continue; const k = 1 + (noise3(Math.cos(a) * 1.5 + h.x, Math.sin(a) * 1.5, 3) - 0.5) * 0.18; dp.setX(i, dp.getX(i) * k); dp.setZ(i, dp.getZ(i) * k); } deck.computeVertexNormals(); }
      batch.add(plank, deck, M4(h.x, D - 0.17, h.z, yaw));
      octagon(h.x, h.z, pr * 0.93, D - 0.35, D, `${h.id}-deck`);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + yaw, sx = h.x + Math.cos(a) * (pr - 0.4), sz = h.z + Math.sin(a) * (pr - 0.4);
        const g = fenHeight(sx, sz) - 0.8;
        batch.add(bark, new THREE.CylinderGeometry(0.16, 0.22, D - g, 6), M4(sx, (D + g) / 2, sz, k));
        SOLIDS.add({ cx: sx, cz: sz, hx: 0.22, hz: 0.22, yaw: 0, y0: g, y1: D - 0.36, tag: 'stilt' });
      }
      // Walls: grown plank segments in a ring; the door faces the hut's yaw, one window opposite.
      const N = 12, seg = (Math.PI * 2) / N, wallH = 3;
      for (let i = 0; i < N; i++) {
        const a = i * seg + seg / 2 + yaw;
        const off = Math.abs(Math.atan2(Math.sin(a - yaw), Math.cos(a - yaw)));
        const bands: [number, number][] = off < seg * 0.6 ? [[2.2, wallH]] : off > Math.PI - seg * 0.6 ? [[0, 1.1], [2.1, wallH]] : [[0, wallH]];
        for (const [y0, y1] of bands) solid(batch, plank, h.x + Math.cos(a) * h.radius, h.z + Math.sin(a) * h.radius, 0.14, h.radius * Math.tan(seg / 2) + 0.06, a, D + y0, D + y1, 0, `${h.id}-wall`);
      }
      // Hide-and-thatch roof, moss trailing from the eaves.
      // A sagging hide-and-thatch roof: the slope dips between its ribs, the eave droops unevenly, the tip leans.
      const roof = new THREE.ConeGeometry(h.radius + 1.1, 2.8, 28, 7);
      { const rp = roof.attributes.position, R0 = h.radius + 1.1; for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i), r = Math.hypot(x, z) / R0, a = Math.atan2(z, x);
        const sag = Math.sin(Math.PI * r) * (0.35 + 0.25 * Math.cos(a * 6)) + (noise3(x * 0.8 + h.x, y, z * 0.8) - 0.5) * 0.35;
        const droop = r > 0.95 ? (noise3(a * 2 + h.z, 1, 2) - 0.3) * 0.7 : 0;
        const lean = (1.4 - y) / 2.8; // 1 at the eave, 0 at the tip
        rp.setXYZ(i, x * (1 + (noise3(a * 3, h.x, 5) - 0.5) * 0.15) + (1 - lean) * 0.4, y - sag - droop, z * (1 + (noise3(a * 3, h.z, 6) - 0.5) * 0.15));
      } roof.computeVertexNormals(); }
      batch.add(hide, roof, M4(h.x, D + wallH + 1.3, h.z, yaw));
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + yaw + 0.3;
        hanging.push(M4(h.x + Math.cos(a) * (h.radius + 0.9), D + wallH - 0.1, h.z + Math.sin(a) * (h.radius + 0.9), a, 0.25, 1 + noise3(k, h.x, 1) * 1.6, 0.25));
      }
      const l = new THREE.PointLight(ORGANIC.amber, 6, 9, 2);
      l.position.set(h.x, D + 2.3, h.z);
      root.add(l);
      batch.add(amber, new THREE.SphereGeometry(0.16, 8, 6), M4(h.x + Math.cos(yaw + 2.5) * (h.radius - 0.6), D + 2.4, h.z + Math.sin(yaw + 2.5) * (h.radius - 0.6)));
    }
    for (const [a, b] of FEN.stiltVillage.walks) {
      const A = hutById(a), B = hutById(b);
      const dir = Math.atan2(B.z - A.z, B.x - A.x), dist = Math.hypot(B.x - A.x, B.z - A.z);
      const sA = A.radius + 0.9, sB = B.radius + 0.9, len = (dist - sA - sB) / 2;
      const cx = A.x + Math.cos(dir) * (sA + len), cz = A.z + Math.sin(dir) * (sA + len);
      solid(batch, plank, cx, cz, len + 0.3, 0.95, dir, D - 0.25, D, 0, 'boardwalk');
      for (let s = -len; s <= len; s += 3.2) {
        for (const side of [-1, 1]) {
          const px = cx + Math.cos(dir) * s - Math.sin(dir) * side * 1.0, pz = cz + Math.sin(dir) * s + Math.cos(dir) * side * 1.0;
          const g = fenHeight(px, pz) - 0.6;
          batch.add(bark, new THREE.CylinderGeometry(0.1, 0.13, D + 1 - g, 5), M4(px, (D + 1 + g) / 2, pz));
        }
      }
      for (const side of [-1, 1]) {
        const rail = new THREE.CylinderGeometry(0.04, 0.04, len * 2, 4).rotateZ(Math.PI / 2);
        batch.add(bark, rail, M4(cx - Math.sin(dir) * side * 1.0, D + 0.9, cz + Math.cos(dir) * side * 1.0, -dir));
      }
    }
    for (const r of FEN.stiltVillage.ramps) {
      const h = hutById(r.from);
      const dir = Math.atan2(h.z - r.z, h.x - r.x), dist = Math.hypot(h.x - r.x, h.z - r.z) - (h.radius + 1.0);
      const g = fenHeight(r.x, r.z);
      const cx = r.x + Math.cos(dir) * dist / 2, cz = r.z + Math.sin(dir) * dist / 2;
      solid(batch, plank, cx, cz, dist / 2 + 0.2, 1.0, dir, g - 0.6, D, D - g, 'stilt-ramp');
    }
    const hutLoot: Record<string, string> = Object.fromEntries(FEN.loot.filter((l) => l.site.startsWith('stiltHut')).map((l) => [l.site, l.container]));
    for (const h of FEN.stiltVillage.huts) {
      if (!hutLoot[h.id]) continue;
      const yaw = deg(h.yaw);
      loot.push({ id: `stilt-${h.id.slice(-1).toLowerCase()}`, container: hutLoot[h.id], x: h.x - Math.cos(yaw) * (h.radius - 1.4), y: D, z: h.z - Math.sin(yaw) * (h.radius - 1.4) });
    }
  }

  // ---- Spider Hollow: an old campfire under the Elder, still smouldering, the shelters webbed over.
  let fireLight: THREE.PointLight;
  {
    const f = FEN.spiderHollow.fire, g = fenHeight(f.x, f.z);
    const stones = zoneRock({ scale: 3 });
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      batch.add(stones, new THREE.DodecahedronGeometry(0.32, 0), M4(f.x + Math.cos(a) * 1.0, g + 0.1, f.z + Math.sin(a) * 1.0, a, 1, 0.7, 1));
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const log = new THREE.CylinderGeometry(0.12, 0.14, 1.5, 6).rotateZ(Math.PI / 2 - 0.35);
      batch.add(bark, log, M4(f.x + Math.cos(a) * 0.35, g + 0.25, f.z + Math.sin(a) * 0.35, -a));
    }
    // Embers and a low flame: the only warm light in the fen.
    const flameMat = new THREE.MeshBasicMaterial({ color: ORGANIC.amber, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    const flame = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28 - k * 0.06, 0.9 - k * 0.15, 7, 1, true), flameMat);
      cone.position.set((k - 1) * 0.12, 0.45, (k % 2) * 0.1);
      flame.add(cone);
    }
    flame.position.set(f.x, g + 0.1, f.z);
    // Flicker the flame and its light together (a Group never renders itself, so the first cone drives it).
    (flame.children[0] as THREE.Mesh).onBeforeRender = () => {
      const t = bioTime.value;
      flame.scale.set(1, 0.8 + 0.25 * Math.sin(t * 9.1) * Math.sin(t * 3.7), 1);
      fireLight.intensity = 22 + 6 * Math.sin(t * 11.3) * Math.sin(t * 4.1) + 3 * Math.sin(t * 23.0);
    };
    root.add(flame);
    batch.add(amber, new THREE.SphereGeometry(0.5, 10, 6).scale(1, 0.25, 1), M4(f.x, g + 0.05, f.z));
    fireLight = new THREE.PointLight(ORGANIC.amber, 26, 22, 2);
    fireLight.position.set(f.x, g + 1.2, f.z);
    root.add(fireLight);
    const web = membrane(HIVE.bone, 0.18);
    web.side = THREE.DoubleSide;
    for (const s of FEN.spiderHollow.shelters) {
      const yaw = deg(s.yaw), sg = fenHeight(s.x, s.z);
      // A lean-to: two forked posts, a ridge pole, a slab roof sloping to the ground.
      for (const side of [-1, 1]) {
        const px = s.x + Math.cos(yaw + Math.PI / 2) * side * 1.6, pz = s.z + Math.sin(yaw + Math.PI / 2) * side * 1.6;
        batch.add(bark, new THREE.CylinderGeometry(0.09, 0.12, 2.2, 5), M4(px, sg + 1.1, pz));
        SOLIDS.add({ cx: px, cz: pz, hx: 0.15, hz: 0.15, yaw: 0, y0: sg, y1: sg + 2.2, tag: 'shelter-post' });
      }
      const slab = new THREE.BoxGeometry(2.6, 0.12, 3.6).rotateZ(0.7);
      batch.add(plank, slab, M4(s.x - Math.cos(yaw) * 0.9, sg + 1.1, s.z - Math.sin(yaw) * 0.9, -yaw));
      // Webbing strung from the shelter to the nearest roots; egg sacs hang in it.
      for (let k = 0; k < 3; k++) {
        const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.5 + rand() * 2, 2 + rand() * 1.5, 4, 4), web);
        sheet.position.set(s.x + (rand() - 0.5) * 4, sg + 1.4 + rand(), s.z + (rand() - 0.5) * 4);
        sheet.rotation.set((rand() - 0.5) * 0.6, rand() * Math.PI, (rand() - 0.5) * 0.4);
        root.add(sheet);
        const sac = new THREE.Mesh(new THREE.SphereGeometry(0.22 + rand() * 0.12, 10, 8), web);
        sac.position.copy(sheet.position).add(new THREE.Vector3(0, -0.7, 0));
        sac.scale.y = 1.4;
        root.add(sac);
      }
    }
    // A drying rack of old bones by the fire.
    for (let k = 0; k < 3; k++) batch.add(bone, new THREE.CylinderGeometry(0.05, 0.06, 1.8, 5).rotateZ(0.2 * (k - 1)), M4(f.x + 3.2, g + 0.9, f.z - 1 + k));
  }

  // ---- The Drowned Pod: a seedship pod lying on its side in the fen, torn open toward the bank.
  {
    const p = FEN.drownedPod, yaw = deg(p.yaw), L = p.length / 2, R = p.radius;
    const g = fenHeight(p.x, p.z), cy = g - 1.6, deckY = Math.max(0.35, g + 0.3);
    const hull = grownWall({ base: ZONE7_SHADE.stem, seam: ZONE7_SHADE.rockDeep, vein: ZONE7.cyan, plate: 2.0 });
    hull.side = THREE.DoubleSide;
    const shell = new THREE.CylinderGeometry(R, R, L * 2, 24, 6, true, Math.PI * 0.35, Math.PI * 1.3).rotateZ(Math.PI / 2);
    const m = M4(p.x, cy, p.z, yaw);
    batch.add(hull, shell, m);
    for (const end of [-1, 1]) {
      const capGeo = new THREE.SphereGeometry(R, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-end * Math.PI / 2);
      capGeo.translate(end * L, 0, 0);
      batch.add(hull, capGeo, m.clone());
    }
    for (let u = -L + 2; u < L - 1; u += 3.2) {
      const rib = new THREE.TorusGeometry(R + 0.15, 0.22, 6, 18, Math.PI * 1.25).rotateY(Math.PI / 2).rotateX(-Math.PI * 0.4);
      rib.translate(u, 0, 0);
      batch.add(bone, rib, m.clone());
    }
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const at = (u: number, v: number): [number, number] => [p.x + u * co + v * si, p.z - u * si + v * co];
    // Inside: a tilted deck above the water; walls at the back and ends; the open side faces +v (the bank).
    const [fx, fz] = at(0, -0.5);
    solid(batch, plank, fx, fz, L - 1, R * 0.62, -yaw, cy - 0.5, deckY, 0, 'pod-deck');
    const [bx, bz] = at(0, -R * 0.85);
    solid(null, null, bx, bz, L, 0.6, -yaw, g - 1, g + 7, 0, 'pod-back');
    for (const end of [-1, 1]) { const [ex, ez] = at(end * (L + 0.4), 0); solid(null, null, ex, ez, 0.8, R, -yaw, g - 1, g + 6, 0, 'pod-end'); }
    const strip = bioNode(ZONE7.cyan, 0.35);
    for (let u = -L + 3; u < L - 3; u += 4 + rand() * 3) {
      const [sx, sz] = at(u, -R * 0.7);
      batch.add(strip, new THREE.BoxGeometry(1.6 + rand(), 0.06, 0.06), M4(sx, 1.2, sz, yaw));
    }
    const l = new THREE.PointLight(ZONE7.cyan, 10, 14, 2);
    const [lx, lz] = at(0, -R * 0.4);
    l.position.set(lx, 3, lz);
    root.add(l);
    const [ox, oz] = at(L * 0.45, -R * 0.55);
    loot.push({ id: 'pod-hold', container: lootContainer('pod-hold'), x: ox, y: deckY, z: oz });
    const [qx, qz] = at(-L * 0.45, -R * 0.55);
    loot.push({ id: 'pod-bow', container: lootContainer('pod-bow'), x: qx, y: deckY, z: qz });
  }

  // ---- The Regent's Pool: black water ringed by drowned bone arches.
  {
    const p = FEN.regentPool;
    const arches: XZ[] = [], entrances: XZ[] = [];
    for (let k = 0; k < p.arches; k++) {
      const a = (k / p.arches) * Math.PI * 2 + 0.2;
      const x = p.x + Math.cos(a) * p.radius, z = p.z + Math.sin(a) * p.radius;
      const g = fenHeight(x, z);
      const span = 2.6 + noise3(k, 1, 2) * 1.6, sink = 0.6 + noise3(k, 3, 4) * 1.6;
      // A drowned rib: a bent, tapering spine of bone, thicker at one root, sagging off true, knuckled along its back.
      const tx = -Math.sin(a), tz = Math.cos(a), lean = (noise3(k, 5, 6) - 0.5) * 1.6;
      const spine: THREE.Vector3[] = [];
      for (let j = 0; j <= 8; j++) {
        const t = (j / 8) * Math.PI, ox = Math.cos(t) * span * (1 + (noise3(k, j, 7) - 0.5) * 0.25);
        const oy = Math.sin(t) * span * 1.5 * (1 + (noise3(j, k, 8) - 0.5) * 0.3) - sink;
        const out = Math.sin(t) * lean + (noise3(j, k, 9) - 0.5) * 0.5;
        spine.push(new THREE.Vector3(x + tx * ox + Math.cos(a) * out, g + oy, z + tz * ox + Math.sin(a) * out));
      }
      batch.add(ribBone, taperedTube(spine, 0.6 + noise3(k, 2, 2) * 0.2, 0.28, 30, 9));
      const curve = new THREE.CatmullRomCurve3(spine);
      for (let j = 1; j < 9; j++) {
        const q = curve.getPointAt(j / 9), sz = 0.55 - j * 0.03;
        batch.add(ribBone, new THREE.DodecahedronGeometry(sz, 1).scale(1, 0.55, 1.2), M4(q.x, q.y + sz * 0.3, q.z, a + j));
      }
      for (const side of [-1, 1]) {
        const fx = x - Math.sin(a) * side * span, fz = z + Math.cos(a) * side * span;
        SOLIDS.add({ cx: fx, cz: fz, hx: 0.5, hz: 0.5, yaw: a, y0: g - 2, y1: g + span * 1.5 - sink, tag: 'regent-arch' });
      }
      arches.push({ x, z });
      const ea = a + Math.PI / p.arches;
      entrances.push({ x: p.x + Math.cos(ea) * p.radius, z: p.z + Math.sin(ea) * p.radius });
    }
    regentPool = { x: p.x, z: p.z, radius: p.radius, floorY: fenHeight(p.x, p.z), waterY: FEN_WATER_Y, entrances, arches };
  }

  // ---- Fallen logs: walkable bridges over the channels.
  for (const lg of FEN.logs) {
    const dir = Math.atan2(lg.z1 - lg.z0, lg.x1 - lg.x0), len = Math.hypot(lg.x1 - lg.x0, lg.z1 - lg.z0);
    const g0 = fenHeight(lg.x0, lg.z0), g1 = fenHeight(lg.x1, lg.z1);
    const y = Math.max(g0, g1, 0) + lg.radius * 0.5;
    const pts = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(lg.x0 + (lg.x1 - lg.x0) * t, y + Math.sin(t * Math.PI) * 0.4, lg.z0 + (lg.z1 - lg.z0) * t));
    batch.add(bark, taperedTube(pts, lg.radius, lg.radius * 0.75, 20, 10));
    solid(null, null, (lg.x0 + lg.x1) / 2, (lg.z0 + lg.z1) / 2, len / 2, lg.radius * 0.6, dir, y - lg.radius, y + lg.radius * 0.85, 0, 'log');
    // Ramp up onto each end from the ground.
    for (const [ex, ez, gy, d] of [[lg.x0, lg.z0, g0, dir], [lg.x1, lg.z1, g1, dir + Math.PI]] as [number, number, number, number][]) {
      const cx = ex - Math.cos(d) * 1.6, cz = ez - Math.sin(d) * 1.6;
      solid(null, null, cx, cz, 1.8, lg.radius * 0.6, d, gy - 0.5, y + lg.radius * 0.85, y + lg.radius * 0.85 - gy, 'log-end');
    }
  }

  // ---- Hanging moss and fungus brackets (instanced), reeds and lily pads in the shallows.
  const mossGeo = new THREE.ConeGeometry(1, 1, 5, 3, true).rotateX(Math.PI).translate(0, -0.5, 0);
  scene.add(instancedFrom(mossGeo, mossMass, hanging, 'hanging-moss'));
  const capGeo = capGeometry(28);
  scene.add(instancedFrom(capGeo, caps, capMats, 'fen-caps'));
  const reeds: THREE.Matrix4[] = [], pads: THREE.Matrix4[] = [];
  for (let i = 0; i < 2600; i++) {
    const a = fixed() * Math.PI * 2, d = Math.sqrt(fixed()) * (FEN.radius - 4);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = fenHeight(x, z);
    if (h > -0.55 && h < 0.12 && noise3(x * 0.08, 3, z * 0.08) > 0.45 && clear(x, z, 1)) {
      for (let k = 0; k < 5; k++) reeds.push(M4(x + (fixed() - 0.5) * 0.8, h, z + (fixed() - 0.5) * 0.8, fixed() * 6, 0.05, 1.2 + fixed() * 1.6 - h, 0.05));
    } else if (h < -0.3 && noise3(x * 0.1, 8, z * 0.1) > 0.55) {
      const s = 0.3 + fixed() * 0.5;
      pads.push(M4(x, FEN_WATER_Y + 0.02, z, fixed() * 6, s, 1, s));
    }
  }
  const reedGeo = new THREE.ConeGeometry(1, 1, 3, 1).translate(0, 0.5, 0);
  scene.add(instancedFrom(reedGeo, mossMass, reeds, 'reeds'));
  const padGeo = new THREE.CircleGeometry(1, 9, 0.3, Math.PI * 2 - 0.3).rotateX(-Math.PI / 2);
  const padMesh = instancedFrom(padGeo, mossMass, pads, 'lily-pads');
  padMesh.renderOrder = 2;
  scene.add(padMesh);

  // ---- Ground cover on dry ground only (never on the water).
  const built: (XZ & { r: number })[] = [
    ...FEN.stiltVillage.huts.map((h) => ({ x: h.x, z: h.z, r: h.radius + 2 })), { x: FEN.drownedPod.x, z: FEN.drownedPod.z, r: FEN.drownedPod.length * 0.5 },
    { x: elder.x, z: elder.z, r: elder.radius + 0.5 }, { x: FEN.spiderHollow.fire.x, z: FEN.spiderHollow.fire.z, r: 1.6 },
    ...FEN.extracts.map((e) => ({ x: e.x, z: e.z, r: 3.5 })), ...FEN.blooms.map((b) => ({ x: b.x, z: b.z, r: 2.5 })),
  ];
  scene.add(groundCover({ height: fenHeight, exclude: (x, z) => fenHeight(x, z) < FEN_WATER_Y + 0.12 || built.some((b) => Math.hypot(x - b.x, z - b.z) < b.r) }).group);

  // ---- Mist: the shared height fog lies thick on the water (scene.fog above); soft shafts fall through canopy gaps.
  // (No open-air hazeVolume: it is built for walled rooms and would leave anything standing inside it unhazed.)
  for (const a of FEN.areas) {
    if (rand() < 0.5) continue;
    root.add(lightShaft({ from: new THREE.Vector3(a.x + 6, 42, a.z - 4), to: new THREE.Vector3(a.x, 0, a.z), width: 4, spread: 1.6, colour: ORGANIC.mist, strength: 0.05 }));
  }

  // ---- Mistwaders: tall grazers wading slowly through the mist beyond the ring (ambient only).
  root.add(mistwaders(fixed));

  // ---- Extract markers: lantern posts round each extract; a ring when it is open.
  const sitesGroup = new THREE.Group();
  sitesGroup.name = 'fen-sites';
  const rings = new Map<string, THREE.Mesh>();
  for (const e of layout.extracts) {
    const g = fenHeight(e.x, e.z);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4, px = e.x + Math.cos(a) * 5, pz = e.z + Math.sin(a) * 5;
      batch.add(bark, new THREE.CylinderGeometry(0.1, 0.14, 2.6, 6), M4(px, g + 1.3, pz));
      batch.add(amber, new THREE.SphereGeometry(0.15, 8, 6), M4(px, g + 2.7, pz));
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.07, 6, 48).rotateX(-Math.PI / 2), bioNode(e.opensAt > 0 ? ZONE7.violet : ORGANIC.amber, 2.5));
    ring.position.set(e.x, g + 0.08, e.z);
    ring.visible = e.opensAt <= 0;
    rings.set(e.id, ring);
    sitesGroup.add(ring);
  }
  scene.add(sitesGroup);

  // Canopy masses do not cast: under a closed canopy the camera-following shadow box would cut hard lines.
  for (const m of batch.meshes('fen')) { if (m.material === mossMass) m.userData.noShadow = true; root.add(m); }
  scene.add(root);

  return {
    layout,
    sites: { group: sitesGroup, setExtractOpen(id, open) { const r = rings.get(id); if (r) r.visible = open; }, setNodeHarvested() { /* blooms wither through Gameplay's prop */ } },
    structures: { group: root, loot, arena: null, regent: regentPool, breakPillar() { /* no pillars in the fen */ } },
    landmarkAt: (x, z) => fenAreaAt(x, z)?.id ?? null,
  };
}

function instancedFrom(geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = list.length;
  mesh.name = name;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Ambient long-necked grazers on stilt legs, wading slowly round the outside of the fen. */
function mistwaders(rand: () => number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mistwaders';
  const hideMat = fenBark({ base: ZONE7_SHADE.flesh, deep: ZONE7_SHADE.rockDeep, mossy: 0.4, scale: 0.8 });
  const { count, ring, height } = FEN.waders;
  for (let i = 0; i < count; i++) {
    const H = height[0] + rand() * (height[1] - height[0]);
    const w = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), hideMat);
    body.scale.set(H * 0.2, H * 0.1, H * 0.11);
    body.position.y = H * 0.62;
    w.add(body);
    const neck = new THREE.Mesh(taperedTube([
      new THREE.Vector3(H * 0.15, H * 0.66, 0), new THREE.Vector3(H * 0.3, H * 0.85, 0), new THREE.Vector3(H * 0.36, H * 1.0, 0), new THREE.Vector3(H * 0.45, H * 0.96, 0),
    ], H * 0.04, H * 0.018, 14, 6), hideMat);
    w.add(neck);
    const legs: THREE.Mesh[] = [];
    for (let k = 0; k < 4; k++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.012, H * 0.02, H * 0.65, 5).translate(0, -H * 0.325, 0), hideMat);
      leg.position.set((k < 2 ? 1 : -1) * H * 0.12, H * 0.6, (k % 2 ? 1 : -1) * H * 0.06);
      legs.push(leg);
      w.add(leg);
    }
    const r = ring[0] + rand() * (ring[1] - ring[0]), a0 = rand() * Math.PI * 2, speed = (0.004 + rand() * 0.004) * (rand() < 0.5 ? 1 : -1);
    body.onBeforeRender = () => {
      const t = bioTime.value, a = a0 + t * speed;
      w.position.set(Math.cos(a) * r, -0.5, Math.sin(a) * r);
      w.rotation.y = -a + (speed > 0 ? -Math.PI / 2 : Math.PI / 2) + Math.PI;
      legs.forEach((l, k) => { l.rotation.z = Math.sin(t * 0.6 + k * Math.PI * 0.5 + i) * 0.18; });
      neck.rotation.z = Math.sin(t * 0.21 + i) * 0.08;
    };
    group.add(w);
  }
  return group;
}
