import * as THREE from 'three';
import { HIVE, ORGANIC, PATH, ZONE7 } from '../../render/palette';
import { alienEye, bioNode, chitin, livingFlesh, membrane } from '../../render/materials';
import { merge, needleRing, rng, roughen, spike, taperTube, type Rand } from '../parts';

/**
 * Living weapon bodies (Creature & Mutation). Each archetype is a grown organism, never a machine with
 * skin on it: ORGANIC flesh and stained bone, glow only on chambers and eyes (Rendering's rule).
 * Frame: the barrel points down -Z, the host's hand grips at `grip` (wrist frame: +Y runs up the forearm,
 * as HostArm expects), `muzzle` is where the shot leaves, `sight` (scoped weapons) is the eye point.
 * Sizes are in metres before the viewmodel's GUN_SCALE.
 *
 * `animate(dt, s)` plays the weapon's own life: idle breathing, the fire twitch, its reload (each archetype
 * has its own: a gland regrows, a drum pod drops and regrows, a bone clip is pulled and pushed, a maw gulps
 * shells one by one, an egg is swallowed into the mortar) and its aim pose.
 */

/** Design's roster ids (data/weapons.json) that have a grown body here; the rest use Gameplay's generic view. */
export type WeaponId = 'quillet' | 'hiveSpitter' | 'vertebraRifle' | 'gulletScatter' | 'eyestalkMarksman' | 'broodMortar';
export const WEAPON_BODIES: WeaponId[] = ['quillet', 'hiveSpitter', 'vertebraRifle', 'gulletScatter', 'eyestalkMarksman', 'broodMortar'];
export type ReloadStyle = 'magazine' | 'perShell' | 'regrow';

export interface WeaponPose {
  /** Reload progress 0..1, or null when not reloading. */
  reload: number | null;
  style?: ReloadStyle;
  /** Aim down sights, 0..1. */
  aim: number;
  /** Seconds since the last shot (large when idle). */
  sinceFire: number;
  /** Magazine fill 0..1 (chamber glow). */
  ammo: number;
  /** perShell: count of shells fed so far this reload. */
  shells?: number;
  /** Draw progress 0..1 while the weapon is being equipped (the organism wakes); omit or 1 when drawn. */
  equip?: number;
  /** Put-away progress 0..1 while the weapon is holstered (it curls up and dims); omit or 0 when held. */
  holster?: number;
}

/** Where a living graft (a weapon mod) grows on the body. */
export type ModSlot = 'barrel' | 'sight' | 'under' | 'chamber';
export const MOD_SLOTS: ModSlot[] = ['barrel', 'sight', 'under', 'chamber'];

/**
 * The model's own flinch per shot (animation, not balance): metres back, radians of muzzle climb and roll.
 * Rendering's camera recoil can scale by these so a mortar thumps and a sidearm snaps.
 */
export type MuzzleFx = 'spore' | 'quill' | 'spit' | 'bile' | 'beam';

export interface Kick { back: number; pitch: number; roll: number }

export interface WeaponBody {
  readonly id: WeaponId;
  /** Root to place in the scene; never moved by animate(). */
  readonly gun: THREE.Group;
  /** The animated body under the root (recoil, draw, reload sway). */
  readonly flex: THREE.Group;
  readonly muzzle: THREE.Object3D;
  readonly grip: THREE.Object3D;
  readonly sight?: THREE.Object3D;
  /** Default reload style for this body. */
  readonly reloadStyle: ReloadStyle;
  /** Whether the weapon zooms when aimed. */
  readonly zooms: boolean;
  /** Rendering's muzzle and impact style for this weapon (shotfx). */
  readonly muzzleFx: MuzzleFx;
  /** Tint for those effects, from the palette. */
  readonly fxColour: string;
  /** Per-shot flinch of the model; see Kick. */
  readonly kick: Kick;
  /** Mod attach points: a graft grows here and stays visible. */
  readonly sockets: Record<ModSlot, THREE.Object3D>;
  /** Grow (or shed) the living graft for a mod slot. */
  graft(slot: ModSlot, on?: boolean): void;
  /** Slots that currently carry a graft. */
  readonly grafts: ModSlot[];
  animate(dt: number, s: WeaponPose): void;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));
const smooth = (t: number) => { const k = THREE.MathUtils.clamp(t, 0, 1); return k * k * (3 - 2 * k); };
/** 0 → 1 → 0 bump over [a, b]. */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));

type Pose = WeaponPose & { equip: number };

interface Mats { flesh: THREE.MeshPhysicalMaterial; fleshDeep: THREE.MeshPhysicalMaterial; bone: THREE.MeshPhysicalMaterial; boneDark: THREE.MeshPhysicalMaterial; sac: THREE.MeshStandardMaterial; core: THREE.MeshStandardMaterial }

function materials(glow: string): Mats {
  return {
    flesh: livingFlesh(mix(ORGANIC.wetFlesh, ORGANIC.wetFleshDeep, 0.45), ORGANIC.vein, ORGANIC.mist, 14),
    fleshDeep: livingFlesh(mix(ORGANIC.wetFleshDeep, HIVE.background, 0.25), ORGANIC.vein, ORGANIC.mist, 18),
    bone: chitin(mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.35), ORGANIC.amber, 12),
    boneDark: chitin(mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.65), ORGANIC.amber, 16),
    sac: membrane(mix(glow, ORGANIC.mist, 0.5), 0.35),
    core: bioNode(glow, 2.4),
  };
}

