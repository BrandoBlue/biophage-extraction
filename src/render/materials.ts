import * as THREE from 'three';
import { ZONE7, ZONE7_SHADE, HIVE, ORGANIC } from './palette';

/**
 * Bio-material library for BIOPHAGE. Every surface is code-generated: procedural GLSL injected into
 * Three's physically based materials, so lights, fog and shadows keep working while the surface gets
 * veins, pulsing nodes, moss and iridescence. Any department may import these.
 */

/** Shared clock for every animated material. `pipeline.render(dt)` advances it. */
export const bioTime = { value: 0 };

/**
 * Global glow restraint for every bio-material (Art Bible, "Ethereal, not neon"): emissive is scaled by
 * `bioGlow` and pulled toward its own luminance by `1 - bioSat`, so bioluminescence reads as an organic
 * accent on lit surfaces rather than neon. Presets may tune these; departments should not bypass them.
 */
export const bioGlow = { value: 0.32 };
export const bioSat = { value: 0.55 };

export const GLSL_NOISE = /* glsl */ `
// BIO_LOW (software tier) trims octaves and cell taps: SwiftShader JIT time scales with shader size.
#ifdef BIO_LOW
  #define BIO_OCT 2
  #define BIO_C0 0
#else
  #define BIO_OCT 5
  #define BIO_C0 -1
#endif
float bioHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bioNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bioHash(i), bioHash(i + vec3(1,0,0)), f.x), mix(bioHash(i + vec3(0,1,0)), bioHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bioHash(i + vec3(0,0,1)), bioHash(i + vec3(1,0,1)), f.x), mix(bioHash(i + vec3(0,1,1)), bioHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float bioFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < BIO_OCT; i++) { s += a * bioNoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
// Thin ridges along noise zero-crossings: veins, cracks, mycelium.
float bioVein(vec3 p) { float n = bioNoise(p) * 2.0 - 1.0; return 1.0 - smoothstep(0.0, 0.08, abs(n)); }
// Voronoi-ish cell distance: spots, pustules, scales.
float bioCells(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); float d = 1.0;
  for (int x = BIO_C0; x <= 1; x++) for (int y = BIO_C0; y <= 1; y++) for (int z = BIO_C0; z <= 1; z++) {
    vec3 o = vec3(x, y, z); vec3 r = o + vec3(bioHash(i + o), bioHash(i + o + 7.1), bioHash(i + o + 3.3)) - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
`;

/**
 * Relief without textures: BIO_BUMP(height, scale) tilts the shading normal by the screen-space slope of a procedural
 * height field (in metres times scale), so surfaces catch light across grain, pores and plates. Use it inside a
 * bioSurface fragment; it compiles to nothing on the software tier.
 */
export const GLSL_BUMP = /* glsl */ `
#ifndef BIO_LOW
#define BIO_BUMP(h, k) { float bh_ = (h) * (k); vec3 bsx_ = dFdx(-vViewPosition), bsy_ = dFdy(-vViewPosition); \\
  vec3 br1_ = cross(bsy_, normal), br2_ = cross(normal, bsx_); float bdet_ = dot(bsx_, br1_) * (gl_FrontFacing ? 1.0 : -1.0); \\
  vec3 bg_ = sign(bdet_) * (dFdx(bh_) * br1_ + dFdy(bh_) * br2_); normal = normalize(abs(bdet_) * normal - bg_); }
#else
#define BIO_BUMP(h, k)
#endif
`;

interface SurfaceOptions {
  /** GLSL run before lighting. In scope: vBioWorld, vBioLocal, vBioSeed (per-object/instance offset), vBioNormal (world), bioTime, diffuseColor, totalEmissiveRadiance, roughnessFactor (standard) and uniforms you declare. */
  fragment: string;
  uniforms?: Record<string, THREE.IUniform>;
  declarations?: string;
}

