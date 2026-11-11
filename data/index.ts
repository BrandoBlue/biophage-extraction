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
import virusesJson from './viruses.json';
import nestsJson from './nests.json';
import profileJson from './profile.json';
import kitsJson from './kits.json';
import synapseJson from './synapse.json';
import progressionJson from './progression.json';
import viralLabJson from './viral-lab.json';
import marketJson from './market.json';
import rivalsJson from './rivals.json';

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
  /** Deprecated from Host: the stash is shared by the profile (profile.json); kept for compatibility. */
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

export interface Virus {
  label: string;
  item: string;
  effect: Record<string, unknown>;
  cost: Record<string, unknown>;
  /** Art brief for the visible mutation. */
  mutation: string;
}
export interface VirusRules { injectTime: number; injectMovementMultiplier: number; injectNoise: number; maxActive: number; mutationGrowTime: number }

export interface SpawnSpec { type: string; count: number }
export interface Nest {
  label: string;
  biomass: number;
  weakPoints: { count: number; multiplier: number; biomassEach: number };
  activationRadius: number; firstWaveDelay: number; waveInterval: number; maxWaves: number; maxAliveFromNest: number;
  waves: SpawnSpec[][];
  onDestroyed: { container: string; dnaDrop: number; shockwave: { radius: number; overload: number } };
}

export interface ProfileRules {
  storageKey: string;
  schemaVersion: number;
  newProfile: { dna: number; stash: { item: string; count: number }[] };
  stash: { gridColumns: number; rowsBase: number; rowExpansion: { rows: number; baseCost: number; costGrowth: number; maxRows: number } };
  gutPouch: { size: Range; upgrades: { size: Range; cost: number }[] };
  death: { losesCavityItems: boolean; keepsGutPouch: boolean; keepsInnateWeapon: boolean; killDnaLost: boolean };
  freeKit: { clotGelFloor: number };
}
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
  larva: {
    nests: (Placement & { type: string })[];
    containers: (Placement & { type: string; guard?: string })[];
    spawnGroups: SpawnGroup[];
    extracts: (Placement & { label: string; opensAt: number })[];
    corpseHarvest: boolean;
  };
  host: {
    playableRadius: number;
    raidTime: number;
    biomes: (Placement & { id: string; label: string; threat: number; look: string })[];
    spawns: { radius: number; count: number; minSeparation: number };
    extracts: {
      pool: Placement[]; openAtStart: number; shiftEvery: number; warnBeforeShift: number; maxOpen: number;
      paidExtract: { bearing: number; costDna: number; extractTime: number };
    };
    anomalies: { id: string; label: string; chancePerRaid: number; duration?: number; radius?: number; effect: Record<string, unknown>; look: string }[];
    rivals: boolean;
  };
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
const virusData = strip<Record<string, unknown>>(virusesJson);
export const VIRUS_RULES = virusData.rules as VirusRules;
export const VIRUSES = Object.fromEntries(Object.entries(virusData).filter(([k]) => k !== 'rules')) as Record<string, Virus>;
export const NESTS = strip<Record<string, Nest>>(nestsJson);
export const PROFILE = strip<ProfileRules>(profileJson);

/** DNA cost of the next stash row expansion, given rows already bought. Infinity at the cap. */
export function stashRowCost(rowsBought: number): number {
  const e = PROFILE.stash.rowExpansion;
  if (PROFILE.stash.rowsBase + rowsBought * e.rows >= e.maxRows) return Infinity;
  return Math.round(e.baseCost * e.costGrowth ** rowsBought);
}

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

/**
 * World x, z of a raid layout placement (fraction of radius + compass bearing).
 * 0° = north = −Z, 90° = east = +X. Pass the actual walkable radius if the island is smaller.
 */
export function layoutPosition(p: Placement, radius = RAID.playableRadius): [number, number] {
  const b = (p.bearing * Math.PI) / 180;
  const r = p.radius * radius;
  return [Math.sin(b) * r, -Math.cos(b) * r];
}

// ---------- Host milestone (docs/gdd/host-milestone.md) ----------

