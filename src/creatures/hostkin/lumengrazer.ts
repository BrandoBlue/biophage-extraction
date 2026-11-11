import { HIVE, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import type { BodyPlan, Palette } from '../plan';

/**
 * Lumen Grazer (docs/gdd/host-milestone.md): a sky-whale the size of a building drifting 25-60 m up. A broad,
 * flat-headed filter-feeder body (whale shark) slung under a translucent float bell (siphonophore), six lantern
 * glands glowing inside it (the weak points, parts `gland0..5`), and long feeding curtains trailing down to brush
 * the treetops (comb jelly fringes). Gentle, enormous, sad. Sources: whale shark, siphonophore, comb jelly.
 * PvE AI sets `drive.altitude`; bodyHeight is only its idle height.
 */
export function lumenGrazer(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: mix(ORGANIC.mist, ORGANIC.wetFleshDeep, 0.55, 0.85), vein: mix(ORGANIC.vein, ORGANIC.mist, 0.3), rim: ORGANIC.mist,
    chitin: mix(HIVE.bone, ORGANIC.mist, 0.5, 0.7), chitinGlow: ORGANIC.amber, bone: HIVE.bone,
    glow: mix(ORGANIC.amber, HIVE.bone, 0.25), fluid: mix(ORGANIC.amber, ORGANIC.mist, 0.5), membrane: mix(ORGANIC.mist, HIVE.bone, 0.35), iris: ORGANIC.amber, sclera: HIVE.bone,
  };
  const s = 0.95 + r() * 0.1;
  const h = 32;
  const b = new PlanBuilder('lumenGrazer', seed, stage, { locomotion: 'hover', bodyHeight: h, radius: 14 * s, skinNoise: { amp: 0.25, freq: 0.6 }, skinResolution: 60, fleshScale: 0.7, palette: pal });
  const body = b.bone('body', -1, V(0, h, 0));
  const head = b.bone('head', body, V(0, h - 1, 7 * s));
  const tail = b.bone('tail', body, V(0, h - 0.5, -8 * s));
  const S = (x: number, y: number, z: number) => V(x * s, h + y * s, z * s);
  const pale = tint('#ffffff', 1.15), belly = tint('#ffffff', 1.4);
  // The filter-feeder: a long, broad body, a flat shovel head with a mouth the width of a road, a tapering tail.
  b.skin({ shape: 'ellipsoid', a: S(0, -1, 0), radii: V(4.2, 3, 8).multiplyScalar(s), bone: body });
  b.skin({ shape: 'ellipsoid', a: S(0, -1.6, 7.5), radii: V(4, 2, 3.6).multiplyScalar(s), blend: 1.5, bone: head, tint: pale });
  b.skin({ shape: 'ellipsoid', a: S(0, -2.3, 10.4), radii: V(3.1, 0.55, 1.4).multiplyScalar(s), subtract: true, blend: 0.4, bone: head }); // the mouth
  b.skin({ shape: 'ellipsoid', a: S(0, -2.6, 2), radii: V(3.6, 1.8, 6).multiplyScalar(s), blend: 1.2, bone: body, tint: belly });
  b.skin({ shape: 'cone', a: S(0, -0.8, -6), b: S(0, 0.2, -15), ra: 2.6 * s, rb: 0.5 * s, blend: 1.2, bone: tail, ribs: { freq: 0.8, depth: 0.12 } });
  // Gill slits, five each side behind the head.
  b.both((side) => { for (let i = 0; i < 5; i++) b.skin({ shape: 'ellipsoid', a: S(side * 3.9, -1.3, 4.6 - i * 0.75), radii: V(0.35, 1.6, 0.12).multiplyScalar(s), subtract: true, blend: 0.15, bone: body }); });
  // Small, far-apart eyes: something this big does not need to look at you.
  b.both((side, n) => {
    const hit = b.surf(S(side * 6, -1.4, 8.6), V(-side, 0, 0));
    b.part({ id: `eye${n}`, type: 'eye', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.08), dir: hit.normal.clone().add(V(0, 0, 0.4)), size: 0.32 * s, material: 'eye', dynamic: true });
  });
  // The float bell over its back: translucent, veined, ribbed with comb rows.
  // A chain of float bells down its back (a siphonophore colony), not one dome.
  ([[4.2, 5.2, 0.9], [-0.6, 6.4, 1.0], [-5.6, 4.6, 0.85]] as const).forEach(([z, size, tall], i) =>
    b.part({ id: `bell${i}`, type: 'membraneDome', bone: i === 2 ? tail : body, at: S(0, 0.6 - i * 0.2, z), dir: V(0, 1, i === 0 ? 0.25 : i === 2 ? -0.25 : 0), size: size * s, p: [0.5, tall], material: 'membrane', dynamic: true }));
  for (let row = 0; row < 8; row++) {
    const a = (row / 8) * Math.PI * 2;
    for (let k = 1; k < 4; k++) {
      const el = (k / 4) * Math.PI * 0.5;
      b.part({ id: `comb${row}-${k}`, type: 'node', bone: body, at: S(Math.cos(a) * Math.sin(el) * 6.4, 0.4 + Math.cos(el) * 6.4, -0.6 + Math.sin(a) * Math.sin(el) * 6.4), dir: V(Math.cos(a), 0.5, Math.sin(a)), size: 0.16 * s, material: 'raw' });
    }
  }
  // Six lantern glands hanging inside the bell: the weak points and the richest organ in the game.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, z = 3 - Math.floor(i / 2) * 3.2;
    const at = S(side * (2.6 + r() * 0.6), 2.2 + r() * 0.8, z);
    b.part({ id: `gland${i}`, type: 'pustule', bone: body, at, dir: V(side * 0.4, 1, 0), size: 0.75 * s, material: 'membrane', dynamic: true, weak: true });
    b.part({ id: `gland${i}core`, type: 'node', bone: body, at: at.clone().add(S(0, 0.15, 0).sub(V(0, h, 0))), dir: V(0, 1, 0), size: 0.32 * s, material: 'glow' });
    b.hit({ bone: body, at: at.clone(), r: 0.9 * s, weak: true, part: `gland${i}` });
  }
  // Feeding curtains: long trailing fringes from the belly, rippling fins down their length.
  const curtains = (count: number, stageN: number, prefix: string) => {
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      const z = 5 - (row / Math.max(1, count / 2 - 1)) * 10;
      const len = (13 + r() * 9) * s;
      const id = `${prefix}${i}`;
      b.limb({
        id, kind: 'tendril', bone: body, mount: S(side * (1.8 + r() * 1.2), -3.6, z), lengths: Array(5).fill(len / 5),
        radii: [0.22, 0.16, 0.12, 0.08, 0.05, 0.02].map((x) => x * s), style: 'tendril', material: 'glass',
        rest: S(side * 2.8, -3.6 - len / s, z - 3), pole: V(side, 0, 0), severable: false, stage: stageN,
      });
      for (let k = 1; k < 5; k++) b.part({ id: `${id}fin${k}`, type: 'frill', bone: { limb: id, seg: k }, at: V(0, 0, 0), dir: V(side, 0, 0), fwd: V(0, 1, 0), size: (len / 5) * 0.95, p: [0.12], material: 'membrane', stage: stageN });
    }
  };
  curtains(14, 0, 'curtain');
  b.hit({ bone: body, at: S(0, -1, 0), r: 5 * s, weak: false });
  b.hit({ bone: head, at: S(0, -1.6, 7.6), r: 3.6 * s, weak: false });
  b.hit({ bone: tail, at: S(0, -0.5, -10), r: 2.2 * s, weak: false });
  mutate(b, stage, {
    dorsal: [6, 2, -2, -6].map((z) => S(0, 12, z)), flank: [S(9, -1.5, 2), S(9, -1.5, -3)],
    growth: 'crystals', growthSize: 1.3 * s, nodeSize: 0.35 * s, plateSize: 1.6 * s,
    extra: () => curtains(6, 3, 'xcurtain'),
  });
  return b.plan;
}
