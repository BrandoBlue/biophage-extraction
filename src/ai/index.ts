/**
 * PvE AI & Encounters. Brains for the Abominations (one archetype per kind, data/ai.json), noise and light perception,
 * attack tokens and the nest wave director. Everything here is renderer-free; src/game/abominations.ts feeds a
 * Brain each frame and maps its outputs onto Creature.drive.
 */
import { ABOMINATIONS, AI, type Archetype } from '../../data';
import type { Brain } from './brain';
import { FlyerBrain } from './behaviours/flyer';
import { SpitterBrain } from './behaviours/spitter';
import { StalkerBrain } from './behaviours/stalker';
import { SwarmBrain } from './behaviours/swarm';
import { TankBrain } from './behaviours/tank';
import { MimicBrain } from './behaviours/mimic';
import { GrazerBrain } from './behaviours/grazer';
import { WeaverBrain } from './behaviours/weaver';
import { BurrowerBrain } from './behaviours/burrower';
import { HerdBrain } from './behaviours/herd';

export { Brain, type Body } from './brain';
export { AttackTokens, tokensFor } from './tokens';
export { Awareness, sightRate, noiseGain } from './senses';
export { hostVisibility, type VisibilityInput } from './light';
export { WaveDirector, type NestSpawn, type NestState } from './nest';
export { ReliquaryBrain, type BossEvent, type BossInput, type BossState } from './reliquary';
export { WidowBrain, type WidowEvent, type WidowInput, type WidowCrater } from './widow';
export { WardenBrain, type WardenEvent, type WardenInput, type WardenRoom, type WardenSurface } from './warden';
export { PaleVigilBrain, type VigilEvent, type VigilInput } from './vigil';
export type { AIEvent, AllyView, BrainWorld, HostView, Mode, Vec2, Vec3 } from './types';
export { SwarmBrain, SpitterBrain, StalkerBrain, FlyerBrain, TankBrain, MimicBrain, GrazerBrain, WeaverBrain, BurrowerBrain, HerdBrain };
export { WebField, segDist, type Strand } from './web';

const BRAINS: Record<Archetype, new (...a: ConstructorParameters<typeof SwarmBrain>) => Brain> = {
  swarm: SwarmBrain, spitter: SpitterBrain, stalker: StalkerBrain, flyer: FlyerBrain, tank: TankBrain,
  mimic: MimicBrain, grazer: GrazerBrain, weaver: WeaverBrain, burrower: BurrowerBrain, herd: HerdBrain,
};

export function archetypeOf(kind: string): Archetype { return AI.archetypes[kind] ?? 'swarm'; }

/** Builds the brain for an Abomination kind at (x, z). `radius` is the body's footprint for separation. */
export function createBrain(kind: string, id: number, x: number, z: number, seed: number, radius = 0.8): Brain {
  const data = ABOMINATIONS[kind];
  if (!data) throw new Error(`no Abomination data for ${kind}`);
  return new BRAINS[archetypeOf(kind)](id, kind, data, x, z, seed, radius);
}
