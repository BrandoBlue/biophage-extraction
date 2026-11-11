import type { BodyPlan, ZoneSpeciesId, SpeciesId } from '../plan';
import type { Creature } from '../creature';
import { dunewake, dunewakeMotion } from './dunewake';
import { bristleback, bristlebackMotion } from './bristleback';
import { shroudling, shroudlingMotion } from './shroudling';

/**
 * New-zone creatures (Creature & Mutation, second team): the species Design wrote for the Ochre Reach, the Marrow
 * Pit and the Weeping Fen (docs/gdd/10-new-zones.md, briefs in data/abominations.json). Each lives in its own file
 * with its body plan and its motion: the extra animation the shared walker/hover/flyer code does not cover
 * (swimming in sand, quill racks, a neck that slides out of a stolen skin). Creature calls the motion every frame.
 */

export interface SpeciesMotion { update(dt: number): void }

export const ZONE_SPECIES: Record<ZoneSpeciesId, (seed: number, stage?: number) => BodyPlan> = {
  dunewake,
  bristleback,
  shroudling,
};

export const ZONE_MOTIONS: Partial<Record<SpeciesId, (c: Creature) => SpeciesMotion>> = {
  dunewake: dunewakeMotion,
  bristleback: bristlebackMotion,
  shroudling: shroudlingMotion,
};
