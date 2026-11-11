import * as THREE from 'three';
import { MODS, WEAPON_FEEL, WEAPONS, type Rarity, type WeaponDef } from '../../../data';
import { HIVE, ORGANIC, PATH, ZONE7 } from '../../render/palette';
import { alienEye, bioNode, chitin, livingFlesh, membrane } from '../../render/materials';
import { merge, needleRing, rng, roughen, spike, taperTube, wing, type Rand } from '../parts';

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
export type WeaponId = 'quillet' | 'marrowHand' | 'hiveSpitter' | 'stingerChoir' | 'vertebraRifle' | 'cicadine' | 'gulletScatter' | 'bloomcannon' | 'eyestalkMarksman' | 'leviathanQuill' | 'broodMortar' | 'tumorLauncher' | 'lumenLance' | 'reliquaryHymn' | 'coreburner';
export const WEAPON_BODIES: WeaponId[] = ['quillet', 'marrowHand', 'hiveSpitter', 'stingerChoir', 'vertebraRifle', 'cicadine', 'gulletScatter', 'bloomcannon', 'eyestalkMarksman', 'leviathanQuill', 'broodMortar', 'tumorLauncher', 'lumenLance', 'reliquaryHymn', 'coreburner'];
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
  /** Only the slots this gun exposes (data/weapons.json modSlots; no sight socket when it does not aim). */
  readonly sockets: Partial<Record<ModSlot, THREE.Object3D>>;
  /** Grow (or shed) the living graft in a slot: `mod` is a data/mods.json id (its own look), else a generic graft. */
  graft(slot: ModSlot, on?: boolean, mod?: string): void;
  /** The mod grown in each slot (or 'generic'). */
  readonly graftMods: Partial<Record<ModSlot, string>>;
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
  // Grounded and eerie (Art Bible): chambers glow a dull, warm, living light with only a hint of the gun's hue.
  glow = mix(glow, ORGANIC.amber, 0.6);
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

/**
 * One graft per mod in data/mods.json, built from its `look` line, in the socket's frame (barrel along -Z, sight
 * above, under below, chamber on the flank). Each one buds out of the socket.
 */
function modGraft(id: string, size: number, m: Mats, rand: Rand): THREE.Group {
  const g = new THREE.Group();
  g.name = `graft:${id}`;
  const k = size;
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const o = new THREE.Mesh(geo, mat); g.add(o); return o; };
  const eyeMat = (c: string) => alienEye(c, HIVE.bone);
  switch (id) {
    case 'lampreyMouth': // a ring of tiny inward teeth round the muzzle
      mesh(new THREE.TorusGeometry(0.022 * k, 0.008 * k, 10, 20).translate(0, 0, -0.008 * k), m.fleshDeep);
      mesh(needleRing(0.022 * k, 16, 0.014 * k, rand, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.01 * k), m.bone);
      break;
    case 'hushGill': { // feathery gill slits along the barrel
      mesh(taperTube([V(0, 0, 0.06 * k), V(0, 0, -0.03 * k)], [0.016 * k, 0.015 * k], 10, 3), m.fleshDeep);
      const gills: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) gills.push(new THREE.SphereGeometry(0.014 * k, 8, 6).scale(0.12, 1, 0.6).rotateZ(sd * 0.5).translate(sd * 0.017 * k, 0.004 * k, 0.045 * k - i * 0.016 * k));
      mesh(merge(gills), m.sac);
      break;
    }
    case 'barbCrown': { // a crown of hooked barbs at the muzzle
      const barbs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; barbs.push(spike(0.035 * k, 0.005 * k, 0.9).rotateX(-1.1).rotateZ(a - Math.PI / 2).translate(Math.cos(a) * 0.018 * k, Math.sin(a) * 0.018 * k, 0)); }
      mesh(merge(barbs), m.boneDark);
      mesh(new THREE.TorusGeometry(0.019 * k, 0.005 * k, 6, 18), m.bone);
      break;
    }
    case 'pupilBud': { // a second small eye budding beside the sight
      mesh(new THREE.SphereGeometry(0.012 * k, 12, 8).scale(1, 0.8, 1.2).translate(0.018 * k, -0.004 * k, 0), m.flesh);
      const e = mesh(new THREE.SphereGeometry(0.009 * k, 14, 10), eyeMat(mix(ORGANIC.amber, ORGANIC.mist, 0.2)));
      e.position.set(0.02 * k, 0.003 * k, -0.004 * k); e.rotation.y = Math.PI;
      break;
    }
    case 'nightEye': { // a black, wet compound eye
      mesh(new THREE.SphereGeometry(0.02 * k, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.1, 0.7, 1.3), m.fleshDeep);
      const facets = mesh(new THREE.IcosahedronGeometry(0.017 * k, 2).scale(1, 0.85, 1.1).translate(0, 0.008 * k, -0.006 * k), eyeMat(mix(ZONE7.void, ORGANIC.mist, 0.15)));
      facets.rotation.y = Math.PI;
      break;
    }
    case 'stalkEye': { // a long eyestalk rising up and back
      mesh(taperTube([V(0, 0, 0), V(0, 0.03 * k, 0.01 * k), V(0, 0.05 * k, 0.03 * k)], [0.008 * k, 0.006 * k, 0.006 * k], 7, 4), m.fleshDeep);
      const e = mesh(new THREE.SphereGeometry(0.014 * k, 16, 12), eyeMat(mix(ZONE7.violet, ORGANIC.amber, 0.4)));
      e.position.set(0, 0.056 * k, 0.034 * k); e.rotation.y = Math.PI;
      break;
    }
    case 'tendonBrace': { // a cord of tendon anchoring the gun back to the forearm
      const cord: THREE.BufferGeometry[] = [taperTube([V(0, 0, 0), V(0, -0.03 * k, 0.08 * k), V(0.01 * k, -0.08 * k, 0.17 * k)], [0.006 * k, 0.005 * k, 0.007 * k], 7, 6)];
      for (let i = 1; i < 4; i++) cord.push(new THREE.TorusGeometry(0.0075 * k, 0.0018 * k, 4, 10).rotateX(1.0).translate(0.002 * k * i, -0.02 * k * i, 0.042 * k * i));
      mesh(merge(cord), m.flesh);
      break;
    }
    case 'lightBone': { // hollow bird bone slung underneath
      const bone: THREE.BufferGeometry[] = [taperTube([V(0, -0.006 * k, 0.04 * k), V(0, -0.012 * k, -0.04 * k), V(0, -0.006 * k, -0.11 * k)], [0.007 * k, 0.006 * k, 0.007 * k], 8, 5)];
      for (const z of [0.04, -0.11]) bone.push(new THREE.SphereGeometry(0.009 * k, 10, 8).translate(0, -0.006 * k, z * k));
      mesh(merge(bone), m.bone);
      // Pneumatic holes: dark dimples along its side.
      const holes: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) holes.push(new THREE.SphereGeometry(0.0025 * k, 6, 4).translate(0.006 * k, -0.01 * k, 0.02 * k - i * 0.035 * k));
      mesh(merge(holes), m.fleshDeep);
      break;
    }
    case 'clingRoot': { // root hairs that grip the arm
      const roots: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI - Math.PI / 2, l = (0.04 + rand() * 0.03) * k;
        roots.push(taperTube([V(0, 0, 0), V(Math.sin(a) * 0.01 * k, -l * 0.5, l * 0.3), V(Math.sin(a) * 0.022 * k, -l, l * 0.8)], [0.0035 * k, 0.0022 * k, 0.0008 * k], 4, 3));
      }
      mesh(merge(roots), m.fleshDeep);
      break;
    }
    case 'quickGullet': { // a ribbed throat swallowing the next load
      mesh(taperTube([V(0, 0, 0.03 * k), V(0.004 * k, 0, -0.01 * k), V(0, 0, -0.05 * k)], [0.014 * k, 0.016 * k, 0.012 * k], 10, 4).translate(0.012 * k, 0, 0), m.flesh);
      const ribs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) ribs.push(new THREE.TorusGeometry(0.0155 * k, 0.003 * k, 4, 12).translate(0.012 * k, 0, 0.025 * k - i * 0.014 * k));
      mesh(merge(ribs), m.bone);
      break;
    }
    case 'swollenSac': // an oversized feed sac bulging under the gun
      mesh(roughen(new THREE.SphereGeometry(0.04 * k, 18, 14).scale(0.8, 1, 1.4).translate(0.01 * k, -0.035 * k, 0), 0.003 * k, 50 / k, rand() * 9), m.sac);
      mesh(new THREE.SphereGeometry(0.022 * k, 12, 10).scale(1, 1, 1.4).translate(0.01 * k, -0.035 * k, 0), m.core);
      break;
    case 'acidStrain': { // green acid veins through the feed
      mesh(roughen(new THREE.SphereGeometry(0.02 * k, 14, 10).scale(0.8, 1, 1.3), 0.002 * k, 70 / k, rand() * 9), m.fleshDeep);
      const veins: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) { const a = rand() * Math.PI * 2, z = (rand() - 0.5) * 0.06 * k; veins.push(taperTube([V(0.004 * k, 0, 0), V(0.012 * k, Math.sin(a) * 0.02 * k, Math.cos(a) * 0.03 * k + z), V(0.006 * k, Math.sin(a) * 0.035 * k, Math.cos(a) * 0.06 * k + z)], [0.003 * k, 0.0025 * k, 0.001 * k], 4, 4)); }
      mesh(merge(veins), bioNode(mix(HIVE.acid, ORGANIC.mist, 0.35), 2.6));
      break;
    }
    case 'seekerStrain': // a nerve knot steering each shot
      mesh(new THREE.TorusKnotGeometry(0.012 * k, 0.0035 * k, 48, 6, 2, 3).translate(0.012 * k, 0, 0), m.flesh);
      mesh(new THREE.SphereGeometry(0.006 * k, 10, 8).translate(0.012 * k, 0, 0), bioNode(mix(PATH.dna, ORGANIC.mist, 0.4), 3.2));
      break;
    case 'leechStrain': { // a leech coiled through the chamber
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 4; pts.push(V(0.012 * k + Math.cos(a) * 0.012 * k, Math.sin(a) * 0.016 * k, 0.04 * k - (i / 24) * 0.08 * k)); }
      mesh(roughen(taperTube(pts, pts.map((_, i) => (0.006 - Math.abs(i - 12) * 0.0002) * k), 7, 2), 0.001 * k, 120 / k, rand() * 9), m.fleshDeep);
      mesh(new THREE.TorusGeometry(0.006 * k, 0.002 * k, 5, 10).rotateY(Math.PI / 2).translate(pts[0].x, pts[0].y, pts[0].z), m.bone);
      break;
    }
    case 'splinterStrain': { // bone spurs packed into the feed
      mesh(new THREE.SphereGeometry(0.016 * k, 12, 10).translate(0.008 * k, 0, 0), m.fleshDeep);
      const spurs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const d = V(0.5 + rand() * 0.5, rand() - 0.5, rand() - 0.5).normalize();
        spurs.push(spike(0.03 * k, 0.004 * k, 0.2).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d)).translate(0.008 * k, 0, 0));
      }
      mesh(merge(spurs), m.bone);
      break;
    }
    default:
      return graftMesh(MODS[id]?.slot ?? 'chamber', size, m, rand);
  }
  return g;
}

