/**
 * Weapon bodies on screen. The contract between Gameplay (the camera rig, src/game/weapon-rig.ts, which places,
 * sways, recoils and aims whatever is held) and Creature & Mutation (the living bodies and their reload motion,
 * src/creatures/weapons/).
 *
 * A model only animates inside its own `root`: reloads, breathing, eyes, the charge glow. Creature registers a
 * body per weapons.json id with `registerWeaponView`; any id without one gets the procedural `GenericWeaponModel`
 * below, built from the weapon's class and reload style, so every weapon in the roster is playable on day one.
 */
import * as THREE from 'three';
import type { ReloadStyle, WeaponClass, WeaponSpec } from '../../data';
import { HIVE, ORGANIC, ZONE7 } from '../render/palette';
import { bioNode, chitin, livingFlesh, membrane } from '../render/materials';
import { glowTexture } from '../render/shotfx';
import { mulberry32 } from '../world/zone7';
import { GUN_SCALE, organic } from './viewmodel';

/** Where mod grafts attach on a body (Design's weapon mod slots). */
export type ModSocket = 'barrel' | 'sight' | 'under' | 'chamber';

/** How one shot throws the weapon: up (rad), back toward the eye (m), roll (rad). Scaled by the rig. */
export interface KickProfile { pitch: number; back: number; roll: number }
export const DEFAULT_KICK: KickProfile = { pitch: 0.12, back: 0.06, roll: 0 };

/** What a model is told each frame. */
export interface WeaponFrame {
  /** Magazine fill 0..1. */
  ammoFrac: number;
  /** Aim-down-sights blend 0..1. */
  aim: number;
  /** Ego Charge 0..1 (weapons that have one). */
  ego: number;
  /** Charge weapons: held charge 0..1. */
  charge: number;
  /** A reload is in progress (the rig dips and rolls the weapon toward the host so the reload reads). */
  reloading: boolean;
  /** Direction to the nearest threat in camera space, or null (eyes track it). */
  look: THREE.Vector3 | null;
  /** The living-eye scope overlay is up for this gun (scoped long guns with the setting on): hide the body at full aim. */
  eyeScope?: boolean;
}

export interface WeaponModel {
  /** Everything the model draws. The rig parents it; the model never moves `root` itself. */
  readonly root: THREE.Object3D;
  /** Where rounds leave (world position read each shot). */
  readonly muzzle: THREE.Object3D;
  /** The eye point for aiming down sights: the rig slides the model so this sits on the screen centre. */
  readonly sight?: THREE.Object3D;
  /** Where the host's hand closes: frame at the hand end of the wrist, +Y up the forearm. HostArm mounts here. */
  readonly grip?: THREE.Object3D;
  /** Scoped weapons hide the body at full aim (the HUD draws the scope). */
  readonly scoped?: boolean;
  /** Muzzle flash tint for the rig's shared flash light. */
  readonly flashColour: string;
  /** Visible attachment points for mod grafts. */
  readonly sockets?: Partial<Record<ModSocket, THREE.Object3D>>;
  /** A round left. May return this weapon's kick; the rig uses DEFAULT_KICK otherwise. */
  fired(): KickProfile | void;
  /** A reload started. perShell: `duration` is one shell; `shellIn` follows for each shell fed. */
  reload(style: ReloadStyle, duration: number): void;
  shellIn?(): void;
  /** A reload feel beat (weapon-feel.json): `pose` is Design's description of what the body should be doing. */
  beat?(index: number, pose: string): void;
  /** The weapon is being drawn over `duration` seconds (the rig swings it up; models may add their own motion). */
  equip?(duration: number): void;
  /** The weapon is being put away over `duration` seconds (before the next one is drawn). */
  holster?(duration: number): void;
  update(dt: number, f: WeaponFrame): void;
}

export type WeaponViewFactory = (spec: WeaponSpec) => WeaponModel;
const registry = new Map<string, WeaponViewFactory>();

/** Creature & Mutation registers a body for a weapons.json id. Later registrations replace earlier ones. */
export function registerWeaponView(id: string, factory: WeaponViewFactory): void { registry.set(id, factory); }
export function hasWeaponView(id: string): boolean { return registry.has(id); }

/** The registered body for a weapon, or the procedural stand-in for its class. */
export function createWeaponModel(spec: WeaponSpec): WeaponModel {
  return registry.get(spec.id)?.(spec) ?? new GenericWeaponModel(spec);
}

