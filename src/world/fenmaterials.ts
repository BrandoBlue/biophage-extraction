import * as THREE from 'three';
import { HIVE, ORGANIC, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioSurface } from '../render/materials';

/**
 * Surfaces for the Weeping Fen (World & Level, built on Rendering's bioSurface so the global glow restraint and
 * BIO_BUMP relief apply). Three shader families only, so the software tier's first frame stays cheap:
 *   fenBark  - giant trunks, roots, hut walls and planks (one program; uniforms pick bark, plank or hide)
 *   fenMud   - the drowned forest floor: peat, silt, moss mats, roots, a dark wet band at the waterline
 *   fenWater - still black water with slow ripples, sky sheen, shallows fading clear over the mud
 * Every colour comes from src/render/palette.ts. Glow is limited to rare lichen specks and fungus (Art Bible).
 */

const c = (hex: string) => new THREE.Color(hex);
const u = (hex: string): THREE.IUniform => ({ value: c(hex) });

/** Height of the water surface every fen system shares (data/weepingfen.json water.level). */
export const FEN_WATER_Y = 0;

const BARK_GLSL = /* glsl */ `
  // Fibrous bark: long vertical ridges that wander, split by deep fissures; moss on the up-facing and shaded side,
  // pale lichen rosettes, a dark wet tide band where the trunk meets the water. Planks and hide reuse the program.
  vec3 w = vBioWorld * uScale;
  // Merged meshes are in world space, so the ridges follow the surface normal's heading round each trunk (a fixed
  // count of ridges per trunk) and run up the height; planks lay their grain along the board instead.
  vec3 nrm = normalize(vBioNormal);
  float ang = atan(nrm.z, nrm.x);
  vec2 q = mix(vec2(ang * 7.0 + bioNoise(w * 0.15) * 2.0, w.y * 0.35), vec2(w.x + w.z, w.y) * 0.6, uPlank);
  float wander = bioFbm(vec3(q.x * 0.6, q.y * 0.25, 3.0)) * 2.5;
  float ridge = abs(sin((q.x + wander) * 6.0));
  float fissure = 1.0 - smoothstep(0.0, 0.18, ridge);
  float fibre = bioNoise(vec3(q.x * 26.0, q.y * 2.0, 7.0));
  float knots = 1.0 - smoothstep(0.05, 0.22, bioCells(w * 0.35 + vBioSeed));
  float grain = bioFbm(w * 1.3);
  vec3 col = mix(uDeep * 1.5 + uBase * 0.15, uBase * (0.85 + grain * 0.7), smoothstep(0.05, 0.6, ridge)) * (0.85 + fibre * 0.3);
  col = mix(col, uDeep * 0.6, knots * 0.7);
  // Moss creeps up from the water and gathers on ledges and the tops of roots.
  float up = smoothstep(0.1, 0.8, vBioNormal.y);
  float mossLine = 1.0 - smoothstep(0.6, 4.0 + bioFbm(w * 0.4) * 5.0, vBioWorld.y - uWaterY);
  float moss = clamp(max(up * 0.9, mossLine * 0.7) * smoothstep(0.35, 0.65, bioFbm(w * 0.8 + 11.0)), 0.0, 1.0) * uMossy;
  vec3 mossCol = mix(uMoss * 0.7, uMoss * 1.9, bioNoise(w * 3.0));
  col = mix(col, mossCol, moss);
  // Lichen: pale, flat rosettes on the bark; a few carry a faint cold light (the fen's only glow on wood).
  float lichen = (1.0 - smoothstep(0.08, 0.2, bioCells(w * 0.9 + 4.0))) * (1.0 - moss) * uMossy;
  col = mix(col, uLichen * 0.55, lichen * 0.6);
  // Wet tide band: the bottom of everything is dark and glossy where the water has soaked it.
  float wet = 1.0 - smoothstep(0.0, 0.9 + grain * 0.6, vBioWorld.y - uWaterY);
  col *= 1.0 - wet * 0.55;
  diffuseColor.rgb = col;
  roughnessFactor = mix(0.92, 0.3, wet) - moss * 0.1;
  float relief = ridge * 0.7 + fibre * 0.15 - fissure * 0.5 + knots * 0.3 + moss * 0.25;
  BIO_BUMP(relief, 0.16 * (1.0 + uPlank * 0.5));
  diffuseColor.rgb *= 0.7 + 0.3 * smoothstep(0.0, 1.0, relief);
  totalEmissiveRadiance = uGlow * lichen * step(0.8, bioHash(floor(w * 0.9 + 4.0))) * (0.6 + 0.4 * sin(bioTime * 0.7 + vBioSeed.y)) * 0.6;
`;

export interface BarkOptions { base?: string; deep?: string; plank?: boolean; mossy?: number; scale?: number }

/** Bark for trunks and roots; `plank` lays the grain along the board (huts, decks, walkways). */
export function fenBark(o: BarkOptions = {}): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: o.base ?? ZONE7_SHADE.stem, roughness: 0.9, metalness: 0 }), {
    uniforms: {
      uBase: u(o.base ?? ZONE7_SHADE.stem), uDeep: u(o.deep ?? ZONE7_SHADE.rockDeep), uMoss: u(ZONE7_SHADE.moss), uLichen: u(HIVE.bone),
      uGlow: u(ZONE7.cyan), uPlank: { value: o.plank ? 1 : 0 }, uMossy: { value: o.mossy ?? 1 }, uScale: { value: o.scale ?? 1 }, uWaterY: { value: FEN_WATER_Y },
    },
    declarations: 'uniform vec3 uBase, uDeep, uMoss, uLichen, uGlow; uniform float uPlank, uMossy, uScale, uWaterY;\n',
    fragment: BARK_GLSL,
  });
}

