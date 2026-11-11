import * as THREE from 'three';
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../render/palette';
import { rng, type Rand } from './parts';
import type { BodyPlan, Palette, SpeciesId } from './plan';

/**
 * Species generators: seed + mutation stage → body plan. Each mixes at least two unrelated biology sources
 * (Art Bible creature rule 4) and follows the GDD briefs in docs/gdd/04-abominations.md and larva-milestone.md.
 *
 * Determinism contract for mutation diffing: the base body draws only from `rng(seed)`; each stage k draws
 * only from its own stream, so stage N's plan contains stage N-1's plan unchanged plus new ids.
 */

import { titheWeaver } from './hostkin/titheweaver';
import { huskMimic } from './hostkin/huskmimic';
import { lumenGrazer } from './hostkin/lumengrazer';
import { PlanBuilder, V, col, dim, mix, mutate, tint } from './builder';
import { ZONE_SPECIES } from './zones';

// ======================================================================= Needlemaw: lamprey × harvestman × comb jelly
export function needlemaw(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: mix(ZONE7_SHADE.flesh, HIVE.bone, 0.12), vein: dim(ZONE7.magenta, 0.3), rim: dim(ZONE7.cyan, 0.6),
    chitin: mix(ZONE7.violet, ZONE7.void, 0.75, 0.9), chitinGlow: ZONE7.cyan, bone: HIVE.bone,
    glow: ZONE7.magenta, fluid: ZONE7.cyan, membrane: ZONE7.cyan, iris: ZONE7.lime, sclera: HIVE.bone,
  };
  const s = 0.92 + r() * 0.16;
  const h = 0.62 * s;
  const b = new PlanBuilder('needlemaw', seed, stage, { locomotion: 'walker', bodyHeight: h, radius: 0.7 * s, skinNoise: { amp: 0.006, freq: 22 }, skinResolution: 46, fleshScale: 9, palette: pal });
  const body = b.bone('body', -1, V(0, h, 0));
  const head = b.bone('head', body, V(0, h, 0.3 * s));
  const bell = b.bone('bell', body, V(0, h + 0.05, -0.3 * s));
  const raw = tint(ZONE7.magenta, 0.9).lerp(col('#ffffff'), 0.2);
  const dark = tint('#ffffff', 0.7);
  const S = (x: number, y: number, z: number) => V(x * s, h + y * s, z * s);
  // Core and lamprey head: a ribbed muscular funnel that flares into a radial sucker mouth.
  b.skin({ shape: 'ellipsoid', a: S(0, 0, 0), radii: V(0.25, 0.2, 0.33).multiplyScalar(s), bone: body, tint: dark });
  b.skin({ shape: 'cone', a: S(0, 0, 0.12), b: S(0, -0.03, 0.46), ra: 0.16 * s, rb: 0.2 * s, blend: 0.12, bone: head, ribs: { freq: 16 / s, depth: 0.012 } });
  b.skin({ shape: 'ellipsoid', a: S(0, -0.03, 0.5), radii: V(0.23, 0.22, 0.07).multiplyScalar(s), blend: 0.06, bone: head, tint: raw });
  b.skin({ shape: 'cone', a: S(0, -0.03, 0.62), b: S(0, -0.03, 0.36), ra: 0.165 * s, rb: 0.05 * s, subtract: true, blend: 0.04, bone: head });
  // Abdomen stalk carrying the comb-jelly bell.
  b.skin({ shape: 'cone', a: S(0, 0.02, -0.08), b: S(0, 0.07, -0.32), ra: 0.17 * s, rb: 0.11 * s, blend: 0.1, bone: bell, ribs: { freq: 14 / s, depth: 0.01 } });
  b.part({ id: 'bell', type: 'membraneDome', bone: bell, at: S(0, 0.07, -0.3), dir: V(0, 0.25, -1), size: 0.3 * s, p: [0.62, 1.05], material: 'glass', dynamic: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const at = S(Math.cos(a) * 0.3, 0.07 + Math.sin(a) * 0.3, -0.55);
    b.part({ id: `comb${i}`, type: 'node', bone: bell, at, dir: V(Math.cos(a), Math.sin(a), -0.6), size: 0.028 * s, material: 'glow' });
  }
  // Glassy needle teeth, two rings deep in the sucker.
  b.part({ id: 'teeth0', type: 'needleRing', bone: head, at: S(0, -0.03, 0.5), dir: V(0, 0, 1), fwd: V(0, 1, 0), size: 0.17 * s, p: [14, 1.1, 0.75], material: 'glass' });
  b.part({ id: 'teeth1', type: 'needleRing', bone: head, at: S(0, -0.03, 0.43), dir: V(0, 0, 1), fwd: V(0, 1, 0), size: 0.1 * s, p: [10, 1.2, 0.9], material: 'bone' });
  b.part({ id: 'maw', type: 'node', bone: head, at: S(0, -0.03, 0.36), dir: V(0, 0, 1), size: 0.07 * s, material: 'glow' });
  // Something wrong: three small eyes deep inside the sucker, looking out through the teeth.
  [[-0.05, 0.02], [0.055, 0.0], [0.0, -0.07]].forEach(([x, y], i) => b.part({ id: `mawEye${i}`, type: 'eye', bone: head, at: S(x, -0.03 + y, 0.38), dir: V(x * 2, y * 2, 1), size: 0.026 * s, material: 'eye', dynamic: true }));
  // Throat sac: the weak point, flares on wind-up.
  b.part({ id: 'throat', type: 'pustule', bone: head, at: S(0, -0.13, 0.33), dir: V(0, -1, 0.3), size: 0.11 * s, material: 'glow', dynamic: true, weak: true });
  // A cluster of small eyes crowding the top of the head.
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.07, z = 0.38 + Math.abs(i - 2) * -0.04;
    const hit = b.surf(S(x, 0.4, z), V(0, -1, 0.15));
    b.part({ id: `eye${i}`, type: 'eye', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.012), dir: hit.normal.clone().add(V(0, 0, 0.6)), size: (0.028 + (i === 2 ? 0.012 : 0)) * s, material: 'eye', dynamic: true });
  }
  // Bone spurs down the spine.
  for (let i = 0; i < 4; i++) {
    const hit = b.surf(S(0, 0.4, 0.2 - i * 0.13), V(0, -1, 0));
    b.part({ id: `spur${i}`, type: 'spike', bone: hit.bone, at: hit.at, dir: hit.normal.clone().add(V(0, 0, -0.9)), fwd: V(0, 1, 0), size: (0.16 + r() * 0.08) * s, p: [0.13, 0.4], material: 'bone' });
  }
  // Six harvestman legs: knees high above the body, needle feet far out. Tripod gait.
  [0.16, 0.0, -0.16].forEach((mz, row) => b.both((side, n) => {
    const reach = (0.95 + r() * 0.08) * s;
    const fz = [0.75, 0.05, -0.7][row] * s;
    b.limb({
      id: `leg${n}${row}`, kind: 'leg', bone: body, mount: S(side * 0.16, 0.02, mz),
      lengths: [0.72 * s, 0.86 * s, 0.26 * s], radii: [0.045, 0.03, 0.017, 0.004].map((x) => x * s), style: 'needle',
      rest: V(side * reach, 0, fz), pole: V(side * 0.5, 1, 0), gait: ((row + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
    });
    b.hit({ bone: { limb: `leg${n}${row}`, seg: 1 }, at: V(0, 0.05, 0), r: 0.1 * s, weak: false, part: `leg${n}${row}` });
  }));
  b.hit({ bone: body, at: S(0, 0, 0), r: 0.36 * s, weak: false });
  b.hit({ bone: head, at: S(0, -0.02, 0.42), r: 0.25 * s, weak: false });
  b.hit({ bone: bell, at: S(0, 0.07, -0.4), r: 0.33 * s, weak: false });
  b.hit({ bone: head, at: S(0, -0.13, 0.35), r: 0.14 * s, weak: true, part: 'throat' });
  mutate(b, stage, {
    dorsal: [0.3, 0.12, -0.05, -0.2].map((z) => S(0, 0.5, z)), flank: [S(0.4, 0, 0.05), S(0.4, 0, 0.3)],
    growth: 'crystals', growthSize: 0.16 * s, nodeSize: 0.03 * s, plateSize: 0.14 * s,
    extra: (bb) => bb.both((side, n) => {
      bb.limb({ id: `claw${n}`, kind: 'arm', bone: head, mount: S(side * 0.17, -0.08, 0.4), lengths: [0.3 * s, 0.32 * s, 0.22 * s], radii: [0.03, 0.026, 0.02, 0.004].map((x) => x * s), style: 'mantis', material: 'bone', rest: V(side * 0.24 * s, h - 0.18 * s, 0.75 * s), pole: V(side * 0.4, 1, 0.3), stage: 3 });
    }),
  });
  return b.plan;
}

// ======================================================================= Bile Cantor: siphonophore × bullfrog vocal sac × pitcher plant
export function bilecantor(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: mix(ZONE7.magenta, HIVE.danger, 0.3, 0.45), vein: dim(ZONE7.lime, 0.35), rim: dim(ZONE7.violet, 0.6),
    chitin: mix(ZONE7.violet, ZONE7.void, 0.7), chitinGlow: ZONE7.lime, bone: HIVE.bone,
    glow: ZONE7.lime, fluid: mix(ZONE7.violet, ZONE7.magenta, 0.2), membrane: ZONE7.violet, iris: ZONE7.lime, sclera: HIVE.bone,
  };
  const h = 4.5;
  const b = new PlanBuilder('bilecantor', seed, stage, { locomotion: 'hover', bodyHeight: h, radius: 1.5, skinNoise: { amp: 0.02, freq: 6 }, skinResolution: 48, fleshScale: 5, palette: pal });
  const body = b.bone('body', -1, V(0, h, 0));
  const throat = b.bone('throat', body, V(0, h - 1.15, 0));
  // Inner organ mass visible through the bladder, and the throat stalk.
  b.skin({ shape: 'ellipsoid', a: V(0, h + 0.1, 0), radii: V(0.65, 0.55, 0.65), bone: body, tint: tint('#ffffff', 1.3) });
  b.skin({ shape: 'cone', a: V(0, h - 0.45, 0), b: V(0, h - 1.1, 0), ra: 0.42, rb: 0.3, blend: 0.2, bone: throat, ribs: { freq: 5, depth: 0.02 } });
  // Bullfrog vocal sacs: each on its own bone so it can swell as it sings.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const at = V(Math.cos(a) * 0.36, h - 1.25, Math.sin(a) * 0.36);
    const sb = b.bone(`sac${i}`, throat, at);
    b.skin({ shape: 'ellipsoid', a: at, radii: V(0.22, 0.28, 0.22), blend: 0.12, bone: sb, tint: tint(ZONE7.magenta, 0.6).lerp(col('#ffffff'), 0.5) });
  }
  b.skin({ shape: 'ellipsoid', a: V(0, h - 1.42, 0), radii: V(0.28, 0.2, 0.28), blend: 0.1, bone: throat, tint: raw(1.2) });
  // A ring of lidless eyes around the throat stalk, watching every direction (360° sight in the GDD).
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const hit = b.surf(V(Math.cos(a) * 1.2, h - 0.75, Math.sin(a) * 1.2), V(-Math.cos(a), -0.15, -Math.sin(a)));
    b.part({ id: `eye${i}`, type: 'eye', bone: throat, at: hit.at.clone().addScaledVector(hit.normal, -0.03), dir: hit.normal.clone().add(V(0, -0.4, 0)), size: 0.075 + (i % 3) * 0.015, material: 'eye', dynamic: true });
  }
  // The translucent, veined gas bladder.
  b.part({ id: 'bladder', type: 'membraneDome', bone: body, at: V(0, h - 0.95, 0), dir: V(0, 1, 0), size: 1.5, p: [0.92, 0.82], material: 'membrane', dynamic: true });
  // Three song pustules on the flanks: the weak points.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    // Bile sacs: translucent tissue with a small glowing core, not glowing discs (Rendering, player-view pass).
    b.part({ id: `pustule${i}`, type: 'pustule', bone: body, at: V(Math.cos(a) * 1.28, h - 0.3, Math.sin(a) * 1.28), dir: V(Math.cos(a), -0.2, Math.sin(a)), size: 0.24, material: 'membrane', dynamic: true, weak: true });
    b.part({ id: `pustule${i}core`, type: 'node', bone: body, at: V(Math.cos(a) * 1.33, h - 0.3, Math.sin(a) * 1.33), dir: V(Math.cos(a), -0.2, Math.sin(a)), size: 0.07, material: 'glow' });
    b.hit({ bone: body, at: V(Math.cos(a) * 1.35, h - 0.25, Math.sin(a) * 1.35), r: 0.34, weak: true, part: `pustule${i}` });
  }
  // Pitcher-plant mouths hanging under the throat, lit from inside.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.9;
    const at = V(Math.cos(a) * 0.22, h - 1.5, Math.sin(a) * 0.22);
    const dir = V(Math.cos(a) * 0.5, -1, Math.sin(a) * 0.5);
    b.part({ id: `cup${i}`, type: 'cup', bone: throat, at, dir, size: 0.13, material: 'chitin' });
    b.part({ id: `cupglow${i}`, type: 'node', bone: throat, at: at.clone().addScaledVector(dir.clone().normalize(), 0.2), dir: dir.clone().negate(), size: 0.07, material: 'glow' });
  }
  // Siphonophore fringe: long tendrils with glowing beads, swaying on their own bones.
  const tendrils = (count: number, stageN: number, prefix: string, rr: Rand) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rr() * 0.2;
      const rad = 0.6 + rr() * 0.55;
      const len = 1.6 + rr() * 1.8;
      const segs = 4;
      const id = `${prefix}${i}`;
      b.limb({
        id, kind: 'tendril', bone: body, mount: V(Math.cos(a) * rad, h - 0.85, Math.sin(a) * rad),
        lengths: Array(segs).fill(len / segs), radii: [0.035, 0.026, 0.018, 0.011, 0.005], style: 'tendril', material: 'glass',
        rest: V(Math.cos(a) * (rad + 0.2), h - 0.85 - len, Math.sin(a) * (rad + 0.2)), pole: V(Math.cos(a), 0, Math.sin(a)), stage: stageN,
      });
      for (let k = 1; k < segs; k++) b.part({ id: `${id}bead${k}`, type: 'node', bone: { limb: id, seg: k }, at: V(0, 0, 0), dir: V(0, 1, 0), size: 0.038, material: 'glow', stage: stageN });
    }
  };
  tendrils(14, 0, 'tendril', r);
  b.hit({ bone: body, at: V(0, h, 0), r: 1.35, weak: false });
  b.hit({ bone: throat, at: V(0, h - 1.25, 0), r: 0.5, weak: false });
  mutate(b, stage, {
    dorsal: [0.7, 0.25, -0.25, -0.7].map((z) => V(z * 0.4, h + 2.5, z)), flank: [V(1.8, h - 0.6, 0.6), V(1.8, h - 0.6, -0.6)],
    growth: 'fungus', growthSize: 0.32, nodeSize: 0.08, plateSize: 0.4,
    extra: (bb, rr) => { void bb; tendrils(8, 3, 'xtendril', rr); },
  });
  return b.plan;
}