/** How alive a gun is by rarity: twitch rate, breath and glow (Design: relic twitches twice as often as common). */
const RARITY_LIFE: Record<Rarity, number> = { common: 1, uncommon: 1.25, rare: 1.5, epic: 1.75, relic: 2 };

abstract class Body implements WeaponBody {
  abstract readonly id: WeaponId;
  /** Design's entry for this gun (class, rarity, reload style, ads, mod slots). */
  readonly def: WeaponDef;
  readonly reloadStyle: ReloadStyle;
  readonly zooms: boolean;
  readonly rarity: Rarity;
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
  /** Per-shot flinch from WEAPON_FEEL.fire[class]: push (m), kick (deg → rad), a little roll from shake. */
  readonly kick: Kick;
  abstract readonly muzzleFx: MuzzleFx;
  readonly fxColour: string;
  /** Overall size, scales the grafts. */
  protected size = 1;
  /** The main flesh mesh; it squashes on each shot. */
  protected flesh?: THREE.Mesh;
  /** The feed the host tears out on a magazine reload (a drum, clip, larva, pod...); a spent copy drops away. */
  protected mag?: THREE.Object3D;
  readonly sockets: Partial<Record<ModSlot, THREE.Object3D>> = {};
  private grown = new Map<ModSlot, { obj: THREE.Group; k: number; on: boolean; mod: string }>();
  /** Fire flinch: a damped spring that settles in the class's `settle` time. */
  private flinch = 0;
  private flinchV = 0;
  private readonly omega: number;
  /** Idle life: breathing and the occasional twitch (rarer guns twitch more often). */
  private nextTwitch: number;
  private twitch = 0;
  private twitchAxis = new THREE.Vector3();
  /** Spent feed sacs falling away from a magazine reload. */
  private spent: { obj: THREE.Object3D; v: THREE.Vector3; age: number }[] = [];
  private lastReload: number | null = null;
  private fedShells = 0;
  private shellGulp = 0;

  constructor(id: WeaponId, glow: string, seed: number) {
    this.def = WEAPONS[id] as WeaponDef;
    this.reloadStyle = this.def.reload.style;
    this.zooms = this.def.ads !== false;
    this.rarity = this.def.rarity;
    const feel = WEAPON_FEEL.fire[this.def.class];
    this.kick = { back: feel.push, pitch: THREE.MathUtils.degToRad(feel.kick) * 0.6, roll: feel.shake * 0.25 };
    // ln(100)/settle: the spring envelope falls to ~1% by the class's settle time.
    this.omega = 4.6 / (feel.settle * 0.55);
    this.fxColour = mix(glow, ORGANIC.amber, 0.6);
    this.gun.add(this.flex);
    this.m = materials(glow);
    this.cores.push(this.m.core);
    this.rand = rng(seed);
    this.nextTwitch = this.twitchGap();
    this.muzzle.name = 'muzzle';
    this.flex.add(this.muzzle);
  }

  /** Rarer guns are more alive: a relic twitches twice as often as a common gun. */
  protected get life(): number { return RARITY_LIFE[this.rarity]; }

  private twitchGap(): number {
    const [a, b] = WEAPON_FEEL.idle.twitchEvery;
    return (a + this.rand() * (b - a)) / this.life;
  }

  protected add(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.flex): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  /** A graft socket, only if Design's entry lists the slot (no sight socket on a gun that does not aim). */
  protected socket(slot: ModSlot, at: THREE.Vector3): void {
    if (!this.def.modSlots.includes(slot)) return;
    const o = new THREE.Object3D();
    o.name = `socket:${slot}`;
    o.position.copy(at);
    this.flex.add(o);
    this.sockets[slot] = o;
  }

  get grafts(): ModSlot[] { return [...this.grown].filter(([, g]) => g.on).map(([k]) => k); }
  get graftMods(): Partial<Record<ModSlot, string>> {
    const out: Partial<Record<ModSlot, string>> = {};
    for (const [k, g] of this.grown) if (g.on) out[k] = g.mod;
    return out;
  }

