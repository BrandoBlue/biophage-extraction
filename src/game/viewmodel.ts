import * as THREE from 'three';
import { ARMOURY, HIVE, ORGANIC, ZONE7 } from '../render/palette';
import { alienEye, chitin, livingFlesh } from '../render/materials';
import { glowTexture } from '../render/shotfx';
import type { ReloadStyle } from '../../data';
import type { KickProfile, WeaponFrame, WeaponModel } from './weapon-view';

const hex = (c: THREE.Color) => `#${c.getHexString()}`;


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


/**
 * On-screen size of the gun. The breathing animation used to reset the scale to 1 every frame, so the gun filled a
 * quarter of the screen; it now breathes around this size, leaving room for the host's gripping hand below it.
 */
export const GUN_SCALE = 0.72;

interface Eye { group: THREE.Group; base: THREE.Euler }
interface Plate { mesh: THREE.Mesh; z: number }

/** Smooth surfaces for the starter: a polished shell, a dark carapace, wet tissue only in the seams. */
function polished(color: string, rough: number, coat: number, sheen?: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: coat, clearcoatRoughness: 0.12, sheen: sheen ? 0.35 : 0, sheenColor: new THREE.Color(sheen ?? '#000000') });
}

/** A lathed solid along -Z from `z0` (back) to `z1` (front) with radius r(t), t 0 at the back. Smooth, no lumps. */
function lathe(z0: number, z1: number, r: (t: number) => number, segs = 32, steps = 24): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps; pts.push(new THREE.Vector2(Math.max(0.0005, r(t)), z0 + (z1 - z0) * t)); }
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateX(Math.PI / 2); // lathe Y → Z
  return g;
}

/**
 * The Synapse Burster, the gun every host starts with (redesigned 2026-11-12 after Brandon found the old fleshy bulb
 * "veiny and brown"). A sleek grown carbine: a dark slate carapace spine under three overlapping polished bone
 * plates, a slim bone barrel ringed with soft sea-green nodes, a three-petal muzzle that flares on every shot, and a
 * glass-clear spore chamber in the flank whose glow is the magazine. Living tissue only shows in the seams and the
 * one watchful eye at the back. Every shot kicks hard: plates jolt, petals bloom, the chamber flashes.
 */
export class SynapseBursterView implements WeaponModel {
  readonly root = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  readonly sight = new THREE.Object3D();
  /** Hand end of the wrist, +Y up the forearm: HostArm mounts here. */
  readonly grip = new THREE.Object3D();
  readonly flashColour = ARMOURY.accent;
  readonly muzzleFx = 'spore';
  /** The host's hand and forearm: Creature & Mutation grows the virus mutation on this group. */
  readonly arm = new THREE.Group();
  private gun = new THREE.Group();
  private eye: Eye;
  private plates: Plate[] = [];
  private petals: THREE.Group[] = [];
  private nodes: THREE.MeshStandardMaterial;
  private chamberCore: THREE.Mesh;
  private chamberMat: THREE.MeshStandardMaterial;
  private egoMat: THREE.MeshStandardMaterial;
  private flash: THREE.Group;
  private flashLife = 0;
  /** 1 on a shot, decays: drives the petal bloom, plate jolt and chamber flash. */
  private shot = 0;
  private reloadT = 0;
  private reloadDur = 1;
  private time = 0;

