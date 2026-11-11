import * as THREE from 'three';
import { ZONE7, ZONE7_SHADE } from './palette';
import { bioSurface, zoneRock } from './materials';

/**
 * Ground cover around the viewer: glowing frond tufts, thumb-sized fungi, light buds and pebbles,
 * the dense foreground detail of reference 04. Instead of scattering hundreds of thousands of
 * instances over the island, a fixed pool of instances is laid on a world-space grid around the
 * rendering camera and re-laid only when the camera crosses a cell, so the cover is stable in the
 * world (it never swims) and costs the same anywhere. Items shrink to nothing toward the edge of the
 * field so there is no visible pop. The software tier (BIO_LOW) gets a smaller field.
 */

export interface CoverOptions {
  height(x: number, z: number): number;
  /** Return true where no cover may grow (pools, gameplay pads). */
  exclude?(x: number, z: number): boolean;
  /** Field radius in metres (GPU tier). */
  radius?: number;
  /** Grid spacing in metres; one candidate item per cell. */
  cell?: number;
}

export const COVER = { radius: 26, lowRadius: 13, cell: 0.62 };

type Kind = 'frond' | 'fungus' | 'bud' | 'pebble';
const KINDS: Kind[] = ['frond', 'fungus', 'bud', 'pebble'];
const TINTS = [ZONE7.cyan, ZONE7.lime, ZONE7.magenta, ZONE7.violet];

/** Integer-lattice hash in [0, 1). */
export function cellHash(ix: number, iz: number, k: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(k, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise for patchiness (clumps of growth with bare ground between). */
function patch(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = cellHash(ix, iz, 91), b = cellHash(ix + 1, iz, 91), c = cellHash(ix, iz + 1, 91), d = cellHash(ix + 1, iz + 1, 91);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz;
}

/** Unit-height geometry per kind (y from 0 to ~1); glowing parts sit above y = 0.62 (see coverMaterial). */
function kindGeometry(kind: Kind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'frond') {
    // Five curved, tapering blades fanning out of one root.
    for (let i = 0; i < 5; i++) {
      const g = new THREE.ConeGeometry(0.06, 1, 4, 5).translate(0, 0.5, 0);
      const p = g.attributes.position;
      const lean = 0.25 + (i % 3) * 0.12;
      for (let v = 0; v < p.count; v++) { const y = p.getY(v); p.setX(v, p.getX(v) + lean * y * y); }
      g.rotateY((i / 5) * Math.PI * 2 + i * 0.3);
      g.scale(1, 0.75 + (i % 2) * 0.25, 1);
      parts.push(g);
    }
  } else if (kind === 'fungus') {
    parts.push(new THREE.CylinderGeometry(0.05, 0.07, 0.66, 6).translate(0, 0.33, 0));
    parts.push(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.55, 1).translate(0, 0.64, 0));
  } else if (kind === 'bud') {
    // Curled stalk ending in a light bud.
    const pts = [0, 1, 2, 3, 4].map((k) => new THREE.Vector3(Math.sin(k * 0.5) * 0.12 * k * 0.25, k * 0.2, 0));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.018, 4));
    parts.push(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.3, 1).translate(pts[4].x, 0.82, 0));
  } else {
    parts.push(new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.45, 0.8).translate(0, 0.1, 0));
  }
  return merge(parts);
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/**
 * Dark moss-coloured bodies whose tips glow in the instance tint, brightest at the very top and
 * flickering slowly per instance, so a field of them twinkles like reference 04's foreground.
 */
export function coverMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: ZONE7_SHADE.moss, roughness: 0.45, metalness: 0 });
  return bioSurface(mat, {
    uniforms: { uBody: { value: new THREE.Color(ZONE7_SHADE.moss) }, uRoot: { value: new THREE.Color(ZONE7_SHADE.rockDeep) } },
    declarations: 'uniform vec3 uBody, uRoot;\n',
    fragment: /* glsl */ `
      vec3 tint = vec3(1.0);
      #ifdef USE_COLOR
        tint = vColor.rgb;
      #endif
      float y = clamp(vBioLocal.y, 0.0, 1.0);
      float tip = smoothstep(0.55, 0.95, y);
      float twinkle = 0.65 + 0.35 * sin(bioTime * (1.2 + fract(vBioSeed.x) * 1.5) + vBioSeed.y * 6.0);
      diffuseColor.rgb = mix(uRoot, uBody * 1.8, smoothstep(0.0, 0.5, y)) * mix(vec3(1.0), tint, 0.45 + tip * 0.4);
      totalEmissiveRadiance += tint * (tip * 2.4 * twinkle + y * 0.12);
    `,
  });
}