/** A lathed, lumpy flesh body along -Z: radius profile r(t) for t 0 (back) .. 1 (front). */
function lathe(len: number, r: (t: number) => number, seed: number, segs = 22): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 18; i++) { const t = i / 18; pts.push(new THREE.Vector2(Math.max(0.002, r(t)), t * len)); }
  const g = new THREE.LatheGeometry(pts, segs);
  g.deleteAttribute('uv');
  g.rotateX(-Math.PI / 2); // +Y (profile axis) → -Z
  return roughen(g, len * 0.008, 30 / len, seed);
}

/** Bone grip curving down and back from the body; the wrist frame sits at its base. */
function gripBone(at: THREE.Vector3, len: number, rand: Rand): THREE.BufferGeometry {
  const pts = [at.clone(), at.clone().add(V(0, -len * 0.45, len * 0.12)), at.clone().add(V(0, -len, len * 0.3))];
  const parts = [taperTube(pts, [0.024, 0.022, 0.02], 9, 4)];
  const c = new THREE.CatmullRomCurve3(pts);
  for (let i = 0; i < 4; i++) {
    // Finger ridges on the front of the grip and sinew bands round it.
    const t = 0.2 + i * 0.2, p = c.getPointAt(t), d = c.getTangentAt(t);
    parts.push(new THREE.SphereGeometry(0.011, 8, 6).scale(1.6, 0.8, 1).translate(p.x, p.y, p.z - 0.02));
    parts.push(new THREE.TorusGeometry(0.0235, 0.003, 4, 14).applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d), V(1, 1, 1))));
  }
  parts.push(new THREE.SphereGeometry(0.026, 12, 8).scale(1, 0.6, 1.2).translate(pts[2].x, pts[2].y, pts[2].z)); // pommel knob
  return roughen(merge(parts), 0.002, 70, rand() * 9);
}

/** The wrist frame for a grip of `len` hanging from `at`: hand end of the wrist, +Y up the forearm. */
function gripFrame(at: THREE.Vector3, len: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = 'grip';
  // The hand wraps the grip; its wrist sits behind and below it, forearm running down and back toward the host.
  o.position.copy(at).add(V(0.035, -len * 0.55, len * 0.32));
  o.rotation.set(1.35, 0.1, -0.35);
  return o;
}

/**
 * A living graft for a mod slot, built in the socket's frame (barrel along -Z). Grafts are deliberately readable at
 * a glance: a barrel graft is a sheath of hooked bone teeth, a sight graft a cluster of extra eyes, an under graft a
 * curled claw, a chamber graft a swollen glowing gland.
 */
function graftMesh(slot: ModSlot, size: number, m: Mats, rand: Rand): THREE.Group {
  const g = new THREE.Group();
  g.name = `graft:${slot}`;
  const k = size;
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const o = new THREE.Mesh(geo, mat); o.frustumCulled = false; g.add(o); return o; };
  if (slot === 'barrel') {
    const parts: THREE.BufferGeometry[] = [taperTube([V(0, 0, 0.02 * k), V(0, 0, -0.05 * k), V(0, 0, -0.1 * k)], [0.02 * k, 0.019 * k, 0.016 * k], 10, 5)];
    for (let i = 0; i < 3; i++) parts.push(new THREE.TorusGeometry(0.021 * k, 0.003 * k, 4, 14).translate(0, 0, -0.02 * k - i * 0.03 * k));
    mesh(roughen(merge(parts), 0.0015 * k, 90 / k, rand() * 9), m.fleshDeep);
    mesh(needleRing(0.019 * k, 8, 0.025 * k, rand, 0.7).rotateX(-Math.PI / 2).translate(0, 0, -0.1 * k), m.bone);
  } else if (slot === 'sight') {
    mesh(roughen(new THREE.SphereGeometry(0.022 * k, 14, 10).scale(1.2, 0.55, 1.6), 0.002 * k, 80 / k, rand() * 9), m.fleshDeep);
    const eye = alienEye(mix(ORGANIC.amber, ORGANIC.mist, 0.3), HIVE.bone);
    for (const [x, y, z, r] of [[0, 0.012, -0.012, 0.011], [-0.012, 0.009, 0.006, 0.007], [0.012, 0.009, 0.008, 0.006]] as const) {
      const e = mesh(new THREE.SphereGeometry(r * k, 14, 10), eye);
      e.position.set(x * k, y * k, z * k);
      e.rotation.y = Math.PI;
    }
  } else if (slot === 'under') {
    const pts = [V(0, 0, 0), V(0, -0.035 * k, -0.01 * k), V(0, -0.06 * k, -0.04 * k), V(0, -0.055 * k, -0.07 * k)];
    mesh(roughen(taperTube(pts, [0.014 * k, 0.012 * k, 0.009 * k, 0.006 * k], 8, 6), 0.0015 * k, 90 / k, rand() * 9), m.flesh);
    for (const s of [-1, 1]) mesh(spike(0.035 * k, 0.006 * k, 0.6).rotateX(-0.6).translate(s * 0.007 * k, -0.055 * k, -0.07 * k), m.bone);
  } else {
    mesh(roughen(new THREE.SphereGeometry(0.026 * k, 16, 12).scale(0.9, 1, 1.3), 0.002 * k, 70 / k, rand() * 9), m.sac);
    mesh(new THREE.SphereGeometry(0.014 * k, 12, 10).scale(1, 1, 1.4), m.core);
    const veins: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      veins.push(taperTube([V(Math.cos(a) * 0.024 * k, Math.sin(a) * 0.024 * k, 0), V(Math.cos(a) * 0.012 * k, Math.sin(a) * 0.012 * k, 0.035 * k)], [0.004 * k, 0.002 * k], 5, 3));
    }
    mesh(merge(veins), m.fleshDeep);
  }
  return g;
}