function raw(k: number): THREE.Color { return tint(ZONE7.magenta, 0.5 * k).lerp(col('#ffffff'), 0.4); }

// ======================================================================= Glasswalker: cuttlefish × glass sponge × mantis
export function glasswalker(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: mix(HIVE.bone, ZONE7.cyan, 0.3, 0.5), vein: dim(ZONE7.cyan, 0.28), rim: HIVE.bone,
    chitin: mix(HIVE.bone, ZONE7.cyan, 0.25, 0.6), chitinGlow: ZONE7.cyan, bone: mix(HIVE.bone, ZONE7.cyan, 0.1, 0.8),
    glow: ZONE7.cyan, fluid: HIVE.acid, membrane: ZONE7.cyan, iris: ZONE7.magenta, sclera: ZONE7_SHADE.rockDeep,
  };
  const s = 0.95 + r() * 0.1;
  const h = 1.9 * s;
  const b = new PlanBuilder('glasswalker', seed, stage, { locomotion: 'walker', bodyHeight: h, radius: 0.9 * s, skinNoise: { amp: 0.008, freq: 14 }, skinResolution: 56, fleshScale: 7, palette: pal });
  const S = (x: number, y: number, z: number) => V(x * s, y * s, z * s);
  const body = b.bone('thorax', -1, S(0, 1.9, 0));
  const neck = b.bone('neck', body, S(0, 2.15, 0.32));
  const head = b.bone('head', neck, S(0, 2.32, 0.62));
  const abdomen = b.bone('abdomen', body, S(0, 1.85, -0.25));
  const pale = tint('#ffffff', 1.15);
  // Mantis thorax rising to a long neck; a flat hammer head with cuttlefish lobes and a beard of feeding arms.
  b.skin({ shape: 'cone', a: S(0, 1.72, -0.15), b: S(0, 2.08, 0.3), ra: 0.27 * s, rb: 0.17 * s, bone: body, ribs: { freq: 8 / s, depth: 0.02 } });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.98, 0.08), radii: S(0.3, 0.22, 0.26), blend: 0.12, bone: body });
  b.skin({ shape: 'cone', a: S(0, 2.08, 0.3), b: S(0, 2.3, 0.62), ra: 0.11 * s, rb: 0.085 * s, blend: 0.1, bone: neck, ribs: { freq: 14 / s, depth: 0.01 } });
  b.skin({ shape: 'ellipsoid', a: S(0, 2.36, 0.76), radii: S(0.17, 0.12, 0.2), blend: 0.08, bone: head, tint: pale });
  b.both((side) => b.skin({ shape: 'ellipsoid', a: S(side * 0.2, 2.36, 0.78), radii: S(0.14, 0.06, 0.13), blend: 0.08, bone: head, tint: pale }));
  b.skin({ shape: 'cone', a: S(0, 2.43, 0.62), b: S(0, 2.52, 0.4), ra: 0.06 * s, rb: 0.02 * s, blend: 0.07, bone: head }); // crest
  b.skin({ shape: 'ellipsoid', a: S(0, 2.28, 0.9), radii: S(0.09, 0.07, 0.07), subtract: true, blend: 0.03, bone: head }); // beak socket
  // Something wrong: the left lobe of the hammer has swollen into a tumour, crowded with extra eyes.
  b.skin({ shape: 'ellipsoid', a: S(-0.3, 2.32, 0.8), radii: S(0.13, 0.11, 0.12), blend: 0.06, bone: head, tint: tint('#ffffff', 0.85) });
  // Segmented glass-sponge abdomen tapering back and down.
  b.skin({ shape: 'cone', a: S(0, 1.86, -0.12), b: S(0, 1.5, -1.05), ra: 0.29 * s, rb: 0.07 * s, blend: 0.12, bone: abdomen, ribs: { freq: 7 / s, depth: 0.03 } });
  // Feeding arms under the head (cuttlefish), always groping.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI - Math.PI / 2;
    const id = `feeler${i}`;
    b.limb({ id, kind: 'tendril', bone: head, mount: S(Math.sin(a) * 0.08, 2.27, 0.84 + Math.cos(a) * 0.04), lengths: Array(3).fill(0.12 * s * (1 + (i % 2) * 0.4)), radii: [0.022, 0.016, 0.01, 0.003].map((x) => x * s), style: 'tendril', material: 'flesh', rest: S(Math.sin(a) * 0.15, 1.9, 0.95), pole: V(0, 0, 1), severable: false });
  }
  // Eye pits: three small black lenses per side of the hammer.
  b.both((side, n) => [0, 1, 2].forEach((k) => {
    const hit = b.surf(S(side * 0.5, 2.38 + k * 0.012, 0.86 - k * 0.07), V(-side, 0, 0));
    b.part({ id: `eye${n}${k}`, type: 'eye', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.008), dir: hit.normal, size: 0.022 * s, material: 'eye', dynamic: true });
  }));
  [[0.05, 0.03], [0.02, -0.05], [-0.04, 0.0], [0.08, -0.02]].forEach(([dz, dy], k) => {
    const hit = b.surf(S(-0.6, 2.32 + dy, 0.8 + dz), V(1, 0, 0));
    b.part({ id: `tumourEye${k}`, type: 'eye', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.006), dir: hit.normal.clone().add(V(0, dy * 4, dz * 4)), size: (0.014 + k * 0.004) * s, material: 'eye', dynamic: true });
  });
  // The refraction lens: the one thing on it that does not bend light. Weak point and tell.
  b.part({ id: 'lens', type: 'lens', bone: body, at: S(0, 2.0, 0.3), dir: V(0, 0.35, 1), size: 0.085 * s, material: 'glow', dynamic: true, weak: true });
  b.part({ id: 'lensRim', type: 'lid', bone: body, at: S(0, 1.995, 0.28), dir: V(0, 0.35, 1), size: 0.085 * s, material: 'bone' });
  // Cuttlefish fin skirts rippling along the abdomen.
  b.both((side, n) => b.part({ id: `fin${n}`, type: 'frill', bone: abdomen, at: S(side * 0.13, 1.78, -0.15), dir: V(side, -0.25, 0), fwd: V(0, -0.33, -1), size: 0.85 * s, p: [0.22], material: 'membrane', dynamic: true }));
  // Chromatophore spots: tiny lights scattered over the skin.
  for (let i = 0; i < 9; i++) {
    const z = 0.3 - i * 0.14, side = i % 2 ? 1 : -1;
    const hit = b.surf(S(side * 0.4, 1.95 - i * 0.02, z), V(-side, -0.2, 0));
    b.part({ id: `chroma${i}`, type: 'node', bone: hit.bone, at: hit.at, dir: hit.normal, size: 0.022 * s, material: 'glow' });
  }
  // Glass spicule crest along the back (glass sponge).
  for (let i = 0; i < 6; i++) {
    const hit = b.surf(S(0, 2.6, 0.2 - i * 0.18), V(0, -1, 0));
    b.part({ id: `spicule${i}`, type: 'spike', bone: hit.bone, at: hit.at, dir: hit.normal.clone().add(V(0, 0, -0.5)), fwd: V(0, 1, 0), size: (0.22 - i * 0.02) * s, p: [0.06, 0.2], material: 'glass' });
  }
  // Four stilt legs, diagonal-pair gait.
  ([[0.06, 0.95, 0], [-0.22, -1.05, 1]] as const).forEach(([mz, fz, row]) => b.both((side, n) => {
    const id = `leg${n}${row}`;
    b.limb({
      id, kind: 'leg', bone: body, mount: S(side * 0.14, 1.78, mz), lengths: [1.1 * s, 1.9 * s, 0.32 * s], radii: [0.05, 0.034, 0.02, 0.005].map((x) => x * s),
      style: 'bone', material: 'chitin', rest: V(side * (1.25 + r() * 0.1) * s, 0, fz * s), pole: V(side * 0.25, 1, 0), gait: ((row + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
    });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 0.1, 0), r: 0.12 * s, weak: false, part: id });
  }));
  // Folding mantis forelimbs with sickle blades, held tucked against the chest.
  b.both((side, n) => {
    const id = `arm${n}`;
    b.limb({
      id, kind: 'arm', bone: body, mount: S(side * 0.1, 2.02, 0.25), lengths: [0.5 * s, 0.55 * s, 0.42 * s], radii: [0.045, 0.04, 0.03, 0.008].map((x) => x * s),
      style: 'mantis', material: 'chitin', rest: S(side * 0.16, 1.72, 0.48), pole: V(side * 0.15, 1, 0.6),
    });
    b.part({ id: `blade${n}`, type: 'blade', bone: { limb: id, seg: 2 }, at: V(0, 0, 0), dir: V(0, 1, 0), fwd: V(0, 0, -1), size: 0.55 * s, p: [0.2], material: 'bone' });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 0.2, 0), r: 0.11 * s, weak: false, part: id });
  });
  b.hit({ bone: body, at: S(0, 1.92, 0.05), r: 0.3 * s, weak: false });
  b.hit({ bone: abdomen, at: S(0, 1.72, -0.5), r: 0.27 * s, weak: false });
  b.hit({ bone: head, at: S(0, 2.33, 0.82), r: 0.18 * s, weak: false });
  b.hit({ bone: body, at: S(0, 2.0, 0.33), r: 0.12 * s, weak: true, part: 'lens' });
  mutate(b, stage, {
    dorsal: [0.25, 0.0, -0.3, -0.6].map((z) => S(0, 3, z)), flank: [S(0.5, 1.8, -0.2), S(0.5, 1.85, -0.5)],
    growth: 'crystals', growthSize: 0.2 * s, nodeSize: 0.035 * s, plateSize: 0.16 * s,
    extra: (bb) => bb.both((side, n) => {
      const id = `xarm${n}`;
      bb.limb({ id, kind: 'arm', bone: body, mount: S(side * 0.13, 1.88, 0.15), lengths: [0.35 * s, 0.4 * s, 0.3 * s], radii: [0.035, 0.03, 0.022, 0.006].map((x) => x * s), style: 'mantis', material: 'chitin', rest: S(side * 0.3, 1.5, 0.4), pole: V(side * 0.5, 1, 0.3), stage: 3 });
      bb.part({ id: `xblade${n}`, type: 'blade', bone: { limb: id, seg: 2 }, at: V(0, 0, 0), dir: V(0, 1, 0), fwd: V(0, 0, -1), size: 0.4 * s, p: [0.2], material: 'glass', stage: 3 });
    }),
  });
  return b.plan;
}

