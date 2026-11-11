/**
 * The reasons to extract (docs/gdd/07-economy-and-progression.md, 08-zones-and-bosses.md): Hive vendors with
 * reputation, contract chains whose progress only counts when you get out, and which zones raid select may deploy
 * to. Pure logic over the Profile; UI & HUD builds the screens, Raid fills a RaidLog during the raid.
 * Numbers come from data/vendors.json, contracts.json and zones.json.
 */
import { CONTRACTS, VENDORS, ZONES, vendorBuyPrice, vendorRepLevel, type Contract, type Objective, type VendorId } from '../../data';
import { ItemGrid } from './grid';
import { cavityGrid, pouchGrid, stashGrid, type Profile, type Zone as GridZone } from './profile';

/** Plan iterations in order (docs/PLAN.md). Zones and vendors from a later milestone are shown as coming. */
export const MILESTONES = ['spore', 'larva', 'host', 'hive', 'apex'] as const;
export type Milestone = (typeof MILESTONES)[number];
/** The milestone this build ships. Build bumps it with each release. */
export const CURRENT_MILESTONE: Milestone = 'larva';
const reached = (m: string, now: Milestone = CURRENT_MILESTONE): boolean => {
  const i = MILESTONES.indexOf(m as Milestone);
  return i >= 0 && i <= MILESTONES.indexOf(now);
};

export const DEFAULT_ZONE = 'glowmireIsle';

/** Economy part of the profile. `normaliseEconomy` fills it for older saves. */
export interface EconomyState {
  /** Reputation points per vendor (level via vendorRepLevel). */
  rep: Partial<Record<VendorId, number>>;
  /** One active contract per vendor, progress per objective, finished contract ids. */
  contracts: { active: Partial<Record<VendorId, string>>; progress: Record<string, number[]>; done: string[] };
  /** Unlock keys granted by contracts, e.g. 'gestationVat', 'zone:longSeedWreck'. */
  unlocks: string[];
  /** Zone picked on raid select. */
  zone: string;
}

export function newEconomy(): EconomyState {
  return { rep: {}, contracts: { active: {}, progress: {}, done: [] }, unlocks: [], zone: DEFAULT_ZONE };
}

/** Repairs the economy fields of a loaded save: unknown vendors, contracts and zones are dropped. */
export function normaliseEconomy(raw: Partial<EconomyState> | undefined): EconomyState {
  const e = newEconomy();
  if (!raw || typeof raw !== 'object') return e;
  for (const [v, n] of Object.entries(raw.rep ?? {})) if (VENDORS[v as VendorId] && Number(n) > 0) e.rep[v as VendorId] = Number(n);
  const c = raw.contracts;
  if (c && typeof c === 'object') {
    e.contracts.done = (Array.isArray(c.done) ? c.done : []).filter((id) => contractById(id));
    for (const [v, id] of Object.entries(c.active ?? {})) {
      const k = contractById(id as string);
      if (k && k.vendor === v && !e.contracts.done.includes(k.id)) e.contracts.active[v as VendorId] = k.id;
    }
    for (const id of Object.values(e.contracts.active)) {
      const k = contractById(id!)!, prog = c.progress?.[id!];
      e.contracts.progress[id!] = k.objectives.map((o, i) => Math.min(target(o), Math.max(0, Number(prog?.[i]) || 0)));
    }
  }
  e.unlocks = Array.isArray(raw.unlocks) ? raw.unlocks.filter((u) => typeof u === 'string') : [];
  e.zone = typeof raw.zone === 'string' && ZONES[raw.zone] ? raw.zone : DEFAULT_ZONE;
  return e;
}

// ------------------------------------------------------------------ vendors and reputation
export const repPoints = (p: Profile, v: VendorId): number => p.economy.rep[v] ?? 0;
export const repLevel = (p: Profile, v: VendorId): number => vendorRepLevel(repPoints(p, v));
/** Vendors open in this build (the Gullet Broker trades through the Flesh Market until Host). */
export const openVendors = (): VendorId[] => (Object.keys(VENDORS) as VendorId[]).filter((v) => reached(VENDORS[v].milestone) && VENDORS[v].stock);

