import * as THREE from 'three';
import { ZONE7 } from './palette';
import { bioTime } from './materials';

/**
 * Dissolve-mutate: flesh burns away along a noisy, glowing front and new growth knits in behind it.
 * Works on any built-in material (Standard, Physical, Basic, and bio-materials from materials.ts):
 * the patch composes with an existing onBeforeCompile.
 *
 *   const h = dissolvable(creatureRoot, ZONE7.lime);   // patch once
 *   h.amount.value = 0.4;                              // 0 = whole, 1 = gone
 *   mutation.swap(oldRoot, newRoot, { duration: 1.6 }); // old burns out bottom-up, new grows in
 *
 * Materials are patched in place: give each creature its own materials (Abomination already does).
 */

export interface DissolveHandle {
  /** 0 = fully present, 1 = fully dissolved. */
  amount: THREE.IUniform<number>;
  /** Edge glow colour. */
  colour: THREE.IUniform<THREE.Color>;
  /** World-space bounds the growth front travels through (bottom to top). */
  minY: THREE.IUniform<number>;
  maxY: THREE.IUniform<number>;
}

const PATCHED = Symbol('dissolve');

export const DISSOLVE_GLSL = /* glsl */ `
uniform float uDisAmount, uDisMinY, uDisMaxY, bioTime;
uniform vec3 uDisColour;
varying vec3 vDisWorld;
float disHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float disNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(disHash(i), disHash(i + vec3(1,0,0)), f.x), mix(disHash(i + vec3(0,1,0)), disHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(disHash(i + vec3(0,0,1)), disHash(i + vec3(1,0,1)), f.x), mix(disHash(i + vec3(0,1,1)), disHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Threshold field: mostly height (growth climbs the body), broken up by two octaves of noise.
float disField() {
  float h = clamp((vDisWorld.y - uDisMinY) / max(uDisMaxY - uDisMinY, 0.001), 0.0, 1.0);
  float n = disNoise(vDisWorld * 6.0) * 0.6 + disNoise(vDisWorld * 17.0) * 0.4;
  return h * 0.55 + n * 0.45;
}
`;

/** Patch one material. Idempotent. Returns the shared uniforms. */
export function patchDissolve(mat: THREE.Material, u: DissolveHandle): void {
  const m = mat as THREE.Material & { [PATCHED]?: boolean };
  if (m[PATCHED]) return;
  m[PATCHED] = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, { uDisAmount: u.amount, uDisColour: u.colour, uDisMinY: u.minY, uDisMaxY: u.maxY, bioTime });
    shader.vertexShader = 'varying vec3 vDisWorld;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 dw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          dw = instanceMatrix * dw;
        #endif
        vDisWorld = (modelMatrix * dw).xyz;
      }`,
    );
    // bioTime may already be declared by bioSurface; declare ours under a guard.
    const glsl = shader.fragmentShader.includes('uniform float bioTime;') ? DISSOLVE_GLSL.replace(', bioTime;', ';') : DISSOLVE_GLSL;
    shader.fragmentShader = glsl + shader.fragmentShader
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      float disF = disField();
      if (uDisAmount > 0.0 && disF < uDisAmount * 1.08) discard;`)
      .replace('#include <opaque_fragment>', `{
        // A hot rim right at the burn front, a softer bruise-glow just behind it.
        float edge = 1.0 - smoothstep(0.0, 0.045, disF - uDisAmount * 1.08);
        float halo = 1.0 - smoothstep(0.0, 0.16, disF - uDisAmount * 1.08);
        float live = step(0.001, uDisAmount) * step(uDisAmount, 0.999);
        float flick = 0.8 + 0.2 * sin(bioTime * 30.0 + disF * 60.0);
        outgoingLight = mix(outgoingLight, outgoingLight * 0.4 + uDisColour * 0.4, halo * live);
        outgoingLight += uDisColour * edge * live * 6.0 * flick;
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `${prevKey.call(mat)}|dissolve`;
  mat.needsUpdate = true;
}

/** Patch every material under `root` and return a handle driving them all. */
export function dissolvable(root: THREE.Object3D, colour: string = ZONE7.lime): DissolveHandle {
  const box = new THREE.Box3().setFromObject(root);
  const h: DissolveHandle = {
    amount: { value: 0 },
    colour: { value: new THREE.Color(colour) },
    minY: { value: Number.isFinite(box.min.y) ? box.min.y : 0 },
    maxY: { value: Number.isFinite(box.max.y) ? box.max.y : 1 },
  };
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      if (m instanceof THREE.ShaderMaterial) continue; // custom shaders own their fragment
      patchDissolve(m, h);
    }
  });
  return h;
}

interface Job { t0: number; dur: number; step(k: number): void; done?: () => void }
const jobs: Job[] = [];
const ease = (k: number) => k * k * (3 - 2 * k);

export const mutation = {
  /** Burn `root` away over `duration` seconds (death, gibbing, a limb shed by mutation). */
  dissolveOut(root: THREE.Object3D, opts: { duration?: number; colour?: string; done?: () => void } = {}): DissolveHandle {
    const h = dissolvable(root, opts.colour);
    jobs.push({ t0: bioTime.value, dur: opts.duration ?? 1.2, step: (k) => { h.amount.value = ease(k); }, done: opts.done });
    return h;
  },

  /** Grow `root` in from nothing (new limb, carapace, crystal growth). */
  growIn(root: THREE.Object3D, opts: { duration?: number; colour?: string; done?: () => void } = {}): DissolveHandle {
    const h = dissolvable(root, opts.colour);
    h.amount.value = 1;
    jobs.push({ t0: bioTime.value, dur: opts.duration ?? 1.4, step: (k) => { h.amount.value = 1 - ease(k); }, done: opts.done });
    return h;
  },

  /**
   * The signature mutation beat: the old form burns away bottom-up while the new one knits in
   * right behind the front. Both must be in the scene at the same transform. `done` fires once the
   * swap finishes (remove the old form there).
   */
  swap(oldRoot: THREE.Object3D, newRoot: THREE.Object3D, opts: { duration?: number; colour?: string; done?: () => void } = {}): void {
    const dur = opts.duration ?? 1.6;
    const a = dissolvable(oldRoot, opts.colour);
    const b = dissolvable(newRoot, opts.colour);
    b.amount.value = 1;
    jobs.push({
      t0: bioTime.value, dur,
      step: (k) => { a.amount.value = ease(Math.min(1, k * 1.25)); b.amount.value = 1 - ease(Math.max(0, k * 1.25 - 0.25)); },
      done: () => { oldRoot.visible = false; opts.done?.(); },
    });
  },

  /** Advance running transitions. The render pipeline calls this once per frame. */
  update(): void {
    for (let i = jobs.length - 1; i >= 0; i--) {
      const j = jobs[i];
      const k = Math.min(1, (bioTime.value - j.t0) / j.dur);
      j.step(k);
      if (k >= 1) { jobs.splice(i, 1); j.done?.(); }
    }
  },

  get running(): number { return jobs.length; },
};
