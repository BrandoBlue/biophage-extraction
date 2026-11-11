import * as THREE from 'three';
import { HIVE, ORGANIC, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, grownWall, livingFlesh, membrane, zoneRock } from '../render/materials';
import { hazeVolume, lightShaft } from '../render/atmos';
import { sporeField, starField, zone7Sky } from '../render/sky';
import { horizonLands } from '../render/horizon';
import { heightFog } from '../render/fog';
import { ZONE_SITES } from '../../data';
import { mulberry32 } from './rng';
import { Kit, oldBone, type ArenaInfo, type BuiltStructures, type LootSpot, type Walkway } from './structures';
import { noise3 } from '../render/geometry';
import type { SiteDressing } from './sites';
import type { ExtractSite, Zone7Layout } from './layout';
import { SOLIDS, setTerrain } from './zone7';

/**
 * Zone, the Marrow Pit (World & Level). Design's brief (data/zones.json marrowPit): a vertical shaft about 260 m
 * across and over 200 m deep, in depth layers that get darker, stranger and deadlier the further down you go.
 *
 *   Rim (0 m)          the Rim Camp: spawn, the Rim Lift extract, scaffold huts on the lip of the shaft
 *   Cable Shelf (-70)  a narrow ledge round the shaft; the Cable Bridge crosses the void to a hanging hub
 *   Warrens (-135)     the Hanging Warren (huts lashed to the cliff) and the Bone Gallery (rib colonnade in the wall)
 *   Undermouth (-215)  the floor: a maw ringed by bone pillars, sickly light, the Updraft extract (opens on the boss)
 *
 * The ground is one heightfield (pitHeight): shelves stepping inward and down, joined by ledge paths cut into the
 * cliff under each shelf's edge. Cliffs block walking (setTerrain maxSlope) and falls are lethal, so the way down is
 * the long way round, and the way back up is longer. Bridge, huts and gallery are colliders (SOLIDS).
 * Every position comes from data/zone7.json `marrowPit`.
 */

interface Polar { bearing: number; radius: number }
interface Layer { id: string; label: string; y: number; edge?: number; wobble?: number }
interface Ramp { id: string; upper: string; start: number; end: number; width: number }
interface PitData {
  cliff: number; maxSlope: number; playableRadius: number; outerRadius: number;
  layers: Layer[];
  ramps: Ramp[];
  spawn: Polar;
  extracts: (Polar & { id: string; label: string; opensAt: number | null; opensOn?: string })[];
  bridge: { layer: string; bearing: number; width: number; sag: number; hubRadius: number };
  camp: { huts: (Polar & { yaw: number })[] };
  warren: { from: number; to: number; radius: [number, number]; huts: number };
  gallery: { from: number; to: number; radius: number; ribs: number };
  undermouth: {
    arenaRadius: number; mawRadius: number; pillars: number; pillarRadius: number;
    rootColumns: { count: number; radius: number };
    ledges: (Polar & { height: number })[];
  };
  landmarks: Record<string, { layer: string; from?: number; to?: number; bridge?: boolean }>;
  loot: (Polar & { id: string; container: string; layer: string })[];
}

export const PIT = ZONE_SITES.marrowPit as unknown as PitData;

const D2R = Math.PI / 180, TAU = Math.PI * 2;
/** Inner faces of ledge paths and their cut ends drop this steeply (m per m); well past maxSlope, so they are walls. */
const FALL = 6;
/** Flat landing (m) where a ledge path leaves its upper shelf, so stepping on from the side is level. */
const LANDING = 6;

export const polar = (bearing: number, radius: number): [number, number] => [Math.cos(bearing * D2R) * radius, Math.sin(bearing * D2R) * radius];
const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

export function layerIndex(id: string): number {
  const i = PIT.layers.findIndex((l) => l.id === id);
  if (i < 0) throw new Error(`marrowPit: no layer ${id}`);
  return i;
}
export const layerY = (id: string): number => PIT.layers[layerIndex(id)].y;

/** Radius of layer k's lip at angle `a` (radians): the shelf runs from here outward; inside is the drop. */
export function edgeRadius(k: number, a: number): number {
  const l = PIT.layers[k];
  return (l.edge ?? 0) + (l.wobble ?? 0) * (0.55 * Math.sin(3 * a + k * 1.7) + 0.3 * Math.sin(7 * a + k * 2.9) + 0.15 * Math.sin(13 * a + k * 0.6));
}

/** Angle (radians, 0..2π) of bearing degrees. */
const rad = (deg: number) => ((deg * D2R) % TAU + TAU) % TAU;

/**
 * Ledge path surface at (r, a): runs along the foot of the upper layer's cliff from `start` (flush with the upper
 * shelf) to `end` (flush with the lower one). Off the path it falls away steeply, so max() with the shelves works.
 */
function rampSurface(rp: Ramp, r: number, a: number): number {
  const k = layerIndex(rp.upper);
  const up = PIT.layers[k].y, low = PIT.layers[k + 1].y;
  const foot = edgeRadius(k, a) - PIT.cliff;
  if (r > foot + PIT.cliff + 1) return -Infinity;
  const a0 = rad(rp.start), span = (rp.end - rp.start) * D2R;
  const da = ((a - a0) % TAU + TAU) % TAU;
  let t = 1, arcOut = 0;
  if (da <= span) t = da / span;
  // Before the start, a short flat landing at the upper shelf's level, then the cut end of the path.
  else if (TAU - da < da - span) { t = 0; arcOut = Math.max(0, (TAU - da) * foot - LANDING); }
  const inner = foot - rp.width;
  return up + (low - up) * t - Math.max(0, inner - r) * FALL - arcOut * FALL;
}

/** Fine relief on the shelves (rubble, slumps), under half a metre. */
function detail(x: number, z: number): number {
  return 0.25 * Math.sin(x * 0.23 + z * 0.11) * Math.cos(z * 0.19 - x * 0.05) + 0.1 * Math.sin(x * 0.71 + z * 0.63);
}