/** Inject procedural GLSL into a MeshStandard/Physical material. Works with instancing and vertex colours. */
export function bioSurface<T extends THREE.MeshStandardMaterial>(mat: T, opts: SurfaceOptions): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.bioTime = bioTime;
    shader.uniforms.bioGlow = bioGlow;
    shader.uniforms.bioSat = bioSat;
    Object.assign(shader.uniforms, opts.uniforms ?? {});
    const varyings = 'varying vec3 vBioWorld;\nvarying vec3 vBioLocal;\nvarying vec3 vBioNormal;\nvarying vec3 vBioSeed;\n';
    shader.vertexShader = varyings + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vBioLocal = position;
      mat4 bioModel = modelMatrix;
      #ifdef USE_INSTANCING
        bioModel = modelMatrix * instanceMatrix;
      #endif
      #ifdef BIO_SEED
        vBioSeed = vec3(BIO_SEED, BIO_SEED * 1.7, BIO_SEED * 2.3); // moving bodies: pattern sticks to the skin
      #else
        vBioSeed = fract(vec3(bioModel[3][0], bioModel[3][1], bioModel[3][2]) * 0.1731) * 17.0;
      #endif
      vBioWorld = (bioModel * vec4(transformed, 1.0)).xyz;
      vBioNormal = normalize(mat3(bioModel) * objectNormal);`,
    );
    shader.fragmentShader = varyings + 'uniform float bioTime;\nuniform float bioGlow, bioSat;\n' + (opts.declarations ?? '') + GLSL_NOISE + GLSL_BUMP + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        ${opts.fragment}
      }
      totalEmissiveRadiance = mix(vec3(dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722))), totalEmissiveRadiance, bioSat) * bioGlow;`,
    );
  };
  // Distinct program per variant so Three does not share the patched shader with plain materials.
  mat.customProgramCacheKey = () => opts.fragment + (opts.declarations ?? '');
  return mat;
}

const c = (hex: string) => new THREE.Color(hex);
const u = (hex: string): THREE.IUniform => ({ value: c(hex) });

