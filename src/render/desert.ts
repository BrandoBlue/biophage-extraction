import * as THREE from 'three';
import { OCHRE, ZONE7_SHADE } from './palette';
import { GLSL_NOISE, bioSurface, bioTime } from './materials';

/**
 * Surfaces, sky and moving air for the Ochre Reach (the desert savannah zone). Every surface is procedural relief on
 * Three's lit materials (bioSurface + BIO_BUMP), so huts, sand and rust catch the low sun across cracks, lumps,
 * ripples and corrugation without a single texture file. Natural tones only (Art Bible, "Grounded and eerie").
 */

const u = (hex: string): THREE.IUniform => ({ value: new THREE.Color(hex) });

/**
 * Desert ground: wind ripples and grain on sand, cracked clay pans in the low flats, layered sandstone on slopes
 * (cliffs, butte walls, the gulch). Slope picks the surface, so the same material works on terrain and boulders.
 */
export function desertGround(windDeg = 30): THREE.MeshStandardMaterial {
  const a = (windDeg * Math.PI) / 180;
  return bioSurface(new THREE.MeshStandardMaterial({ color: OCHRE.sand, roughness: 0.95, metalness: 0 }), {
    uniforms: {
      uSand: u(OCHRE.sand), uSandShade: u(OCHRE.sandShade), uDust: u(OCHRE.dust), uClay: u(OCHRE.clay),
      uClayDark: u(OCHRE.clayDark), uBleached: u(OCHRE.bleached), uWind: { value: new THREE.Vector2(Math.cos(a), Math.sin(a)) },
    },
    declarations: 'uniform vec3 uSand, uSandShade, uDust, uClay, uClayDark, uBleached; uniform vec2 uWind;\n',
    fragment: /* glsl */ `
      vec3 n = normalize(vBioNormal);
      float slope = 1.0 - n.y;
      vec2 p = vBioWorld.xz;
      float along = dot(p, uWind);
      float warp = bioNoise(vec3(p * 0.08, 1.0)) * 6.0;
      float rip = sin((along + warp) * 2.6);
      float rip2 = sin((along * 1.7 + warp * 1.3 + bioNoise(vec3(p * 0.3, 2.0)) * 2.0) * 4.1);
      float grain = bioNoise(vec3(p * 9.0, 3.0));
      float big = bioFbm(vec3(p * 0.012, 4.0));
      float mid = bioFbm(vec3(p * 0.07, 5.0));
      vec3 sand = mix(uSandShade, uSand, 0.45 + big * 0.6) * (0.88 + grain * 0.18);
      sand = mix(sand, uDust, smoothstep(0.55, 0.8, mid) * 0.35);
      sand *= 0.93 + 0.07 * rip;
      // Cracked clay pans in the flats: polygon cracks from two scales of veins.
      float pan = smoothstep(0.6, 0.68, bioFbm(vec3(p * 0.02, 8.0))) * (1.0 - smoothstep(0.08, 0.2, slope));
      float crack = max(bioVein(vec3(p * 0.6, 6.0)), bioVein(vec3(p * 1.7, 7.0)) * 0.6);
      vec3 clay = mix(uClay, uBleached, 0.3) * (0.85 + grain * 0.2);
      clay = mix(clay, uClayDark, crack * 0.8);
      // Sandstone strata on slopes, bands wandering a little with height.
      float y = vBioWorld.y + bioNoise(vec3(p * 0.05, 9.0)) * 3.0;
      float strata = sin(y * 2.2) * 0.5 + 0.5;
      float strata2 = sin(y * 7.3 + bioNoise(vec3(p * 0.2, y * 0.1)) * 2.0) * 0.5 + 0.5;
      vec3 stone = mix(uClayDark, uClay, strata * 0.6 + 0.2) * (0.75 + 0.35 * strata2) * (0.85 + grain * 0.2);
      stone = mix(stone, uBleached * 0.7, smoothstep(0.7, 0.9, strata2) * 0.25);
      float rockW = smoothstep(0.3, 0.55, slope + (mid - 0.5) * 0.2);
      diffuseColor.rgb = mix(mix(sand, clay, pan), stone, rockW);
      roughnessFactor = mix(0.97, 0.86, rockW);
      float hgt = (rip * 0.06 + rip2 * 0.02) * (1.0 - rockW) * (1.0 - pan) + grain * 0.015 + strata2 * 0.12 * rockW - crack * 0.05 * pan;
      BIO_BUMP(hgt, 1.0)
    `,
  });
}

