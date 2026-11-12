import * as THREE from 'three';
import { ZONE7_SHADE } from './palette';
import { GLSL_NOISE, bioTime } from './materials';
import { EDGE_FOG, heightFog } from './fog';

/**
 * The edge of the map, hidden in murk (Brandon, 2026-11-12: "This is the edge of the map, we need a fog or something
 * to cover it so it feels scary"). Two parts:
 *
 *  - The shared fog (src/render/fog.ts) swallows everything past the playable edge and closes in as the player nears
 *    it, so terrain skirts, cut-off ridges and stray props beyond the boundary never read. `setEdgeFog` sets the ring
 *    before the pipeline installs the fog.
 *  - `edgeMurk` stands curtains of slow, churning murk around the boundary: faint banks on the skyline from the middle
 *    of the map, a dark wall that breathes and drifts when you walk up to it. Grounded, not neon: the zone's own fog
 *    colour pulled toward the deep shade, no glow.
 *
 * The playable area itself is untouched: nothing inside about 70% of the radius changes.
 */
export const EDGE_MURK = {
  /** Curtain rings as fractions of the playable radius, nearest first, and their height over the ground (m). */
  rings: [1.0, 1.07, 1.16],
  heights: [70, 95, 125],
  /** How much the curtains darken the fog colour toward the deep shade. */
  dark: 0.45,
  /** Curtain opacity seen from the middle of the map, and at the edge. */
  farAlpha: 0.32,
  nearAlpha: 0.94,
  /** The curtains thicken from this fraction of the radius (camera), the same point the fog starts closing in. */
  closeIn: EDGE_FOG.closeIn,
  segments: 192,
} as const;

/** Configure the boundary fog term. Call before the pipeline is created (the fog shader bakes these in). */
export function setEdgeFog(radius: number, centre: [number, number] = [0, 0]): void {
  heightFog.edgeRadius.value = radius;
  heightFog.edgeCentre.value = centre;
}

export interface EdgeMurkOptions {
  radius: number;
  centre?: [number, number];
  /** Ground height under the ring, so curtains rise from the land. */
  ground: (x: number, z: number) => number;
  /** Base colour, normally the zone's fog colour. */
  colour: THREE.ColorRepresentation;
  /** Fewer curtains for the software tier. */
  lite?: boolean;
}

export function edgeMurk(o: EdgeMurkOptions): THREE.Group {
  const g = new THREE.Group();
  g.name = 'edge-murk';
  const [cx, cz] = o.centre ?? [0, 0];
  const col = new THREE.Color(o.colour).lerp(new THREE.Color(ZONE7_SHADE.rockDeep), EDGE_MURK.dark);
  const rings = o.lite ? EDGE_MURK.rings.slice(0, 1) : EDGE_MURK.rings;
  rings.forEach((f, k) => {
    const R = o.radius * f, n = EDGE_MURK.segments, top = EDGE_MURK.heights[k];
    const pos: number[] = [], ground: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
      // The curtain foot sits well under the local ground so no gap shows on slopes.
      const gy = o.ground(x, z);
      pos.push(x, gy - 25, z, x, gy + top, z);
      ground.push(gy, gy);
      if (i < n) { const p = i * 2, q = p + 2; idx.push(p, q, p + 1, q, q + 1, p + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aGround', new THREE.Float32BufferAttribute(ground, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: {
        bioTime, uCol: { value: col }, uCentre: { value: new THREE.Vector2(cx, cz) }, uR: { value: o.radius },
        uTop: { value: top }, uLayer: { value: k }, uFar: { value: EDGE_MURK.farAlpha }, uNear: { value: EDGE_MURK.nearAlpha },
        uCloseIn: { value: EDGE_MURK.closeIn },
      },
      vertexShader: /* glsl */ `
        attribute float aGround; varying vec3 vW; varying float vH;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vH = w.y - aGround; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float bioTime, uR, uTop, uLayer, uFar, uNear, uCloseIn; uniform vec3 uCol; uniform vec2 uCentre;
        varying vec3 vW; varying float vH;
        ${GLSL_NOISE}
        void main() {
          float camR = length(cameraPosition.xz - uCentre);
          float near = smoothstep(uR * uCloseIn, uR * 0.97, camR);
          // Churning banks: broad slow folds that roll sideways and sink, with finer wisps lifting off the top.
          float ang = atan(vW.z - uCentre.y, vW.x - uCentre.x) * uR;
          float t = bioTime;
          vec3 q = vec3(ang * 0.018 + t * (0.05 + uLayer * 0.02), vH * 0.03 - t * 0.04, uLayer * 3.7 + t * 0.02);
          float folds = bioFbm(q);
          float wisps = bioNoise(vec3(ang * 0.06 - t * 0.11, vH * 0.08 - t * 0.2, uLayer + 9.0));
          float body = smoothstep(0.3, 0.8, folds * 0.85 + wisps * 0.4);
          // Thick at the ground, thinning and tearing toward the top.
          float h = clamp(vH / uTop, 0.0, 1.0);
          float column = (1.0 - smoothstep(0.25, 1.0, h + (1.0 - body) * 0.6)) * smoothstep(-0.2, 0.05, h);
          float a = column * mix(0.4, 1.0, body) * mix(uFar, uNear, near);
          // Slightly darker in the folds, so the wall has depth instead of a flat grey sheet.
          vec3 c = uCol * (0.5 + 0.7 * folds * folds + 0.15 * wisps);
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `edge-murk-${k}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5 - k;
    mesh.userData.noAO = true;
    mesh.userData.noShadow = true;
    mesh.userData.noOrganic = true;
    g.add(mesh);
  });
  return g;
}
