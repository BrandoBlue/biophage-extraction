import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OCHRE, ORGANIC } from '../render/palette';
import { bioNode, bioTime } from '../render/materials';
import { hazeVolume } from '../render/atmos';
import { sporeField } from '../render/sky';
import {
  adobe, desertGround, dryGrass, dustDevil, hazedGiant, leafPads, ochreSky, rustMetal, skyfallRock, succulentSkin, thornBark, wovenCloth,
} from '../render/desert';
import DATA from '../../data/ochre.json';
import { mulberry32 } from './rng';
import { Kit, oldBone, type BuiltStructures, type LootSpot } from './structures';
import type { SiteDressing } from './sites';
import type { ExtractSite, SpawnPlacement, Zone7Layout } from './layout';
import { SOLIDS, setTerrain } from './zone7';

/**
 * The Ochre Reach (World & Level): a sun-baked alien savannah about 800 m across. Design's landmarks
 * (data/zones.json ochreReach): the Dome Village of clay huts you can walk into, the Rig Yard of rusted derricks,
 * the Acacia Flats of lone thorn trees, the Dune Sea where packs wait under the sand, the Cactus Gulch cut through a
 * mesa, and the Skyfall Crater. Positions, homes and extracts live in data/ochre.json; nothing is scattered at random:
 * flora follows rules (trees on the flats, succulents in the gulch, grass where the ground is flat and not dune).
 *
 * Frame: +x east, +z south; the spawn is on the south edge. The ground is a height function (setTerrain), so the
 * player, creatures and loot all stand on the same surface the mesh shows.
 */

type Pt = { x: number; z: number };
export const OCHRE_ZONE = DATA;
const D = DATA;
const deg = (d: number) => (d * Math.PI) / 180;
const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

// ------------------------------------------------------------------ terrain

function hash2(ix: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in 0..1. */
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function polyDist(x: number, z: number, pts: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

const WIND = deg(D.wind);
const WU = Math.cos(WIND), WV = Math.sin(WIND);

/** Barchan-like dunes: a gentle windward climb and a steep lee face, crests wandering across the wind. */
export function dunes(x: number, z: number): number {
  const s = x * WU + z * WV, t = -x * WV + z * WU;
  const warp = (vnoise(x * 0.01, z * 0.01) - 0.5) * 40 + Math.sin(t * 0.02) * 12;
  const f = (((s + warp) / 38) % 1 + 1) % 1;
  const prof = f < 0.72 ? smooth(0, 1, f / 0.72) : 1 - smooth(0, 1, (f - 0.72) / 0.28);
  const amp = 6 * (0.55 + 0.45 * Math.sin(t * 0.017 + 1.3));
  const f2 = (((s + t * 0.35 + warp * 0.5) / 13) % 1 + 1) % 1;
  const small = f2 < 0.75 ? smooth(0, 1, f2 / 0.75) : 1 - smooth(0, 1, (f2 - 0.75) / 0.25);
  return prof * amp + small * 0.9;
}

const LM = D.landmarks;
const FLATS = [...D.flats, ...D.extracts.map((e) => ({ x: e.x, z: e.z, radius: 10 }))];

function rawGround(x: number, z: number): number {
  const d = Math.hypot(x, z);
  let h = Math.sin(x * 0.013 + 0.5) * Math.cos(z * 0.011) * 2.2 + Math.sin(x * 0.041 + z * 0.033) * 0.7 + (vnoise(x * 0.02, z * 0.02) - 0.5) * 3;
  // Dunes: full height in the Dune Sea, a low ripple of them across the rest of the plain.
  const ds = LM.duneSea, dd = Math.hypot(x - ds.x, z - ds.z);
  h += dunes(x, z) * (0.15 + 0.85 * (1 - smooth(ds.radius * 0.55, ds.radius * 1.3, dd)));
  // The mesa the Cactus Gulch cuts through: steep walls, a canyon floor back at plain level.
  const pl = D.gulch.plateau;
  const pd = Math.hypot(x - pl.x, z - pl.z) + (vnoise(x * 0.03, z * 0.03) - 0.5) * 30;
  if (pd < pl.radius + 6) {
    let plateau = pl.height * (1 - smooth(pl.radius - 8, pl.radius + 4, pd));
    const gd = polyDist(x, z, D.gulch.path) + (vnoise(x * 0.08, z * 0.08) - 0.5) * 4;
    plateau *= smooth(D.gulch.halfWidth, D.gulch.halfWidth + 5, gd);
    // Weathered ledges: the cliff steps a little every few metres.
    h += plateau + Math.sin(plateau * 1.4) * 0.35;
  }
  for (const b of D.buttes) {
    const bd = Math.hypot(x - b.x, z - b.z) + (vnoise(x * 0.06, z * 0.06) - 0.5) * 8;
    if (bd < b.radius + 4) h += b.height * (1 - smooth(b.radius - 4, b.radius + 3, bd));
  }
  // Escarpments and mesas wall the map in past the walkable edge.
  h += 70 * smooth(400, 560, d + (vnoise(x * 0.008, z * 0.008) - 0.5) * 90);
  return h;
}

/**
 * The whole plain sits this far above world zero: the shared height fog (src/render/fog.ts) is a dense layer near
 * y 0 made for misty Glowmire; up here it thins to a dry daytime haze that deepens with distance.
 */
export const ELEVATION = 20;

/** Height of the Ochre Reach at (x, z): the shared ground for the mesh, the host, creatures and loot. */
export function ochreGround(x: number, z: number): number {
  return ELEVATION + localGround(x, z);
}

function localGround(x: number, z: number): number {
  let h = rawGround(x, z);
  for (const f of FLATS) {
    const dist = Math.hypot(x - f.x, z - f.z);
    if (dist < f.radius + 20) h += (rawGround(f.x, f.z) - h) * (1 - smooth(f.radius, f.radius + 20, dist));
  }
  const c = D.crater, cd = Math.hypot(x - c.x, z - c.z) / c.radius;
  if (cd < 1.6) {
    const floor = rawGround(c.x, c.z) - c.depth;
    h += (floor - h) * (1 - smooth(0.3, 1, cd));
    h += c.rim * Math.exp(-((cd - 1.05) ** 2) / 0.04);
  }
  // Burrow mounds: a low hump of disturbed sand with a dimple, the tell that something lives underneath.
  for (const b of D.burrows) {
    const bd = Math.hypot(x - b.x, z - b.z);
    if (bd < 6) h += 0.5 * Math.exp(-((bd / 2.4) ** 2)) - 0.35 * Math.exp(-((bd / 0.9) ** 2));
  }
  return h;
}

// ------------------------------------------------------------------ layout

/** Landmark (Design's zones.json id) whose area contains (x, z), nearest centre wins. */
export function ochreLandmarkAt(x: number, z: number): string | null {
  let best: string | null = null, bd = Infinity;
  for (const [id, l] of Object.entries(LM)) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d <= l.radius && d < bd) { bd = d; best = id; }
  }
  return best;
}