abstract class Body implements WeaponBody {
  abstract readonly id: WeaponId;
  abstract readonly reloadStyle: ReloadStyle;
  readonly zooms: boolean = false;
  readonly gun = new THREE.Group();
  /** The animated inner body: everything hangs off this, so the caller can place `gun` freely. */
  readonly flex = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  grip = new THREE.Object3D();
  sight?: THREE.Object3D;
  protected time = 0;
  protected dt = 0;
  protected m: Mats;
  protected rand: Rand;
  protected breathers: { obj: THREE.Object3D; amp: number; rate: number }[] = [];
  protected cores: THREE.MeshStandardMaterial[] = [];
  abstract readonly kick: Kick;
  abstract readonly muzzleFx: MuzzleFx;
  readonly fxColour: string;
  /** Overall size, scales the grafts. */
  protected size = 1;
  /** The main flesh mesh; it squashes on each shot. */
  protected flesh?: THREE.Mesh;
  readonly sockets = {} as Record<ModSlot, THREE.Object3D>;
  private grown = new Map<ModSlot, { obj: THREE.Group; k: number; on: boolean }>();
  /** Smoothed fire flinch (rises fast, settles with a wobble). */
  private flinch = 0;
  private flinchV = 0;

  constructor(glow: string, seed: number) {
    this.fxColour = glow;
    this.gun.add(this.flex);
    this.m = materials(glow);
    this.cores.push(this.m.core);
    this.rand = rng(seed);
    this.muzzle.name = 'muzzle';
    this.flex.add(this.muzzle);
  }

  protected add(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.flex): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  protected socket(slot: ModSlot, at: THREE.Vector3): void {
    const o = new THREE.Object3D();
    o.name = `socket:${slot}`;
    o.position.copy(at);
    this.flex.add(o);
    this.sockets[slot] = o;
  }

  get grafts(): ModSlot[] { return [...this.grown].filter(([, g]) => g.on).map(([k]) => k); }

  graft(slot: ModSlot, on = true): void {
    const have = this.grown.get(slot);
    if (have) { have.on = on; return; }
    if (!on) return;
    const obj = graftMesh(slot, this.size, this.m, this.rand);
    obj.scale.setScalar(0.001);
    this.sockets[slot].add(obj);
    this.grown.set(slot, { obj, k: 0, on: true });
  }

  protected setGrip(at: THREE.Vector3, len: number): void {
    this.add(gripBone(at, len, this.rand), this.m.bone);
    this.grip = gripFrame(at, len);
    this.flex.add(this.grip);
  }

  animate(dt: number, s: WeaponPose): void {
    this.time += dt;
    this.dt = dt;
    const t = this.time;
    const fire = Math.exp(-s.sinceFire * 14);
    // Fire flinch: a damped spring kicked on each shot, so the flesh recoils and wobbles back rather than snapping.
    if (s.sinceFire < dt + 1e-4) this.flinchV += 18;
    this.flinchV += (-this.flinch * 420 - this.flinchV * 26) * dt;
    this.flinch += this.flinchV * dt;
    const equip = s.equip === undefined ? 1 : THREE.MathUtils.clamp(s.equip, 0, 1);
    const wake = smooth(equip) * (1 - smooth(s.holster ?? 0));
    for (const b of this.breathers) b.obj.scale.setScalar(1 + Math.sin(t * b.rate) * b.amp);
    for (const c of this.cores) c.emissiveIntensity = (0.35 + 0.65 * s.ammo) * (1 + fire * 1.5) * (0.15 + 0.85 * wake);
    this.flex.position.set(0, 0, 0);
    this.flex.rotation.set(0, 0, 0);
    this.pose(t, { ...s, equip }, fire);
    // The shot: the whole organism jolts back and climbs, the main flesh squashes along the barrel.
    const f = this.flinch;
    this.flex.position.z += f * this.kick.back;
    this.flex.rotation.x += f * this.kick.pitch;
    this.flex.rotation.z += f * this.kick.roll * Math.sin(t * 37);
    if (this.flesh) this.flesh.scale.set(1 + f * 0.06, 1 + f * 0.06, 1 - f * 0.08);
    // The draw: the organism wakes as it comes up, a curl uncoiling with a shudder at the end.
    if (wake < 1) {
      this.flex.rotation.x += (1 - wake) * -0.9;
      this.flex.rotation.z += (1 - wake) * 0.6;
      this.flex.position.y += (1 - wake) * -0.08;
      this.flex.rotation.y += bump(equip, 0.7, 1) * Math.sin(t * 40) * 0.03;
    }
    for (const [, g] of this.grown) {
      g.k = THREE.MathUtils.clamp(g.k + (g.on ? dt : -dt) / 0.7, 0, 1);
      // Grafts grow in with an overshoot and then breathe with the body.
      const k = g.on ? smooth(g.k) * (1 + bump(g.k, 0.6, 1) * 0.2) : smooth(g.k);
      g.obj.scale.setScalar(Math.max(0.001, k * (1 + Math.sin(t * 2.3) * 0.03)));
      g.obj.visible = g.k > 0;
    }
  }