/** Trading earns 1 rep point per 100 DNA (vendors.json note). Fractions accumulate. */
const REP_PER_DNA = 1 / 100;
function addRep(p: Profile, v: VendorId, n: number): void { p.economy.rep[v] = repPoints(p, v) + n; }

/** Structured vendor perks (vendors.json `perks`), enforced when present and the rep level is reached. */
export interface VendorPerks {
  pouchUpgradeDiscount?: { rep: number; fraction: number };
  deployGift?: { rep: number; item: string; count: number; to: 'pouch' | 'cavity' };
}
/** A perk the profile has earned with any open vendor, or null. */
export function earnedPerk<K extends keyof VendorPerks>(p: Profile, perk: K): NonNullable<VendorPerks[K]> | null {
  for (const v of openVendors()) {
    const x = ((VENDORS[v] as { perks?: VendorPerks }).perks ?? {})[perk];
    if (x && repLevel(p, v) >= x.rep) return x as NonNullable<VendorPerks[K]>;
  }
  return null;
}

export interface VendorOffer { item: string; price: number; rep: number; available: boolean }

/** The vendor's stock; entries above the profile's rep level are listed but not available. */
export function vendorStock(p: Profile, v: VendorId): VendorOffer[] {
  const lvl = repLevel(p, v);
  return (VENDORS[v].stock ?? []).map((s) => ({ ...s, available: lvl >= s.rep }));
}

/** Sells up to `count` from a stack to a vendor at their rate. Returns DNA paid. */
export function vendorSell(p: Profile, v: VendorId, zone: GridZone, index: number, count = Infinity): number {
  const grid = zoneGrid(p, zone);
  const e = grid.entries[index];
  if (!e) return 0;
  const n = Math.min(e.count, Math.max(0, Math.floor(count)));
  if (n <= 0) return 0;
  const paid = vendorBuyPrice(v, e.item) * n;
  e.count -= n;
  if (e.count <= 0) grid.take(e);
  saveZone(p, zone, grid);
  p.dna += paid;
  addRep(p, v, paid * REP_PER_DNA);
  return paid;
}

export type VendorBuyResult = 'ok' | 'not-stocked' | 'rep' | 'dna' | 'space';

export function canVendorBuy(p: Profile, v: VendorId, item: string): VendorBuyResult {
  const o = vendorStock(p, v).find((s) => s.item === item);
  if (!o) return 'not-stocked';
  if (!o.available) return 'rep';
  if (p.dna < o.price) return 'dna';
  if (stashGrid(p).room(item, 1) < 1) return 'space';
  return 'ok';
}

/** Buys one into the stash. Returns false, changing nothing, unless canVendorBuy is 'ok'. */
export function vendorBuy(p: Profile, v: VendorId, item: string): boolean {
  if (canVendorBuy(p, v, item) !== 'ok') return false;
  const price = vendorStock(p, v).find((s) => s.item === item)!.price;
  const g = stashGrid(p);
  g.add(item, 1);
  p.stash = g.snapshot();
  p.dna -= price;
  addRep(p, v, price * REP_PER_DNA);
  return true;
}

// ------------------------------------------------------------------ contracts
export const contractById = (id: string): Contract | undefined => CONTRACTS.find((c) => c.id === id);
const target = (o: Objective): number => o.count ?? 1;

export type ContractState = 'done' | 'active' | 'available' | 'locked' | 'coming';

export function contractState(p: Profile, id: string): ContractState {
  const c = contractById(id);
  if (!c || !reached(c.milestone) || !reached(VENDORS[c.vendor].milestone)) return 'coming';
  if (p.economy.contracts.done.includes(id)) return 'done';
  if (p.economy.contracts.active[c.vendor] === id) return 'active';
  return (c.requires ?? []).every((r) => p.economy.contracts.done.includes(r)) ? 'available' : 'locked';
}

/** A vendor's contract chain with each contract's state, in data order. */
export function vendorContracts(p: Profile, v: VendorId): { contract: Contract; state: ContractState; progress: number[] }[] {
  return CONTRACTS.filter((c) => c.vendor === v).map((contract) => ({
    contract, state: contractState(p, contract.id),
    progress: p.economy.contracts.progress[contract.id] ?? contract.objectives.map(() => 0),
  }));
}