export interface GroundCover {
  group: THREE.Group;
  /** Re-lay the field around (x, z). Called automatically before each render. */
  relay(x: number, z: number, low: boolean): void;
  /** Live instances per kind (tests, budget checks). */
  readonly counts: Record<Kind, number>;
}

export function groundCover(opts: CoverOptions): GroundCover {
  const R = opts.radius ?? COVER.radius;
  const g = opts.cell ?? COVER.cell;
  const max = Math.ceil(Math.PI * (R / g) ** 2 * 1.05);
  const bodyMat = coverMaterial();
  const rockMat = zoneRock({ scale: 6 });
  const group = new THREE.Group();
  group.name = 'ground-cover';
  const meshes = {} as Record<Kind, THREE.InstancedMesh>;
  // Share of cells per kind: fronds dominate, pebbles and light buds punctuate.
  const share: Record<Kind, number> = { frond: 0.62, fungus: 0.13, bud: 0.11, pebble: 0.14 };
  for (const k of KINDS) {
    const m = new THREE.InstancedMesh(kindGeometry(k), k === 'pebble' ? rockMat : bodyMat, Math.ceil(max * share[k] * 1.3) + 8);
    m.frustumCulled = false; // the field always surrounds the camera
    m.count = 0;
    m.name = `cover-${k}`;
    m.userData.noAO = false;
    meshes[k] = m;
    group.add(m);
  }
  const counts: Record<Kind, number> = { frond: 0, fungus: 0, bud: 0, pebble: 0 };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  let lastKey = '';

  const relay = (cx: number, cz: number, low: boolean) => {
    const r = low ? Math.min(R, COVER.lowRadius) : R;
    const ix0 = Math.floor(cx / g), iz0 = Math.floor(cz / g);
    const key = `${ix0},${iz0},${low}`;
    if (key === lastKey) return;
    lastKey = key;
    for (const k of KINDS) counts[k] = 0;
    const span = Math.ceil(r / g);
    for (let dz = -span; dz <= span; dz++) for (let dx = -span; dx <= span; dx++) {
      const ix = ix0 + dx, iz = iz0 + dz;
      const x = (ix + 0.15 + cellHash(ix, iz, 1) * 0.7) * g, z = (iz + 0.15 + cellHash(ix, iz, 2) * 0.7) * g;
      const d = Math.hypot(x - cx, z - cz);
      if (d > r) continue;
      // Clumps: dense patches with bare moss between them.
      const density = patch(x * 0.09, z * 0.09) * 0.75 + patch(x * 0.37, z * 0.37) * 0.25;
      if (cellHash(ix, iz, 3) > density * 1.5) continue;
      if (opts.exclude?.(x, z)) continue;
      const pick = cellHash(ix, iz, 4);
      const kind: Kind = pick < share.frond ? 'frond' : pick < share.frond + share.fungus ? 'fungus' : pick < 1 - share.pebble ? 'bud' : 'pebble';
      const mesh = meshes[kind];
      const i = counts[kind];
      if (i >= mesh.instanceMatrix.count) continue;
      const fade = 1 - Math.max(0, (d - r * 0.7) / (r * 0.3)); // shrink to nothing at the field edge
      const base = kind === 'frond' ? 0.4 + density * 0.45 : kind === 'fungus' ? 0.18 + cellHash(ix, iz, 5) * 0.28 : kind === 'bud' ? 0.3 + cellHash(ix, iz, 5) * 0.3 : 0.1 + cellHash(ix, iz, 5) * 0.25;
      const size = base * (0.6 + cellHash(ix, iz, 6) * 0.8) * fade;
      if (size < 0.02) continue;
      const tilt = (cellHash(ix, iz, 7) - 0.5) * 0.35;
      q.setFromEuler(e.set(tilt, cellHash(ix, iz, 8) * Math.PI * 2, tilt * 0.6));
      p.set(x, opts.height(x, z) - (kind === 'pebble' ? size * 0.15 : 0.02), z);
      mesh.setMatrixAt(i, m4.compose(p, q, s.setScalar(size)));
      // Tint follows the patch so clumps share a colour, like a colony.
      const hue = Math.floor(patch(x * 0.05 + 7, z * 0.05 + 3) * 3.999 + cellHash(ix, iz, 9) * 0.6) % TINTS.length;
      mesh.setColorAt(i, col.set(TINTS[hue]));
      counts[kind] = i + 1;
    }
    for (const k of KINDS) {
      const m = meshes[k];
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  };

  // Follow whichever camera is rendering (player or look-dev); the software tier marks materials BIO_LOW.
  meshes.frond.onBeforeRender = (_r, _s, cam) => relay(cam.position.x, cam.position.z, !!bodyMat.defines?.BIO_LOW);
  relay(0, 0, false);
  return { group, relay, counts };
}
