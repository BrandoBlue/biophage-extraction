import * as THREE from 'three';
import { noise3 } from '../render/geometry';

/**
 * Organic shaping for built forms (Brandon, 2026-11-12: "less geometric, more organic feeling").
 *
 * Every displacement here is a pure function of a vertex's position, so the duplicated vertices along the seams of
 * a BoxGeometry move together and the mesh never cracks. Colliders are not touched: the shapes stay within a few
 * tens of centimetres of the box they were built from, so movement and cover read the same as before.
 */

export interface OrganicOptions {
  /** 0 keeps the clean primitive; 1 is the standard grown look. */
  amount?: number;
  seed?: number;
  /**
   * Top face: true keeps it flat (walkable decks, floors, steps); false breaks it (a torn, sagging edge that dips
   * below the collider). Left unset, tall thin walls (2.4 m and up, at most 1.5 m thick: nobody stands on them) grow a wavy
   * crest; everything else stays flat.
   */
  flatTop?: boolean;
}

/** Push grid lines toward the edges so the rounding has vertices to bend (more rows where the bevel is). */
function edgeBias(t: number): number {
  return Math.sign(t) * Math.pow(Math.abs(t), 0.72);
}

function bias(c: number, half: number): number {
  return half > 1e-6 ? edgeBias(c / half) * half : c;
}

function segmentsFor(half: number): number {
  return Math.max(2, Math.min(24, Math.ceil((half * 2) / 0.7)));
}

/**
 * A box (centred like THREE.BoxGeometry) with rounded, weathered edges, gently bulging sides, a root-like flare at
 * the foot and a flat top. `amount` 0 returns a plain box.
 */
export function organicBox(hu: number, hy: number, hv: number, o: OrganicOptions = {}): THREE.BufferGeometry {
  const A = o.amount ?? 1;
  if (A <= 0) return new THREE.BoxGeometry(hu * 2, hy * 2, hv * 2, Math.max(1, Math.round(hu)), 1, Math.max(1, Math.round(hv)));
  const geo = new THREE.BoxGeometry(hu * 2, hy * 2, hv * 2, segmentsFor(hu), segmentsFor(hy), segmentsFor(hv));
  const pos = geo.attributes.position;
  const seed = o.seed ?? 0;
  const top: 'flat' | 'broken' | 'crest' = o.flatTop === true ? 'flat' : o.flatTop === false ? 'broken' : hy * 2 >= 2.4 && Math.min(hu, hv) <= 0.75 ? 'crest' : 'flat';
  const flatTop = top === 'flat';
  const minH = Math.min(hu, hv), maxH = Math.max(hu, hv);
  const r = Math.min(0.42, 0.32 * Math.min(minH, hy)) * A; // edge radius
  const bulge = Math.min(0.42, 0.05 * maxH + 0.1) * A; // side lumps (m), scaled by the face's span
  const flare = Math.min(0.35, 0.08 * minH + 0.06) * A * (hy > 0.6 ? 1 : 0); // root flare at the foot
  const iu = Math.max(0, hu - r), iy = Math.max(0, hy - r), iv = Math.max(0, hv - r);
  const p = new THREE.Vector3(), inner = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.set(bias(pos.getX(i), hu), bias(pos.getY(i), hy), bias(pos.getZ(i), hv));
    // Rounded box: project onto the inner box, then out by r.
    inner.set(THREE.MathUtils.clamp(p.x, -iu, iu), THREE.MathUtils.clamp(p.y, -iy, iy), THREE.MathUtils.clamp(p.z, -iv, iv));
    dir.subVectors(p, inner);
    const len = dir.length();
    if (len > 1e-6 && r > 0) p.copy(inner).addScaledVector(dir, r / len);
    // Outward horizontal direction for lumps and flare (zero on the flat faces of the top and bottom).
    const hx = len > 1e-6 ? dir.x / len : 0, hz = len > 1e-6 ? dir.z / len : 0;
    const side = Math.hypot(hx, hz);
    if (side > 1e-3) {
      const t = hy > 1e-6 ? (p.y + hy) / (2 * hy) : 1; // 0 at the foot, 1 at the top
      // Lazy bellies along the span, softer lumps, then fine weathering.
      const n = noise3(p.x * 0.15 + seed, p.y * 0.2, p.z * 0.15 - seed) * 0.55
        + noise3(p.x * 0.45 - seed, p.y * 0.6, p.z * 0.45 + seed) * 0.3
        + noise3(p.x * 1.7 + seed, p.y * 1.9, p.z * 1.7) * 0.15;
      let out = bulge * (n * 1.25 - 0.6); // as much in as out, so a body against the wall never sits inside it
      if (t < 0.28) out += flare * Math.pow(1 - t / 0.28, 2);
      if (flatTop && t > 0.97) out *= 0.3; // keep the lip close to the collider
      p.x += hx * out;
      p.z += hz * out;
    }
    if (!flatTop && p.y > hy - r * 1.01) {
      const n = noise3(p.x * 0.35 + seed, 0, p.z * 0.35 - seed) * 0.7 + noise3(p.x * 1.3, 1, p.z * 1.3) * 0.3;
      if (top === 'broken') {
        // Weathered, broken crown: the top edge wanders and sags instead of running dead straight.
        p.y -= Math.min(1.4, 0.18 * hy + 0.1) * A * n;
      } else {
        // Grown crest: the out-of-reach top swells upward in soft waves (never below the collider).
        p.y += Math.min(0.5, 0.06 * hy + 0.15) * A * n;
      }
    }
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Roughen any primitive (cylinder, sphere, lathe, capsule) in place: lumps along the direction from its vertical
 * axis, plus a slight lean and a flared foot. Pure function of position, so seams stay closed.
 */
export function organicGeometry<T extends THREE.BufferGeometry>(geo: T, amount = 1, seed = 0): T {
  if (amount <= 0) return geo;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  const h = Math.max(1e-3, bb.max.y - bb.min.y);
  const size = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  const amp = Math.min(0.3, 0.07 * size + 0.02) * amount;
  const lean = 0.035 * amount;
  const la = seed * 2.399; // lean direction
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const y = pos.getY(i);
    const dx = x - cx, dz = z - cz;
    const d = Math.hypot(dx, dz);
    const t = (y - bb.min.y) / h;
    if (d > 1e-4) {
      const n = noise3(x * 0.8 + seed, y * 0.9, z * 0.8 - seed) * 0.7 + noise3(x * 2.6 - seed, y * 2.4, z * 2.6) * 0.3;
      let out = amp * (n * 1.4 - 0.4);
      if (t < 0.2) out += amp * 0.9 * Math.pow(1 - t / 0.2, 2);
      x += (dx / d) * out;
      z += (dz / d) * out;
    }
    x += Math.cos(la) * lean * t * t * h;
    z += Math.sin(la) * lean * t * t * h;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}