/** Takes a contract. One per vendor: an active one must be finished or abandoned first. */
export function acceptContract(p: Profile, id: string): boolean {
  const c = contractById(id);
  if (!c || contractState(p, id) !== 'available' || p.economy.contracts.active[c.vendor]) return false;
  p.economy.contracts.active[c.vendor] = id;
  p.economy.contracts.progress[id] = c.objectives.map(() => 0);
  return true;
}

/** Drops the vendor's active contract and its progress. */
export function abandonContract(p: Profile, v: VendorId): boolean {
  const id = p.economy.contracts.active[v];
  if (!id) return false;
  delete p.economy.contracts.active[v];
  delete p.economy.contracts.progress[id];
  return true;
}

/** What happened in one raid, as contracts see it. Raid feeds it from its event bus. */
export class RaidLog {
  readonly harvested = new Map<string, number>();
  readonly killed = new Map<string, number>();
  readonly opened = new Map<string, number>();
  readonly visited = new Set<string>();
  readonly bosses = new Set<string>();
  readonly placed = new Set<string>();
  rivals = 0;
  constructor(readonly zone: string = DEFAULT_ZONE) {}
  private static bump(m: Map<string, number>, k: string, n = 1): void { m.set(k, (m.get(k) ?? 0) + n); }
  harvest(item: string): void { RaidLog.bump(this.harvested, item); }
  kill(type: string): void { RaidLog.bump(this.killed, type); }
  open(container: string): void { RaidLog.bump(this.opened, container); }
  visit(landmark: string): void { this.visited.add(landmark); }
  killBoss(boss: string): void { this.bosses.add(boss); }
  killRival(): void { this.rivals++; }
  place(item: string, landmark: string): void { this.placed.add(`${item}@${landmark}`); }
}

export interface ContractReport { id: string; title: string; progress: number[]; completed: boolean; reward?: Contract['reward']; overflow?: { item: string; count: number }[] }

/** How far one raid moves an objective (extractWith is handled by delivery). */
function raidCount(o: Objective, log: RaidLog, extracted: boolean): number {
  switch (o.type) {
    case 'harvest': return log.harvested.get(o.item!) ?? 0;
    case 'kill': return log.killed.get((o as { creature?: string }).creature ?? o.item ?? '') ?? 0;
    case 'open': return log.opened.get(o.container!) ?? 0;
    case 'visit': return log.visited.has(o.landmark!) ? 1 : 0;
    case 'killBoss': return log.bosses.has(o.boss!) ? 1 : 0;
    case 'killRival': return log.rivals;
    case 'surviveRaid': return extracted && (!o.zone || o.zone === log.zone) ? 1 : 0;
    case 'place': return log.placed.has(`${o.item}@${o.landmark}`) ? 1 : 0;
    default: return 0;
  }
}

/**
 * Settles active contracts at the end of a raid; call after `extract` (or `die`) so extracted items are in the
 * stash. On extraction raid progress is banked and `extractWith` items are handed over from the stash (then the
 * gut pouch). On death nothing counts unless the contract says `countsOnDeath`. Finished contracts pay out:
 * DNA, rep, items into the stash (what does not fit is reported as overflow), unlocks.
 */
export function settleContracts(p: Profile, log: RaidLog, extracted: boolean): ContractReport[] {
  const out: ContractReport[] = [];
  for (const [v, id] of Object.entries(p.economy.contracts.active) as [VendorId, string][]) {
    const c = contractById(id);
    if (!c) continue;
    const counts = extracted || (c as { countsOnDeath?: boolean }).countsOnDeath;
    const prog = p.economy.contracts.progress[id] ?? c.objectives.map(() => 0);
    if (counts) {
      c.objectives.forEach((o, i) => {
        const need = target(o) - prog[i];
        if (need <= 0) return;
        prog[i] += o.type === 'extractWith' ? (extracted ? deliver(p, o.item!, need) : 0) : Math.min(need, raidCount(o, log, extracted));
      });
    }
    p.economy.contracts.progress[id] = prog;
    const completed = c.objectives.every((o, i) => prog[i] >= target(o));
    const r: ContractReport = { id, title: c.title, progress: [...prog], completed };
    if (completed) {
      r.reward = c.reward;
      r.overflow = payOut(p, v, c);
      delete p.economy.contracts.active[v];
      delete p.economy.contracts.progress[id];
      p.economy.contracts.done.push(id);
    }
    if (counts || completed) out.push(r);
  }
  return out;
}