/** Ground height of the pit at (x, z). Shared by the mesh, the player, creatures and loot. */
export function pitHeight(x: number, z: number): number {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  const n = PIT.layers.length;
  // The floor dishes up gently toward its walls.
  const floorEdge = edgeRadius(n - 2, a);
  let h = PIT.layers[n - 1].y + 3 * Math.min(1, (r / floorEdge) ** 2);
  for (let k = n - 2; k >= 0; k--) {
    const R = edgeRadius(k, a);
    const w = smooth(R - PIT.cliff, R, r);
    if (w > 0) h += (PIT.layers[k].y - h) * w;
  }
  h += detail(x, z);
  for (const rp of PIT.ramps) h = Math.max(h, rampSurface(rp, r, a));
  // Past the playable lip the ground rises into the crater's outer wall: it frames the sky and nobody walks there.
  const out = r - PIT.playableRadius - 4;
  if (out > 0) h += out * 0.3 + out * out * 0.002 + Math.sin(a * 5 + 1.3) * Math.min(out, 20) * 0.2;
  return h;
}

/** Layer id a point belongs to: by height `y` if given, else by the ground there. */
export function layerAt(x: number, z: number, y?: number): string {
  const h = y ?? pitHeight(x, z);
  let best = PIT.layers[0], bd = Infinity;
  for (const l of PIT.layers) { const d = Math.abs(l.y - h); if (d < bd) { bd = d; best = l; } }
  return best.id;
}

const inArc = (bearing: number, from: number, to: number) => {
  const b = ((bearing - from) % 360 + 360) % 360;
  return b <= to - from;
};

/** Landmark (zones.json id) at a point; on the bridge only when standing on it (y near the deck). */
export function pitLandmarkAt(x: number, z: number, y?: number): string | null {
  const layer = layerAt(x, z, y);
  const bearing = Math.atan2(z, x) / D2R;
  for (const [id, m] of Object.entries(PIT.landmarks)) {
    if (m.bridge) {
      const by = layerY(m.layer);
      const [dx, dz] = polar(PIT.bridge.bearing, 1);
      const along = x * dx + z * dz, across = Math.abs(-x * dz + z * dx);
      // The deck, the hub, and the footings where it lands on the shelf either side.
      const onDeck = (across < PIT.bridge.width + 1 || Math.hypot(x, z) < PIT.bridge.hubRadius + 1 || (across < 6 && Math.abs(along) > edgeRadius(layerIndex(m.layer), Math.atan2(z, x)) - 2)) && Math.abs(along) < edgeRadius(layerIndex(m.layer), Math.atan2(z, x)) + 8;
      if (onDeck && (y === undefined || Math.abs(y - by) < 6)) return id;
      continue;
    }
    if (m.layer !== layer) continue;
    if (m.from === undefined || inArc(bearing, m.from, m.to ?? m.from)) return id;
  }
  return null;
}

/** The pit's layout in the Raid's terms: rim spawn, the two extracts, no island sites. */
export function pitLayout(seed: number): Zone7Layout {
  const [sx, sz] = polar(PIT.spawn.bearing, PIT.spawn.radius);
  const extracts: ExtractSite[] = PIT.extracts.map((e) => { const [x, z] = polar(e.bearing, e.radius); return { id: e.id, label: e.label, x, z, opensAt: e.opensAt ?? Infinity }; });
  return {
    seed,
    spawn: { id: 'spawn', x: sx, z: sz },
    extracts,
    dormantPads: [],
    pods: [],
    nests: [],
    nodes: [],
    // No anomaly in the pit: a zero-strength site far outside keeps gravityAt() at 1 everywhere.
    anomaly: { id: 'none', kind: 'none', x: 1e5, z: 1e5, radius: 1, gravityMultiplier: 1 },
  };
}

/**
 * Each landmark as a point to home creatures and containers on (Design's habitats.json `where: { landmark }`): the
 * middle of its arc on its layer's shelf, the hub for the bridge, the arena for the floor. `y` is the ground there.
 */
export function pitLandmarks(): { id: string; x: number; y: number; z: number; radius: number; layer: string }[] {
  return Object.entries(PIT.landmarks).map(([id, m]) => {
    const k = layerIndex(m.layer);
    if (m.bridge) return { id, x: 0, y: L(k).y, z: 0, radius: PIT.bridge.hubRadius, layer: m.layer };
    if (m.from === undefined) return { id, x: 0, y: pitHeight(0, PIT.undermouth.arenaRadius), z: PIT.undermouth.arenaRadius, radius: PIT.undermouth.arenaRadius, layer: m.layer };
    const b = (m.from + (m.to ?? m.from)) / 2, a = b * D2R;
    // The middle of the shelf: between this layer's lip and the foot of the cliff above it.
    const inner = edgeRadius(k, a), outer = k > 0 ? edgeRadius(k - 1, a) - PIT.cliff : PIT.playableRadius;
    const [x, z] = polar(b, (inner + outer) / 2);
    return { id, x, y: pitHeight(x, z), z, radius: Math.min(30, (((m.to ?? m.from) - m.from) * D2R * inner) / 2), layer: m.layer };
  });
}
const L = (k: number) => PIT.layers[k];

export interface PitWorld {
  layout: Zone7Layout;
  sites: SiteDressing;
  structures: BuiltStructures;
  landmarkAt(x: number, z: number, y?: number): string | null;
}

// ------------------------------------------------------------------ meshes

/** Polar terrain grid: fine near the shaft (cliffs need it), coarser out on the crater wall. */
function terrainGeometry(): THREE.BufferGeometry {
  const rings: number[] = [0.5];
  for (let r = 1.5; r < PIT.playableRadius + 6; r += 1) rings.push(r);
  for (let r = PIT.playableRadius + 8; r <= PIT.outerRadius; r += 4) rings.push(r);
  const segs = 384;
  const pos: number[] = [], idx: number[] = [];
  for (const r of rings) for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
    pos.push(x, pitHeight(x, z), z);
  }
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + segs + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Zone rock that darkens with depth: the deeper stone drinks the light. */
function pitRock(): THREE.MeshStandardMaterial {
  const m = zoneRock({ veinColour: ZONE7_SHADE.moss, mossColour: ZONE7_SHADE.moss, scale: 0.85 });
  const base = m.onBeforeCompile.bind(m);
  const top = PIT.layers[0].y, bottom = PIT.layers[PIT.layers.length - 1].y;
  m.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>',
      `diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(${bottom.toFixed(1)}, ${(top - 10).toFixed(1)}, vBioWorld.y));\n#include <lights_physical_fragment>`);
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => key + '|pitDepth';
  return m;
}

/** A hanging line between two points with sag (catenary-ish parabola). */
function sagCurve(a: THREE.Vector3, b: THREE.Vector3, sag: number, n = 12): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(a.clone().lerp(b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0))); }
  return new THREE.CatmullRomCurve3(pts);
}

