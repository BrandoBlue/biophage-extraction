/**
 * What the Hive screens read and what they ask for. The screens never touch game objects: HiveMenu adapts
 * Gameplay's Profile (src/game/profile.ts) to these shapes, so either side can change without the other.
 */
import { def as itemOf } from '../items';
import { CLASSES, PROFILE } from '../../../data';
import type { ClassId } from '../../../data';

export type GridZone = 'stash' | 'cavity' | 'pouch';

export interface Placed { item: string; count: number; x: number; y: number; rotated: boolean }

export interface ProfileView {
  callsign: string;
  dna: number;
  host: ClassId;
  stash: Placed[];
  stashRows: number;
  cavity: Placed[];
  gutPouch: Placed[];
  gutPouchLevel: number;
  stats: { raids: number; extracts: number; deaths: number; kills: number };
  /** Last raid result, for the menu's debrief card. */
  last?: { result: 'extracted' | 'lost'; value: number } | null;
  /** Zone picked on raid select (zones.json id). */
  zone?: string;
  /** Each host class's level (progression.ts), for host select. */
  classLevels?: Partial<Record<ClassId, number>>;
}

export interface HiveActions {
  /** Move a stack (or part of it) between grids. Returns false if it does not fit. */
  move(from: GridZone, index: number, to: GridZone, x: number, y: number, rotated: boolean): boolean;
  /** Next stash row price, or null when maxed. */
  stashRowCost(): number | null;
  expandStash(): boolean;
  /** Next gut-pouch upgrade, or null when maxed. */
  pouchUpgrade(): { cost: number; size: [number, number] } | null;
  upgradePouch(): boolean;
  deploy(): void;
  quit?(): void;
  /** Flesh Market (Host milestone). Optional: the MARKET tab unlocks when the profile supports it. */
  market?(): MarketView;
  /** Sells `count` of the stack at `index` of `zone`; returns the DNA paid (0 if nothing sold). */
  sell?(zone: GridZone, index: number, count: number): number;
  buy?(item: string): boolean;
  /** Hive vendors with stock, reputation and contracts (Gameplay's economy.ts). The VENDORS tab unlocks with it. */
  vendors?(): VendorView[];
  vendorBuy?(vendor: string, item: string): boolean;
  /** Sells to a vendor; returns the DNA paid (0 if nothing sold). */
  vendorSell?(vendor: string, zone: GridZone, index: number, count: number): number;
  acceptContract?(id: string): boolean;
  abandonContract?(vendor: string): boolean;
  /** Zone roster with access, and picking the raid-select zone. */
  zones?(): ZoneView[];
  selectZone?(id: string): boolean;
  /** Weapons: loadout slots, grafts and the class Armoury (Gameplay's arsenal.ts, mods.ts, progression.ts). The WEAPONS tab unlocks with it. */
  arsenal?(): ArsenalView;
  /** `slot` counts loadout slots like the rest of this tab: 1 = Slot I (the starter, 0, cannot be swapped). */
  equipWeapon?(slot: number, weapon: string): boolean;
  unequipWeapon?(slot: number): boolean;
  /** Graft a stash mod onto loadout gun `slot` (0 = starter). Returns Gameplay's FitResult. */
  fitMod?(slot: number, mod: string): string;
  removeMod?(slot: number, socket: string): boolean;
  /** Grow a copy of an unlocked signature weapon. Returns Gameplay's GrowResult. */
  growWeapon?(weapon: string): string;
  /** The Hive Body (Gameplay's src/game/hive.ts). The HIVE BODY tab unlocks with it. */
  hiveBody?(): HiveBodyView;
  growOrgan?(id: string): boolean;
  /** Banks the Spore Garden; returns the DNA collected. */
  collectGarden?(): number;
  startRecipe?(id: string): boolean;
  /** Takes the finished vat job into the stash; null when nothing is ready or the stash is full. */
  collectVat?(): { item: string; count: number } | null;
}

