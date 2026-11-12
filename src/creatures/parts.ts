import * as THREE from 'three';
import { meshSdf, vnoise, type SdfPrim } from './sdf';

/**
 * Part library. Every function returns geometry in a part-local frame: origin at the attachment point,
 * +Y pointing out of the body (along the limb for segments). The rig places, skins and merges them.
 * Deterministic: same arguments and random source, same mesh.
 */

export type Rand = () => number;

export function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tube that follows `pts` with radius tapering through `radii` (one per point). Closed tip. */
export function taperTube(pts: THREE.Vector3[], radii: number[], radial = 7, perSeg = 3): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const n = Math.max(2, (pts.length - 1) * perSeg);
  const frames = curve.computeFrenetFrames(n, false);
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const radiusAt = (t: number) => {
    const f = t * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f));
    return radii[i] + (radii[i + 1] - radii[i]) * (f - i);
  };
  for (let s = 0; s <= n; s++) {
    const t = s / n, p = curve.getPointAt(t), r = radiusAt(t);
    const N = frames.normals[s], B = frames.binormals[s];
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2, cx = Math.cos(a), sx = Math.sin(a);
      const nx = N.x * cx + B.x * sx, ny = N.y * cx + B.y * sx, nz = N.z * cx + B.z * sx;
      pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      nor.push(nx, ny, nz);
    }
  }
  for (let s = 0; s < n; s++) for (let k = 0; k < radial; k++) {
    const a = s * (radial + 1) + k, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  // Tip cap.
  const tip = curve.getPointAt(1), tan = curve.getTangentAt(1);
  const ti = pos.length / 3;
  pos.push(tip.x + tan.x * radii[radii.length - 1], tip.y + tan.y * radii[radii.length - 1], tip.z + tan.z * radii[radii.length - 1]);
  nor.push(tan.x, tan.y, tan.z);
  const last = n * (radial + 1);
  for (let k = 0; k < radial; k++) idx.push(last + k, ti, last + k + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Curved spike or horn along +Y bending toward +Z. */
export function spike(len: number, r: number, bend = 0.25, radial = 6): THREE.BufferGeometry {
  const pts = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(0, t * len, bend * len * t * t));
  return taperTube(pts, [r, r * 0.62, r * 0.3, r * 0.04], radial, 2);
}

/** Ram or bison horn: thick root, sweeping out (+X) then forward and up, ridged. */
export function horn(len: number, r: number, curl = 1, rand: Rand = Math.random): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push(new THREE.Vector3(Math.sin(t * 1.6) * len * 0.55, t * len * 0.55 + Math.sin(t * Math.PI) * 0.1 * len, Math.sin(t * curl * 1.9) * len * 0.45));
  }
  const g = taperTube(pts, [r, r * 0.9, r * 0.75, r * 0.55, r * 0.3, r * 0.05], 9, 4);
  return roughen(g, r * 0.12, 9 / r, rand() * 10);
}

/** Sickle blade (mantis forelimb, Wraith forearm): flat crescent with a sharp inner edge, in the YZ plane. */
export function blade(len: number, width: number, thick = 0.02): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(width * 1.2, len * 0.3, width * 1.1, len * 0.75, width * 0.15, len);
  shape.bezierCurveTo(width * 0.45, len * 0.7, width * 0.3, len * 0.35, -width * 0.2, len * 0.05);
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.5, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -thick / 2);
  g.rotateY(-Math.PI / 2); // shape X becomes +Z
  return g;
}

/** Armour plate: a curved shell cap (part of a squashed sphere), convex side up. */
export function plate(w: number, l: number, h: number, rand: Rand, ridge = 0.3): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 20, 9, 0, Math.PI * 2, 0, Math.PI * 0.42);
  g.scale(w, h, l);
  const pos = g.attributes.position;
  const s = rand() * 50, tilt = (rand() - 0.5) * 0.5;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const y = pos.getY(i);
    // A ragged, grown outline instead of a clean ellipse: the rim pushes in and out with the angle.
    const rim = Math.hypot(x / w, z / l), ang = Math.atan2(z, x);
    const rag = 1 + (vnoise(Math.cos(ang) * 2.2 + s, Math.sin(ang) * 2.2, s) - 0.5) * 0.45 * rim;
    x *= rag; z *= rag;
    // Central keel ridge, growth-line ripples, and a lopsided lean so no two plates match.
    const keel = Math.exp(-Math.pow(x / (w * 0.18), 2)) * h * ridge;
    const lines = Math.sin(Math.hypot(x / w, z / l) * 18 + s + ang * 0.5) * h * 0.04;
    pos.setXYZ(i, x, y + keel * (y / h) + lines - h * 0.4 + x * tilt * (h / w), z);
  }
  g.computeVertexNormals();
  return roughen(g, h * 0.05, 4 / Math.max(h, 0.02), s);
}

