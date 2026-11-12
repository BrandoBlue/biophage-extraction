import * as THREE from 'three';
import { FAUNA, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import { organic, readable } from './organic';
import type { BodyPlan, Palette } from '../plan';
import type { Creature } from '../creature';
import { damp } from './fx';

/**
 * Shroudling (data/abominations.json `shroudling`): the corpse-wearing scavenger of the Settler Domes. Hermit crab ×
 * decorator crab × mantis × scarecrow. It wears the dried, shed skin of a dead host like a hermit crab wears a shell:
 * hunched shoulders, a hood, a pack strap, two empty sleeves swinging. From 35 m it reads as another player. Under it
 * is a stick-thin, many-jointed thing: six needle legs whose knees jut through the husk's sides, and a lamprey head on
 * a long neck that slides out of the hood to spit.
 *
 * Drive:
 *   windup   the neck slides out of the hood toward `look` and the lamprey mouth opens (the spit tell).
 *   action   the neck out without the spit (looting a corpse, picking at a container).
 *   excite   0 = the "host" act: an upright, swaying, almost human walk. 1 = it hunches and scuttles.
 * Weak point: the lamprey neck (a pale throat sac on it).
 */

const NECK = 4;

export function shroudling(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: FAUNA.dustPale, vein: ORGANIC.vein, rim: FAUNA.dustPale,
    chitin: FAUNA.soot, chitinGlow: ORGANIC.amber, bone: FAUNA.dustPale,
    glow: ORGANIC.amber, fluid: ORGANIC.vein, membrane: FAUNA.dustPale, iris: ORGANIC.amber, sclera: FAUNA.soot,
  };
  const s = 0.95 + r() * 0.1;
  const b = new PlanBuilder('shroudling', seed, stage, { locomotion: 'walker', bodyHeight: 0.95 * s, radius: 0.6 * s, skinNoise: { amp: 0.008, freq: 18 }, skinResolution: 64, fleshScale: 9, palette: pal });
  organic(b, rng(seed * 17 + 3));
  // Dried host skin: leathery, sun-cured, cracked. The thing inside is dark and wet.
  b.plan.palette = { ...b.plan.palette, flesh: mix(FAUNA.dustPale, FAUNA.ochre, 0.42, 0.9), chitin: mix(FAUNA.soot, ORGANIC.wetFleshDeep, 0.4), bone: mix(FAUNA.dustPale, FAUNA.sand, 0.5) };
  readable(b);
  const S = (x: number, y: number, z: number) => V(x * s, y * s, z * s);
  const body = b.bone('body', -1, S(0, 0.95, 0));
  const shell = b.bone('shell', body, S(0, 1.3, -0.02));
  const neck: number[] = [];
  const neckAt = (i: number) => S(0, 1.38 + i * 0.075, -0.04 + i * 0.045);
  for (let i = 0; i < NECK; i++) neck.push(b.bone(`neck${i}`, shell, neckAt(i)));
  const head = b.bone('head', shell, S(0, 1.68, 0.14));
  const leather = tint('#ffffff', 1), worn = tint('#ffffff', 0.78), inner = tint(FAUNA.soot, 1.8);
  // The husk: chest, slumped shoulders, a hood with nothing in it, and a ragged hem around the hips.
  b.skin({ shape: 'ellipsoid', a: S(0, 1.3, -0.02), radii: S(0.22, 0.3, 0.15), bone: shell, tint: leather });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.48, -0.05), radii: S(0.3, 0.1, 0.15), blend: 0.08 * s, bone: shell, tint: leather });
  b.skin({ shape: 'cone', a: S(0, 1.12, -0.02), b: S(0, 0.86, -0.03), ra: 0.18 * s, rb: 0.2 * s, blend: 0.07 * s, bone: shell, ribs: { freq: 9 / s, depth: 0.008 }, tint: worn });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.68, 0.0), radii: S(0.15, 0.17, 0.16), blend: 0.06 * s, bone: shell, tint: leather });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.66, 0.1), radii: S(0.105, 0.13, 0.13), subtract: true, blend: 0.025, bone: shell });
  b.skin({ shape: 'ellipsoid', a: S(0, 0.82, -0.03), radii: S(0.17, 0.12, 0.13), subtract: true, blend: 0.04, bone: shell });
  // The pack it died with, still strapped on, and the strap.
  b.skin({ shape: 'ellipsoid', a: S(0, 1.33, -0.2), radii: S(0.17, 0.2, 0.08), blend: 0.04 * s, bone: shell, tint: worn });
  b.part({ id: 'strap', type: 'plate', bone: shell, at: S(0.12, 1.45, 0.1), dir: V(0.2, 0.3, 1), fwd: V(-0.5, 1, 0), size: 0.2 * s, p: [0.3, 1.8, 0.15, 0.1], material: 'chitin' });
  b.part({ id: 'pauldron', type: 'plate', bone: shell, at: S(-0.24, 1.5, -0.03), dir: V(-0.5, 1, 0), fwd: V(0, 0, 1), size: 0.15 * s, p: [1, 1.1, 0.35, 0.3], material: 'bone' });
  // The thing inside: a dark, wet thorax low under the hem, and the lamprey neck coiled up into the hood.
  b.skin({ shape: 'ellipsoid', a: S(0, 0.95, 0), radii: S(0.13, 0.1, 0.17), blend: 0.03, bone: body, tint: inner });
  for (let i = 0; i < NECK - 1; i++) b.skin({ shape: 'cone', a: neckAt(i), b: neckAt(i + 1), ra: (0.05 - i * 0.004) * s, rb: (0.046 - i * 0.004) * s, blend: 0.03 * s, bone: neck[i + 1], ribs: { freq: 40 / s, depth: 0.004 }, tint: inner });
  b.skin({ shape: 'cone', a: neckAt(NECK - 1), b: S(0, 1.67, 0.15), ra: 0.04 * s, rb: 0.05 * s, blend: 0.02 * s, bone: head, tint: inner });
  b.skin({ shape: 'cone', a: S(0, 1.67, 0.22), b: S(0, 1.67, 0.12), ra: 0.035 * s, rb: 0.012 * s, subtract: true, blend: 0.01, bone: head });
  b.part({ id: 'mouth', type: 'needleRing', bone: head, at: S(0, 1.67, 0.19), dir: V(0, 0, 1), fwd: V(0, 1, 0), size: 0.035 * s, p: [12, 1.1, 0.8], material: 'bone', dynamic: true });
  // Eyes: five pinpricks round the lamprey's mouth, catching light inside the hood.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    b.part({ id: `eye${i}`, type: 'eye', bone: head, at: S(Math.cos(a) * 0.05, 1.67 + Math.sin(a) * 0.05, 0.165), dir: V(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 1), size: 0.011 * s, material: 'eye', dynamic: true });
  }
  b.part({ id: 'throat', type: 'pustule', bone: neck[2], at: S(0, 1.53, 0.06), dir: V(0, -0.3, 1), size: 0.035 * s, material: 'raw', dynamic: true, weak: true });
  // Ragged hem: strips of skin hanging off the hips, and the empty sleeves swinging from the shoulders.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.part({ id: `rag${i}`, type: 'cord', bone: shell, at: S(Math.cos(a) * 0.19, 0.9, -0.03 + Math.sin(a) * 0.14), dir: V(Math.cos(a) * 0.15, -1, Math.sin(a) * 0.15), size: (0.12 + r() * 0.16) * s, material: 'flesh' });
  }
  // Empty sleeves: the dead host's arms, flat and hollow, swinging from the shoulders on their own bones.
  b.both((side, n) => {
    const sh = S(side * 0.27, 1.46, -0.03), el = S(side * 0.31, 1.18, 0.0), wr = S(side * 0.3, 0.92, 0.04);
    const sb = b.bone(`sleeve${n}`, shell, sh);
    b.skin({ shape: 'cone', a: sh, b: el, ra: 0.06 * s, rb: 0.045 * s, blend: 0.05 * s, bone: sb, tint: worn });
    b.skin({ shape: 'cone', a: el, b: wr, ra: 0.045 * s, rb: 0.035 * s, blend: 0.03 * s, bone: sb, tint: worn });
    b.skin({ shape: 'ellipsoid', a: wr.clone().add(S(0, -0.05, 0.01)), radii: S(0.03, 0.06, 0.04), blend: 0.03 * s, bone: sb, tint: leather });
    b.part({ id: `cuff${n}`, type: 'cord', bone: sb, at: wr, dir: V(0, -1, 0.1), size: 0.18 * s, material: 'flesh' });
  });
  // Six needle legs: knees jut out through the husk's flanks, feet well wide of the hem.
  [0.13, 0.0, -0.13].forEach((mz, row) => b.both((side, n) => {
    const id = `leg${n}${row}`;
    b.limb({
      id, kind: 'leg', bone: body, mount: S(side * 0.1, 0.97, mz), lengths: [0.48 * s, 0.68 * s, 0.14 * s], radii: [0.028, 0.02, 0.012, 0.003].map((x) => x * s),
      style: 'needle', material: 'chitin', rest: S(side * (0.52 + r() * 0.05), 0, [0.42, 0.02, -0.4][row]), pole: V(side * 0.6, 1, 0), gait: ((row + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
    });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 0.08, 0), r: 0.07 * s, weak: false, part: id });
  }));
  b.hit({ bone: shell, at: S(0, 1.3, -0.02), r: 0.3 * s, weak: false });
  b.hit({ bone: shell, at: S(0, 1.65, 0), r: 0.17 * s, weak: false });
  b.hit({ bone: body, at: S(0, 0.95, 0), r: 0.17 * s, weak: false });
  b.hit({ bone: neck[2], at: S(0, 1.53, 0.06), r: 0.08 * s, weak: true, part: 'throat' });
  mutate(b, stage, {
    dorsal: [0.05, -0.1, -0.22].map((z) => S(0, 2.2, z)), flank: [S(0.5, 1.3, 0), S(0.5, 1.05, 0)],
    growth: 'fungus', growthSize: 0.08 * s, nodeSize: 0.02 * s, plateSize: 0.1 * s,
    extra: (bb) => bb.both((side, n) => {
      // Stage 3: a second, borrowed pair of arms: mantis hooks out of the husk's sleeves.
      const id = `hook${n}`;
      bb.limb({ id, kind: 'arm', bone: body, mount: S(side * 0.12, 1.0, 0.1), lengths: [0.28 * s, 0.3 * s, 0.2 * s], radii: [0.022, 0.018, 0.013, 0.003].map((x) => x * s), style: 'mantis', material: 'chitin', rest: S(side * 0.2, 0.9, 0.35), pole: V(side * 0.5, 1, 0.3), stage: 3 });
      bb.part({ id: `hookblade${n}`, type: 'blade', bone: { limb: id, seg: 2 }, at: V(0, 0, 0), dir: V(0, 1, 0), fwd: V(0, 0, -1), size: 0.22 * s, p: [0.2], material: 'bone', stage: 3 });
    }),
  });
  return b.plan;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** The host act (an upright sway), the hunch when it hunts, and the neck sliding out of the hood. */
