import * as THREE from 'three';
import { ORGANIC, ZONE7, ZONE7_SHADE } from './palette';
import { GLSL_NOISE } from './materials';

/**
 * Distant landforms: rings of ridges, mesas and spires around a zone, fading into horizon haze with distance.
 * They give the player scale and a sense that the map sits inside a larger world (a plateau in a valley of mist)
 * instead of a platform floating in the sky. Silhouettes only: no lights, one draw per ring, no textures.
 *
 *   scene.add(horizonLands({ seed: 7 }));
 */
export interface HorizonOptions {
  seed?: number;
  /** Ring radii in metres, nearest first. Keep inside the sky dome (900 m) and the camera far plane. */
  radii?: number[];
  /** World y the ridges rise out of (inside the valley mist) and the peak height of the nearest ring. */
  base?: number;
  height?: number;
  /** Direction the key light comes from, for a faint lit edge on the ridgelines. */
  lightDir?: THREE.Vector3;
}

export const HORIZON = { radii: [380, 560, 800], base: -70, height: 120, segments: 540 } as const;

/** Seeded ridge profile around the ring: ridged octaves, flattened mesas and a few needle spires. Returns 0..~1.3. */
export function ridgeProfile(seed: number, t: number): number {
  const a = t * Math.PI * 2;
  const ph = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453 % 6.283;
  let h = 0, amp = 0.55, f = 3;
  // Two ridged octaves for the big crests, then smooth octaves so the skyline erodes instead of turning to saw teeth.
  // The crests are rounded (a softened |w|): weathered shoulders read grown, knife-edge cusps read as cut paper.
  for (let o = 0; o < 5; o++) {
    const w = Math.sin(a * f + ph(o));
    h += amp * (o < 2 ? 1.12 - Math.sqrt(w * w + 0.03) : 0.5 + 0.5 * w);
    amp *= 0.45; f *= 2.3;
  }
  // Mesas: clamp broad swells into flat tops.
  const swell = 0.5 + 0.5 * Math.sin(a * 2 + ph(9));
  h = Math.min(h, 0.55 + swell * 0.4);
  // Rare spires.
  const spire = Math.pow(Math.max(0, Math.sin(a * 23 + ph(11))), 24) * 0.18;
  return Math.max(0.05, h + spire);
}

export function horizonLands(o: HorizonOptions = {}): THREE.Group {
  const seed = o.seed ?? 7;
  const radii = o.radii ?? [...HORIZON.radii];
  const base = o.base ?? HORIZON.base;
  const g = new THREE.Group();
  g.name = 'horizon-lands';
  const light = (o.lightDir ?? new THREE.Vector3(-0.4, 0.5, -0.7)).clone().normalize();
  radii.forEach((R, k) => {
    const n = HORIZON.segments;
    // Farther rings stand taller (mountains behind hills) but read paler.
    const peak = (o.height ?? HORIZON.height) * (1 + k * 0.7);
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const rows = 3; // foot, shoulder, ridgeline
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const h = ridgeProfile(seed + k * 31, t) * peak;
      const a = t * Math.PI * 2;
      // Wobble the radius so the ring never reads as a circle.
      const r = R * (1 + 0.06 * Math.sin(a * 5 + k) + 0.03 * Math.sin(a * 13 + seed));
      for (let j = 0; j < rows; j++) {
        const v = j / (rows - 1);
        const y = base + h * (j === 1 ? 0.55 : v);
        const rr = r + (1 - v) * 18; // the foot spreads outward a little, like scree
        pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
        uv.push(t, v);
      }
      if (i < n) for (let j = 0; j < rows - 1; j++) {
        const p = i * rows + j, q = (i + 1) * rows + j;
        idx.push(p, q, p + 1, q, q + 1, p + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const haze = radii.length > 1 ? k / (radii.length - 1) : 0;
    const mat = new THREE.ShaderMaterial({
      fog: false, side: THREE.DoubleSide,
      uniforms: {
        uRock: { value: new THREE.Color(ZONE7_SHADE.rockDeep).lerp(new THREE.Color(ZONE7_SHADE.rock), 0.35) },
        uHaze: { value: new THREE.Color(ZONE7_SHADE.skyHorizon).lerp(new THREE.Color(ORGANIC.mist), 0.25) },
        uRim: { value: new THREE.Color(ORGANIC.mist) },
        uSpeck: { value: new THREE.Color(ZONE7.cyan) },
        uLight: { value: light },
        uHazeK: { value: 0.3 + haze * 0.3 },
        uSpecks: { value: k === 0 ? 1 : 0 },
      },
      vertexShader: 'varying vec2 vUv; varying vec3 vW, vN; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */ `
        uniform vec3 uRock, uHaze, uRim, uSpeck, uLight; uniform float uHazeK, uSpecks;
        varying vec2 vUv; varying vec3 vW, vN;
        ${GLSL_NOISE}
        void main() {
          // Strata and erosion gullies so the faces are not flat cut-outs.
          float strata = bioFbm(vec3(vW.x * 0.02, vW.y * 0.12, vW.z * 0.02));
          float gully = bioNoise(vec3(atan(vW.z, vW.x) * 90.0, vW.y * 0.03, 1.0));
          vec3 c = uRock * (0.55 + strata * 0.6) * (0.8 + gully * 0.3);
          // A faint lit edge on faces turned toward the key light.
          float lit = max(dot(normalize(vN), uLight), 0.0);
          c += uRim * lit * 0.06;
          // Aerial perspective: farther rings sit deeper in the haze; every foot dissolves into valley mist.
          float mist = 1.0 - smoothstep(0.0, 0.45, vUv.y);
          c = mix(c, uHaze * 0.55, clamp(uHazeK + mist * 0.65, 0.0, 1.0));
          // Ridgelines stay a touch darker than the night sky behind them, so they read as distant land in silhouette
          // rather than pale cut-outs pasted on the sky (2026-11-12 Expanse review).
          c *= 1.0 - 0.3 * smoothstep(0.55, 1.0, vUv.y);
          // A few faint far lights on the nearest ridges: scale cues, not neon.
          float speck = uSpecks * step(0.985, bioNoise(vec3(vW.xz * 0.15, 4.0))) * smoothstep(0.2, 0.6, vUv.y) * (1.0 - smoothstep(0.7, 0.9, vUv.y));
          c += uSpeck * speck * 0.35;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `horizon-ring-${k}`;
    mesh.userData.noAO = true;
    mesh.renderOrder = -4 + k * -0.1;
    g.add(mesh);
  });
  return g;
}