/**
 * Hand-built mud: lumpy smoothed clay with straw flecks, lime plaster patches flaking off, a crack network, a
 * damp dark skirt where it meets the ground and run-off streaks. Height-dependent parts read the mesh's local y,
 * so place each building as its own mesh with y 0 at its base.
 */
export function adobe(base: string = OCHRE.clay): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: base, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), {
    uniforms: { uBase: u(base), uPlaster: u(OCHRE.bleached), uDark: u(OCHRE.clayDark), uStraw: u(OCHRE.dust) },
    declarations: 'uniform vec3 uBase, uPlaster, uDark, uStraw;\n',
    fragment: /* glsl */ `
      vec3 q = vBioWorld;
      float lump = bioFbm(q * 0.9 + vBioSeed);
      float fine = bioNoise(q * 6.0 + vBioSeed);
      float straw = smoothstep(0.8, 0.95, bioNoise(vec3(q.x * 19.0, q.y * 4.0, q.z * 19.0)));
      float crack = bioVein(q * 0.7 + vBioSeed * 0.3) * smoothstep(0.45, 0.7, bioNoise(q * 0.35 + vBioSeed));
      float pf = bioFbm(q * 0.35 + vBioSeed * 1.3 + 4.0);
      float plaster = smoothstep(0.6, 0.63, pf);
      float lip = smoothstep(0.57, 0.6, pf) - plaster;
      float skirt = 1.0 - smoothstep(0.0, 1.1, vBioLocal.y + (bioNoise(q * 1.5) - 0.5) * 0.6);
      float streak = smoothstep(0.62, 0.8, bioNoise(vec3(q.x * 4.0, q.y * 0.3, q.z * 4.0) + vBioSeed));
      vec3 mud = uBase * (0.78 + lump * 0.35) * (0.92 + fine * 0.12);
      mud = mix(mud, uStraw, straw * 0.35);
      vec3 col = mix(mud, uPlaster * (0.82 + fine * 0.15 + lump * 0.1), plaster);
      col = mix(col, uDark, crack * 0.75 + lip * 0.4);
      col *= 1.0 - skirt * 0.35;
      col *= 1.0 - streak * 0.22;
      diffuseColor.rgb = col;
      roughnessFactor = mix(0.97, 0.82, plaster);
      float hgt = lump * 0.06 + fine * 0.006 + plaster * 0.012 - crack * 0.02;
      BIO_BUMP(hgt, 1.0)
    `,
  });
}

/** Salvaged sheet metal: corrugation, faded paint, rust blooms that run from the bottom edge, pitting and streaks. */
export function rustMetal(paint: string = OCHRE.skyHigh): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: paint, roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide }), {
    uniforms: { uPaint: u(paint), uRust: u(OCHRE.rust), uRustDark: u(OCHRE.clayDark) },
    declarations: 'uniform vec3 uPaint, uRust, uRustDark;\n',
    fragment: /* glsl */ `
      vec3 q = vBioWorld;
      vec3 an = abs(normalize(vBioNormal));
      float along = an.y > 0.7 ? q.x : (an.x > an.z ? q.z : q.x);
      float corr = sin(along * 8.0);
      float low = 1.0 - smoothstep(0.0, 1.5, vBioLocal.y);
      float rust = smoothstep(0.42, 0.72, bioFbm(q * 0.6 + vBioSeed) + low * 0.2);
      float pit = bioNoise(q * 14.0);
      vec3 col = mix(uPaint * (0.75 + 0.25 * bioNoise(q * 2.0)), mix(uRust, uRustDark, pit), rust);
      float streak = smoothstep(0.6, 0.85, bioNoise(vec3(along * 3.0, q.y * 0.3, 1.0)));
      col = mix(col, uRust * 0.7, streak * 0.4 * (1.0 - rust));
      diffuseColor.rgb = col;
      roughnessFactor = mix(0.55, 0.95, rust);
      metalnessFactor = mix(0.55, 0.1, rust);
      BIO_BUMP(corr * 0.012 + pit * 0.004 * rust, 1.0)
    `,
  });
}

/** Thorn-tree bark: pale grey-brown, deep vertical fissures. `sway` for instanced trees (not for posts and poles). */
export function thornBark(sway = false): THREE.MeshStandardMaterial {
  const m = bioSurface(new THREE.MeshStandardMaterial({ color: OCHRE.thorn, roughness: 0.92 }), {
    uniforms: { uBark: u(OCHRE.thorn), uLight: u(OCHRE.sandShade) },
    declarations: 'uniform vec3 uBark, uLight;\n',
    fragment: /* glsl */ `
      vec3 q = vBioWorld;
      float f = bioVein(vec3(q.x * 2.5, q.y * 0.4, q.z * 2.5) + vBioSeed);
      float g = bioFbm(q * 1.5 + vBioSeed);
      diffuseColor.rgb = mix(mix(uBark, uLight, g * 0.7), uBark * 0.35, f);
      roughnessFactor = 0.93;
      BIO_BUMP(g * 0.03 - f * 0.025, 1.0)
    `,
  });
  return sway ? windSway(m, 0.035) : m;
}

