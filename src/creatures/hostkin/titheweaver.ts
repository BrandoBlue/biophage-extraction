import { HIVE, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import type { BodyPlan, Palette } from '../plan';

/**
 * Tithe Weaver (docs/gdd/host-milestone.md): a floating nervous system with no skin. A knot of pale ganglia drifting
 * at head height, trailing kelp-like nerve fronds; it strings living nerve strands between rocks from two
 * spinnerets at its back. No eyes, no mouth. Sources: orb-weaver spider, jellyfish nerve net, kelp.
 * Weak point: the ganglion knot (part `knot`).
 */
export function titheWeaver(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: mix(HIVE.bone, ORGANIC.mist, 0.3, 0.85), vein: ORGANIC.vein, rim: ORGANIC.mist,
    chitin: mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.6), chitinGlow: ORGANIC.amber, bone: HIVE.bone,
    glow: mix(ORGANIC.amber, HIVE.bone, 0.3), fluid: mix(ORGANIC.mist, HIVE.bone, 0.4), membrane: ORGANIC.mist, iris: ORGANIC.amber, sclera: HIVE.bone,
  };
  const h = 1.85;
  const s = 0.9 + r() * 0.2;
  const b = new PlanBuilder('titheWeaver', seed, stage, { locomotion: 'hover', bodyHeight: h, radius: 0.9 * s, skinNoise: { amp: 0.012, freq: 18 }, skinResolution: 44, fleshScale: 14, palette: pal });
  const body = b.bone('body', -1, V(0, h, 0));
  const S = (x: number, y: number, z: number) => V(x * s, h + y * s, z * s);
  // The knot: a clench of ganglia, each lump a different size, braided together with nerve cords.
  const lumps: [number, number, number, number][] = [[0, 0, 0, 0.26], [0.2, 0.08, 0.1, 0.17], [-0.18, 0.1, 0.05, 0.19], [0.05, -0.16, 0.12, 0.15], [-0.08, 0.05, -0.2, 0.2], [0.14, -0.04, -0.16, 0.13], [-0.2, -0.12, -0.08, 0.12]];
  lumps.forEach(([x, y, z, rad], i) => b.skin({ shape: 'ellipsoid', a: S(x, y, z), radii: V(rad, rad * (0.8 + r() * 0.4), rad).multiplyScalar(s), blend: i ? 0.07 : 0, bone: body, tint: tint('#ffffff', 0.85 + r() * 0.3), ribs: i % 2 ? { freq: 30, depth: 0.006 } : undefined }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + r();
    b.skin({ shape: 'cone', a: S(0, 0, 0), b: S(Math.cos(a) * 0.38, (r() - 0.5) * 0.3, Math.sin(a) * 0.38), ra: 0.05 * s, rb: 0.025 * s, blend: 0.05, bone: body });
  }
  // A few ganglia are lit from inside; most are just wet pale tissue.
  for (let i = 0; i < 3; i++) {
    const [x, y, z, rad] = lumps[i + 1];
    const hit = b.surf(S(x * 3, y * 3, z * 3), S(-x, -y, -z).sub(V(0, h, 0)).normalize());
    b.part({ id: `ganglion${i}`, type: 'node', bone: body, at: hit.at, dir: hit.normal, size: rad * 0.35 * s, material: 'glow' });
  }
  // The weak point: the central ganglion knot, a wet sac with a warm core, on the front of the clench.
  b.part({ id: 'knot', type: 'pustule', bone: body, at: S(0, 0, 0.2), dir: V(0, 0, 1), size: 0.13 * s, material: 'membrane', dynamic: true, weak: true });
  b.part({ id: 'knotcore', type: 'node', bone: body, at: S(0, 0, 0.24), dir: V(0, 0, 1), size: 0.05 * s, material: 'glow' });
  // Spinnerets at the back: the strands come out of these.
  b.both((side, n) => b.part({ id: `spinneret${n}`, type: 'cup', bone: body, at: S(side * 0.1, -0.05, -0.3), dir: V(side * 0.3, -0.2, -1), size: 0.06 * s, material: 'chitin' }));
  // Nerve fronds: long, flat, kelp-like, hanging and trailing, each frayed with a rippling fin.
  const fronds = (count: number, stageN: number, prefix: string) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r() * 0.4;
      const rad = 0.12 + r() * 0.12;
      const len = (1.1 + r() * 1.1) * s;
      const id = `${prefix}${i}`;
      b.limb({
        id, kind: 'tendril', bone: body, mount: S(Math.cos(a) * rad, -0.12, Math.sin(a) * rad), lengths: Array(4).fill(len / 4),
        radii: [0.03, 0.022, 0.016, 0.01, 0.003].map((x) => x * s), style: 'tendril', material: 'flesh',
        rest: S(Math.cos(a) * (rad + 0.25), -0.12 - len / s, Math.sin(a) * (rad + 0.25) - 0.3), pole: V(Math.cos(a), 0, Math.sin(a)), severable: false, stage: stageN,
      });
      for (let k = 1; k < 4; k++) b.part({ id: `${id}fin${k}`, type: 'frill', bone: { limb: id, seg: k }, at: V(0, 0, 0), dir: V(1, 0, 0), fwd: V(0, 1, 0), size: (len / 4) * 0.9, p: [0.18], material: 'membrane', stage: stageN });
    }
  };
  fronds(9, 0, 'frond');
  b.hit({ bone: body, at: S(0, 0, 0), r: 0.42 * s, weak: false });
  b.hit({ bone: body, at: S(0, 0, 0.22), r: 0.17 * s, weak: true, part: 'knot' });
  mutate(b, stage, {
    dorsal: [0.2, 0.05, -0.12].map((z) => S(0, 0.8, z)), flank: [S(0.7, 0, 0.05)],
    growth: 'crystals', growthSize: 0.1 * s, nodeSize: 0.025 * s, plateSize: 0.12 * s,
    extra: () => fronds(5, 3, 'xfrond'),
  });
  return b.plan;
}
