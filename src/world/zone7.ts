import * as THREE from 'three';
import { ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, crystal, fungusCap, fungusStem, liquidLight, membrane, zoneRock, bioTime } from '../render/materials';
import { capGeometry, crystalClusterGeometry, floatingIslandGeometry, ISLAND_TOP, ribbonGeometry, stemGeometry } from '../render/geometry';
import { cloudSea, planet, sporeField, zone7Sky } from '../render/sky';

/** Deterministic RNG so every raid pocket (and every screenshot test) is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Main island radius. Walkable to about 0.84 of this (~150 m), matching data/raid.json playableRadius. */
export const ISLAND_RADIUS = 180;

/**
 * Spots that must be flat and walkable, matching the Spore layout in docs/gdd (layoutPosition in data/):
 * spawn on the south-west rim, the Seed Spire extract on the north-east rim, the Bio-Pod clearing near the centre.
 */
export const FLAT_SPOTS = [
  { name: 'spawn', x: -41, z: 113, radius: 9 },
  { name: 'extract', x: 44, z: -120, radius: 10 },
  { name: 'bio-pod', x: 22, z: 0, radius: 13 },
] as const;

/** Liquid-light pools: one mid-route landmark, one on the west rim spilling into the void as a fall. */
export const POOLS = [
  { x: -24, z: 42, radius: 11, fall: false },
  { x: -132, z: -58, radius: 13, fall: true },
] as const;

const POOL_DEPTH = 1.2;

/** World height of a pool's liquid surface. */
export function poolLevel(p: { x: number; z: number }): number {
  return rawHeight(p.x, p.z) - POOL_DEPTH + 0.6;
}

function rawHeight(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const r = d / ISLAND_RADIUS;
  const hills = Math.sin(x * 0.035) * Math.cos(z * 0.03) * 6 + Math.sin(x * 0.011 + z * 0.017 + 1.3) * 9;
  const detail = Math.sin(x * 0.11) * Math.cos(z * 0.09) * 1.2 + Math.sin(x * 0.31 + z * 0.27) * 0.35;
  // Gentle spawn basin at the centre, full relief further out, falling away past the rim.
  const relief = hills * (0.15 + 0.85 * Math.min(1, d / 45)) + detail;
  return relief * Math.max(0, 1 - r * r) - Math.max(0, r - 0.85) * 120;
}

const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/** Height of the island surface at (x, z). Shared by the mesh and the player controller. */
export function groundHeight(x: number, z: number): number {
  let h = rawHeight(x, z);
  for (const s of FLAT_SPOTS) {
    const w = 1 - smooth(s.radius, s.radius + 14, Math.hypot(x - s.x, z - s.z));
    if (w > 0) h += (rawHeight(s.x, s.z) - h) * w;
  }
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
  return FLAT_SPOTS.some((s) => Math.hypot(x - s.x, z - s.z) < s.radius + margin)
    || POOLS.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + 1 + margin);
}

const GLOWS = [ZONE7.cyan, ZONE7.magenta, ZONE7.lime, ZONE7.violet];

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

