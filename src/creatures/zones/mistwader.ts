import * as THREE from 'three';
import { FAUNA, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import type { BodyPlan, Palette } from '../plan';
import type { Creature } from '../creature';
import { GroundFx, damp } from './fx';

/**
 * Mistwader (data/abominations.json `mistwader`): the giant of the Weeping Fen. Sauropod × heron × a walking willow.
 * Four storeys tall: a mossy barrel slung between four stilt legs that vanish into the mist, a long swan neck, and
 * a small eyeless head (two empty sockets where eyes should be) whose long bill is fringed with a comb of bristles
 * it drags through the water. Moss hangs off it in ropes. Four throat sacs down the front of the neck swell in turn
 * as it hums: they are the weak points.
 *
 * Drive:
 *   excite   below 0.55 calm: it lowers its neck and combs the water, the head sweeping side to side. 1 alarmed: neck up.
 *   windup   the stomp tell: it rears back on its hind legs' side, head high.
 *   action   the stomp: set to 1 as it lands; water rings and spray at the forefeet.
 * It is eyeless by design (the brief), so it has no eye parts.
 */

const NECK = 6;

export function mistwader(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: FAUNA.fenMoss, vein: ORGANIC.vein, rim: FAUNA.pearl,
    chitin: FAUNA.peat, chitinGlow: ORGANIC.amber, bone: FAUNA.pearl,
    glow: ORGANIC.amber, fluid: ORGANIC.vein, membrane: FAUNA.fenMoss, iris: ORGANIC.amber, sclera: FAUNA.soot,
  };
  const s = 0.95 + r() * 0.1;
  const h = 8 * s;
  const b = new PlanBuilder('mistwader', seed, stage, { locomotion: 'walker', bodyHeight: h, radius: 3.2 * s, skinNoise: { amp: 0.035, freq: 2.5 }, skinResolution: 64, fleshScale: 1.4, palette: pal });
  // Wet moss over grey hide, bark-dark legs, pale shelf fungus; the sacs a dim pearl.
  b.plan.palette = {
    ...b.plan.palette,
    flesh: mix(FAUNA.fenMoss, FAUNA.peat, 0.3), chitin: mix(FAUNA.peat, FAUNA.soot, 0.3), bone: mix(FAUNA.pearl, FAUNA.reed, 0.35),
    membrane: mix(FAUNA.fenMoss, FAUNA.reed, 0.3), glow: mix(FAUNA.pearl, ORGANIC.amber, 0.25), rim: mix(FAUNA.pearl, FAUNA.water, 0.4),
  };
  const S = (x: number, y: number, z: number) => V(x * s, y * s, z * s);
  const body = b.bone('body', -1, S(0, 8, 0));
  // The swan neck: up off the shoulders, back a little, then forward to the head.
  const P = [S(0, 8.7, 1.9), S(0, 9.8, 2.5), S(0, 10.9, 2.75), S(0, 11.95, 2.85), S(0, 12.85, 3.2), S(0, 13.4, 3.85), S(0, 13.5, 4.55)];
  const neck: number[] = [];
  for (let i = 0; i < NECK; i++) neck.push(b.bone(`neck${i}`, i ? neck[i - 1] : body, P[i]));
  const head = b.bone('head', neck[NECK - 1], P[NECK]);
  const tail = b.bone('tail', body, S(0, 7.8, -2.2));
  const hide = tint('#ffffff', 0.9), belly = tint(FAUNA.pearl, 1.1), dark = tint('#ffffff', 0.62);
  // Barrel, shoulder hump, pale underside, short drooping tail.
  b.skin({ shape: 'ellipsoid', a: S(0, 8, -0.2), radii: S(1.45, 1.25, 2.3), bone: body, tint: hide });
  b.skin({ shape: 'ellipsoid', a: S(0, 8.55, 1.25), radii: S(1.3, 1.15, 1.2), blend: 0.6 * s, bone: body, tint: hide });
  b.skin({ shape: 'ellipsoid', a: S(0, 7.25, 0), radii: S(1.05, 0.55, 1.9), blend: 0.5 * s, bone: body, tint: belly });
  b.skin({ shape: 'cone', a: S(0, 7.9, -2.0), b: S(0, 6.7, -3.6), ra: 0.65 * s, rb: 0.18 * s, blend: 0.4 * s, bone: tail, ribs: { freq: 3 / s, depth: 0.03 }, tint: dark });
  // Neck: tapering, ringed like a reed stem.
  for (let i = 0; i < NECK; i++) {
    const ra = (0.72 - i * 0.075) * s, rb = (0.65 - i * 0.075) * s;
    b.skin({ shape: 'cone', a: P[i], b: P[i + 1], ra, rb, blend: 0.25 * s, bone: neck[i], ribs: { freq: 2.6 / s, depth: 0.025 }, tint: i % 2 ? hide : tint('#ffffff', 0.84) });
  }
  // The head: small, smooth, eyeless; a long flat bill.
  const H = P[NECK];
  b.skin({ shape: 'ellipsoid', a: H.clone().add(S(0, 0.05, 0.2)), radii: S(0.3, 0.27, 0.42), blend: 0.15 * s, bone: head, tint: tint(FAUNA.pearl, 0.95) });
  b.skin({ shape: 'cone', a: H.clone().add(S(0, -0.04, 0.5)), b: H.clone().add(S(0, -0.38, 1.55)), ra: 0.17 * s, rb: 0.06 * s, blend: 0.1 * s, bone: head, ribs: { freq: 9 / s, depth: 0.006 }, tint: dark });
  // Sockets with nothing in them.
  b.both((side) => b.skin({ shape: 'ellipsoid', a: H.clone().add(S(side * 0.25, 0.1, 0.32)), radii: S(0.07, 0.06, 0.08), subtract: true, blend: 0.05 * s, bone: head }));
  // The comb: a fringe of bristles under the bill.
  for (let k = 0; k < 9; k++) {
    const u = k / 8;
    const at = H.clone().add(S(0, -0.12 - u * 0.3, 0.6 + u * 0.9));
    b.both((side, n) => b.part({ id: `comb${n}${k}`, type: 'spike', bone: head, at: at.clone().add(S(side * (0.1 - u * 0.05), 0, 0)), dir: V(side * 0.25, -1, 0.15), fwd: V(0, 0, 1), size: (0.32 - u * 0.12) * s, p: [0.02, 0.15], material: 'bone' }));
  }
  // Throat sacs down the front of the neck, swelling in turn as it hums.
  for (let i = 0; i < 4; i++) {
    const k = i + 1;
    const mid = P[k].clone().lerp(P[k + 1], 0.5);
    const hit = b.surf(mid.clone().add(S(0, -0.4, 2)), V(0, 0.2, -1));
    b.part({ id: `sac${i}`, type: 'sac', bone: neck[k], at: hit.at.clone().addScaledVector(hit.normal, -0.08 * s), dir: hit.normal, fwd: V(0, 1, 0), size: (0.36 - i * 0.04) * s, material: 'membrane', dynamic: true, weak: true });
    b.hit({ bone: neck[k], at: hit.at.clone().addScaledVector(hit.normal, 0.1 * s), r: (0.42 - i * 0.04) * s, weak: true, part: `sac${i}` });
  }
  // Moss in ropes off the belly, flanks and neck; shelf fungus on the back.
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2, z = -1.8 + r() * 3.4;
    const hit = b.surf(S(Math.cos(a) * 3, 7.2 + Math.sin(a) * 0.4 - 0.6, z), V(-Math.cos(a), 0.3, 0));
    b.part({ id: `moss${i}`, type: 'cord', bone: body, at: hit.at, dir: V((r() - 0.5) * 0.2, -1, (r() - 0.5) * 0.2), size: (1 + r() * 2.2) * s, material: 'membrane' });
  }
  for (let i = 1; i < NECK - 1; i++) {
    const hit = b.surf(P[i].clone().add(S(0, 0, -2)), V(0, 0, 1));
    b.part({ id: `neckmoss${i}`, type: 'cord', bone: neck[i], at: hit.at, dir: V(0, -1, -0.2), size: (0.8 + r() * 1.2) * s, material: 'membrane' });
  }
  for (let i = 0; i < 6; i++) {
    const hit = b.surf(S((r() - 0.5) * 2, 11, -1.6 + i * 0.55), V(0, -1, 0));
    b.part({ id: `shelf${i}`, type: 'fungus', bone: body, at: hit.at, dir: hit.normal.clone().lerp(V(0, 1, 0), 0.4), size: (0.35 + r() * 0.25) * s, p: [3 + Math.floor(r() * 3)], material: 'bone' });
  }
  // Four stilts, bark-dark and knobbled, the knees bending like a heron's.
  ([[1.45, 2.5, 0, 1], [-1.45, -2.3, 1, -1]] as const).forEach(([mz, fz, row, knee]) => b.both((side, n) => {
    const id = `leg${n}${row}`;
    b.limb({
      id, kind: 'leg', bone: body, mount: S(side * 0.9, 7.4, mz), lengths: [3.7 * s, 4.1 * s, 0.5 * s], radii: [0.42, 0.26, 0.17, 0.22].map((x) => x * s),
      style: 'bone', material: 'flesh', rest: S(side * 1.6, 0, fz), pole: V(side * 0.1, 0, knee), gait: ((row + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
    });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 2, 0), r: 0.4 * s, weak: false, part: id });
    b.hit({ bone: { limb: id, seg: 0 }, at: V(0, 1.8, 0), r: 0.5 * s, weak: false, part: id });
  }));
  b.hit({ bone: body, at: S(0, 8, -0.2), r: 1.8 * s, weak: false });
  b.hit({ bone: body, at: S(0, 8.5, 1.4), r: 1.3 * s, weak: false });
  for (let i = 0; i < NECK; i++) b.hit({ bone: neck[i], at: P[i].clone().lerp(P[i + 1], 0.5), r: (0.7 - i * 0.07) * s, weak: false });
  b.hit({ bone: head, at: H.clone().add(S(0, 0, 0.4)), r: 0.45 * s, weak: false });
  mutate(b, stage, {
    dorsal: [1.4, 0.6, -0.4, -1.4].map((z) => S(0, 12, z)), flank: [S(2.5, 8, 0.6), S(2.5, 8, -0.8)],
    growth: 'fungus', growthSize: 0.5 * s, nodeSize: 0.12 * s, plateSize: 0.7 * s,
    extra: (bb) => bb.both((side, n) => {
      // Stage 3: antler-branches out of the shoulders, the willow taking over.
      bb.part({ id: `antler${n}`, type: 'horn', bone: body, at: S(side * 0.9, 9.3, 1.4), dir: V(side * 0.6, 1, -0.3), fwd: V(0, 0, 1), size: 2.4 * s, p: [0.1, 1.2], material: 'chitin', stage: 3 });
    }),
  });
  return b.plan;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _w = new THREE.Vector3();

