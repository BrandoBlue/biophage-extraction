import * as THREE from 'three';
import { FAUNA, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import { organic, readable } from './organic';
import type { BodyPlan, Palette } from '../plan';
import type { Creature } from '../creature';
import { damp } from './fx';

/**
 * Cablecrawler (data/abominations.json `cablecrawler`): the walkway cutter of the Marrow Pit. Huntsman spider × wire
 * cutter × barnacle. A flat, wide thing on eight hooked legs, its back a seed-pod split down the middle into two
 * lobes crusted with barnacle cups, the seam between them pale and wet (the weak point). Under the front, two
 * shear mandibles. Pale, damp, the colour of old rope.
 *
 * Drive:
 *   windup   the shears gape and the pod lobes lift (the bite tell).
 *   action   cutting: the body presses flat and the shears scissor fast (2.5 s at a walkway lashing).
 * Climbing: set `creature.surface` to the wall or walkway-underside plane and orient the root's +Y along its normal;
 * the feet plant on that plane.
 */

export function cablecrawler(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: FAUNA.rope, vein: ORGANIC.vein, rim: FAUNA.dustPale,
    chitin: FAUNA.rope, chitinGlow: ORGANIC.amber, bone: FAUNA.pearl,
    glow: ORGANIC.amber, fluid: ORGANIC.vein, membrane: FAUNA.pearl, iris: ORGANIC.amber, sclera: FAUNA.soot,
  };
  const s = 0.94 + r() * 0.12;
  const h = 0.32 * s;
  const b = new PlanBuilder('cablecrawler', seed, stage, { locomotion: 'walker', bodyHeight: h, radius: 0.85 * s, skinNoise: { amp: 0.006, freq: 20 }, skinResolution: 60, fleshScale: 10, palette: pal });
  organic(b, rng(seed * 17 + 3));
  // Damp old rope and pale mould, not meat.
  b.plan.palette = { ...b.plan.palette, flesh: mix(FAUNA.rope, FAUNA.soot, 0.25), chitin: mix(FAUNA.rope, FAUNA.peat, 0.4), bone: mix(FAUNA.pearl, FAUNA.rope, 0.4) };
  readable(b);
  const S = (x: number, y: number, z: number) => V(x * s, y * s, z * s);
  const body = b.bone('body', -1, S(0, 0.32, 0));
  const head = b.bone('head', body, S(0, 0.3, 0.36));
  const podL = b.bone('podL', body, S(-0.14, 0.4, -0.05));
  const podR = b.bone('podR', body, S(0.14, 0.4, -0.05));
  const mandL = b.bone('mandL', head, S(-0.08, 0.24, 0.5));
  const mandR = b.bone('mandR', head, S(0.08, 0.24, 0.5));
  const pale = tint('#ffffff', 1.15);
  // Flat underbody and the cephalothorax wedge.
  b.skin({ shape: 'ellipsoid', a: S(0, 0.3, 0), radii: S(0.34, 0.1, 0.42), bone: body, tint: tint('#ffffff', 0.9) });
  b.skin({ shape: 'ellipsoid', a: S(0, 0.3, 0.36), radii: S(0.22, 0.09, 0.17), blend: 0.08 * s, bone: head });
  // The split seed-pod back: two domed lobes with a seam between them.
  b.both((side) => b.skin({ shape: 'ellipsoid', a: S(side * 0.15, 0.37, -0.08), radii: S(0.17, 0.11, 0.38), blend: 0.04 * s, bone: side < 0 ? podL : podR, ribs: { freq: 12 / s, depth: 0.006 }, tint: pale }));
  b.part({ id: 'seam', type: 'sac', bone: body, at: S(0, 0.4, -0.08), dir: V(0, 1, 0), fwd: V(0, 0, 1), size: 0.07 * s, material: 'raw', dynamic: true, weak: true });
  // Barnacle cups crusting the lobes.
  b.both((side, n) => {
    for (let k = 0; k < 6; k++) {
      const z = 0.18 - k * 0.09 + r() * 0.03, x = side * (0.12 + r() * 0.1);
      const hit = b.surf(S(x, 0.9, z), V(0, -1, 0));
      b.part({ id: `barnacle${n}${k}`, type: 'vent', bone: side < 0 ? podL : podR, at: hit.at, dir: hit.normal.clone().add(V(side * 0.3, 0, 0)), size: (0.02 + r() * 0.012) * s, p: [0.9 + r() * 0.5], material: 'bone' });
    }
  });
  // Eight eyes in two rows across the front of the wedge.
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 0 : 1, k = i % 4;
    const hit = b.surf(S((k - 1.5) * 0.065 * (row ? 1.3 : 1), 0.36 + row * 0.03, 0.8), V(0, -0.2, -1));
    b.part({ id: `eye${i}`, type: 'eye', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.006), dir: hit.normal.clone().add(V(0, 0.3, 0)), size: (row ? 0.018 : 0.013 + (k === 1 || k === 2 ? 0.005 : 0)) * s, material: 'eye', dynamic: true });
  }
  // Shear mandibles: two crossed blades under the face.
  b.both((side, n) => b.part({ id: `shear${n}`, type: 'blade', bone: side < 0 ? mandL : mandR, at: S(side * 0.08, 0.24, 0.48), dir: V(-side * 0.35, -0.15, 1), fwd: V(side, 0, 0), size: 0.3 * s, p: [0.3], material: 'bone' }));
  // Eight hooked legs, laterigrade: knees high, feet far out to the sides.
  const rows = [[0.28, 0.85], [0.1, 0.3], [-0.08, -0.25], [-0.25, -0.8]];
  rows.forEach(([mz, fz], row) => b.both((side, n) => {
    const id = `leg${n}${row}`;
    b.limb({
      id, kind: 'leg', bone: body, mount: S(side * 0.28, 0.3, mz), lengths: [0.46 * s, 0.56 * s, 0.2 * s], radii: [0.035, 0.026, 0.016, 0.004].map((x) => x * s),
      style: 'needle', material: 'chitin', rest: S(side * (1.0 + r() * 0.08), 0, fz), pole: V(side * 0.4, 1, 0), gait: ((row + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
    });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 0.1, 0), r: 0.07 * s, weak: false, part: id });
  }));
  b.hit({ bone: body, at: S(0, 0.33, -0.05), r: 0.38 * s, weak: false });
  b.hit({ bone: head, at: S(0, 0.3, 0.42), r: 0.2 * s, weak: false });
  b.hit({ bone: body, at: S(0, 0.42, -0.08), r: 0.12 * s, weak: true, part: 'seam' });
  mutate(b, stage, {
    dorsal: [0.2, 0.0, -0.2, -0.4].map((z) => S(0.15, 1, z)), flank: [S(0.6, 0.32, 0.1), S(0.6, 0.32, -0.2)],
    growth: 'fungus', growthSize: 0.08 * s, nodeSize: 0.02 * s, plateSize: 0.12 * s,
    extra: (bb) => bb.both((side, n) => {
      // Stage 3: a pair of spinnerets behind, trailing cable-thick silk.
      bb.part({ id: `spinneret${n}`, type: 'cord', bone: body, at: S(side * 0.08, 0.3, -0.45), dir: V(side * 0.2, -0.3, -1), size: 0.6 * s, material: 'bone', stage: 3 });
    }),
  });
  return b.plan;
}