/** Lumpy rock: an icosahedron pushed about by a few sines so no two read alike. */
function lumpGeometry(seed: number, detailLevel = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detailLevel);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.22 * Math.sin(x * 3.1 + seed) * Math.cos(y * 2.7 + seed * 1.3) + 0.12 * Math.sin(z * 5.3 + seed * 2.1);
    p.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  g.computeVertexNormals();
  return g;
}

interface Mats { wall: THREE.Material; frame: THREE.Material; hide: THREE.Material; deck: THREE.Material; rope: THREE.Material; lamp: THREE.Material }

/**
 * A hut of lashed bone and cured hide (local +u is the door side). On stilts with an entry ramp when its floor is
 * above the ground. Returns the floor height and a loot spot at the back wall.
 */
function hut(k: Kit, m: Mats, o: { x: number; z: number; yaw: number; w: number; d: number; h: number; floorY: number; groundY: number; tag: string }): { floorY: number; back: [number, number] } {
  const co = Math.cos(o.yaw), si = Math.sin(o.yaw);
  const at = (u: number, v: number): [number, number] => [o.x + u * co + v * si, o.z - u * si + v * co];
  const { w, d, h, floorY: f } = o;
  const T = 0.14, door = 1.6;
  const wall = (u: number, v: number, hu: number, hv: number, y0: number, y1: number) => { const [x, z] = at(u, v); k.box(x, z, hu, hv, y0, y1, m.wall, { yaw: o.yaw, tag: o.tag }); };
  const [fx, fz] = at(0, 0);
  k.box(fx, fz, w / 2, d / 2, f - 0.3, f, m.deck, { yaw: o.yaw, tag: `${o.tag}-floor` });
  wall(-w / 2, 0, T, d / 2, f, f + h);
  wall(0, -d / 2, w / 2, T, f, f + h);
  wall(0, d / 2, w / 2, T, f, f + h);
  const side = (d - door) / 4;
  wall(w / 2, -(door / 2 + side), T, side, f, f + h);
  wall(w / 2, door / 2 + side, T, side, f, f + h);
  wall(w / 2, 0, T, door / 2, f + 2.3, f + h);
  // Hide roof, pitched down to the door, overhanging; no collider.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 0.18, d + 1.0), m.hide);
  roof.position.set(fx, f + h + 0.55, fz);
  roof.rotation.set(0, o.yaw, -0.28, 'YXZ');
  k.group.add(roof);
  // Bone frame at the corners, poking through the roof like ribs.
  for (const [u, v] of [[-w / 2, -d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [w / 2, d / 2]]) {
    const [x, z] = at(u, v);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, h + 1.6 + (f - o.groundY), 6), m.frame);
    post.position.set(x, (o.groundY + f + h + 1.6) / 2, z);
    k.group.add(post);
  }
  const lift = f - o.groundY;
  if (lift > 0.4) {
    // Ramp up to the door: rises toward the hut (its local +x points back at the door).
    const len = Math.max(2.2, lift / 0.55);
    const [rx, rz] = at(w / 2 + len / 2, 0);
    k.box(rx, rz, len / 2, 0.8, o.groundY - 0.4, f, m.deck, { yaw: o.yaw + Math.PI, rise: lift + 0.4, tag: `${o.tag}-ramp` });
  }
  return { floorY: f, back: at(-w / 2 + 1, 0) };
}

/** A lantern: a dim amber bulb in a bone cage, optionally with a real light (keep those few). */
function lantern(k: Kit, m: Mats, x: number, y: number, z: number, light = 0): void {
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), m.lamp);
  bulb.position.set(x, y, z);
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.6, 6, 1, true), m.frame);
  cage.position.copy(bulb.position);
  k.group.add(bulb, cage);
  if (light > 0) {
    const l = new THREE.PointLight(ORGANIC.amber, light * 2.5, 30, 2);
    l.position.set(x, y - 0.3, z);
    k.group.add(l);
  }
}

/**
 * The visible face of layer k's cliff: a band of rock from the shelf below (or the ledge path cut into it) up to the
 * lip, bulging and stepping in strata. It sits inside the heightfield's own steep face, so collision is unchanged.
 */
function cliffWall(k: number, mat: THREE.Material): THREE.Mesh {
  const cols = 512, rows = 44;
  const up = L(k).y, low = L(k + 1).y;
  const path = PIT.ramps.find((r) => r.upper === L(k).id);
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const a = (i / cols) * TAU, R = edgeRadius(k, a);
    const ca = Math.cos(a), sa = Math.sin(a);
    // Where the ledge path runs along this cliff's foot, the face starts on the path instead of the shelf below.
    const foot = path ? Math.max(low, rampSurface(path, R - PIT.cliff - 0.5, a)) : low;
    const bottom = foot - 1.5;
    for (let j = 0; j <= rows; j++) {
      const t = j / rows, y = bottom + (up + 0.2 - bottom) * t;
      const nx = ca * R * 0.05, nz = sa * R * 0.05;
      const bulge = (noise3(nx, y * 0.045, nz + k * 7) - 0.5) * 2.4 + (noise3(nx * 4, y * 0.2, nz * 4 + 3) - 0.5) * 0.9;
      const strata = Math.max(0, Math.sin(y * 0.55 + noise3(nx * 2, y * 0.05, nz * 2) * 6)) ** 6 * 0.6;
      const r = Math.min(R - 0.1, Math.max(R - PIT.cliff, R - 0.2 - 2.6 * (1 - t) + (bulge + strata) * Math.sin(Math.PI * Math.min(1, t * 1.15))));
      pos.push(ca * r, y, sa * r);
    }
  }
  // Wound so the face looks into the shaft.
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const a = i * (rows + 1) + j, b = a + rows + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `pit-cliff-${L(k).id}`;
  return mesh;
}

