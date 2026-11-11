import * as THREE from 'three';

/**
 * Volumetric-looking height fog for every material that uses scene fog. Replaces Three's fog chunks:
 * density falls off exponentially with altitude (analytic integral along the view ray), so valleys,
 * pools and the void under the islands fill with glowing haze while peaks and the sky stay clear.
 * A 3D noise term breaks the haze into banks. Parameters live in `heightFog` and are read once at install.
 */
export const heightFog = {
  /** Altitude of the densest layer (world y). */
  base: { value: -2 },
  /** Height over which density falls by e. */
  falloff: { value: 9 },
  /** Extra density multiplier inside the layer, on top of scene.fog.density. */
  layer: { value: 9 },
  /** Patchiness 0..1. */
  noise: { value: 0.6 },
};

let installed = false;

/** Install once, before the first material compiles. Safe to call repeatedly. */
export function installHeightFog(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    fogW = instanceMatrix * fogW;
  #endif
  vFogWorld = ( modelMatrix * fogW ).xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float hfHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float hfNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hfHash(i), hfHash(i + vec3(1,0,0)), f.x), mix(hfHash(i + vec3(0,1,0)), hfHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hfHash(i + vec3(0,0,1)), hfHash(i + vec3(1,0,1)), f.x), mix(hfHash(i + vec3(0,1,1)), hfHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float camY = cameraPosition.y;
    float dy = vFogWorld.y - camY;
    float k = 1.0 / ${heightFog.falloff.value.toFixed(3)};
    // Integral of exp(-(y-base)k) along the ray, divided by ray length.
    float layerAvg = exp(-(camY - (${heightFog.base.value.toFixed(3)})) * k) * (abs(dy) > 0.01 ? (1.0 - exp(-dy * k)) / (dy * k) : 1.0);
    float banks = mix(1.0, 0.35 + 1.3 * hfNoise(vFogWorld * vec3(0.03, 0.12, 0.03)), ${heightFog.noise.value.toFixed(3)});
    float density = fogDensity * (1.0 + ${heightFog.layer.value.toFixed(3)} * clamp(layerAvg, 0.0, 6.0) * banks);
    float fogFactor = 1.0 - exp( - density * density * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}