/** Zone 7 ground and island rock: dark violet stone, teal moss on flat tops, glowing mycelium veins in the cracks. */
export function zoneRock(opts: { veinColour?: string; mossColour?: string; scale?: number } = {}): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: ZONE7_SHADE.rock, roughness: 0.85, metalness: 0.05 }), {
    uniforms: {
      uRock: u(ZONE7_SHADE.rock), uDeep: u(ZONE7_SHADE.rockDeep), uMoss: u(ZONE7_SHADE.moss),
      uVein: u(opts.veinColour ?? ZONE7.cyan), uMossGlow: u(opts.mossColour ?? ZONE7.lime), uScale: { value: opts.scale ?? 1 },
      uGrowth: u(ORGANIC.wetFlesh), uBone: u(HIVE.bone),
    },
    declarations: 'uniform vec3 uRock, uDeep, uMoss, uVein, uMossGlow, uGrowth, uBone; uniform float uScale;\n',
    fragment: /* glsl */ `
      vec3 p = vBioWorld * 0.18 * uScale;
      float strata = bioFbm(p * vec3(1.0, 3.5, 1.0));
      // Deep strata keep a floor of the lit rock tone so night ground still shows form, never a black hole.
      vec3 rock = mix(mix(uDeep, uRock, 0.4), uRock * 1.15, smoothstep(0.25, 0.75, strata));
      float up = smoothstep(0.55, 0.9, vBioNormal.y);
      float mossMask = up * smoothstep(0.36, 0.6, bioFbm(p * 1.7 + 4.0));
      // Moss colonies vary from deep teal to a lighter, almost luminous sea-green, with fine grain underfoot.
      float colony = bioNoise(p * 2.3 + 1.7);
      vec3 moss = mix(uMoss * 1.2, uMoss * 2.4 + uVein * 0.05, smoothstep(0.35, 0.85, colony));
      float grain = 0.72 + 0.5 * bioNoise(vBioWorld * 2.6 * uScale);
      vec3 col = mix(rock, moss, mossMask) * grain;
      // Mycelium: two scales of veins, pulsing slowly along their length.
      float v = max(bioVein(p * 4.5), bioVein(p * 11.0 + 2.0) * 0.5);
      float pulse = 0.6 + 0.4 * sin(bioTime * 1.3 + bioFbm(p * 0.7) * 12.0);
      float veinMask = v * smoothstep(0.58, 0.72, bioFbm(p * 0.6 + 9.0));
      // Wide luminous rivulets of mycelium threading the moss on flat ground (reference 04's lit floor).
      float riv = bioVein(p * 1.4 + 5.0) * up * smoothstep(0.45, 0.65, bioNoise(p * 0.5 + 3.0));
      vec3 rivCol = mix(uVein, uMossGlow, smoothstep(0.3, 0.7, bioNoise(p * 0.8)));
      // Sparse glowing moss specks.
      float specks = (1.0 - smoothstep(0.02, 0.12, bioCells(vBioWorld * 1.6))) * mossMask;
      // Wet sheen: moss reads glossy and catches a teal rim at grazing angles.
      float fres = pow(1.0 - abs(dot(normalize(vBioNormal), normalize(cameraPosition - vBioWorld))), 3.0);
      // Strange growths (what makes Zone 7 ours): ribbed, pitted flesh nodules erupt from the stone in colonies, and
      // pale bone fragments are fossilised into it, like the ground is half skeleton, half tumour.
      float growthMask = smoothstep(0.64, 0.8, bioFbm(p * 0.9 + 21.0)) * (1.0 - mossMask * 0.6);
      float ribs = 0.5 + 0.5 * sin(bioFbm(p * 2.0 + 5.0) * 34.0);
      float pits = 1.0 - smoothstep(0.05, 0.14, bioCells(vBioWorld * 3.2 * uScale));
      vec3 growth = mix(uGrowth * 0.35, uGrowth * 0.8, ribs) * (1.0 - pits * growthMask * 0.65);
      col = mix(col, growth, growthMask);
      float bone = (1.0 - smoothstep(0.035, 0.08, bioCells(vBioWorld * 0.8 * uScale + 13.0))) * (1.0 - growthMask) * (1.0 - mossMask);
      col = mix(col, uBone * 0.5, bone * 0.75);
      roughnessFactor = mix(roughnessFactor, 0.25, growthMask * (1.0 - pits)); // growths read wet
      // Relief: strata, grain and gravel tilt the shading normal; moss sits softer. Hollows darken (cheap cavity AO).
      float gravel = bioNoise(vBioWorld * 9.0 * uScale);
      float relief = strata * 0.5 + grain * 0.35 + gravel * 0.08 - mossMask * colony * 0.2
        + growthMask * (0.45 + ribs * 0.2) - pits * growthMask * 0.35 + bone * 0.25;
      // Close-range micro detail (grit, hairline cracks, pitting) that fades out with distance: surfaces stay crisp up close.
      float near = 1.0 - smoothstep(3.0, 24.0, length(vViewPosition));
      // Wrapped coordinates keep the hash precise at high frequency; fwidth fades grit before it can alias into pixel noise.
      vec3 wp = mod(vBioWorld, 32.0) * uScale;
      near *= 1.0 - smoothstep(0.2, 0.55, length(fwidth(wp * 34.0)));
      float grit = bioNoise(wp * 14.0) * 0.6 + bioNoise(wp * 34.0 + 5.0) * 0.4;
      float crack = 1.0 - smoothstep(0.0, 0.035, abs(bioNoise(vBioWorld * 6.5 * uScale + 3.0) - 0.5));
      relief += near * (grit * 0.12 - crack * 0.18);
      col *= 1.0 - near * (crack * 0.35 - (grit - 0.5) * 0.16);
      BIO_BUMP(relief, 0.14);
      col *= (0.72 + 0.28 * smoothstep(0.2, 0.9, relief)) * (0.94 + gravel * 0.12);
      diffuseColor.rgb = col;
      roughnessFactor = mix(roughnessFactor, 0.35, mossMask * colony);
      totalEmissiveRadiance += uVein * veinMask * pulse * 0.7 + uMossGlow * specks * 1.2 + uMossGlow * mossMask * 0.02
        + rivCol * riv * pulse * 0.4 + mix(uVein, uMossGlow, colony) * fres * mossMask * 0.12;
      // Edges facing down darken to void; reads as mass hanging in space.
      diffuseColor.rgb *= mix(0.35, 1.0, smoothstep(-0.8, 0.2, vBioNormal.y));
    `,
  });
}

