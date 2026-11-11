/**
 * The Hive Body (docs/gdd/07-economy-and-progression.md, data/hive.json): the base is an organism you grow by
 * feeding it extracted items. Organs have levels bought with DNA plus specific items from the stash; the Spore
 * Garden fruits DNA over real time up to a cap; the Gestation Vat turns organs into consumables over real time;
 * Memory Coral and later organs grant effects. Pure logic over the Profile; UI & HUD builds the screen.
 * Times are wall-clock milliseconds passed in (`now`), so tests can fast-forward.
 */
import { CONTRACTS, HIVE_ORGANS, RECIPES, type HiveOrganLevel, type Recipe } from '../../data';
import { reachedMilestone } from './economy';
import { stashGrid, type Profile } from './profile';

export interface VatJob { recipe: string; readyAt: number }
export interface HiveState {
  /** Built level per organ id (absent = not grown). */
  organs: Record<string, number>;
  /** Spore Garden: when its DNA was last collected (ms). */
  gardenSince: number;
  /** Gestation Vat: the one job growing, if any. */
  vat: VatJob | null;
}

export const newHive = (): HiveState => ({ organs: {}, gardenSince: 0, vat: null });

export function normaliseHive(raw: Partial<HiveState> | undefined): HiveState {
  const h = newHive();
  if (!raw || typeof raw !== 'object') return h;
  for (const [id, lvl] of Object.entries(raw.organs ?? {})) {
    const o = HIVE_ORGANS[id], n = Math.floor(Number(lvl));
    if (o && n > 0) h.organs[id] = Math.min(n, o.levels.length);
  }
  h.gardenSince = Math.max(0, Number(raw.gardenSince) || 0);
  const v = raw.vat;
  if (v && RECIPES[v.recipe] && Number.isFinite(Number(v.readyAt))) h.vat = { recipe: v.recipe, readyAt: Number(v.readyAt) };
  return h;
}

// ------------------------------------------------------------------ organs
export const organLevel = (p: Profile, id: string): number => p.hive.organs[id] ?? 0;
/** Data of the organ's current level, or null when not grown. */
export const organNow = (p: Profile, id: string): HiveOrganLevel | null => HIVE_ORGANS[id]?.levels[organLevel(p, id) - 1] ?? null;
/** Data of the next level, or null at the top. */
export const organNext = (p: Profile, id: string): HiveOrganLevel | null => HIVE_ORGANS[id]?.levels[organLevel(p, id)] ?? null;

/** The contract whose reward unlocks this organ (contracts.json reward.unlock names the organ id), if any. */
const contractUnlocking = (id: string): string | null => CONTRACTS.find((c) => c.reward.unlock === id)?.id ?? null;
const gatedByContract = (id: string): boolean => contractUnlocking(id) !== null;

export type GrowResult = 'ok' | 'max' | 'coming' | 'locked' | 'dna' | 'items';

/** Why growing the organ's next level would fail now, or 'ok'. */
export function canGrowOrgan(p: Profile, id: string): GrowResult {
  const o = HIVE_ORGANS[id];
  if (!o || !reachedMilestone(o.milestone)) return 'coming';
  const next = organNext(p, id);
  if (!next) return 'max';
  if (organLevel(p, id) === 0 && gatedByContract(id) && !p.economy.unlocks.includes(id)) return 'locked';
  if (p.dna < next.cost.dna) return 'dna';
  const g = stashGrid(p);
  if (next.cost.items.some((c) => g.count(c.item) < c.count)) return 'items';
  return 'ok';
}

/** The contract whose reward unlocks the organ, when it is still locked (for the screen's hint). */
export const organLockedBy = (p: Profile, id: string): string | null =>
  organLevel(p, id) === 0 && !p.economy.unlocks.includes(id) ? contractUnlocking(id) : null;

/** Grows the organ one level: pays DNA and items from the stash. Returns false, changing nothing, unless 'ok'. */
export function growOrgan(p: Profile, id: string, now = Date.now()): boolean {
  if (canGrowOrgan(p, id) !== 'ok') return false;
  const next = organNext(p, id)!;
  if (id === 'sporeGarden') collectGarden(p, now); // bank the old rate before the new one starts
  takeFromStash(p, next.cost.items);
  p.dna -= next.cost.dna;
  p.hive.organs[id] = organLevel(p, id) + 1;
  if (id === 'sporeGarden' && organLevel(p, id) === 1) p.hive.gardenSince = now;
  return true;
}