const _e = new THREE.Euler();

/** Pod lobes breathing and lifting, shears gaping and scissoring, pressing flat to cut. */
export function cablecrawlerMotion(c: Creature) {
  const rig = c.rig;
  const bone = (n: string) => rig.bones.find((b) => b.name === n)!;
  const pods = [bone('podL'), bone('podR')], mands = [bone('mandL'), bone('mandR')];
  const s = c.plan.radius / 0.85;
  let t = Math.random() * 10, gape = 0, lift = 0, cut = 0;
  return {
    update(dt: number): void {
      const d = c.drive;
      t += dt;
      const alive = c.alive;
      gape = damp(gape, alive ? d.windup : 0.4, 12, dt);
      cut = damp(cut, alive ? d.action : 0, 10, dt);
      lift = damp(lift, alive ? Math.max(d.windup * 0.6, d.excite * 0.15) : 0.5, 6, dt);
      const breathe = Math.sin(t * 2.2) * 0.04;
      pods.forEach((p, i) => p.quaternion.setFromEuler(_e.set(-lift * 0.15, 0, (i ? -1 : 1) * (lift * 0.35 + breathe))));
      // Shears: a slow idle click, gape on the wind-up, fast scissoring while cutting.
      const snip = cut * (0.5 + 0.5 * Math.sin(t * 22)) * 0.5;
      mands.forEach((m, i) => m.quaternion.setFromEuler(_e.set(0, (i ? -1 : 1) * (0.05 + gape * 0.45 + snip + Math.max(0, Math.sin(t * 1.3)) * 0.04), 0)));
      c.sink = cut * 0.14 * s;
    },
  };
}
