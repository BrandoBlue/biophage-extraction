import * as THREE from 'three';

/**
 * Signed-distance skin. A creature's soft body is a set of blended primitives (ellipsoids and round cones,
 * some carved away) meshed with Surface Nets into one smooth, watertight surface. Each vertex records which
 * bone its nearest primitives belong to, so the body skins to the rig and bends like flesh, not like a robot.
 *
 * Pure CPU code with no WebGL, so it runs in Vitest and in a worker-free page load. Cost is roughly
 * cells³ × primitives; species meshes are generated once per variant and shared between instances.
 */

export interface SdfPrim {
  /** 'ellipsoid' uses a + radii; 'cone' is a round cone from a (radius ra) to b (radius rb). */
  shape: 'ellipsoid' | 'cone';
  a: THREE.Vector3;
  b?: THREE.Vector3;
  radii?: THREE.Vector3;
  ra?: number;
  rb?: number;
  /** Smooth-union radius with what came before (metres). Larger = fleshier joins. */
  blend?: number;
  /** Carve this primitive out of the body (mouths, sockets, gill slits). */
  subtract?: boolean;
  /** Index of the bone this primitive moves with. */
  bone: number;
  /** Surface tint multiplier written to vertex colours (1 = material colour). */
  tint?: THREE.Color;
  /** Annular ridges along the a→b axis (tardigrade and worm segments, ribs): count per metre and depth. */
  ribs?: { freq: number; depth: number };
}

export interface SdfOptions {
  /** Cells along the longest side of the bounds. 40 to 64 is the useful range. */
  resolution?: number;
  /** Lumpy organic displacement: amplitude (m) and frequency (per m). */
  noise?: { amp: number; freq: number; seed: number };
}

export interface SdfMesh {
  geometry: THREE.BufferGeometry;
  /** Per-vertex bone index and weight pairs (up to 4), ready for skinIndex/skinWeight. */
  skinIndex: Float32Array;
  skinWeight: Float32Array;
}

const tmp = new THREE.Vector3();

function sdEllipsoid(px: number, py: number, pz: number, c: THREE.Vector3, r: THREE.Vector3): number {
  const x = (px - c.x), y = (py - c.y), z = (pz - c.z);
  const k0 = Math.hypot(x / r.x, y / r.y, z / r.z);
  const k1 = Math.hypot(x / (r.x * r.x), y / (r.y * r.y), z / (r.z * r.z));
  return k1 === 0 ? -Math.min(r.x, r.y, r.z) : (k0 * (k0 - 1)) / k1;
}

/** Round cone (capsule with different end radii), after Inigo Quilez. */
function sdRoundCone(px: number, py: number, pz: number, a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number): number {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a: number, b: number, k: number): number { return -smin(-a, -b, k); }

/** Small deterministic value noise for surface lumps (CPU twin of the GLSL bioNoise). */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy),
    fz,
  );
}

function primDistance(p: SdfPrim, x: number, y: number, z: number): number {
  let d = p.shape === 'ellipsoid'
    ? sdEllipsoid(x, y, z, p.a, p.radii!)
    : sdRoundCone(x, y, z, p.a, p.b!, p.ra!, p.rb!);
  if (p.ribs && p.b) {
    const ax = p.b.x - p.a.x, ay = p.b.y - p.a.y, az = p.b.z - p.a.z;
    const len = Math.hypot(ax, ay, az) || 1;
    const t = ((x - p.a.x) * ax + (y - p.a.y) * ay + (z - p.a.z) * az) / len;
    // Grown, not machined: each ring wanders along the axis and swells or fades around the body.
    const w = vnoise(x * 9 + 3, y * 9, z * 9);
    d += (0.5 - 0.5 * Math.cos((t * p.ribs.freq + (w - 0.5) * 0.7) * Math.PI * 2)) * p.ribs.depth * (0.45 + w * 1.1);
  } else if (p.ribs) {
    d += (0.5 - 0.5 * Math.cos((z - p.a.z) * p.ribs.freq * Math.PI * 2)) * p.ribs.depth;
  }
  return d;
}

