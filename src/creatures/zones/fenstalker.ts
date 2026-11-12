import * as THREE from 'three';
import { FAUNA, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import { organic, readable } from './organic';
import type { BodyPlan, Palette } from '../plan';
import type { Creature } from '../creature';
import { GroundFx, damp } from './fx';

/**
 * Fenstalker (data/abominations.json `fenstalker`): the ambusher of the Weeping Fen. Tiger × water strider ×
 * crocodile × mantis. A lean, low body the size of a big cat, banded pale and dark like reeds over water, on four
 * long splayed strider legs, with two folded mantis arms under the chest. A flat crocodile head, and on top of it two
 * eye stalks, each tipped with a cluster of three eyes. A long tail that splits into two rudder fins.
 *
 * Drive:
 *   burrow   0 standing, 1 submerged: the body sinks until only the eye stalks are above the waterline (the root's
 *            height; place the root on the water surface). While under, the stalks leave rings on the water
 *            (the ripple tell). Dropping burrow fast is the ambush: it bursts out in a sheet of spray.
 *   windup   the jaw gapes, the stalks lock forward, the mantis arms unfold toward drive.strike (shared code).
 *   action   the bite: the jaw snaps shut while it decays.
 * Weak point: the eye stalks.
 */

export function fenstalker(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: FAUNA.reed, vein: ORGANIC.vein, rim: FAUNA.pearl,
    chitin: FAUNA.peat, chitinGlow: ORGANIC.amber, bone: FAUNA.pearl,
    glow: ORGANIC.amber, fluid: ORGANIC.vein, membrane: FAUNA.reed, iris: ORGANIC.amber, sclera: FAUNA.soot,
  };
  const s = 0.94 + r() * 0.12;
  const h = 0.62 * s;
  const b = new PlanBuilder('fenstalker', seed, stage, { locomotion: 'walker', bodyHeight: h, radius: 1.1 * s, skinNoise: { amp: 0.006, freq: 16 }, skinResolution: 64, fleshScale: 7, palette: pal });
  organic(b, rng(seed * 17 + 3));
  // Wet reed and peat, glossy; not meat.
  b.plan.palette = { ...b.plan.palette, flesh: mix(FAUNA.reed, FAUNA.fenMoss, 0.25), chitin: mix(FAUNA.peat, FAUNA.soot, 0.3), bone: mix(FAUNA.pearl, FAUNA.reed, 0.3), membrane: mix(FAUNA.reed, FAUNA.water, 0.4) };
  readable(b);
  const S = (x: number, y: number, z: number) => V(x * s, y * s, z * s);
  const body = b.bone('body', -1, S(0, 0.62, 0));
  const chest = b.bone('chest', body, S(0, 0.64, 0.55));
  const head = b.bone('head', chest, S(0, 0.62, 1.0));
  const jaw = b.bone('jaw', head, S(0, 0.56, 1.05));
  const stalks = [b.bone('stalkL', head, S(-0.08, 0.7, 1.08)), b.bone('stalkR', head, S(0.08, 0.7, 1.08))];
  const tail0 = b.bone('tail0', body, S(0, 0.6, -0.75));
  const tail1 = b.bone('tail1', tail0, S(0, 0.52, -1.35));
  const forks = [b.bone('forkL', tail1, S(-0.04, 0.46, -1.85)), b.bone('forkR', tail1, S(0.04, 0.46, -1.85))];
  // Reed bands: the body is a run of short lobes, alternately pale and dark, so the stripes are part of the form.
  const pale = tint('#ffffff', 1.25), dark = tint(FAUNA.peat, 2.2);
  const BANDS = 9;
  for (let i = 0; i < BANDS; i++) {
    const k = i / (BANDS - 1);
    const z = 0.95 - k * 1.75;
    const girth = 0.2 + Math.sin(Math.min(1, k * 1.25) * Math.PI) * 0.07;
    b.skin({ shape: 'ellipsoid', a: S(0, 0.63 + Math.sin(k * Math.PI) * 0.03, z), radii: S(girth * 1.2, girth * 0.85, 0.15), blend: 0.025 * s, bone: k < 0.3 ? chest : body, tint: i % 2 ? dark : pale });
  }
  b.skin({ shape: 'ellipsoid', a: S(0, 0.5, 0.0), radii: S(0.2, 0.11, 0.7), blend: 0.04 * s, bone: body, tint: tint('#ffffff', 1.25) });
  // A flat crocodile head: skull, long snout, and a lower jaw on its own bone.
  b.skin({ shape: 'ellipsoid', a: S(0, 0.64, 1.08), radii: S(0.17, 0.11, 0.2), blend: 0.08 * s, bone: head, tint: pale });
  b.skin({ shape: 'cone', a: S(0, 0.62, 1.2), b: S(0, 0.58, 1.62), ra: 0.11 * s, rb: 0.05 * s, blend: 0.05 * s, bone: head, ribs: { freq: 24 / s, depth: 0.004 }, tint: dark });
  b.skin({ shape: 'cone', a: S(0, 0.52, 1.08), b: S(0, 0.52, 1.58), ra: 0.1 * s, rb: 0.04 * s, blend: 0.03 * s, bone: jaw, tint: tint('#ffffff', 1.4) });
  b.skin({ shape: 'ellipsoid', a: S(0, 0.555, 1.4), radii: S(0.12, 0.015, 0.22), subtract: true, blend: 0.01, bone: head });
  b.both((side, n) => {
    for (let k = 0; k < 5; k++) {
      const z = 1.22 + k * 0.08;
      b.part({ id: `tooth${n}${k}`, type: 'spike', bone: jaw, at: S(side * (0.075 - k * 0.008), 0.555, z), dir: V(side * 0.15, 1, 0.1), fwd: V(0, 0, 1), size: 0.045 * s, p: [0.05, 0.2], material: 'bone' });
    }
  });
  // Eye stalks: two thin stems up off the skull, each ending in a bulb with three eyes.
  stalks.forEach((sb, i) => {
    const side = i ? 1 : -1;
    const top = S(side * 0.11, 0.98, 1.04);
    b.skin({ shape: 'cone', a: S(side * 0.07, 0.68, 1.08), b: top, ra: 0.032 * s, rb: 0.024 * s, blend: 0.03 * s, bone: sb, ribs: { freq: 50 / s, depth: 0.003 }, tint: dark });
    b.skin({ shape: 'ellipsoid', a: top, radii: S(0.055, 0.045, 0.055), blend: 0.02 * s, bone: sb, tint: pale });
    [0, 1, 2].forEach((k) => {
      const a = (k - 1) * 0.9 + side * 0.4;
      const dir = V(Math.sin(a), 0.25, Math.cos(a)).normalize();
      b.part({ id: `eye${i}${k}`, type: 'eye', bone: sb, at: top.clone().addScaledVector(dir, 0.04 * s), dir, size: (k === 1 ? 0.026 : 0.02) * s, material: 'eye', dynamic: true });
    });
    b.hit({ bone: sb, at: top, r: 0.09 * s, weak: true, part: `eye${i}1` });
  });
  // Tail: a long whip that splits into two flat rudders.
  b.skin({ shape: 'cone', a: S(0, 0.6, -0.72), b: S(0, 0.52, -1.35), ra: 0.14 * s, rb: 0.08 * s, blend: 0.1 * s, bone: tail0, ribs: { freq: 14 / s, depth: 0.008 }, tint: pale });
  b.skin({ shape: 'cone', a: S(0, 0.52, -1.35), b: S(0, 0.47, -1.8), ra: 0.08 * s, rb: 0.05 * s, blend: 0.05 * s, bone: tail1, tint: dark });
  forks.forEach((fb, i) => {
    const side = i ? 1 : -1;
    b.skin({ shape: 'cone', a: S(side * 0.03, 0.47, -1.8), b: S(side * 0.2, 0.44, -2.45), ra: 0.045 * s, rb: 0.012 * s, blend: 0.03 * s, bone: fb, tint: i ? pale : dark });
    b.part({ id: `rudder${i}`, type: 'plate', bone: fb, at: S(side * 0.13, 0.46, -2.2), dir: V(side, 0.2, 0), fwd: V(side * 0.2, 0, -1), size: 0.22 * s, p: [0.15, 1.6, 0.15, 0.2], material: 'membrane' });
  });
  // Dorsal scutes down the dark bands, crocodile style.
  for (let i = 1; i < BANDS - 1; i += 2) {
    const z = 0.95 - (i / (BANDS - 1)) * 1.75;
    const hit = b.surf(S(0, 1.4, z), V(0, -1, 0));
    b.part({ id: `scute${i}`, type: 'plate', bone: hit.bone, at: hit.at.clone().addScaledVector(hit.normal, -0.01), dir: hit.normal, fwd: V(0, 0, 1), size: 0.09 * s, p: [1, 1.2, 0.5, 0.7], material: 'chitin' });
  }
  // Four strider legs, long and splayed wide to spread its weight on mud.
  ([[0.3, 0.75, 0], [-0.45, -0.85, 1]] as const).forEach(([mz, fz, row]) => b.both((side, n) => {
    const id = `leg${n}${row}`;
    b.limb({
      id, kind: 'leg', bone: body, mount: S(side * 0.2, 0.56, mz), lengths: [0.62 * s, 0.78 * s, 0.22 * s], radii: [0.06, 0.04, 0.025, 0.012].map((x) => x * s),
      style: 'needle', material: 'chitin', rest: S(side * 1.15, 0, fz), pole: V(side * 0.3, 1, 0), gait: ((row + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
    });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 0.2, 0), r: 0.08 * s, weak: false, part: id });
  }));
  // Two mantis arms folded under the chest: the hooks it pins prey with.
  b.both((side, n) => {
    const id = `arm${n}`;
    b.limb({ id, kind: 'arm', bone: chest, mount: S(side * 0.13, 0.55, 0.72), lengths: [0.34 * s, 0.38 * s, 0.3 * s], radii: [0.045, 0.035, 0.025, 0.006].map((x) => x * s), style: 'mantis', material: 'chitin', rest: S(side * 0.16, 0.35, 0.95), pole: V(side * 0.3, -0.4, -1) });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 0.15, 0), r: 0.07 * s, weak: false, part: id });
  });
  b.hit({ bone: body, at: S(0, 0.62, -0.2), r: 0.32 * s, weak: false });
  b.hit({ bone: chest, at: S(0, 0.64, 0.6), r: 0.28 * s, weak: false });
  b.hit({ bone: head, at: S(0, 0.6, 1.3), r: 0.2 * s, weak: false });
  b.hit({ bone: tail0, at: S(0, 0.56, -1.1), r: 0.14 * s, weak: false });
  mutate(b, stage, {
    dorsal: [0.6, 0.2, -0.2, -0.6].map((z) => S(0, 1.4, z)), flank: [S(0.6, 0.62, 0.3), S(0.6, 0.62, -0.3)],
    growth: 'fungus', growthSize: 0.1 * s, nodeSize: 0.03 * s, plateSize: 0.14 * s,
    extra: (bb) => bb.both((side, n) => {
      // Stage 3: barbed spurs on the tail forks, for raking.
      bb.part({ id: `spur${n}`, type: 'horn', bone: forks[side < 0 ? 0 : 1], at: S(side * 0.18, 0.46, -2.35), dir: V(side * 0.4, 0.2, -1), fwd: V(0, 1, 0), size: 0.25 * s, p: [0.1, 0.7], material: 'bone', stage: 3 });
    }),
  });
  return b.plan;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _w = new THREE.Vector3();