/** Fungus cap: iridescent top with glowing spots, luminous gill underside. Glow colour comes from instance colour or `glow`. */
export function fungusCap(glow: string = ZONE7.cyan): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    // A damp, velvety skin with a faint sheen rather than a lacquer: a hard clearcoat read as black plastic at night.
    color: ZONE7_SHADE.flesh, roughness: 0.58, clearcoat: 0.22, clearcoatRoughness: 0.5,
    iridescence: 0.3, iridescenceIOR: 1.4, emissive: glow,
  });
  return bioSurface(mat, {
    uniforms: { uFlesh: u(ZONE7_SHADE.flesh) },
    declarations: 'uniform vec3 uFlesh;\n',
    fragment: /* glsl */ `
      vec3 glowCol = emissive;
      #ifdef USE_COLOR
        glowCol = vColor.rgb;
      #endif
      float under = (1.0 - smoothstep(-0.4, 0.1, vBioNormal.y));           // gills face down
      float radial = length(vBioLocal.xz);
      // Gill ridges fade out where they get finer than a pixel, so far caps never shimmer into moire.
      float gillA = atan(vBioLocal.z, vBioLocal.x) * 48.0;
      float gillAA = 1.0 - clamp(length(vec2(dFdx(gillA), dFdy(gillA))) * 0.6 - 0.2, 0.0, 1.0);
      float gills = 0.5 + 0.5 * sin(gillA) * gillAA;
      float spots = (1.0 - smoothstep(0.12, 0.3, bioCells(vBioLocal * 5.0 + vBioSeed)));
      float rim = smoothstep(0.75, 1.02, radial) * (1.0 - under);   // luminous lip
      float mottling = bioFbm(vBioLocal * 4.0 + vBioSeed);
      float breathe = 0.8 + 0.2 * sin(bioTime * 1.7 + vBioSeed.x * 3.0);
      // Caps are lit flesh tinted by their colony colour; only spots, the lip and the gills glow.
      vec3 capTint = mix(uFlesh, glowCol * 0.35, 0.12);
      diffuseColor.rgb = mix(capTint * (0.62 + mottling * 0.7), mix(uFlesh, glowCol, 0.25) * (0.5 + 0.3 * gills), under);
      vec3 topGlow = glowCol * (spots * 0.9 + rim * 0.45 + mottling * 0.02);
      // Gills: a soft inner light that gathers toward the stem, ridges barely brighter than the hollows.
      vec3 gillGlow = glowCol * (0.18 + 0.22 * gills) * (0.35 + 0.65 * (1.0 - smoothstep(0.2, 1.0, radial)));
      totalEmissiveRadiance = mix(topGlow, gillGlow, under) * breathe;
    `,
  });
}

/** Fungus stem: translucent flesh with a faked subsurface glow rising from the gills. */
export function fungusStem(glow: string = ZONE7.cyan): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: ZONE7_SHADE.stem, roughness: 0.55, emissive: glow }), {
    uniforms: { uStem: u(ZONE7_SHADE.stem) },
    declarations: 'uniform vec3 uStem;\n',
    fragment: /* glsl */ `
      vec3 glowCol = emissive;
      #ifdef USE_COLOR
        glowCol = vColor.rgb;
      #endif
      float h = clamp(vBioLocal.y, 0.0, 1.0);
      float fibres = 0.5 + 0.5 * sin(atan(vBioLocal.z, vBioLocal.x) * 14.0 + vBioLocal.y * 6.0);
      diffuseColor.rgb = uStem * (0.6 + 0.4 * fibres);
      totalEmissiveRadiance = glowCol * (pow(h, 3.0) * 0.9 + bioVein(vBioLocal * 7.0 + vBioSeed) * 0.5) ;
    `,
  });
}