/** Merged effects of every grown organ's current level (e.g. Memory Coral's scannerShowsPodsAtStart). */
export function hiveEffects(p: Profile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(p.hive.organs)) Object.assign(out, organNow(p, id)?.effect ?? {});
  return out;
}

// ------------------------------------------------------------------ Spore Garden
const HOUR = 3600e3;

/** DNA the Spore Garden holds right now (dnaPerHour since the last collection, capped). */
export function gardenStored(p: Profile, now = Date.now()): number {
  const lvl = organNow(p, 'sporeGarden');
  if (!lvl?.dnaPerHour) return 0;
  const hours = Math.max(0, now - p.hive.gardenSince) / HOUR;
  return Math.min(lvl.cap ?? Infinity, Math.floor(hours * lvl.dnaPerHour));
}

/** Banks the garden's DNA. Returns how much. */
export function collectGarden(p: Profile, now = Date.now()): number {
  const n = gardenStored(p, now);
  p.dna += n;
  if (organLevel(p, 'sporeGarden') > 0) p.hive.gardenSince = now;
  return n;
}

// ------------------------------------------------------------------ Gestation Vat
/** Recipes the vat's current level knows. */
export const vatRecipes = (p: Profile): string[] => organNow(p, 'gestationVat')?.recipes ?? [];

export type VatResult = 'ok' | 'no-vat' | 'unknown' | 'busy' | 'items';

export function canStartRecipe(p: Profile, recipe: string): VatResult {
  if (organLevel(p, 'gestationVat') === 0) return 'no-vat';
  if (!vatRecipes(p).includes(recipe) || !RECIPES[recipe]) return 'unknown';
  if (p.hive.vat) return 'busy';
  const g = stashGrid(p);
  return RECIPES[recipe].inputs.every((c) => g.count(c.item) >= c.count) ? 'ok' : 'items';
}

/** Feeds the recipe's inputs from the stash into the vat. One job at a time. */
export function startRecipe(p: Profile, recipe: string, now = Date.now()): boolean {
  if (canStartRecipe(p, recipe) !== 'ok') return false;
  takeFromStash(p, RECIPES[recipe].inputs);
  p.hive.vat = { recipe, readyAt: now + RECIPES[recipe].time * 1000 };
  return true;
}

export interface VatStatus { recipe: string; label: Recipe['output']; secondsLeft: number; ready: boolean }
export function vatStatus(p: Profile, now = Date.now()): VatStatus | null {
  const v = p.hive.vat;
  if (!v) return null;
  const left = Math.max(0, (v.readyAt - now) / 1000);
  return { recipe: v.recipe, label: RECIPES[v.recipe].output, secondsLeft: Math.ceil(left), ready: left <= 0 };
}

/**
 * Takes a finished job out into the stash. A `pool` output picks one entry, seeded by the job so the result is
 * fixed once the job starts (no save-scumming). Returns what came out, or null if nothing is ready or the stash is full.
 */
export function collectVat(p: Profile, now = Date.now()): { item: string; count: number } | null {
  const v = p.hive.vat;
  if (!v || v.readyAt > now) return null;
  const out = RECIPES[v.recipe].output;
  const item = out.item ?? out.pool![Math.abs(Math.floor(v.readyAt / 1000)) % out.pool!.length];
  const g = stashGrid(p);
  if (g.room(item, out.count) < out.count) return null;
  g.add(item, out.count);
  p.stash = g.snapshot();
  p.hive.vat = null;
  return { item, count: out.count };
}

// ------------------------------------------------------------------ helpers
function takeFromStash(p: Profile, items: { item: string; count: number }[]): void {
  const g = stashGrid(p);
  for (const c of items) {
    let left = c.count;
    for (const e of [...g.entries]) {
      if (left <= 0 || e.item !== c.item) continue;
      const k = Math.min(left, e.count);
      e.count -= k; left -= k;
      if (e.count <= 0) g.take(e);
    }
  }
  p.stash = g.snapshot();
}