/** The raid layout: fixed spawn, extracts and creature homes from data/ochre.json. */
export function ochreLayout(seed: number): Zone7Layout {
  const extracts: ExtractSite[] = D.extracts.map((e) => ({ id: e.id, label: e.label, x: e.x, z: e.z, opensAt: e.opensAt }));
  return {
    seed,
    spawn: { id: 'spawn', ...D.spawn },
    extracts,
    dormantPads: [],
    pods: [],
    nests: [],
    nodes: [],
    anomaly: { id: 'none', kind: 'none', x: 1e5, z: 1e5, radius: 1, gravityMultiplier: 1 },
    dropIn: D.dropIn,
    playableRadius: D.playableRadius,
    spawns: D.spawns as SpawnPlacement[],
  };
}

// ------------------------------------------------------------------ geometry helpers

/** Strip to position + normal and drop the index so unlike primitives merge into one draw. */
function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  return n;
}

/** Static geometry grouped by material, merged to one mesh per material at the end. */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const p = plain(g);
    if (m) p.applyMatrix4(m);
    const list = this.parts.get(mat);
    if (list) list.push(p); else this.parts.set(mat, [p]);
  }
  meshes(name: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.name = name;
      out.push(mesh);
    }
    return out;
  }
}

const M4 = (x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(sx, sy, sz));

/** A cylinder strut between two points. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A lumpy boulder (unit radius). */
function boulderGeometry(rand: () => number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, v = new THREE.Vector3();
  const k = [rand() * 9, rand() * 9, rand() * 9];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 0.75 + 0.35 * Math.sin(v.x * 2.3 + k[0]) * Math.sin(v.y * 2.9 + k[1]) * Math.sin(v.z * 2.1 + k[2]) + 0.1 * Math.sin(v.x * 7 + v.z * 6);
    v.multiplyScalar(n);
    v.y = v.y > 0 ? v.y * 0.75 : v.y;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Instanced copies of one geometry on the ground. */
function instances(geo: THREE.BufferGeometry, mat: THREE.Material, at: { x: number; y: number; z: number; s: number; sy?: number; yaw: number; tilt?: number }[], name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, at.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  at.forEach((a, i) => {
    e.set(a.tilt ?? 0, a.yaw, (a.tilt ?? 0) * 0.6);
    m.compose(new THREE.Vector3(a.x, a.y, a.z), q.setFromEuler(e), new THREE.Vector3(a.s, a.sy ?? a.s, a.s));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = at.length;
  mesh.name = name;
  mesh.computeBoundingSphere();
  return mesh;
}

// ------------------------------------------------------------------ flora

/** Umbrella thorn tree: a twisted trunk forking into 3 to 4 limbs under a flat canopy of leaf-pad clusters. */
function thornTree(rand: () => number): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const trunks: THREE.BufferGeometry[] = [], pads: THREE.BufferGeometry[] = [];
  const h = 5 + rand() * 3, fork = h * (0.35 + rand() * 0.15);
  const lean = new THREE.Vector3((rand() - 0.5) * 1.2, 0, (rand() - 0.5) * 1.2);
  const base = new THREE.Vector3(0, -0.3, 0), mid = new THREE.Vector3(lean.x * 0.4, fork, lean.z * 0.4);
  trunks.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([base, new THREE.Vector3(lean.x * 0.15, fork * 0.5, lean.z * 0.15), mid]), 8, 0.32, 7));
  const limbs = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rand() * 0.8, spread = 2.5 + rand() * 2.5;
    const end = new THREE.Vector3(mid.x + Math.cos(a) * spread, h + (rand() - 0.5) * 0.8, mid.z + Math.sin(a) * spread);
    const knee = new THREE.Vector3(mid.x + Math.cos(a) * spread * 0.35, fork + (h - fork) * 0.6, mid.z + Math.sin(a) * spread * 0.35);
    trunks.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([mid, knee, end]), 8, 0.16, 6));
    // Leaf pads: two or three flattened clumps per limb, together a broad flat crown.
    for (let k = 0; k < 2 + Math.floor(rand() * 2); k++) {
      const c = new THREE.IcosahedronGeometry(1, 1);
      const r = 1.8 + rand() * 1.4;
      c.applyMatrix4(M4(end.x + (rand() - 0.5) * 2.4, end.y + 0.25 + rand() * 0.4, end.z + (rand() - 0.5) * 2.4, rand() * 6, r, 0.32 + rand() * 0.12, r * (0.8 + rand() * 0.3)));
      pads.push(c);
    }
  }
  return { trunk: mergeGeometries(trunks.map(plain)), canopy: mergeGeometries(pads.map(plain)) };
}

/** Columnar succulent with ribs and one or two arms (unit height, y 0..1). */
function succulentGeometry(rand: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const column = (h: number, r: number) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(r * (t < 0.85 ? 1 - t * 0.12 : Math.sqrt(Math.max(0, 1 - ((t - 0.85) / 0.15) ** 2)) * 0.88), t * h)); }
    const g = new THREE.LatheGeometry(pts, 16);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), rib = 1 + 0.12 * Math.cos(a * 8);
      p.setX(i, x * rib); p.setZ(i, z * rib);
    }
    g.computeVertexNormals();
    return g;
  };
  parts.push(column(1, 0.09));
  for (let i = 0; i < 1 + Math.floor(rand() * 2); i++) {
    const a = rand() * Math.PI * 2, y = 0.3 + rand() * 0.3, len = 0.25 + rand() * 0.25;
    const arm = column(len, 0.06);
    arm.applyMatrix4(M4(Math.cos(a) * 0.2, y + 0.08, Math.sin(a) * 0.2, 0));
    const elbow = strut(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(a) * 0.2, y + 0.1, Math.sin(a) * 0.2), 0.06, 8);
    parts.push(arm, elbow);
  }
  return mergeGeometries(parts.map(plain));
}

/** A clump of dry grass blades (unit height). */
function grassClump(rand: () => number): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2, h = 0.6 + rand() * 0.4, w = 0.04 + rand() * 0.03;
    const g = new THREE.PlaneGeometry(w, h, 1, 3);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const t = (p.getY(k) + h / 2) / h; p.setY(k, t * h); p.setX(k, p.getX(k) * (1 - t * 0.9)); p.setZ(k, t * t * 0.25); }
    g.applyMatrix4(M4(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08, a));
    g.computeVertexNormals();
    blades.push(g);
  }
  return mergeGeometries(blades.map(plain));
}

