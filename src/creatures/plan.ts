import type * as THREE from 'three';
import type { SdfPrim } from './sdf';

/**
 * Body-plan graph: the data a species generator produces and the rig builder consumes. A creature is
 * a tree of body bones (skinned SDF flesh), limb chains hanging off them (legs, arms, wings, tendrils) and
 * parts mounted on bones or limb segments. Mutation is a change to this graph: a later stage plan keeps
 * every id of the earlier one and only adds (nodes, then growths, then new limbs and carapace), so the
 * rig can diff two plans and grow just the new pieces in.
 *
 * Body space: +Z forward, +Y up, origin on the ground under the body centre, metres.
 */

export type SpeciesId = 'needlemaw' | 'bilecantor' | 'glasswalker' | 'oculimoth' | 'mournback';
export type Locomotion = 'walker' | 'hover' | 'flyer';
export type MaterialSlot = 'flesh' | 'chitin' | 'bone' | 'glow' | 'glass' | 'eye' | 'membrane' | 'raw';

export interface BoneSpec {
  name: string;
  /** Parent bone index, -1 for the root ('body'). */
  parent: number;
  /** Rest position in body space (not parent space; the builder converts). */
  at: THREE.Vector3;
}

export interface LimbSpec {
  id: string;
  kind: 'leg' | 'arm' | 'wing' | 'tendril';
  /** Body bone the limb hangs from. */
  bone: number;
  /** Mount point in body space. */
  mount: THREE.Vector3;
  /** Segment lengths, root to tip. */
  lengths: number[];
  /** Radii at each joint, root to tip (lengths.length + 1 values). */
  radii: number[];
  style: 'needle' | 'mantis' | 'pillar' | 'tendril' | 'bone';
  material: MaterialSlot;
  /** Legs: resting foot point in body space (y = 0 is the ground). Arms: rest hand target. */
  rest: THREE.Vector3;
  /** Knee bend direction hint in body space. */
  pole: THREE.Vector3;
  /** Gait group: legs in the same group step together (tripod, diagonal pairs). */
  gait: 0 | 1;
  /** Can be shot off. */
  severable: boolean;
  /** Mutation stage it appears at. */
  stage: number;
}

export type PartType =
  | 'spike' | 'horn' | 'blade' | 'plate' | 'pustule' | 'node' | 'eye' | 'lid' | 'needleRing' | 'crystals'
  | 'fungus' | 'vent' | 'skull' | 'wing' | 'membraneDome' | 'cord' | 'lens' | 'frill' | 'sac' | 'cup';

export interface PartSpec {
  id: string;
  type: PartType;
  /** Body bone index, or a limb id with the segment index. */
  bone: number | { limb: string; seg: number };
  /** Position in body space at rest (limb parts: in segment space, +Y along the segment). */
  at: THREE.Vector3;
  /** Outward direction (part +Y) in the same space as `at`. */
  dir: THREE.Vector3;
  /** Secondary axis (part +Z) so asymmetric parts (blades, horns) face the right way. */
  fwd?: THREE.Vector3;
  size: number;
  /** Extra shape parameters, per type. */
  p?: number[];
  material: MaterialSlot;
  /** Animated or poppable: built as its own mesh (pustules, eyes, the lens, wings, bells). */
  dynamic?: boolean;
  /** A weak point: gets a weak hit sphere. */
  weak?: boolean;
  stage: number;
}

export interface HitSpec {
  /** Body bone index or limb id + segment. */
  bone: number | { limb: string; seg: number };
  at: THREE.Vector3;
  r: number;
  weak: boolean;
  /** Part id this sphere belongs to (pustules pop, limbs sever). */
  part?: string;
}

export interface Palette {
  flesh: string; vein: string; rim: string;
  chitin: string; chitinGlow: string;
  bone: string;
  glow: string;
  /** Glowing blood and gore colour. */
  fluid: string;
  membrane: string;
  iris: string; sclera: string;
}

export interface BodyPlan {
  species: SpeciesId;
  seed: number;
  /** Mutation stage 0..3: nodes, growths, limbs and carapace. */
  stage: number;
  locomotion: Locomotion;
  /** Rest height of the body bone above the ground (hover/fly: mean altitude). */
  bodyHeight: number;
  /** Visual radius used for separation and framing. */
  radius: number;
  bones: BoneSpec[];
  skin: SdfPrim[];
  skinNoise: { amp: number; freq: number };
  skinResolution: number;
  /** Detail frequency of the flesh shader per metre. */
  fleshScale: number;
  limbs: LimbSpec[];
  parts: PartSpec[];
  hits: HitSpec[];
  palette: Palette;
}

export const MAX_STAGE = 3;
