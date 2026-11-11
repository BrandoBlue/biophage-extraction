import * as THREE from 'three';
import { groundHeight, mulberry32 } from '../world/zone7';
import { HIVE, ZONE7 } from '../render/palette';
import { shotFx } from '../render/shotfx';

/** Colours derived from the Art Bible palette (never raw hex here). */
export const GORE = {
  violetFluid: new THREE.Color(ZONE7.violet).lerp(new THREE.Color(ZONE7.magenta), 0.25),
  limeFluid: new THREE.Color(ZONE7.lime),
  cyanFluid: new THREE.Color(ZONE7.cyan),
  bone: new THREE.Color(HIVE.bone),
  flesh: new THREE.Color(ZONE7.magenta).multiplyScalar(0.35).lerp(new THREE.Color(HIVE.danger), 0.3),
  spore: new THREE.Color(HIVE.acid),
};

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Particle { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; drag: number; grav: number; spin: number; stretch: number }

/**
 * Pooled instanced particles with gravity and ground bounce.
 * `glow` pools use an unlit additive-friendly material so bloom catches them; `solid` pools are lit chunks.
 */
export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, readonly capacity: number, geometry: THREE.BufferGeometry, material: THREE.Material) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.parts.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 0, drag: 0, grav: 0, spin: 0, stretch: 0 });
      this.mesh.setColorAt(i, GORE.spore);
      this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
    }
    scene.add(this.mesh);
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, colour: THREE.Color, size: number, life: number, opts: { drag?: number; grav?: number; stretch?: number } = {}): void {
    const i = this.next; this.next = (this.next + 1) % this.capacity;
    const q = this.parts[i];
    q.p.copy(p); q.v.copy(v); q.life = life; q.max = life; q.size = size;
    q.drag = opts.drag ?? 1.2; q.grav = opts.grav ?? 14; q.stretch = opts.stretch ?? 0; q.spin = Math.random() * 6;
    this.mesh.setColorAt(i, colour);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const q = this.parts[i];
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) { this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      q.v.y -= q.grav * dt;
      q.v.multiplyScalar(Math.exp(-q.drag * dt));
      q.p.addScaledVector(q.v, dt);
      const g = groundHeight(q.p.x, q.p.z) + q.size * 0.5;
      if (q.p.y < g) { q.p.y = g; q.v.y *= -0.25; q.v.x *= 0.5; q.v.z *= 0.5; }
      const fade = Math.min(1, q.life / (q.max * 0.35));
      const s = q.size * fade;
      const speed = q.v.length();
      if (q.stretch > 0 && speed > 0.5) {
        tmpQ.setFromUnitVectors(UP, tmpV.copy(q.v).divideScalar(speed));
        tmpS.set(s, s * (1 + speed * q.stretch), s);
      } else {
        q.spin += dt * 4;
        tmpQ.setFromAxisAngle(UP, q.spin);
        tmpS.setScalar(s);
      }
      this.mesh.setMatrixAt(i, tmpM.compose(q.p, tmpQ, tmpS));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

interface Puddle { mesh: THREE.Mesh; age: number; life: number; grow: number }

/** Gore, impacts, puddles and pulses. Rendering & Tech Art may swap these materials for their shaders. */
export class Fx {
  readonly droplets: ParticlePool;
  readonly chunks: ParticlePool;
  readonly sparks: ParticlePool;
  private puddles: Puddle[] = [];
  private rings: { mesh: THREE.Mesh; age: number; life: number; radius: number }[] = [];
  private rand = mulberry32(99);

  constructor(private scene: THREE.Scene) {
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.droplets = new ParticlePool(scene, 700, new THREE.SphereGeometry(1, 6, 4), glowMat);
    this.sparks = new ParticlePool(scene, 300, new THREE.OctahedronGeometry(1, 0), glowMat.clone());
    const chunkMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15, emissive: GORE.violetFluid, emissiveIntensity: 0.15 });
    this.chunks = new ParticlePool(scene, 160, new THREE.DodecahedronGeometry(1, 0), chunkMat);
  }

  private r(a = 1): number { return (this.rand() * 2 - 1) * a; }

  /** Small burst where a spore lands. */
  impact(at: THREE.Vector3, colour: THREE.Color, n = 8, speed = 6): void {
    shotFx.flash(this.scene, at, colour, 0.35 + n * 0.035);
    for (let i = 0; i < n; i++) {
      tmpV.set(this.r(), this.rand() * 0.8 + 0.2, this.r()).normalize().multiplyScalar(speed * (0.4 + this.rand()));
      this.sparks.spawn(at, tmpV, colour, 0.05 + this.rand() * 0.05, 0.25 + this.rand() * 0.3, { drag: 4, grav: 6, stretch: 0.08 });
    }
  }

  /** Wound spray: glowing fluid leaving a hit along `dir`. */
  bleed(at: THREE.Vector3, dir: THREE.Vector3, colour: THREE.Color, n = 10): void {
    for (let i = 0; i < n; i++) {
      tmpV.copy(dir).multiplyScalar(-2 - this.rand() * 3).add(new THREE.Vector3(this.r(2), this.rand() * 3, this.r(2)));
      this.droplets.spawn(at, tmpV, colour, 0.04 + this.rand() * 0.06, 0.6 + this.rand() * 0.6, { drag: 1, grav: 12, stretch: 0.1 });
    }
  }

  /** Full death burst: fluid fountain, chitin/flesh chunks, ground puddle. */
  burst(at: THREE.Vector3, fluid: THREE.Color, scale = 1): void {
    const n = Math.round(90 * scale);
    for (let i = 0; i < n; i++) {
      tmpV.set(this.r(), this.rand() * 1.4 + 0.3, this.r()).normalize().multiplyScalar((3 + this.rand() * 7) * Math.sqrt(scale));
      this.droplets.spawn(at, tmpV, fluid, (0.05 + this.rand() * 0.11) * scale, 0.9 + this.rand() * 1.4, { drag: 0.8, grav: 13, stretch: 0.07 });
    }
    for (let i = 0; i < Math.round(14 * scale); i++) {
      tmpV.set(this.r(), this.rand() + 0.6, this.r()).normalize().multiplyScalar(4 + this.rand() * 6);
      const c = this.rand() < 0.5 ? GORE.bone : GORE.flesh;
      this.chunks.spawn(at, tmpV, c, (0.08 + this.rand() * 0.16) * scale, 4 + this.rand() * 4, { drag: 0.4, grav: 18 });
    }
    this.ring(at, fluid, 3 * scale, 0.45);
  }

  puddle(x: number, z: number, colour: THREE.Color, radius: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 20), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, groundHeight(x, z) + 0.04, z);
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);
    this.puddles.push({ mesh, age: 0, life: 25, grow: radius * (0.8 + this.rand() * 0.4) });
    if (this.puddles.length > 24) this.dispose(this.puddles.shift()!.mesh);
  }

  /** Expanding shockwave ring (Neural Pulse, death pops). */
  ring(at: THREE.Vector3, colour: THREE.Color, radius: number, life = 0.5): void {
    const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    mesh.position.y = groundHeight(at.x, at.z) + 0.15;
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, radius });
  }

  private dispose(m: THREE.Mesh): void {
    this.scene.remove(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }

  update(dt: number): void {
    this.droplets.update(dt);
    this.chunks.update(dt);
    this.sparks.update(dt);
    for (const p of this.puddles) {
      p.age += dt;
      p.mesh.scale.setScalar(p.grow * Math.min(1, p.age * 1.5) ** 0.5);
      const m = p.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = 0.85 * Math.max(0, 1 - p.age / p.life) * (0.85 + 0.15 * Math.sin(p.age * 3));
    }
    while (this.puddles.length && this.puddles[0].age > this.puddles[0].life) this.dispose(this.puddles.shift()!.mesh);
    for (const r of this.rings) {
      r.age += dt;
      const t = r.age / r.life;
      r.mesh.scale.setScalar(0.2 + r.radius * t);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) if (this.rings[i].age >= this.rings[i].life) { this.dispose(this.rings[i].mesh); this.rings.splice(i, 1); }
  }
}
