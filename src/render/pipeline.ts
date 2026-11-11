import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { bioTime } from './materials';
import { GRADE_PRESETS, type GradePreset } from './presets';

/**
 * Final grade: chromatic aberration (rises with Neural Overload), split toning, vignette toward the
 * register's shadow colour, damage pulse, film grain. Runs in display space after tone mapping, like a LUT.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uOverload: { value: 0 },
    uHit: { value: 0 },
    uAberration: { value: 0.0015 },
    uVignette: { value: 0.35 },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.08 },
    uGrain: { value: 0.035 },
    uShadow: { value: new THREE.Color() },
    uHighlight: { value: new THREE.Color() },
    uHitColour: { value: new THREE.Color() },
    uSplit: { value: 0.18 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uOverload, uHit, uAberration, uVignette, uSaturation, uContrast, uGrain, uSplit;
    uniform vec3 uShadow, uHighlight, uHitColour; varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float wobble = uOverload * 0.004 * sin(uTime * 9.0 + vUv.y * 30.0);
      vec2 off = c * (uAberration + uOverload * 0.012 + uHit * 0.01) * (0.5 + r2 * 4.0) + vec2(wobble, 0.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      // Split tone: shadows pulled to the register's shadow colour, highlights to its highlight colour.
      col = mix(col, col * 0.6 + uShadow, (1.0 - smoothstep(0.0, 0.35, l)) * uSplit * 2.0);
      col = mix(col, col * uHighlight, smoothstep(0.55, 1.0, l) * uSplit);
      float vig = smoothstep(0.85, 0.15, sqrt(r2) * (1.0 + uVignette));
      col = mix(uShadow * 0.3, col, mix(1.0, vig, uVignette + uOverload * 0.25));
      col = mix(col, uHitColour, uHit * smoothstep(0.1, 0.6, sqrt(r2)) * 0.6);
      col += (h(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export type Quality = 'low' | 'high';

export interface Pipeline {
  renderer: THREE.WebGLRenderer;
  render(dt: number): void;
  setSize(w: number, h: number): void;
  /** 0..1. Drives chromatic aberration, vignette and wobble. */
  setOverload(v: number): void;
  /** Damage flash at screen edges; decays on its own. */
  hitPulse(strength?: number): void;
  setPreset(name: keyof typeof GRADE_PRESETS): void;
  /** When set, render through this camera instead (look-dev captures). */
  overrideCamera: THREE.Camera | null;
  /** Skip post-processing (look-dev comparison of the raw lit frame). */
  bypassPost: boolean;
  readonly preset: GradePreset;
}

/** Headless CI runs SwiftShader; keep it cheap there so frame-counted tests stay fast. */
export function detectQuality(renderer: THREE.WebGLRenderer): Quality {
  // ?quality=high|low overrides detection (look-dev captures use high on SwiftShader).
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'high' || forced === 'low') return forced;
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  return /swiftshader|llvmpipe|software/i.test(name) ? 'low' : 'high';
}

export function createPipeline(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.Camera, presetName: keyof typeof GRADE_PRESETS = 'zone7'): Pipeline {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const quality = detectQuality(renderer);
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0 }));
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1, 0.6, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  /** Bake any procedural sky (userData.bake) into a cubemap once: background plus image-based lighting. */
  let baked = false;
  const bakeSky = () => {
    baked = true;
    const sky = scene.children.find((o) => o.userData.bake);
    if (!sky) return;
    const rt = new THREE.WebGLCubeRenderTarget(quality === 'high' ? 1024 : 128, { type: THREE.HalfFloatType });
    const bakeScene = new THREE.Scene();
    bakeScene.add(sky);
    new THREE.CubeCamera(1, 2000, rt).update(renderer, bakeScene);
    scene.background = rt.texture;
    if (quality === 'low') return; // software rendering: skip PMREM, hemisphere + key lights carry it
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromCubemap(rt.texture).texture;
    scene.environmentIntensity = preset.environment;
    pmrem.dispose();
  };

  let preset: GradePreset = GRADE_PRESETS[presetName];
  let hit = 0;
  let overload = 0;
  const applyPreset = (p: GradePreset) => {
    preset = p;
    renderer.toneMappingExposure = p.exposure;
    scene.environmentIntensity = p.environment;
    bloom.strength = p.bloom.strength; bloom.radius = p.bloom.radius; bloom.threshold = p.bloom.threshold;
    const g = grade.uniforms;
    g.uAberration.value = p.aberration; g.uVignette.value = p.vignette; g.uSaturation.value = p.saturation;
    g.uContrast.value = p.contrast; g.uGrain.value = p.grain; g.uSplit.value = p.split;
    g.uShadow.value.set(p.shadow); g.uHighlight.value.set(p.highlight); g.uHitColour.value.set(p.hit);
  };
  applyPreset(preset);

  const pipeline: Pipeline = {
    renderer,
    overrideCamera: null,
    bypassPost: false,
    get preset() { return preset; },
    render(dt) {
      bioTime.value += dt;
      hit = Math.max(0, hit - dt * 2.5);
      grade.uniforms.uTime.value = bioTime.value;
      grade.uniforms.uHit.value = hit;
      grade.uniforms.uOverload.value = overload;
      if (!baked) bakeSky();
      renderPass.camera = pipeline.overrideCamera ?? camera;
      if (pipeline.bypassPost) renderer.render(scene, renderPass.camera);
      else composer.render(dt);
    },
    setSize(w, h) {
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
    },
    setOverload(v) { overload = THREE.MathUtils.clamp(v, 0, 1); },
    hitPulse(strength = 1) { hit = Math.min(1, hit + strength); },
    setPreset(name) { applyPreset(GRADE_PRESETS[name]); },
  };
  return pipeline;
}