  graft(slot: ModSlot, on = true, mod?: string): void {
    const at = this.sockets[slot];
    if (!at) return;
    const id = mod && MODS[mod]?.slot === slot ? mod : 'generic';
    const have = this.grown.get(slot);
    if (have && (have.mod === id || !on)) { have.on = on; return; }
    if (!on) return;
    if (have) at.remove(have.obj); // a different mod replaces the old graft
    const k = this.size * 1.4; // grafts read clearly at a glance in first person
    const obj = id === 'generic' ? graftMesh(slot, k, this.m, this.rand) : modGraft(id, k, this.m, this.rand);
    obj.scale.setScalar(0.001);
    obj.traverse((o: THREE.Object3D) => { o.frustumCulled = false; });
    at.add(obj);
    this.grown.set(slot, { obj, k: 0, on: true, mod: id });
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
    const idle = WEAPON_FEEL.idle.breathe;
    // Fire: kick the spring; it jolts back and wobbles home within the class's settle time.
    const w = this.omega;
    if (s.sinceFire < dt + 1e-4) this.flinchV += w * 1.9;
    this.flinchV += (-this.flinch * w * w - this.flinchV * 2 * 0.55 * w) * dt;
    this.flinch += this.flinchV * dt;
    const equip = s.equip === undefined ? 1 : THREE.MathUtils.clamp(s.equip, 0, 1);
    const wake = smooth(equip) * (1 - smooth(s.holster ?? 0));
    const r = s.reload;
    for (const b of this.breathers) b.obj.scale.setScalar(1 + Math.sin(t * b.rate) * b.amp);
    // Regrow pulses the glow while new tissue swells; otherwise chambers glow with the feed.
    const regrowing = r !== null && this.reloadStyle === 'regrow';
    const pulse = regrowing ? Math.pow(Math.max(0, Math.sin(t * 7)), 4) * smooth((r - 0.3) / 0.4) : 0;
    for (const c of this.cores) c.emissiveIntensity = (0.35 + 0.65 * s.ammo + pulse * 1.2) * (1 + fire * 1.5) * (0.15 + 0.85 * wake) * (0.85 + 0.15 * this.life);
    this.flex.position.set(0, 0, 0);
    this.flex.rotation.set(0, 0, 0);
    this.pose(t, { ...s, equip }, fire);
    // Idle breathing (WEAPON_FEEL.idle) and the odd twitch.
    const breath = Math.sin((t / idle.period) * Math.PI * 2);
    this.flex.position.y += breath * idle.amplitude * this.life;
    this.nextTwitch -= dt;
    if (this.nextTwitch <= 0) {
      this.twitch = 1;
      this.twitchAxis.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize();
      this.nextTwitch = this.twitchGap();
    }
    this.twitch = Math.max(0, this.twitch - dt * 5);
    const tw = this.twitch * Math.sin(this.twitch * 30) * 0.04;
    this.flex.rotation.x += this.twitchAxis.x * tw;
    this.flex.rotation.y += this.twitchAxis.y * tw;
    this.flex.rotation.z += this.twitchAxis.z * tw;
    // The shot: the whole organism jolts back and climbs, the main flesh squashes along the barrel.
    const f = this.flinch;
    this.flex.position.z += f * this.kick.back;
    this.flex.rotation.x += f * this.kick.pitch;
    this.flex.rotation.z += f * this.kick.roll * Math.sin(t * 37);
    let sx = 1 + f * 0.06, sz = 1 - f * 0.08;
    sx *= 1 + breath * 0.01 * this.life;
    // Reload beats (WEAPON_FEEL.reload) shared by every body; each body adds its own feed motion in pose().
    if (r !== null) this.reloadBeats(t, r, s);
    else { this.lastReload = null; this.fedShells = 0; }
    if (regrowing) {
      // Regrow: curl inward (0..0.3), tissue swells in pulses (0.3..0.95), uncurl and flex at the end.
      const curl = smooth(r / 0.25) * (1 - smooth((r - 0.9) / 0.1));
      this.flex.rotation.x -= curl * 0.3;
      this.flex.rotation.z += curl * 0.2;
      sx *= 1 + pulse * 0.08;
      this.flex.rotation.y += bump(r, 0.9, 1) * Math.sin(t * 34) * 0.04;
    }
    this.shellGulp = Math.max(0, this.shellGulp - dt * 5);
    sx *= 1 + this.shellGulp * 0.06;
    if (this.flesh) this.flesh.scale.set(sx, sx, sz);
    // The draw: the organism wakes as it comes up, a curl uncoiling with a shudder at the end.
    if (wake < 1) {
      this.flex.rotation.x += (1 - wake) * -0.9;
      this.flex.rotation.z += (1 - wake) * 0.6;
      this.flex.position.y += (1 - wake) * -0.08;
      this.flex.rotation.y += bump(equip, 0.7, 1) * Math.sin(t * 40) * 0.03;
    }
    for (const [, g] of this.grown) {
      g.k = THREE.MathUtils.clamp(g.k + (g.on ? dt : -dt) / 0.7, 0, 1);
      // Grafts bud in with an overshoot and then breathe with the body.
      const k = g.on ? smooth(g.k) * (1 + bump(g.k, 0.6, 1) * 0.2) : smooth(g.k);
      g.obj.scale.setScalar(Math.max(0.001, k * (1 + Math.sin(t * 2.3) * 0.015)));
      g.obj.visible = g.k > 0;
    }
    this.updateSpent(dt, t);
  }

  /** Spent sacs torn out on a magazine reload: they fall from the gun and twitch for a couple of seconds. */
  get spentCount(): number { return this.spent.length; }

  private reloadBeats(t: number, r: number, s: WeaponPose): void {
    const was = this.lastReload ?? -1;
    this.lastReload = r;
    if (this.reloadStyle === 'magazine') {
      // 0.0: arm tilts, spent sac twitches. 0.2: torn free and dropped. 0.5: fresh sac pressed in. 0.8: shudder, ready.
      if (was < 0.2 && r >= 0.2) this.tearSpent();
      this.flex.rotation.z += bump(r, 0, 0.9) * 0.35;
      this.flex.rotation.x += bump(r, 0.15, 0.3) * 0.12 - bump(r, 0.5, 0.62) * 0.1;
      this.flex.rotation.y += bump(r, 0.8, 0.95) * Math.sin(t * 38) * 0.05 + bump(r, 0, 0.18) * Math.sin(t * 50) * 0.02;
    } else if (this.reloadStyle === 'perShell') {
      // The jaw (throat, cylinder) opens, a shell is thumbed in with a gulp, it closes round it.
      const shells = s.shells ?? 0;
      if (shells > this.fedShells) { this.shellGulp = 1; this.fedShells = shells; }
      this.flex.rotation.z += 0.3 * smooth(r / 0.1) * (1 - smooth((r - 0.92) / 0.08));
      this.flex.rotation.x += this.shellGulp * 0.05;
    }
  }

  private tearSpent(): void {
    const src = this.mag;
    if (!src) return;
    const copy = src.clone(true);
    // Put the copy in the root frame where the feed was, so it falls free of the gun's own motion.
    this.gun.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.gun.matrixWorld).invert();
    copy.matrix.multiplyMatrices(inv, src.matrixWorld);
    copy.matrix.decompose(copy.position, copy.quaternion, copy.scale);
    copy.name = 'spent';
    this.gun.add(copy);
    this.spent.push({ obj: copy, v: new THREE.Vector3(0.15 + this.rand() * 0.1, 0.25, 0.1), age: 0 });
  }

  private updateSpent(dt: number, t: number): void {
    for (const p of this.spent) {
      p.age += dt;
      p.v.y -= 9.8 * dt * 0.35; // viewmodel space: a slowed fall that still reads as dropping
      p.obj.position.addScaledVector(p.v, dt);
      // It twitches like something still alive.
      p.obj.rotation.x += Math.sin(t * 23 + p.age * 7) * 0.08 * Math.exp(-p.age);
      p.obj.rotation.z += dt * 3;
    }
    const keep = this.spent.filter((p) => p.age < 2);
    for (const p of this.spent) if (p.age >= 2) this.gun.remove(p.obj);
    this.spent = keep;
  }

  protected abstract pose(t: number, s: Pose, fire: number): void;
}

