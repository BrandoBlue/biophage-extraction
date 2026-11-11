/**
 * Typed access to every balance table. Owned by Game Design.
 * Import from here instead of the raw JSON so a renamed key fails the type-check.
 */
import classesJson from './classes.json';
import hostJson from './host.json';
import weaponsJson from './weapons.json';
import abilitiesJson from './abilities.json';
import abominationsJson from './abominations.json';
import lootJson from './loot.json';
import raidJson from './raid.json';

export type Range = [number, number];

export interface HostClass {
  label: string;
  weight: 'light' | 'medium' | 'heavy';
  playableFrom: 'spore' | 'larva' | 'host';
  biomass: number;
  moveSpeed: number;
  sprintMultiplier: number;
  noise: number;
  stealth: number;
  impactVulnerability: number;
  toxinResistance: number;
  extractTimeMultiplier: number;
  stashSlots: number;
  cavityGrid: Range;
  overloadDecayMultiplier: number;
  toxicOverloadDecayMultiplier?: number;
  mutagenCostMultiplier: number;
}
export type ClassId = 'venomWraith' | 'neuroInfiltrator' | 'goreBehemoth';

export interface HostRules {
  neuralOverload: {
    max: number; sprintFillPerSecond: number; jumpFill: number; decayPerSecond: number;
    decayDelay: number; overloadedDuration: number; resetTo: number;
  };
  hitZones: { head: number; torso: number; limb: number };
  fallDamage: { safeHeight: number; damagePerMetre: number };
  healing: { naturalRegen: number };
  interactTime: { default: number };
  /** Base audible radius in metres; footsteps are multiplied by class noise. */
  noiseRadius: { footstepWalk: number; footstepSprint: number; jumpLand: number; gunfire: number; egoCharge: number; reload: number };
}

export interface Weapon {
  label: string;
  damage: number;
  fireRate: number;
  burst: { radius: number; damage: number };
  magazine: number;
  reserve: number | 'infinite';
  reloadTime: number;
  projectileSpeed: number;
  projectileGravity: number;
  spread: { hip: number; ads: number; movingPenalty: number; sprintBlocksFire: boolean };
  range: { falloffStart: number; falloffEnd: number; minMultiplier: number; maxDistance: number };
  weakPointMultiplier: number;
  recoil: { pitch: number; yawJitter: number; recovery: number };
  adsTime: number;
  egoCharge: {
    chargePerHit: number; chargePerWeakPointHit: number; chargeToFire: number; overloadFill: number;
    projectiles: number; damage: number; seekRadius: number; seekTurnRate: number;
    projectileSpeed: number; burstRadius: number;
  };
}

export interface Ability {
  label: string;
  slot: number;
  class?: ClassId;
  consumable?: boolean;
  item?: string;
  overloadCost: number;
  cooldown: number;
  [tunable: string]: unknown;
}

export interface Perception { sight: number; fov: number; hearing: number; alertShare: number; loseInterest: number }
export interface Abomination {
  label: string;
  role: string;
  biomass: number;
  speed: number;
  damage: number;
  attackRange: number;
  cooldown: number;
  windup: number;
  weakPoint: { name: string; multiplier: number; count?: number; biomassEach?: number; allPoppedKills?: boolean };
  perception: Perception;
  packSize: Range;
  staggerThreshold: number;
  dnaDrop: number;
  [tunable: string]: unknown;
}

export type ItemKind = 'consumable' | 'currency' | 'mutagen' | 'virus' | 'tech' | 'organ';
export interface Item { label: string; kind: ItemKind; value: number; size: Range; stack: number; inertUntil?: string }
export interface LootEntry { item: string; weight: number; count: Range }
export interface Container {
  label: string; openTime: number; noiseOnOpen: number;
  guaranteed: { item: string; count: number }[];
  rolls: number;
  table: LootEntry[];
}

export interface Placement { radius: number; bearing: number }
export interface SpawnGroup {
  type: string; count: number; radius: Range;
  packed?: boolean; nearExtract?: boolean; guardsContainer?: boolean;
}
export interface RaidRules {
  raidTime: number;
  zoneCollapse: { warningAt: number; damagePerSecondAfterTimeout: number };
  playableRadius: number;
  spawn: Placement & { safeTime: number; noEnemyWithin: number };
  extract: Placement & {
    label: string; activatesAt: number; zoneRadius: number; extractTime: number;
    cancelOnLeave: boolean; pausedWhileDamagedFor: number; signalNoise: number;
  };
  containers: (Placement & { type: string; guard?: string })[];
  spawnGroups: SpawnGroup[];
  reinforcements: {
    firstAt: number; interval: number; maxAlive: number;
    wave: { type: string; count: number; packed?: boolean }[];
    spawnMinDistanceFromPlayer: number;
  };
  pacing: { targetRushExtract: number; targetFullRaid: number };
  results: { dnaOnDeath: number; showHaulValue: boolean };
}

const strip = <T>(o: object): T => {
  const { _note: _, ...rest } = o as Record<string, unknown>;
  return rest as T;
};

export const CLASSES = strip<Record<ClassId, HostClass>>(classesJson);
export const HOST = strip<HostRules>(hostJson);
export const WEAPONS = strip<Record<string, Weapon>>(weaponsJson);
export const ABILITIES = strip<Record<string, Ability>>(abilitiesJson);
export const ABOMINATIONS = strip<Record<string, Abomination>>(abominationsJson);
export const LOOT = strip<{ currency: { id: string; label: string }; items: Record<string, Item>; containers: Record<string, Container> }>(lootJson);
export const RAID = strip<RaidRules>(raidJson);

/** Speed of the extract channel for a class, in seconds. */
export function extractTimeFor(cls: ClassId): number {
  return RAID.extract.extractTime * CLASSES[cls].extractTimeMultiplier;
}

/** Damage of one weapon projectile after range falloff and hit-zone/weak-point multipliers. */
export function projectileDamage(w: Weapon, distance: number, multiplier = 1): number {
  const { falloffStart, falloffEnd, minMultiplier } = w.range;
  const t = Math.min(1, Math.max(0, (distance - falloffStart) / (falloffEnd - falloffStart)));
  return w.damage * (1 - t * (1 - minMultiplier)) * multiplier;
}

/**
 * Roll a container's contents. `rand` returns [0, 1); pass a seeded RNG (zone7's mulberry32)
 * so raids are reproducible in tests.
 */
export function rollContainer(id: string, rand: () => number): { item: string; count: number }[] {
  const c = LOOT.containers[id];
  if (!c) throw new Error(`unknown container ${id}`);
  const out = c.guaranteed.map((g) => ({ ...g }));
  const total = c.table.reduce((s, e) => s + e.weight, 0);
  for (let i = 0; i < c.rolls; i++) {
    let pick = rand() * total;
    const entry = c.table.find((e) => (pick -= e.weight) < 0) ?? c.table[c.table.length - 1];
    const [lo, hi] = entry.count;
    out.push({ item: entry.item, count: lo + Math.floor(rand() * (hi - lo + 1)) });
  }
  return out;
}

/** Total DNA value of a haul (items plus kill DNA). */
export function haulValue(items: { item: string; count: number }[], killDna = 0): number {
  return items.reduce((s, { item, count }) => s + LOOT.items[item].value * count, killDna);
}