/** The fen floor: peat and silt under the water, moss mats and root litter on the islets. */
export function fenMud(): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: ZONE7_SHADE.moss, roughness: 0.8, metalness: 0 }), {
    uniforms: { uPeat: u(ZONE7_SHADE.rockDeep), uSilt: u(ZONE7_SHADE.rock), uMoss: u(ZONE7_SHADE.moss), uFlesh: u(ZONE7_SHADE.flesh), uBone: u(HIVE.bone), uMist: u(ORGANIC.mist), uWaterY: { value: FEN_WATER_Y } },
    declarations: 'uniform vec3 uPeat, uSilt, uMoss, uFlesh, uBone, uMist; uniform float uWaterY;\n',
    fragment: /* glsl */ `
      vec3 p = vBioWorld * 0.22;
      float dry = smoothstep(0.02, 0.35, vBioWorld.y - uWaterY);
      float silt = bioFbm(p * vec3(1.0, 0.0, 1.0) + 2.0);
      vec3 col = mix(uPeat * 1.4, uSilt * 0.55, smoothstep(0.35, 0.75, silt));
      // Moss mats on the islets: thick, lumpy, with darker hollows and pale dead patches.
      float mat = smoothstep(0.3, 0.6, bioFbm(p * 1.6 + 5.0)) * dry;
      float lump = bioNoise(vBioWorld * 1.7);
      vec3 moss = mix(uMoss * 0.8, uMoss * 2.2, lump) * (0.85 + 0.3 * bioNoise(vBioWorld * 7.0));
      moss = mix(moss, uSilt * 0.7, smoothstep(0.7, 0.9, bioFbm(p * 3.0 + 1.0)) * 0.6);
      col = mix(col, moss, mat);
      // Root litter: thin dark runners crossing the ground, and bleached bone half sunk in the peat.
      float runners = bioVein(p * 3.5) * smoothstep(0.4, 0.7, bioNoise(p * 0.7 + 3.0));
      col = mix(col, uPeat * 0.8, runners * 0.7);
      float bone = (1.0 - smoothstep(0.03, 0.07, bioCells(vBioWorld * 0.6 + 13.0))) * (1.0 - mat);
      col = mix(col, uBone * 0.45, bone * 0.6);
      // Flesh-like fungal crust in rare colonies: the strangeness lives in the ground.
      float crust = smoothstep(0.7, 0.82, bioFbm(p * 0.9 + 21.0)) * dry;
      float pits = 1.0 - smoothstep(0.05, 0.14, bioCells(vBioWorld * 3.0));
      col = mix(col, uFlesh * (0.5 + 0.3 * pits), crust * 0.8);
      // Wet: below and at the waterline everything is dark and glossy.
      float wet = 1.0 - smoothstep(-0.05, 0.25, vBioWorld.y - uWaterY);
      col *= 1.0 - wet * 0.45;
      diffuseColor.rgb = col;
      roughnessFactor = mix(0.95, 0.25, max(wet, crust * 0.6)) - mat * 0.05;
      float relief = silt * 0.4 + mat * (0.4 + lump * 0.4) + runners * 0.3 + bone * 0.3 + crust * pits * -0.3;
      BIO_BUMP(relief, 0.12);
      diffuseColor.rgb *= 0.75 + 0.25 * smoothstep(0.1, 0.9, relief);
    `,
  });
}

/**
 * Still fen water. Vertex colour red carries the depth over the mud (0 at the shore, 1 at ~1.2 m), so shallows fade
 * to clear over the silt and the channels read black. Ripples tilt the normal so the sky sheen breaks up.
 */
export function fenWater(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: ZONE7_SHADE.rockDeep, roughness: 0.06, metalness: 0.1, transparent: true, vertexColors: true, depthWrite: false });
  return bioSurface(mat, {
    uniforms: { uDeep: u(ZONE7_SHADE.rockDeep), uTint: u(ZONE7_SHADE.moss), uMist: u(ORGANIC.mist) },
    declarations: 'uniform vec3 uDeep, uTint, uMist;\n',
    fragment: /* glsl */ `
      float depth = 1.0;
      #ifdef USE_COLOR
        depth = vColor.r;
      #endif
      vec3 p = vBioWorld;
      float r1 = bioNoise(vec3(p.xz * 0.9, bioTime * 0.25));
      float r2 = bioNoise(vec3(p.xz * 2.7 + 7.0, bioTime * 0.4));
      float rings = sin(length(fract(p.xz * 0.05) - 0.5) * 60.0 - bioTime * 1.4) * 0.5 + 0.5;
      BIO_BUMP(r1 * 0.6 + r2 * 0.25 + rings * 0.04, 0.05);
      // Scum and floating spores collect in still patches.
      float scum = smoothstep(0.62, 0.8, bioFbm(vec3(p.xz * 0.12, 1.0))) * (1.0 - depth * 0.5);
      vec3 col = mix(uTint * 0.6, uDeep, smoothstep(0.0, 0.7, depth));
      col = mix(col, uTint * 1.4, scum * 0.7);
      diffuseColor.rgb = col;
      diffuseColor.a = mix(0.25, 0.94, smoothstep(0.0, 0.6, depth)) + scum * 0.3;
      roughnessFactor = mix(0.04, 0.5, scum);
    `,
  });
}