  protected abstract pose(t: number, s: Pose, fire: number): void;
}

/** Quillet (sidearm): a porcupine-quill pistol with a fanged muzzle; the quills re-sprout along its back to reload. */
class Sidearm extends Body {
  readonly id = 'quillet';
  readonly reloadStyle = 'regrow';
  readonly kick: Kick = { back: 0.025, pitch: 0.16, roll: 0.05 };
  readonly muzzleFx: MuzzleFx = 'quill';
  readonly zooms = true;
  private gland: THREE.Group;
  private quills: THREE.Mesh[] = [];
  private fangs: THREE.Mesh;
  constructor(seed = 1) {
    super(mix(PATH.melee, ORGANIC.amber, 0.5), seed);
    this.flesh = this.add(lathe(0.3, (t) => 0.028 + Math.sin(t * Math.PI) * 0.03 - t * 0.008, 3).translate(0, 0, 0.1), this.m.flesh);
    // Bone sheath along the top and a short ribbed barrel.
    const ribs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) ribs.push(new THREE.TorusGeometry(0.032 - i * 0.002, 0.005, 5, 16, Math.PI * 1.2).rotateZ(-0.3).translate(0, 0.004, -0.04 - i * 0.035));
    ribs.push(taperTube([V(0, 0.045, 0.1), V(0, 0.055, -0.02), V(0, 0.04, -0.17)], [0.012, 0.01, 0.006], 6, 4));
    this.add(merge(ribs), this.m.bone);
    this.fangs = this.add(needleRing(0.022, 7, 0.03, this.rand, 0.6).rotateX(-Math.PI / 2).translate(0, 0, -0.2), this.m.bone);
    this.muzzle.position.set(0, 0, -0.22);
    // The gland: a translucent sac on the back with a glowing core.
    this.gland = new THREE.Group();
    this.gland.position.set(0, 0.04, 0.06);
    this.add(new THREE.SphereGeometry(0.03, 16, 12).scale(1, 0.8, 1.3), this.m.sac, this.gland);
    this.add(new THREE.SphereGeometry(0.018, 12, 10).scale(1, 0.8, 1.3), this.m.core, this.gland);
    this.flex.add(this.gland);
    // The quills: the ammunition, a crest along the back, longest at the rear.
    for (let i = 0; i < 9; i++) {
      const q = this.add(spike(0.055 + (8 - i) * 0.007, 0.0075, 0.35).rotateX(-1.05 - i * 0.02), i % 2 === 0 ? this.m.boneDark : this.m.bone);
      q.position.set((i % 2 ? 1 : -1) * 0.008, 0.045, 0.06 - i * 0.022);
      q.rotation.z = (i % 2 ? -1 : 1) * 0.25;
      this.quills.push(q);
    }
    this.setGrip(V(0, -0.03, 0.08), 0.11);
    this.size = 0.8;
    this.socket('barrel', V(0, 0, -0.21)); this.socket('sight', V(0, 0.07, -0.03)); this.socket('under', V(0, -0.03, -0.1)); this.socket('chamber', V(0.04, 0.005, 0.03));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    // Regrow: the quills shed, then re-sprout one after another from the rear; the gland throbs as it feeds them.
    const r = s.reload;
    const k = r === null ? 1 : r < 0.35 ? 1 - smooth(r / 0.35) * 0.85 : 0.15 + smooth((r - 0.35) / 0.65) * 0.85;
    this.gland.scale.setScalar(k * (1 + Math.sin(t * 6) * 0.04 + fire * 0.15));
    const n = this.quills.length, left = Math.round(s.ammo * n);
    this.quills.forEach((q, i) => {
      const grow = r === null ? (i < left || s.ammo >= 1 ? 1 : 0.15) : r < 0.2 ? 1 - smooth(r / 0.2) : smooth((r - 0.3 - (i / n) * 0.5) / 0.15);
      // On the draw the quills bristle up from flat, rear first.
      q.scale.set(1, Math.max(0.05, grow * (0.3 + 0.7 * smooth(s.equip * 1.6 - (i / n) * 0.6))), 1);
    });
    this.fangs.scale.setScalar(1 + fire * 0.25);
    this.flex.rotation.z = r === null ? 0 : bump(r, 0, 1) * 0.5;
  }
}