const FLOATING: IslandSpec[] = [
  { pos: new THREE.Vector3(-161, 35, -276), radius: 30, falls: true },
  { pos: new THREE.Vector3(126, 72, -345), radius: 40, falls: true },
  { pos: new THREE.Vector3(-345, 96, -138), radius: 44 },
  { pos: new THREE.Vector3(322, 16, -138), radius: 27, falls: true },
  { pos: new THREE.Vector3(-46, 136, -529), radius: 57, falls: true },
  { pos: new THREE.Vector3(390, 112, 206), radius: 37 },
  { pos: new THREE.Vector3(-322, 40, 276), radius: 34, falls: true },
  { pos: new THREE.Vector3(69, -40, 345), radius: 23 },
  { pos: new THREE.Vector3(-218, -24, -23), radius: 17 },
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

/** The Spore pocket of Zone 7: one floating island over the void, bioluminescent flora, cosmic sky. */
export function buildZone7(scene: THREE.Scene, seed = 7): void {
  const rand = mulberry32(seed);

  // Sky: baked to a cubemap (background + image-based lighting) by the render pipeline on first frame.
  const sky = zone7Sky();
  sky.userData.bake = true;
  scene.add(sky);
  scene.background = new THREE.Color(ZONE7.void);
  scene.fog = new THREE.FogExp2(ZONE7_SHADE.skyHorizon, 0.0016);

  scene.add(new THREE.HemisphereLight(ZONE7.cyan, ZONE7.violet, 0.35));
  const key = new THREE.DirectionalLight(ZONE7.cyan, 0.9);
  key.position.set(60, 80, -120);
  const rim = new THREE.DirectionalLight(ZONE7.magenta, 1.3);
  rim.position.set(-120, 40, 80);
  scene.add(key, rim);

  // Main island surface and the craggy spire hanging beneath it.
  const ringGeo = new THREE.PlaneGeometry(ISLAND_RADIUS * 2.2, ISLAND_RADIUS * 2.2, 220, 220);
  ringGeo.rotateX(-Math.PI / 2);
  const pos = ringGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  ringGeo.computeVertexNormals();
  const ground = new THREE.Mesh(ringGeo, zoneRock());
  ground.name = 'ground';
  scene.add(ground);
  const rockMat = zoneRock({ veinColour: ZONE7.magenta });
  const skirt = new THREE.Mesh(floatingIslandGeometry(seed, 2.2), rockMat);
  skirt.scale.set(ISLAND_RADIUS * 1.0, ISLAND_RADIUS * 0.7, ISLAND_RADIUS * 1.0);
  skirt.position.y = -14 - ISLAND_TOP * skirt.scale.y;
  scene.add(skirt);

  // Liquid-light pools; the rim pool spills into the void as a fall.
  for (const [k, pd] of POOLS.entries()) {
    const level = poolLevel(pd);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(pd.radius, 48).rotateX(-Math.PI / 2), liquidLight({ pool: true }));
    pool.position.set(pd.x, level, pd.z);
    pool.name = `liquid-light-pool-${k}`;
    scene.add(pool);
    const light = new THREE.PointLight(ZONE7.cyan, 80, 36, 2);
    light.position.set(pd.x, level + 2.5, pd.z);
    scene.add(light);
    if (pd.fall) {
      const out = new THREE.Vector3(pd.x, 0, pd.z).normalize();
      const lip = new THREE.Vector3(pd.x, level, pd.z).addScaledVector(out, pd.radius * 0.8);
      scene.add(fall(lip, out, 280, 8));
    }
  }

  // Flora on the main island.
  const fungi = [
    ...scatterFungi(rand, { count: 70, minR: 14, maxR: ISLAND_RADIUS * 0.82, height: [5, 13], cap: [2.5, 6] }, groundHeight),
    ...scatterFungi(rand, { count: 420, minR: 5, maxR: ISLAND_RADIUS * 0.84, height: [1.4, 4], cap: [0.7, 1.8] }, groundHeight),
    ...scatterFungi(rand, { count: 800, minR: 3, maxR: ISLAND_RADIUS * 0.86, height: [0.25, 0.9], cap: [0.18, 0.5] }, groundHeight),
  ];
  // Fringe the pools with clusters so they glow like reference 04.
  for (const pd of POOLS) for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2, d = pd.radius + 0.5 + rand() * 4;
    const x = pd.x + Math.cos(a) * d, z = pd.z + Math.sin(a) * d;
    fungi.push({ pos: new THREE.Vector3(x, groundHeight(x, z) - 0.1, z), height: 0.4 + rand() * 1.6, cap: 0.25 + rand() * 0.7, yaw: rand() * 6.28, tilt: (rand() - 0.5) * 0.4, colour: GLOWS[i % 2 === 0 ? 0 : 1] });
  }
  // Giant-fungus groves flanking the spawn-to-extract route: cover and route choices.
  for (const [gx, gz] of [[-30, 75], [10, 70], [-5, 25], [40, 35], [-10, -40], [30, -70], [60, -95]]) {
    fungi.push(...scatterFungi(rand, { count: 4, minR: 0, maxR: 9, height: [8, 16], cap: [3.5, 7] }, groundHeight, new THREE.Vector3(gx, 0, gz)));
  }

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

  // Crystal clusters and glowing pustules.
  const crystals = [];
  for (let i = 0; i < 160; i++) {
    const a = rand() * Math.PI * 2, d = 8 + Math.sqrt(rand()) * ISLAND_RADIUS * 0.8;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    crystals.push({ pos: new THREE.Vector3(x, groundHeight(x, z) - 0.2, z), scale: 0.8 + rand() * 3.2, yaw: rand() * 6.28, tilt: (rand() - 0.5) * 0.3, colour: rand() < 0.6 ? ZONE7.violet : ZONE7.cyan });
  }
  scene.add(instanced(crystalClusterGeometry(rand, 6), crystal(), crystals, 'crystals'));
  const pustules = [];
  for (let i = 0; i < 1400; i++) {
    const a = rand() * Math.PI * 2, d = 4 + Math.sqrt(rand()) * ISLAND_RADIUS * 0.84;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const s = 0.08 + rand() * 0.22;
    pustules.push({ pos: new THREE.Vector3(x, groundHeight(x, z) + s * 0.3, z), scale: s, yaw: 0, colour: rand() < 0.5 ? ZONE7.lime : ZONE7.magenta });
  }
  const pustuleMesh = instanced(new THREE.SphereGeometry(1, 8, 6), bioNode(ZONE7.lime), pustules, 'pustules');
  scene.add(pustuleMesh);

  // A handful of real lights where the glow is strongest; everything else is emissive + bloom.
  const big = fungi.filter((f) => f.height > 9).sort((a, b) => b.height - a.height).slice(0, 6);
  for (const f of big) {
    const l = new THREE.PointLight(f.colour, 40, 26, 2);
    l.position.copy(f.pos).add(new THREE.Vector3(0, f.height * 0.85, 0));
    scene.add(l);
  }

  // Floaters in the sky lanes.
  for (let i = 0; i < 14; i++) {
    const f = floater(rand, i % 2 ? ZONE7.magenta : ZONE7.cyan, 1.5 + rand() * 2.5);
    const a = -Math.PI / 2 + (rand() - 0.5) * 3.2, d = 30 + rand() * 220;
    f.position.set(Math.cos(a) * d, 16 + rand() * 45, Math.sin(a) * d);
    scene.add(f);
  }

  // Cosmos: ringed giant, a lit moon, a sea of luminous cloud far below, drifting spores.
  const lightDir = new THREE.Vector3(1, 0.4, 0.6);
  const giantAt = new THREE.Vector3(-480, 420, -980);
  // Tilt the ring nearly edge-on to the island so it reads as a ring, not a target.
  const toIsland = giantAt.clone().negate().normalize();
  const ringNormal = new THREE.Vector3().crossVectors(toIsland, new THREE.Vector3(1, 0, 0)).normalize().addScaledVector(toIsland, 0.35);
  const giant = planet({ radius: 170, band: ZONE7.violet, rim: ZONE7.cyan, ring: ZONE7.magenta, lightDir, seed: 3, ringNormal });
  giant.position.copy(giantAt);
  const moon = planet({ radius: 60, band: ZONE7.magenta, rim: ZONE7.magenta, lightDir, seed: 9 });
  moon.position.set(560, 300, -860);
  scene.add(giant, moon, cloudSea(-240));
  scene.add(sporeField(rand, 700, 60, 40, [ZONE7.cyan, ZONE7.lime, ZONE7.magenta]));

  // Extraction beacon: the goal the Gameplay department wires up in Spore.
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 80, 16, 1, true), new THREE.MeshBasicMaterial({ color: ZONE7.lime, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  const ex = FLAT_SPOTS[1];
  beacon.position.set(ex.x, 40 + groundHeight(ex.x, ex.z), ex.z);
  beacon.name = 'extraction-beacon';
  scene.add(beacon);
}
