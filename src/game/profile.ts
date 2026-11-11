/**
 * The persistent profile (Larva): banked DNA, the stash, the loadout in the host's cavities, the gut pouch and
 * the raid record. Rules are in docs/gdd/larva-milestone.md and data/profile.json (`PROFILE`).
 *
 * Lifecycle: the Hive menu edits the profile; `deploy` hands the cavity loadout to the raid and saves the profile
 * with empty cavities, so quitting mid-raid loses the loadout like a death; `extract` or `die` settles the raid.
 */
import { CLASSES, LOOT, PROFILE, stashRowCost, type ClassId } from '../../data';
import { footprint, ItemGrid, stackLimit, type Placed } from './grid';
import type { CarriedSnapshot, Loadout } from './inventory';

export interface RaidRecord { raids: number; extracts: number; deaths: number; kills: number }

export interface Profile {
  schemaVersion: number;
  dna: number;
  stash: Placed[];
  stashRows: number;
  gutPouchLevel: number;
  cavity: Placed[];
  gutPouch: Placed[];
  stats: RaidRecord;
  host: ClassId;
}

/** Key/value store; `localStorage` in the browser, a Map in tests or when storage is blocked. */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function memoryStorage(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

/** localStorage when it works (file:// and private modes can throw), otherwise an in-memory store. */
export function browserStorage(): KV {
  try {
    const ls = globalThis.localStorage;
    const probe = `${PROFILE.storageKey}.probe`;
    ls.setItem(probe, '1'); ls.removeItem(probe);
    return ls;
  } catch {
    return memoryStorage();
  }
}

const DNA_ITEM = 'dnaStrand';

// ------------------------------------------------------------------ grids
export const stashGrid = (p: Profile): ItemGrid => new ItemGrid(PROFILE.stash.gridColumns, p.stashRows, p.stash);
export const cavitySize = (p: Profile): [number, number] => CLASSES[p.host].cavityGrid as [number, number];
export const cavityGrid = (p: Profile): ItemGrid => { const [c, r] = cavitySize(p); return new ItemGrid(c, r, p.cavity); };
export function pouchSize(level: number): [number, number] {
  const u = PROFILE.gutPouch.upgrades;
  return (level <= 0 ? PROFILE.gutPouch.size : u[Math.min(level, u.length) - 1].size) as [number, number];
}
export const pouchGrid = (p: Profile): ItemGrid => { const [c, r] = pouchSize(p.gutPouchLevel); return new ItemGrid(c, r, p.gutPouch); };

/** Cost of the next gut pouch upgrade, Infinity at the top level. */
export const pouchUpgradeCost = (p: Profile): number => PROFILE.gutPouch.upgrades[p.gutPouchLevel]?.cost ?? Infinity;
export const nextStashRowCost = (p: Profile): number => stashRowCost((p.stashRows - PROFILE.stash.rowsBase) / PROFILE.stash.rowExpansion.rows);

// ------------------------------------------------------------------ creation and storage
export function newProfile(): Profile {
  const stash = new ItemGrid(PROFILE.stash.gridColumns, PROFILE.stash.rowsBase);
  for (const s of PROFILE.newProfile.stash) stash.add(s.item, s.count);
  return {
    schemaVersion: PROFILE.schemaVersion, dna: PROFILE.newProfile.dna, stash: stash.snapshot(), stashRows: PROFILE.stash.rowsBase,
    gutPouchLevel: 0, cavity: [], gutPouch: [], stats: { raids: 0, extracts: 0, deaths: 0, kills: 0 }, host: 'neuroInfiltrator',
  };
}

/** Re-packs every grid so a hand-edited or older save can never hold overlapping or unknown items. */
function normalise(raw: Partial<Profile>): Profile {
  const base = newProfile();
  const p: Profile = {
    ...base, ...raw,
    stats: { ...base.stats, ...(raw.stats ?? {}) },
    host: raw.host && CLASSES[raw.host] ? raw.host : base.host,
    stash: Array.isArray(raw.stash) ? raw.stash : base.stash,
    cavity: Array.isArray(raw.cavity) ? raw.cavity : [],
    gutPouch: Array.isArray(raw.gutPouch) ? raw.gutPouch : [],
  };
  p.stashRows = Math.min(PROFILE.stash.rowExpansion.maxRows, Math.max(PROFILE.stash.rowsBase, Math.floor(Number(p.stashRows) || 0)));
  p.gutPouchLevel = Math.min(PROFILE.gutPouch.upgrades.length, Math.max(0, Math.floor(Number(p.gutPouchLevel) || 0)));
  p.dna = Math.max(0, Math.floor(Number(p.dna) || 0));
  p.stash = stashGrid(p).snapshot();
  p.cavity = cavityGrid(p).snapshot();
  p.gutPouch = pouchGrid(p).snapshot();
  return p;
}

export interface Loaded { profile: Profile; notice: string | null }

/** Loads the profile. An unreadable or unknown-version save is backed up to `<key>.bak`, never silently wiped. */
export function loadProfile(kv: KV): Loaded {
  const raw = kv.getItem(PROFILE.storageKey);
  if (raw == null) return { profile: newProfile(), notice: null };
  let parsed: Partial<Profile> | null = null;
  try { parsed = JSON.parse(raw); } catch { /* handled below */ }
  if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== PROFILE.schemaVersion) {
    kv.setItem(`${PROFILE.storageKey}.bak`, raw);
    const p = newProfile();
    saveProfile(kv, p);
    return { profile: p, notice: 'Old or unreadable save backed up; a new host profile was grown.' };
  }
  return { profile: normalise(parsed), notice: null };
}