/** Builds the pit into `scene` (SOLIDS reset; the terrain swapped for pitHeight with cliffs that block). */
export function buildPit(scene: THREE.Scene, seed: number): PitWorld {
  const rand = mulberry32(seed * 37 + 11);
  setTerrain(pitHeight, { maxSlope: PIT.maxSlope });
  SOLIDS.clear();
  const layout = pitLayout(seed);
  const L = PIT.layers, top = L[0].y, bottom = L[L.length - 1].y, depth = top - bottom;

  // ---- Sky and air: an overcast night overhead; below, haze that thickens and turns olive toward the bottom.
  const sky = zone7Sky();
  sky.userData.bake = true;
  scene.add(sky, starField(rand), horizonLands({ seed: 41 }));
  scene.background = new THREE.Color(ZONE7.void);
  const fogTop = new THREE.Color(ZONE7_SHADE.skyHorizon).multiplyScalar(0.7), fogDeep = new THREE.Color(ZONE7_SHADE.moss).multiplyScalar(0.6);
  const fog = new THREE.FogExp2(fogTop.getHex(), 0.0034);
  scene.fog = fog;
  // Height fog pools at the floor (values are baked when the pipeline installs its fog, which happens after this).
  heightFog.base.value = bottom;
  heightFog.falloff.value = 45;
  heightFog.layer.value = 2.2;
  const hemi = new THREE.HemisphereLight(ORGANIC.mist, ZONE7_SHADE.rockDeep, 1.4);
  const moon = new THREE.DirectionalLight(ORGANIC.mist, 2.8);
  moon.position.set(-30, 200, 40);
  // A low, cold side light raking across the far walls so the cliffs read as carved rock, not flat planes.
  const rake = new THREE.DirectionalLight(ORGANIC.mist, 1.1);
  rake.position.set(130, 55, -90);
  scene.add(hemi, moon, rake);

  // ---- The shaft.
  const rockMat = pitRock();
  const ground = new THREE.Mesh(terrainGeometry(), rockMat);
  ground.name = 'ground';
  // The deeper the host stands, the less of the sky reaches them.
  const camPos = new THREE.Vector3();
  ground.onBeforeRender = (_r, _s, cam) => {
    if (!(cam as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    cam.getWorldPosition(camPos);
    const t = Math.min(1, Math.max(0, (top - camPos.y) / depth));
    moon.intensity = 2.8 - 2.0 * t;
    rake.intensity = 1.1 - 0.7 * t;
    hemi.intensity = 1.4 - 1.0 * t;
    fog.color.copy(fogTop).lerp(fogDeep, t);
  };
  scene.add(ground);
  for (let kk = 0; kk < L.length - 1; kk++) scene.add(cliffWall(kk, rockMat));

  const k = new Kit(SOLIDS, 0, 0, 0, 0);
  k.group.name = 'marrow-pit';
  const mats: Mats = {
    wall: grownWall({ base: ZONE7_SHADE.stem, seam: ZONE7_SHADE.rockDeep, vein: ORGANIC.amber, plate: 0.8 }),
    frame: oldBone(ORGANIC.amber, 0.1),
    hide: grownWall({ base: ZONE7_SHADE.flesh, seam: ORGANIC.wetFleshDeep, vein: ORGANIC.vein, plate: 1.3 }),
    deck: grownWall({ base: ZONE7_SHADE.rockDeep, seam: '#000000', vein: ORGANIC.amber, plate: 0.5 }),
    rope: new THREE.MeshStandardMaterial({ color: ZONE7_SHADE.stem, roughness: 0.95 }),
    lamp: bioNode(ORGANIC.amber, 0.4),
  };
  const loot: LootSpot[] = [];
  const walkways: Walkway[] = [];

  // ---- Rock outcrops on the cliff faces and roots hanging over every lip: the walls read as mass, not a lathe.
  const lump = lumpGeometry(3);
  const outcrops: THREE.Matrix4[] = [];
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < 220; i++) {
    const kk = Math.floor(rand() * (L.length - 1)), a = rand() * TAU;
    const y = L[kk + 1].y + (L[kk].y - L[kk + 1].y) * (0.1 + rand() * 0.85);
    const r = edgeRadius(kk, a) - PIT.cliff * 0.4 + rand() * 1.5;
    const sc = 1.5 + rand() * rand() * 6;
    mtx.compose(v.set(Math.cos(a) * r, y, Math.sin(a) * r), q.setFromEuler(e.set(rand() * 3, rand() * 6, rand() * 3)), s.set(sc * (1 + rand()), sc * (0.5 + rand() * 0.6), sc));
    outcrops.push(mtx.clone());
  }
  const rocks = new THREE.InstancedMesh(lump, rockMat, outcrops.length);
  outcrops.forEach((m4, i) => rocks.setMatrixAt(i, m4));
  rocks.name = 'pit-outcrops';
  k.group.add(rocks);
  const rootMat = oldBone(ZONE7_SHADE.moss, 0.05);
  for (let i = 0; i < 46; i++) {
    const kk = Math.floor(rand() * (L.length - 1)), a = rand() * TAU, r = edgeRadius(kk, a) + 0.5;
    const len = 8 + rand() * (L[kk].y - L[kk + 1].y) * 0.6;
    const pts = [new THREE.Vector3(Math.cos(a) * r, L[kk].y + 0.3, Math.sin(a) * r)];
    for (let j = 1; j <= 5; j++) {
      const rr = r - PIT.cliff - 1.1 - rand() * 0.8 - (j === 5 ? rand() * 2 : 0);
      const aa = a + (rand() - 0.5) * 0.01 * j;
      pts.push(new THREE.Vector3(Math.cos(aa) * rr, L[kk].y - (len * j) / 5, Math.sin(aa) * rr));
    }
    k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.12 + rand() * 0.22, 5), rootMat));
  }

  // ---- Old cables strung across the shaft at every depth, a few hung with cocoons.
  const cocoonMat = membrane(ORGANIC.wetFlesh, 0.75);
  const cocoonGeo = new THREE.CapsuleGeometry(0.45, 1.3, 4, 8);
  const shaftR = (y: number, a: number) => { let kk = 0; while (kk < L.length - 2 && y < L[kk + 1].y) kk++; return edgeRadius(kk, a) - PIT.cliff - 0.5; };
  for (let i = 0; i < 18; i++) {
    const y = top - 6 - rand() * (depth - 30);
    const a1 = rand() * TAU, a2 = a1 + Math.PI * (0.45 + rand() * 0.9);
    const p1 = new THREE.Vector3(Math.cos(a1) * shaftR(y, a1), y, Math.sin(a1) * shaftR(y, a1));
    const p2 = new THREE.Vector3(Math.cos(a2) * shaftR(y, a2), y - rand() * 12, Math.sin(a2) * shaftR(y, a2));
    const curve = sagCurve(p1, p2, 4 + rand() * 18, 16);
    k.group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.1 + rand() * 0.2, 5), mats.rope));
    if (rand() < 0.4) {
      for (let c = 0; c < 4; c++) {
        const at = curve.getPoint(0.2 + rand() * 0.6), drop = 1 + rand() * 4;
        k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([at, at.clone().add(new THREE.Vector3(0, -drop, 0))]), 2, 0.03, 4), mats.rope));
        const cocoon = new THREE.Mesh(cocoonGeo, cocoonMat);
        cocoon.position.copy(at).add(new THREE.Vector3(0, -drop - 0.9, 0));
        cocoon.rotation.z = (rand() - 0.5) * 0.3;
        k.group.add(cocoon);
      }
    }
  }

  // ---- Dead scaffolds bolted to the walls between layers: out of reach, the remains of whoever dug here first.
  for (let i = 0; i < 6; i++) {
    const kk = i % (L.length - 1), a = rand() * TAU;
    const y = L[kk + 1].y + (L[kk].y - L[kk + 1].y) * (0.35 + rand() * 0.4);
    const r = edgeRadius(kk, a) - PIT.cliff - 2.2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, yaw = -a + Math.PI;
    const plat = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.25, 6), mats.deck);
    plat.position.set(x, y, z);
    plat.rotation.y = yaw;
    const shack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 3.2), mats.wall);
    shack.position.set(x + Math.cos(a) * 0.8, y + 1.3, z + Math.sin(a) * 0.8);
    shack.rotation.y = yaw;
    k.group.add(plat, shack);
    for (const side of [-1, 1]) {
      const ss = new THREE.Vector3(x + Math.sin(a) * side * 2.5, y, z - Math.cos(a) * side * 2.5);
      const wallPt = new THREE.Vector3(Math.cos(a) * (r + 2.5), y - 4, Math.sin(a) * (r + 2.5)).add(new THREE.Vector3(Math.sin(a) * side * 2.5, 0, -Math.cos(a) * side * 2.5));
      k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([ss, wallPt]), 2, 0.12, 5), mats.frame));
    }
    if (i % 2 === 0) lantern(k, mats, x, y + 2.9, z);
  }

  // ---- The Rim Camp: scaffold huts on the lip, crates, the lift gantry hanging its cage over the drop.
  for (const [i, hspec] of PIT.camp.huts.entries()) {
    const [x, z] = polar(hspec.bearing, hspec.radius);
    // Door faces the shaft, turned by the data yaw.
    const yaw = -(hspec.bearing * D2R) + Math.PI + hspec.yaw * D2R;
    const g = pitHeight(x, z);
    const h = hut(k, mats, { x, z, yaw, w: 4.2, d: 5, h: 2.8, floorY: g + 0.6, groundY: g, tag: `camp-hut-${i}` });
    if (i > 0) loot.push({ id: `rim-hut-${i}`, container: 'pitCrate', x: h.back[0], y: h.floorY, z: h.back[1] });
  }
  {
    const lift = PIT.extracts.find((x) => x.id === 'rimLift') ?? PIT.extracts[0];
    const a = lift.bearing * D2R, lip = edgeRadius(0, a);
    const ix = Math.cos(a), iz = Math.sin(a), tx = -iz, tz = ix;
    // Two leaning bone masts on the lip with a boom out over the shaft; a winch wheel and a cage on its cable.
    const boomEnd = new THREE.Vector3(ix * (lip - 9), 17, iz * (lip - 9));
    for (const side of [-1, 1]) {
      const foot = new THREE.Vector3(ix * (lip + 2) + tx * side * 3, pitHeight(ix * (lip + 2) + tx * side * 3, iz * (lip + 2) + tz * side * 3), iz * (lip + 2) + tz * side * 3);
      k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([foot, new THREE.Vector3(ix * (lip - 1) + tx * side * 1.2, 15, iz * (lip - 1) + tz * side * 1.2), boomEnd]), 16, 0.32, 6), mats.frame));
      k.solids.add({ cx: foot.x, cz: foot.z, hx: 0.4, hz: 0.4, yaw: 0, y0: foot.y, y1: foot.y + 4, tag: 'lift-mast' });
    }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 6, 18), mats.frame);
    wheel.position.set(ix * (lip + 4), 2.2, iz * (lip + 4));
    wheel.rotation.y = -a;
    k.group.add(wheel);
    const cageY = -24;
    k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([boomEnd, new THREE.Vector3(boomEnd.x, cageY + 3, boomEnd.z)]), 2, 0.05, 4), mats.rope));
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 8, 3, true), mats.frame);
    cage.position.set(boomEnd.x, cageY + 1.5, boomEnd.z);
    k.group.add(cage);
    lantern(k, mats, boomEnd.x, 16, boomEnd.z, 0);
    const [lx, lz] = polar(lift.bearing + 6, lift.radius + 3);
    lantern(k, mats, lx, pitHeight(lx, lz) + 3.2, lz, 34);
  }
  {
    const [cx, cz] = polar(178, 136);
    lantern(k, mats, cx, pitHeight(cx, cz) + 3, cz, 28);
    // Crates stacked by the huts (cover).
    for (let i = 0; i < 8; i++) {
      const [x, z] = polar(150 + rand() * 50, 133 + rand() * 12);
      if (Math.hypot(x - PIT.spawn.radius * Math.cos(PIT.spawn.bearing * D2R), z - PIT.spawn.radius * Math.sin(PIT.spawn.bearing * D2R)) < 6) continue;
      const sz = 1 + rand() * 0.8, g = pitHeight(x, z);
      k.box(x, z, sz / 2, sz / 2, g - 0.1, g + sz * 0.9, mats.deck, { yaw: rand() * 3, tag: 'crate' });
    }
  }

  // ---- The Cable Bridge: a sagging walkway across the shaft at the Cable Shelf, meeting a hub slung from the rim.
  {
    const b = PIT.bridge, y0 = layerY(b.layer), kk = layerIndex(b.layer);
    const [dx, dz] = polar(b.bearing, 1);
    const hubR = b.hubRadius;
    // Octagonal hub deck (two crossed boxes for collision) with a shack and a lantern.
    k.box(0, 0, hubR, hubR * 0.42, y0 - 0.5, y0, mats.deck, { yaw: 0, tag: 'bridge-hub' });
    k.box(0, 0, hubR, hubR * 0.42, y0 - 0.5, y0, mats.deck, { yaw: Math.PI / 2, tag: 'bridge-hub' });
    k.box(0, 0, hubR * 0.72, hubR * 0.72, y0 - 0.5, y0, mats.deck, { yaw: Math.PI / 4, tag: 'bridge-hub' });
    const shack = hut(k, mats, { x: -dz * 3.2, z: dx * 3.2, yaw: -(b.bearing * D2R), w: 3.6, d: 4, h: 2.5, floorY: y0, groundY: y0, tag: 'hub-shack' });
    loot.push({ id: 'cables-hub-0', container: 'pitCrate', x: shack.back[0], y: y0, z: shack.back[1] });
    loot.push({ id: 'cables-hub-1', container: 'pitCrate', x: dz * 4.5, y: y0, z: -dx * 4.5 });
    lantern(k, mats, dz * 3, y0 + 3.4, -dx * 3, 30);
    // Hub hangs from four cables to the rim.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4, r = edgeRadius(0, a) - 1;
      const corner = new THREE.Vector3(Math.cos(a) * hubR * 0.9, y0 + 0.2, Math.sin(a) * hubR * 0.9);
      k.group.add(new THREE.Mesh(new THREE.TubeGeometry(sagCurve(corner, new THREE.Vector3(Math.cos(a) * r, top - 1, Math.sin(a) * r), 3, 24), 36, 0.14, 5), mats.rope));
    }
    // Two spans: hub edge to a footing a few metres onto the shelf on each side, in 2 m flat segments following the sag.
    for (const dir of [1, -1]) {
      const a = Math.atan2(dz * dir, dx * dir);
      const end = edgeRadius(kk, a) + 5;
      const start = hubR - 0.6, len = end - start, n = Math.ceil(len / 2);
      const segLen = len / n;
      const yaw = -a;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, rr = start + len * t;
        const sag = b.sag * 4 * t * (1 - t);
        // Over the shelf the deck sits a hand above the rubble, so it is a step down onto the ground, never up.
        const [gx, gz] = [dx * dir * rr, dz * dir * rr];
        const sy = rr > edgeRadius(kk, a) - 1 ? Math.max(y0 - sag, pitHeight(gx, gz) + 0.3) : y0 - sag;
        const seg = k.box(dx * dir * rr, dz * dir * rr, segLen / 2 + 0.05, b.width / 2, sy - 0.25, sy, mats.deck, { yaw, tag: 'bridge-deck' });
        let isCut = false;
        walkways.push({
          id: `bridge-${dir > 0 ? 'a' : 'b'}-${i}`, x: dx * dir * rr, y: sy, z: dz * dir * rr, halfLength: segLen / 2, halfWidth: b.width / 2, yaw,
          get isCut() { return isCut; },
          // The plank run falls away: no mesh, and the collider sinks far below anything that could stand on it.
          cut() { if (isCut) return; isCut = true; seg.mesh.visible = false; seg.collider.y0 = seg.collider.y1 = -1e4; },
        });
      }
      // Hand ropes and hangers.
      for (const side of [-1, 1]) {
        const off = (b.width / 2 + 0.05) * side, ox = -dz * dir * off, oz = dx * dir * off;
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16, rr = start + len * t;
          pts.push(new THREE.Vector3(dx * dir * rr + ox, y0 - b.sag * 4 * t * (1 - t) + 1.1, dz * dir * rr + oz));
        }
        k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.045, 4), mats.rope));
        for (let i = 1; i < 16; i += 2) {
          const p = pts[i];
          k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p, p.clone().add(new THREE.Vector3(0, -1.15, 0))]), 1, 0.03, 3), mats.rope));
        }
      }
      // Bone pylons at the footing.
      for (const side of [-1, 1]) {
        const off = (b.width / 2 + 0.4) * side;
        const px = dx * dir * end - dz * dir * off, pz = dz * dir * end + dx * dir * off;
        const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 4.5, 6), mats.frame);
        pylon.position.set(px, y0 + 1.6, pz);
        k.group.add(pylon);
      }
    }
  }

  // ---- The Hanging Warren: huts on stilts lashed to the cliff foot of the Warrens, joined by rope lines.
  {
    const w = PIT.warren, y = layerY('warrens');
    const huts: THREE.Vector3[] = [];
    for (let i = 0; i < w.huts; i++) {
      const bearing = w.from + ((w.to - w.from) * (i + 0.5)) / w.huts + (rand() - 0.5) * 3;
      const radius = w.radius[0] + rand() * (w.radius[1] - w.radius[0]);
      const [x, z] = polar(bearing, radius);
      const g = pitHeight(x, z);
      const lift = i % 3 === 1 ? 2.2 : 1.0;
      const h = hut(k, mats, { x, z, yaw: -(bearing * D2R) + Math.PI + (rand() - 0.5) * 0.5, w: 4 + rand() * 1.2, d: 4.6 + rand(), h: 2.6, floorY: g + lift, groundY: g, tag: `warren-hut-${i}` });
      huts.push(new THREE.Vector3(x, g + lift + 3.2, z));
      if (i % 2 === 0) loot.push({ id: `warrens-hut-${i}`, container: 'pitCrate', x: h.back[0], y: h.floorY, z: h.back[1] });
    }
    for (let i = 0; i < huts.length - 1; i++) {
      k.group.add(new THREE.Mesh(new THREE.TubeGeometry(sagCurve(huts[i], huts[i + 1], 1.5, 8), 20, 0.04, 4), mats.rope));
    }
    const [lx, lz] = polar((w.from + w.to) / 2, w.radius[0] - 3);
    lantern(k, mats, lx, y + 3.5, lz, 26);
  }

  // ---- The Bone Gallery: giant ribs curving out of the wall over the Warrens shelf, roofed with old plates.
  {
    const gl = PIT.gallery, y = layerY('warrens');
    const ribMat = oldBone(ORGANIC.amber, 0.12);
    for (let i = 0; i < gl.ribs; i++) {
      const bearing = gl.from + ((gl.to - gl.from) * i) / (gl.ribs - 1);
      const a = bearing * D2R, wallR = edgeRadius(1, a) + 1, footR = gl.radius - 9;
      const [fx, fz] = polar(bearing, footR);
      const g = pitHeight(fx, fz);
      const pts = [
        new THREE.Vector3(Math.cos(a) * wallR, y + 14, Math.sin(a) * wallR),
        new THREE.Vector3(Math.cos(a) * (footR + 6), y + 13, Math.sin(a) * (footR + 6)),
        new THREE.Vector3(Math.cos(a) * (footR + 1), y + 7, Math.sin(a) * (footR + 1)),
        new THREE.Vector3(fx, g - 0.5, fz),
      ];
      k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.7 - i * 0.02, 8), ribMat));
      k.solids.add({ cx: fx, cz: fz, hx: 0.8, hz: 0.8, yaw: 0, y0: g - 1, y1: g + 6, tag: 'gallery-rib' });
      if (i < gl.ribs - 1) {
        const mid = bearing + (gl.to - gl.from) / (gl.ribs - 1) / 2, ma = mid * D2R;
        const plate = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, ((gl.to - gl.from) / (gl.ribs - 1)) * D2R * (footR + 6) + 1), mats.hide);
        plate.position.set(Math.cos(ma) * (footR + 5.5), y + 13.3, Math.sin(ma) * (footR + 5.5));
        plate.rotation.set(0, -ma, 0.18, 'YXZ');
        if (rand() < 0.8) k.group.add(plate);
      }
    }
    // Bone litter under the colonnade; two caches.
    const litter = new THREE.InstancedMesh(lumpGeometry(9, 0), ribMat, 70);
    for (let i = 0; i < 70; i++) {
      const [x, z] = polar(gl.from + rand() * (gl.to - gl.from), gl.radius - 6 + rand() * 7);
      const sc = 0.2 + rand() * 0.6;
      litter.setMatrixAt(i, mtx.compose(v.set(x, pitHeight(x, z), z), q.setFromEuler(e.set(rand() * 3, rand() * 6, rand() * 3)), s.set(sc * 2.2, sc * 0.5, sc * 0.7)));
    }
    k.group.add(litter);
    for (const [i, frac] of [0.3, 0.75].entries()) {
      const [x, z] = polar(gl.from + (gl.to - gl.from) * frac, gl.radius - 3);
      loot.push({ id: `warrens-gallery-${i}`, container: 'deepCache', x, y: pitHeight(x, z), z });
    }
    const [lx, lz] = polar((gl.from + gl.to) / 2, gl.radius - 6);
    lantern(k, mats, lx, y + 3.2, lz, 0);
  }

  // ---- The Undermouth (bosses.json nethermaw arena): the floor round the Nethermaw's mouth, four root columns that
  // feed it (breakable), three rock ledges to get high on, bone pillars and heaps further out, lit sick from below.
  let arena: ArenaInfo;
  const columns = new Map<string, { mesh: THREE.Object3D; collider: { y1: number } }>();
  {
    const u = PIT.undermouth, y = bottom;
    const coral = livingFlesh(ZONE7_SHADE.flesh, ORGANIC.vein, ZONE7_SHADE.moss, 18);
    const lips = new THREE.InstancedMesh(lumpGeometry(5), coral, 22);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + rand() * 0.1, r = u.mawRadius + rand() * 1.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, sc = 1.6 + rand() * 1.4;
      lips.setMatrixAt(i, mtx.compose(v.set(x, pitHeight(x, z) + sc * 0.15, z), q.setFromEuler(e.set(0, -a, 0.3)), s.set(sc * 0.8, sc * 0.8, sc * 1.4)));
    }
    lips.name = 'undermouth-lips';
    k.group.add(lips);
    // The mouth: a black well inside the lips. The Nethermaw's body (Creature) grows over it.
    const throat = new THREE.Mesh(new THREE.CircleGeometry(u.mawRadius - 1.5, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ZONE7_SHADE.rockDeep }));
    throat.position.y = pitHeight(0, 0) + 0.25;
    throat.userData.noShadow = true;
    k.group.add(throat);
    const pores = bioNode(ZONE7.lime, 0.5);
    for (let i = 0; i < 9; i++) {
      const a = rand() * TAU, r = u.mawRadius + 0.5 + rand() * 1.5;
      const pore = new THREE.Mesh(new THREE.SphereGeometry(0.16 + rand() * 0.18, 8, 6), pores);
      pore.position.set(Math.cos(a) * r, pitHeight(Math.cos(a) * r, Math.sin(a) * r) + 1.2 + rand(), Math.sin(a) * r);
      k.group.add(pore);
    }
    const sick = new THREE.PointLight(ZONE7.lime, 60, 90, 1.6);
    sick.position.set(0, y + 6, 0);
    k.group.add(sick);
    // Root columns: thick braided roots from the mouth up into the dark; each one breaks (boss phase 1).
    const rootMat = livingFlesh(ZONE7_SHADE.stem, ORGANIC.vein, ZONE7_SHADE.moss, 10);
    const pillars: ArenaInfo['pillars'] = [];
    for (let i = 0; i < u.rootColumns.count; i++) {
      const a = (i / u.rootColumns.count) * TAU + Math.PI / 4, cx = Math.cos(a) * u.rootColumns.radius, cz = Math.sin(a) * u.rootColumns.radius;
      const g = pitHeight(cx, cz), id = `root-column-${i}`;
      const col = new THREE.Group();
      for (let strand = 0; strand < 3; strand++) {
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j <= 10; j++) {
          const t = j / 10, tw = t * 5 + (strand / 3) * TAU, rr = 0.7 * (1 - t * 0.3);
          // Low down the strands lean in from the mouth; high up they reach for the wall.
          pts.push(new THREE.Vector3(cx * (1 - 0.35 * (1 - t) ** 3) + Math.cos(tw) * rr + cx * t * 0.6, g - 0.5 + t * 34, cz * (1 - 0.35 * (1 - t) ** 3) + Math.sin(tw) * rr + cz * t * 0.6));
        }
        col.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.55 - strand * 0.08, 7), rootMat));
      }
      k.group.add(col);
      const collider = k.solids.add({ cx, cz, hx: 1.2, hz: 1.2, yaw: 0, y0: g - 1, y1: g + 8, tag: id });
      columns.set(id, { mesh: col, collider });
      let broken = false;
      pillars.push({ id, x: cx, z: cz, radius: 1.2, get broken() { return broken; }, destroy() { if (broken) return; broken = true; col.visible = false; collider.y1 = collider.y0; } });
    }
    // Ledges: three rock shelves round the arena edge, each with a ramp up from the floor; the highest is the
    // place to stand in the Swallow phase.
    const shelfMat = rockMat;
    let top = u.ledges[0];
    for (const [i, ld] of u.ledges.entries()) {
      const [lx, lz] = polar(ld.bearing, ld.radius), a = ld.bearing * D2R, g = pitHeight(lx, lz);
      k.box(lx, lz, 3, 5, g - 1, g + ld.height, shelfMat, { yaw: -a, tag: `undermouth-ledge-${i}` });
      // Ramp along the ledge's outer side, rising toward it (tangential, so it never points at the mouth).
      const len = Math.max(4, ld.height / 0.45), tx = -Math.sin(a), tz = Math.cos(a);
      const [rx, rz] = [lx + tx * (5 + len / 2), lz + tz * (5 + len / 2)];
      k.box(rx, rz, len / 2, 1.4, pitHeight(rx, rz) - 1, g + ld.height, shelfMat, { yaw: -(a + Math.PI / 2) + Math.PI, rise: ld.height + 1, tag: `undermouth-ledge-ramp-${i}` });
      for (let j = 0; j < 5; j++) {
        const b = rand() * TAU, rr = 3.5 + rand() * 2;
        const lump = new THREE.Mesh(lumpGeometry(20 + i * 5 + j), rockMat);
        lump.position.set(lx + Math.cos(b) * rr, g + rand() * ld.height * 0.6, lz + Math.sin(b) * rr);
        lump.scale.setScalar(1 + rand() * 1.4);
        k.group.add(lump);
      }
      if (i > 0) loot.push({ id: `deep-cache-${i - 1}`, container: 'deepCache', x: lx - Math.cos(a) * 1.5, y: g + ld.height, z: lz - Math.sin(a) * 1.5 });
      if (ld.height > top.height) top = ld;
    }
    const pillarMat = oldBone(ZONE7_SHADE.moss, 0.1);
    for (let i = 0; i < u.pillars; i++) {
      const a = (i / u.pillars) * TAU + 0.3, x = Math.cos(a) * u.pillarRadius, z = Math.sin(a) * u.pillarRadius, g = pitHeight(x, z);
      const hgt = 9 + rand() * 7;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, hgt, 7, 4), pillarMat);
      p.position.set(x, g + hgt / 2 - 0.3, z);
      p.rotation.set((rand() - 0.5) * 0.15, rand() * 3, (rand() - 0.5) * 0.15);
      k.group.add(p);
      k.solids.add({ cx: x, cz: z, hx: 1.3, hz: 1.3, yaw: 0, y0: g - 1, y1: g + hgt, tag: 'undermouth-pillar' });
    }
    // Heaps of the hosts who came down before: bone mounds out by the walls.
    const heaps = new THREE.InstancedMesh(lumpGeometry(13, 0), oldBone(ZONE7.lime, 0.05), 90);
    for (let i = 0; i < 90; i++) {
      const a = rand() * TAU, r = 40 + rand() * 25, x = Math.cos(a) * r, z = Math.sin(a) * r, sc = 0.3 + rand() * 0.8;
      heaps.setMatrixAt(i, mtx.compose(v.set(x, pitHeight(x, z), z), q.setFromEuler(e.set(rand() * 3, rand() * 6, rand() * 3)), s.set(sc * 2, sc * 0.6, sc)));
    }
    k.group.add(heaps);
    const topA = top.bearing * D2R;
    const [tlx, tlz] = polar(top.bearing, top.radius);
    const wr = PIT.ramps[PIT.ramps.length - 1];
    arena = {
      id: 'undermouth', x: 0, z: 0, radius: u.arenaRadius, floorY: pitHeight(0, 0),
      entrances: [{ x: polar(wr.end, u.arenaRadius)[0], z: polar(wr.end, u.arenaRadius)[1] }],
      pillars,
      pool: { x: 0, z: 0, radius: u.mawRadius },
      bossSpawn: { x: 0, z: 0 },
      ledge: { y: pitHeight(tlx, tlz) + top.height, innerR: top.radius - 3, outerR: top.radius + 3, halfArc: 5 / top.radius, yaw: topA },
      onLedge(x, z) {
        return u.ledges.some((ld) => {
          const [lx, lz] = polar(ld.bearing, ld.radius), a = ld.bearing * D2R;
          const dx = x - lx, dz = z - lz, along = dx * Math.cos(a) + dz * Math.sin(a), across = -dx * Math.sin(a) + dz * Math.cos(a);
          return Math.abs(along) <= 3 && Math.abs(across) <= 5;
        });
      },
    };
  }

  // ---- Ground caches from data.
  for (const l of PIT.loot) {
    const [x, z] = polar(l.bearing, l.radius);
    loot.push({ id: l.id, container: l.container, x, y: pitHeight(x, z), z });
  }

  // ---- Air: moonlight falling into the shaft, haze banks per layer, motes drifting everywhere.
  k.group.add(lightShaft({ from: new THREE.Vector3(-30, top + 20, 40), to: new THREE.Vector3(-10, L[2].y, 10), width: 18, spread: 1.4, colour: ORGANIC.mist, strength: 0.035 }));
  k.group.add(lightShaft({ from: new THREE.Vector3(55, top + 20, -30), to: new THREE.Vector3(25, L[1].y - 20, -15), width: 10, spread: 1.3, colour: ORGANIC.mist, strength: 0.03 }));
  for (let i = 1; i < L.length; i++) {
    const r = (L[i - 1].edge ?? 60) - 6, h = (L[i - 1].y - L[i].y) * 0.7;
    k.group.add(hazeVolume({ centre: new THREE.Vector3(0, L[i].y + h / 2, 0), size: new THREE.Vector3(r * 2, h, r * 2), colour: i === L.length - 1 ? ZONE7_SHADE.moss : ZONE7_SHADE.skyHorizon, density: 0.005 + i * 0.002 }));
  }
  const motes = sporeField(rand, 700, 50, 60, [ORGANIC.mist, ORGANIC.amber, HIVE.bone]);
  k.group.add(motes);
  scene.add(k.group);

  // ---- Extract markers: a ring on the ground at each extract (Gameplay's Seed Spire prop stands on it).
  const group = new THREE.Group();
  group.name = 'pit-sites';
  const rings = new Map<string, THREE.Mesh>();
  for (const ex of layout.extracts) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.08, 6, 48).rotateX(-Math.PI / 2), bioNode(ex.opensAt > 0 ? ZONE7.violet : ZONE7.lime, 3));
    ring.position.set(ex.x, pitHeight(ex.x, ex.z) + 0.08, ex.z);
    ring.visible = ex.opensAt <= 0;
    rings.set(ex.id, ring);
    group.add(ring);
  }
  scene.add(group);

  return {
    layout,
    sites: { group, setExtractOpen(id, open) { const r = rings.get(id); if (r) r.visible = open; }, setNodeHarvested() { /* no harvest nodes in the pit */ } },
    structures: { group: k.group, loot, arena, walkways, breakPillar(id) { arena.pillars.find((p) => p.id === id)?.destroy(); } },
    landmarkAt: pitLandmarkAt,
  };
}