export type OrganState = 'ok' | 'max' | 'coming' | 'locked' | 'dna' | 'items';
export type RecipeState = 'ok' | 'no-vat' | 'unknown' | 'busy' | 'items';
export interface CostLine { item: string; count: number; have: number }
export interface OrganView {
  id: string; label: string; brief: string; level: number; max: number;
  /** What the current level does (data/hive.json level fields), empty before the first level. */
  now: string[];
  /** Next level: its cost and what it adds. Null at max. */
  next: { dna: number; items: CostLine[]; adds: string[] } | null;
  state: OrganState;
  /** Contract title that unlocks the organ, while it is locked. */
  lockedBy?: string | null;
}
export interface HiveBodyView {
  organs: OrganView[];
  /** Spore Garden, when grown: DNA ready to collect, its cap and rate. */
  garden: { stored: number; cap: number; perHour: number } | null;
  /** Gestation Vat, when grown: the recipes it knows and the job growing. */
  vat: {
    recipes: { id: string; inputs: CostLine[]; output: { item?: string; pool?: string[]; count: number }; time: number; state: RecipeState }[];
    job: { recipe: string; secondsLeft: number; total: number; ready: boolean } | null;
  } | null;
}

export type ZoneView = { id: string; label: string; access: { state: 'open' } | { state: 'locked' | 'coming'; reason: string } };

export type VendorBuyState = 'ok' | 'not-stocked' | 'rep' | 'dna' | 'space';
export type ContractState = 'done' | 'active' | 'available' | 'locked' | 'coming';
export interface ContractView {
  id: string; title: string; brief: string; state: ContractState;
  objectives: { text: string; done: number; need: number }[];
  reward: { dna: number; rep: number; items: { item: string; count: number }[]; unlock?: string };
  /** Titles of contracts that must be finished first. */
  requires: string[];
}
export interface VendorView {
  id: string; label: string; role: string; brief: string;
  /** Reputation level 1-4, points, and the level band [floor, next) (next null at max). */
  rep: { level: number; points: number; floor: number; next: number | null };
  unlocks: { rep: number; text: string; earned: boolean }[];
  stock: { item: string; price: number; rep: number; state: VendorBuyState }[];
  sellPrice(item: string): number;
  contracts: ContractView[];
}

export type BuyState = 'ok' | 'not-stocked' | 'dna' | 'space';
export interface MarketView {
  /** -3 (soured) to +3 (sated); moves buy prices. */
  mood: number;
  stock: { item: string; price: number; state: BuyState }[];
  sellPrice(item: string): number;
  /** Seconds until the stock rotates. */
  rotatesIn: number;
}

export const gridSize = (zone: GridZone, p: ProfileView): [number, number] => {
  if (zone === 'stash') return [PROFILE.stash.gridColumns, p.stashRows];
  if (zone === 'cavity') return CLASSES[p.host].cavityGrid as [number, number];
  const lvl = p.gutPouchLevel;
  return (lvl <= 0 ? PROFILE.gutPouch.size : PROFILE.gutPouch.upgrades[lvl - 1].size) as [number, number];
};

export const footprint = (pl: Pick<Placed, 'item' | 'rotated'>): [number, number] => {
  const [w, hh] = itemOf(pl.item)?.size ?? [1, 1];
  return pl.rotated ? [hh, w] : [w, hh];
};

export const itemsIn = (zone: GridZone, p: ProfileView): Placed[] => (zone === 'stash' ? p.stash : zone === 'cavity' ? p.cavity : p.gutPouch);

export const valueOf = (items: Placed[]) => items.reduce((s, i) => s + (itemOf(i.item)?.value ?? 0) * i.count, 0);

/** Cells used / total, for the "STASH CONTAINER (30/60 SLOTS)" readouts. */
export function usage(zone: GridZone, p: ProfileView): [number, number] {
  const [w, hh] = gridSize(zone, p);
  const used = itemsIn(zone, p).reduce((s, i) => { const [a, b] = footprint(i); return s + a * b; }, 0);
  return [used, w * hh];
}

/** One loadout gun (0 = the innate starter) with its grafts, base and modded spec. */
export interface LoadoutSlotView {
  index: number;
  weapon: string | null;
  starter: boolean;
  sockets: { socket: string; mod: string | null }[];
  base: import('../../../data').WeaponSpec | null;
  spec: import('../../../data').WeaponSpec | null;
}
export interface ArsenalView {
  slots: LoadoutSlotView[];
  /** Guns and grafts sitting in the stash. `fits` lists the loadout slots a graft can go on right now. */
  guns: { id: string; count: number }[];
  mods: { id: string; count: number; socket: string; fits: number[] }[];
  armoury: { weapon: string; cls: string; level: number; classLevel: number; unlocked: boolean; price: number; affordable: boolean }[];
}
