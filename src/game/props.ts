import * as THREE from 'three';
import { HIVE, ZONE7 } from '../render/palette';
import { groundHeight, mulberry32 } from '../world/zone7';
import { organic } from './viewmodel';

const C = {
  bone: new THREE.Color(HIVE.bone),
  muscle: new THREE.Color(ZONE7.magenta).multiplyScalar(0.4).lerp(new THREE.Color(HIVE.danger), 0.3),
  stalk: new THREE.Color(ZONE7.violet).multiplyScalar(0.25).lerp(new THREE.Color(ZONE7.magenta), 0.15),
  cyan: new THREE.Color(ZONE7.cyan),
  lime: new THREE.Color(ZONE7.lime),
  acid: new THREE.Color(HIVE.acid),
  violet: new THREE.Color(ZONE7.violet),
  magenta: new THREE.Color(ZONE7.magenta),
  void: new THREE.Color(ZONE7.void),
};
const wet = (color: THREE.Color, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, ...o });
const glow = (c: THREE.Color, i = 2) => new THREE.MeshStandardMaterial({ color: C.void, emissive: c, emissiveIntensity: i });

/** Bio-Pod: a waist-high pulsing cyst of membrane and bone. Hold interact to tear it open. */
export class BioPod {
  readonly root = new THREE.Group();
  opened = false;
  progress = 0;
  private membrane: THREE.Mesh;
  private contents: THREE.Mesh[] = [];
  private coreMat: THREE.MeshStandardMaterial;
  private time = 0;

  constructor(readonly id: string, readonly type: string, x: number, z: number) {
    const rand = mulberry32(Math.round(x * 13 + z * 7));
    this.root.position.set(x, groundHeight(x, z), z);
    // Bone cage.
    const bone = wet(C.bone, { roughness: 0.5, clearcoat: 0.4 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 6, 16, Math.PI * 0.9), bone);
      rib.position.y = 0.55;
      rib.rotation.set(0, a, Math.PI * 0.55);
      this.root.add(rib);
    }
    this.membrane = new THREE.Mesh(organic(new THREE.SphereGeometry(0.58, 32, 22), 0.04, 7, 4), new THREE.MeshPhysicalMaterial({
      color: C.cyan, transparent: true, opacity: 0.45, roughness: 0.05, clearcoat: 1, emissive: C.cyan, emissiveIntensity: 0.3, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.membrane.scale.set(1, 1.2, 1);
    this.membrane.position.y = 0.6;
    this.root.add(this.membrane);
    this.coreMat = glow(C.cyan, 2.5);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08 + rand() * 0.06, 1), i === 0 ? glow(C.lime, 3) : this.coreMat);
      m.position.set((rand() - 0.5) * 0.4, 0.4 + rand() * 0.4, (rand() - 0.5) * 0.4);
      this.root.add(m);
      this.contents.push(m);
    }
    // Rooting tendrils into the ground.
    const root = wet(C.muscle, { roughness: 0.4 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand();
      const pts = [new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(Math.cos(a) * 0.6, 0.15, Math.sin(a) * 0.6), new THREE.Vector3(Math.cos(a) * 1.2, -0.05, Math.sin(a) * 1.2)];
      this.root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.05, 5), root));
    }
  }

  get position(): THREE.Vector3 { return this.root.position; }

  open(): void {
    this.opened = true;
    this.membrane.scale.set(1.1, 0.3, 1.1);
    this.membrane.position.y = 0.2;
    (this.membrane.material as THREE.MeshPhysicalMaterial).opacity = 0.25;
    for (const c of this.contents) c.visible = false;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.opened) return;
    const pulse = 1 + Math.sin(this.time * 2.2) * 0.04 + this.progress * 0.15 + (this.progress > 0 ? Math.sin(this.time * 30) * 0.02 : 0);
    this.membrane.scale.set(pulse, 1.2 * pulse, pulse);
    this.coreMat.emissiveIntensity = 2.2 + Math.sin(this.time * 2.2) * 0.6 + this.progress * 4;
    this.contents.forEach((c, i) => { c.position.y += Math.sin(this.time * 1.5 + i) * 0.0008; c.rotation.y += dt * (0.5 + i * 0.2); });
  }
}

/** Seed Spire: a towering fleshy stalk with a seed capsule at its base. Stand in its zone to extract. */
export class SeedSpire {
  readonly root = new THREE.Group();
  private petals: THREE.Group[] = [];
  private capsule: THREE.Group;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private progressRing: THREE.Mesh;
  private stalkGlow: THREE.MeshStandardMaterial;
  private launched = 0;
  private time = 0;