/** Quillet (sidearm): a porcupine-quill pistol with a fanged muzzle; the quills re-sprout along its back to reload. */
class Sidearm extends Body {
  readonly id = 'quillet';
  readonly muzzleFx: MuzzleFx = 'quill';
  private gland: THREE.Group;
  private quills: THREE.Mesh[] = [];
  private fangs: THREE.Mesh;
  constructor(seed = 1) {
    super('quillet', mix(PATH.melee, ORGANIC.amber, 0.5), seed);
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
    this.mag = this.gland;
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
  readonly muzzleFx: MuzzleFx = 'spore';
  private drum: THREE.Group;
  private barrels: THREE.Mesh;
  constructor(seed = 2) {
    super('hiveSpitter', mix(HIVE.acid, ORGANIC.mist, 0.4), seed);
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
    this.mag = this.drum;
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
  readonly muzzleFx: MuzzleFx = 'spore';
  private clip: THREE.Group;
  private verts: THREE.Mesh;
  constructor(seed = 3) {
    super('vertebraRifle', mix(ZONE7.cyan, ORGANIC.mist, 0.45), seed);
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
    this.mag = this.clip;
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
  readonly muzzleFx: MuzzleFx = 'spit';
  private jaws: THREE.Group[] = [];
  private throat: THREE.Mesh;
  private lastShells = 0;
  private gulp = 0;
  constructor(seed = 4) {
    super('gulletScatter', mix(PATH.melee, HIVE.danger, 0.3), seed);
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
  readonly muzzleFx: MuzzleFx = 'beam';
  private eye: THREE.Group;
  private pod: THREE.Group;
  private eyeMat: THREE.MeshPhysicalMaterial;
  constructor(seed = 5) {
    super('eyestalkMarksman', mix(ZONE7.violet, ORGANIC.mist, 0.4), seed);
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
    this.mag = this.pod;
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
  readonly muzzleFx: MuzzleFx = 'bile';
  private egg: THREE.Group;
  private mouth: THREE.Mesh;
  constructor(seed = 6) {
    super('broodMortar', mix(ORGANIC.amber, HIVE.acid, 0.3), seed);
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
    this.mag = this.egg;
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

/** Marrow Hand (heavy sidearm): a bone hand-cannon; its knuckle cylinder swings out and each knuckle is packed with marrow. */
class MarrowHand extends Body {
  readonly id = 'marrowHand';
  readonly muzzleFx: MuzzleFx = 'spit';
  private cylinder: THREE.Group;
  private knuckles: THREE.Mesh[] = [];
  private hammer: THREE.Mesh;
  constructor(seed = 7) {
    super('marrowHand', mix(ORGANIC.amber, HIVE.danger, 0.25), seed);
    this.flesh = this.add(lathe(0.16, (t) => 0.026 + Math.sin(t * Math.PI) * 0.016, 15).translate(0, 0, 0.13), this.m.fleshDeep);
    // Bone frame: a palm plate over the top joining the grip hump to the barrel.
    this.add(roughen(taperTube([V(0, 0.035, 0.12), V(0, 0.042, 0.0), V(0, 0.034, -0.09)], [0.016, 0.02, 0.016], 8, 5).scale(1.6, 1, 1), 0.0015, 90, 2), this.m.boneDark);
    // A heavy bone barrel: a long finger bone with joint knuckles, a split fingernail at the muzzle.
    const bar: THREE.BufferGeometry[] = [taperTube([V(0, 0.012, -0.08), V(0, 0.014, -0.18), V(0, 0.012, -0.28)], [0.02, 0.018, 0.017], 9, 5)];
    for (const z of [-0.13, -0.21]) bar.push(new THREE.SphereGeometry(0.024, 12, 8).scale(1, 0.9, 0.7).translate(0, 0.013, z));
    bar.push(new THREE.SphereGeometry(0.02, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.1, 0.5, 1.6).rotateX(-0.2).translate(0, 0.03, -0.27));
    this.add(roughen(merge(bar), 0.0015, 90, 3), this.m.bone);
    this.muzzle.position.set(0, 0.012, -0.29);
    // The knuckle cylinder: five knuckle bones round an axle, each with a glowing marrow core.
    this.cylinder = new THREE.Group();
    this.cylinder.position.set(0, 0.0, -0.035);
    this.add(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 8).rotateX(Math.PI / 2), this.m.boneDark, this.cylinder);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, k = new THREE.Group();
      k.position.set(Math.cos(a) * 0.028, Math.sin(a) * 0.028, 0);
      this.add(roughen(new THREE.SphereGeometry(0.019, 12, 8).scale(1, 1, 1.9), 0.0012, 120, i), this.m.bone, k);
      this.knuckles.push(this.add(new THREE.SphereGeometry(0.009, 8, 6).scale(1, 1, 1.4).translate(0, 0, -0.033), this.m.core, k));
      this.cylinder.add(k);
    }
    this.flex.add(this.cylinder);
    // Hammer: a hooked claw over the back.
    this.hammer = this.add(spike(0.045, 0.008, 0.9).rotateX(-0.4), this.m.boneDark);
    this.hammer.position.set(0, 0.04, 0.06);
    this.setGrip(V(0, -0.035, 0.07), 0.11);
    this.size = 0.9;
    this.socket('barrel', V(0, 0.012, -0.28)); this.socket('sight', V(0, 0.06, -0.08)); this.socket('under', V(0, -0.02, -0.16)); this.socket('chamber', V(0.045, 0.0, 0.08));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    // Each shot cocks the claw hammer and indexes the cylinder one knuckle.
    this.hammer.rotation.x = -fire * 0.9;
    const left = Math.round(s.ammo * 5);
    this.knuckles.forEach((k, i) => { k.visible = r !== null ? r > 0.4 + i * 0.08 : i < left || s.ammo >= 1; });
    const out = r === null ? 0 : r < 0.5 ? smooth((r - 0.05) / 0.2) : 1 - smooth((r - 0.82) / 0.12);
    this.cylinder.position.x = out * 0.05;
    this.cylinder.rotation.z = (5 - left) * ((Math.PI * 2) / 5) * (r === null ? 1 : 0) + (r === null ? 0 : r * 8);
    this.flex.rotation.set(r === null ? 0 : bump(r, 0, 1) * 0.15, 0, r === null ? 0 : -bump(r, 0, 1) * 0.6 + bump(r, 0.8, 0.95) * 0.25);
    void t;
  }
}

/** Stinger Choir (burst SMG): three venom stingers on a cicada abdomen; the stingers retract and push out fresh. */
class StingerChoir extends Body {
  readonly id = 'stingerChoir';
  readonly muzzleFx: MuzzleFx = 'quill';
  private stingers: THREE.Group[] = [];
  private tymbal: THREE.Mesh;
  constructor(seed = 8) {
    super('stingerChoir', mix(PATH.stealth, ORGANIC.mist, 0.55), seed);
    // The abdomen: banded segments (a lathe with ridges) from the grip forward.
    this.flesh = this.add(lathe(0.34, (t) => 0.036 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.024 + (Math.sin(t * 40) > 0.6 ? 0.004 : 0), 17).translate(0, 0, 0.14), this.m.fleshDeep);
    const bands: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) bands.push(new THREE.TorusGeometry(0.064 - Math.abs(i - 2.5) * 0.005, 0.007, 5, 18, Math.PI * 1.3).rotateZ(-0.15 * Math.PI).translate(0, 0.002, 0.12 - i * 0.05));
    this.add(merge(bands), this.m.bone);
    // Tymbal: the drum membrane on the flank that sings with each burst.
    this.tymbal = this.add(new THREE.SphereGeometry(0.03, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.4).rotateZ(-Math.PI / 2).scale(0.5, 1, 1.4).translate(0.045, 0.005, 0.02), this.m.sac);
    // Venom sac slung under the abdomen: the magazine the host tears out.
    const venom = new THREE.Group();
    venom.position.set(0, -0.05, -0.04);
    this.add(roughen(new THREE.SphereGeometry(0.026, 14, 10).scale(0.8, 1, 1.5), 0.002, 60, 2), this.m.sac, venom);
    this.add(new THREE.SphereGeometry(0.013, 10, 8).scale(1, 1, 1.5), this.m.core, venom);
    this.flex.add(venom);
    this.mag = venom;
    // Three stingers in a triangle at the front.
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i / 3) * Math.PI * 2, g = new THREE.Group();
      g.position.set(Math.cos(a) * 0.022, Math.sin(a) * 0.022, -0.2);
      g.rotation.set(-Math.sin(a) * 0.08, Math.cos(a) * 0.08, 0);
      this.add(spike(0.16, 0.011, 0.1).rotateX(-Math.PI / 2), this.m.bone, g);
      this.add(new THREE.SphereGeometry(0.009, 8, 6).scale(1, 1, 1.6).translate(0, 0, 0.005), this.m.core, g);
      this.flex.add(g);
      this.stingers.push(g);
    }
    this.muzzle.position.set(0, 0, -0.32);
    // Folded wings along the back (glassy, veined).
    for (const sd of [-1, 1]) {
      const w = this.add(wing(0.22, 0.06, this.rand, 1), this.m.sac);
      w.rotation.set(Math.PI / 2, 0, sd * 0.5);
      w.position.set(sd * 0.02, 0.06, 0.14);
    }
    this.setGrip(V(0, -0.03, 0.09), 0.1);
    this.size = 0.9;
    this.socket('barrel', V(0, 0, -0.3)); this.socket('sight', V(0, 0.07, -0.04)); this.socket('under', V(0, -0.035, -0.14)); this.socket('chamber', V(0.055, 0.0, 0.09));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    // Burst: the three stingers pump in turn and the tymbal buckles.
    this.stingers.forEach((g, i) => {
      const pump = Math.exp(-Math.max(0, s.sinceFire - i * 0.04) * 30) * (s.sinceFire >= i * 0.04 ? 1 : 0);
      const ext = r === null ? 1 : r < 0.3 ? 1 - smooth(r / 0.3) : smooth((r - 0.45 - i * 0.12) / 0.2);
      g.position.z = -0.2 + pump * 0.025 + (1 - ext) * 0.12;
      g.scale.setScalar(0.4 + 0.6 * ext);
    });
    this.tymbal.scale.set(1 - fire * 0.5, 1, 1);
    this.flex.rotation.set(r === null ? 0 : bump(r, 0, 1) * 0.12, 0, r === null ? 0 : bump(r, 0, 1) * 0.4 + Math.sin(t * 30) * bump(r, 0.4, 0.9) * 0.02);
  }
}

/** Cicadine (burst rifle): a beetle body whose wing-cases snap open with each burst; a fat larva cartridge feeds in underneath. */
class Cicadine extends Body {
  readonly id = 'cicadine';
  readonly muzzleFx: MuzzleFx = 'spore';
  private elytra: THREE.Group[] = [];
  private larva: THREE.Group;
  constructor(seed = 9) {
    super('cicadine', mix(ZONE7.lime, ORGANIC.amber, 0.5), seed);
    this.flesh = this.add(lathe(0.4, (t) => 0.03 + Math.sin(Math.pow(t, 0.7) * Math.PI) * 0.02 - t * 0.008, 19).translate(0, 0, 0.18), this.m.fleshDeep);
    // Wing-cases: two domed shells hinged along the spine.
    for (const sd of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sd * 0.004, 0.02, 0.16);
      this.add(roughen(new THREE.SphereGeometry(0.07, 20, 12, 0, Math.PI / 2, 0, Math.PI).rotateY(sd > 0 ? -Math.PI / 4 : (Math.PI * 3) / 4).scale(0.85, 0.75, 2.2).translate(0, 0, -0.16), 0.0015, 90, sd + 2), this.m.boneDark, g);
      this.flex.add(g);
      this.elytra.push(g);
    }
    // Snout barrel: a proboscis with feeding ridges.
    const b: THREE.BufferGeometry[] = [taperTube([V(0, 0.01, -0.2), V(0, 0.012, -0.36), V(0, 0.006, -0.5)], [0.016, 0.012, 0.008], 8, 6)];
    for (let i = 0; i < 6; i++) b.push(new THREE.TorusGeometry(0.014 - i * 0.001, 0.0028, 4, 12).translate(0, 0.011, -0.24 - i * 0.04));
    this.add(roughen(merge(b), 0.001, 120, 5), this.m.bone);
    this.muzzle.position.set(0, 0.006, -0.51);
    // Compound sighting eyes either side of the snout.
    const eye = alienEye(mix(ZONE7.lime, ORGANIC.amber, 0.4), HIVE.bone);
    for (const sd of [-1, 1]) { const e = this.add(new THREE.SphereGeometry(0.014, 14, 10).scale(1, 1, 1.3), eye); e.position.set(sd * 0.03, 0.03, -0.17); e.rotation.y = Math.PI; }
    this.sight = new THREE.Object3D();
    this.sight.name = 'sight';
    this.sight.position.set(0, 0.07, 0.06);
    this.flex.add(this.sight);
    // Stock: hind legs folded back.
    this.add(roughen(merge([-1, 1].map((sd) => taperTube([V(sd * 0.02, -0.01, 0.2), V(sd * 0.03, -0.02, 0.29), V(sd * 0.012, -0.04, 0.36)], [0.01, 0.009, 0.012], 6, 4))), 0.0015, 80, 6), this.m.bone);
    this.larva = new THREE.Group();
    this.larva.position.set(0, -0.05, -0.06);
    const segs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) segs.push(new THREE.SphereGeometry(0.016 - Math.abs(i - 2) * 0.002, 12, 8).translate(0, -i * 0.016, -i * 0.006));
    this.add(merge(segs), this.m.sac, this.larva);
    this.add(new THREE.SphereGeometry(0.009, 8, 6).scale(1, 4, 1).translate(0, -0.03, -0.012), this.m.core, this.larva);
    this.flex.add(this.larva);
    this.mag = this.larva;
    this.setGrip(V(0, -0.03, 0.1), 0.1);
    this.socket('barrel', V(0, 0.006, -0.5)); this.socket('sight', V(0, 0.075, -0.02)); this.socket('under', V(0, -0.012, -0.3)); this.socket('chamber', V(0.05, 0.0, 0.06));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    // Each burst flicks the wing-cases open; a reload props them wide while the larva is swapped.
    const open = Math.max(fire * 0.6, r === null ? 0 : bump(r, 0.05, 0.95) * 0.9);
    this.elytra.forEach((g, i) => { g.rotation.z = (i ? -1 : 1) * open * 0.7; });
    const out = r === null ? 0 : r < 0.45 ? smooth((r - 0.1) / 0.25) : 1 - smooth((r - 0.55) / 0.25);
    this.larva.position.set(0, -0.05 - out * 0.12, -0.06 + out * 0.03);
    this.larva.rotation.x = out * (0.7 + Math.sin(t * 5) * 0.1);
    this.flex.rotation.set(r === null ? 0 : bump(r, 0, 1) * 0.1, 0, r === null ? 0 : bump(r, 0, 1) * 0.4);
  }
}

