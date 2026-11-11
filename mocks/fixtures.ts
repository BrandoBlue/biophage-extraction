/** Fixture profile and an in-memory HiveActions for the UI mocks and UI unit tests. */
import { CONTRACTS, MARKET, PROFILE, stashRowCost, VENDOR_REP_THRESHOLDS, VENDORS, vendorBuyPrice, vendorRepLevel, ZONES } from '../data';
import { def as itemOf } from '../src/ui/items';
import { fits } from '../src/ui/hive/grid';
import { gridSize, itemsIn } from '../src/ui/hive/model';
import type { GridZone, HiveActions, ProfileView, VendorView } from '../src/ui/hive/model';
import { objectiveText } from '../src/ui/hive/vendors';
import { source } from '../src/ui/hive/stash';

export function fixtureProfile(): ProfileView {
  return {
    callsign: 'HOST-7F3A',
    dna: 1240,
    host: 'neuroInfiltrator',
    stashRows: 6,
    stash: [
      { item: 'glitchingHeart', count: 1, x: 0, y: 0, rotated: false },
      { item: 'mournbackMarrow', count: 1, x: 2, y: 0, rotated: false },
      { item: 'plagueStalkerStrain', count: 1, x: 4, y: 0, rotated: false },
      { item: 'adrenalineVirus', count: 1, x: 5, y: 0, rotated: false },
      { item: 'splicedParasites', count: 1, x: 6, y: 0, rotated: false },
      { item: 'mutagenVial', count: 1, x: 7, y: 0, rotated: false },
      { item: 'synapseLens', count: 1, x: 8, y: 0, rotated: false },
      { item: 'clotGel', count: 3, x: 8, y: 1, rotated: false },
      { item: 'needlemawGland', count: 4, x: 9, y: 1, rotated: false },
      { item: 'cantorSongSac', count: 1, x: 0, y: 2, rotated: false },
      { item: 'oculimothEye', count: 2, x: 2, y: 2, rotated: false },
      { item: 'glasswalkerLens', count: 1, x: 3, y: 2, rotated: false },
      { item: 'broodHeartSeed', count: 1, x: 4, y: 3, rotated: false },
      { item: 'needlemawGland', count: 2, x: 0, y: 3, rotated: false },
    ],
    cavity: [
      { item: 'clotGel', count: 2, x: 0, y: 0, rotated: false },
      { item: 'adrenalineVirus', count: 1, x: 1, y: 0, rotated: false },
      { item: 'synapseLens', count: 1, x: 2, y: 0, rotated: false },
    ],
    gutPouch: [{ item: 'dnaStrand', count: 4, x: 0, y: 0, rotated: false }],
    gutPouchLevel: 0,
    stats: { raids: 14, extracts: 9, deaths: 5, kills: 63 },
    last: { result: 'extracted', value: 640 },
  };
}

/** Simple rules good enough for look review; Gameplay's profile.ts is the real authority. */
export function fixtureActions(p: ProfileView, deploy: () => void = () => {}): HiveActions {
  const bought = () => p.stashRows - PROFILE.stash.rowsBase;
  return {
    move(from: GridZone, index: number, to: GridZone, x: number, y: number, rotated: boolean) {
      const list = itemsIn(from, p);
      const pl = list[index];
      if (!pl) return false;
      const dst = source(to, p);
      const f = fits(dst, pl.item, x, y, rotated, from === to ? index : -1);
      if (f === 'blocked') return false;
      list.splice(index, 1);
      if (f === 'stack') {
        const t = itemsIn(to, p).find((o) => o.item === pl.item && x >= o.x && y >= o.y);
        if (t) { t.count += pl.count; return true; }
      }
      itemsIn(to, p).push({ ...pl, x, y, rotated });
      return true;
    },
    stashRowCost: () => (p.stashRows >= PROFILE.stash.rowExpansion.maxRows ? null : stashRowCost(bought())),
    expandStash() {
      const c = stashRowCost(bought());
      if (p.dna < c || p.stashRows >= PROFILE.stash.rowExpansion.maxRows) return false;
      p.dna -= c; p.stashRows++; return true;
    },
    pouchUpgrade: () => {
      const u = PROFILE.gutPouch.upgrades[p.gutPouchLevel];
      return u ? { cost: u.cost, size: u.size as [number, number] } : null;
    },
    upgradePouch() {
      const u = PROFILE.gutPouch.upgrades[p.gutPouchLevel];
      if (!u || p.dna < u.cost) return false;
      p.dna -= u.cost; p.gutPouchLevel++; return true;
    },
    deploy,
    market: () => ({
      mood: 1,
      rotatesIn: 9 * 3600 + 22 * 60,
      sellPrice: (item) => Math.floor((itemOf(item)?.value ?? 0) * MARKET.buyRate),
      stock: ['clotGel', 'mutagenVial', 'plagueStalkerStrain', 'neuroSpikeGrenade', 'mawSeedMine', 'heartHusk'].map((item, i) => ({
        item, price: MARKET.catalogue.find((c) => c.item === item)!.price, state: i === 5 ? 'dna' as const : 'ok' as const })),
    }),
    sell(zone, index, count) {
      const list = itemsIn(zone, p), st = list[index];
      if (!st) return 0;
      const n = Math.min(count, st.count), paid = n * Math.floor((itemOf(st.item)?.value ?? 0) * MARKET.buyRate);
      st.count -= n; if (st.count <= 0) list.splice(index, 1);
      p.dna += paid; return paid;
    },
    buy: () => false,
    vendors: () => (['motherClot', 'archivist'] as const).map((id, k): VendorView => {
      const v = VENDORS[id], points = k === 0 ? 140 : 40, level = vendorRepLevel(points), T = VENDOR_REP_THRESHOLDS;
      const chain = CONTRACTS.filter((c) => c.vendor === id && c.milestone === 'larva');
      return {
        id, label: v.label, role: v.role, brief: v.brief ?? '',
        rep: { level, points, floor: T[level - 1], next: T[level] ?? null },
        unlocks: Object.entries(v.unlocks).map(([r, text]) => ({ rep: Number(r), text, earned: level >= Number(r) })),
        stock: (v.stock ?? []).map((s) => ({ ...s, state: s.rep > level ? 'rep' as const : s.price > p.dna ? 'dna' as const : 'ok' as const })),
        sellPrice: (item) => vendorBuyPrice(id, item),
        contracts: chain.map((c, i) => ({
          id: c.id, title: c.title, brief: c.brief,
          state: k === 0 ? (i === 0 ? 'done' : i === 1 ? 'active' : 'locked') : (i === 0 ? 'available' : 'locked'),
          objectives: c.objectives.map((o) => ({ text: objectiveText(o), done: k === 0 && i === 1 ? 1 : 0, need: o.count ?? 1 })),
          reward: { dna: c.reward.dna, rep: c.reward.rep, items: c.reward.items ?? [], unlock: c.reward.unlock },
          requires: (c.requires ?? []).map((r) => CONTRACTS.find((x) => x.id === r)?.title ?? r),
        })),
      };
    }),
    zones: () => Object.entries(ZONES).map(([id, z]) => ({ id, label: z.label,
      access: z.access === 'open' ? { state: 'open' as const } : z.milestone === 'larva' ? { state: 'locked' as const, reason: 'finish Signal in the Wreck' } : { state: 'coming' as const, reason: `arrives in ${z.milestone}` } })),
    selectZone: (id) => { p.zone = id; return true; },
  };
}
export { gridSize };
