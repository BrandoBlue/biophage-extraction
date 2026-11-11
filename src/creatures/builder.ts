import * as THREE from 'three';
import { HIVE, ORGANIC } from '../render/palette';
import { traceSkin, type SdfPrim } from './sdf';
import { rng, type Rand } from './parts';
import type { BodyPlan, HitSpec, LimbSpec, Palette, PartSpec, SpeciesId } from './plan';

/**
 * Shared kit for species generators (src/creatures/species.ts and any species file beside it): the plan builder,
 * the shared mutation ladder and colour helpers. A new species lives in its own file, imports from here, and is
 * registered in SPECIES (species.ts) and SpeciesId (plan.ts).
 */

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const hex = (c: THREE.Color) => `#${c.getHexString()}`;
export const col = (h: string) => new THREE.Color(h);
export const mix = (a: string, b: string, t: number, k = 1) => hex(col(a).lerp(col(b), t).multiplyScalar(k));
export const tint = (h: string, k = 1) => col(h).multiplyScalar(k);
/** Vein and rim glow colours are dimmed: flesh should read wet and grounded, the nodes carry the light. */
export const dim = (h: string, k: number) => hex(col(h).multiplyScalar(k));

/**
 * Brandon (2026-11-11): "not neon... more realistic or easier to look at... weirder, cool texture". Every species
 * palette is pulled toward lit, natural ORGANIC tones: wet meat, stained bone, dull amber bioluminescence. The
 * species hue survives as a tint, so they stay told apart, but nothing reads as a neon sign. Eyes keep the most
 * colour: they are the weak points and the thing you should be afraid of.
 */
export function naturalise(p: Palette): Palette {
  const boneDark = mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.55);
  return {
    ...p,
    flesh: mix(p.flesh, ORGANIC.wetFlesh, 0.85, 0.85),
    vein: mix(p.vein, ORGANIC.vein, 0.75),
    rim: mix(p.rim, ORGANIC.mist, 0.85, 0.75),
    chitin: mix(p.chitin, boneDark, 0.92, 0.75),
    chitinGlow: mix(p.chitinGlow, ORGANIC.amber, 0.85, 0.5),
    bone: mix(p.bone, boneDark, 0.3),
    glow: mix(p.glow, ORGANIC.amber, 0.8, 0.75),
    fluid: mix(p.fluid, ORGANIC.vein, 0.7),
    membrane: mix(p.membrane, ORGANIC.mist, 0.85, 0.8),
    iris: mix(p.iris, ORGANIC.amber, 0.35),
  };
}

export class PlanBuilder {
  plan: BodyPlan;
  constructor(species: SpeciesId, seed: number, stage: number, init: Omit<BodyPlan, 'species' | 'seed' | 'stage' | 'bones' | 'skin' | 'limbs' | 'parts' | 'hits'>) {
    this.plan = { species, seed, stage, bones: [], skin: [], limbs: [], parts: [], hits: [], ...init, palette: naturalise(init.palette) };
  }
  bone(name: string, parent: number, at: THREE.Vector3): number { this.plan.bones.push({ name, parent, at }); return this.plan.bones.length - 1; }
  skin(p: SdfPrim): void { this.plan.skin.push(p); }
  limb(l: Omit<LimbSpec, 'stage' | 'severable' | 'material' | 'gait'> & Partial<LimbSpec>): LimbSpec {
    const spec: LimbSpec = { stage: 0, severable: true, material: 'chitin', gait: 0, ...l };
    this.plan.limbs.push(spec);
    return spec;
  }
  part(p: Omit<PartSpec, 'stage'> & { stage?: number }): void { this.plan.parts.push({ stage: 0, ...p }); }
  hit(h: HitSpec): void { this.plan.hits.push(h); }
  /** A point on the skin hit by a ray, or the ray origin when it misses. */
  surf(from: THREE.Vector3, dir: THREE.Vector3): { at: THREE.Vector3; normal: THREE.Vector3; bone: number } {
    return traceSkin(this.plan.skin, from, dir) ?? { at: from.clone(), normal: dir.clone().negate(), bone: 0 };
  }
  /** Mirror a callback for the left (-1) and right (+1) sides. */
  both(fn: (side: 1 | -1, name: string) => void): void { fn(-1, 'L'); fn(1, 'R'); }
}