/** Bloomcannon (auto shotgun): a flower-head drum of sticky seed globs; the petals close round the spent head and open on a fresh one. */
class Bloomcannon extends Body {
  readonly id = 'bloomcannon';
  readonly muzzleFx: MuzzleFx = 'bile';
  private petals: THREE.Group[] = [];
  private seeds: THREE.Group;
  constructor(seed = 10) {
    super('bloomcannon', mix(PATH.viral, ORGANIC.amber, 0.45), seed);
    this.flesh = this.add(lathe(0.36, (t) => 0.04 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.028, 21).translate(0, 0, 0.16), this.m.fleshDeep);
    // Stem barrel: a thick, fibrous stalk with root sinews down its length.
    const st: THREE.BufferGeometry[] = [taperTube([V(0, 0, -0.18), V(0, 0.004, -0.28), V(0, 0, -0.34)], [0.03, 0.026, 0.03], 10, 4)];
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; st.push(taperTube([V(Math.cos(a) * 0.03, Math.sin(a) * 0.03, -0.12), V(Math.cos(a) * 0.028, Math.sin(a) * 0.028, -0.24), V(Math.cos(a) * 0.034, Math.sin(a) * 0.034, -0.34)], [0.006, 0.005, 0.007], 5, 4)); }
    this.add(roughen(merge(st), 0.0015, 90, 4), this.m.flesh);
    // The flower head: a seed drum ringed with fleshy petals that peel back to fire.
    this.seeds = new THREE.Group();
    this.seeds.position.set(0, 0, -0.36);
    this.add(new THREE.SphereGeometry(0.036, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 0.5), this.m.sac, this.seeds);
    const sd: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) { const a = i * 2.4, rr = 0.008 + Math.sqrt(i / 9) * 0.022; sd.push(new THREE.SphereGeometry(0.007, 8, 6).translate(Math.cos(a) * rr, Math.sin(a) * rr, -0.012)); }
    this.add(merge(sd), this.m.core, this.seeds);
    this.flex.add(this.seeds);
    this.mag = this.seeds;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, g = new THREE.Group();
      g.position.set(Math.cos(a) * 0.04, Math.sin(a) * 0.04, -0.34);
      g.rotation.z = a - Math.PI / 2;
      this.add(roughen(new THREE.SphereGeometry(0.04, 12, 8).scale(0.75, 0.14, 1.5).translate(0, 0, -0.05), 0.0015, 120, i), i % 2 ? this.m.flesh : this.m.bone, g);
      this.flex.add(g);
      this.petals.push(g);
    }
    this.muzzle.position.set(0, 0, -0.4);
    this.setGrip(V(0, -0.035, 0.1), 0.11);
    this.size = 1.15;
    this.socket('barrel', V(0, 0, -0.42)); this.socket('sight', V(0, 0.075, -0.06)); this.socket('under', V(0, -0.04, -0.22)); this.socket('chamber', V(0.065, 0.0, 0.1));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    // Petals flare on each shot; on reload they close round the spent head (0.1..0.4) and bloom open on a new one.
    const closed = r === null ? 0 : r < 0.5 ? smooth((r - 0.05) / 0.3) : 1 - smooth((r - 0.6) / 0.3);
    const flare = fire * 0.5 + Math.sin(t * 1.3) * 0.04;
    for (const p of this.petals) p.rotation.x = 0.7 + flare - closed * 1.3;
    this.seeds.scale.setScalar(r === null ? 1 + fire * 0.15 : r < 0.45 ? 1 - smooth((r - 0.2) / 0.2) * 0.999 : smooth((r - 0.45) / 0.35));
    this.flex.rotation.set(r === null ? 0 : -bump(r, 0, 1) * 0.12, 0, r === null ? 0 : bump(r, 0, 1) * 0.35);
  }
}

