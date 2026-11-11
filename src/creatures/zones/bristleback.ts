import * as THREE from 'three';
import { FAUNA, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import type { BodyPlan, Palette } from '../plan';
import type { Creature } from '../creature';
import { damp } from './fx';

/**
 * Bristleback (data/abominations.json `bristleback`): the armoured herd grazer of the Acacia Flats. Pangolin × camel
 * × pipe organ × sea urchin. Tall knobbled legs under a barrel shingled with scale plates, a long grazing neck, and
 * on its back a living water cistern: a clear blister you can see the water slosh in when it runs. Two banks of
 * hollow quills flank the cistern like organ pipes (they whistle; Sound has the chord). Young cling under the belly.
 *
 * Drive:
 *   windup   the quill banks rack up and outward (the volley tell), the head drops behind the brow shield.
 *   action   the volley itself: set to 1 when the quills fire; the banks shudder and snap forward as it decays.
 *   excite   0 grazing (head down, chewing) .. 1 alarmed (head up, the cistern sloshes harder in the stampede).
 * Weak point: the cistern seam, a raw join at the back of the blister.
 */

export function bristleback(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: FAUNA.ochre, vein: ORGANIC.vein, rim: FAUNA.dustPale,
    chitin: FAUNA.sandDeep, chitinGlow: ORGANIC.amber, bone: FAUNA.dustPale,
    glow: ORGANIC.amber, fluid: ORGANIC.vein, membrane: FAUNA.water, iris: ORGANIC.amber, sclera: FAUNA.soot,
  };
  const s = 0.94 + r() * 0.12;
  const h = 1.75 * s;
  const b = new PlanBuilder('bristleback', seed, stage, { locomotion: 'walker', bodyHeight: h, radius: 1.55 * s, skinNoise: { amp: 0.018, freq: 6 }, skinResolution: 60, fleshScale: 4, palette: pal });
  // Dust-caked hide and sun-bleached plate, not wet meat.
  b.plan.palette = { ...b.plan.palette, flesh: mix(FAUNA.ochre, FAUNA.sandDeep, 0.35), chitin: mix(FAUNA.sandDeep, FAUNA.ochre, 0.35), bone: mix(FAUNA.sand, FAUNA.sandDeep, 0.35), membrane: mix(FAUNA.water, FAUNA.dustPale, 0.25), rim: FAUNA.dustPale };
  const S = (x: number, y: number, z: number) => V(x * s, y * s, z * s);
  const body = b.bone('body', -1, S(0, 1.75, 0));
  const neck = b.bone('neck', body, S(0, 1.85, 1.05));
  const head = b.bone('head', neck, S(0, 1.45, 2.05));
  const quillL = b.bone('quillL', body, S(-0.42, 2.2, -0.15));
  const quillR = b.bone('quillR', body, S(0.42, 2.2, -0.15));
  const young = [b.bone('young0', body, S(0.2, 1.14, 0.3)), b.bone('young1', body, S(-0.22, 1.16, -0.45))];
  const tail = b.bone('tail', body, S(0, 1.55, -1.35));
  const hide = tint('#ffffff', 0.92), belly = tint('#ffffff', 1.2);
  // Barrel, shoulder hump and rump.
  b.skin({ shape: 'ellipsoid', a: S(0, 1.75, -0.05), radii: S(0.72, 0.6, 1.25), bone: body, tint: hide });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.95, 0.65), radii: S(0.62, 0.55, 0.6), blend: 0.3 * s, bone: body, tint: hide });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.38, -0.05), radii: S(0.55, 0.32, 0.95), blend: 0.25 * s, bone: body, tint: belly });
  // A saddle hollow in the back where the cistern sits.
  b.skin({ shape: 'ellipsoid', a: S(0, 2.5, -0.15), radii: S(0.66, 0.3, 0.72), subtract: true, blend: 0.12 * s, bone: body });
  // Long neck and a narrow grazing head with a soft, prehensile lip.
  b.skin({ shape: 'cone', a: S(0, 1.95, 0.85), b: S(0, 1.55, 1.85), ra: 0.36 * s, rb: 0.19 * s, blend: 0.2 * s, bone: neck, ribs: { freq: 6 / s, depth: 0.015 } });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.5, 2.05), radii: S(0.2, 0.22, 0.3), blend: 0.1 * s, bone: head });
  b.skin({ shape: 'cone', a: S(0, 1.45, 2.15), b: S(0, 1.22, 2.55), ra: 0.17 * s, rb: 0.09 * s, blend: 0.08 * s, bone: head, ribs: { freq: 14 / s, depth: 0.006 } });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.17, 2.58), radii: S(0.08, 0.06, 0.06), subtract: true, blend: 0.03, bone: head });
  // Tail: a short plated club.
  b.skin({ shape: 'cone', a: S(0, 1.65, -1.15), b: S(0, 1.15, -1.85), ra: 0.3 * s, rb: 0.12 * s, blend: 0.15 * s, bone: tail, ribs: { freq: 7 / s, depth: 0.02 } });
  // Young: two lumpy calves hanging on under the belly by their claws.
  young.forEach((yb, i) => {
    const at = b.plan.bones[yb].at;
    b.skin({ shape: 'ellipsoid', a: at, radii: S(0.18, 0.14, 0.28), blend: 0.12 * s, bone: yb, tint: tint('#ffffff', 1.05) });
    b.skin({ shape: 'ellipsoid', a: at.clone().add(S(0, -0.02, 0.27 * (i ? -1 : 1))), radii: S(0.1, 0.09, 0.12), blend: 0.05 * s, bone: yb });
  });
  // Pangolin shingles: rows of scale plates down each flank, over the rump and neck.
  b.both((side, n) => {
    for (let row = 0; row < 3; row++) for (let k = 0; k < 7; k++) {
      const z = 1.0 - k * 0.32 + (row % 2) * 0.16, y = 2.05 - row * 0.3;
      const hit = b.surf(S(side * 1.6, y, z), V(-side, -0.15, 0));
      if (hit.at.distanceTo(S(side * 1.6, y, z)) > 1.4 * s) continue;
      b.part({ id: `scale${n}${row}${k}`, type: 'plate', bone: hit.bone, at: hit.at.clone().addScaledVector(hit.normal, -0.02), dir: hit.normal.clone().add(V(0, 0.2, -0.45)), fwd: V(0, -0.4, -1), size: (0.26 - row * 0.03) * s, p: [1, 1.25, 0.32, 0.45], material: 'bone' });
    }
    for (let k = 0; k < 4; k++) {
      const hit = b.surf(S(side * 0.8, 2.1 - k * 0.12, 1.15 + k * 0.22), V(-side, -0.4, 0));
      b.part({ id: `neckscale${n}${k}`, type: 'plate', bone: neck, at: hit.at, dir: hit.normal.clone().add(V(0, 0.3, -0.4)), fwd: V(0, -0.3, -1), size: 0.2 * s, p: [1, 1.2, 0.3, 0.4], material: 'bone' });
    }
  });
  // Brow and chest shield: the front armour arc.
  b.part({ id: 'brow', type: 'plate', bone: head, at: S(0, 1.66, 2.05), dir: V(0, 1, 0.45), fwd: V(0, 0.4, 1), size: 0.24 * s, p: [0.9, 1.35, 0.32, 0.6], material: 'chitin' });
  b.part({ id: 'chest', type: 'plate', bone: body, at: S(0, 1.72, 1.12), dir: V(0, 0.35, 1), fwd: V(0, 1, 0), size: 0.62 * s, p: [1.1, 0.95, 0.35, 0.5], material: 'bone' });
  b.both((side, n) => b.part({ id: `jowl${n}`, type: 'plate', bone: head, at: S(side * 0.16, 1.42, 2.1), dir: V(side, -0.1, 0.35), fwd: V(0, 0, 1), size: 0.16 * s, p: [0.8, 1.3, 0.3, 0.5], material: 'chitin' }));
  // Eyes: three small ones per side under the brow, wide apart (a grazer's all-round watch).
  b.both((side, n) => [0, 1, 2].forEach((k) => {
    const hit = b.surf(S(side * 0.6, 1.56 - k * 0.04, 2.12 - k * 0.09), V(-side, 0, 0));
    b.part({ id: `eye${n}${k}`, type: 'eye', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.012), dir: hit.normal.clone().add(V(0, 0.1, 0.3)), size: (0.034 - k * 0.006) * s, material: 'eye', dynamic: true });
  }));
  // The cistern: a clear blister over the spine with the water mass inside it, ringed by a plate collar.
  b.part({ id: 'water', type: 'lens', bone: body, at: S(0, 2.3, -0.15), dir: V(0, 1, 0), fwd: V(0, 0, 1), size: 0.6 * s, material: 'membrane', dynamic: true });
  b.part({ id: 'cistern', type: 'membraneDome', bone: body, at: S(0, 2.2, -0.15), dir: V(0, 1, 0), fwd: V(0, 0, 1), size: 0.74 * s, p: [0.5, 0.75], material: 'glass', dynamic: true });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const at = S(Math.cos(a) * 0.72, 2.22, -0.15 + Math.sin(a) * 0.72);
    b.part({ id: `collar${i}`, type: 'plate', bone: body, at, dir: V(Math.cos(a), 0.9, Math.sin(a)), fwd: V(-Math.sin(a), 0, Math.cos(a)), size: 0.3 * s, p: [1.2, 0.9, 0.3, 0.3], material: 'bone' });
  }
  b.part({ id: 'seam', type: 'pustule', bone: body, at: S(0, 2.1, -0.92), dir: V(0, 0.6, -1), size: 0.13 * s, material: 'raw', dynamic: true, weak: true });
  // Quill banks: hollow organ pipes, longest in the middle, flanking the cistern.
  [quillL, quillR].forEach((qb, sideI) => {
    const side = sideI ? 1 : -1;
    for (let k = 0; k < 9; k++) {
      const z = 0.5 - k * 0.15;
      const len = 9 + Math.sin((k / 8) * Math.PI) * 13 + r() * 2;
      b.part({ id: `quill${sideI}${k}`, type: 'vent', bone: qb, at: S(side * (0.7 + Math.abs(k - 4) * 0.015), 2.05, z), dir: V(side * 0.2, 1, -0.1 - k * 0.025), fwd: V(0, 0, 1), size: 0.036 * s, p: [len], material: 'bone' });
    }
  });
  // Camel legs: long, knobbled at the knee, splayed wide pads.
  ([[0.85, 1.0, 1, 0], [-0.75, -0.95, -1, 1]] as const).forEach(([mz, fz, knee, row]) => b.both((side, n) => {
    const id = `leg${n}${row}`;
    b.limb({
      id, kind: 'leg', bone: body, mount: S(side * 0.48, 1.45, mz), lengths: [0.78 * s, 0.82 * s, 0.22 * s], radii: [0.16, 0.1, 0.06, 0.075].map((x) => x * s),
      style: 'bone', material: 'chitin', rest: S(side * 0.78, 0, fz), pole: V(side * 0.15, 0.2, knee), gait: ((row + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
    });
    b.part({ id: `knee${n}${row}`, type: 'plate', bone: { limb: id, seg: 1 }, at: V(0, 0.02, 0), dir: V(0, 0, knee), fwd: V(0, 1, 0), size: 0.16 * s, p: [0.9, 1, 0.4, 0.6], material: 'chitin' });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 0.3, 0), r: 0.16 * s, weak: false, part: id });
  }));
  b.hit({ bone: body, at: S(0, 1.75, 0), r: 0.95 * s, weak: false });
  b.hit({ bone: body, at: S(0, 1.9, 0.75), r: 0.65 * s, weak: false });
  b.hit({ bone: head, at: S(0, 1.45, 2.15), r: 0.33 * s, weak: false });
  b.hit({ bone: body, at: S(0, 2.35, -0.15), r: 0.62 * s, weak: false });
  b.hit({ bone: body, at: S(0, 2.1, -0.92), r: 0.2 * s, weak: true, part: 'seam' });
  mutate(b, stage, {
    dorsal: [1.15, 0.85, -0.95, -1.2].map((z) => S(0, 3.2, z)), flank: [S(1.4, 1.6, 0.6), S(1.4, 1.5, -0.6)],
    growth: 'crystals', growthSize: 0.3 * s, nodeSize: 0.06 * s, plateSize: 0.32 * s,
    extra: (bb) => bb.both((side, n) => {
      // Stage 3: tusk-hooks sprout from the jaw, for goring rather than grazing.
      bb.part({ id: `tusk${n}`, type: 'horn', bone: head, at: S(side * 0.12, 1.25, 2.35), dir: V(side * 0.5, -0.3, 1), fwd: V(0, 1, 0), size: 0.55 * s, p: [0.1, 0.8], material: 'bone', stage: 3 });
    }),
  });
  return b.plan;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** Cistern slosh, quill racking, grazing and the calves' clinging. */