/** Hive Spitter (SMG): a wasp-nest body with a twin comb muzzle; its spore drum drops away and a new one grows on. */
class Smg extends Body {
  readonly id = 'hiveSpitter';
  readonly reloadStyle = 'magazine';
  readonly kick: Kick = { back: 0.015, pitch: 0.06, roll: 0.08 };
  readonly muzzleFx: MuzzleFx = 'spore';
  private drum: THREE.Group;
  private barrels: THREE.Mesh;
  constructor(seed = 2) {
    super(mix(HIVE.acid, ORGANIC.mist, 0.4), seed);
    this.flesh = this.add(lathe(0.36, (t) => 0.04 + Math.sin(Math.pow(t, 0.7) * Math.PI) * 0.025, 5).translate(0, 0, 0.14), this.m.fleshDeep);
    // Hexagonal comb plates down the flanks.
    const comb: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) comb.push(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 6).rotateZ(Math.PI / 2).translate(s * 0.052, 0.012 - (i % 2) * 0.022, 0.08 - Math.floor(i / 2) * 0.05));
    this.add(merge(comb), this.m.bone);
    const bar: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      bar.push(taperTube([V(s * 0.016, 0.012, -0.16), V(s * 0.017, 0.012, -0.24), V(s * 0.015, 0.01, -0.32)], [0.012, 0.011, 0.01], 7, 3));
      for (let i = 0; i < 4; i++) bar.push(new THREE.TorusGeometry(0.013, 0.003, 4, 12).translate(s * 0.016, 0.012, -0.18 - i * 0.04));
    }
    this.barrels = this.add(merge(bar), this.m.bone);
    this.muzzle.position.set(0, 0.012, -0.34);
    this.drum = new THREE.Group();
    this.drum.position.set(0, -0.05, -0.03);
    this.add(roughen(new THREE.SphereGeometry(0.045, 18, 14).scale(0.8, 1, 1.1), 0.003, 50, 4), this.m.sac, this.drum);
    for (let i = 0; i < 5; i++) this.add(new THREE.SphereGeometry(0.01, 8, 6).translate(Math.cos(i * 1.26) * 0.018, Math.sin(i * 1.26) * 0.022, (i - 2) * 0.012), this.m.core, this.drum);
    this.flex.add(this.drum);
    this.setGrip(V(0, -0.03, 0.09), 0.1);
    this.size = 0.9;
    this.socket('barrel', V(0, 0.012, -0.33)); this.socket('sight', V(0, 0.07, 0.03)); this.socket('under', V(0, -0.03, -0.2)); this.socket('chamber', V(0.06, 0.005, 0.1));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    this.barrels.position.z = fire * 0.012;
    if (r === null) { this.drum.position.set(0, -0.05, -0.03); this.drum.scale.setScalar(1); this.drum.rotation.set(0, 0, 0); this.flex.rotation.set(0, 0, 0); return; }
    // Drop the spent pod (0..0.3), grow a new one in place (0.45..0.9).
    if (r < 0.4) {
      const d = smooth(r / 0.3);
      this.drum.position.set(0, -0.05 - d * 0.12, -0.03 + d * 0.02);
      this.drum.rotation.x = d * 0.8;
      this.drum.scale.setScalar(1 - smooth((r - 0.25) / 0.15));
    } else {
      this.drum.position.set(0, -0.05, -0.03);
      this.drum.rotation.x = 0;
      this.drum.scale.setScalar(Math.max(0.001, smooth((r - 0.45) / 0.45)) * (1 + bump(r, 0.85, 1) * 0.12));
    }
    this.flex.rotation.set(-bump(r, 0, 0.5) * 0.15, 0, bump(r, 0, 1) * 0.35);
    void t;
  }
}