/** Leviathan Quill (sniper): a deep-sea jaw for a barrel, a harpoon quill laid in its gum line; the jaw unhinges to take the next quill. */
class LeviathanQuill extends Body {
  readonly id = 'leviathanQuill';
  readonly muzzleFx: MuzzleFx = 'quill';
  private jaw: THREE.Group;
  private quill: THREE.Mesh;
  private lure: THREE.Mesh;
  constructor(seed = 11) {
    super('leviathanQuill', mix(ZONE7.cyan, ORGANIC.mist, 0.55), seed);
    this.flesh = this.add(lathe(0.3, (t) => 0.032 + Math.sin(Math.pow(t, 0.6) * Math.PI) * 0.022, 23).translate(0, 0, 0.22), this.m.fleshDeep);
    this.add(roughen(taperTube([V(0, 0.005, 0.22), V(0, -0.01, 0.34), V(0, -0.035, 0.44)], [0.02, 0.018, 0.03], 8, 3), 0.003, 50, 5), this.m.bone);
    // Upper jaw: a long bone snout with a row of needle teeth hanging under it.
    const up: THREE.BufferGeometry[] = [taperTube([V(0, 0.02, -0.06), V(0, 0.024, -0.4), V(0, 0.016, -0.8)], [0.022, 0.016, 0.008], 9, 8).scale(1.3, 0.7, 1)];
    for (let i = 0; i < 16; i++) for (const sd of [-1, 1]) up.push(spike(0.018 + this.rand() * 0.012, 0.0028, 0.3).rotateX(Math.PI).translate(sd * 0.012, 0.012, -0.1 - i * 0.042));
    this.add(roughen(merge(up), 0.0012, 110, 4), this.m.bone);
    // Lower jaw: hinged at the receiver, it drops to load.
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.005, -0.05);
    const lo: THREE.BufferGeometry[] = [taperTube([V(0, -0.01, 0), V(0, -0.012, -0.3), V(0, -0.004, -0.62)], [0.016, 0.012, 0.006], 8, 6).scale(1.3, 0.7, 1)];
    for (let i = 0; i < 12; i++) for (const sd of [-1, 1]) lo.push(spike(0.014 + this.rand() * 0.01, 0.0024, 0.3).translate(sd * 0.01, -0.006, -0.06 - i * 0.045));
    this.add(roughen(merge(lo), 0.0012, 110, 5), this.m.boneDark, this.jaw);
    this.flex.add(this.jaw);
    // The harpoon quill riding between the jaws, barbed and glowing at the root.
    this.quill = this.add(merge([taperTube([V(0, 0, 0.0), V(0, 0, -0.5)], [0.006, 0.003], 6, 6), spike(0.05, 0.008, 0).rotateX(-Math.PI / 2).translate(0, 0, -0.5), ...[0, 1, 2].map((i) => spike(0.025, 0.004, 0.3).rotateX(-2.4).rotateZ(i * 2.1).translate(0, 0, -0.46))]), this.m.core);
    this.quill.position.set(0, 0.004, -0.08);
    this.muzzle.position.set(0, 0.004, -0.82);
    // A deep-sea lure dangling from the snout: the scope eye.
    this.add(taperTube([V(0, 0.03, -0.02), V(0, 0.07, -0.04), V(0, 0.075, -0.08)], [0.005, 0.004, 0.003], 5, 4), this.m.fleshDeep);
    this.lure = this.add(new THREE.SphereGeometry(0.016, 16, 12), alienEye(mix(ZONE7.cyan, ORGANIC.amber, 0.3), HIVE.bone));
    this.lure.position.set(0, 0.07, -0.09);
    this.lure.rotation.y = Math.PI;
    this.sight = new THREE.Object3D();
    this.sight.name = 'sight';
    this.sight.position.set(0, 0.07, 0.04);
    this.flex.add(this.sight);
    this.setGrip(V(0, -0.025, 0.14), 0.1);
    this.size = 1.1;
    this.socket('barrel', V(0, 0.006, -0.8)); this.socket('sight', V(0, 0.05, 0.06)); this.socket('under', V(0, -0.03, -0.3)); this.socket('chamber', V(0.042, 0.0, 0.14));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    // Firing snaps the jaw shut on the throw; the lure sways unless aimed.
    const gape = r === null ? 0 : bump(r, 0.05, 0.95);
    this.jaw.rotation.x = gape * 0.35 - fire * 0.05;
    this.quill.visible = r === null ? s.ammo > 0 : r > 0.45;
    this.quill.position.z = -0.08 + (r === null ? 0 : (1 - smooth((r - 0.45) / 0.35)) * 0.4);
    this.lure.position.y = 0.07 + Math.sin(t * 1.4) * 0.004 * (1 - s.aim);
    this.flex.rotation.set(r === null ? 0 : -bump(r, 0, 1) * 0.15, 0, r === null ? 0 : bump(r, 0, 1) * 0.3);
  }
}

