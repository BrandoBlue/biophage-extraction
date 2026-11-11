import * as THREE from 'three';
import { HIVE, ZONE7 } from '../render/palette';
import { mulberry32 } from '../world/zone7';

const C = {
  flesh: new THREE.Color(ZONE7.magenta).lerp(new THREE.Color(HIVE.bone), 0.25).multiplyScalar(0.32),
  fleshDeep: new THREE.Color(ZONE7.violet).lerp(new THREE.Color(ZONE7.magenta), 0.5).multiplyScalar(0.3),
  bone: new THREE.Color(HIVE.bone),
  acid: new THREE.Color(HIVE.acid),
  cyan: new THREE.Color(ZONE7.cyan),
  lime: new THREE.Color(ZONE7.lime),
  void: new THREE.Color(ZONE7.void),
  skin: new THREE.Color(ZONE7.void).lerp(new THREE.Color(ZONE7.violet), 0.25),
};

/** Lumpy organic displacement so nothing reads as a primitive. */
export function organic(geo: THREE.BufferGeometry, amount: number, freq: number, seed: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const s = seed * 1.37;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * freq + s) * Math.cos(v.y * freq * 1.3 + s * 2) * Math.sin(v.z * freq * 0.9 + s * 3)
      + 0.5 * Math.sin(v.x * freq * 2.7 + v.z * freq * 2.1 + s);
    const len = v.length() || 1;
    v.multiplyScalar(1 + (n * amount) / len);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function wet(color: THREE.Color, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: C.fleshDeep, ...o });
}

function glow(color: THREE.Color, intensity = 2.2): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: C.void, emissive: color, emissiveIntensity: intensity, roughness: 0.2 });
}

interface Eye { group: THREE.Group; base: THREE.Euler }
interface Tentacle { root: THREE.Group; segs: THREE.Group[]; phase: number }

/**
 * The Synapse Burster: a living spore gun held by the host. Flesh body, bone ribs, tracking eyes,
 * a translucent spore chamber whose glow shows the magazine, crystal implants and swaying feeder tentacles.
 */
export class SynapseBursterView {
  readonly root = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  private gun = new THREE.Group();
  private eyes: Eye[] = [];
  private tentacles: Tentacle[] = [];
  private chamberCore: THREE.Mesh;
  private chamberMat: THREE.MeshStandardMaterial;
  private egoMat: THREE.MeshStandardMaterial;
  private flash: THREE.Mesh;
  private flashLife = 0;
  private kick = 0;
  private sway = new THREE.Vector2();
  private lastYaw = 0;
  private lastPitch = 0;
  private reloadT = 0;
  private reloadDur = 1;
  private time = 0;