// ======================================================================= Oculimoth: moth × cephalopod eye × swiftlet
export function oculimoth(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: mix(ZONE7_SHADE.flesh, ZONE7.magenta, 0.15, 0.8), vein: dim(ZONE7.magenta, 0.4), rim: dim(ZONE7.lime, 0.5),
    chitin: mix(ZONE7.violet, ZONE7.void, 0.6), chitinGlow: ZONE7.magenta, bone: HIVE.bone,
    glow: ZONE7.lime, fluid: ZONE7.lime, membrane: ZONE7.magenta, iris: mix(ZONE7.lime, PATH.melee, 0.55), sclera: mix(HIVE.bone, ZONE7.magenta, 0.12),
  };
  // Big enough to read at 7 m: the eye and its wide veined wings are the silhouette (reference 04).
  const s = (0.9 + r() * 0.2) * 1.6;
  const h = 3;
  const b = new PlanBuilder('oculimoth', seed, stage, { locomotion: 'flyer', bodyHeight: h, radius: 0.3 * s, skinNoise: { amp: 0.009, freq: 26 }, skinResolution: 36, fleshScale: 18, palette: pal });
  const S = (x: number, y: number, z: number) => V(x * s, h + y * s, z * s);
  const body = b.bone('body', -1, V(0, h, 0));
  const thorax = b.bone('thorax', body, S(0, 0.02, -0.15));
  // The eye is the creature: a fleshy socket cradling it, a furry moth thorax behind.
  b.skin({ shape: 'ellipsoid', a: S(0, 0, -0.03), radii: S(0.15, 0.15, 0.13), bone: body });
  b.skin({ shape: 'ellipsoid', a: S(0, 0, 0.07), radii: S(0.12, 0.12, 0.1), subtract: true, blend: 0.03, bone: body });
  b.skin({ shape: 'cone', a: S(0, 0.02, -0.1), b: S(0, 0.0, -0.36), ra: 0.075 * s, rb: 0.03 * s, blend: 0.05, bone: thorax, ribs: { freq: 30 / s, depth: 0.006 } });
  b.part({ id: 'eye', type: 'eye', bone: body, at: S(0, 0, 0.025), dir: V(0, 0, 1), size: 0.118 * s, material: 'eye', dynamic: true, weak: true });
  // Aperture iris blades: a camera diaphragm of bone ringing the pupil (cephalopod meets machine).
  b.part({ id: 'aperture', type: 'needleRing', bone: body, at: S(0, 0, 0.095), dir: V(0, 0, 1), fwd: V(0, 1, 0), size: 0.115 * s, p: [9, 0.5, 1.6], material: 'bone' });
  b.part({ id: 'lid', type: 'eyelids', bone: body, at: S(0, 0, 0.025), dir: V(0, 0, 1), fwd: V(0, 1, 0), size: 0.118 * s, p: [0.34], material: 'flesh' });
  // Two pairs of veined moth wings.
  const wings = (pairs: [number, number, number, number][], stageN: number, prefix: string) => pairs.forEach(([mz, span, chord, sweep], k) => b.both((side, n) => {
    const id = `${prefix}${n}${k}`;
    b.limb({ id, kind: 'wing', bone: thorax, mount: S(side * 0.05, 0.05, mz), lengths: [0.04 * s], radii: [0.012 * s, 0.008 * s], style: 'tendril', material: 'chitin', rest: S(side * 1, 0.25, mz + sweep), pole: V(0, 0, 1), stage: stageN, severable: true });
    b.part({ id: `${id}m`, type: 'wing', bone: { limb: id, seg: 0 }, at: V(0, 0.02, 0), dir: V(0, 1, 0), fwd: V(0, 0, 1), size: span * s, p: [chord, k + 1], material: 'membrane', dynamic: true, stage: stageN });
  }));
  wings([[-0.12, 0.62, 0.6, 0.15], [-0.2, 0.45, 0.75, -0.55]], 0, 'wing');
  // Swiftlet saliva cords dangling from under the socket, beaded with glowing drops.
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.05;
    b.part({ id: `cord${i}`, type: 'cord', bone: body, at: S(x, -0.12, -0.02 - (i % 2) * 0.04), dir: V(0, -1, 0), size: (0.25 + r() * 0.3) * s, material: 'glass' });
  }
  // Feathery antennae.
  b.both((side, n) => b.part({ id: `antenna${n}`, type: 'spike', bone: thorax, at: S(side * 0.05, 0.11, -0.08), dir: V(side * 0.6, 1, 0.8), fwd: V(0, 0, -1), size: 0.22 * s, p: [0.04, 0.5], material: 'chitin' }));
  b.hit({ bone: body, at: S(0, 0, -0.04), r: 0.17 * s, weak: false });
  b.hit({ bone: body, at: S(0, 0, 0.07), r: 0.1 * s, weak: true, part: 'eye' });
  mutate(b, stage, {
    dorsal: [0.0, -0.12, -0.24].map((z) => S(0, 0.4, z)), flank: [S(0.3, 0, -0.05)],
    growth: 'fungus', growthSize: 0.07 * s, nodeSize: 0.014 * s, plateSize: 0.05 * s,
    extra: () => wings([[-0.28, 0.24, 0.5, -0.8]], 3, 'xwing'),
  });
  return b.plan;
}