  constructor(x: number, z: number, readonly radius: number) {
    this.root.position.set(x, groundHeight(x, z), z);
    const stalkMat = wet(C.stalk, { roughness: 0.4 });
    // Twisting stalk of braided tubes.
    for (let b = 0; b < 3; b++) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 14; k++) {
        const h = k * 2.4;
        const a = b * 2.1 + k * 0.45;
        const rr = 0.9 - k * 0.045;
        pts.push(new THREE.Vector3(Math.cos(a) * rr, h + 2.2, Math.sin(a) * rr));
      }
      this.root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.42 - b * 0.06, 8), stalkMat));
    }
    // Glowing veins up the stalk.
    this.stalkGlow = glow(C.lime, 2.5);
    for (let v = 0; v < 4; v++) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 14; k++) {
        const a = v * 1.6 + k * 0.45 + 0.6;
        pts.push(new THREE.Vector3(Math.cos(a) * (1.25 - k * 0.06), k * 2.4 + 2.2, Math.sin(a) * (1.25 - k * 0.06)));
      }
      this.root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.06, 4), this.stalkGlow));
    }
    // Crown bulb at the top.
    const crown = new THREE.Mesh(organic(new THREE.SphereGeometry(1.6, 24, 18), 0.15, 3, 2), glow(C.lime, 1.6));
    crown.position.y = 36;
    this.root.add(crown);

    // Seed capsule with petals at the base.
    this.capsule = new THREE.Group();
    this.capsule.position.y = 0.2;
    const seed = new THREE.Mesh(organic(new THREE.SphereGeometry(0.9, 24, 18), 0.05, 6, 5), glow(C.acid, 2.2));
    seed.scale.set(1, 1.5, 1);
    seed.position.y = 1.3;
    this.capsule.add(seed);
    const petalMat = wet(C.bone, { roughness: 0.45, clearcoat: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const pg = new THREE.Group();
      const a = (i / 6) * Math.PI * 2;
      pg.rotation.y = a;
      const petal = new THREE.Mesh(organic(new THREE.SphereGeometry(1.25, 16, 12, -0.4, 0.8, 0, Math.PI * 0.75), 0.03, 5, i), petalMat);
      petal.position.set(0, 0, 0);
      const hinge = new THREE.Group();
      hinge.position.set(0, 0, 0.25);
      petal.position.y = 1.0;
      petal.position.z = -0.25;
      hinge.add(petal);
      pg.add(hinge);
      this.capsule.add(pg);
      this.petals.push(hinge);
    }
    this.root.add(this.capsule);

    // Extraction zone ring on the ground.
    this.ringMat = new THREE.MeshBasicMaterial({ color: C.lime, transparent: true, opacity: 0.55, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.12, radius, 64), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.12;
    this.root.add(this.ring);
    this.progressRing = new THREE.Mesh(new THREE.RingGeometry(radius - 0.5, radius - 0.2, 64, 1, 0, 0.0001), new THREE.MeshBasicMaterial({ color: C.acid, transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
    this.progressRing.rotation.x = -Math.PI / 2;
    this.progressRing.position.y = 0.14;
    this.root.add(this.progressRing);
  }

  get position(): THREE.Vector3 { return this.root.position; }

  launch(): void { this.launched = 0.0001; }

  update(dt: number, progress: number, inside: boolean): void {
    this.time += dt;
    const open = Math.min(1, progress * 1.6 + (inside ? 0.15 : 0));
    for (const p of this.petals) p.rotation.x = THREE.MathUtils.damp(p.rotation.x, -open * 0.9, 6, dt);
    this.ringMat.opacity = 0.35 + 0.25 * Math.sin(this.time * (inside ? 8 : 2)) ** 2;
    this.stalkGlow.emissiveIntensity = 2 + progress * 5 + Math.sin(this.time * 3 - progress * 10) * 0.5;
    this.progressRing.geometry.dispose();
    this.progressRing.geometry = new THREE.RingGeometry(this.radius - 0.5, this.radius - 0.2, 64, 1, Math.PI / 2, -Math.max(0.0001, progress) * Math.PI * 2);
    if (this.launched > 0) {
      this.launched += dt;
      this.capsule.position.y += dt * (8 + this.launched * 30);
      this.capsule.rotation.y += dt * 4;
    }
  }
}

/** Damaging ground zones: Bile Cantor acid pools and death clouds. */
export interface Hazard { x: number; z: number; radius: number; dps: number; overloadPerSecond: number; life: number; age: number; source: string; mesh: THREE.Object3D }

export class Hazards {
  readonly list: Hazard[] = [];
  constructor(private scene: THREE.Scene) {}

  acidPool(x: number, z: number, radius: number, dps: number, duration: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: C.lime, transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const mesh = new THREE.Mesh(organic(new THREE.CircleGeometry(radius, 28), 0.0, 1, 1), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, groundHeight(x, z) + 0.06, z);
    this.scene.add(mesh);
    this.list.push({ x, z, radius, dps, overloadPerSecond: 0, life: duration, age: 0, source: 'acid', mesh });
  }

  deathCloud(x: number, y: number, z: number, radius: number, dps: number, overloadPerSecond: number, duration: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: C.violet, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(organic(new THREE.SphereGeometry(radius * (0.65 + i * 0.12), 20, 14), radius * 0.08, 1.5, i), mat);
      m.position.set(Math.sin(i * 2) * 0.6, i * 0.3, Math.cos(i * 2) * 0.6);
      g.add(m);
    }
    g.position.set(x, Math.max(y, groundHeight(x, z) + radius * 0.4), z);
    this.scene.add(g);
    this.list.push({ x, z, radius, dps, overloadPerSecond, life: duration, age: 0, source: 'death cloud', mesh: g });
  }

  /** Advances hazards and returns damage/overload per second that apply to the point (x, z). */
  update(dt: number, px: number, pz: number): { dps: number; overloadPerSecond: number; source: string | null } {
    let dps = 0, ops = 0, source: string | null = null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      h.age += dt;
      const k = h.age / h.life;
      if (h.source === 'acid') {
        const m = (h.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = 0.7 * (1 - k) * (0.8 + 0.2 * Math.sin(h.age * 6));
        h.mesh.scale.setScalar(Math.min(1, h.age * 4));
      } else {
        h.mesh.rotation.y += dt * 0.4;
        h.mesh.scale.setScalar(0.4 + Math.min(1, h.age * 2) * 0.6);
        h.mesh.children.forEach((c) => (((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.22 * Math.min(1, h.age * 3) * (1 - k)));
      }
      if (h.age >= h.life) {
        this.scene.remove(h.mesh);
        h.mesh.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
        this.list.splice(i, 1);
        continue;
      }
      if (Math.hypot(px - h.x, pz - h.z) <= h.radius) { dps += h.dps; ops += h.overloadPerSecond; source = h.source; }
    }
    return { dps, overloadPerSecond: ops, source };
  }
}
