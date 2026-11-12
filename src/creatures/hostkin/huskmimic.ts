import { HIVE, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import type { BodyPlan, Palette } from '../plan';

/**
 * Husk Mimic (docs/gdd/host-milestone.md): a parasite wearing the shed husk of a dead host. From far away it is a
 * person-shaped figure in a host's silhouette; close up the husk is split down the chest, and long fingers reach
 * out of the gap around a mouth. Sources: decorator crab, cordyceps fungus, anglerfish lure.
 * The husk shape follows the seed: 0 a slim Infiltrator, 1 a winged Wraith hunch, 2 a broad Behemoth.
 * Weak point: the finger-maw (part `fingerMaw`), inside the split.
 */
export function huskMimic(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const kind = seed % 3;
  const pal: Palette = {
    flesh: mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.5, 0.8), vein: ORGANIC.vein, rim: ORGANIC.mist,
    chitin: mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.35), chitinGlow: ORGANIC.amber, bone: HIVE.bone,
    glow: ORGANIC.amber, fluid: ORGANIC.vein, membrane: mix(HIVE.bone, ORGANIC.mist, 0.4), iris: ORGANIC.amber, sclera: HIVE.bone,
  };
  const s = [0.95, 1.0, 1.12][kind] * (0.97 + r() * 0.06);
  const wide = [0.85, 0.95, 1.3][kind];
  const hip = 0.95 * s;
  const b = new PlanBuilder('huskMimic', seed, stage, { locomotion: 'walker', bodyHeight: hip, radius: 0.45 * s * wide, skinNoise: { amp: 0.008, freq: 16 }, skinResolution: 50, fleshScale: 11, palette: pal });
  const body = b.bone('body', -1, V(0, hip, 0));
  const chest = b.bone('chest', body, V(0, hip + 0.45 * s, 0));
  const head = b.bone('head', chest, V(0, hip + 0.78 * s, 0.03 * s));
  const S = (x: number, y: number, z: number) => V(x * s, hip + y * s, z * s);
  const dry = tint('#ffffff', 0.8);
  // The husk: pelvis, a hollow ribcage, shoulders, a slumped neck and a head with nothing behind the face.
  b.skin({ shape: 'ellipsoid', a: S(0, 0.02, 0), radii: V(0.17 * wide, 0.13, 0.12).multiplyScalar(s), bone: body, tint: dry });
  b.skin({ shape: 'cone', a: S(0, 0.08, 0), b: S(0, 0.5, 0.02), ra: 0.13 * s * wide, rb: 0.2 * s * wide, blend: 0.1, bone: chest, ribs: { freq: 14, depth: 0.012 } });
  b.skin({ shape: 'ellipsoid', a: S(0, 0.5, 0.0), radii: V(0.25 * wide, 0.1, 0.13).multiplyScalar(s), blend: 0.08, bone: chest, tint: dry });
  b.skin({ shape: 'cone', a: S(0, 0.56, 0.0), b: S(0, 0.72, 0.06), ra: 0.06 * s, rb: 0.05 * s, blend: 0.05, bone: head });
  // The head hangs a little forward and to one side: it is being worn, not held.
  b.skin({ shape: 'ellipsoid', a: S(0.02, 0.8, 0.07), radii: V(0.09, 0.115, 0.1).multiplyScalar(s), blend: 0.04, bone: head, tint: dry });
  if (kind === 1) b.skin({ shape: 'ellipsoid', a: S(0, 0.48, -0.14), radii: V(0.2, 0.16, 0.1).multiplyScalar(s), blend: 0.08, bone: chest }); // the Wraith's hunch
  if (kind === 2) b.both((side) => b.skin({ shape: 'ellipsoid', a: S(side * 0.26, 0.52, -0.02), radii: V(0.13, 0.11, 0.13).multiplyScalar(s), blend: 0.07, bone: chest, tint: dry })); // the Behemoth's shoulder mass
  // The split: a wet slit from collarbone to belly, held open by the fingers inside.
  b.skin({ shape: 'cone', a: S(0, 0.48, 0.15), b: S(0, 0.06, 0.13), ra: 0.035 * s, rb: 0.02 * s, subtract: true, blend: 0.03, bone: chest });
  b.skin({ shape: 'ellipsoid', a: S(0, 0.28, 0.06), radii: V(0.06, 0.18, 0.05).multiplyScalar(s), blend: 0.04, bone: chest, tint: tint(ORGANIC.vein, 1.6) });
  // Long fingers from both lips of the split, curled outward like a hand turned inside out.
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const y = 0.1 + (Math.floor(i / 2) / 4) * 0.36;
    b.part({ id: `finger${i}`, type: 'spike', bone: chest, at: S(side * 0.03, y, 0.13), dir: V(side * 0.6, (r() - 0.5) * 0.4, 1), fwd: V(-side, 0, 0), size: (0.16 + r() * 0.1) * s, p: [0.08, -0.5], material: 'bone' });
  }
  b.part({ id: 'fingerMaw', type: 'pustule', bone: chest, at: S(0, 0.28, 0.1), dir: V(0, 0, 1), size: 0.06 * s, material: 'raw', dynamic: true, weak: true });
  b.part({ id: 'lure', type: 'node', bone: chest, at: S(0, 0.32, 0.1), dir: V(0, 0, 1), size: 0.02 * s, material: 'glow' });
  // Cordyceps: thin fungal stalks pushing out of the shoulders and the back of the skull.
  for (let i = 0; i < 5; i++) {
    const hit = b.surf(S((r() - 0.5) * 0.4, 1.2, -0.05 - r() * 0.05), V(0, -1, 0));
    b.part({ id: `stalk${i}`, type: 'cord', bone: hit.bone === 0 ? chest : hit.bone, at: hit.at, dir: hit.normal.clone().add(V(0, 0.8, -0.3)), size: (0.12 + r() * 0.16) * s, material: 'chitin' });
  }
  if (kind === 1) b.both((side, n) => b.part({ id: `husk-wing${n}`, type: 'wing', bone: chest, at: S(side * 0.12, 0.5, -0.16), dir: V(side, 0.4, -0.5), fwd: V(0, 0, -1), size: 0.55 * s, p: [0.4, 0.6], material: 'membrane' }));
  // Two legs (bent the wrong way just enough to notice) and two slack arms.
  b.both((side, n) => {
    const id = `leg${n}`;
    b.limb({ id, kind: 'leg', bone: body, mount: S(side * 0.1 * wide, -0.03, 0), lengths: [0.48 * s, 0.47 * s], radii: [0.065, 0.05, 0.035].map((x) => x * s * wide), style: 'bone', material: 'flesh', rest: V(side * 0.14 * s * wide, 0, 0.02), pole: V(0, 0, -1), gait: side > 0 ? 1 : 0 });
    b.hit({ bone: { limb: id, seg: 0 }, at: V(0, 0.24 * s, 0), r: 0.08 * s * wide, weak: false, part: id });
    const arm = `arm${n}`;
    b.limb({ id: arm, kind: 'arm', bone: chest, mount: S(side * 0.24 * wide, 0.48, 0), lengths: [0.3 * s, 0.32 * s, 0.12 * s], radii: [0.05, 0.04, 0.03, 0.01].map((x) => x * s * wide), style: 'bone', material: 'flesh', rest: S(side * 0.3 * wide, -0.15, 0.08), pole: V(side * 0.2, 0, -1) });
    b.hit({ bone: { limb: arm, seg: 1 }, at: V(0, 0.15 * s, 0), r: 0.07 * s, weak: false, part: arm });
  });
  b.hit({ bone: chest, at: S(0, 0.3, 0), r: 0.24 * s * wide, weak: false });
  b.hit({ bone: head, at: S(0, 0.8, 0.07), r: 0.12 * s, weak: false });
  b.hit({ bone: chest, at: S(0, 0.28, 0.12), r: 0.1 * s, weak: true, part: 'fingerMaw' });
  mutate(b, stage, {
    dorsal: [0.1, -0.02].map((z) => S(0, 1.3, z - 0.08)), flank: [S(0.6, 0.35, 0)],
    growth: 'fungus', growthSize: 0.1 * s, nodeSize: 0.025 * s, plateSize: 0.12 * s,
    extra: (bb) => bb.both((side, n) => bb.limb({ id: `xarm${n}`, kind: 'arm', bone: chest, mount: S(side * 0.05, 0.2, 0.12), lengths: [0.25 * s, 0.28 * s, 0.14 * s], radii: [0.03, 0.025, 0.018, 0.004].map((x) => x * s), style: 'mantis', material: 'bone', rest: S(side * 0.2, 0.1, 0.5), pole: V(side * 0.4, 1, 0.3), stage: 3 })),
  });
  return b.plan;
}