/** Tumor Launcher: a swollen, lumpy growth that ripens a sticky bolt in its chamber; to reload a new tumour swells up and splits. */
class TumorLauncher extends Body {
  readonly id = 'tumorLauncher';
  readonly muzzleFx: MuzzleFx = 'bile';
  private lumps: THREE.Mesh[] = [];
  private bolt: THREE.Group;
  private lips: THREE.Mesh;
  constructor(seed = 12) {
    super('tumorLauncher', mix(HIVE.danger, ORGANIC.amber, 0.5), seed);
    this.flesh = this.add(lathe(0.42, (t) => 0.05 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.03, 25).translate(0, 0, 0.2), this.m.flesh);
    // Tumours bulging all over the body, each with a sunken pore.
    for (let i = 0; i < 9; i++) {
      const a = this.rand() * Math.PI * 2, z = 0.16 - this.rand() * 0.34, r = 0.018 + this.rand() * 0.016;
      const m = this.add(roughen(new THREE.SphereGeometry(r, 12, 10), r * 0.12, 60 / r / 30, i), i % 3 ? this.m.fleshDeep : this.m.flesh);
      m.position.set(Math.cos(a) * 0.072, Math.sin(a) * 0.072, z);
      this.lumps.push(m);
    }
    // Wide wet muzzle: puckered lips of flesh with a bone rim.
    this.lips = this.add(new THREE.TorusGeometry(0.045, 0.016, 10, 20).scale(1, 1, 0.8).translate(0, 0, -0.25), this.m.fleshDeep);
    this.add(needleRing(0.04, 9, 0.02, this.rand, 0.8).rotateX(-Math.PI / 2).translate(0, 0, -0.26), this.m.bone);
    this.muzzle.position.set(0, 0, -0.27);
    this.bolt = new THREE.Group();
    this.bolt.position.set(0, 0, -0.18);
    this.add(roughen(new THREE.SphereGeometry(0.03, 14, 10).scale(1, 1, 1.4), 0.003, 50, 3), this.m.sac, this.bolt);
    this.add(new THREE.SphereGeometry(0.018, 10, 8).scale(1, 1, 1.4), this.m.core, this.bolt);
    this.flex.add(this.bolt);
    this.mag = this.bolt;
    this.add(roughen(taperTube([V(0, 0.07, 0.15), V(0, 0.085, 0.0), V(0, 0.07, -0.15)], [0.012, 0.016, 0.01], 7, 4), 0.002, 50, 1), this.m.bone);
    this.setGrip(V(0, -0.05, 0.1), 0.1);
    this.size = 1.3;
    this.socket('barrel', V(0, 0, -0.27)); this.socket('sight', V(0, 0.1, -0.05)); this.socket('under', V(0, -0.075, -0.12)); this.socket('chamber', V(0.085, 0.0, 0.08));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    this.lumps.forEach((m, i) => m.scale.setScalar(1 + Math.sin(t * 1.7 + i * 1.3) * 0.015 + (r === null ? 0 : bump(r, 0.3 + (i % 3) * 0.1, 0.8) * 0.35)));
    this.lips.scale.set(1 + fire * 0.4, 1 + fire * 0.4, 1);
    // Regrow: the old bolt is gone, a new tumour ripens in the chamber and slides to the lips.
    const ripe = r === null ? (s.ammo > 0 ? 1 : 0) : smooth((r - 0.2) / 0.6);
    this.bolt.scale.setScalar(Math.max(0.001, ripe));
    this.bolt.position.z = -0.18 + (1 - ripe) * 0.1;
    this.flex.rotation.set(r === null ? 0 : bump(r, 0, 1) * 0.12, 0, r === null ? 0 : -bump(r, 0, 1) * 0.25);
  }
}

/** Lumen Lance (charge beam): a lance of glass-bone with a light-organ running its length; it regrows charge rather than holding ammo. */
class LumenLance extends Body {
  readonly id = 'lumenLance';
  readonly muzzleFx: MuzzleFx = 'beam';
  private rings: THREE.Group[] = [];
  private organ: THREE.Mesh;
  private organMat: THREE.MeshStandardMaterial;
  constructor(seed = 13) {
    super('lumenLance', mix(PATH.dna, ORGANIC.mist, 0.35), seed);
    this.flesh = this.add(lathe(0.26, (t) => 0.03 + Math.sin(Math.pow(t, 0.7) * Math.PI) * 0.02, 27).translate(0, 0, 0.16), this.m.fleshDeep);
    // The lance: a translucent glass-bone shaft over a glowing light-organ.
    this.add(taperTube([V(0, 0.008, -0.08), V(0, 0.008, -0.4), V(0, 0.008, -0.66)], [0.02, 0.016, 0.006], 12, 8), this.m.sac);
    this.organMat = this.m.core.clone();
    this.cores.push(this.organMat);
    this.organ = this.add(taperTube([V(0, 0.008, -0.08), V(0, 0.008, -0.4), V(0, 0.008, -0.62)], [0.008, 0.006, 0.002], 8, 8), this.organMat);
    // Bone collars that slide forward as charge builds.
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.position.set(0, 0.008, -0.14 - i * 0.11);
      this.add(roughen(new THREE.TorusGeometry(0.024 - i * 0.003, 0.006, 6, 16), 0.001, 120, i), this.m.bone, g);
      for (let k = 0; k < 3; k++) this.add(spike(0.03, 0.004, 0.4).rotateZ((k / 3) * Math.PI * 2).translate(0, 0.024 - i * 0.003, 0), this.m.boneDark, g);
      this.flex.add(g);
      this.rings.push(g);
    }
    this.muzzle.position.set(0, 0.008, -0.68);
    this.add(roughen(taperTube([V(0, 0.0, 0.16), V(0, -0.015, 0.26), V(0, -0.035, 0.34)], [0.018, 0.016, 0.022], 7, 3), 0.002, 60, 6), this.m.bone);
    this.setGrip(V(0, -0.03, 0.1), 0.1);
    this.socket('barrel', V(0, 0.008, -0.66)); this.socket('sight', V(0, 0.055, -0.02)); this.socket('under', V(0, -0.02, -0.3)); this.socket('chamber', V(0.042, 0.0, 0.08));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    // Charge is the ammo fill: the collars creep forward and spin, the organ brightens toward the tip.
    const charge = r === null ? s.ammo : r;
    this.rings.forEach((g, i) => { g.position.z = -0.14 - i * 0.11 - charge * 0.03; g.rotation.z = Math.sin(t * (0.6 + i * 0.3)) * 0.02 * charge + charge * i * 0.4; });
    this.organ.scale.set(1 + fire * 1.5, 1 + fire * 1.5, 1);
    this.organMat.emissiveIntensity *= 0.6 + charge * 0.8;
    this.flex.rotation.set(0, 0, r === null ? 0 : bump(r, 0, 1) * 0.2);
  }
}