// ------------------------------------------------------------------ the village

interface Hut { x: number; z: number; r: number; h: number; loot?: string }

/**
 * A clay dome you can walk into: an arched entry vestibule facing the plaza, a thick plinth, roof poles poking
 * through, sometimes a salvaged metal patch or a chimney. The wall ring is solid; the doorway is the way in.
 */
function domeHut(hut: Hut, yaw: number, base: number, rand: () => number, mats: { clay: THREE.Material; metal: THREE.Material; wood: THREE.Material; floor: THREE.Material }): THREE.Group {
  const g = new THREE.Group();
  g.position.set(hut.x, base, hut.z);
  g.rotation.y = yaw;
  g.name = 'dome-hut';
  const { r, h } = hut;
  const doorHalf = 0.95, doorTop = 2.35;
  const alpha = Math.asin(Math.min(0.9, doorHalf / r));
  // Shell with the door slot round local +z (phi = pi/2), then the lintel above the door.
  const shell = new THREE.SphereGeometry(r, 36, 16, Math.PI / 2 + alpha, Math.PI * 2 - alpha * 2, 0, Math.PI / 2);
  shell.scale(1, h / r, 1);
  const lintelTheta = Math.acos(Math.min(0.97, doorTop / h));
  const lintel = new THREE.SphereGeometry(r, 6, 10, Math.PI / 2 - alpha, alpha * 2, 0, lintelTheta);
  lintel.scale(1, h / r, 1);
  const dome = new THREE.Mesh(mergeGeometries([plain(shell), plain(lintel)]), mats.clay);
  g.add(dome);
  // Entry vestibule: two cheeks and a barrel arch reaching out from the door.
  const parts: THREE.BufferGeometry[] = [];
  const depth = 1.5, zc = r - 0.2 + depth / 2;
  for (const side of [-1, 1]) {
    const cheek = new THREE.BoxGeometry(0.35, 1.5, depth, 1, 2, 2);
    cheek.translate(side * (doorHalf + 0.17), 0.75, zc);
    parts.push(cheek);
  }
  const arch = new THREE.CylinderGeometry(doorHalf + 0.35, doorHalf + 0.35, depth, 14, 1, true, -Math.PI / 2, Math.PI);
  arch.rotateX(-Math.PI / 2);
  arch.translate(0, 1.5, zc);
  parts.push(arch);
  // Plinth ring at the foot of the wall.
  const plinth = new THREE.TorusGeometry(r + 0.05, 0.28, 6, 40);
  plinth.rotateX(Math.PI / 2);
  plinth.scale(1, 1, 1);
  plinth.translate(0, 0.12, 0);
  parts.push(plinth);
  const extras = new THREE.Mesh(mergeGeometries(parts.map(plain)), mats.clay);
  g.add(extras);
  // Roof poles (vigas) poking out of the shell, and a chimney or a metal patch on some huts.
  const wood: THREE.BufferGeometry[] = [];
  const poles = 6 + Math.floor(r);
  for (let i = 0; i < poles; i++) {
    const a = (i / poles) * Math.PI * 2 + 0.3, th = 0.9;
    if (-Math.sin(a) > Math.cos(alpha + 0.35)) continue; // not over the door (local +z)
    const rr = r * Math.sin(th), y = h * Math.cos(th);
    wood.push(strut(new THREE.Vector3(Math.cos(a) * rr * 0.8, y + 0.2, -Math.sin(a) * rr * 0.8), new THREE.Vector3(Math.cos(a) * (rr + 0.7), y - 0.25, -Math.sin(a) * (rr + 0.7)), 0.07));
  }
  g.add(new THREE.Mesh(mergeGeometries(wood.map(plain)), mats.wood));
  if (rand() < 0.5) {
    const ch = new THREE.CylinderGeometry(0.28, 0.36, 1.2, 10);
    const a = rand() * Math.PI * 2;
    ch.translate(Math.cos(a) * r * 0.35, h * 0.93 + 0.4, Math.sin(a) * r * 0.35);
    g.add(new THREE.Mesh(ch, mats.clay));
  } else {
    const a0 = rand() * Math.PI;
    const patch = new THREE.SphereGeometry(r + 0.06, 8, 6, a0, 0.7 + rand() * 0.4, 0.5, 0.5);
    patch.scale(1, h / r, 1);
    g.add(new THREE.Mesh(patch, mats.metal));
  }
  // Packed-earth floor.
  const floor = new THREE.CircleGeometry(r - 0.25, 32).rotateX(-Math.PI / 2);
  floor.translate(0, 0.04, 0);
  g.add(new THREE.Mesh(floor, mats.floor));

  // Collision: a ring of wall boxes with a gap at the door, plus the vestibule cheeks.
  const N = Math.max(14, Math.round(r * 3.2));
  const segHalf = r * Math.sin(Math.PI / N) + 0.05;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const lx = Math.sin(a) * (r - 0.15), lz = Math.cos(a) * (r - 0.15);
    if (Math.abs(lx) < doorHalf + segHalf * 0.5 && lz > 0) continue;
    const [wx, wz] = rot(hut.x, hut.z, yaw, lx, lz);
    SOLIDS.add({ cx: wx, cz: wz, hx: segHalf, hz: 0.25, yaw: yaw + a, y0: base, y1: base + Math.min(h * 0.6, 3), tag: 'hut-wall' });
  }
  for (const side of [-1, 1]) {
    const [wx, wz] = rot(hut.x, hut.z, yaw, side * (doorHalf + 0.17), zc);
    SOLIDS.add({ cx: wx, cz: wz, hx: 0.18, hz: depth / 2, yaw, y0: base, y1: base + 1.5, tag: 'hut-cheek' });
  }
  return g;
}

/** World (x, z) of local (u, v) in a frame at (x, z) turned by yaw (the Object3D rotation.y convention). */
function rot(x: number, z: number, yaw: number, u: number, v: number): [number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x + u * c + v * s, z - u * s + v * c];
}