  constructor() {
    const g = this.gun;
    const shell = polished(ARMOURY.shell, 0.32, 0.9, ARMOURY.shellShade);
    const carapace = polished(ARMOURY.carapace, 0.42, 0.7, ARMOURY.carapaceEdge);
    const edge = polished(ARMOURY.carapaceEdge, 0.38, 0.8);
    const tissue = livingFlesh(ARMOURY.tissue, ORGANIC.vein, ARMOURY.shellShade, 22);

    // Spine: one smooth carapace body, full at the chamber, tapering into the barrel and rounding off at the back.
    const spine = lathe(0.26, -0.2, (t) => {
      const k = Math.pow(t, 1.4), body = 0.068 - 0.044 * k * k * (3 - 2 * k);
      const cap = t < 0.14 ? Math.sqrt(1 - ((0.14 - t) / 0.14) ** 2) : 1; // rounded back end
      return body * cap;
    }, 40, 40);
    spine.scale(1, 0.92, 1);
    g.add(new THREE.Mesh(spine, carapace));

    // Two overlapping bone plates over the top: a long shallow wing case and a shorter one over the throat.
    const plateSpecs: [number, number, number][] = [[0.09, 0.17, 0.068], [-0.075, 0.085, 0.05]];
    for (const [z, len, w] of plateSpecs) {
      const geo = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.45);
      const m = new THREE.Mesh(geo, shell);
      m.scale.set(w, w * 0.5, len);
      m.position.set(0, 0.014, z);
      m.rotation.x = -0.1;
      g.add(m);
      this.plates.push({ mesh: m, z });
    }