// ------------------------------------------------------------------ procedural stand-in
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const LOOK_COLOUR: Record<string, string> = { spore: HIVE.acid, needle: ORGANIC.amber, shard: HIVE.bone, glob: ZONE7.lime, bolt: ZONE7.cyan };

/** Body proportions per class: length, girth, barrel count, sac (magazine) size. Metres at GUN_SCALE 1. */
const SHAPE: Record<WeaponClass, { length: number; girth: number; barrels: number; sac: number; eye: boolean }> = {
  carbine: { length: 0.58, girth: 0.085, barrels: 1, sac: 0.065, eye: false },
  sidearm: { length: 0.34, girth: 0.07, barrels: 1, sac: 0.045, eye: false },
  smg: { length: 0.48, girth: 0.08, barrels: 1, sac: 0.06, eye: false },
  rifle: { length: 0.66, girth: 0.085, barrels: 1, sac: 0.065, eye: false },
  shotgun: { length: 0.6, girth: 0.1, barrels: 2, sac: 0.07, eye: false },
  marksman: { length: 0.76, girth: 0.075, barrels: 1, sac: 0.055, eye: true },
  sniper: { length: 0.86, girth: 0.07, barrels: 1, sac: 0.05, eye: true },
  launcher: { length: 0.62, girth: 0.14, barrels: 1, sac: 0.09, eye: false },
  beam: { length: 0.8, girth: 0.07, barrels: 1, sac: 0.06, eye: true },
  relic: { length: 0.66, girth: 0.11, barrels: 3, sac: 0.08, eye: true },
};

let shared: { flesh: THREE.Material; deep: THREE.Material; bone: THREE.Material; hand: THREE.Material; lip: THREE.Material } | null = null;
function mats() {
  // One set for every stand-in, so swapping weapons never compiles new shaders.
  shared ??= {
    flesh: livingFlesh(ORGANIC.wetFlesh, ORGANIC.vein, HIVE.bone, 14),
    deep: livingFlesh(hex(new THREE.Color(ORGANIC.wetFleshDeep).multiplyScalar(1.4)), ORGANIC.vein, ORGANIC.mist),
    bone: chitin(HIVE.bone, ORGANIC.amber, 12),
    hand: chitin(hex(new THREE.Color(ZONE7.void).lerp(new THREE.Color(ZONE7.violet), 0.25).multiplyScalar(2.2)), ZONE7.lime, 14),
    lip: livingFlesh(hex(new THREE.Color(ORGANIC.wetFleshDeep).multiplyScalar(1.5)), ORGANIC.vein, HIVE.bone),
  };
  return shared;
}

/**
 * A procedural living weapon: a lathed flesh body sized by class, bone ribs, a glowing feed sac that shows the
 * magazine, a toothed muzzle and, on sniper and special classes, a sighting eye. Reload motions by style:
 * magazine drops the sac and grows a new one, perShell tips the body and gulps each round, regrow deflates and
 * swells the sac in place.
 */
export class GenericWeaponModel implements WeaponModel {
  readonly root = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  readonly sight = new THREE.Object3D();
  readonly grip = new THREE.Object3D();
  readonly scoped: boolean;
  readonly flashColour: string;
  private body = new THREE.Group();
  private sac: THREE.Group;
  private sacCore: THREE.Mesh;
  private sacMat: THREE.MeshStandardMaterial;
  private chargeMat: THREE.MeshStandardMaterial;
  private flash: THREE.Group;
  private flashLife = 0;
  private reloadStyle: ReloadStyle = 'regrow';
  private reloadT = 0;
  private reloadDur = 1;
  private gulp = 0;
  private time = 0;
  private sacHome = new THREE.Vector3();

  constructor(readonly spec: WeaponSpec) {
    const m = mats();
    const shape = SHAPE[spec.class] ?? SHAPE.rifle;
    const rand = mulberry32([...spec.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 11));
    const glowColour = LOOK_COLOUR[spec.projectile.look] ?? HIVE.acid;
    this.flashColour = glowColour;
    this.scoped = !!spec.ads?.scope;
    const L = shape.length, R = shape.girth;
    const b = this.body;

    // Body: a lumpy lathe, fat at the breech and tapering to the muzzle (barrel along -Z).
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const r = R * 0.35 + Math.sin(Math.pow(t, 0.7 + rand() * 0.02) * Math.PI) * R + (t > 0.8 ? (t - 0.8) * R : 0);
      profile.push(new THREE.Vector2(r, t * L - L / 2));
    }
    const geo = organic(new THREE.LatheGeometry(profile, 24), R * 0.08, 30 + rand() * 20, rand() * 9);
    geo.rotateX(Math.PI / 2);
    b.add(new THREE.Mesh(geo, m.flesh));