/** Cloth on four poles, flapping in the wind (CPU cloth, a few dozen vertices). */
function awning(x: number, z: number, yaw: number, base: number, w: number, d: number, cloth: THREE.Material, wood: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, base, z);
  g.rotation.y = yaw;
  const poles: THREE.BufferGeometry[] = [];
  for (const [u, v, ph] of [[-w / 2, -d / 2, 2.6], [w / 2, -d / 2, 2.6], [-w / 2, d / 2, 2.1], [w / 2, d / 2, 2.1]]) {
    poles.push(strut(new THREE.Vector3(u, 0, v), new THREE.Vector3(u, ph, v), 0.06));
  }
  g.add(new THREE.Mesh(mergeGeometries(poles.map(plain)), wood));
  const geo = new THREE.PlaneGeometry(w, d, 8, 6).rotateX(-Math.PI / 2);
  const rest = Float32Array.from(geo.attributes.position.array as Float32Array);
  const sheet = new THREE.Mesh(geo, cloth);
  sheet.position.y = 2.35;
  sheet.rotation.x = 0.1;
  const p = geo.attributes.position;
  const phase = x * 0.13 + z * 0.07;
  sheet.onBeforeRender = () => {
    const t = bioTime.value;
    for (let i = 0; i < p.count; i++) {
      const u = rest[i * 3], v = rest[i * 3 + 2];
      const edge = Math.min(1, Math.abs(v) / (d / 2) * 0.6 + Math.abs(u) / (w / 2) * 0.4);
      const sag = -0.25 * (1 - (u / (w / 2)) ** 2) * (1 - (v / (d / 2)) ** 2);
      p.setY(i, sag + edge * (Math.sin(t * 4.1 + u * 1.3 + phase) * 0.08 + Math.sin(t * 7.3 + v * 2.1) * 0.035));
    }
    p.needsUpdate = true;
  };
  g.add(sheet);
  return g;
}

// ------------------------------------------------------------------ the rig yard

function derrick(x: number, z: number, h: number, base: number, metal: THREE.Material, batch: Batch): THREE.Object3D {
  const s0 = 3, s1 = 0.8;
  const corner = (i: number, t: number) => {
    const s = s0 + (s1 - s0) * t, a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    return new THREE.Vector3(x + Math.cos(a) * s * Math.SQRT2, base + t * h, z + Math.sin(a) * s * Math.SQRT2);
  };
  for (let i = 0; i < 4; i++) {
    batch.add(metal, strut(corner(i, 0), corner(i, 1), 0.14));
    // X-bracing up each face.
    for (let k = 0; k < 5; k++) {
      const t0 = k / 5, t1 = (k + 1) / 5;
      batch.add(metal, strut(corner(i, t0), corner(i + 1, t1), 0.05, 4));
      batch.add(metal, strut(corner(i + 1, t0), corner(i, t1), 0.05, 4));
      batch.add(metal, strut(corner(i, t1), corner(i + 1, t1), 0.06, 4));
    }
    const c = corner(i, 0);
    SOLIDS.add({ cx: c.x, cz: c.z, hx: 0.25, hz: 0.25, yaw: 0, y0: base - 1, y1: base + h, tag: 'derrick-leg' });
  }
  batch.add(metal, new THREE.BoxGeometry(2.2, 1.2, 2.2), M4(x, base + h + 0.6, z));
  batch.add(metal, new THREE.BoxGeometry(7, 0.4, 7), M4(x, base + 0.2, z));
  // A wind vane on the crown, still turning.
  const vane = new THREE.Group();
  vane.position.set(x, base + h + 1.6, z);
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) { const b = new THREE.BoxGeometry(0.25, 1.8, 0.04); b.translate(0, 0.9, 0); b.rotateZ((i / 6) * Math.PI * 2); blades.push(b); }
  const rotor = new THREE.Mesh(mergeGeometries(blades.map(plain)), metal);
  vane.add(rotor);
  rotor.onBeforeRender = () => { rotor.rotation.z = bioTime.value * 1.7 + x; };
  return vane;
}

/** A pump jack nodding at the well head: A-frame, walking beam with its horse head, crank and counterweight. */
function pumpJack(x: number, z: number, yaw: number, base: number, metal: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, base, z);
  g.rotation.y = yaw;
  const frame: THREE.BufferGeometry[] = [new THREE.BoxGeometry(6, 0.3, 1.6).translate(0, 0.15, 0)];
  for (const s of [-1, 1]) {
    frame.push(strut(new THREE.Vector3(-0.8, 0.3, s * 0.6), new THREE.Vector3(0, 3.2, 0), 0.08));
    frame.push(strut(new THREE.Vector3(0.8, 0.3, s * 0.6), new THREE.Vector3(0, 3.2, 0), 0.08));
  }
  frame.push(new THREE.BoxGeometry(0.8, 1.2, 1.2).translate(-2.4, 0.9, 0));
  g.add(new THREE.Mesh(mergeGeometries(frame.map(plain)), metal));
  const beam = new THREE.Group();
  beam.position.set(0, 3.3, 0);
  const bg: THREE.BufferGeometry[] = [new THREE.BoxGeometry(5.6, 0.35, 0.35).translate(0.2, 0, 0)];
  bg.push(new THREE.CylinderGeometry(0.9, 0.9, 0.4, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(3, -0.3, 0));
  beam.add(new THREE.Mesh(mergeGeometries(bg.map(plain)), metal));
  g.add(beam);
  const crank = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.5).translate(0.5, 0, 0), metal);
  crank.position.set(-2.4, 1.3, 0.7);
  g.add(crank);
  const phase = x * 0.1;
  beam.onBeforeRender = () => {
    const t = bioTime.value * 1.4 + phase;
    beam.rotation.z = Math.sin(t) * 0.3;
    crank.rotation.z = t;
  };
  SOLIDS.add({ cx: x, cz: z, hx: 3, hz: 0.8, yaw, y0: base, y1: base + 1.2, tag: 'pump-jack' });
  return g;
}

// ------------------------------------------------------------------ the build

export interface OchreWorld {
  layout: Zone7Layout;
  sites: SiteDressing;
  structures: BuiltStructures;
  landmarkAt(x: number, z: number): string | null;
}