/** Reliquary Hymn (relic): a shard of the Reliquary's ribcage that sings; the ribs ring on each three-bolt fan and close to re-tune. */
class ReliquaryHymn extends Body {
  readonly id = 'reliquaryHymn';
  readonly muzzleFx: MuzzleFx = 'beam';
  private ribs: THREE.Group[] = [];
  private heart: THREE.Mesh;
  constructor(seed = 14) {
    super('reliquaryHymn', mix(ORGANIC.amber, HIVE.bone, 0.3), seed);
    this.flesh = this.add(lathe(0.3, (t) => 0.03 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.02, 29).translate(0, 0, 0.16), this.m.fleshDeep);
    // Sternum spine and paired ribs curving forward around a hanging heart-core.
    this.add(roughen(taperTube([V(0, 0.05, 0.12), V(0, 0.06, -0.12), V(0, 0.04, -0.34)], [0.014, 0.012, 0.006], 8, 6), 0.0015, 80, 2), this.m.bone);
    for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sd * 0.008, 0.055, 0.06 - i * 0.07);
      this.add(roughen(taperTube([V(0, 0, 0), V(sd * 0.05, -0.02, -0.01), V(sd * 0.055, -0.07, -0.03), V(sd * 0.02, -0.1, -0.05)], [0.007, 0.006, 0.005, 0.003], 6, 4), 0.001, 120, i), i % 2 ? this.m.bone : this.m.boneDark, g);
      this.flex.add(g);
      this.ribs.push(g);
    }
    this.heart = this.add(roughen(new THREE.SphereGeometry(0.026, 16, 12).scale(0.9, 1, 1.3), 0.002, 60, 9), this.m.core);
    this.heart.position.set(0, -0.005, -0.1);
    // Three bolt prongs fanned at the front.
    const prongs: THREE.BufferGeometry[] = [];
    for (const a of [-0.18, 0, 0.18]) prongs.push(spike(0.09, 0.006, 0.1).rotateX(-Math.PI / 2).rotateY(a).translate(0, 0.0, -0.3));
    this.add(merge(prongs), this.m.bone);
    this.muzzle.position.set(0, 0, -0.38);
    this.setGrip(V(0, -0.04, 0.1), 0.1);
    this.size = 1.1;
    this.socket('barrel', V(0, 0, -0.36)); this.socket('sight', V(0, 0.08, 0.0)); this.socket('under', V(0, -0.1, -0.16)); this.socket('chamber', V(0.07, 0.0, 0.1));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    // The ribs ring (a fast shiver) after each shot; on reload they close over the heart and open again.
    const ring = Math.exp(-s.sinceFire * 6) * Math.sin(s.sinceFire * 70) * 0.06;
    const close = r === null ? 0 : bump(r, 0.05, 0.95);
    this.ribs.forEach((g, i) => { const sd = i % 2 ? 1 : -1; g.rotation.z = sd * (ring - close * 0.5 + Math.sin(t * 0.9 + i) * 0.008); });
    this.heart.scale.setScalar(1 + fire * 0.2 + Math.sin(t * 3) * 0.02);
    this.flex.rotation.set(0, 0, r === null ? 0 : bump(r, 0, 1) * 0.3);
  }
}

/** Coreburner (relic): a reactor-seed heart in a cage of vents; it beats faster as it heats and vents steam-blood to cool. */
class Coreburner extends Body {
  readonly id = 'coreburner';
  readonly muzzleFx: MuzzleFx = 'spore';
  private heart: THREE.Mesh;
  private vents: THREE.Group[] = [];
  private beat = 0;
  constructor(seed = 15) {
    super('coreburner', mix(HIVE.danger, ORGANIC.amber, 0.35), seed);
    this.flesh = this.add(lathe(0.34, (t) => 0.036 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.026, 31).translate(0, 0, 0.16), this.m.fleshDeep);
    // The heart behind a cage of bone bars.
    this.heart = this.add(roughen(new THREE.SphereGeometry(0.04, 18, 14).scale(1, 1.05, 1.2), 0.003, 50, 4), this.m.core);
    this.heart.position.set(0, 0.062, -0.02);
    const cage: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; cage.push(taperTube([V(0, 0.062, 0.05), V(Math.cos(a) * 0.05, 0.062 + Math.sin(a) * 0.05, -0.02), V(0, 0.062, -0.09)], [0.004, 0.005, 0.004], 5, 5)); }
    this.add(roughen(merge(cage), 0.0012, 100, 3), this.m.bone);
    // Vent chimneys along the top that flap open to cool.
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.set(0, 0.058, 0.13 - i * 0.04);
      this.add(new THREE.CylinderGeometry(0.008, 0.012, 0.03, 8).translate(0, 0.015, 0), this.m.boneDark, g);
      this.flex.add(g);
      this.vents.push(g);
    }
    // Twin artery barrels.
    const bar: THREE.BufferGeometry[] = [];
    for (const sd of [-1, 1]) bar.push(taperTube([V(sd * 0.014, 0.01, -0.1), V(sd * 0.016, 0.012, -0.24), V(sd * 0.012, 0.01, -0.36)], [0.011, 0.01, 0.009], 7, 5));
    this.add(roughen(merge(bar), 0.0012, 100, 5), this.m.flesh);
    this.muzzle.position.set(0, 0.01, -0.37);
    this.setGrip(V(0, -0.035, 0.1), 0.1);
    this.socket('barrel', V(0, 0.01, -0.36)); this.socket('sight', V(0, 0.1, -0.06)); this.socket('under', V(0, -0.04, -0.22)); this.socket('chamber', V(0.06, 0.0, 0.12));
  }
  protected pose(t: number, s: Pose, fire: number): void {
    const r = s.reload;
    // Heat is the inverse of ammo: the heart beats faster and swells as it heats; the reload is a vent and cool-down.
    const heat = r === null ? 1 - s.ammo : 1 - r;
    this.beat += this.dt * (1.2 + heat * 4);
    const pulse = Math.pow(Math.max(0, Math.sin(this.beat * Math.PI * 2)), 6);
    this.heart.scale.setScalar(1 + pulse * (0.08 + heat * 0.12) + fire * 0.1);
    const open = r === null ? heat * 0.3 : bump(r, 0.0, 0.8);
    this.vents.forEach((g, i) => { g.rotation.x = -open * (0.8 + i * 0.2); g.scale.y = 1 + open * 0.5; });
    this.flex.rotation.set(r === null ? 0 : bump(r, 0, 1) * 0.08, 0, r === null ? 0 : bump(r, 0, 1) * 0.25);
  }
}

const BUILDERS: Record<WeaponId, (seed?: number) => Body> = {
  quillet: (s) => new Sidearm(s), hiveSpitter: (s) => new Smg(s), vertebraRifle: (s) => new Rifle(s),
  gulletScatter: (s) => new Shotgun(s), eyestalkMarksman: (s) => new Sniper(s), broodMortar: (s) => new Launcher(s),
  marrowHand: (s) => new MarrowHand(s), stingerChoir: (s) => new StingerChoir(s), cicadine: (s) => new Cicadine(s), bloomcannon: (s) => new Bloomcannon(s),
  leviathanQuill: (s) => new LeviathanQuill(s), tumorLauncher: (s) => new TumorLauncher(s), lumenLance: (s) => new LumenLance(s),
  reliquaryHymn: (s) => new ReliquaryHymn(s), coreburner: (s) => new Coreburner(s),
};

export function hasWeaponBody(id: string): id is WeaponId { return id in BUILDERS; }

/** Build the living body for a weapon id. */
export function createWeaponBody(id: WeaponId, seed?: number): WeaponBody {
  const b = BUILDERS[id](seed);
  b.gun.name = `weapon:${id}`;
  b.gun.traverse((o) => { o.frustumCulled = false; });
  return b;
}