function primBounds(p: SdfPrim, box: THREE.Box3): void {
  if (p.shape === 'ellipsoid') {
    const r = p.radii!;
    box.expandByPoint(tmp.copy(p.a).add(r));
    box.expandByPoint(tmp.copy(p.a).sub(r));
  } else {
    const r1 = p.ra!, r2 = p.rb!;
    box.expandByPoint(tmp.copy(p.a).addScalar(r1)); box.expandByPoint(tmp.copy(p.a).addScalar(-r1));
    box.expandByPoint(tmp.copy(p.b!).addScalar(r2)); box.expandByPoint(tmp.copy(p.b!).addScalar(-r2));
  }
}

/** Minimum smooth-union radius for a primitive: a third of its thinnest radius, so joins read as flesh, not seams. */
function softJoin(p: SdfPrim): number {
  const r = p.shape === 'ellipsoid' ? Math.min(p.radii!.x, p.radii!.y, p.radii!.z) : Math.min(p.ra!, p.rb!);
  return r * 0.33;
}

/** The whole field: smooth union of additive primitives, then carves, then surface noise. */
export function sdfField(prims: SdfPrim[], opts: SdfOptions = {}): (x: number, y: number, z: number) => number {
  const noise = opts.noise;
  return (x, y, z) => {
    let d = 1e9;
    for (const p of prims) {
      const di = primDistance(p, x, y, z);
      d = p.subtract ? smax(d, -di, p.blend ?? 0.02) : smin(d, di, Math.max(p.blend ?? 0.05, softJoin(p)));
    }
    if (noise) {
      const f = noise.freq, s = noise.seed;
      d += (vnoise(x * f + s, y * f, z * f) - 0.5) * noise.amp * 2 + (vnoise(x * f * 2.7, y * f * 2.7 + s, z * f * 2.7) - 0.5) * noise.amp;
      // Broad, lopsided swellings (Brandon 2026-11-12: "less geometric, more organic"): a slow octave so no two
      // sides of a body match and no primitive keeps its clean ellipse.
      const g = f * 0.3;
      d += (vnoise(x * g + 31 + s, y * g, z * g + 7) - 0.5) * noise.amp * 3.2;
    }
    return d;
  };
}

/**
 * Mesh the field with Surface Nets: one vertex per surface cell at the mean of its edge crossings, one quad
 * per crossing edge. Smooth and low in vertices compared with marching cubes; normals from the field gradient.
 */