export function bristlebackMotion(c: Creature) {
  const rig = c.rig;
  const bone = (n: string) => rig.bones.find((b) => b.name === n)!;
  const neck = bone('neck'), head = bone('head'), tail = bone('tail');
  const quills = [bone('quillL'), bone('quillR')];
  const young = [bone('young0'), bone('young1')];
  const neckRest = neck.quaternion.clone(), headRest = head.quaternion.clone(), tailRest = tail.quaternion.clone();
  const water = rig.parts.get('water');
  const lastV = new THREE.Vector3();
  const slosh = { x: 0, z: 0, vx: 0, vz: 0 };
  let graze = 0, rack = 0, volley = 0, t = Math.random() * 20;
  return {
    update(dt: number): void {
      const d = c.drive;
      t += dt;
      const alive = c.alive;
      const speed = Math.hypot(d.velocity.x, d.velocity.z);
      // Grazing: head down to the grass when calm and still, lifting now and then to look round.
      const calm = alive && speed < 0.4 && d.excite < 0.45 && d.windup < 0.05;
      const lift = Math.sin(t * 0.37) > 0.75 ? 0 : 1;
      graze = damp(graze, calm ? lift : 0, 2.5, dt);
      neck.quaternion.copy(neckRest).multiply(_q.setFromEuler(_e.set(graze * 0.75 + d.windup * 0.25 + (alive ? 0 : 0.6), Math.sin(t * 0.21) * 0.15 * (1 - d.excite), 0)));
      head.quaternion.copy(headRest).multiply(_q.setFromEuler(_e.set(graze * 0.25 + Math.sin(t * 7) * 0.03 * graze - d.windup * 0.15, 0, 0)));
      tail.quaternion.copy(tailRest).multiply(_q.setFromEuler(_e.set(0, Math.sin(t * 1.4) * 0.25 + Math.sin(t * 9) * 0.06 * d.excite, 0)));
      // Quills: rack up and out on the wind-up, shudder and snap forward on the volley.
      volley = Math.max(volley, d.action);
      d.action = Math.max(0, d.action - dt / 0.6);
      volley = Math.max(0, volley - dt / 0.6);
      rack = damp(rack, alive ? d.windup : 0, 9, dt);
      quills.forEach((q, i) => {
        const side = i ? 1 : -1;
        const shake = volley * Math.sin(t * 60 + i) * 0.08 + Math.sin(t * 2.3 + i) * 0.02 * d.excite;
        q.quaternion.setFromEuler(_e.set(-rack * 0.45 + volley * 0.5 + shake, 0, -side * (rack * 0.4 - volley * 0.2)));
      });
      // Cistern: a damped spring tilts the water against the body's acceleration and the gait's bob.
      if (water) {
        _v.copy(d.velocity).sub(lastV).divideScalar(Math.max(dt, 1e-3));
        lastV.copy(d.velocity);
        const inv = rig.root.getWorldQuaternion(_q).invert();
        _v.applyQuaternion(inv);
        const k = 40, damping = 3.5;
        const ax = -_v.z * 0.02 + Math.sin(t * (2 + speed * 2.2)) * 0.03 * Math.min(1, speed / 3);
        const az = _v.x * 0.02;
        slosh.vx += (-(slosh.x - ax) * k - slosh.vx * damping) * dt;
        slosh.vz += (-(slosh.z - az) * k - slosh.vz * damping) * dt;
        slosh.x += slosh.vx * dt; slosh.z += slosh.vz * dt;
        slosh.x = THREE.MathUtils.clamp(slosh.x, -0.35, 0.35); slosh.z = THREE.MathUtils.clamp(slosh.z, -0.35, 0.35);
        water.mesh.position.setFromMatrixPosition(water.base);
        water.mesh.quaternion.setFromRotationMatrix(water.base).multiply(_q.setFromEuler(_e.set(slosh.x, 0, slosh.z)));
        water.mesh.position.y += Math.sin(t * 3.1) * 0.01 - Math.abs(slosh.x) * 0.05;
      }
      // Calves: clinging, shifting their grip.
      young.forEach((y, i) => y.quaternion.setFromEuler(_e.set(Math.sin(t * 1.7 + i * 2) * 0.12, Math.sin(t * 1.1 + i) * 0.2, Math.sin(t * 2.3 + i) * 0.1)));
    },
  };
}
