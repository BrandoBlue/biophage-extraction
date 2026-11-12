import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';

/**
 * Organic shapes from primitive ones: a box, cylinder or extruded wall comes back grown rather than built.
 * Seams are welded, faces tessellated, hard edges rounded (Taubin smoothing, which does not shrink the shape),
 * then the surface swells and sags with low-frequency noise and is shaded smooth. Run it once at build time.
 *
 *   const wall = new THREE.Mesh(organicGeometry(new THREE.BoxGeometry(8, 4, 1)), zoneRock());
 *   organicize(group);                    // every eligible mesh under a group, geometry shared per source
 *
 * Collision is untouched: the shape moves by at most `amp` (plus the rounding of corners), so keep colliders as boxes.
 */
export interface OrganicOptions {
  /** Noise displacement along the normal, metres. Default 3% of the shape's size, at most 0.35 m. */
  amp?: number;
  /** Noise feature size, metres. Default a third of the shape's size. */
  scale?: number;
  /** Rounding passes: 0 keeps corners, 2 to 6 reads as grown. */
  soften?: number;
  seed?: number;
  /** Longest edge after tessellation, metres. Default an eighth of the shape's size. */
  edge?: number;
  /** Vertex budget per geometry; tessellation stops before it. */
  maxVerts?: number;
}

/** Primitive shapes that read as built or machined; organicize() grows these and leaves sculpted geometry alone. */
export const PRIMITIVE_TYPES = ['BoxGeometry', 'CylinderGeometry', 'ConeGeometry', 'DodecahedronGeometry', 'IcosahedronGeometry', 'OctahedronGeometry', 'TetrahedronGeometry', 'ExtrudeGeometry'];

export const ORGANIC_SHAPE = { ampFrac: 0.03, ampMax: 0.35, scaleFrac: 0.33, soften: 4, edgeFrac: 0.125, maxVerts: 2500 } as const;

const h3 = (x: number, y: number, z: number, s: number) => {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
/** Smooth value noise in 0..1. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => h3(ix + dx, iy + dy, iz + dz, seed);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

function neighbours(index: ArrayLike<number>, count: number): number[][] {
  const sets = Array.from({ length: count }, () => new Set<number>());
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b);
  }
  return sets.map((s) => [...s]);
}

function smoothPass(pos: THREE.BufferAttribute, adj: number[][], k: number): void {
  const n = pos.count, next = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const nb = adj[i];
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (!nb.length) { next.set([x, y, z], i * 3); continue; }
    let ax = 0, ay = 0, az = 0;
    for (const j of nb) { ax += pos.getX(j); ay += pos.getY(j); az += pos.getZ(j); }
    ax /= nb.length; ay /= nb.length; az /= nb.length;
    next[i * 3] = x + (ax - x) * k; next[i * 3 + 1] = y + (ay - y) * k; next[i * 3 + 2] = z + (az - z) * k;
  }
  (pos.array as Float32Array).set(next);
}

export function organicGeometry(source: THREE.BufferGeometry, o: OrganicOptions = {}): THREE.BufferGeometry {
  let g = source.index ? source.toNonIndexed() : source.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g.computeBoundingBox();
  const size = g.boundingBox!.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1e-3);
  const maxVerts = o.maxVerts ?? ORGANIC_SHAPE.maxVerts;
  const edge = o.edge ?? span * ORGANIC_SHAPE.edgeFrac;
  // Tessellate in rounds, stopping before the vertex budget (triangle count roughly quadruples per round).
  for (let round = 0; round < 6; round++) {
    if (g.attributes.position.count * 4 > maxVerts * 6) break;
    const before = g.attributes.position.count;
    g = new TessellateModifier(edge, 1).modify(g);
    if (g.attributes.position.count === before) break;
  }
  g = mergeVertices(g, span * 1e-4);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const adj = neighbours(g.index!.array, pos.count);
  // Taubin: shrink then inflate, which rounds corners and edges without collapsing the volume.
  for (let i = 0; i < (o.soften ?? ORGANIC_SHAPE.soften); i++) { smoothPass(pos, adj, 0.5); smoothPass(pos, adj, -0.53); }
  g.computeVertexNormals();
  const amp = o.amp ?? Math.min(ORGANIC_SHAPE.ampMax, span * ORGANIC_SHAPE.ampFrac);
  const f = 1 / (o.scale ?? span * ORGANIC_SHAPE.scaleFrac);
  const seed = o.seed ?? 7;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = noise3(x * f, y * f, z * f, seed) * 0.65 + noise3(x * f * 2.7, y * f * 2.7, z * f * 2.7, seed + 1) * 0.35;
    const d = (n - 0.5) * 2 * amp;
    pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d);
  }
  g.computeVertexNormals();
  fixZeroNormals(g);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Degenerate triangles (collapsed by welding or smoothing) can leave a vertex with a zero normal, which shades as NaN
 * on some GPUs and, through the bloom, blacks out part of the screen. Point those along the shape's outward direction.
 */
export function fixZeroNormals(g: THREE.BufferGeometry): number {
  const nrm = g.attributes.normal as THREE.BufferAttribute, pos = g.attributes.position as THREE.BufferAttribute;
  if (!nrm) return 0;
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3()), v = new THREE.Vector3();
  let fixed = 0;
  for (let i = 0; i < nrm.count; i++) {
    const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i);
    if (x * x + y * y + z * z > 1e-12 && Number.isFinite(x + y + z)) continue;
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(c);
    if (v.lengthSq() < 1e-12) v.set(0, 1, 0);
    v.normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
    fixed++;
  }
  if (fixed) nrm.needsUpdate = true;
  return fixed;
}

/** True for meshes worth growing: static, opaque, not skinned, not already organic, and opted in or not opted out. */
export function organicEligible(o: THREE.Object3D): boolean {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || o.userData.noOrganic) return false;
  // Big instanced fields (particles, cover) multiply every added vertex by their count: leave them as they are.
  if ((m as THREE.InstancedMesh).isInstancedMesh && (m as THREE.InstancedMesh).count > 64) return false;
  const g = m.geometry;
  if (!g?.attributes.position || g.userData.organic || !PRIMITIVE_TYPES.includes(g.type)) return false;
  // Texture-mapped and custom-shader materials read uv, which welding drops; procedural bio materials do not need it.
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  if (mats.some((mat) => !mat || (mat as THREE.ShaderMaterial).isShaderMaterial || (mat as THREE.MeshStandardMaterial).map || (mat as THREE.MeshStandardMaterial).normalMap)) return false;
  return g.attributes.position.count < 6000; // dense meshes are already sculpted
}

/** Grow every eligible mesh under root. Geometry shared between meshes is converted once. Returns meshes changed. */
export function organicize(root: THREE.Object3D, o: OrganicOptions = {}): number {
  const done = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  let n = 0;
  root.traverse((obj) => {
    if (!organicEligible(obj)) return;
    const mesh = obj as THREE.Mesh;
    let g = done.get(mesh.geometry);
    if (!g) { g = organicGeometry(mesh.geometry, o); g.userData.organic = true; done.set(mesh.geometry, g); }
    mesh.geometry = g;
    n++;
  });
  return n;
}