/** Builds the Ochre Reach into `scene` (SOLIDS reset; terrain set to the desert). */
export function buildOchre(scene: THREE.Scene, seed: number): OchreWorld {
  const rand = mulberry32(911);
  setTerrain(ochreGround);
  SOLIDS.clear();
  const layout = ochreLayout(seed);
  const G = ochreGround;

  // ---- Sky, suns and haze. The key sun hangs low in the west-southwest; two pale companions trail it.
  const sunDir = new THREE.Vector3(-0.75, 0.32, 0.45).normalize();
  const sun2 = new THREE.Vector3(-0.55, 0.42, 0.62).normalize();
  const sun3 = new THREE.Vector3(-0.92, 0.2, 0.2).normalize();
  const sky = ochreSky([sunDir, sun2, sun3]);
  sky.userData.bake = true;
  scene.add(sky);
  scene.background = new THREE.Color(OCHRE.skyHaze);
  scene.fog = new THREE.FogExp2(OCHRE.skyHaze, 0.0017);
  scene.add(new THREE.HemisphereLight(OCHRE.skyHaze, OCHRE.sandShade, 0.85));
  const sun = new THREE.DirectionalLight(OCHRE.sun, 1.8);
  sun.position.copy(sunDir).multiplyScalar(200);
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(ORGANIC.mist, 0.25);
  fill.position.set(80, 60, -120);
  fill.userData.noShadow = true;
  scene.add(fill);
  // The ringed giant, hazed and pale, low over the dune sea.
  const giant = hazedGiant(120, sunDir, new THREE.Vector3(0.3, 1, 0.5));
  giant.position.set(520, 430, -700);
  scene.add(giant);

  // ---- Ground: a fine grid over the playable map, a coarser ring for the escarpments beyond it.
  const groundMat = desertGround(D.wind);
  const inner = new THREE.PlaneGeometry(860, 860, 288, 288).rotateX(-Math.PI / 2);
  const ip = inner.attributes.position;
  for (let i = 0; i < ip.count; i++) { const x = ip.getX(i), z = ip.getZ(i); ip.setY(i, G(x, z) - (Math.hypot(x, z) > 420 ? 6 : 0)); }
  inner.computeVertexNormals();
  const ground = new THREE.Mesh(inner, groundMat);
  ground.name = 'ground';
  scene.add(ground);
  const outer = new THREE.RingGeometry(415, 1150, 160, 26).rotateX(-Math.PI / 2);
  const op = outer.attributes.position;
  for (let i = 0; i < op.count; i++) { const x = op.getX(i), z = op.getZ(i); op.setY(i, ELEVATION + rawGround(x, z) + (Math.hypot(x, z) > 600 ? (vnoise(x * 0.004, z * 0.004) - 0.3) * 60 : 0)); }
  outer.computeVertexNormals();
  const ring = new THREE.Mesh(outer, groundMat);
  ring.name = 'escarpments';
  scene.add(ring);

  const mats = { clay: adobe(OCHRE.clay), metal: rustMetal(), wood: thornBark(false), floor: adobe(OCHRE.clayDark) };
  const paleClay = adobe(OCHRE.dust);
  const batch = new Batch();
  const loot: LootSpot[] = [];

  // ---- The Dome Village: huts round a plaza with a well, doors facing in, awnings and pots between.
  const V = D.village, plaza = V.plaza;
  const village = new THREE.Group();
  village.name = 'dome-village';
  V.huts.forEach((h, i) => {
    const yaw = Math.atan2(plaza.x - h.x, plaza.z - h.z);
    const base = G(h.x, h.z) - 0.05;
    village.add(domeHut(h, yaw, base, rand, { ...mats, clay: i % 3 === 1 ? paleClay : mats.clay }));
    if (h.loot) loot.push({ id: `hut-${i}`, container: h.loot, x: h.x - Math.sin(yaw) * h.r * 0.4, y: base + 0.05, z: h.z - Math.cos(yaw) * h.r * 0.4 });
    // An awning beside every other door, angled off the entry.
    if (i % 2 === 0 && h.r < 8) {
      const [ax, az] = rot(h.x, h.z, yaw, h.r * 0.9 + 1.8, h.r + 1.2);
      village.add(awning(ax, az, yaw + 0.3, G(ax, az), 3.6, 2.8, wovenCloth(i % 4 === 0 ? OCHRE.rust : OCHRE.bleached), mats.wood));
    }
    // Clay pots by the wall.
    for (let k = 0; k < 3; k++) {
      const a = yaw + 0.9 + k * 0.35 + rand() * 0.2;
      const px = h.x + Math.sin(a) * (h.r + 0.6), pz = h.z + Math.cos(a) * (h.r + 0.6), s = 0.35 + rand() * 0.25;
      batch.add(mats.clay, potGeometry(), M4(px, G(px, pz), pz, rand() * 6, s));
    }
  });
  // The well: a stone ring, a timber frame and a bucket.
  const W = V.well, wy = G(W.x, W.z);
  batch.add(paleClay, new THREE.CylinderGeometry(W.r, W.r + 0.15, 0.9, 20, 1, true), M4(W.x, wy + 0.45, W.z));
  batch.add(paleClay, new THREE.TorusGeometry(W.r, 0.18, 6, 24).rotateX(Math.PI / 2), M4(W.x, wy + 0.9, W.z));
  batch.add(mats.wood, strut(new THREE.Vector3(W.x - W.r, wy, W.z), new THREE.Vector3(W.x - W.r * 0.7, wy + 3, W.z), 0.08));
  batch.add(mats.wood, strut(new THREE.Vector3(W.x + W.r, wy, W.z), new THREE.Vector3(W.x + W.r * 0.7, wy + 3, W.z), 0.08));
  batch.add(mats.wood, strut(new THREE.Vector3(W.x - W.r, wy + 2.9, W.z), new THREE.Vector3(W.x + W.r, wy + 2.9, W.z), 0.07));
  batch.add(new THREE.MeshStandardMaterial({ color: OCHRE.thorn, roughness: 1 }), new THREE.CircleGeometry(W.r - 0.05, 20).rotateX(-Math.PI / 2), M4(W.x, wy + 0.2, W.z));
  SOLIDS.add({ cx: W.x, cz: W.z, hx: W.r, hz: W.r, yaw: 0, y0: wy, y1: wy + 0.9, tag: 'well' });
  // The cistern: a squat clay tank fed by a pipe from the rig road.
  const C = V.cistern, cy = G(C.x, C.z);
  const tank = new THREE.Mesh(new THREE.SphereGeometry(C.r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), paleClay);
  tank.position.set(C.x, cy, C.z);
  village.add(tank);
  batch.add(mats.metal, strut(new THREE.Vector3(C.x - C.r, cy + 1, C.z), new THREE.Vector3(C.x - C.r - 30, cy + 0.6, C.z - 18), 0.22, 8));
  SOLIDS.add({ cx: C.x, cz: C.z, hx: C.r * 0.8, hz: C.r * 0.8, yaw: 0, y0: cy, y1: cy + C.r * 0.6, tag: 'cistern' });
  // Low mud walls marking yards between some huts (waist high: you can vault them).
  for (let i = 0; i < V.huts.length - 1; i += 2) {
    const a = V.huts[i], b = V.huts[i + 1];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, len = Math.hypot(b.x - a.x, b.z - a.z) - a.r - b.r - 2;
    if (len < 3) continue;
    const yaw = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
    const k = new Kit(SOLIDS, mx, mz, yaw, G(mx, mz) - 0.1);
    k.box(0, 0, len / 2, 0.3, 0, 1.1, mats.clay, { tag: 'yard-wall' });
    village.add(k.group);
  }
  // A lantern in the elder dome: the one warm light in the village.
  const elder = V.huts[0];
  const lamp = new THREE.PointLight(ORGANIC.amber, 30, 14, 2);
  lamp.position.set(elder.x, G(elder.x, elder.z) + 3, elder.z);
  village.add(lamp);
  scene.add(village);

  // ---- The Rig Yard: derricks with turning vanes, a lookout on a ramp, tin sheds, tanks and nodding pump jacks.
  const R = D.rig;
  const rig = new THREE.Group();
  rig.name = 'rig-yard';
  for (const d of R.derricks) rig.add(derrick(d.x, d.z, d.h, G(d.x, d.z) - 0.2, mats.metal, batch));
  {
    const L = R.lookout, base = G(L.x, L.z), dk = L.deck;
    const k = new Kit(SOLIDS, L.x, L.z, deg(L.yaw), base);
    k.box(0, 0, 2.6, 2.6, dk - 0.3, dk, mats.metal, { tag: 'lookout-deck' });
    for (const [u, v] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) k.box(u, v, 0.15, 0.15, -1, dk - 0.3, mats.metal, { tag: 'lookout-leg' });
    // The ramp climbs west to east onto the deck.
    k.box(-2.6 - 8, 0, 8, 1.1, -0.5, dk, mats.metal, { rise: dk + 0.5, tag: 'lookout-ramp' });
    // Rails and a tin roof on posts (no collision on the roof: nobody reaches it).
    for (const v of [-2.5, 2.5]) k.box(0, v, 2.6, 0.05, dk, dk + 1, mats.metal, { tag: 'lookout-rail' });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, 6), mats.metal);
    roof.position.set(0, dk + 3, 0);
    roof.rotation.z = 0.08;
    k.group.add(roof);
    for (const [u, v] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 5), mats.metal);
      post.position.set(u, dk + 1.5, v);
      k.group.add(post);
    }
    rig.add(k.group);
    loot.push({ id: 'lookout-cache', container: 'cargoCrate', x: L.x, y: base + dk, z: L.z });
  }
  R.sheds.forEach((s, i) => {
    const base = G(s.x, s.z) - 0.1, hw = s.w / 2, hd = s.d / 2, H = 3.4;
    const k = new Kit(SOLIDS, s.x, s.z, deg(s.yaw), base);
    k.box(0, -hd, hw, 0.1, 0, H, mats.metal, { tag: 'shed-wall' });
    k.box(-hw, 0, 0.1, hd, 0, H, mats.metal, { tag: 'shed-wall' });
    k.box(hw, 0, 0.1, hd, 0, H, mats.metal, { tag: 'shed-wall' });
    // Front wall with a doorway in the middle.
    const side = (hw - 1.1) / 2;
    k.box(-hw + side, hd, side, 0.1, 0, H, mats.metal, { tag: 'shed-wall' });
    k.box(hw - side, hd, side, 0.1, 0, H, mats.metal, { tag: 'shed-wall' });
    k.box(0, hd, 1.1, 0.1, 2.4, H, mats.metal, { tag: 'shed-lintel' });
    k.box(0, 0, hw + 0.4, hd + 0.4, H, H + 0.12, mats.metal, { tag: 'shed-roof' });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d).rotateX(-Math.PI / 2), mats.floor);
    floor.position.y = 0.12;
    k.group.add(floor);
    rig.add(k.group);
    const [lx, lz] = k.at(-hw * 0.5, -hd * 0.4);
    loot.push({ id: `shed-${i}`, container: s.loot, x: lx, y: base + 0.12, z: lz });
  });
  for (const t of R.tanks) {
    const base = G(t.x, t.z) - 0.2;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r, t.h, 24), mats.metal);
    m.position.set(t.x, base + t.h / 2, t.z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(t.r, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1), mats.metal);
    cap.position.set(t.x, base + t.h, t.z);
    rig.add(m, cap);
    SOLIDS.add({ cx: t.x, cz: t.z, hx: t.r * 0.85, hz: t.r * 0.85, yaw: 0, y0: base, y1: base + t.h, tag: 'tank' });
  }
  for (const p of R.pumps) rig.add(pumpJack(p.x, p.z, deg(p.yaw), G(p.x, p.z), mats.metal));
  scene.add(rig);

  // ---- The Dune Sea: the bones of something colossal, half under the sand.
  {
    const S = D.colossus, yaw = deg(S.yaw);
    const bone = oldBone(ORGANIC.amber, 0.05);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), side = new THREE.Vector3(dir.z, 0, -dir.x);
    const n = 15;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), along = (t - 0.5) * S.length;
      const cx = S.x + dir.x * along, cz = S.z + dir.z * along, gy = G(cx, cz);
      const spineY = gy + 1.2 + Math.sin(t * Math.PI) * 2.5;
      const sz = 1.6 + Math.sin(t * Math.PI) * 1.2;
      batch.add(bone, boulderGeometry(mulberry32(i + 3), 1), new THREE.Matrix4().compose(new THREE.Vector3(cx, spineY, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(sz * 0.8, sz, sz * 1.1)));
      SOLIDS.add({ cx, cz, hx: sz * 0.7, hz: sz * 0.8, yaw, y0: gy - 1, y1: spineY + sz * 0.6, tag: 'colossus-spine' });
      // Ribs over the middle of the body, arching high and curling back down into the sand.
      if (t > 0.2 && t < 0.8) {
        const span = 9 + Math.sin(t * Math.PI) * 6;
        for (const sgn of [-1, 1]) {
          const p0 = new THREE.Vector3(cx, spineY, cz);
          const p1 = p0.clone().addScaledVector(side, sgn * span * 0.45).setY(spineY + span * 0.5);
          const p2 = p0.clone().addScaledVector(side, sgn * span * 0.95).setY(spineY + span * 0.25);
          const p3 = p0.clone().addScaledVector(side, sgn * span * 1.05).addScaledVector(dir, -1.5);
          p3.y = G(p3.x, p3.z) - 1;
          batch.add(bone, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p0, p1, p2, p3]), 16, 0.35 + Math.sin(t * Math.PI) * 0.2, 6));
          SOLIDS.add({ cx: p3.x, cz: p3.z, hx: 0.5, hz: 0.5, yaw: 0, y0: p3.y, y1: p3.y + 3, tag: 'colossus-rib' });
        }
      }
    }
    // The skull, nose-down in the sand at the head end.
    const hx = S.x + dir.x * S.length * 0.56, hz = S.z + dir.z * S.length * 0.56;
    batch.add(bone, boulderGeometry(mulberry32(77), 2), new THREE.Matrix4().compose(new THREE.Vector3(hx, G(hx, hz) + 1.5, hz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, yaw, 0.2)), new THREE.Vector3(4, 3.2, 6.5)));
    SOLIDS.add({ cx: hx, cz: hz, hx: 3.6, hz: 5.5, yaw, y0: G(hx, hz) - 1, y1: G(hx, hz) + 4.2, tag: 'colossus-skull' });
    const lx = S.x + side.x * 3, lz = S.z + side.z * 3;
    loot.push({ id: 'colossus-cache', container: S.loot, x: lx, y: G(lx, lz), z: lz });
  }

  // ---- The Skyfall Crater: fused debris from the ring, the biggest pieces solid.
  {
    const c = D.crater, rock = skyfallRock();
    const geo = boulderGeometry(mulberry32(5), 1);
    const at: { x: number; y: number; z: number; s: number; yaw: number; tilt: number }[] = [];
    for (let i = 0; i < 46; i++) {
      const a = rand() * Math.PI * 2, d = (i < 12 ? 0.15 + rand() * 0.45 : 0.7 + rand() * 0.6) * c.radius;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, s = i < 6 ? 2.5 + rand() * 2.5 : 0.5 + rand() * 1.4;
      at.push({ x, y: G(x, z) + s * 0.15, z, s, yaw: rand() * 6, tilt: (rand() - 0.5) * 0.6 });
      if (s > 1.2) SOLIDS.add({ cx: x, cz: z, hx: s * 0.7, hz: s * 0.7, yaw: 0, y0: G(x, z) - 1, y1: G(x, z) + s * 0.7, tag: 'skyfall-rock' });
    }
    scene.add(instances(geo, rock, at, 'skyfall-debris'));
    scene.add(hazeVolume({ centre: new THREE.Vector3(c.x, G(c.x, c.z) + 6, c.z), size: new THREE.Vector3(c.radius * 1.6, 14, c.radius * 1.6), colour: OCHRE.dust, density: 0.012 }));
  }

  // ---- Loot that stands on open ground.
  for (const l of D.loot) loot.push({ id: l.id, container: l.container, x: l.x, y: l.y ?? G(l.x, l.z), z: l.z });

  // ---- Flora by rule: thorn trees on the flats, succulents in the gulch, grass on flat open ground.
  const treeVariants = [0, 1, 2].map(() => thornTree(rand));
  const trees: { x: number; y: number; z: number; s: number; yaw: number }[][] = [[], [], []];
  const placeTree = (x: number, z: number) => {
    if (Math.hypot(x, z) > D.playableRadius - 10 || slopeAt(x, z) > 0.18) return false;
    if (V.huts.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + 7) || Math.hypot(x - D.spawn.x, z - D.spawn.z) < 12) return false;
    if (D.extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 14)) return false;
    trees[Math.floor(rand() * 3)].push({ x, y: G(x, z), z, s: 0.8 + rand() * 0.6, yaw: rand() * 6 });
    return true;
  };
  const lone = (l: { x: number; z: number; radius: number }, n: number, minGap: number) => {
    const placed: Pt[] = [];
    for (let tries = 0; placed.length < n && tries < n * 30; tries++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * l.radius, x = l.x + Math.cos(a) * d, z = l.z + Math.sin(a) * d;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < minGap)) continue;
      if (placeTree(x, z)) placed.push({ x, z });
    }
  };
  lone(LM.acaciaFlats, D.trees.acaciaFlats, 14);
  lone({ x: 0, z: 0, radius: D.playableRadius }, D.trees.elsewhere, 40);
  const bark = thornBark(true), pads = leafPads();
  treeVariants.forEach((v, i) => {
    scene.add(instances(v.trunk, bark, trees[i], `thorn-trunks-${i}`), instances(v.canopy, pads, trees[i], `thorn-canopy-${i}`));
  });
  for (const list of trees) for (const t of list) SOLIDS.add({ cx: t.x, cz: t.z, hx: 0.35, hz: 0.35, yaw: 0, y0: t.y - 1, y1: t.y + 4, tag: 'tree' });

  const succ = [succulentGeometry(rand), succulentGeometry(rand)];
  const succAt: { x: number; y: number; z: number; s: number; sy: number; yaw: number }[][] = [[], []];
  const placeSucc = (x: number, z: number) => {
    if (slopeAt(x, z) > 0.3 || V.huts.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + 3)) return;
    const hgt = 2 + rand() * 3.5;
    succAt[Math.floor(rand() * 2)].push({ x, y: G(x, z) - 0.1, z, s: hgt * (0.9 + rand() * 0.3), sy: hgt, yaw: rand() * 6 });
  };
  // Along the gulch floor, in clumps.
  const path = D.gulch.path;
  for (let i = 0; i < D.succulents.cactusGulch; i++) {
    const seg = Math.floor(rand() * (path.length - 1)), t = rand();
    const [ax, az] = path[seg], [bx, bz] = path[seg + 1];
    const off = (rand() - 0.5) * D.gulch.halfWidth * 1.6;
    const len = Math.hypot(bx - ax, bz - az);
    placeSucc(ax + (bx - ax) * t + (-(bz - az) / len) * off, az + (bz - az) * t + ((bx - ax) / len) * off);
  }
  for (let i = 0; i < D.succulents.elsewhere; i++) {
    const a = rand() * Math.PI * 2, d = 60 + rand() * (D.playableRadius - 80);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - LM.duneSea.x, z - LM.duneSea.z) < LM.duneSea.radius) continue;
    placeSucc(x, z);
  }
  const skin = succulentSkin();
  succ.forEach((g, i) => scene.add(instances(g, skin, succAt[i], `succulents-${i}`)));

  // Grass: on flat ground that is neither dune nor clay yard; thickest on the flats, thin round the village.
  const grassAt: { x: number; y: number; z: number; s: number; yaw: number }[] = [];
  for (let i = 0; grassAt.length < 5200 && i < 26000; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (D.playableRadius - 5), x = Math.cos(a) * d, z = Math.sin(a) * d;
    const flats = 1 - smooth(LM.acaciaFlats.radius * 0.6, LM.acaciaFlats.radius * 1.5, Math.hypot(x - LM.acaciaFlats.x, z - LM.acaciaFlats.z));
    const dune = 1 - smooth(LM.duneSea.radius * 0.7, LM.duneSea.radius * 1.2, Math.hypot(x - LM.duneSea.x, z - LM.duneSea.z));
    const yard = V.huts.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + 2.5) || Math.hypot(x - plaza.x, z - plaza.z) < 14;
    const p = (0.12 + flats * 0.88) * (1 - dune) * (yard ? 0 : 1) * (1 - smooth(0.12, 0.25, slopeAt(x, z)));
    if (rand() > p) continue;
    grassAt.push({ x, y: G(x, z) - 0.05, z, s: 0.5 + rand() * 0.7, yaw: rand() * 6 });
  }
  scene.add(instances(grassClump(rand), dryGrass(), grassAt, 'dry-grass'));

  // Boulders on the gulch floor and round the butte feet (slope-shaded like the cliffs they fell from).
  const boulders: { x: number; y: number; z: number; s: number; yaw: number; tilt: number }[] = [];
  for (let i = 0; i < 70; i++) {
    const seg = Math.floor(rand() * (path.length - 1)), t = rand();
    const [ax, az] = path[seg], [bx, bz] = path[seg + 1];
    const x = ax + (bx - ax) * t + (rand() - 0.5) * 18, z = az + (bz - az) * t + (rand() - 0.5) * 18;
    boulders.push({ x, y: G(x, z), z, s: 0.6 + rand() * 2.2, yaw: rand() * 6, tilt: (rand() - 0.5) * 0.5 });
  }
  for (const b of D.buttes) for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, x = b.x + Math.cos(a) * (b.radius + 3 + rand() * 6), z = b.z + Math.sin(a) * (b.radius + 3 + rand() * 6);
    boulders.push({ x, y: G(x, z), z, s: 1 + rand() * 2.5, yaw: rand() * 6, tilt: (rand() - 0.5) * 0.5 });
  }
  for (const b of boulders) if (b.s > 1.3) SOLIDS.add({ cx: b.x, cz: b.z, hx: b.s * 0.7, hz: b.s * 0.7, yaw: 0, y0: b.y - 1, y1: b.y + b.s * 0.6, tag: 'boulder' });
  scene.add(instances(boulderGeometry(mulberry32(9), 1), groundMat, boulders, 'boulders'));

  // Bleached bone litter round every burrow: the other tell.
  const shards: { x: number; y: number; z: number; s: number; sy: number; yaw: number; tilt: number }[] = [];
  for (const b of D.burrows) for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2, d = 1.5 + rand() * 5, x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
    shards.push({ x, y: G(x, z), z, s: 0.15 + rand() * 0.2, sy: 0.6 + rand() * 0.8, yaw: rand() * 6, tilt: 1 + rand() * 0.4 });
  }
  scene.add(instances(new THREE.CylinderGeometry(0.4, 0.15, 1, 5), oldBone(ORGANIC.amber, 0.05), shards, 'burrow-bones'));

  for (const m of batch.meshes('ochre-static')) scene.add(m);

  // ---- Moving air: dust devils wandering the flats and the dune sea; grains drifting everywhere.
  const devil = (cx: number, cz: number, rx: number, rz: number, speed: number, ph: number) => (t: number) => {
    const a = t * speed + ph, x = cx + Math.cos(a) * rx + Math.sin(a * 2.3) * 12, z = cz + Math.sin(a) * rz;
    return new THREE.Vector3(x, G(x, z), z);
  };
  scene.add(dustDevil(rand, devil(LM.acaciaFlats.x, LM.acaciaFlats.z, 70, 50, 0.018, 0), 24));
  scene.add(dustDevil(rand, devil(LM.duneSea.x, LM.duneSea.z, 80, 60, 0.014, 2), 30));
  scene.add(dustDevil(rand, devil(-60, -120, 60, 40, 0.02, 4), 20, 700));
  scene.add(sporeField(rand, 320, 50, 25, [OCHRE.sandShade, OCHRE.dust]));

  // ---- Extract beacons: three leaning poles lashed at the top with tattered banners, a ring of stones.
  const sites = new THREE.Group();
  sites.name = 'ochre-sites';
  const rings = new Map<string, THREE.Mesh>();
  const banner = wovenCloth(OCHRE.rust);
  const stones = new Batch();
  for (const e of layout.extracts) {
    const y = G(e.x, e.z);
    const poles: THREE.BufferGeometry[] = [];
    const top = new THREE.Vector3(e.x, y + 9, e.z);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; poles.push(strut(new THREE.Vector3(e.x + Math.cos(a) * 3.4, y - 0.3, e.z + Math.sin(a) * 3.4), top, 0.12)); }
    sites.add(new THREE.Mesh(mergeGeometries(poles.map(plain)), mats.wood));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 4, 1, 6), banner);
    flag.position.set(e.x + 0.7, y + 6.6, e.z);
    flag.onBeforeRender = () => { flag.rotation.y = Math.sin(bioTime.value * 1.9 + e.x) * 0.5 + WIND; };
    sites.add(flag);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, x = e.x + Math.cos(a) * 5.5, z = e.z + Math.sin(a) * 5.5;
      stones.add(mats.floor, boulderGeometry(mulberry32(i + 40)), M4(x, G(x, z), z, a, 0.5));
    }
    const glow = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.07, 6, 48).rotateX(-Math.PI / 2), bioNode(ORGANIC.amber, 2));
    glow.position.set(e.x, y + 0.08, e.z);
    glow.visible = e.opensAt <= 0;
    rings.set(e.id, glow);
    sites.add(glow);
  }
  for (const m of stones.meshes('ochre-beacon-stones')) sites.add(m);
  scene.add(sites);

  return {
    layout,
    sites: { group: sites, setExtractOpen(id, open) { const r = rings.get(id); if (r) r.visible = open; }, setNodeHarvested() { /* no harvest nodes here */ } },
    structures: { group: village, loot, arena: null, breakPillar() { /* no boss arena yet */ } },
    landmarkAt: ochreLandmarkAt,
  };
}

/** Ground slope (rise over run) at (x, z). */
export function slopeAt(x: number, z: number): number {
  const e = 1.5;
  return Math.hypot(ochreGround(x + e, z) - ochreGround(x - e, z), ochreGround(x, z + e) - ochreGround(x, z - e)) / (2 * e);
}

/** A clay pot (unit height). */
function potGeometry(): THREE.BufferGeometry {
  const pts = [[0.0, 0], [0.32, 0.02], [0.48, 0.3], [0.45, 0.62], [0.26, 0.86], [0.2, 0.95], [0.26, 1]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 12);
}