    // Barrels: extra flesh tubes for multi-barrel classes.
    for (let k = 0; k < shape.barrels; k++) {
      const off = shape.barrels > 1 ? (k - (shape.barrels - 1) / 2) * R * 0.9 : 0;
      const tube = new THREE.Mesh(organic(new THREE.CylinderGeometry(R * 0.32, R * 0.42, L * 0.45, 12, 4), R * 0.03, 60, k + 3), m.deep);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(off, shape.barrels > 1 ? R * 0.15 : 0, -L * 0.42);
      b.add(tube);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.36, R * 0.11, 8, 18), m.lip);
      lip.position.set(off, tube.position.y, -L * 0.65);
      b.add(lip);
    }

    // Bone ribs and dorsal spines.
    const ribs = Math.round(L / 0.13);
    for (let i = 0; i < ribs; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(R * 1.2, R * 0.1, 6, 18, Math.PI * 1.15), m.bone);
      rib.position.z = -L * 0.3 + (i / Math.max(1, ribs - 1)) * L * 0.55;
      rib.rotation.z = Math.PI * -0.075;
      b.add(rib);
    }
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(R * 0.13, R * (0.7 + rand() * 0.5), 6), m.bone);
      sp.position.set(0, R * 1.15, -L * 0.2 + i * L * 0.12);
      sp.rotation.x = -0.6;
      b.add(sp);
    }

    // Feed sac under the breech: its glowing core shows the magazine.
    this.sacMat = new THREE.MeshStandardMaterial({ color: ZONE7.void, emissive: glowColour, emissiveIntensity: 1.1, roughness: 0.2 });
    this.sacCore = new THREE.Mesh(new THREE.IcosahedronGeometry(shape.sac * 0.6, 2), this.sacMat);
    const skin = new THREE.Mesh(organic(new THREE.SphereGeometry(shape.sac, 20, 14), 0.004, 60, 9), membrane(glowColour, 0.3));
    (skin.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12;
    this.sac = new THREE.Group();
    this.sac.add(this.sacCore, skin);
    this.sac.scale.set(1, 1, spec.class === 'launcher' ? 1.2 : 1.6);
    this.sacHome.set(0, -R * 1.05, L * 0.12);
    this.sac.position.copy(this.sacHome);
    b.add(this.sac);

    // Charge glow in the throat (charge weapons light it while held).
    this.chargeMat = new THREE.MeshStandardMaterial({ color: ZONE7.void, emissive: glowColour, emissiveIntensity: 0.6, roughness: 0.2 });
    const throat = new THREE.Mesh(new THREE.CircleGeometry(R * 0.3, 16), this.chargeMat);
    throat.position.z = -L * 0.645;
    throat.rotation.y = Math.PI;
    b.add(throat);

    // Sighting eye on long guns; otherwise a bone notch on the crown.
    const sightY = R * 2.3;
    if (shape.eye) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(R * 0.45, 20, 14), bioNode(ZONE7.cyan, 0.6));
      eye.scale.z = 2.2;
      eye.position.set(0, R * 1.35, -L * 0.05);
      b.add(eye);
    } else {
      const notch = new THREE.Mesh(new THREE.ConeGeometry(R * 0.12, R * 0.4, 5), m.bone);
      notch.position.set(0, R * 1.3, -L * 0.45);
      b.add(notch);
    }
    this.sight.position.set(0, sightY, L * 0.42);
    b.add(this.sight);

    this.muzzle.position.set(0, shape.barrels > 1 ? R * 0.15 : 0, -L * 0.68);
    b.add(this.muzzle);

    // Muzzle flash sprite (the rig owns the light).
    const add = { blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, transparent: true } as const;
    this.flash = new THREE.Group();
    this.flash.position.copy(this.muzzle.position).z -= 0.03;
    const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(glowColour).lerp(new THREE.Color(1, 1, 1), 0.3).multiplyScalar(1.8), ...add }));
    burst.scale.setScalar(R * 2.6);
    this.flash.add(burst);
    this.flash.visible = false;
    b.add(this.flash);

    // The host's hand under the grip, and the wrist frame HostArm mounts on.
    const palm = new THREE.Mesh(organic(new THREE.SphereGeometry(0.05, 16, 12), 0.004, 60, 2), m.hand);
    palm.scale.set(1.1, 0.6, 1.5);
    palm.position.set(0.02, -R * 1.3, L * 0.18);
    b.add(palm);
    // Same wrist frame as the Synapse Burster's (HostArm was fitted to it): palm + offset, forearm tilt.
    this.grip.position.copy(palm.position).add(new THREE.Vector3(-0.004, -0.219, 0.028));
    this.grip.rotation.set(0.9, 0, -0.3);
    this.grip.scale.setScalar(1.05);
    b.add(this.grip);

    b.rotation.set(-0.12, 0.16, -0.1);
    b.scale.setScalar(GUN_SCALE);
    this.root.add(b);
    this.root.traverse((o) => {
      o.frustumCulled = false;
      const mt = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mt && 'fog' in mt) (mt as THREE.Material & { fog: boolean }).fog = false;
    });
  }

  fired(): void { this.flashLife = 0.06; }

  reload(style: ReloadStyle, duration: number): void {
    // perShell: the first call opens the breech for the whole refill; later shells only gulp.
    if (style === 'perShell' && this.reloadStyle === 'perShell' && this.reloadT > 0) { this.reloadT = this.reloadDur = Math.max(this.reloadT, duration); return; }
    this.reloadStyle = style; this.reloadT = duration; this.reloadDur = duration;
  }

  shellIn(): void { this.gulp = 1; if (this.reloadStyle === 'perShell') this.reloadT = Math.max(this.reloadT, 0.15); }

  update(dt: number, f: WeaponFrame): void {
    this.time += dt;
    const t = this.time;
    let rx = -0.12, ry = 0.16, rz = -0.1;
    let sacScale = 1;
    const sacPos = this.sacHome.clone();
    let sacVisible = true;
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      const k = 1 - this.reloadT / this.reloadDur, arc = Math.sin(k * Math.PI);
      if (this.reloadStyle === 'magazine') {
        // Tip the gun over, the spent sac drops away, a fresh one grows and seats with a squeeze.
        rz += arc * 0.6; rx += arc * 0.25;
        if (k < 0.35) sacPos.y -= (k / 0.35) ** 2 * 0.35;
        else if (k < 0.45) sacVisible = false;
        else { const g = (k - 0.45) / 0.55; sacScale = THREE.MathUtils.smoothstep(g, 0, 0.8) * (1 + Math.sin(g * Math.PI) * 0.25); }
      } else if (this.reloadStyle === 'perShell') {
        // Breech up and to the side for the whole refill; each shell gulps down the throat.
        rz += 0.55; rx += 0.3; ry -= 0.15;
      } else {
        // Regrow: deflate, then swell.
        rz += arc * 0.5; rx += arc * 0.3;
        sacScale = k < 0.5 ? 1 - k * 1.4 : 0.3 + (k - 0.5) * 1.4;
      }
    }
    this.gulp = THREE.MathUtils.damp(this.gulp, 0, 10, dt);
    rx += this.gulp * 0.12;
    const breath = 1 + Math.sin(t * 2.1) * 0.03;
    this.body.rotation.set(rx, ry, rz);
    this.body.scale.set(GUN_SCALE, GUN_SCALE * breath, GUN_SCALE);
    this.sac.visible = sacVisible;
    this.sac.position.copy(sacPos);
    this.sacCore.scale.setScalar(sacScale * breath * (0.6 + 0.4 * f.ammoFrac));
    this.sacMat.emissiveIntensity = 0.2 + 0.6 * f.ammoFrac + Math.sin(t * 5) * 0.2 + this.gulp;
    this.chargeMat.emissiveIntensity = 0.4 + f.charge * 4 + (f.charge >= 1 ? Math.sin(t * 20) * 1.2 : 0);
    this.flashLife = Math.max(0, this.flashLife - dt);
    this.flash.visible = this.flashLife > 0;
    if (this.flash.visible) { this.flash.scale.setScalar(0.8 + Math.random() * 0.5); this.flash.rotation.z = Math.random() * Math.PI; }
  }
}