/** Vertebra Rifle (auto rifle): a spine of vertebrae over a flesh receiver; its bone clip is pulled and a fresh one pushed in. */
class Rifle extends Body {
  readonly id = 'vertebraRifle';
  readonly reloadStyle = 'magazine';
  readonly kick: Kick = { back: 0.02, pitch: 0.08, roll: 0.04 };
  readonly muzzleFx: MuzzleFx = 'spore';
  readonly zooms = true;
  private clip: THREE.Group;
  private verts: THREE.Mesh;
  constructor(seed = 3) {
    super(mix(ZONE7.cyan, ORGANIC.mist, 0.45), seed);
    this.flesh = this.add(lathe(0.34, (t) => 0.034 + Math.sin(Math.pow(t, 0.6) * Math.PI) * 0.026 - t * 0.012, 7).translate(0, 0, 0.16), this.m.flesh);
    // Stock: a bone fork back to the shoulder.
    this.add(roughen(merge([
      taperTube([V(0, 0.01, 0.15), V(0, -0.005, 0.26), V(0, -0.03, 0.34)], [0.022, 0.018, 0.026], 7, 3),
      taperTube([V(0, 0.03, 0.14), V(0, 0.035, 0.24), V(0, 0.01, 0.34)], [0.012, 0.01, 0.016], 6, 3),
    ]), 0.003, 50, 2), this.m.bone);
    // Vertebral barrel.
    const v: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const z = -0.16 - i * 0.034, r = 0.022 - i * 0.0009;
      v.push(roughen(new THREE.CylinderGeometry(r, r * 1.08, 0.022, 10).rotateX(Math.PI / 2).translate(0, 0.014, z), 0.0015, 120, i));
      v.push(spike(0.032 - i * 0.001, 0.007, 0.6).rotateX(-1.0).translate(0, 0.014 + r, z));
      for (const s of [-1, 1]) v.push(spike(0.02, 0.005, 0.3).rotateZ(-s * 1.3).translate(s * r, 0.01, z));
    }
    v.push(taperTube([V(0, 0.014, -0.16), V(0, 0.014, -0.47)], [0.009, 0.007], 6, 6));
    this.verts = this.add(merge(v), this.m.bone);
    this.muzzle.position.set(0, 0.014, -0.48);
    // A small sighting eye on a stalk (the zoom eye).
    const eye = this.add(new THREE.SphereGeometry(0.014, 16, 12), alienEye(ZONE7.cyan, HIVE.bone));
    eye.position.set(0, 0.06, -0.02);
    this.add(taperTube([V(0, 0.035, 0.02), V(0, 0.05, 0.0), V(0, 0.058, -0.012)], [0.008, 0.007, 0.006], 6, 3), this.m.fleshDeep);
    this.sight = new THREE.Object3D();
    this.sight.name = 'sight';
    this.sight.position.set(0, 0.06, 0.05);
    this.flex.add(this.sight);
    // Curved bone clip with glowing rounds.
    this.clip = new THREE.Group();
    this.clip.position.set(0, -0.04, -0.02);
    this.add(roughen(taperTube([V(0, 0, 0), V(0, -0.05, -0.012), V(0, -0.09, -0.04)], [0.016, 0.016, 0.014], 6, 4), 0.002, 80, 3).scale(1.4, 1, 1), this.m.boneDark, this.clip);
    for (let i = 0; i < 3; i++) this.add(new THREE.SphereGeometry(0.006, 8, 6).translate(0.022, -0.02 - i * 0.025, -0.006 - i * 0.01), this.m.core, this.clip);
    this.flex.add(this.clip);
    this.setGrip(V(0, -0.03, 0.08), 0.1);
    this.size = 1;
    this.socket('barrel', V(0, 0.014, -0.47)); this.socket('sight', V(0, 0.06, -0.09)); this.socket('under', V(0, -0.015, -0.27)); this.socket('chamber', V(0.05, 0.0, 0.05));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    this.verts.position.z = fire * 0.01;
    // Aim: the vertebrae lock tight (barrel steadies), the sighting eye leans toward the host.
    this.verts.scale.z = 1 - s.aim * 0.03;
    if (r === null) { this.clip.position.set(0, -0.04, -0.02); this.clip.rotation.set(0, 0, 0); this.flex.rotation.set(0, 0, 0); return; }
    // Pull (0.1..0.35), swap out of view, push in (0.55..0.8) with a seat thump.
    const out = r < 0.45 ? smooth((r - 0.1) / 0.25) : 1 - smooth((r - 0.55) / 0.25);
    this.clip.position.set(0, -0.04 - out * 0.14, -0.02 + out * 0.03);
    this.clip.rotation.x = out * 0.6;
    this.flex.rotation.set(bump(r, 0.05, 0.9) * 0.12 + bump(r, 0.78, 0.9) * -0.08, 0, bump(r, 0, 1) * 0.45);
    void t;
  }
}

/** Gullet Scatter (shotgun): a toothed, jawed throat that gulps seed shells one at a time. */
class Shotgun extends Body {
  readonly id = 'gulletScatter';
  readonly reloadStyle = 'perShell';
  readonly kick: Kick = { back: 0.06, pitch: 0.3, roll: 0.06 };
  readonly muzzleFx: MuzzleFx = 'spit';
  private jaws: THREE.Group[] = [];
  private throat: THREE.Mesh;
  private lastShells = 0;
  private gulp = 0;
  constructor(seed = 4) {
    super(mix(PATH.melee, HIVE.danger, 0.3), seed);
    this.flesh = this.add(lathe(0.42, (t) => 0.045 + Math.sin(Math.pow(t, 0.9) * Math.PI) * 0.03 + Math.max(0, t - 0.8) * 0.12, 9).translate(0, 0, 0.16), this.m.flesh);
    // Mandible jaws around the muzzle, hinged at the rim.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4, g = new THREE.Group();
      g.position.set(Math.cos(a) * 0.055, Math.sin(a) * 0.055, -0.25);
      g.rotation.z = a - Math.PI / 2;
      this.add(roughen(spike(0.07, 0.016, 0.7).rotateX(-Math.PI / 2 + 0.25), 0.002, 90, i), this.m.bone, g);
      this.flex.add(g);
      this.jaws.push(g);
    }
    this.add(needleRing(0.045, 12, 0.02, this.rand, 0.8).rotateX(-Math.PI / 2).translate(0, 0, -0.255), this.m.boneDark);
    this.muzzle.position.set(0, 0, -0.27);
    // Throat sac under the barrel (the "pump").
    this.throat = this.add(roughen(new THREE.SphereGeometry(0.035, 16, 12).scale(0.9, 0.8, 2.2), 0.003, 50, 7).translate(0, -0.05, -0.1), this.m.sac);
    const shells: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) shells.push(new THREE.SphereGeometry(0.012, 10, 8).scale(1, 1, 1.4).translate(0, -0.05, -0.16 + i * 0.03));
    this.add(merge(shells), this.m.core);
    // Bone ribs over the top.
    const ribs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) ribs.push(new THREE.TorusGeometry(0.068 - Math.abs(i - 2) * 0.005, 0.007, 5, 16, Math.PI * 1.1).rotateZ(-0.05).translate(0, 0, 0.06 - i * 0.06));
    this.add(merge(ribs), this.m.bone);
    this.setGrip(V(0, -0.035, 0.1), 0.11);
    this.size = 1.25;
    this.socket('barrel', V(0, 0, -0.27)); this.socket('sight', V(0, 0.085, -0.04)); this.socket('under', V(0, -0.085, -0.02)); this.socket('chamber', V(0.075, 0.0, 0.1));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload, shells = s.shells ?? 0;
    if (r === null) this.lastShells = 0;
    if (shells > this.lastShells) { this.gulp = 1; this.lastShells = shells; }
    this.gulp = Math.max(0, this.gulp - this.dt * 4);
    // Jaws snap open on a shot and gape while reloading.
    const open = Math.max(fire * 0.9, r === null ? 0 : 0.5 + this.gulp * 0.4, bump(s.equip, 0.55, 0.95) * 1.1);
    for (const j of this.jaws) j.rotation.x = -open * 0.6;
    this.throat.scale.set(1 + this.gulp * 0.25, 1 + this.gulp * 0.3, 1 - this.gulp * 0.1);
    this.flex.rotation.set(r === null ? 0 : 0.18 + this.gulp * 0.06, 0, r === null ? 0 : 0.35);
    void t;
  }
}