/** Hands over up to `n` of an item from the stash, then the gut pouch. Returns how many. */
function deliver(p: Profile, item: string, n: number): number {
  let left = n;
  for (const zone of ['stash', 'pouch'] as const) {
    const g = zoneGrid(p, zone);
    for (const e of [...g.entries]) {
      if (left <= 0 || e.item !== item) continue;
      const k = Math.min(left, e.count);
      e.count -= k; left -= k;
      if (e.count <= 0) g.take(e);
    }
    saveZone(p, zone, g);
  }
  return n - left;
}

function payOut(p: Profile, v: VendorId, c: Contract): { item: string; count: number }[] {
  p.dna += c.reward.dna;
  addRep(p, v, c.reward.rep);
  if (c.reward.unlock && !p.economy.unlocks.includes(c.reward.unlock)) p.economy.unlocks.push(c.reward.unlock);
  const g = stashGrid(p), overflow: { item: string; count: number }[] = [];
  for (const it of c.reward.items ?? []) {
    const left = g.add(it.item, it.count);
    if (left > 0) overflow.push({ item: it.item, count: left });
  }
  p.stash = g.snapshot();
  return overflow;
}

// ------------------------------------------------------------------ zones (raid select)
export type ZoneAccess = { state: 'open' } | { state: 'locked'; reason: string } | { state: 'coming'; reason: string };

/**
 * Whether raid select may deploy to a zone. `access` in zones.json is 'open', or alternatives joined by 'or':
 * 'contract <id>' (done, or its unlock 'zone:<id>' granted) and '<class> level N' (needs host levels; until the
 * profile tracks levels this alternative is never met). A zone from a later milestone is 'coming'.
 */
export function zoneAccess(p: Profile, id: string, hostLevel = 0): ZoneAccess {
  const z = ZONES[id];
  if (!z) return { state: 'coming', reason: 'unknown zone' };
  if (!reached(z.milestone) || !z.raidTime) return { state: 'coming', reason: `arrives in ${z.milestone[0].toUpperCase()}${z.milestone.slice(1)}` };
  if (z.access === 'open' || p.economy.unlocks.includes(`zone:${id}`)) return { state: 'open' };
  const reasons: string[] = [];
  for (const alt of z.access.split(/\s+or\s+/)) {
    const contract = alt.match(/contract\s+(\w+)/);
    if (contract) {
      if (p.economy.contracts.done.includes(contract[1])) return { state: 'open' };
      reasons.push(`finish ${contractById(contract[1])?.title ?? contract[1]}`);
      continue;
    }
    const level = alt.match(/level\s+(\d+)/);
    if (level) {
      if (hostLevel >= Number(level[1])) return { state: 'open' };
      reasons.push(alt.trim());
      continue;
    }
    reasons.push(alt.trim());
  }
  return { state: 'locked', reason: reasons.join(' or ') };
}

/** Every zone in roster order with its access. */
export function zoneList(p: Profile, hostLevel = 0): { id: string; label: string; access: ZoneAccess }[] {
  return Object.entries(ZONES).sort(([, a], [, b]) => a.order - b.order).map(([id, z]) => ({ id, label: z.label, access: zoneAccess(p, id, hostLevel) }));
}

/** Picks the raid-select zone. Returns false if it is not open. */
export function selectZone(p: Profile, id: string, hostLevel = 0): boolean {
  if (zoneAccess(p, id, hostLevel).state !== 'open') return false;
  p.economy.zone = id;
  return true;
}

// ------------------------------------------------------------------ helpers
function zoneGrid(p: Profile, zone: GridZone): ItemGrid {
  return zone === 'stash' ? stashGrid(p) : zone === 'pouch' ? pouchGrid(p) : cavityGrid(p);
}
function saveZone(p: Profile, zone: GridZone, g: ItemGrid): void {
  if (zone === 'stash') p.stash = g.snapshot();
  else if (zone === 'pouch') p.gutPouch = g.snapshot();
  else p.cavity = g.snapshot();
}