/** Crystal growth: faceted, glossy, internally lit. */
export function crystal(glow: string = ZONE7.violet): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: ZONE7_SHADE.rockDeep, roughness: 0.08, metalness: 0.2, clearcoat: 1, iridescence: 1, emissive: glow, flatShading: true });
  return bioSurface(mat, {
    fragment: /* glsl */ `
      vec3 glowCol = emissive;
      #ifdef USE_COLOR
        glowCol = vColor.rgb;
      #endif
      float core = bioFbm(vBioLocal * 3.0 + vBioSeed + bioTime * 0.15);
      float tip = smoothstep(0.0, 1.0, vBioLocal.y);
      totalEmissiveRadiance = glowCol * (0.03 + core * 0.18 + tip * tip * 0.6);
    `,
  });
}

/** Wet chitin with veins and a faked subsurface rim. For creature armour (Creature & Mutation). */
export function chitin(base: string = HIVE.bone, glow: string = ZONE7.cyan, scale = 1): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 0.5, sheenColor: c(glow) });
  return bioSurface(mat, {
    uniforms: { uGlow: u(glow), uScale: { value: scale } },
    declarations: 'uniform vec3 uGlow; uniform float uScale;\n',
    fragment: /* glsl */ `
      vec3 q = vBioLocal * uScale + vBioSeed;
      float plates = smoothstep(0.05, 0.12, bioCells(q * 4.0));
      float grainC = bioNoise(q * 9.0);
      diffuseColor.rgb *= mix(0.35, 1.0, plates) * (0.8 + 0.4 * grainC);
      vec3 qm = mod(q, 16.0);
      float nearC = (1.0 - smoothstep(1.0, 10.0, length(vViewPosition))) * (1.0 - smoothstep(0.2, 0.55, length(fwidth(qm * 38.0))));
      float microC = bioNoise(qm * 38.0);
      diffuseColor.rgb *= 1.0 - nearC * (0.5 - microC) * 0.14;
      BIO_BUMP(plates * 0.8 + grainC * 0.15 + microC * 0.06 * nearC, 0.012);
      totalEmissiveRadiance += uGlow * bioVein(q * 6.0) * (1.0 - plates) * 0.8;
    `,
  });
}

/** Veined membrane (wings, frills, jelly bells): thin, back-lit, translucent. */
export function membrane(glow: string = ZONE7.magenta, opacity = 0.55): THREE.MeshStandardMaterial {
  // Body tone is a dim, greyed version of the glow: the membrane reads as tissue first, light second.
  const body = c(glow).lerp(c(ZONE7_SHADE.rockDeep), 0.45).multiplyScalar(0.6);
  const mat = new THREE.MeshStandardMaterial({ color: body, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, roughness: 0.4, emissive: glow });
  return bioSurface(mat, {
    fragment: /* glsl */ `
      float veins = max(bioVein(vBioLocal * 3.0), bioVein(vBioLocal * 7.0 + 3.0) * 0.6);
      float fres = 1.0 - abs(dot(normalize(vBioNormal), normalize(cameraPosition - vBioWorld)));
      float pulse = 0.7 + 0.3 * sin(bioTime * 2.4 + vBioLocal.y * 4.0);
      totalEmissiveRadiance = emissive * (0.12 + veins * 1.0 + fres * 0.6) * pulse;
      diffuseColor.a *= 0.35 + fres * 0.65 + veins * 0.3;
    `,
  });
}

/** Pulsing bioluminescent node or pustule: weak points, loot sources, evolution stage markers. */
export function bioNode(glow: string = ZONE7.lime, rate = 2.2): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: ZONE7_SHADE.flesh, roughness: 0.2, emissive: glow }), {
    uniforms: { uRate: { value: rate } },
    declarations: 'uniform float uRate;\n',
    fragment: /* glsl */ `
      float beat = pow(0.5 + 0.5 * sin(bioTime * uRate + vBioWorld.x + vBioWorld.z), 3.0);
      float fres = 1.0 - abs(dot(normalize(vBioNormal), normalize(cameraPosition - vBioWorld)));
      totalEmissiveRadiance = emissive * (1.2 + beat * 2.5) * (0.6 + 0.4 * (1.0 - fres));
    `,
  });
}