/** Eyestalk Marksman: a long spine barrel with a living eye on a stalk for a scope; it extends when aimed and blinks on reload. */
class Sniper extends Body {
  readonly id = 'eyestalkMarksman';
  readonly reloadStyle = 'magazine';
  readonly kick: Kick = { back: 0.07, pitch: 0.24, roll: 0.02 };
  readonly muzzleFx: MuzzleFx = 'beam';
  readonly zooms = true;
  private eye: THREE.Group;
  private pod: THREE.Group;
  private eyeMat: THREE.MeshPhysicalMaterial;
  constructor(seed = 5) {
    super(mix(ZONE7.violet, ORGANIC.mist, 0.4), seed);
    this.flesh = this.add(lathe(0.34, (t) => 0.03 + Math.sin(Math.pow(t, 0.6) * Math.PI) * 0.024, 11).translate(0, 0, 0.2), this.m.fleshDeep);
    this.add(roughen(taperTube([V(0, 0.005, 0.2), V(0, -0.01, 0.32), V(0, -0.035, 0.42)], [0.02, 0.018, 0.03], 8, 3), 0.003, 50, 5), this.m.bone);
    // Long spine barrel with a sinew wrap.
    const sp: THREE.BufferGeometry[] = [taperTube([V(0, 0.008, -0.14), V(0, 0.008, -0.45), V(0, 0.008, -0.72)], [0.011, 0.009, 0.008], 7, 8)];
    for (let i = 0; i < 12; i++) sp.push(new THREE.TorusGeometry(0.012, 0.0025, 4, 10).translate(0, 0.008, -0.16 - i * 0.045));
    sp.push(needleRing(0.014, 6, 0.018, this.rand, 0.9).rotateX(-Math.PI / 2).translate(0, 0.008, -0.72));
    this.add(merge(sp), this.m.bone);
    this.muzzle.position.set(0, 0.008, -0.74);
    // Folded bone legs under the barrel (bipod).
    for (const s of [-1, 1]) this.add(taperTube([V(s * 0.01, -0.005, -0.3), V(s * 0.02, -0.02, -0.22), V(s * 0.022, -0.026, -0.12)], [0.006, 0.005, 0.003], 5, 3), this.m.bone);
    // The scope eye on its stalk.
    this.eye = new THREE.Group();
    this.eye.position.set(0, 0.05, -0.02);
    this.eyeMat = alienEye(mix(ZONE7.violet, ORGANIC.amber, 0.4), HIVE.bone);
    const ball = this.add(new THREE.SphereGeometry(0.026, 24, 18), this.eyeMat, this.eye);
    ball.rotation.y = Math.PI; // gaze down the barrel (-Z)
    this.add(new THREE.SphereGeometry(0.03, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).rotateX(Math.PI / 2 + 0.2), this.m.fleshDeep, this.eye);
    this.add(taperTube([V(0, 0.03, 0.02), V(0, 0.045, 0.0), V(0, 0.05, -0.02)], [0.014, 0.012, 0.012], 7, 3), this.m.fleshDeep);
    this.flex.add(this.eye);
    this.sight = new THREE.Object3D();
    this.sight.name = 'sight';
    this.sight.position.set(0, 0.05, 0.04);
    this.flex.add(this.sight);
    this.pod = new THREE.Group();
    this.pod.position.set(0, -0.035, 0.0);
    this.add(new THREE.SphereGeometry(0.025, 14, 10).scale(0.8, 1, 1.4), this.m.sac, this.pod);
    this.add(new THREE.SphereGeometry(0.012, 10, 8).scale(1, 1, 1.6), this.m.core, this.pod);
    this.flex.add(this.pod);
    this.setGrip(V(0, -0.025, 0.12), 0.1);
    this.size = 1;
    this.socket('barrel', V(0, 0.008, -0.73)); this.socket('sight', V(0, 0.06, -0.12)); this.socket('under', V(0, -0.015, -0.42)); this.socket('chamber', V(0.042, 0.0, 0.12));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    // Aim: the eye stalk extends back toward the host and the iris narrows.
    this.eye.position.set(0, 0.05 + s.aim * 0.012, -0.02 + s.aim * 0.03);
    this.eye.rotation.x = Math.sin(t * 0.7) * 0.05 * (1 - s.aim) - fire * 0.2;
    this.eyeMat.emissiveIntensity = 0.4 + s.aim * 0.6;
    // Blink on reload: the lid (the flesh cap) rolls down over the eye.
    this.eye.children[1].rotation.x = Math.max(r === null ? 0 : bump(r, 0.05, 0.4) * 1.3, (1 - smooth((s.equip - 0.5) / 0.4)) * 1.3);
    const out = r === null ? 0 : r < 0.5 ? smooth((r - 0.1) / 0.3) : 1 - smooth((r - 0.55) / 0.3);
    this.pod.position.set(0, -0.035 - out * 0.1, out * 0.04);
    this.pod.scale.setScalar(r !== null && r > 0.35 && r < 0.55 ? 0.001 : 1);
    this.flex.rotation.set(r === null ? 0 : bump(r, 0, 1) * 0.1, 0, r === null ? 0 : bump(r, 0, 1) * 0.3);
  }
}