    // Spore chamber: a clear capsule set into the left flank (the side the host sees), glowing with the magazine.
    this.chamberMat = new THREE.MeshStandardMaterial({ color: ARMOURY.accentDeep, emissive: ARMOURY.accent, emissiveIntensity: 1.2, roughness: 0.25 });
    this.chamberCore = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.1, 8, 16), this.chamberMat);
    this.chamberCore.rotation.x = Math.PI / 2;
    const glass = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.11, 8, 20), new THREE.MeshPhysicalMaterial({ color: ARMOURY.shell, roughness: 0.05, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false }));
    glass.rotation.x = Math.PI / 2;
    const chamber = new THREE.Group();
    chamber.add(this.chamberCore, glass);
    chamber.position.set(-0.066, 0.012, 0.04);
    chamber.rotation.y = 0.04;
    g.add(chamber);
    // Tissue lips holding the capsule: the only flesh on the gun.
    for (const dz of [-0.075, 0.075]) {
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0055, 10, 28), tissue);
      lip.position.set(-0.062, 0.012, 0.04 + dz);
      g.add(lip);
    }

    // Ego Charge: two slim crystal fins behind the plates, dark until charged.
    this.egoMat = new THREE.MeshStandardMaterial({ color: ARMOURY.carapace, emissive: ARMOURY.accent, emissiveIntensity: 0.15, roughness: 0.2, metalness: 0.1 });
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.05, 4), this.egoMat);
      fin.rotation.set(-1.35, 0, side * 0.45);
      fin.position.set(side * 0.022, 0.05, 0.22);
      g.add(fin);
    }

    // Barrel: a slim polished bone tube with dark bands and three soft accent nodes along the top.
    const barrel = lathe(-0.18, -0.4, (t) => 0.024 - t * 0.006, 24, 8);
    g.add(new THREE.Mesh(barrel, shell));
    this.nodes = new THREE.MeshStandardMaterial({ color: ARMOURY.accentDeep, emissive: ARMOURY.accent, emissiveIntensity: 0.8, roughness: 0.3 });
    for (let i = 0; i < 3; i++) {
      const z = -0.22 - i * 0.055;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.0225 - i * 0.0016, 0.0032, 8, 32), edge);
      band.position.z = z;
      g.add(band);
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 12, 10), this.nodes);
      node.position.set(0, 0.024 - i * 0.0015, z - 0.025);
      g.add(node);
    }

    // Muzzle: three carapace petals round the throat. They lie closed and bloom open on each shot.
    const throat = new THREE.Mesh(new THREE.CircleGeometry(0.014, 20), new THREE.MeshBasicMaterial({ color: ARMOURY.accent }));
    throat.position.z = -0.401;
    throat.rotation.y = Math.PI;
    g.add(throat);
    for (let i = 0; i < 3; i++) {
      const hinge = new THREE.Group();
      hinge.position.z = -0.395;
      hinge.rotation.z = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const petalGeo = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI, 0, Math.PI / 2);
      const petal = new THREE.Mesh(petalGeo, carapace);
      petal.scale.set(0.012, 0.022, 0.05);
      petal.position.set(0, 0.016, -0.025);
      petal.rotation.set(0, 0, 0);
      const holder = new THREE.Group();
      holder.add(petal);
      hinge.add(holder);
      g.add(hinge);
      this.petals.push(holder);
    }
    this.muzzle.position.set(0, 0, -0.42);
    g.add(this.muzzle);

    // Underside: a dark grip stub and a small rounded feed gland (tissue), so it reads as grown, not machined.
    const stub = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.07, 6, 14), carapace);
    stub.position.set(0.0, -0.075, 0.12);
    stub.rotation.x = 0.35;
    g.add(stub);
    const gland = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 16), tissue);
    gland.scale.set(0.9, 0.7, 1.5);
    gland.position.set(0, -0.05, -0.04);
    g.add(gland);

    // One watchful eye in the back of the carapace, looking up at the host; it tracks threats.
    const toPlayer = new THREE.Vector3(-0.35, 0.55, 1).normalize();
    const socket = new THREE.Group();
    socket.position.set(-0.052, 0.03, 0.19);
    const eg = new THREE.Group();
    eg.add(new THREE.Mesh(new THREE.SphereGeometry(0.012, 24, 18), alienEye(ARMOURY.accent, HIVE.bone)));
    socket.add(eg);
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0045, 10, 24), edge);
    lid.position.copy(socket.position);
    lid.lookAt(socket.position.clone().add(toPlayer));
    g.add(socket, lid);
    eg.lookAt(socket.position.clone().sub(toPlayer));
    this.eye = { group: eg, base: eg.rotation.clone() };

    // Muzzle burst: a bright core and a short forward flare, tinted to the accent (Rendering adds the spore spray).
    this.flash = new THREE.Group();
    this.flash.position.z = -0.44;
    const add = { blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, transparent: true } as const;
    const tint = new THREE.Color(ARMOURY.accent).lerp(new THREE.Color(HIVE.bone), 0.35);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: tint.clone().multiplyScalar(1.3), ...add }));
    core.scale.setScalar(0.2);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: tint.clone().multiplyScalar(0.9), ...add }));
    flare.scale.set(0.12, 0.12, 1);
    flare.position.z = -0.08;
    this.flash.add(core, flare);
    this.flash.visible = false;
    g.add(this.flash);

    // Alien host hand: dark chitin fingers wrapped under the grip.
    const handMat = chitin(hex(new THREE.Color(ZONE7.void).lerp(new THREE.Color(ZONE7.violet), 0.25).multiplyScalar(2.2)), ZONE7.lime, 14);
    const palm = new THREE.Mesh(organic(new THREE.SphereGeometry(0.05, 16, 12), 0.004, 60, 2), handMat);
    palm.scale.set(1.1, 0.6, 1.5);
    palm.position.set(0.02, -0.11, 0.1);
    this.arm.add(palm);
    for (let i = 0; i < 3; i++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.09, 4, 8), handMat);
      finger.position.set(-0.035 + i * 0.006, -0.065 + i * 0.005, 0.04 + i * 0.04);
      finger.rotation.set(0, 0, 1.25);
      this.arm.add(finger);
    }
    // HostArm (Creature) grows the forearm from here: the hand end of the old wrist, +Y up the forearm.
    this.grip.rotation.set(0.9, 0, -0.3);
    this.grip.position.set(0.06, -0.24, 0.24).addScaledVector(new THREE.Vector3(0, 1, 0).applyEuler(this.grip.rotation), -0.15);
    this.grip.scale.setScalar(1.05);
    this.arm.add(this.grip);
    this.arm.name = 'host-arm';
    g.add(this.arm);

    // Angled so the barrel points at the crosshair and the plates and chamber face the host.
    g.rotation.set(-0.12, 0.16, -0.1);
    g.scale.setScalar(GUN_SCALE);
    // Eye line over the plates, toward the back of the gun: the rig lines it up with the crosshair when aiming.
    this.sight.position.set(0, 0.2, 0.24);
    g.add(this.sight);
    this.root.add(g);

    this.root.traverse((o) => {
      o.frustumCulled = false;
      // Arm's-length geometry never sits in fog.
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'fog' in m) (m as THREE.Material & { fog: boolean }).fog = false;
      // The baked environment is the violet nebula: keep only a hint of it so polished bone does not turn pink.
      // three.js ignores envMapIntensity for scene.environment, so bind the scene's map to these materials directly.
      if (m instanceof THREE.MeshStandardMaterial) {
        m.envMapIntensity = 0.3;
        (o as THREE.Mesh).onBeforeRender = (_r, scene) => {
          if (scene.environment !== m.envMap && scene.environment?.isTexture) { m.envMap = scene.environment as THREE.Texture; m.needsUpdate = true; }
        };
      }
    });
  }

  /** A sharper kick than the default: a carbine that snaps back and climbs, with a little roll. */
  fired(): KickProfile { this.flashLife = 0.07; this.shot = 1; return { pitch: 0.16, back: 0.085, roll: 0.025 }; }

  reload(_style: ReloadStyle, duration: number): void { this.reloadT = duration; this.reloadDur = duration; }

  update(dt: number, f: WeaponFrame): void {
    const { ammoFrac, ego, look } = f;
    this.time += dt;
    const t = this.time;
    let rx = -0.12, ry = 0.16, rz = -0.1;
    this.shot = Math.max(0, this.shot - dt * 9);
    const s = this.shot * this.shot;

    // Reload: roll the gun to show the flank; the chamber drains, the plates lift to let the new charge in, it refills.
    let chamberScale = 1, lift = 0;
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      const k = 1 - this.reloadT / this.reloadDur;
      const arc = Math.sin(k * Math.PI);
      rz += arc * 0.6; rx += arc * 0.3;
      chamberScale = k < 0.5 ? 1 - k * 1.6 : 0.2 + (k - 0.5) * 1.6;
      lift = Math.sin(Math.min(1, k * 1.4) * Math.PI) * 0.25;
    }
    this.gun.rotation.set(rx, ry, rz);

    // Shot: plates jolt back, petals bloom open, the chamber and barrel nodes flash.
    for (const [i, p] of this.plates.entries()) {
      p.mesh.position.z = p.z + s * 0.012 * (i + 1);
      p.mesh.rotation.x = -0.1 - lift * (1 - i * 0.3) - s * 0.08;
    }
    for (const h of this.petals) h.rotation.x = -(0.05 + s * 0.85);
    const breath = 1 + Math.sin(t * 2.1) * 0.025;
    this.chamberCore.scale.setScalar(Math.max(0.05, chamberScale * breath * (0.55 + 0.45 * ammoFrac)));
    this.chamberMat.emissiveIntensity = 0.35 + 1.1 * ammoFrac * (this.reloadT > 0 ? 0.4 : 1) + s * 3 + Math.sin(t * 4) * 0.12;
    this.nodes.emissiveIntensity = 0.6 + s * 4 + Math.sin(t * 3 + 1) * 0.1;
    this.egoMat.emissiveIntensity = 0.15 + ego * 4 + (ego >= 1 ? Math.sin(t * 12) * 1.5 : 0);
    this.gun.scale.setScalar(GUN_SCALE);

    const e = this.eye;
    if (look) {
      e.group.rotation.x = THREE.MathUtils.damp(e.group.rotation.x, e.base.x - THREE.MathUtils.clamp(look.y, -0.6, 0.6), 10, dt);
      e.group.rotation.y = THREE.MathUtils.damp(e.group.rotation.y, e.base.y + THREE.MathUtils.clamp(-look.x, -0.8, 0.8), 10, dt);
    } else {
      e.group.rotation.x = THREE.MathUtils.damp(e.group.rotation.x, e.base.x + Math.sin(t * 0.7) * 0.15, 3, dt);
      e.group.rotation.y = THREE.MathUtils.damp(e.group.rotation.y, e.base.y + Math.sin(t * 0.43) * 0.25, 3, dt);
    }

    this.flashLife = Math.max(0, this.flashLife - dt);
    const on = this.flashLife > 0;
    this.flash.visible = on;
    if (on) { this.flash.scale.setScalar(0.85 + Math.random() * 0.45); this.flash.rotation.z = Math.random() * Math.PI; }
  }
}