/** Glowing alien gore fluid (violet or green per the Art Bible; red is reserved for the Behemoth line). */
export function goreFluid(glow: string = ZONE7.violet): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: ZONE7_SHADE.rockDeep, roughness: 0.05, clearcoat: 1, emissive: glow });
  return bioSurface(mat, {
    fragment: /* glsl */ `
      float swirl = bioFbm(vBioLocal * 5.0 + vec3(0.0, -bioTime * 0.8, 0.0));
      totalEmissiveRadiance = emissive * (0.8 + swirl * 1.8);
    `,
  });
}

/** Liquid light: the iridescent, flowing luminous fluid of Zone 7 falls and pools. Additive, animated. */
export function liquidLight(opts: { a?: string; b?: string; c?: string; flow?: number; pool?: boolean; fall?: boolean } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    uniforms: {
      bioTime, bioGlow, bioSat, uA: u(opts.a ?? ZONE7.cyan), uB: u(opts.b ?? ZONE7.magenta), uC: u(opts.c ?? ZONE7.lime),
      uFlow: { value: opts.flow ?? 0.6 }, uPool: { value: opts.pool ? 1 : 0 }, uFall: { value: opts.fall ? 1 : 0 },
    },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      uniform float bioTime, bioGlow, bioSat, uFlow, uPool, uFall; uniform vec3 uA, uB, uC; varying vec2 vUv; varying vec3 vW;
      ${GLSL_NOISE}
      void main() {
        vec2 uv = vUv;
        float edge, along;
        vec3 p;
        if (uPool > 0.5) {
          vec2 c = uv - 0.5; float r = length(c) * 2.0;
          edge = (1.0 - smoothstep(0.75, 1.0, r)); along = r;
          p = vec3(c * 6.0, bioTime * 0.25);
          p.xy += vec2(sin(bioTime * 0.3 + r * 6.0), cos(bioTime * 0.27 + r * 5.0)) * 0.4;
        } else {
          edge = smoothstep(0.0, 0.25, uv.x) * (1.0 - smoothstep(0.75, 1.0, uv.x)) * (1.0 - smoothstep(0.7, 1.0, uv.y));
          along = uv.y;
          p = vec3(uv.x * 4.0, uv.y * 14.0 - bioTime * uFlow * 6.0, 0.0);
        }
        float streak = bioFbm(p * vec3(1.0, 0.35, 1.0) + bioFbm(p * 0.7) * 1.5);
        float fine = bioNoise(p * vec3(6.0, 1.0, 1.0) + 3.0);
        float hue = fract(streak * 1.6 + along * 0.8 + bioTime * 0.05);
        vec3 col = mix(uA, uB, smoothstep(0.2, 0.6, hue));
        col = mix(col, uC, smoothstep(0.65, 0.95, hue));
        float caustic = pow(1.0 - abs(bioNoise(p * 2.5 + 7.0) * 2.0 - 1.0), 6.0);
        float a = edge * (0.45 + streak * 0.6 + caustic * 0.4);
        col = col * (0.55 + streak * 0.6) + mix(col, vec3(1.0), 0.4) * caustic * 0.8;
        // Falls dissolve into mist as they drop, and stay saturated (additive white is the enemy).
        if (uFall > 0.5) { a *= pow(1.0 - uv.y, 1.6) * 0.75; col = mix(uA, uB, smoothstep(0.1, 0.8, uv.y + streak * 0.3)) * (0.6 + caustic); }
        col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, bioSat) * (0.4 + bioGlow);
        gl_FragColor = vec4(col * a * 0.9, a);
      }`,
  });
}

/**
 * Living weapon flesh: wet, mottled, veined, with a faked subsurface rim. For viewmodels and
 * close-up hero props. `scale` is detail frequency per local unit: 28 at arm's length, ~6-10 for creature bodies.
 */
export function livingFlesh(base: string, vein: string, rim: string, scale = 28): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.25, sheenColor: c(rim), sheenRoughness: 0.5 });
  return bioSurface(mat, {
    uniforms: { uVein: u(vein), uRim: u(rim), uFleshScale: { value: scale } },
    declarations: 'uniform vec3 uVein, uRim; uniform float uFleshScale;\n',
    fragment: /* glsl */ `
      vec3 p = vBioLocal * uFleshScale + vBioSeed;
      float mott = bioFbm(p * 0.6);
      diffuseColor.rgb *= 0.55 + mott * 0.8;
      float pores = 1.0 - smoothstep(0.05, 0.16, bioCells(p * 1.8));
      diffuseColor.rgb *= 1.0 - pores * 0.45;
      float veins = max(bioVein(p * 0.5), bioVein(p * 1.3 + 4.0) * 0.6);
      // Skin relief: mottled swells, sunken pores, raised veins.
      // Fine skin up close: wrinkles and micro pores so flesh holds up at arm's length.
      vec3 pm = mod(p, 16.0);
      float nearF = (1.0 - smoothstep(1.0, 10.0, length(vViewPosition))) * (1.0 - smoothstep(0.2, 0.55, length(fwidth(pm * 40.0))));
      float wrinkle = bioNoise(pm * vec3(14.0, 40.0, 14.0));
      float micro = 1.0 - smoothstep(0.03, 0.09, bioCells(pm * 9.0));
      diffuseColor.rgb *= 1.0 - nearF * (micro * 0.25 + (0.5 - wrinkle) * 0.1);
      BIO_BUMP(mott * 0.5 - pores * 0.6 + veins * 0.3 + nearF * (wrinkle * 0.12 - micro * 0.15), 0.012);
      float flow = 0.55 + 0.45 * sin(bioTime * 3.0 - dot(vBioLocal, vec3(0.0, 0.0, 40.0)));
      vec3 V = normalize(cameraPosition - vBioWorld);
      float fres = pow(1.0 - abs(dot(normalize(vBioNormal), V)), 2.5);
      totalEmissiveRadiance += uVein * veins * flow * 1.2 + uRim * fres * 0.22;
      roughnessFactor = mix(roughnessFactor, 0.15, pores);
    `,
  });
}

/** Alien eye: wet sclera with red-violet capillaries, radially streaked glowing iris, slit pupil. Local -Z is the gaze. */
export function alienEye(iris: string, sclera: string): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: sclera, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02, emissive: iris });
  return bioSurface(mat, {
    uniforms: { uCap: u(ZONE7.magenta) },
    declarations: 'uniform vec3 uCap;\n',
    fragment: /* glsl */ `
      vec3 n = normalize(vBioLocal);
      float fwd = -n.z;                                   // 1 at the gaze centre
      float ang = atan(n.y, n.x);
      float irisMask = smoothstep(0.72, 0.76, fwd);
      float pupil = smoothstep(0.9, 0.92, fwd) * (1.0 - smoothstep(0.03, 0.06, abs(n.x)));
      float streaks = 0.6 + 0.4 * bioNoise(vec3(ang * 12.0, fwd * 20.0, vBioSeed.x));
      float ring = smoothstep(0.72, 0.78, fwd) * (1.0 - smoothstep(0.78, 0.86, fwd));
      float caps = bioVein(n * 9.0 + vBioSeed) * (1.0 - irisMask) * (1.0 - smoothstep(0.0, 0.75, fwd));
      diffuseColor.rgb = mix(diffuseColor.rgb, uCap * 0.6, caps * 0.7);
      diffuseColor.rgb = mix(diffuseColor.rgb, emissive * 0.3, irisMask);
      diffuseColor.rgb *= 1.0 - pupil;
      float dilate = 0.85 + 0.15 * sin(bioTime * 0.9 + vBioSeed.y);
      totalEmissiveRadiance = emissive * irisMask * (1.0 - pupil) * (streaks * 0.8 + ring * 0.7) * dilate + uCap * caps * 0.25;
    `,
  });
}

/**
 * Grown architecture: carapace and bone plates in relief for structure faces 5 to 20 m across (towers,
 * arena walls, nests). World-space, projected on the face's dominant axis, so plain boxes read as built
 * without UVs. Plates are irregular (Voronoi), each with faint growth rings like a shell; seams are deep,
 * dark and show pale bone; weathering streaks run down the walls. Glow is limited to rare, thin capillaries
 * in the seams (and passes through bioGlow).
 */
export function grownWall(opts: { base?: string; seam?: string; vein?: string; plate?: number } = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: opts.base ?? ZONE7_SHADE.rock, roughness: 0.7, metalness: 0.05, emissive: opts.vein ?? ZONE7.cyan });
  return bioSurface(mat, {
    uniforms: { uBase: u(opts.base ?? ZONE7_SHADE.rock), uSeamCol: u(opts.seam ?? ZONE7_SHADE.rockDeep), uBone: u(HIVE.bone), uPlate: { value: opts.plate ?? 1.6 } },
    declarations: 'uniform vec3 uBase, uSeamCol, uBone; uniform float uPlate;\n',
    fragment: /* glsl */ `
      vec3 an = abs(normalize(vBioNormal));
      vec2 q = an.y > max(an.x, an.z) ? vBioWorld.xz : (an.x > an.z ? vBioWorld.zy : vBioWorld.xy);
      // Plates stretch horizontally a little, like overlapping scutes.
      vec2 g = q / uPlate * vec2(0.8, 1.0);
      vec2 ci = floor(g), cf = fract(g);
      float f1 = 8.0, f2 = 8.0; vec2 best = vec2(0.0);
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 jp = o + vec2(bioHash(vec3(ci + o, 1.0)), bioHash(vec3(ci + o, 2.0))) * 0.85 - cf;
        float d = dot(jp, jp);
        if (d < f1) { f2 = f1; f1 = d; best = ci + o; } else if (d < f2) { f2 = d; }
      }
      float edge = sqrt(f2) - sqrt(f1);
      float id = bioHash(vec3(best, 5.0));
      float seam = 1.0 - smoothstep(0.03, 0.12, edge);
      float bevel = smoothstep(0.04, 0.35, edge);
      float rings = 0.5 + 0.5 * sin(sqrt(f1) * 40.0 + id * 6.0);
      float grain = bioFbm(vec3(q * 2.2, id * 7.0));
      float fine = bioNoise(vec3(q * 11.0, 2.0));
      float streak = bioNoise(vec3(q.x * 5.0, q.y * 0.35, 5.0)) * (1.0 - an.y);
      vec3 plateCol = mix(uBase, mix(uBase, uBone, 0.3), id * 0.6) * (0.6 + grain * 0.6) * (0.92 + fine * 0.16) * (0.93 + rings * 0.07 * bevel);
      plateCol *= 1.0 - streak * 0.3;
      vec3 seamCol = mix(uSeamCol, uBone * 0.35, smoothstep(0.02, 0.07, edge) * 0.6);
      diffuseColor.rgb = mix(seamCol, plateCol, bevel);
      roughnessFactor = mix(0.9, 0.5, bevel * (0.4 + grain * 0.6));
      // Relief: plates dome up from their seams; growth rings and grain add fine bumps.
      float hgt = (bevel * 0.7 + rings * 0.04 * bevel + grain * 0.2 + fine * 0.04) * 0.14;
      vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
      vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
      float det = dot(sx, r1) * (gl_FrontFacing ? 1.0 : -1.0);
      vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
      normal = normalize(abs(det) * normal - grad);
      // Rare capillaries in the seams.
      float cap = seam * bioVein(vec3(q * 0.9, 3.0)) * step(0.7, bioHash(vec3(best, 9.0)));
      totalEmissiveRadiance = emissive * cap * (0.5 + 0.3 * sin(bioTime * 1.2 + id * 6.0));
    `,
  });
}