export interface KitAbility { label: string; slot: number; overloadCost?: number; cooldown?: number; see?: string; [tunable: string]: unknown }
export interface ClassKit {
  weapon: { id: string; label: string; kind: string; [tunable: string]: unknown };
  melee: { id: string; label: string; damage: number; cooldown: number; range: number; [tunable: string]: unknown };
  abilities: Record<string, KitAbility>;
  passives: Record<string, string>;
}

/** Key of PATH in src/render/palette.ts. */
export type PathColour = 'stealth' | 'melee' | 'viral' | 'dna';
export interface SynapseNode { id: string; label: string; dna: number; mutagens: number; level: number; effect: Record<string, unknown>; visual: string }
export interface SynapsePath { label: string; colour: PathColour; nodes: SynapseNode[] }

export interface Evolution {
  id: string; label: string; level: number; milestone: 'host' | 'apex';
  statDelta?: Record<string, number>; grants?: Record<string, unknown>;
  /** Art brief for Creature & Mutation. */
  body: string;
}
export interface Progression {
  xp: { kill: Record<string, number>; extract: number; extractPerHaulDna: number; death: number; harvest: number; nestDestroyed: number };
  /** Total XP needed to reach level index+1. */
  levels: number[];
  evolutions: Record<ClassId, Evolution[]>;
}

export interface ViralLab {
  genomeSlots: number; permanentStrength: number;
  cost: Record<string, { dna: number; mutagens: number }>;
  viralLoad: { perStrain: number; stable: Record<ClassId, number> };
  instability: { id: string; label: string; effect: Record<string, unknown>; look: string }[];
  purge: { dna: number; description: string };
}

export interface FleshMarket {
  vendor: { label: string; brief: string };
  buyRate: number; stockSize: number; rotateHours: number;
  mood: { start: number; min: number; max: number; priceMultiplierPerStep: number; likes: ItemKind[]; dislikes: ItemKind[]; perLikedSale: number; perDislikedSale: number };
  catalogue: { item: string; price: number; weight: number }[];
  contraband: Record<string, Item & Record<string, unknown>>;
}

export interface RivalRules {
  perRaid: Range; spawnDelay: Range;
  classMix: Record<ClassId, number>;
  personalities: Record<string, { weight: number; aggression: number; lootPriority: number; extractAt: number; fleeBelow: number; ambushNearExtract?: boolean }>;
  skill: { reactionTime: Range; aimError: Range; aimErrorPerMetre: number; strafe: boolean };
  loadoutTiers: { weight: number; items: { item: string; count: number }[] }[];
  kill: { dropsCavity: boolean; stealKillDnaFraction: number };
  evolutionChance: number;
}

const synapseData = strip<Record<string, unknown>>(synapseJson);
export const KITS = strip<Record<ClassId, ClassKit>>(kitsJson);
export const SYNAPSE = synapseData as Record<ClassId, Record<string, SynapsePath>>;
export const PROGRESSION = strip<Progression>(progressionJson);
export const VIRAL_LAB = strip<ViralLab>(viralLabJson);
export const MARKET = strip<FleshMarket>(marketJson);
export const RIVALS = strip<RivalRules>(rivalsJson);

/** Every item id that exists: loot items plus Flesh Market contraband. */
export function itemDef(id: string): Item | undefined {
  return LOOT.items[id] ?? MARKET.contraband[id];
}

/** Class level (1-based) for a total XP. */
export function levelForXp(xp: number): number {
  let lvl = 0;
  while (lvl < PROGRESSION.levels.length && xp >= PROGRESSION.levels[lvl]) lvl++;
  return Math.max(1, lvl);
}

/** Mutagen cost of a Synapse node for a class, after the class multiplier (rounded up). */
export function nodeMutagenCost(cls: ClassId, node: SynapseNode): number {
  return Math.ceil(node.mutagens * CLASSES[cls].mutagenCostMultiplier);
}

/** Flesh Market sell price of a catalogue entry at a given mood. */
export function marketPrice(basePrice: number, mood: number): number {
  const m = Math.max(MARKET.mood.min, Math.min(MARKET.mood.max, mood));
  return Math.round(basePrice * (1 + m * MARKET.mood.priceMultiplierPerStep));
}
