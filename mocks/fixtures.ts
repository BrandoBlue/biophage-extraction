/** Fixture profile and an in-memory HiveActions for the UI mocks and UI unit tests. */
import { CONTRACTS, HIVE_ORGANS, MARKET, PROFILE, RECIPES, stashRowCost, VENDOR_REP_THRESHOLDS, VENDORS, vendorBuyPrice, vendorRepLevel, ZONES } from '../data';
import { def as itemOf } from '../src/ui/items';
import { fits } from '../src/ui/hive/grid';
import { gridSize, itemsIn } from '../src/ui/hive/model';
import type { GridZone, HiveActions, HiveBodyView, ProfileView, VendorView } from '../src/ui/hive/model';
import { describeLevel } from '../src/ui/hive/body';
import { objectiveText } from '../src/ui/hive/vendors';
import { source } from '../src/ui/hive/stash';
import { arsenalView } from '../src/ui/hive/arsenal-view';
import { equipWeapon, unequipWeapon } from '../src/game/arsenal';
import { fitMod, removeMod } from '../src/game/mods';
import { growWeapon } from '../src/game/progression';
import { newProfile, stashGrid, type Profile } from '../src/game/profile';

/**
 * A real Profile for the WEAPONS tab (Gameplay's rules run on it): a Cicadine in slot I with a Stalk Eye, a few guns
 * and grafts in the stash, and enough class XP that the first signature guns are open in the Armoury.
 */
export function fixtureArsenal(): Profile {
  const p = newProfile();
  p.dna = 1240;
  const g = stashGrid(p);
  for (const [id, n] of [['cicadine', 1], ['quillet', 1], ['gulletScatter', 1], ['stalkEye', 1], ['acidStrain', 1], ['lampreyMouth', 1], ['tendonBrace', 1], ['quickGullet', 1]] as const) g.add(id, n);
  p.stash = g.snapshot();
  p.classXp = { neuroInfiltrator: 5200, goreBehemoth: 1700 };
  equipWeapon(p, 0, 'cicadine');
  fitMod(p, 1, 'stalkEye');
  fitMod(p, 0, 'lampreyMouth');
  return p;
}

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
  const ap = fixtureArsenal();
  return {
    arsenal: () => arsenalView(ap),
    equipWeapon: (slot, w) => equipWeapon(ap, slot - 1, w),
    unequipWeapon: (slot) => unequipWeapon(ap, slot - 1),
    fitMod: (slot, mod) => fitMod(ap, slot, mod),
    removeMod: (slot, socket) => removeMod(ap, slot, socket as never),
    growWeapon: (w) => growWeapon(ap, w),
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
    // Hive Body fixture: the vat at I with a job nearly done, the garden at II half full, Memory Coral ready to grow,
    // the Antibody Well still to come.
    hiveBody: (): HiveBodyView => {
      const have = (item: string) => p.stash.filter((s) => s.item === item).reduce((n, s) => n + s.count, 0);
      const line = (c: { item: string; count: number }) => ({ ...c, have: have(c.item) });
      const lv = { gestationVat: 1, sporeGarden: 2, memoryCoral: 0, antibodyWell: 0 } as Record<string, number>;
      const st = { gestationVat: 'items', sporeGarden: 'dna', memoryCoral: 'ok', antibodyWell: 'coming' } as const;
      return {
        organs: Object.entries(HIVE_ORGANS).map(([id, o]) => {
          const next = o.levels[lv[id] ?? 0];
          return { id, label: o.label, brief: o.brief, level: lv[id] ?? 0, max: o.levels.length, now: describeLevel(o.levels[(lv[id] ?? 0) - 1]),
            next: next ? { dna: next.cost.dna, items: next.cost.items.map(line), adds: describeLevel(next) } : null, state: st[id as keyof typeof st] ?? 'ok' };
        }),
        garden: { stored: 212, cap: 360, perHour: 45 },
        vat: {
          recipes: HIVE_ORGANS.gestationVat.levels[0].recipes!.map((r, i) => ({ id: r, inputs: RECIPES[r].inputs.map(line), output: RECIPES[r].output, time: RECIPES[r].time, state: i ? 'items' as const : 'busy' as const })),
          job: { recipe: 'clotGelFromGlands', secondsLeft: 140, total: RECIPES.clotGelFromGlands.time, ready: false },
        },
      };
    },
    growOrgan: () => true,
    collectGarden: () => 212,
    startRecipe: () => true,
    collectVat: () => ({ item: 'clotGel', count: 1 }),
  };
}
export { gridSize };
