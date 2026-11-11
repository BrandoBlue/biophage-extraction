import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { ZONE7 } from './palette';
import { bioTime, GLSL_NOISE } from './materials';

/**
 * Gore FX: glowing alien fluid splats that stick to whatever was hit, and droplet bursts.
 * Art Bible: wet, glossy, anatomical but alien; fluids glow violet or green, red only for the
 * Behemoth line. Everything animates on the GPU from its spawn time and is recycled.
 *
 *   gore.splat(scene, { point, normal, target?, size?, colour? })  // decal on target mesh or flat
 *   gore.burst(scene, { point, normal?, colour?, count? })          // droplet spray
 *
 * Call `gore.update()` once per frame (the render pipeline does this).
 */

const MAX_SPLATS = 64;
const SPLAT_LIFE = 18;
const BURST_LIFE = 1.4;

const splatVertex = /* glsl */ `
  varying vec2 vUv; varying vec3 vW;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const splatFragment = /* glsl */ `
  uniform float bioTime, uBorn, uSeed; uniform vec3 uColour; varying vec2 vUv; varying vec3 vW;
  ${GLSL_NOISE}
  void main() {
    vec2 c = vUv - 0.5;
    float age = bioTime - uBorn;
    float grow = 1.0 - exp(-age * 9.0);                       // splash spreads fast, then settles
    float ang = atan(c.y, c.x);
    float r = length(c) * 2.0 / max(grow, 0.001);
    // Lobed blob with thin radial spatter streaks and satellite drops.
    float lobes = 0.55 + 0.25 * bioNoise(vec3(cos(ang) * 2.0, sin(ang) * 2.0, uSeed)) + 0.12 * bioNoise(vec3(ang * 3.0, uSeed, 1.0));
    float streak = smoothstep(0.7, 1.0, bioNoise(vec3(ang * 9.0, uSeed * 3.0, 0.0))) * 0.35;
    float body = (1.0 - smoothstep(lobes + streak - 0.06, lobes + streak + 0.02, r));
    float drops = (1.0 - smoothstep(0.08, 0.16, bioCells(vec3(c * 9.0, uSeed)))) * step(0.6, r) * step(r, 1.0);
    float mask = max(body, drops);
    if (mask < 0.01) discard;
    float fade = 1.0 - smoothstep(${(SPLAT_LIFE * 0.6).toFixed(1)}, ${SPLAT_LIFE.toFixed(1)}, age);
    float pulse = 0.75 + 0.25 * sin(bioTime * 3.0 + uSeed * 10.0);
    float glow = (1.2 + 2.0 * exp(-age * 1.5)) * pulse;       // hot when fresh, a low throb after
    float sheen = pow(bioNoise(vec3(vW * 3.0)), 4.0) * 2.0;     // wet highlights
    vec3 col = uColour * (glow * (0.5 + 0.5 * (1.0 - r)) + sheen) ;
    gl_FragColor = vec4(col, mask * fade * 0.92);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const burstVertex = /* glsl */ `
  uniform float bioTime, uBorn; uniform vec3 uGravity; attribute vec3 velocity; attribute float seed;
  varying float vA;
  void main() {
    float t = bioTime - uBorn;
    vec3 p = position + velocity * t + 0.5 * uGravity * t * t;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = 1.0 - smoothstep(${(BURST_LIFE * 0.4).toFixed(2)}, ${BURST_LIFE.toFixed(2)}, t + seed * 0.3);
    gl_PointSize = min((1.0 + seed * 2.5) * (30.0 / -mv.z), 18.0) * vA;
  }`;

const burstFragment = /* glsl */ `
  uniform vec3 uColour; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.15, 0.5, d));
    gl_FragColor = vec4(uColour * (0.9 + 1.2 * (1.0 - smoothstep(0.0, 0.25, d))) * a * vA, a * vA);
  }`;

interface Live { obj: THREE.Object3D; born: number; life: number }

const splats: Live[] = [];
const bursts: Live[] = [];

const tmpM = new THREE.Matrix4();

/** A flat splat geometry oriented to the hit normal, offset to avoid z-fighting. */
function flatSplat(point: THREE.Vector3, normal: THREE.Vector3, size: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * Math.PI * 2));
  g.applyMatrix4(tmpM.compose(point.clone().addScaledVector(normal, 0.03), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

export interface SplatOptions {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** Mesh to project onto (creatures, props). Omit for ground/flat hits. */
  target?: THREE.Mesh;
  size?: number;
  colour?: string;
}

export interface BurstOptions {
  point: THREE.Vector3;
  normal?: THREE.Vector3;
  colour?: string;
  count?: number;
  speed?: number;
}

export const gore = {
  splat(scene: THREE.Object3D, o: SplatOptions): THREE.Mesh {
    const size = o.size ?? 1.2;
    let geo: THREE.BufferGeometry;
    if (o.target && !(o.target as THREE.InstancedMesh).isInstancedMesh) {
      const orient = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), o.normal.clone().normalize()));
      orient.z = Math.random() * Math.PI * 2;
      geo = new DecalGeometry(o.target, o.point, orient, new THREE.Vector3(size, size, size));
    } else {
      geo = flatSplat(o.point, o.normal, size);
    }
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
      uniforms: { bioTime, uBorn: { value: bioTime.value }, uSeed: { value: Math.random() * 100 }, uColour: { value: new THREE.Color(o.colour ?? ZONE7.violet) } },
      vertexShader: splatVertex, fragmentShader: splatFragment,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'gore-splat';
    mesh.renderOrder = 2;
    // Decals on a moving creature must follow it: parent to the target, keep world placement.
    if (o.target && geo instanceof DecalGeometry) {
      o.target.updateMatrixWorld();
      mesh.applyMatrix4(tmpM.copy(o.target.matrixWorld).invert());
      o.target.add(mesh);
    } else {
      scene.add(mesh);
    }
    splats.push({ obj: mesh, born: bioTime.value, life: SPLAT_LIFE });
    if (splats.length > MAX_SPLATS) dispose(splats.shift()!);
    return mesh;
  },

  burst(scene: THREE.Object3D, o: BurstOptions): THREE.Points {
    const n = o.count ?? 40;
    const speed = o.speed ?? 6;
    const normal = (o.normal ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), seed = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      pos.set([o.point.x, o.point.y, o.point.z], i * 3);
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().addScaledVector(normal, 1.2).normalize();
      v.multiplyScalar(speed * (0.3 + Math.random() * 0.9));
      vel.set([v.x, v.y, v.z], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(vel, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { bioTime, uBorn: { value: bioTime.value }, uGravity: { value: new THREE.Vector3(0, -14, 0) }, uColour: { value: new THREE.Color(o.colour ?? ZONE7.violet) } },
      vertexShader: burstVertex, fragmentShader: burstFragment,
    }));
    pts.frustumCulled = false;
    pts.name = 'gore-burst';
    scene.add(pts);
    bursts.push({ obj: pts, born: bioTime.value, life: BURST_LIFE + 0.3 });
    return pts;
  },

  /** Remove expired effects. Cheap; call once per frame. */
  update(): void {
    for (const list of [splats, bursts]) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (bioTime.value - list[i].born > list[i].life) dispose(list.splice(i, 1)[0]);
      }
    }
  },

  /** Live effect counts (tests and the look-dev hook). */
  stats(): { splats: number; bursts: number } { return { splats: splats.length, bursts: bursts.length }; },
};

function dispose(l: Live): void {
  l.obj.removeFromParent();
  const m = l.obj as THREE.Mesh;
  m.geometry?.dispose();
  (m.material as THREE.Material)?.dispose();
}