export function shroudlingMotion(c: Creature) {
  const rig = c.rig;
  const bone = (n: string) => rig.bones.find((b) => b.name === n)!;
  const shell = bone('shell'), head = bone('head');
  const neck = Array.from({ length: NECK }, (_, i) => bone(`neck${i}`));
  const neckRest = neck.map((n) => n.position.clone());
  const headRest = head.position.clone();
  const shellRest = shell.quaternion.clone();
  const sleeves = [bone('sleeveL'), bone('sleeveR')];
  const swing = sleeves.map(() => ({ a: 0, v: 0 }));
  const mouth = rig.parts.get('mouth');
  const s = c.plan.radius / 0.6;
  let out = 0, hunch = 0, t = Math.random() * 10;
  return {
    update(dt: number): void {
      const d = c.drive;
      t += dt;
      const alive = c.alive;
      const speed = Math.hypot(d.velocity.x, d.velocity.z);
      out = damp(out, alive ? Math.max(d.windup, d.action) : 0.6, 8, dt);
      hunch = damp(hunch, alive ? Math.max(d.excite * 0.8, out * 0.6) : 1, 4, dt);
      // The host act: an upright, faintly human sway that loses its rhythm when the thing inside hurries.
      const sway = Math.sin(t * (1.6 + speed * 1.8)) * 0.06 * (1 - hunch * 0.5);
      shell.quaternion.copy(shellRest).multiply(_q.setFromEuler(_e.set(hunch * 0.45 + Math.abs(Math.sin(t * 3.2)) * 0.03 * Math.min(1, speed), Math.sin(t * 0.4) * 0.1, sway)));
      // The neck slides forward out of the hood, curving down then up toward its target.
      let aimUp = 0;
      if (d.look && out > 0.05) {
        head.parent!.worldToLocal(_v.copy(d.look));
        aimUp = THREE.MathUtils.clamp((_v.y - headRest.y) / Math.max(1, Math.abs(_v.z)), -0.5, 0.6);
      }
      neck.forEach((n, i) => {
        const k = (i + 1) / NECK;
        n.position.set(neckRest[i].x, neckRest[i].y - Math.sin(k * Math.PI) * out * 0.06 * s, neckRest[i].z + out * k * 0.42 * s);
      });
      head.position.set(headRest.x, headRest.y + out * aimUp * 0.25 * s, headRest.z + out * 0.5 * s);
      head.quaternion.setFromEuler(_e.set(-out * aimUp * 0.6 + Math.sin(t * 5.5) * 0.04 * out, Math.sin(t * 0.9) * 0.2 * (1 - out), 0));
      // Sleeves: pendulums kicked by the gait and the hunch, never in step with each other.
      swing.forEach((w, i) => {
        const kick = Math.sin(t * (1.6 + speed * 1.8) + i * Math.PI) * Math.min(1, speed) * 2.5;
        w.v += (-w.a * 22 - w.v * 2.2 + kick) * dt;
        w.a += w.v * dt;
        sleeves[i].quaternion.setFromEuler(_e.set(w.a * 0.6 - hunch * 0.3, 0, (i ? 1 : -1) * (0.05 + Math.abs(w.a) * 0.15)));
      });
      if (mouth) {
        mouth.mesh.quaternion.setFromRotationMatrix(mouth.base);
        mouth.mesh.scale.setScalar(1 + d.windup * 0.6);
      }
    },
  };
}
