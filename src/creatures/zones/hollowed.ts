import * as THREE from 'three';
import { FAUNA, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { aimBone, solveTwoBone } from '../ik';
import { rng } from '../parts';
import type { BodyPlan, Palette } from '../plan';
import type { Creature } from '../creature';
import { createWeaponBody, type WeaponBody } from '../weapons/bodies';
import type { WeaponId } from '../weapons/bodies';
import { damp } from './fx';

/**
 * The Hollowed (data/abominations.json `hollowed`): hosts who went too deep in the Marrow Pit. Cordyceps × a
 * marionette × a diving suit full of roots. Still upright, still in their scraps of gear, still carrying their gun,
 * but worked from inside like a glove by something pale and rooted. The chest is split and the light in it is the
 * wrong colour (the root knot, the weak point); roots spill from the split and down the arms; the head lolls.
 *
 * It carries a real weapon body (src/creatures/weapons): `motion.equip(id)` (default: a seeded pick from the brief's
 * pool), `motion.weapon.muzzle` is where shots leave.
 * Drive:
 *   windup   the gun comes up onto `strike` (or `look`), the head snaps upright for a moment.
 *   action   a shot: set it to 1 for each round of the burst; the gun kicks and the body flinches.
 *   excite   marionette twitches get more frequent.
 */

export const HOLLOWED_GUNS: WeaponId[] = ['quillet', 'hiveSpitter', 'cicadine', 'gulletScatter', 'vertebraRifle'];

export function hollowed(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: FAUNA.pearl, vein: ORGANIC.vein, rim: FAUNA.pearl,
    chitin: FAUNA.soot, chitinGlow: FAUNA.sickGreen, bone: FAUNA.pearl,
    glow: FAUNA.sickGreen, fluid: FAUNA.sickGreen, membrane: FAUNA.pearl, iris: FAUNA.sickGreen, sclera: FAUNA.soot,
  };
  const s = 0.96 + r() * 0.08;
  const b = new PlanBuilder('hollowed', seed, stage, { locomotion: 'walker', bodyHeight: 0.98 * s, radius: 0.42 * s, skinNoise: { amp: 0.006, freq: 18 }, skinResolution: 64, fleshScale: 10, palette: pal });
  // Grey, bloodless skin under scraps of gear; the only colour is the wrong light in the chest.
  b.plan.palette = { ...b.plan.palette, flesh: mix(FAUNA.pearl, FAUNA.soot, 0.45), chitin: mix(FAUNA.soot, FAUNA.rope, 0.3), bone: mix(FAUNA.pearl, FAUNA.rope, 0.35), glow: mix(FAUNA.sickGreen, FAUNA.pearl, 0.25) };
  const S = (x: number, y: number, z: number) => V(x * s, y * s, z * s);
  const body = b.bone('body', -1, S(0, 0.98, 0));
  const chest = b.bone('chest', body, S(0, 1.3, 0.0));
  const head = b.bone('head', chest, S(0, 1.62, 0.03));
  const grey = tint('#ffffff', 1), gear = tint(FAUNA.soot, 2.2);
  // Pelvis, a hunched torso, a slumped neck and a host head with its visor cracked.
  b.skin({ shape: 'ellipsoid', a: S(0, 0.98, 0), radii: S(0.17, 0.12, 0.12), bone: body, tint: gear });
  b.skin({ shape: 'cone', a: S(0, 1.05, 0), b: S(0, 1.38, 0.02), ra: 0.14 * s, rb: 0.2 * s, blend: 0.07 * s, bone: chest, tint: grey });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.42, -0.01), radii: S(0.23, 0.09, 0.13), blend: 0.06 * s, bone: chest, tint: gear });
  b.skin({ shape: 'cone', a: S(0, 1.46, 0.0), b: S(0, 1.56, 0.03), ra: 0.06 * s, rb: 0.055 * s, blend: 0.04 * s, bone: head, tint: grey });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.65, 0.03), radii: S(0.1, 0.12, 0.11), blend: 0.04 * s, bone: head, tint: grey });
  // The split chest: a cavity with the root knot glowing inside.
  b.skin({ shape: 'ellipsoid', a: S(0, 1.3, 0.13), radii: S(0.07, 0.12, 0.07), subtract: true, blend: 0.03, bone: chest });
  b.part({ id: 'knot', type: 'sac', bone: chest, at: S(0, 1.27, 0.08), dir: V(0, 0.2, 1), size: 0.06 * s, material: 'raw', dynamic: true, weak: true });
  b.part({ id: 'knotlight', type: 'node', bone: chest, at: S(0, 1.31, 0.1), dir: V(0, 0, 1), size: 0.03 * s, material: 'glow' });
  // Gear scraps: visor, shoulder plates, a belt rig.
  b.part({ id: 'visor', type: 'plate', bone: head, at: S(0, 1.67, 0.11), dir: V(0, 0.1, 1), fwd: V(0, 1, 0), size: 0.11 * s, p: [1.2, 0.8, 0.35, 0.2], material: 'chitin' });
  b.both((side, n) => b.part({ id: `pad${n}`, type: 'plate', bone: chest, at: S(side * 0.2, 1.47, -0.01), dir: V(side * 0.6, 1, 0), fwd: V(0, 0, 1), size: 0.13 * s, p: [1, 1.2, 0.35, 0.3], material: 'chitin' }));
  b.part({ id: 'belt', type: 'plate', bone: body, at: S(0, 1.02, 0.09), dir: V(0, 0, 1), fwd: V(0, 1, 0), size: 0.16 * s, p: [1.4, 0.4, 0.25, 0.1], material: 'chitin' });
  // Eyes: the host's own two, filmed over, and three more grown in along the crack in the visor.
  [[-0.04, 1.665], [0.04, 1.665], [-0.065, 1.62], [0.07, 1.6], [0.0, 1.72]].forEach(([x, y], i) => {
    b.part({ id: `eye${i}`, type: 'eye', bone: head, at: S(x, y, 0.125), dir: V(x * 2, 0.05, 1), size: (i < 2 ? 0.017 : 0.011) * s, material: 'eye', dynamic: true });
  });
  // Roots spilling out of the split and from the neck, and fungal brackets on the shoulder.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.part({ id: `root${i}`, type: 'cord', bone: chest, at: S(Math.cos(a) * 0.05, 1.3 + Math.sin(a) * 0.09, 0.12), dir: V(Math.cos(a) * 0.6, -0.8 + Math.sin(a) * 0.3, 0.4), size: (0.18 + r() * 0.16) * s, material: 'bone' });
  }
  for (let i = 0; i < 3; i++) b.part({ id: `neckroot${i}`, type: 'cord', bone: head, at: S((i - 1) * 0.04, 1.52, -0.05), dir: V((i - 1) * 0.4, 0.4, -1), size: 0.15 * s, material: 'bone' });
  b.part({ id: 'bracket0', type: 'fungus', bone: chest, at: S(-0.21, 1.4, -0.06), dir: V(-0.7, 0.4, -0.3), size: 0.07 * s, p: [4], material: 'bone' });
  // Arms: still trained to hold a gun.
  b.both((side, n) => {
    const id = `arm${n}`;
    b.limb({ id, kind: 'arm', bone: chest, mount: S(side * 0.22, 1.42, 0), lengths: [0.28 * s, 0.27 * s, 0.08 * s], radii: [0.045, 0.036, 0.028, 0.02].map((x) => x * s), style: 'bone', material: 'flesh', rest: S(side * 0.12, 1.12, 0.28), pole: V(side, -0.3, -1) });
    b.hit({ bone: { limb: id, seg: 0 }, at: V(0, 0.12, 0), r: 0.07 * s, weak: false, part: id });
  });
  // Legs: two, stiff, the gait a little too even.
  b.both((side, n) => {
    const id = `leg${n}`;
    b.limb({ id, kind: 'leg', bone: body, mount: S(side * 0.1, 0.95, 0), lengths: [0.46 * s, 0.46 * s, 0.1 * s], radii: [0.065, 0.05, 0.04, 0.035].map((x) => x * s), style: 'bone', material: 'flesh', rest: S(side * 0.13, 0, 0.02), pole: V(0, 0.2, 1), gait: side > 0 ? 1 : 0 });
    b.part({ id: `kneepad${n}`, type: 'plate', bone: { limb: id, seg: 1 }, at: V(0, 0.02, 0.04), dir: V(0, 0, 1), fwd: V(0, 1, 0), size: 0.07 * s, p: [0.9, 1.1, 0.35, 0.4], material: 'chitin' });
    b.hit({ bone: { limb: id, seg: 0 }, at: V(0, 0.2, 0), r: 0.08 * s, weak: false, part: id });
  });
  b.hit({ bone: chest, at: S(0, 1.3, 0), r: 0.2 * s, weak: false });
  b.hit({ bone: head, at: S(0, 1.65, 0.03), r: 0.12 * s, weak: false });
  b.hit({ bone: body, at: S(0, 0.98, 0), r: 0.17 * s, weak: false });
  b.hit({ bone: chest, at: S(0, 1.28, 0.1), r: 0.08 * s, weak: true, part: 'knot' });
  mutate(b, stage, {
    dorsal: [0.05, -0.08].map((z) => S(0, 2.2, z)), flank: [S(0.5, 1.3, 0), S(0.5, 1.05, 0)],
    growth: 'fungus', growthSize: 0.08 * s, nodeSize: 0.02 * s, plateSize: 0.09 * s,
    extra: (bb) => bb.limb({ id: 'tendrilarm', kind: 'tendril', bone: chest, mount: S(0, 1.3, -0.12), lengths: Array(3).fill(0.35 * s), radii: [0.03, 0.022, 0.014, 0.004].map((x) => x * s), style: 'tendril', material: 'bone', rest: S(0.1, 0.4, -0.5), pole: V(0, 0, -1), stage: 3 }),
  });
  return b.plan;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** The gun held in both hands, the marionette twitches, the lolling head. */
