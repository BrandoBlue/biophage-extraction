import * as THREE from 'three';
import { ZONE7, ZONE7_SHADE, HIVE } from './palette';

/**
 * Bio-material library for BIOPHAGE. Every surface is code-generated: procedural GLSL injected into
 * Three's physically based materials, so lights, fog and shadows keep working while the surface gets
 * veins, pulsing nodes, moss and iridescence. Any department may import these.
 */

/** Shared clock for every animated material. `pipeline.render(dt)` advances it. */
export const bioTime = { value: 0 };

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
    shader.fragmentShader = varyings + 'uniform float bioTime;\n' + (opts.declarations ?? '') + GLSL_NOISE + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        ${opts.fragment}
      }`,
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
    },
    declarations: 'uniform vec3 uRock, uDeep, uMoss, uVein, uMossGlow; uniform float uScale;\n',
    fragment: /* glsl */ `
      vec3 p = vBioWorld * 0.18 * uScale;
      float strata = bioFbm(p * vec3(1.0, 3.5, 1.0));
      vec3 rock = mix(uDeep, uRock, smoothstep(0.25, 0.75, strata));
      float up = smoothstep(0.55, 0.9, vBioNormal.y);
      float mossMask = up * smoothstep(0.36, 0.6, bioFbm(p * 1.7 + 4.0));
      // Moss colonies vary from deep teal to a lighter, almost luminous sea-green, with fine grain underfoot.
      float colony = bioNoise(p * 2.3 + 1.7);
      vec3 moss = mix(uMoss * 0.8, uMoss * 2.0 + uVein * 0.05, smoothstep(0.35, 0.85, colony));
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
      diffuseColor.rgb = col;
      roughnessFactor = mix(roughnessFactor, 0.35, mossMask * colony);
      totalEmissiveRadiance += uVein * veinMask * pulse * 0.7 + uMossGlow * specks * 1.2 + uMossGlow * mossMask * 0.02
        + rivCol * riv * pulse * 0.9 + mix(uVein, uMossGlow, colony) * fres * mossMask * 0.12;
      // Edges facing down darken to void; reads as mass hanging in space.
      diffuseColor.rgb *= mix(0.35, 1.0, smoothstep(-0.8, 0.2, vBioNormal.y));
    `,
  });
}

/** Fungus cap: iridescent top with glowing spots, luminous gill underside. Glow colour comes from instance colour or `glow`. */
export function fungusCap(glow: string = ZONE7.cyan): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: ZONE7_SHADE.flesh, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3,
    iridescence: 0.8, iridescenceIOR: 1.5, emissive: glow,
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
      float gills = 0.5 + 0.5 * sin(atan(vBioLocal.z, vBioLocal.x) * 64.0);
      float spots = (1.0 - smoothstep(0.12, 0.3, bioCells(vBioLocal * 5.0 + vBioSeed)));
      float rim = smoothstep(0.75, 1.02, radial) * (1.0 - under);   // luminous lip
      float mottling = bioFbm(vBioLocal * 4.0 + vBioSeed);
      float breathe = 0.8 + 0.2 * sin(bioTime * 1.7 + vBioSeed.x * 3.0);
      diffuseColor.rgb = mix(uFlesh * (0.35 + mottling * 0.5), glowCol * 0.3, under);
      vec3 topGlow = glowCol * (spots * 1.8 + rim * 1.1 + mottling * 0.12);
      vec3 gillGlow = glowCol * (0.6 + 0.9 * gills * smoothstep(0.1, 0.9, radial)) * 1.3;
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
      totalEmissiveRadiance = glowCol * (0.35 + core * 0.9 + tip * 1.2);
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
      diffuseColor.rgb *= mix(0.35, 1.0, plates) * (0.8 + 0.4 * bioNoise(q * 9.0));
      totalEmissiveRadiance += uGlow * bioVein(q * 6.0) * (1.0 - plates) * 0.8;
    `,
  });
}

/** Veined membrane (wings, frills, jelly bells): thin, back-lit, translucent. */
export function membrane(glow: string = ZONE7.magenta, opacity = 0.55): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: glow, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, roughness: 0.4, emissive: glow });
  return bioSurface(mat, {
    fragment: /* glsl */ `
      float veins = max(bioVein(vBioLocal * 3.0), bioVein(vBioLocal * 7.0 + 3.0) * 0.6);
      float fres = 1.0 - abs(dot(normalize(vBioNormal), normalize(cameraPosition - vBioWorld)));
      float pulse = 0.7 + 0.3 * sin(bioTime * 2.4 + vBioLocal.y * 4.0);
      totalEmissiveRadiance = emissive * (0.25 + veins * 1.4 + fres * 1.1) * pulse;
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
      bioTime, uA: u(opts.a ?? ZONE7.cyan), uB: u(opts.b ?? ZONE7.magenta), uC: u(opts.c ?? ZONE7.lime),
      uFlow: { value: opts.flow ?? 0.6 }, uPool: { value: opts.pool ? 1 : 0 }, uFall: { value: opts.fall ? 1 : 0 },
    },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      uniform float bioTime, uFlow, uPool, uFall; uniform vec3 uA, uB, uC; varying vec2 vUv; varying vec3 vW;
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