export function meshSdf(prims: SdfPrim[], boneCount: number, opts: SdfOptions = {}): SdfMesh {
  const field = sdfField(prims, opts);
  const box = new THREE.Box3();
  for (const p of prims) if (!p.subtract) primBounds(p, box);
  const pad = 0.06 + (opts.noise?.amp ?? 0) * 5;
  box.min.addScalar(-pad); box.max.addScalar(pad);
  const size = box.getSize(new THREE.Vector3());
  const res = opts.resolution ?? 48;
  const h = Math.max(size.x, size.y, size.z) / res;
  const nx = Math.ceil(size.x / h) + 1, ny = Math.ceil(size.y / h) + 1, nz = Math.ceil(size.z / h) + 1;
  const o = box.min;

  // Field samples at grid corners.
  const vals = new Float32Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    vals[idx(i, j, k)] = field(o.x + i * h, o.y + j * h, o.z + k * h);
  }

  // One vertex per cell that straddles the surface.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const positions: number[] = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      cv[c] = vals[idx(i + corner[c][0], j + corner[c][1], k + corner[c][2])];
      if (cv[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      const da = cv[a], db = cv[b];
      if ((da < 0) === (db < 0)) continue;
      const t = da / (da - db);
      sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
      sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
      sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
      n++;
    }
    cellVert[cidx(i, j, k)] = positions.length / 3;
    positions.push(o.x + (i + sx / n) * h, o.y + (j + sy / n) * h, o.z + (k + sz / n) * h);
  }

  // Quads across every grid edge with a sign change, wound so normals point outward (toward positive field).
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c); else indices.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = vals[idx(i, j, k)] < 0, b = vals[idx(i + 1, j, k)] < 0;
    if (a === b) continue;
    quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], !a);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = vals[idx(i, j, k)] < 0, b = vals[idx(i, j + 1, k)] < 0;
    if (a === b) continue;
    quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], !a);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = vals[idx(i, j, k)] < 0, b = vals[idx(i, j, k + 1)] < 0;
    if (a === b) continue;
    quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], !a);
  }

  // Normals from the gradient, colours from the nearest primitive's tint, skin weights from soft nearest bones.
  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const skinIndex = new Float32Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const e = h * 0.5;
  const boneD = new Float32Array(boneCount);
  const white = new THREE.Color(1, 1, 1);
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const gx = field(x + e, y, z) - field(x - e, y, z);
    const gy = field(x, y + e, z) - field(x, y - e, z);
    const gz = field(x, y, z + e) - field(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    normals[v * 3] = gx / gl; normals[v * 3 + 1] = gy / gl; normals[v * 3 + 2] = gz / gl;

    boneD.fill(1e9);
    let best = 1e9, tint = white;
    let tr = 0, tg = 0, tb = 0, tw = 0;
    for (const p of prims) {
      if (p.subtract) continue;
      const d = primDistance(p, x, y, z);
      if (d < boneD[p.bone]) boneD[p.bone] = d;
      if (d < best) { best = d; tint = p.tint ?? white; }
      // Tints blend across joins so colour seams are soft.
      const w = Math.exp(-Math.max(0, d) / Math.max(0.02, (p.blend ?? 0.05)));
      const t = p.tint ?? white;
      tr += t.r * w; tg += t.g * w; tb += t.b * w; tw += w;
    }
    if (tw > 0) { colours[v * 3] = tr / tw; colours[v * 3 + 1] = tg / tw; colours[v * 3 + 2] = tb / tw; }
    else { colours[v * 3] = tint.r; colours[v * 3 + 1] = tint.g; colours[v * 3 + 2] = tint.b; }

    // Four nearest bones, weighted by closeness (soft falloff over ~15 cm).
    const order = Array.from(boneD.keys()).sort((p, q) => boneD[p] - boneD[q]).slice(0, 4);
    let sum = 0;
    const w4 = order.map((bi) => {
      const w = boneD[bi] > 1e8 ? 0 : Math.exp(-(boneD[bi] - boneD[order[0]]) / 0.06);
      sum += w;
      return w;
    });
    for (let s = 0; s < 4; s++) {
      skinIndex[v * 4 + s] = order[s] ?? 0;
      skinWeight[v * 4 + s] = sum > 0 ? (w4[s] ?? 0) / sum : s === 0 ? 1 : 0; // bodies with fewer than 4 bones pad with 0
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  return { geometry, skinIndex, skinWeight };
}

export interface SkinHit { at: THREE.Vector3; normal: THREE.Vector3; bone: number }

/**
 * Sphere-trace the skin from `origin` along `dir` (anchors for parts: spines on the back, eyes on the head).
 * Returns null when the ray misses within `maxDist`.
 */
export function traceSkin(prims: SdfPrim[], origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 6): SkinHit | null {
  const field = sdfField(prims);
  const d = dir.clone().normalize();
  const p = origin.clone();
  let t = 0;
  for (let i = 0; i < 160 && t < maxDist; i++) {
    const f = field(p.x, p.y, p.z);
    if (f < 0.0015) {
      const e = 0.004;
      const n = new THREE.Vector3(
        field(p.x + e, p.y, p.z) - field(p.x - e, p.y, p.z),
        field(p.x, p.y + e, p.z) - field(p.x, p.y - e, p.z),
        field(p.x, p.y, p.z + e) - field(p.x, p.y, p.z - e),
      ).normalize();
      let bone = 0, best = 1e9;
      for (const q of prims) {
        if (q.subtract) continue;
        const dq = primDistance(q, p.x, p.y, p.z);
        if (dq < best) { best = dq; bone = q.bone; }
      }
      return { at: p.clone(), normal: n, bone };
    }
    const step = Math.max(f * 0.7, 0.002);
    p.addScaledVector(d, step);
    t += step;
  }
  return null;
}