export function saveProfile(kv: KV, p: Profile): boolean {
  try { kv.setItem(PROFILE.storageKey, JSON.stringify(p)); return true; } catch { return false; }
}

// ------------------------------------------------------------------ Hive menu actions
export type Zone = 'stash' | 'cavity' | 'pouch';
const grids = (p: Profile): Record<Zone, ItemGrid> => ({ stash: stashGrid(p), cavity: cavityGrid(p), pouch: pouchGrid(p) });
function commit(p: Profile, g: Record<Zone, ItemGrid>): void {
  p.stash = g.stash.snapshot(); p.cavity = g.cavity.snapshot(); p.gutPouch = g.pouch.snapshot();
}

/**
 * Moves the stack at `index` of zone `from` into zone `to` (stacking, then first-fit). What does not fit stays put.
 * Returns how many moved.
 */
export function transfer(p: Profile, from: Zone, index: number, to: Zone): number {
  if (from === to) return 0;
  const g = grids(p);
  const e = g[from].entries[index];
  if (!e) return 0;
  const moved = e.count - g[to].add(e.item, e.count);
  if (moved > 0) { e.count -= moved; if (e.count <= 0) g[from].take(e); commit(p, g); }
  return moved;
}

/**
 * Drag and drop: puts the whole stack at `index` of `from` at cell (x, y) of `to`. Within one zone it moves or
 * rotates in place. Dropped on a stack of the same item, it tops that stack up and leaves the remainder where it was.
 * Returns false and changes nothing if the drop is blocked.
 */
export function placeAt(p: Profile, from: Zone, index: number, to: Zone, x: number, y: number, rotated = false): boolean {
  const g = grids(p);
  const e = g[from].entries[index];
  if (!e) return false;
  const under = g[to].entries.find((o) => {
    if (o === e || o.item !== e.item) return false;
    const [w, h] = footprint(o.item, o.rotated);
    return x >= o.x && x < o.x + w && y >= o.y && y < o.y + h;
  });
  if (under) {
    const n = Math.min(e.count, stackLimit(e.item) - under.count);
    if (n <= 0) return false;
    under.count += n; e.count -= n;
    if (e.count <= 0) g[from].take(e);
  } else if (from === to) {
    if (!g[to].move(e, x, y, rotated)) return false;
  } else {
    if (!g[to].place(e.item, e.count, x, y, rotated)) return false;
    g[from].take(e);
  }
  commit(p, g);
  return true;
}