/** Flat-topped canopy of small leathery leaf pads, dry and browned in patches, dark underneath. */
export function leafPads(): THREE.MeshStandardMaterial {
  return windSway(bioSurface(new THREE.MeshStandardMaterial({ color: OCHRE.leaf, roughness: 0.85 }), {
    uniforms: { uLeaf: u(OCHRE.leaf), uDry: u(OCHRE.sandShade) },
    declarations: 'uniform vec3 uLeaf, uDry;\n',
    fragment: /* glsl */ `
      vec3 q = vBioWorld;
      float c = bioCells(q * 2.2 + vBioSeed);
      float g = bioFbm(q * 0.8 + vBioSeed);
      vec3 col = mix(uLeaf * 0.55, uLeaf, smoothstep(0.1, 0.6, c)) * (0.8 + g * 0.4);
      col = mix(col, uDry, smoothstep(0.55, 0.75, g) * 0.6);
      col *= 0.55 + 0.45 * smoothstep(-0.3, 0.6, normalize(vBioNormal).y);
      diffuseColor.rgb = col;
      roughnessFactor = 0.85;
      BIO_BUMP(c * 0.05, 1.0)
    `,
  }), 0.035);
}

/** Ribbed columnar succulent: dusty sage flesh, pale spine tufts along the ribs, a bleached crown. Unit height mesh. */
export function succulentSkin(): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: OCHRE.leaf, roughness: 0.75 }), {
    uniforms: { uLeaf: u(OCHRE.leaf), uDust: u(OCHRE.dust), uBone: u(OCHRE.bleached) },
    declarations: 'uniform vec3 uLeaf, uDust, uBone;\n',
    fragment: /* glsl */ `
      vec3 q = vBioWorld;
      float g = bioFbm(q * 1.2 + vBioSeed);
      float spine = 1.0 - smoothstep(0.05, 0.12, bioCells(q * 7.0 + vBioSeed));
      float crown = smoothstep(0.82, 0.97, vBioLocal.y);
      vec3 col = mix(uLeaf, uDust, 0.3 + g * 0.25) * (0.75 + g * 0.35);
      col = mix(col, uBone, max(spine * 0.7, crown * 0.6));
      diffuseColor.rgb = col;
      roughnessFactor = mix(0.7, 0.9, spine);
      BIO_BUMP(g * 0.02 + spine * 0.01, 1.0)
    `,
  });
}

/** Dry savannah grass: sand-coloured roots to bleached tips (unit-height clumps). */
export function dryGrass(): THREE.MeshStandardMaterial {
  return windSway(bioSurface(new THREE.MeshStandardMaterial({ color: OCHRE.dust, roughness: 0.9, side: THREE.DoubleSide }), {
    uniforms: { uRoot: u(OCHRE.sandShade), uTip: u(OCHRE.bleached), uLeaf: u(OCHRE.leaf) },
    declarations: 'uniform vec3 uRoot, uTip, uLeaf;\n',
    fragment: /* glsl */ `
      float t = clamp(vBioLocal.y, 0.0, 1.0);
      float g = bioNoise(vBioWorld * 0.3);
      vec3 col = mix(uRoot, mix(uTip, uLeaf, g * 0.5), t);
      diffuseColor.rgb = col * (0.85 + bioNoise(vBioWorld * 5.0) * 0.2);
      roughnessFactor = 0.9;
    `,
  }), 0.18, 0);
}

/** Meteoric debris in the Skyfall Crater: dark fused crust, glassy where it cracked open. */
export function skyfallRock(): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: ZONE7_SHADE.rockDeep, roughness: 0.5, metalness: 0.2 }), {
    uniforms: { uCrust: u(ZONE7_SHADE.rock), uDeep: u(ZONE7_SHADE.rockDeep), uRust: u(OCHRE.rust) },
    declarations: 'uniform vec3 uCrust, uDeep, uRust;\n',
    fragment: /* glsl */ `
      vec3 q = vBioWorld;
      float c = bioCells(q * 1.3 + vBioSeed);
      float g = bioFbm(q * 2.0 + vBioSeed);
      float glass = 1.0 - smoothstep(0.1, 0.35, c);
      vec3 col = mix(uCrust * 0.6, uDeep, glass) * (0.7 + g * 0.5);
      col = mix(col, uRust * 0.6, smoothstep(0.6, 0.8, g) * 0.5);
      diffuseColor.rgb = col;
      roughnessFactor = mix(0.85, 0.2, glass);
      BIO_BUMP(g * 0.05 + c * 0.04, 1.0)
    `,
  });
}

