import * as THREE from 'three';
import { HIVE, ZONE7 } from '../render/palette';
import { mulberry32 } from '../world/zone7';
import { alienEye, bioNode, chitin, livingFlesh, membrane } from '../render/materials';
import { glowTexture } from '../render/shotfx';

const hex = (c: THREE.Color) => `#${c.getHexString()}`;

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
  /** The host's hand and forearm: Creature & Mutation grows the virus mutation on this group. */
  readonly arm = new THREE.Group();
  private gun = new THREE.Group();
  private eyes: Eye[] = [];
  private tentacles: Tentacle[] = [];
  private chamberCore: THREE.Mesh;
  private chamberMat: THREE.MeshStandardMaterial;
  private egoMat: THREE.MeshStandardMaterial;
  private flash: THREE.Group;
  private flashLight: THREE.PointLight;
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
    const fleshMat = livingFlesh(hex(C.flesh.clone().multiplyScalar(1.1)), ZONE7.magenta, ZONE7.magenta);
    const body = new THREE.Mesh(bodyGeo, fleshMat);
    g.add(body);

    // Darker underbelly sac.
    const belly = new THREE.Mesh(organic(new THREE.SphereGeometry(0.075, 24, 16), 0.006, 50, 5), livingFlesh(hex(C.fleshDeep.clone().multiplyScalar(1.5)), ZONE7.violet, ZONE7.violet));
    belly.scale.set(1, 0.8, 1.9);
    belly.position.set(0, -0.06, 0.03);
    g.add(belly);

    // Bone ribs wrapping the body.
    const boneMat = chitin(HIVE.bone, ZONE7.cyan, 12);
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
    const sac = new THREE.Mesh(organic(new THREE.SphereGeometry(0.07, 24, 16), 0.004, 60, 9), membrane(HIVE.acid, 0.3));
    (sac.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
    const chamber = new THREE.Group();
    chamber.add(this.chamberCore, sac);
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

    // Tracking eyes: a cluster on the crown that looks back at the host, two smaller on the flank.
    // Each eye's local -Z is its gaze; the base orientation faces the player's eye.
    const toPlayer = new THREE.Vector3(-0.35, 0.55, 1).normalize();
    const eyePositions: [number, number, number, number][] = [
      [0.0, 0.122, -0.1, 0.036], [0.058, 0.104, -0.16, 0.027], [-0.055, 0.106, -0.14, 0.024], [0.1, 0.035, 0.0, 0.02], [-0.098, 0.03, 0.03, 0.017],
    ];
    const lidMat = livingFlesh(hex(C.fleshDeep.clone().multiplyScalar(1.5)), ZONE7.violet, ZONE7.magenta);
    for (const [k, [x, y, z, r]] of eyePositions.entries()) {
      const eg = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), alienEye(k % 2 ? ZONE7.lime : ZONE7.cyan, HIVE.bone));
      eg.add(ball);
      const socket = new THREE.Group();
      socket.position.set(x, y, z);
      const lid = new THREE.Mesh(new THREE.TorusGeometry(r * 1.0, r * 0.32, 10, 24), lidMat);
      lid.position.copy(socket.position);
      lid.lookAt(socket.position.clone().add(toPlayer));
      socket.add(eg);
      g.add(socket, lid);
      eg.lookAt(socket.position.clone().sub(toPlayer)); // Object3D.lookAt aims +Z, so aim it away to put -Z on the player
      this.eyes.push({ group: eg, base: eg.rotation.clone() });
    }

    // Feeder tentacles curling off the back and underside.
    const tentMat = livingFlesh(hex(C.flesh.clone().multiplyScalar(1.6)), ZONE7.violet, ZONE7.magenta);
    const tipMat = bioNode(ZONE7.lime, 3);
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
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.016, 10, 24), lidMat);
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

    // Muzzle burst: a hot glow, a four-point star and a short beam streak down the barrel line, plus a light
    // that throws acid green over the gun and the ground for a frame. The light always exists (intensity 0 at
    // rest) so firing never changes the light count and never recompiles shaders.
    this.flash = new THREE.Group();
    this.flash.position.z = -0.37;
    const add = { blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, transparent: true } as const;
    const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: C.acid.clone().lerp(new THREE.Color(1, 1, 1), 0.3).multiplyScalar(3), ...add }));
    burst.scale.setScalar(0.22);
    const star = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.05), new THREE.MeshBasicMaterial({ map: glowTexture(), color: C.acid.clone().multiplyScalar(3), side: THREE.DoubleSide, ...add }));
    const star2 = star.clone();
    star2.rotation.z = Math.PI / 2;
    const streak = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 2.2).rotateX(-Math.PI / 2).translate(0, 0, -1.1), new THREE.MeshBasicMaterial({ map: glowTexture(), color: C.acid.clone().multiplyScalar(2.2), side: THREE.DoubleSide, ...add }));
    const streak2 = streak.clone();
    streak2.rotation.z = Math.PI / 2;
    this.flash.add(burst, star, star2, streak, streak2);
    this.flash.visible = false;
    g.add(this.flash);
    this.flashLight = new THREE.PointLight(HIVE.acid, 0, 6, 2);
    this.flashLight.position.z = -0.45;
    g.add(this.flashLight);

    // Alien host hand: dark chitin fingers wrapped under the grip.
    const handMat = chitin(hex(C.skin.clone().multiplyScalar(2.2)), ZONE7.lime, 14);
    const palm = new THREE.Mesh(organic(new THREE.SphereGeometry(0.05, 16, 12), 0.004, 60, 2), handMat);
    palm.scale.set(1.1, 0.6, 1.5);
    palm.position.set(0.02, -0.11, 0.1);
    this.arm.add(palm);
    for (let i = 0; i < 3; i++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.09, 4, 8), handMat);
      finger.position.set(-0.035 + i * 0.006, -0.065 + i * 0.005, 0.04 + i * 0.04);
      finger.rotation.set(0, 0, 1.25);
      this.arm.add(finger);
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), glow(C.lime, 2));
      node.position.set(0.035, -0.1, 0.05 + i * 0.04);
      this.arm.add(node);
    }
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.05, 0.3, 12), handMat);
    wrist.position.set(0.06, -0.24, 0.24);
    wrist.rotation.set(0.9, 0, -0.3);
    this.arm.add(wrist);
    this.arm.name = 'host-arm';
    g.add(this.arm);

    // Angled so the barrel points at the crosshair and the eye crown and flank face the host.
    g.rotation.set(-0.12, 0.16, -0.1);
    g.scale.setScalar(0.55);
    this.root.add(g);
    this.root.position.set(0.24, -0.22, -0.42);

    // A cool key and warm rim that travel with the gun, so its form reads in dark corners of the raid.
    const key = new THREE.PointLight(ZONE7.cyan, 0.25, 1.2, 2);
    key.position.set(-0.25, 0.25, 0.1);
    const rimLight = new THREE.PointLight(ZONE7.magenta, 0.9, 1.0, 2);
    rimLight.position.set(0.3, 0.05, -0.35);
    this.root.add(key, rimLight);

    this.root.traverse((o) => {
      o.frustumCulled = false;
      // Arm's-length geometry never sits in fog.
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'fog' in m) (m as THREE.Material & { fog: boolean }).fog = false;
    });
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
    let px = 0.23 + this.sway.x * 0.05 + Math.cos(bt * 0.5) * 0.012 * bob;
    let py = -0.2 - this.sway.y * 0.05 + Math.abs(Math.sin(bt * 0.5)) * 0.014 * bob + Math.sin(t * 1.3) * 0.004;
    let pz = -0.47 + this.kick * 0.06;
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
    this.chamberMat.emissiveIntensity = 0.2 + 0.6 * ammoFrac * (this.reloadT > 0 ? 0.4 : 1) + Math.sin(t * 5) * 0.2;
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
        // Swivel off the resting gaze toward the threat.
        const tx = e.base.x - THREE.MathUtils.clamp(look.y * 1.0, -0.6, 0.6);
        const ty = e.base.y + THREE.MathUtils.clamp(-look.x * 1.0, -0.8, 0.8);
        e.group.rotation.x = THREE.MathUtils.damp(e.group.rotation.x, tx, 10, dt);
        e.group.rotation.y = THREE.MathUtils.damp(e.group.rotation.y, ty, 10, dt);
      } else {
        e.group.rotation.x = THREE.MathUtils.damp(e.group.rotation.x, e.base.x + Math.sin(t * 0.7 + e.base.y * 9) * 0.15, 3, dt);
        e.group.rotation.y = THREE.MathUtils.damp(e.group.rotation.y, e.base.y + Math.sin(t * 0.43 + e.base.y * 5) * 0.25, 3, dt);
      }
    }

    this.flashLife = Math.max(0, this.flashLife - dt);
    const on = this.flashLife > 0;
    this.flash.visible = on;
    if (on) { this.flash.scale.setScalar(0.8 + Math.random() * 0.5); this.flash.rotation.z = Math.random() * Math.PI; }
    this.flashLight.intensity = on ? 3.5 * (this.flashLife / 0.06) : 0;
  }
}