/** Rotates a stack in place if the rotated footprint fits. */
export function rotate(p: Profile, zone: Zone, index: number): boolean {
  const g = grids(p);
  const e = g[zone].entries[index];
  if (!e || !g[zone].move(e, e.x, e.y, !e.rotated)) return false;
  commit(p, g);
  return true;
}

export function expandStash(p: Profile): boolean {
  const cost = nextStashRowCost(p);
  if (!Number.isFinite(cost) || p.dna < cost) return false;
  p.dna -= cost;
  p.stashRows = Math.min(PROFILE.stash.rowExpansion.maxRows, p.stashRows + PROFILE.stash.rowExpansion.rows);
  return true;
}

export function upgradePouch(p: Profile): boolean {
  const cost = pouchUpgradeCost(p);
  if (!Number.isFinite(cost) || p.dna < cost) return false;
  p.dna -= cost;
  p.gutPouchLevel++;
  p.gutPouch = pouchGrid(p).snapshot();
  return true;
}

// ------------------------------------------------------------------ raid transitions
export interface Deployment { loadout: Loadout; cavitySize: [number, number]; pouchSize: [number, number]; freeKit: number }

/**
 * Hands the cavity loadout and gut pouch to the raid. The saved profile keeps the gut pouch (it is secure) but its
 * cavities are emptied now, so closing the tab mid-raid costs the loadout exactly as death would.
 * Free kit: below `freeKit.clotGelFloor` Clot Gel between stash and cavities, the host grows the difference.
 */
export function deploy(p: Profile): Deployment {
  const g = grids(p);
  const gel = 'clotGel';
  const have = g.stash.count(gel) + g.cavity.count(gel) + g.pouch.count(gel);
  const grow = Math.max(0, PROFILE.freeKit.clotGelFloor - have);
  const freeKit = grow - g.cavity.add(gel, grow);
  const loadout = { cavity: g.cavity.snapshot(), pouch: g.pouch.snapshot() };
  p.cavity = [];
  p.stats.raids++;
  return { loadout, cavitySize: cavitySize(p), pouchSize: pouchSize(p.gutPouchLevel), freeKit };
}

export interface Settlement { toStash: { item: string; count: number }[]; overflow: { item: string; count: number }[]; dnaBanked: number }

/**
 * Extraction: cavity items move to the stash (DNA Strand Bundles convert to banked DNA and take no space),
 * kill DNA is banked, the gut pouch returns as carried. Items the stash has no room for wait in the cavities
 * and become the next loadout.
 */
export function extract(p: Profile, c: Pick<CarriedSnapshot, 'cavity' | 'pouch' | 'dna'>, kills: number): Settlement {
  const stash = stashGrid(p);
  const [cc, cr] = cavitySize(p);
  const leftover = new ItemGrid(cc, cr);
  const toStash: Settlement['toStash'] = [], overflow: Settlement['overflow'] = [];
  let dnaBanked = c.dna;
  for (const e of c.cavity) {
    if (e.item === DNA_ITEM) { dnaBanked += LOOT.items[DNA_ITEM].value * e.count; continue; }
    const left = stash.add(e.item, e.count);
    if (e.count - left > 0) toStash.push({ item: e.item, count: e.count - left });
    if (left > 0) { leftover.add(e.item, left); overflow.push({ item: e.item, count: left }); }
  }
  p.stash = stash.snapshot();
  p.cavity = leftover.snapshot();
  p.gutPouch = new ItemGrid(...pouchSize(p.gutPouchLevel), c.pouch).snapshot();
  p.dna += dnaBanked;
  p.stats.extracts++;
  p.stats.kills += kills;
  return { toStash, overflow, dnaBanked };
}

/** Death: cavity items and kill DNA are gone; the gut pouch comes home as carried; banked DNA is untouched. */
export function die(p: Profile, c: Pick<CarriedSnapshot, 'pouch'>, kills: number): void {
  p.cavity = [];
  if (PROFILE.death.keepsGutPouch) p.gutPouch = new ItemGrid(...pouchSize(p.gutPouchLevel), c.pouch).snapshot();
  p.stats.deaths++;
  p.stats.kills += kills;
}
