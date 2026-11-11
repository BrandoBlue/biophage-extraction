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