/** Combing the water with its neck, the hum through the throat sacs, the rear and stomp. */
export function mistwaderMotion(c: Creature) {
  const rig = c.rig;
  const bone = (n: string) => rig.bones.find((bn) => bn.name === n)!;
  const neck = Array.from({ length: NECK }, (_, i) => bone(`neck${i}`));
  const head = bone('head'), tail = bone('tail');
  const rest = new Map([...neck, head, tail].map((bn) => [bn, bn.quaternion.clone()]));
  const sacs = [0, 1, 2, 3].map((i) => rig.parts.get(`sac${i}`)).filter((p) => !!p);
  const fore = [...rig.limbs.values()].filter((l) => l.spec.kind === 'leg' && l.spec.mount.z > 0);
  const s = c.plan.radius / 3.2;
  const fx = new GroundFx(rig.root, { rings: 10, sprays: 24 });
  // How far each neck joint bends to bring the bill down into the water: mostly at the base, so the neck reaches.
  const DIP = [1.25, 0.45, 0.2, 0.1, 0.05, 0];
  let t = Math.random() * 30, comb = 0, rear = 0, stomp = 0, lastAction = 0, dripT = 0;
  const pose = (bn: THREE.Bone, x: number, y: number, z: number) => bn.quaternion.copy(rest.get(bn)!).multiply(_q.setFromEuler(_e.set(x, y, z)));
  return {
    update(dt: number): void {
      const d = c.drive;
      t += dt;
      const alive = c.alive;
      const speed = Math.hypot(d.velocity.x, d.velocity.z);
      // Calm and slow: it crouches on its stilts and reaches the neck down, combing. Alarmed or rearing: neck up.
      const calm = alive && d.excite < 0.55 && d.windup < 0.05 && speed < 1.2;
      comb = damp(comb, calm ? 1 : alive ? 0 : 0.85, calm ? 0.45 : 2, dt);
      rear = damp(rear, alive ? d.windup : 0, 2.5, dt);
      if (d.action > 0.5 && lastAction <= 0.5) {
        stomp = 1;
        d.slam = 1;
        for (const l of fore) {
          if (l.severed) continue;
          l.bones[l.bones.length - 1].getWorldPosition(_w);
          _w.y = c.worldPos.y + 0.05;
          fx.ring(_w, 4 * s, 1.6);
          fx.ring(_w, 2.2 * s, 1.1);
          for (let k = 0; k < 10; k++) fx.spray(_w.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * s, 0, (Math.random() - 0.5) * 2 * s)), (0.25 + Math.random() * 0.3) * s, 4 + Math.random() * 3, 1.2);
        }
      }
      lastAction = d.action;
      d.action = Math.max(0, d.action - dt / 0.8);
      stomp = Math.max(0, stomp - dt / 0.8);
      // Rear up on the wind-up (the shared walker tilts the body back on windup); the stomp is the walker's slam.
      c.sink = (comb * 1.6 - rear * 0.7) * s;
      // The neck: a slow sweep while it combs, each joint lagging the one below.
      const sweep = Math.sin(t * 0.35) * 0.45 * comb;
      neck.forEach((n, i) => {
        const lag = Math.sin(t * 0.35 - i * 0.25) * 0.45 * comb;
        pose(n, DIP[i] * comb - rear * 0.06 + Math.sin(t * 0.8 + i * 0.6) * 0.02, (lag / NECK) * 1.4, Math.sin(t * 0.5 + i) * 0.015);
      });
      // Head: bill angled into the water while combing, a small sifting shake; level and searching when alarmed.
      pose(head, comb * 0.5 + Math.sin(t * 5) * 0.03 * comb - rear * 0.2, sweep * 0.2 + Math.sin(t * 0.7) * 0.25 * (1 - comb), 0);
      pose(tail, Math.sin(t * 0.4) * 0.04 + rear * 0.15, Math.sin(t * 0.55) * 0.12, 0);
      // The hum: a slow swell travelling up the sacs.
      sacs.forEach((p, i) => {
        p.mesh.position.setFromMatrixPosition(p.base);
        p.mesh.quaternion.setFromRotationMatrix(p.base);
        const swell = alive ? Math.max(0, Math.sin(t * 1.3 - i * 0.9)) : 0;
        p.mesh.scale.setScalar(1 + swell * 0.28 + rear * 0.15);
      });
      // Water running off the bill while it combs.
      dripT -= dt;
      if (alive && comb > 0.7 && dripT <= 0) {
        dripT = 0.5 + Math.random() * 0.7;
        head.getWorldPosition(_w);
        _w.y = c.worldPos.y + 0.02;
        fx.ring(_w, (0.8 + Math.random() * 0.6) * s, 2);
      }
      fx.update(dt);
    },
    get fx() { return fx; },
    get comb() { return comb; },
  };
}