/** Woven cloth for awnings and banners (pair with a fluttering mesh). */
export function wovenCloth(colour: string): THREE.MeshStandardMaterial {
  return bioSurface(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95, side: THREE.DoubleSide }), {
    uniforms: { uCol: u(colour), uDark: u(OCHRE.clayDark) },
    declarations: 'uniform vec3 uCol, uDark;\n',
    fragment: /* glsl */ `
      vec3 q = vBioLocal;
      float weave = sin(q.x * 60.0) * sin(q.y * 60.0);
      float fade = bioFbm(vBioWorld * 0.6 + vBioSeed);
      float stain = smoothstep(0.6, 0.8, bioNoise(vBioWorld * 1.3 + vBioSeed));
      diffuseColor.rgb = mix(uCol * (0.75 + fade * 0.4), uDark, stain * 0.4) * (0.95 + weave * 0.05);
      roughnessFactor = 0.95;
      BIO_BUMP(weave * 0.002, 1.0)
    `,
  });
}

/**
 * Wind sway for foliage on top of a bioSurface material: vertices bend downwind by `amount` metres per metre of
 * height above `from`, phase-shifted per instance so a grove never moves in lockstep.
 */
export function windSway<T extends THREE.MeshStandardMaterial>(mat: T, amount: number, from = 1.5): T {
  const prev = mat.onBeforeCompile.bind(mat), key = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    shader.vertexShader = 'uniform float bioTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float ph = 0.0;
        #ifdef USE_INSTANCING
          ph = instanceMatrix[3][0] * 0.11 + instanceMatrix[3][2] * 0.07;
        #endif
        float k = max(0.0, position.y - ${from.toFixed(2)}) * ${amount.toFixed(3)};
        float gust = sin(bioTime * 1.1 + ph) * 0.6 + sin(bioTime * 2.7 + ph * 1.7) * 0.25 + 0.4;
        transformed.x += k * gust;
        transformed.z += k * gust * 0.4;
      }`,
    );
  };
  mat.customProgramCacheKey = () => key() + `sway${amount}${from}`;
  return mat;
}

/**
 * The Ochre Reach sky: dust-hazed amber at the horizon thinning to a dim mauve-grey overhead, three low suns behind
 * the haze (one strong key, two pale companions) and high dust veils. Baked to the environment like the Zone 7 sky.
 */
export function ochreSky(sunDirs: THREE.Vector3[], radius = 900): THREE.Mesh {
  const [s1, s2, s3] = sunDirs.map((d) => d.clone().normalize());
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      bioTime, uHaze: u(OCHRE.skyHaze), uHigh: u(OCHRE.skyHigh), uSun: u(OCHRE.sun), uDust: u(OCHRE.dust), uGround: u(OCHRE.sandShade),
      uS1: { value: s1 }, uS2: { value: s2 ?? s1 }, uS3: { value: s3 ?? s1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float bioTime;
      uniform vec3 uHaze, uHigh, uSun, uDust, uGround, uS1, uS2, uS3;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sky = mix(uHaze, uHigh, smoothstep(0.02, 0.65, h));
        sky = mix(sky, uDust * 0.9, (1.0 - smoothstep(-0.04, 0.22, h)) * 0.55);
        sky = mix(sky, uGround * 0.8, 1.0 - smoothstep(-0.25, 0.0, h));
        // The suns: hazed discs with wide forward scatter in the dust.
        float a1 = max(dot(d, uS1), 0.0), a2 = max(dot(d, uS2), 0.0), a3 = max(dot(d, uS3), 0.0);
        sky += uSun * (pow(a1, 1400.0) * 3.0 + pow(a1, 60.0) * 0.3 + pow(a1, 6.0) * 0.14);
        sky += uSun * (pow(a2, 3000.0) * 1.6 + pow(a2, 120.0) * 0.1);
        sky += uSun * (pow(a3, 5000.0) * 1.1 + pow(a3, 200.0) * 0.06);
        // High dust veils, stretched along the horizon, drifting.
        vec3 q = d * 3.0 + vec3(bioTime * 0.004, 0.0, 0.0);
        float c = bioFbm(vec3(q.x * 1.4, q.y * 7.0, q.z * 1.4));
        sky = mix(sky, uDust * 1.05, smoothstep(0.5, 0.8, c) * smoothstep(0.02, 0.35, h) * 0.3);
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
  mesh.name = 'ochre-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/**
 * A ringed giant seen through daytime dust: sun-lit, low-contrast bands, its disc veiled in the sky's haze so it
 * reads as far away rather than a dark cut-out. Optional ring, also veiled.
 */
export function hazedGiant(radius: number, sunDir: THREE.Vector3, ringNormal: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hazed-giant';
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.ShaderMaterial({
    fog: false, transparent: true, depthWrite: false,
    uniforms: { uBand: u(OCHRE.skyHigh), uLit: u(OCHRE.bleached), uHaze: u(OCHRE.skyHaze), uRust: u(OCHRE.rust), uLight: { value: sunDir.clone().normalize() } },
    vertexShader: 'varying vec3 vN, vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform vec3 uBand, uLit, uHaze, uRust, uLight; varying vec3 vN, vP;
      ${GLSL_NOISE}
      void main() {
        vec3 p = normalize(vP);
        float bands = bioFbm(vec3(p.y * 8.0 + bioFbm(p * 3.0) * 1.6, 2.0, 0.0));
        vec3 surf = mix(uBand, uLit, smoothstep(0.3, 0.8, bands) * 0.6);
        surf = mix(surf, uRust, smoothstep(0.62, 0.8, bioFbm(p * 5.0 + 3.0)) * 0.3);
        float lit = smoothstep(-0.2, 0.7, dot(vN, uLight));
        vec3 c = surf * (0.35 + lit * 0.75);
        c = mix(c, uHaze, 0.45);
        gl_FragColor = vec4(c, 0.85);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  body.renderOrder = -8;
  g.add(body);
  const inner = radius * 1.4, outer = radius * 2.3;
  const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 128, 1), new THREE.ShaderMaterial({
    fog: false, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    uniforms: { uCol: u(OCHRE.bleached), uHaze: u(OCHRE.skyHaze), uIn: { value: inner }, uOut: { value: outer } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform vec3 uCol, uHaze; uniform float uIn, uOut; varying vec3 vP;
      ${GLSL_NOISE}
      void main() {
        float t = (length(vP.xy) - uIn) / (uOut - uIn);
        float bands = bioNoise(vec3(t * 60.0, 0.0, 0.0)) * 0.6 + bioNoise(vec3(t * 13.0, 5.0, 0.0)) * 0.5;
        float a = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.75, 1.0, t)) * bands * 0.45;
        gl_FragColor = vec4(mix(uCol, uHaze, 0.4), a);
      }`,
  }));
  ring.renderOrder = -7;
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ringNormal.clone().normalize());
  g.add(ring);
  return g;
}