/** Sinking to the eye stalks, rings on the water, the burst out, the gape and the rudder tail. */
export function fenstalkerMotion(c: Creature) {
  const rig = c.rig;
  const bone = (n: string) => rig.bones.find((bn) => bn.name === n)!;
  const head = bone('head'), jaw = bone('jaw'), tail0 = bone('tail0'), tail1 = bone('tail1');
  const stalks = [bone('stalkL'), bone('stalkR')], forks = [bone('forkL'), bone('forkR')];
  const rest = new Map([head, jaw, tail0, tail1, ...stalks, ...forks].map((bn) => [bn, bn.quaternion.clone()]));
  const s = c.plan.radius / 1.1;
  const fx = new GroundFx(rig.root, { rings: 10, sprays: 22 });
  const DEPTH = 0.86 * s;
  let t = Math.random() * 10, sub = c.drive.burrow, gape = 0, snap = 0, ringT = 0, lastBurrow = c.drive.burrow;
  const pose = (bn: THREE.Bone, x: number, y: number, z: number) => bn.quaternion.copy(rest.get(bn)!).multiply(_q.setFromEuler(_e.set(x, y, z)));
  return {
    update(dt: number): void {
      const d = c.drive;
      t += dt;
      const alive = c.alive;
      const speed = Math.hypot(d.velocity.x, d.velocity.z);
      const before = sub;
      // Sinking is slow and smooth; the ambush out of the water is fast.
      sub = damp(sub, alive ? d.burrow : 0, d.burrow < sub ? 14 : 3, dt);
      c.sink = sub * DEPTH;
      const water = c.worldPos.y;
      // The burst: spray where the body breaks the surface, and a ring.
      if (before > 0.45 && sub <= 0.45 && d.burrow < lastBurrow + 1e-3) {
        rig.bones[0].getWorldPosition(_w);
        _w.y = water;
        for (let k = 0; k < 14; k++) fx.spray(_w.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.4 * s, 0, (Math.random() - 0.5) * 2 * s)), (0.1 + Math.random() * 0.12) * s, 3.5 + Math.random() * 2);
        fx.ring(_w, 1.6 * s, 1.4);
      }
      lastBurrow = d.burrow;
      // Rings off the stalks while it waits under.
      ringT -= dt;
      if (alive && sub > 0.6 && ringT <= 0) {
        ringT = speed > 0.3 ? 0.35 : 1.1 + Math.random() * 0.6;
        for (const st of stalks) { st.getWorldPosition(_w); _w.y = water; fx.ring(_w, 0.35 * s, 1.8); }
      }
      // Jaw: gape on the wind-up, snap on the bite.
      snap = Math.max(snap, d.action);
      d.action = Math.max(0, d.action - dt / 0.4);
      snap = Math.max(0, snap - dt / 0.4);
      gape = damp(gape, alive ? Math.max(d.windup, sub > 0.5 ? 0 : 0.05 + Math.max(0, Math.sin(t * 0.4)) * 0.08) : 0.35, 14, dt);
      pose(jaw, gape * 0.65 * (1 - snap), 0, 0);
      // Head: lifts its nose under water so the stalks clear the surface, and lunges low on the wind-up.
      pose(head, -sub * 0.12 + d.windup * 0.12, 0, 0);
      // Stalks: each swivels on its own, scanning; they lock onto the target on the wind-up.
      const lock = Math.min(1, d.windup * 1.5 + d.excite * 0.4);
      stalks.forEach((st, i) => {
        const scan = (Math.sin(t * (0.7 + i * 0.23) + i * 2) * 0.6 + Math.sin(t * 2.9 + i) * 0.1) * (1 - lock);
        pose(st, Math.sin(t * 1.3 + i) * 0.08 * (1 - lock) - lock * 0.15, scan, (i ? 1 : -1) * (0.12 - lock * 0.1));
      });
      // Tail: a rudder; the forks scissor as it steers.
      const sway = alive ? Math.sin(t * (1.4 + speed * 0.8)) * (0.12 + Math.min(1, speed / 6) * 0.2) : 0;
      pose(tail0, sub * 0.05, sway, 0);
      pose(tail1, 0, sway * 1.3, 0);
      forks.forEach((f, i) => pose(f, 0, (i ? 1 : -1) * (0.12 + Math.sin(t * 2.1) * 0.08), 0));
      fx.update(dt);
    },
    get fx() { return fx; },
    get submerged() { return sub; },
  };
}