/** Brood Mortar (launcher): an egg sac with one egg behind a membrane window; it swallows the next egg to reload. */
class Launcher extends Body {
  readonly id = 'broodMortar';
  readonly reloadStyle = 'magazine';
  readonly kick: Kick = { back: 0.09, pitch: 0.4, roll: 0.03 };
  readonly muzzleFx: MuzzleFx = 'bile';
  private egg: THREE.Group;
  private mouth: THREE.Mesh;
  constructor(seed = 6) {
    super(mix(ORGANIC.amber, HIVE.acid, 0.3), seed);
    this.flesh = this.add(lathe(0.5, (t) => 0.06 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.035 + Math.max(0, t - 0.85) * 0.2, 13).translate(0, 0, 0.22), this.m.fleshDeep);
    // Membrane window on the flank showing the egg.
    this.add(new THREE.SphereGeometry(0.075, 20, 14, -0.6, 1.2, 0.7, 1.4).rotateY(Math.PI / 2).scale(1, 0.9, 1.6).translate(0, 0, -0.02), this.m.sac);
    // Muzzle: a puckered sphincter of bone plates.
    this.mouth = this.add(needleRing(0.07, 10, 0.035, this.rand, 0.75).rotateX(-Math.PI / 2).translate(0, 0, -0.28), this.m.bone);
    this.muzzle.position.set(0, 0, -0.3);
    const ribs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) ribs.push(new THREE.TorusGeometry(0.094 - Math.abs(i - 2.5) * 0.006, 0.008, 5, 18).translate(0, 0, 0.16 - i * 0.075));
    this.add(merge(ribs), this.m.bone);
    // Shoulder hump and a carrying spine.
    this.add(roughen(taperTube([V(0, 0.09, 0.2), V(0, 0.11, 0.0), V(0, 0.09, -0.2)], [0.02, 0.026, 0.014], 7, 4), 0.003, 40, 1), this.m.bone);
    this.egg = new THREE.Group();
    this.egg.position.set(0, 0, -0.02);
    this.add(roughen(new THREE.SphereGeometry(0.045, 18, 14).scale(1, 1, 1.4), 0.002, 60, 8), this.m.flesh, this.egg);
    this.add(new THREE.SphereGeometry(0.03, 14, 10).scale(1, 1, 1.4), this.m.core, this.egg);
    this.flex.add(this.egg);
    this.setGrip(V(0, -0.06, 0.08), 0.1);
    this.size = 1.5;
    this.socket('barrel', V(0, 0, -0.29)); this.socket('sight', V(0, 0.14, -0.12)); this.socket('under', V(0, -0.11, -0.12)); this.socket('chamber', V(0.1, 0.0, 0.1));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    this.mouth.scale.setScalar(1 + fire * 0.3);
    if (r === null) { this.egg.position.set(0, 0, -0.02); this.egg.scale.setScalar(1); this.flex.rotation.set(0, 0, 0); return; }
    // The fired egg is gone; a new egg slides in from the back (0.2..0.8) with a swallowing bulge.
    const k = smooth((r - 0.2) / 0.6);
    this.egg.position.set(0, 0, 0.26 - k * 0.28);
    this.egg.scale.setScalar(r < 0.2 ? 0.001 : 1);
    this.flex.rotation.set(-bump(r, 0.1, 0.9) * 0.25, 0, bump(r, 0, 1) * 0.2);
    void t;
  }
}

const BUILDERS: Record<WeaponId, (seed?: number) => Body> = {
  quillet: (s) => new Sidearm(s), hiveSpitter: (s) => new Smg(s), vertebraRifle: (s) => new Rifle(s),
  gulletScatter: (s) => new Shotgun(s), eyestalkMarksman: (s) => new Sniper(s), broodMortar: (s) => new Launcher(s),
};

export function hasWeaponBody(id: string): id is WeaponId { return id in BUILDERS; }

/** Build the living body for a weapon id. */
export function createWeaponBody(id: WeaponId, seed?: number): WeaponBody {
  const b = BUILDERS[id](seed);
  b.gun.name = `weapon:${id}`;
  b.gun.traverse((o) => { o.frustumCulled = false; });
  return b;
}
