import * as THREE from 'three';
import { bioTime } from './materials';

/**
 * Shot effects for living weapons (reference 04's spore beam): a white-hot bolt core, a glowing
 * tracer tail stretched along the flight path, a soft halo, and flash bursts where shots land.
 * Everything is additive and HDR so bloom carries it; no lights are created per shot.
 *
 *   looks.spore = boltLook(HIVE.acid);           // projectile mesh factory (Projectiles pool)
 *   shotFx.flash(scene, point, colour, 0.5);     // impact flash; the pipeline advances it
 */

let glowTex: THREE.DataTexture | null = null;
/** Soft radial falloff, generated once (no canvas or file needed, so it also works in tests). */
export function glowTexture(): THREE.DataTexture {
  if (glowTex) return glowTex;
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
    const r = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - r, 2.2) + Math.pow(Math.max(0, 1 - r * 4), 2) * 0.8;
    const i = (y * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(Math.min(1, a) * 255);
  }
  glowTex = new THREE.DataTexture(data, N, N);
  glowTex.needsUpdate = true;
  return glowTex;
}

/** Additive tracer: brightest at the head (y = 0), thinning and fading toward the tail (y = -1). */
function tracerMaterial(colour: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
    uniforms: { uCol: { value: colour }, bioTime },
    vertexShader: 'varying float vY; varying vec3 vN, vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float bioTime; varying float vY; varying vec3 vN, vV;
      void main() {
        float along = clamp(1.0 + vY, 0.0, 1.0);          // 1 at the head, 0 at the tail end
        float core = pow(abs(dot(vN, vV)), 1.5);
        float shimmer = 0.8 + 0.2 * sin(vY * 40.0 + bioTime * 60.0);
        float a = pow(along, 1.6) * core * shimmer;
        vec3 hot = mix(uCol, vec3(1.0), pow(along, 6.0) * 0.6);
        gl_FragColor = vec4(hot * a * 2.2, a);
      }`,
  });
}

export interface BoltOptions { core?: number; tail?: number; width?: number; halo?: number }

/**
 * Projectile look: returns a factory for pooled meshes oriented with +Y along the velocity
 * (the Projectiles pool sets that). The tail reaches back toward `userData.origin` (set by the pool
 * on fire), so each shot reads as a short-lived beam from the muzzle that detaches as it flies.
 */
export function boltLook(colour: string, o: BoltOptions = {}): () => THREE.Mesh {
  const core = o.core ?? 0.05, tail = o.tail ?? 8, width = o.width ?? 0.055, halo = o.halo ?? 0.55;
  const c = new THREE.Color(colour);
  const coreMat = new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(2.4), toneMapped: false, fog: false });
  const coreGeo = new THREE.SphereGeometry(core, 10, 8).scale(1, 2.4, 1);
  const tailGeo = new THREE.CylinderGeometry(width, width * 0.12, 1, 10, 6, true).translate(0, -0.5, 0);
  const tailMat = tracerMaterial(c.clone().multiplyScalar(0.9));
  const haloMat = new THREE.SpriteMaterial({ map: glowTexture(), color: c.clone().multiplyScalar(1.5), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  return () => {
    const head = new THREE.Mesh(coreGeo, coreMat);
    head.name = 'bolt';
    const trail = new THREE.Mesh(tailGeo, tailMat);
    trail.frustumCulled = false;
    trail.onBeforeRender = (_r, _s, cam) => {
      // Back to where it was fired from (a beam from the muzzle), or toward the viewer if unknown.
      const from = head.userData.origin as THREE.Vector3 | undefined;
      const len = from ? head.position.distanceTo(from) : cam.position.distanceTo(head.position) * 0.55;
      trail.scale.y = THREE.MathUtils.clamp(len, 0.05, tail);
      trail.updateMatrixWorld();
    };
    const glow = new THREE.Sprite(haloMat);
    glow.scale.setScalar(halo);
    head.add(trail, glow);
    return head;
  };
}

interface Flash { sprite: THREE.Sprite; born: number; life: number; size: number }
const flashes: Flash[] = [];
const POOL = 24;
let flashMats: THREE.SpriteMaterial[] = [];

export const shotFx = {
  /** Expanding, fading flash where a shot lands. Pooled; the oldest flash is reused. */
  flash(scene: THREE.Object3D, at: THREE.Vector3, colour: THREE.Color, size = 0.6, life = 0.16): void {
    let f: Flash;
    if (flashes.length < POOL) {
      const mat = new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, transparent: true });
      flashMats.push(mat);
      f = { sprite: new THREE.Sprite(mat), born: 0, life, size };
      f.sprite.name = 'shot-flash';
      flashes.push(f);
    } else {
      f = flashes.reduce((a, b) => (a.born <= b.born ? a : b));
    }
    if (f.sprite.parent !== scene) scene.add(f.sprite);
    f.born = bioTime.value; f.life = life; f.size = size;
    f.sprite.position.copy(at);
    (f.sprite.material as THREE.SpriteMaterial).color.copy(colour).lerp(new THREE.Color(1, 1, 1), 0.25).multiplyScalar(1.8);
    f.sprite.visible = true;
  },

  /** Called once per frame by the render pipeline. */
  update(): void {
    for (const f of flashes) {
      if (!f.sprite.visible) continue;
      const k = (bioTime.value - f.born) / f.life;
      if (k >= 1 || k < 0) { f.sprite.visible = false; continue; }
      f.sprite.scale.setScalar(f.size * (0.4 + Math.sqrt(k) * 1.2));
      (f.sprite.material as THREE.SpriteMaterial).opacity = (1 - k) * (1 - k);
    }
  },

  get live(): number { return flashes.filter((f) => f.sprite.visible).length; },

  /** Test helper: forget pooled flashes. */
  reset(): void { for (const f of flashes) f.sprite.removeFromParent(); flashes.length = 0; flashMats = []; },
};

/**
 * How each living weapon's shots land and leave the muzzle (set per weapon view as `muzzleFx`). Rendering owns the
 * look: particle pool, count, speed, size, drag, gravity and stretch per style, plus the flash size and how far the
 * colour is greyed toward bone (lit material, not neon).
 *   spore: soft glowing puff and fine sparks (Synapse Burster)
 *   quill: few long bone shards that ricochet out
 *   spit:  wet flecks that arc and fall
 *   bile:  heavy droplets and a chunk or two, big splash
 *   beam:  tight bright pinpoint with a few fast sparks
 */
export type ShotStyle = 'spore' | 'quill' | 'spit' | 'bile' | 'beam';
export interface ShotStyleLook {
  pool: 'sparks' | 'droplets' | 'chunks';
  n: number; speed: number; size: [number, number]; life: [number, number];
  drag: number; grav: number; stretch: number;
  /** Impact flash size multiplier (0 = no flash) and how much the particle colour is pulled toward bone. */
  flash: number; bone: number;
}
export const SHOT_STYLES: Record<ShotStyle, ShotStyleLook> = {
  spore: { pool: 'sparks', n: 8, speed: 6, size: [0.05, 0.1], life: [0.25, 0.55], drag: 4, grav: 6, stretch: 0.08, flash: 1, bone: 0 },
  quill: { pool: 'sparks', n: 5, speed: 11, size: [0.03, 0.05], life: [0.3, 0.6], drag: 1.5, grav: 9, stretch: 0.3, flash: 0.45, bone: 0.7 },
  spit: { pool: 'droplets', n: 12, speed: 5, size: [0.03, 0.07], life: [0.5, 0.9], drag: 1.2, grav: 14, stretch: 0.12, flash: 0.5, bone: 0.35 },
  bile: { pool: 'droplets', n: 16, speed: 4.5, size: [0.05, 0.11], life: [0.6, 1.1], drag: 0.8, grav: 16, stretch: 0.14, flash: 0.8, bone: 0.2 },
  beam: { pool: 'sparks', n: 6, speed: 14, size: [0.02, 0.04], life: [0.12, 0.25], drag: 6, grav: 2, stretch: 0.2, flash: 0.7, bone: 0 },
};
export function shotStyle(style: string | undefined): ShotStyleLook {
  return SHOT_STYLES[(style ?? 'spore') as ShotStyle] ?? SHOT_STYLES.spore;
}