  constructor(camera: THREE.Camera) {
    const rand = mulberry32(42);
    const g = this.gun;

    // Main flesh body: a lathed, lumpy bulb tapering to the muzzle (barrel points down -Z).
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const r = 0.035 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.085 + (t > 0.75 ? (t - 0.75) * 0.12 : 0);
      profile.push(new THREE.Vector2(r, t * 0.62 - 0.31));
    }
    const bodyGeo = organic(new THREE.LatheGeometry(profile, 28), 0.008, 38, 3);
    bodyGeo.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, wet(C.flesh));
    g.add(body);

    // Darker underbelly sac.
    const belly = new THREE.Mesh(organic(new THREE.SphereGeometry(0.075, 24, 16), 0.006, 50, 5), wet(C.fleshDeep, { roughness: 0.3 }));
    belly.scale.set(1, 0.8, 1.9);
    belly.position.set(0, -0.06, 0.03);
    g.add(belly);

    // Bone ribs wrapping the body.
    const boneMat = new THREE.MeshPhysicalMaterial({ color: C.bone, roughness: 0.55, clearcoat: 0.4 });
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.105 - Math.abs(i - 2) * 0.008, 0.009, 6, 20, Math.PI * 1.15), boneMat);
      rib.position.z = -0.12 + i * 0.065;
      rib.rotation.z = Math.PI * -0.075;
      g.add(rib);
    }
    // Dorsal spines.
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07 + rand() * 0.04, 6), boneMat);
      sp.position.set(0, 0.1, -0.15 + i * 0.055);
      sp.rotation.x = -0.6;
      g.add(sp);
    }

    // Spore chamber: membrane sphere with a glowing core (brightness = ammo).
    this.chamberMat = glow(C.acid, 1.5);
    this.chamberCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 2), this.chamberMat);
    const membrane = new THREE.Mesh(organic(new THREE.SphereGeometry(0.07, 24, 16), 0.004, 60, 9), new THREE.MeshPhysicalMaterial({
      color: C.acid, transparent: true, opacity: 0.3, roughness: 0.1, clearcoat: 1, emissive: C.acid, emissiveIntensity: 0.12, depthWrite: false,
    }));
    const chamber = new THREE.Group();
    chamber.add(this.chamberCore, membrane);
    chamber.position.set(0.0, 0.085, 0.09);
    g.add(chamber);

    // Crystal implants.
    this.egoMat = glow(C.cyan, 1.2);
    for (let i = 0; i < 3; i++) {
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.022 + rand() * 0.012, 0), this.egoMat);
      cr.scale.y = 2.2;
      cr.position.set(-0.07 + i * 0.012, 0.07 - i * 0.015, -0.05 + i * 0.045);
      cr.rotation.set(rand(), rand(), 0.6);
      g.add(cr);
    }

    // Tracking eyes along the flank.
    const eyePositions: [number, number, number, number][] = [[0.085, 0.03, -0.02, 0.028], [0.09, -0.02, 0.06, 0.022], [0.07, 0.05, 0.1, 0.018], [-0.08, 0.035, 0.02, 0.02]];
    for (const [x, y, z, r] of eyePositions) {
      const eg = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshPhysicalMaterial({ color: C.bone, roughness: 0.15, clearcoat: 1 }));
      const iris = new THREE.Mesh(new THREE.CircleGeometry(r * 0.62, 20), glow(rand() < 0.5 ? C.lime : C.cyan, 1.6));
      iris.position.z = -r * 0.99;
      iris.rotation.y = Math.PI;
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(r * 0.28, 16), new THREE.MeshBasicMaterial({ color: C.void }));
      pupil.position.z = -r * 1.0;
      pupil.rotation.y = Math.PI;
      const lid = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.28, 8, 20), wet(C.fleshDeep));
      eg.add(ball, iris, pupil);
      const socket = new THREE.Group();
      socket.position.set(x, y, z);
      lid.position.copy(socket.position);
      lid.lookAt(new THREE.Vector3(x * 3, y * 3, z - 0.3));
      socket.add(eg);
      g.add(socket, lid);
      const base = new THREE.Euler(0, x > 0 ? -0.5 : 0.5, 0);
      eg.rotation.copy(base);
      this.eyes.push({ group: eg, base });
    }

    // Feeder tentacles curling off the back and underside.
    const tentMat = wet(C.flesh, { roughness: 0.5 });
    const tipMat = glow(C.lime, 2.5);
    for (let t = 0; t < 5; t++) {
      const root = new THREE.Group();
      root.position.set(-0.06 + rand() * 0.12, -0.02 + rand() * 0.06, 0.2 + rand() * 0.08);
      root.rotation.set(0.8 + rand() * 0.8, (rand() - 0.5) * 2.4, 0);
      const segs: THREE.Group[] = [];
      let parent: THREE.Object3D = root;
      const n = 7;
      for (let i = 0; i < n; i++) {
        const seg = new THREE.Group();
        const len = 0.04 - i * 0.003;
        const rad = 0.012 * (1 - i / (n + 2));
        const m = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.8, rad, len, 7), tentMat);
        m.position.y = len / 2;
        seg.add(m);
        if (i === n - 1) { const tip = new THREE.Mesh(new THREE.SphereGeometry(rad * 1.4, 8, 6), tipMat); tip.position.y = len; seg.add(tip); }
        if (parent !== root) seg.position.y = 0.04 - (i - 1) * 0.003;
        parent.add(seg);
        segs.push(seg);
        parent = seg;
      }
      g.add(root);
      this.tentacles.push({ root, segs, phase: rand() * 6 });
    }

    // Muzzle sphincter with inward teeth.
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.016, 10, 24), wet(C.fleshDeep));
    lip.position.z = -0.31;
    g.add(lip);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.03, 5), boneMat);
      tooth.position.set(Math.cos(a) * 0.04, Math.sin(a) * 0.04, -0.315);
      tooth.rotation.set(0, 0, a - Math.PI / 2);
      tooth.rotateX(-0.9);
      g.add(tooth);
    }
    const throat = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), glow(C.acid, 2.5));
    throat.position.z = -0.305;
    throat.rotation.y = Math.PI;
    g.add(throat);
    this.muzzle.position.set(0, 0, -0.34);
    g.add(this.muzzle);

    this.flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), new THREE.MeshBasicMaterial({ color: C.acid, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    this.flash.position.z = -0.37;
    g.add(this.flash);

    // Alien host hand: dark chitin fingers wrapped under the grip.
    const handMat = wet(C.skin, { roughness: 0.6, clearcoat: 0.6, sheenColor: C.cyan });
    const palm = new THREE.Mesh(organic(new THREE.SphereGeometry(0.05, 16, 12), 0.004, 60, 2), handMat);
    palm.scale.set(1.1, 0.6, 1.5);
    palm.position.set(0.02, -0.11, 0.1);
    g.add(palm);
    for (let i = 0; i < 3; i++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.09, 4, 8), handMat);
      finger.position.set(-0.035 + i * 0.006, -0.065 + i * 0.005, 0.04 + i * 0.04);
      finger.rotation.set(0, 0, 1.25);
      g.add(finger);
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), glow(C.lime, 2));
      node.position.set(0.035, -0.1, 0.05 + i * 0.04);
      g.add(node);
    }
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.05, 0.3, 12), handMat);
    wrist.position.set(0.06, -0.24, 0.24);
    wrist.rotation.set(0.9, 0, -0.3);
    g.add(wrist);

    g.rotation.y = 0.04;
    g.scale.setScalar(0.6);
    this.root.add(g);
    this.root.position.set(0.24, -0.22, -0.42);

    this.root.traverse((o) => { o.frustumCulled = false; });
    camera.add(this.root);
  }

  fired(): void {
    this.kick = Math.min(1.4, this.kick + 0.55);
    this.flashLife = 0.06;
  }

  reload(duration: number): void { this.reloadT = duration; this.reloadDur = duration; }

  /**
   * @param ammoFrac magazine fill, drives chamber glow
   * @param ego 0..1 Ego Charge, drives crystal glow
   * @param look direction to the nearest threat in camera space (eyes track it), or null
   */
  update(dt: number, cam: { yaw: number; pitch: number; speed: number; sprinting: boolean; grounded: boolean }, ammoFrac: number, ego: number, look: THREE.Vector3 | null): void {
    this.time += dt;
    const t = this.time;

    // Sway against camera rotation.
    const dYaw = cam.yaw - this.lastYaw, dPitch = cam.pitch - this.lastPitch;
    this.lastYaw = cam.yaw; this.lastPitch = cam.pitch;
    this.sway.x = THREE.MathUtils.damp(this.sway.x + THREE.MathUtils.clamp(dYaw, -0.1, 0.1) * 0.6, 0, 8, dt);
    this.sway.y = THREE.MathUtils.damp(this.sway.y + THREE.MathUtils.clamp(dPitch, -0.1, 0.1) * 0.6, 0, 8, dt);

    this.kick = THREE.MathUtils.damp(this.kick, 0, 14, dt);
    const bob = cam.grounded ? Math.min(1, cam.speed / 6) : 0;
    const bt = t * (cam.sprinting ? 13 : 9);
    let rx = this.sway.y * 0.6 + this.kick * 0.12 + Math.sin(t * 1.3) * 0.006;
    let ry = this.sway.x * 0.8;
    let rz = 0;
    let px = 0.2 + this.sway.x * 0.05 + Math.cos(bt * 0.5) * 0.012 * bob;
    let py = -0.17 - this.sway.y * 0.05 + Math.abs(Math.sin(bt * 0.5)) * 0.014 * bob + Math.sin(t * 1.3) * 0.004;
    let pz = -0.4 + this.kick * 0.06;
    if (cam.sprinting) { rx -= 0.28; ry += 0.55; px -= 0.04; py -= 0.04; }

    // Reload: tip the gun, chamber deflates then swells.
    let chamberScale = 1;
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      const k = 1 - this.reloadT / this.reloadDur;
      const arc = Math.sin(k * Math.PI);
      rz += arc * 0.7; rx += arc * 0.35; py -= arc * 0.07;
      chamberScale = k < 0.5 ? 1 - k * 1.4 : 0.3 + (k - 0.5) * 1.4;
    }
    this.root.position.set(px, py, pz);
    this.root.rotation.set(rx, ry, rz);

    // Living details.
    const breath = 1 + Math.sin(t * 2.1) * 0.03;
    this.chamberCore.scale.setScalar(chamberScale * breath * (0.6 + 0.4 * ammoFrac));
    this.chamberMat.emissiveIntensity = 0.3 + 1.1 * ammoFrac * (this.reloadT > 0 ? 0.4 : 1) + Math.sin(t * 5) * 0.2;
    this.egoMat.emissiveIntensity = 0.5 + ego * 4 + (ego >= 1 ? Math.sin(t * 12) * 1.5 : 0);
    this.gun.scale.set(1, breath, 1);

    for (let i = 0; i < this.tentacles.length; i++) {
      const tn = this.tentacles[i];
      tn.segs.forEach((s, j) => {
        s.rotation.x = Math.sin(t * 2.3 + tn.phase + j * 0.6) * 0.32 + 0.12;
        s.rotation.z = Math.cos(t * 1.7 + tn.phase + j * 0.5) * 0.25;
      });
    }
    for (const e of this.eyes) {
      if (look) {
        const target = new THREE.Euler(THREE.MathUtils.clamp(look.y * 1.2, -0.7, 0.7), THREE.MathUtils.clamp(-look.x * 1.2, -0.9, 0.9), 0);
        e.group.rotation.x = THREE.MathUtils.damp(e.group.rotation.x, target.x, 10, dt);
        e.group.rotation.y = THREE.MathUtils.damp(e.group.rotation.y, target.y, 10, dt);
      } else {
        e.group.rotation.x = THREE.MathUtils.damp(e.group.rotation.x, e.base.x + Math.sin(t * 0.7 + e.base.y * 9) * 0.3, 3, dt);
        e.group.rotation.y = THREE.MathUtils.damp(e.group.rotation.y, e.base.y + Math.sin(t * 0.43 + e.base.y * 5) * 0.5, 3, dt);
      }
    }

    this.flashLife = Math.max(0, this.flashLife - dt);
    const fm = this.flash.material as THREE.MeshBasicMaterial;
    fm.opacity = this.flashLife > 0 ? 0.9 : 0;
    this.flash.scale.setScalar(this.flashLife > 0 ? 0.8 + Math.random() * 0.6 : 0.001);
  }
}