/** Shared mutation ladder (Art Bible creature rule 3): nodes, then growths, then carapace and limbs. */
export function mutate(b: PlanBuilder, stage: number, opts: {
  /** Ray origins above the dorsal line, front to back. */
  dorsal: THREE.Vector3[];
  /** Flank ray origins (x > 0; mirrored). */
  flank: THREE.Vector3[];
  growth: 'crystals' | 'fungus';
  growthSize: number;
  nodeSize: number;
  plateSize: number;
  /** Species-specific stage 3 extras (new limbs). */
  extra?: (b: PlanBuilder, r: Rand) => void;
}): void {
  const seed = b.plan.seed;
  if (stage >= 1) {
    // Stage 1: glowing nodes erupt along the spine and flanks.
    const r = rng(seed * 31 + 1);
    const pts = [...opts.dorsal.map((p) => ({ p, d: V(0, -1, 0) })), ...opts.flank.flatMap((p) => [{ p, d: V(-1, -0.3, 0) }, { p: V(-p.x, p.y, p.z), d: V(1, -0.3, 0) }])];
    pts.forEach(({ p, d }, i) => {
      const s = b.surf(p.clone().add(V((r() - 0.5) * 0.1 * opts.nodeSize * 10, 0, (r() - 0.5) * 0.1 * opts.nodeSize * 10)), d);
      b.part({ id: `m1-node${i}`, type: 'node', bone: s.bone, at: s.at, dir: s.normal, size: opts.nodeSize * (0.7 + r() * 0.6), material: i % 3 === 0 ? 'glow' : 'raw', stage: 1 }); // mostly wet tumour clusters, a few lit
    });
  }
  if (stage >= 2) {
    // Stage 2: crystal or fungal growths split the armour along the back.
    const r = rng(seed * 31 + 2);
    opts.dorsal.forEach((p, i) => {
      if (i % 2 === 1) return;
      const s = b.surf(p.clone().add(V((r() - 0.5) * 0.2, 0, 0)), V(0, -1, 0));
      b.part({ id: `m2-growth${i}`, type: opts.growth, bone: s.bone, at: s.at, dir: s.normal.clone().lerp(V(0, 1, 0), 0.4), size: opts.growthSize * (0.7 + r() * 0.6), p: [4 + Math.floor(r() * 3)], material: opts.growth === 'crystals' ? 'glass' : 'glow', stage: 2 });
    });
  }
  if (stage >= 3) {
    // Stage 3: a new carapace of overlapping plates, barbed, plus species limbs.
    const r = rng(seed * 31 + 3);
    opts.dorsal.forEach((p, i) => {
      const s = b.surf(p, V(0, -1, 0));
      b.part({ id: `m3-plate${i}`, type: 'plate', bone: s.bone, at: s.at.clone().addScaledVector(s.normal, -opts.plateSize * 0.1), dir: s.normal, fwd: V(0, 0, 1), size: opts.plateSize, p: [1, 1.3, 0.35, 0.4], material: 'bone', stage: 3 });
      b.part({ id: `m3-barb${i}`, type: 'spike', bone: s.bone, at: s.at.clone().addScaledVector(s.normal, opts.plateSize * 0.15), dir: s.normal.clone().add(V(0, 0, -0.6)), fwd: V(0, 1, 0), size: opts.plateSize * (0.9 + r() * 0.5), p: [0.1, 0.35], material: 'bone', stage: 3 });
    });
    opts.extra?.(b, r);
  }
}
