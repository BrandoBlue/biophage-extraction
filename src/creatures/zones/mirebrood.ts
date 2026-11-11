import * as THREE from 'three';
import { FAUNA, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import type { BodyPlan, Palette } from '../plan';
import type { Creature } from '../creature';
import { damp } from './fx';

/**
 * Mirebrood (data/abominations.json `mirebrood`): the hand-sized swarm spiders of the Weeping Fen. Wolf spider
 * carrying young × firefly × frogspawn. A round abdomen whose back is a soft lantern, a dim warm light through a
 * skin of clustered clear eggs, on six short legs (two-segment, so a swarm stays cheap to draw). Alone they are
 * nothing; PvE AI pours them out of the roots in packs of 6 to 12.
 *
 * Drive:
 *   excite   the lantern brightens and quickens; the body skitters (small twitchy turns) when idle.
 *   windup   it rears its front up, fangs out.
 *   action   the bite lunge.
 * Weak point: the lantern back.
 */

export function mirebrood(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: FAUNA.peat, vein: ORGANIC.vein, rim: FAUNA.pearl,
    chitin: FAUNA.soot, chitinGlow: ORGANIC.amber, bone: FAUNA.pearl,
    glow: ORGANIC.amber, fluid: ORGANIC.vein, membrane: FAUNA.pearl, iris: ORGANIC.amber, sclera: FAUNA.soot,
  };
  const s = 0.85 + r() * 0.3;
  const h = 0.085 * s;
  const b = new PlanBuilder('mirebrood', seed, stage, { locomotion: 'walker', bodyHeight: h, radius: 0.16 * s, skinNoise: { amp: 0.002, freq: 60 }, skinResolution: 40, fleshScale: 40, palette: pal });
  // Peat-dark body, the lantern a low, warm light: a candle behind wet skin, not neon.
  b.plan.palette = { ...b.plan.palette, flesh: mix(FAUNA.peat, FAUNA.fenMoss, 0.3), chitin: mix(FAUNA.soot, FAUNA.peat, 0.4), glow: mix(ORGANIC.amber, FAUNA.reed, 0.3), membrane: mix(FAUNA.pearl, FAUNA.water, 0.3) };
  const S = (x: number, y: number, z: number) => V(x * s, y * s, z * s);
  const body = b.bone('body', -1, S(0, 0.085, 0));
  const back = b.bone('back', body, S(0, 0.11, -0.04));
  const head = b.bone('head', body, S(0, 0.085, 0.06));
  // Cephalothorax and the round abdomen.
  b.skin({ shape: 'ellipsoid', a: S(0, 0.085, 0.045), radii: S(0.045, 0.032, 0.05), bone: head, tint: tint('#ffffff', 0.9) });
  b.skin({ shape: 'ellipsoid', a: S(0, 0.11, -0.06), radii: S(0.075, 0.062, 0.085), blend: 0.02 * s, bone: back, ribs: { freq: 90 / s, depth: 0.0015 } });
  b.skin({ shape: 'ellipsoid', a: S(0, 0.07, -0.05), radii: S(0.05, 0.03, 0.06), blend: 0.02 * s, bone: back, tint: tint('#ffffff', 1.5) });
  // The lantern: a glowing core under a cap of frogspawn, the young riding on it.
  b.part({ id: 'lantern', type: 'node', bone: back, at: S(0, 0.14, -0.065), dir: V(0, 1, -0.2), size: 0.042 * s, material: 'glow', dynamic: true, weak: true });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.4, rr = 0.025 + r() * 0.025;
    const hit = b.surf(S(Math.cos(a) * rr, 0.3, -0.065 + Math.sin(a) * rr * 1.2), V(0, -1, 0));
    b.part({ id: `egg${i}`, type: 'pustule', bone: back, at: hit.at, dir: hit.normal, size: (0.01 + r() * 0.008) * s, material: 'membrane' });
  }
  // Six eyes: two big forward, four small in a row above.
  for (let i = 0; i < 6; i++) {
    const big = i < 2, k = big ? i : i - 2;
    const x = big ? (k ? 1 : -1) * 0.014 : (k - 1.5) * 0.013;
    const hit = b.surf(S(x, big ? 0.095 : 0.108, 0.2), V(0, 0, -1));
    b.part({ id: `eye${i}`, type: 'eye', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.002), dir: hit.normal.clone().add(V(0, big ? 0 : 0.5, 0)), size: (big ? 0.009 : 0.005) * s, material: 'eye', dynamic: true });
  }
  b.both((side, n) => b.part({ id: `fang${n}`, type: 'horn', bone: head, at: S(side * 0.012, 0.072, 0.09), dir: V(side * 0.1, -1, 0.5), fwd: V(0, 0, 1), size: 0.02 * s, p: [0.15, 0.6], material: 'chitin' }));
  // Six legs, two segments each.
  [0.04, 0.0, -0.04].forEach((mz, row) => b.both((side, n) => {
    const id = `leg${n}${row}`;
    b.limb({
      id, kind: 'leg', bone: body, mount: S(side * 0.03, 0.08, mz), lengths: [0.085 * s, 0.11 * s], radii: [0.008, 0.006, 0.002].map((x) => x * s),
      style: 'needle', material: 'chitin', rest: S(side * 0.15, 0, mz * 3 + (row === 0 ? 0.05 : row === 2 ? -0.03 : 0)), pole: V(side * 0.3, 1, 0), gait: ((row + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
    });
  }));
  b.hit({ bone: body, at: S(0, 0.09, 0), r: 0.09 * s, weak: false });
  b.hit({ bone: back, at: S(0, 0.15, -0.065), r: 0.05 * s, weak: true, part: 'lantern' });
  mutate(b, stage, {
    dorsal: [0.0, -0.06, -0.12].map((z) => S(0, 0.3, z)), flank: [S(0.15, 0.1, -0.05)],
    growth: 'fungus', growthSize: 0.03 * s, nodeSize: 0.008 * s, plateSize: 0.04 * s,
  });
  return b.plan;
}

const _e = new THREE.Euler();

/** The lantern breathing, the skitter, the rear and bite. */
export function mirebroodMotion(c: Creature) {
  const rig = c.rig;
  const bone = (n: string) => rig.bones.find((bn) => bn.name === n)!;
  const head = bone('head'), back = bone('back');
  const lantern = rig.parts.get('lantern');
  const glow = rig.materials.glow as THREE.MeshStandardMaterial | undefined;
  const base = glow?.emissiveIntensity ?? 1;
  let t = Math.random() * 10, rear = 0, bite = 0, twitch = 0, twitchT = 0, twitchTo = 0;
  return {
    update(dt: number): void {
      const d = c.drive;
      t += dt;
      const alive = c.alive;
      const speed = Math.hypot(d.velocity.x, d.velocity.z);
      // Lantern: a slow, uneven pulse like a firefly's, faster when roused; it gutters out on death.
      const rate = 1.1 + d.excite * 2.5;
      const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * rate), 3) * 0.7 + 0.3 + Math.sin(t * 13) * 0.03;
      if (glow) glow.emissiveIntensity = alive ? base * (0.2 + pulse * (0.35 + d.excite * 0.4)) : Math.max(0, glow.emissiveIntensity - dt * base);
      if (lantern) {
        lantern.mesh.position.setFromMatrixPosition(lantern.base);
        lantern.mesh.scale.setScalar(1 + pulse * 0.08);
      }
      // Skitter: idle twitches, small fast turns of the whole body.
      twitchT -= dt;
      if (alive && speed < 0.3 && twitchT <= 0) { twitchT = 0.3 + Math.random() * 1.2; twitchTo = (Math.random() - 0.5) * 0.9; }
      twitch = damp(twitch, alive && speed < 0.3 ? twitchTo : 0, 25, dt);
      // Rear on the wind-up, lunge on the bite.
      bite = Math.max(bite, d.action);
      d.action = Math.max(0, d.action - dt / 0.25);
      bite = Math.max(0, bite - dt / 0.25);
      rear = damp(rear, alive ? d.windup : 0, 14, dt);
      const body = rig.bones[0];
      body.quaternion.multiply(new THREE.Quaternion().setFromEuler(_e.set(-rear * 0.5 + bite * 0.25, twitch, 0)));
      head.quaternion.setFromEuler(_e.set(-rear * 0.2 + bite * 0.3, 0, 0));
      back.quaternion.setFromEuler(_e.set(rear * 0.25 + Math.sin(t * 2) * 0.03, 0, Math.sin(t * 1.3) * 0.03));
    },
  };
}