export function hollowedMotion(c: Creature) {
  const rig = c.rig;
  const bone = (n: string) => rig.bones.find((b) => b.name === n)!;
  const chest = bone('chest'), head = bone('head');
  const arms = [rig.limbs.get('armL'), rig.limbs.get('armR')];
  const s = c.plan.radius / 0.42;
  const holder = new THREE.Group();
  holder.name = 'hollowed-gun';
  rig.bones[0].add(holder);
  let weapon: WeaponBody | null = null;
  let t = Math.random() * 10, aim = 0, sinceFire = 9, twitch = 0, twitchT = 1 + Math.random() * 2, loll = 0.5;
  const twitchAxis = new THREE.Vector3();
  const api = {
    get weapon(): WeaponBody | null { return weapon; },
    /** Put a weapon from the brief's pool (or any roster id) in its hands. */
    equip(id: WeaponId): void {
      if (weapon) holder.remove(weapon.gun);
      weapon = createWeaponBody(id, c.plan.seed);
      holder.add(weapon.gun);
    },
    update(dt: number): void {
      const d = c.drive;
      t += dt;
      const alive = c.alive;
      if (d.action > 0.9) sinceFire = 0;
      sinceFire += dt;
      aim = damp(aim, alive ? Math.max(d.windup, sinceFire < 0.6 ? 1 : 0) : 0, 8, dt);
      // Marionette twitches: sudden jerks on a random axis, more often when excited.
      twitchT -= dt * (1 + d.excite * 2);
      if (twitchT <= 0 && alive) { twitch = 1; twitchT = 0.8 + Math.random() * 2.5; twitchAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); }
      twitch = Math.max(0, twitch - dt * 5);
      const jerk = twitch * twitch * 0.35;
      // The head lolls, snapping upright when it aims.
      loll = damp(loll, alive ? (aim > 0.5 ? 0.05 : 0.55) : 0.9, aim > 0.5 ? 14 : 1.5, dt);
      head.quaternion.setFromEuler(_e.set(0.35 * loll + Math.sin(t * 0.7) * 0.05, Math.sin(t * 0.3) * 0.2 * loll, loll * 0.8 + Math.sin(t * 0.5) * 0.08));
      chest.quaternion.setFromEuler(_e.set(0.12 + (sinceFire < 0.12 ? -0.08 : 0), 0, 0)).multiply(_q.setFromAxisAngle(twitchAxis.lengthSq() ? twitchAxis : UP, jerk));
      if (!weapon) return;
      // The gun: lowered along the body at rest, raised onto the target when aiming.
      holder.position.set(0.1 * s, (1.12 + aim * 0.28) * s - rig.bones[0].position.y, (0.12 + aim * 0.08) * s);
      const target = d.strike ?? d.look;
      _m.identity();
      if (target && aim > 0.05 && alive) {
        holder.parent!.updateWorldMatrix(true, false);
        _a.copy(target);
        holder.parent!.worldToLocal(_a);
        _a.sub(holder.position).normalize();
        _b.set(0, -0.6, 1).normalize().lerp(_a, aim).normalize();
      } else _b.set(0, -0.6, 1).normalize();
      // Weapon bodies point their barrel down local -Z (the viewmodel convention).
      _q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _b);
      holder.quaternion.copy(_q);
      weapon.animate(dt, { reload: null, aim: 0, sinceFire, ammo: 1, equip: 1 });
      // Hands on the grip and the fore-end.
      holder.updateMatrixWorld(true);
      const grip = weapon.grip.getWorldPosition(_a).clone();
      const fore = weapon.muzzle.getWorldPosition(_b).clone().lerp(grip, 0.55);
      arms.forEach((l, i) => {
        if (!l || l.severed) return;
        const goal = i ? grip : fore;
        const pole = _a.set(i ? 1 : -1, -0.4, -0.6).transformDirection(rig.root.matrixWorld).clone();
        solveTwoBone(l.bones[0], l.bones[1], l.spec.lengths[0], l.spec.lengths[1], goal, pole);
        if (l.bones[2]) aimBone(l.bones[2], weapon!.muzzle.getWorldPosition(new THREE.Vector3()).sub(goal), pole);
      });
    },
  };
  api.equip(HOLLOWED_GUNS[c.plan.seed % HOLLOWED_GUNS.length]);
  return api;
}