/** Pustule / bio-node: a swollen lumpy sac. */
export function pustule(r: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 14, 10);
  g.translate(0, r * 0.55, 0);
  return roughen(g, r * 0.12, 4 / r, seed);
}

/** Ring of radial needle teeth around +Y (lamprey mouth, vents). */
export function needleRing(radius: number, n: number, len: number, rand: Rand, inward = 0.5): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const g = spike(len * (0.7 + rand() * 0.5), len * 0.08, -0.15, 5);
    // Point the tooth inward toward the axis and up.
    const dir = new THREE.Vector3(-Math.cos(a) * inward, 1, -Math.sin(a) * inward).normalize();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.compose(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    parts.push(g);
  }
  return merge(parts);
}

/** Crystal shards erupting from a point (mutation growth stage). */
export function crystals(size: number, rand: Rand, shards = 5): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < shards; i++) {
    const h = size * (0.5 + rand() * 0.7);
    const g = new THREE.CylinderGeometry(0, size * (0.12 + rand() * 0.08), h, 5, 1);
    g.translate(0, h / 2, 0);
    g.rotateZ((rand() - 0.5) * 1.0);
    g.rotateX((rand() - 0.5) * 1.0);
    g.translate((rand() - 0.5) * size * 0.3, 0, (rand() - 0.5) * size * 0.3);
    parts.push(g);
  }
  return merge(parts);
}

/** Fungal growth: a cluster of small glowing caps on bent stalks (mutation growth stage). */
export function fungus(size: number, rand: Rand, caps = 4): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < caps; i++) {
    const h = size * (0.4 + rand() * 0.8), r = size * (0.18 + rand() * 0.2);
    const lean = new THREE.Vector3((rand() - 0.5) * 0.8, 1, (rand() - 0.5) * 0.8).normalize();
    const top = lean.clone().multiplyScalar(h);
    parts.push(taperTube([new THREE.Vector3(), lean.clone().multiplyScalar(h * 0.5).add(new THREE.Vector3(0.02, 0, 0)), top], [r * 0.25, r * 0.18, r * 0.15], 5, 2));
    const cap = new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    cap.scale(1, 0.55, 1);
    cap.translate(top.x, top.y, top.z);
    parts.push(cap);
  }
  return merge(parts);
}