// ======================================================================= Mournback: hermit crab × tardigrade × bison
export function mournback(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: mix(ZONE7_SHADE.stem, HIVE.bone, 0.22, 0.7), vein: dim(ZONE7.violet, 0.3), rim: dim(ZONE7.magenta, 0.4),
    chitin: mix(ZONE7_SHADE.rock, ZONE7.void, 0.4), chitinGlow: ZONE7.violet, bone: mix(HIVE.bone, ZONE7_SHADE.rock, 0.25, 0.85),
    glow: PATH.viral, fluid: ZONE7.violet, membrane: ZONE7.violet, iris: ZONE7.magenta, sclera: ZONE7_SHADE.rockDeep,
  };
  const s = 0.95 + r() * 0.1;
  const h = 1.5 * s;
  const b = new PlanBuilder('mournback', seed, stage, { locomotion: 'walker', bodyHeight: h, radius: 1.9 * s, skinNoise: { amp: 0.025, freq: 4 }, skinResolution: 56, fleshScale: 3.2, palette: pal });
  const S = (x: number, y: number, z: number) => V(x * s, y * s, z * s);
  const body = b.bone('body', -1, S(0, 1.5, 0));
  const head = b.bone('head', body, S(0, 1.3, 1.5));
  const hump = b.bone('hump', body, S(0, 2.3, -0.2));
  const rear = b.bone('rear', body, S(0, 1.45, -1.3));
  const belly = tint('#ffffff', 1.25), hide = tint('#ffffff', 0.85);
  // Tardigrade barrel: fat annular folds, a sagging belly.
  b.skin({ shape: 'cone', a: S(0, 1.55, 1.2), b: S(0, 1.55, -0.1), ra: 0.85 * s, rb: 0.98 * s, bone: body, ribs: { freq: 1.9 / s, depth: 0.07 }, tint: hide });
  b.skin({ shape: 'cone', a: S(0, 1.55, -0.1), b: S(0, 1.4, -1.55), ra: 0.98 * s, rb: 0.7 * s, blend: 0.2, bone: rear, ribs: { freq: 1.9 / s, depth: 0.07 }, tint: hide });
  b.skin({ shape: 'ellipsoid', a: S(0, 1.05, -0.1), radii: S(0.85, 0.5, 1.3), blend: 0.3, bone: body, tint: belly });
  // Bison head: a heavy low skull; tardigrade round stylet mouth instead of a muzzle.
  b.skin({ shape: 'cone', a: S(0, 1.45, 1.1), b: S(0, 0.95, 2.15), ra: 0.68 * s, rb: 0.42 * s, blend: 0.3, bone: head, ribs: { freq: 3 / s, depth: 0.03 } });
  b.skin({ shape: 'ellipsoid', a: S(0, 0.88, 2.25), radii: S(0.42, 0.38, 0.32), blend: 0.15, bone: head });
  b.skin({ shape: 'cone', a: S(0, 0.82, 2.7), b: S(0, 0.86, 2.3), ra: 0.2 * s, rb: 0.08 * s, subtract: true, blend: 0.06, bone: head });
  b.part({ id: 'stylets', type: 'needleRing', bone: head, at: S(0, 0.84, 2.48), dir: V(0, -0.1, 1), fwd: V(0, 1, 0), size: 0.2 * s, p: [12, 0.9, 0.7], material: 'bone' });
  b.part({ id: 'gullet', type: 'node', bone: head, at: S(0, 0.84, 2.35), dir: V(0, 0, 1), size: 0.1 * s, material: 'glow' });
  // Hermit-crab shell grown into the spine: a hump of fused bone.
  b.skin({ shape: 'ellipsoid', a: S(0, 2.15, -0.25), radii: S(0.9, 0.62, 1.25), blend: 0.35, bone: hump, tint: tint(HIVE.bone, 0.9) });
  // Front bone shield over the skull, and sweeping horns.
  // Something wrong: a second, smaller face pressing out through the skin of one cheek, as if from inside.
  b.skin({ shape: 'ellipsoid', a: S(0.4, 1.12, 1.9), radii: S(0.2, 0.24, 0.22), blend: 0.12, bone: head, tint: tint('#ffffff', 1.1) });
  { const hit = b.surf(S(1.2, 1.12, 1.92), V(-1, 0, 0));
    b.part({ id: 'cheekFace', type: 'skull', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.09), dir: hit.normal.clone().add(V(0, 0.3, 0.5)), fwd: V(0.2, 0.1, 1), size: 0.3 * s, p: [2], material: 'bone' }); }
  b.part({ id: 'shield', type: 'plate', bone: head, at: S(0, 1.55, 1.55), dir: V(0, 0.75, 1), fwd: V(0, 1, -0.3), size: 0.95 * s, p: [0.95, 0.85, 0.4, 0.5], material: 'bone' });
  b.both((side, n) => b.part({ id: `horn${n}`, type: 'horn', bone: head, at: S(side * 0.55, 1.42, 1.7), dir: V(side, 0.25, 0.25), fwd: V(0, 0.6, 1), size: 1.5 * s, p: [0.16, 1.2], material: 'bone' }));
  // Shoulder spurs: the shell's growth breaking through the hide.
  b.both((side, n) => [0.55, 0.15, -0.3].forEach((z, i) => {
    const hit = b.surf(S(side * 1.8, 2.0 - i * 0.1, z), V(-side, -0.25, 0));
    b.part({ id: `spur${n}${i}`, type: 'spike', bone: hit.bone, at: hit.at, dir: hit.normal.clone().add(V(0, 0.8, -0.4)), fwd: V(0, 0, -1), size: (0.55 - i * 0.1) * s, p: [0.16, 0.45], material: 'bone' });
  }));
  // Small sunken eyes under the shield.
  b.both((side, n) => {
    const hit = b.surf(S(side * 0.9, 1.15, 2.0), V(-side, 0, -0.15));
    b.part({ id: `eye${n}`, type: 'eye', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.02), dir: hit.normal.clone().add(V(0, 0, 0.5)), size: 0.065 * s, material: 'eye', dynamic: true });
  });
  // Plates and trophy skulls fused over the hump.
  const humpPts: [number, number][] = [[0, 0.6], [-0.55, 0.25], [0.55, 0.2], [0, -0.1], [-0.5, -0.55], [0.5, -0.6], [0, -0.95], [-0.3, 0.95], [0.3, 0.9]];
  humpPts.forEach(([x, z], i) => {
    const hit = b.surf(S(x, 3.6, z - 0.25), V(-x * 0.3, -1, 0));
    b.part({ id: `hplate${i}`, type: 'plate', bone: hump, at: hit.at.clone().addScaledVector(hit.normal, 0.02), dir: hit.normal.clone().add(V(0, 0, -0.35)), fwd: V(0, 0, 1), size: (0.5 + r() * 0.18) * s, p: [1, 1.25, 0.5, 0.5], material: 'bone' });
  });
  [[-0.75, 0.1], [0.78, -0.35], [-0.2, 0.75], [0.35, 0.55], [-0.65, -0.75]].forEach(([x, z], i) => {
    const hit = b.surf(S(x * 2.2, 2.45, z - 0.25), V(-x, -0.3, 0));
    b.part({ id: `skull${i}`, type: 'skull', bone: hump, at: hit.at.clone().addScaledVector(hit.normal, -0.12), dir: hit.normal.clone().add(V(0, 0.5, 0)), fwd: V(x, 0.2, 1), size: (0.42 + r() * 0.14) * s, p: [i], material: 'bone' });
  });
  // Dorsal vent cluster: the weak point. Spore chimneys glowing violet, behind the hump crest.
  const ventC = S(0, 2.75, -0.95);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const hit = b.surf(ventC.clone().add(S(Math.cos(a) * 0.32, 0.8, Math.sin(a) * 0.32)), V(0, -1, 0));
    const dir = hit.normal.clone().add(V(Math.cos(a) * 0.4, 0.6, Math.sin(a) * 0.4 - 0.3));
    const vs = (0.1 + r() * 0.04) * s;
    b.part({ id: `vent${i}`, type: 'vent', bone: hump, at: hit.at.clone().addScaledVector(hit.normal, -0.05), dir, size: vs * 1.4, p: [3.2], material: 'bone' });
    b.part({ id: `ventglow${i}`, type: 'pustule', bone: hump, at: hit.at.clone().addScaledVector(dir.clone().normalize(), vs * 3.4), dir, size: vs * 0.85, material: 'glow', dynamic: true });
  }
  // Four pillar legs with tardigrade claw fans; knees forward in front, hocks back behind.
  ([[0.85, 1.0, 1, 0], [-0.95, -1.05, -1, 1]] as const).forEach(([mz, fz, knee, row]) => b.both((side, n) => {
    const id = `leg${n}${row}`;
    b.limb({
      id, kind: 'leg', bone: row === 0 ? body : rear, mount: S(side * 0.72, 1.25, mz), lengths: [0.95 * s, 0.9 * s], radii: [0.36, 0.26, 0.2].map((x) => x * s),
      style: 'pillar', material: 'flesh', rest: S(side * 1.05, 0, fz), pole: V(side * 0.2, 0.2, knee), gait: ((row + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
    });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 0.2, 0), r: 0.3 * s, weak: false, part: id });
  }));
  b.hit({ bone: body, at: S(0, 1.5, 0.3), r: 1.0 * s, weak: false });
  b.hit({ bone: rear, at: S(0, 1.45, -1.15), r: 0.85 * s, weak: false });
  b.hit({ bone: head, at: S(0, 1.15, 1.95), r: 0.6 * s, weak: false });
  b.hit({ bone: hump, at: S(0, 2.5, -0.15), r: 0.85 * s, weak: false });
  b.hit({ bone: hump, at: ventC.clone().add(S(0, 0.25, 0)), r: 0.55 * s, weak: true, part: 'vents' });
  mutate(b, stage, {
    dorsal: [0.55, 0.15, -0.3, -0.75].map((z) => S(0.0, 4, z)), flank: [S(1.6, 1.5, 0.6), S(1.6, 1.4, -0.7), S(1.6, 1.5, -0.05)],
    growth: 'fungus', growthSize: 0.4 * s, nodeSize: 0.07 * s, plateSize: 0.45 * s,
    extra: (bb) => bb.both((side, n) => {
      const id = `tusk${n}`;
      bb.limb({ id, kind: 'arm', bone: head, mount: S(side * 0.35, 0.8, 2.1), lengths: [0.45 * s, 0.4 * s, 0.35 * s], radii: [0.12, 0.1, 0.07, 0.015].map((x) => x * s), style: 'mantis', material: 'bone', rest: S(side * 0.55, 0.25, 2.75), pole: V(side, 0.5, 0.5), stage: 3 });
    }),
  });
  return b.plan;
}

export const SPECIES: Record<SpeciesId, (seed: number, stage?: number) => BodyPlan> = {
  needlemaw, bilecantor, glasswalker, oculimoth, mournback,
  titheWeaver, huskMimic, lumenGrazer,
  ...ZONE_SPECIES,
};
export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

export function planFor(species: SpeciesId, seed: number, stage = 0): BodyPlan {
  return SPECIES[species](seed, Math.max(0, Math.min(3, stage)));
}