/**
 * A dust devil: a spinning funnel of sand grains that wanders along a loop. The spin is on the GPU; the funnel's
 * path is moved in onBeforeRender, so it needs no hook in the raid loop.
 */
export function dustDevil(rand: () => number, path: (t: number) => THREE.Vector3, height = 26, count = 900): THREE.Points {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = Math.pow(rand(), 0.8);
    pos.set([rand() * Math.PI * 2, t * height, 0.3 + t * t * 7 + rand() * 1.2], i * 3);
    seed[i] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), height);
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { bioTime, uCol: u(OCHRE.dust), uH: { value: height } },
    vertexShader: /* glsl */ `
      uniform float bioTime, uH; attribute float seed; varying float vA;
      void main() {
        float ang = position.x + bioTime * (3.5 - position.y / uH * 2.0) * (0.8 + seed * 0.4);
        float r = position.z * (0.9 + 0.1 * sin(bioTime * 3.0 + seed * 20.0));
        vec3 p = vec3(cos(ang) * r, position.y, sin(ang) * r);
        p.x += sin(position.y * 0.25 + bioTime * 1.3) * position.y * 0.06;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = min((2.0 + seed * 4.0) * (120.0 / -mvPosition.z), 9.0);
        // Fades into the haze with distance (no scene fog on points).
        vA = (0.35 - position.y / uH * 0.25) * smoothstep(1.0, 4.0, -mvPosition.z) * (1.0 - smoothstep(120.0, 320.0, -mvPosition.z));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.1, 0.5, d)) * vA;
        gl_FragColor = vec4(uCol, a);
      }`,
  }));
  pts.name = 'dust-devil';
  pts.onBeforeRender = () => { pts.position.copy(path(bioTime.value)); };
  pts.position.copy(path(0));
  return pts;
}
