import * as THREE from 'three';

/** Procedural geometry for Zone 7 flora and terrain. Pure functions of their inputs (deterministic). */

/** Mushroom cap, unit radius: domed top, flared lip, gilled underside. */
export function capGeometry(segments = 32): THREE.LatheGeometry {
  const pts = [
    [0.0, 0.62], [0.32, 0.58], [0.6, 0.46], [0.84, 0.28], [0.98, 0.1], [1.04, 0.02],
    [0.98, -0.01], [0.75, 0.06], [0.45, 0.1], [0.15, 0.12], [0.0, 0.12],
  ].reverse().map(([x, y]) => new THREE.Vector2(x, y)); // Lathe wants bottom-to-top for outward normals.
  return new THREE.LatheGeometry(pts, segments);
}

/** Stem from y=0 to y=1, flared root, bent along +x by `bend` at the top (quadratic). */
export function stemGeometry(bend = 0.25, segments = 12): THREE.BufferGeometry {
  const pts = [[0.22, 0], [0.13, 0.08], [0.1, 0.3], [0.085, 0.7], [0.1, 0.96], [0.0, 1.0]].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, segments);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + bend * y * y);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Crystal shard cluster, roughly unit height. */
export function crystalClusterGeometry(rand: () => number, shards = 5): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < shards; i++) {
    const h = 0.4 + rand() * 0.6;
    const g = new THREE.CylinderGeometry(0, 0.09 + rand() * 0.06, h, 5, 1);
    g.translate(0, h / 2, 0);
    g.rotateZ((rand() - 0.5) * 0.9);
    g.rotateX((rand() - 0.5) * 0.9);
    g.translate((rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.25);
    parts.push(g.toNonIndexed());
  }
  return mergeNonIndexed(parts);
}

function mergeNonIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array as Float32Array, o); o += g.attributes.position.count * 3; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

/** Cheap deterministic value noise on the CPU, for displacing rock. */
export function noise3(x: number, y: number, z: number): number {
  const h = (a: number, b: number, c: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = (t: number) => t * t * (3 - 2 * t);
  const [ux, uy, uz] = [u(xf), u(yf), u(zf)];
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), ux), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), ux), uy),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), ux), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), ux), uy),
    uz,
  );
}

/**
 * Floating island: a flattish mossy top and a long, craggy, inverted-spire underside.
 * Unit radius at the top; underside depth is `depth` radii.
 */
export function floatingIslandGeometry(seed: number, depth = 1.8): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 5);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 2.1 + seed, v.y * 2.1, v.z * 2.1) * 0.6 + noise3(v.x * 5 + seed, v.y * 5, v.z * 5) * 0.25;
    if (v.y > 0) {
      v.y = v.y * 0.18 + n * 0.08;
      v.x *= 1 + n * 0.25; v.z *= 1 + n * 0.25;
    } else {
      const t = -v.y;
      const taper = 1 - Math.pow(t, 0.7) * 0.85;
      v.x *= taper * (0.9 + n * 0.5); v.z *= taper * (0.9 + n * 0.5);
      v.y = -Math.pow(t, 1.3) * depth * (0.7 + n * 0.6);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Topmost surface height of a floatingIslandGeometry at unit radius r (approximate, for placing flora). */
export const ISLAND_TOP = 0.16;

/** A ribbon following a curve: uv.x across, uv.y along (0 at start). For liquid-light falls. */
export function ribbonGeometry(curve: THREE.Curve<THREE.Vector3>, width: number, segments = 64, widen = 1.6): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    side.crossVectors(tan, up);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize().multiplyScalar((width / 2) * (1 + (widen - 1) * t));
    positions.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
    uvs.push(0, t, 1, t);
    if (i < segments) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}