/** Vent chimney: an open, ridged tube flaring at the mouth (Mournback dorsal vents). */
export function vent(r: number, h: number): THREE.BufferGeometry {
  const pts = [[r * 1.3, 0], [r, h * 0.3], [r * 0.85, h * 0.7], [r * 1.15, h], [r * 0.75, h * 0.97], [r * 0.6, h * 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 12);
}

/** Eye lid ring (flesh torus around an eye socket). */
/**
 * Upper and lower eyelids around an eye of radius r: front-hemisphere shells whose edges curve into an almond
 * opening across local X, with a rolled lip along each edge. Local +Y is the gaze, local +Z is "up" (pass
 * fwd = up when placing the part). `open` is the half-height of the opening at its centre, as a fraction of r.
 */
export function eyelids(r: number, open = 0.32): THREE.BufferGeometry {
  const R = r * 1.07, parts: THREE.BufferGeometry[] = [];
  const NU = 24, NV = 8;
  for (const side of [1, -1]) {
    const o = side > 0 ? open : open * 1.2;
    const edge = (u: number) => side * o * (1 - u * u) * Math.sqrt(Math.max(0, 1 - u * u));
    const pos: number[] = [], idx: number[] = [], lip: THREE.Vector3[] = [];
    for (let i = 0; i <= NU; i++) {
      const u = (i / NU) * 1.9 - 0.95;
      const zMax = Math.sqrt(Math.max(0, 1 - u * u));
      for (let j = 0; j <= NV; j++) {
        const z = THREE.MathUtils.lerp(edge(u), side * zMax, j / NV);
        const y = Math.sqrt(Math.max(0, 1 - u * u - z * z));
        // Swell slightly toward the lip so the lid reads as a fold of skin.
        const k = R * (1 + 0.05 * (1 - j / NV));
        pos.push(u * k, y * k, z * k);
        if (j === 0) lip.push(new THREE.Vector3(u * k, y * k + r * 0.02, z * k));
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a0 = i * (NV + 1) + j, a1 = a0 + NV + 1;
      if (side > 0) idx.push(a0, a0 + 1, a1, a0 + 1, a1 + 1, a1); else idx.push(a0, a1, a0 + 1, a0 + 1, a1, a1 + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g, taperTube(lip, lip.map((_, i) => r * (0.05 + 0.06 * Math.sin((i / (lip.length - 1)) * Math.PI))), 6, 1));
  }
  return roughen(merge(parts), r * 0.025, 9 / r, 7);
}

export function lid(r: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r * 1.02, r * 0.28, 6, 16);
  g.rotateX(Math.PI / 2);
  g.translate(0, r * 0.35, 0);
  return g;
}

/** A small trophy skull (fused into the Mournback hump): cranium, carved sockets and a jaw. Meshed via SDF. */
const skullCache = new Map<number, THREE.BufferGeometry>();
export function skull(size: number, variant: number): THREE.BufferGeometry {
  const key = variant % 3;
  let g = skullCache.get(key);
  if (!g) {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const long = 1 + key * 0.25;
    const prims: SdfPrim[] = [
      { shape: 'ellipsoid', a: V(0, 0.55, 0), radii: V(0.42, 0.4, 0.5 * long), bone: 0 },
      { shape: 'cone', a: V(0, 0.4, 0.2), b: V(0, 0.3, 0.75 * long), ra: 0.28, rb: 0.16, blend: 0.18, bone: 0 },
      { shape: 'ellipsoid', a: V(0.19, 0.55, 0.42 * long), radii: V(0.13, 0.12, 0.16), subtract: true, blend: 0.05, bone: 0 },
      { shape: 'ellipsoid', a: V(-0.19, 0.55, 0.42 * long), radii: V(0.13, 0.12, 0.16), subtract: true, blend: 0.05, bone: 0 },
      { shape: 'cone', a: V(0, 0.12, 0.05), b: V(0, 0.1, 0.7 * long), ra: 0.2, rb: 0.1, blend: 0.08, bone: 0 },
      { shape: 'ellipsoid', a: V(0, 0.27, 0.78 * long), radii: V(0.2, 0.06, 0.3), subtract: true, blend: 0.03, bone: 0 },
    ];
    g = meshSdf(prims, 1, { resolution: 22 }).geometry;
    g.deleteAttribute('color');
    skullCache.set(key, g);
  }
  return g.clone().scale(size, size, size);
}

/** Moth-like wing membrane spanning +Y (out from the root) with its chord along Z, slightly cambered along X. */
export function wing(span: number, chord: number, rand: Rand, lobes = 1): THREE.BufferGeometry {
  // A gridded membrane (not a flat outline) so it can carry camber, vein corrugation that catches the light,
  // and a scalloped trailing edge. Span runs along +Y, chord along Z, out-of-plane along X.
  const NU = 22, NV = 12, seed = rand() * 10;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    const base = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.04)), 0.6);
    const lead = chord * (0.12 + 0.38 * base);
    // Trailing edge: broader, scalloped between the vein tips; a second lobe swells it near the tip.
    let trail = chord * (0.1 + 0.62 * base * (1 - 0.35 * u));
    if (lobes > 1) trail += chord * 0.35 * Math.exp(-Math.pow((u - 0.72) / 0.12, 2));
    trail *= 1 - 0.07 * Math.abs(Math.sin(u * Math.PI * 5 + seed));
    const sweep = -chord * 0.18 * u * u;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV; // 0 leading edge .. 1 trailing edge
      const z = sweep + THREE.MathUtils.lerp(-lead, trail, v);
      const camber = Math.sin(Math.PI * v) * chord * 0.07 * (1 - u * 0.5);
      const veins = Math.sin(v * Math.PI * 6 + u * 2.5 + seed) * chord * 0.012 * Math.sin(Math.PI * Math.min(1, u * 1.2));
      pos.push(camber + veins + Math.sin(u * Math.PI) * chord * 0.05, u * span, z);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a0 = i * (NV + 1) + j, a1 = a0 + NV + 1;
    idx.push(a0, a1, a0 + 1, a0 + 1, a1, a1 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Limb segment along +Y: bulging joint at the root, tapered shaft, optional ridges and barbs. */
export function limbSegment(len: number, r0: number, r1: number, style: 'needle' | 'mantis' | 'pillar' | 'tendril' | 'bone', rand: Rand, tip = false): THREE.BufferGeometry {
  const prof: [number, number][] = [];
  const steps = style === 'pillar' ? 12 : 9;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let r = r0 + (r1 - r0) * t;
    if (style !== 'tendril') r *= 1 + 0.35 * Math.exp(-Math.pow(t / 0.08, 2)); // joint knob
    if (style === 'pillar') r *= 1 + 0.12 * Math.sin(t * Math.PI * 5) ** 2;   // tardigrade folds
    if (style === 'mantis') r *= 1 + 0.18 * Math.sin(t * Math.PI);             // swollen raptorial femur
    if (tip && t > 0.75) r *= 1 - (t - 0.75) * 3.6;                             // pointed foot
    prof.push([Math.max(r, 0.002), t * len]);
  }
  prof.unshift([0.0001, -r0 * 0.4]);
  if (!tip) prof.push([0.0001, len + r1 * 0.3]);
  const pts = prof.map(([x, y]) => new THREE.Vector2(x, y));
  const radial = style === 'tendril' ? 5 : style === 'needle' ? 6 : 9;
  let g: THREE.BufferGeometry = new THREE.LatheGeometry(pts, radial);
  g.deleteAttribute('uv');
  const parts = [g];
  if (style === 'needle' || style === 'mantis') {
    // Sparse barbs along the back of the shaft.
    const n = style === 'mantis' ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const t = 0.25 + (i / n) * 0.6;
      const sp = spike(r0 * (style === 'mantis' ? 3.2 : 2.2), r0 * 0.35, 0.3, 4);
      sp.rotateX(-1.1);
      sp.translate(0, t * len, -(r0 + (r1 - r0) * t) * 0.8);
      sp.rotateY(rand() * 0.6 - 0.3);
      parts.push(sp);
    }
  }
  if (style === 'pillar' && tip) {
    // Tardigrade-style claw fan at the foot.
    for (let i = 0; i < 4; i++) {
      const c = spike(r0 * 1.2, r1 * 0.35, 0.6, 5);
      c.rotateX(Math.PI * 0.62);
      c.rotateY(((i - 1.5) / 1.5) * 0.7);
      c.translate(0, len * 0.88, r1 * 0.5);
      parts.push(c);
    }
  }
  g = parts.length > 1 ? merge(parts) : g;
  // Brandon (2026-11-12): less geometric. No limb is a straight turned rod: bow the shaft backward a little, make
  // its thickness uneven along its length and around it, and lump the surface. Root and tip stay put (sin(0) =
  // sin(pi) = 0) so joints and IK targets are unchanged.
  const bow = (0.04 + rand() * 0.04) * len, side = (rand() - 0.5) * 0.04 * len, ph = rand() * 6.28;
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), t = Math.min(1, Math.max(0, y / len));
    const s = 1 + 0.1 * Math.sin(t * Math.PI * 2.3 + ph) * Math.sin(t * Math.PI) + 0.06 * Math.sin(Math.atan2(z, x) * 2 + ph);
    const arc = Math.sin(t * Math.PI);
    pos.setXYZ(i, x * s + side * arc, y, z * s - bow * arc);
  }
  g.computeVertexNormals();
  return style === 'tendril' ? g : roughen(g, r0 * 0.07, 3 / Math.max(r0, 0.01), ph);
}

/** Displace along normals with value noise, so primitives stop looking like primitives. */
export function roughen(g: THREE.BufferGeometry, amp: number, freq: number, seed: number): THREE.BufferGeometry {
  const pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = (vnoise(x * freq + seed, y * freq, z * freq) - 0.5) * 2 * amp;
    pos.setXYZ(i, x + nor.getX(i) * n, y + nor.getY(i) * n, z + nor.getZ(i) * n);
  }
  g.computeVertexNormals();
  return g;
}

/** Merge position+normal geometries (indexed or not) into one indexed geometry. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
