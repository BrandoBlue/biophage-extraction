/** Fixture profile and an in-memory HiveActions for the UI mocks and UI unit tests. */
import { PROFILE, stashRowCost } from '../data';
import { fits } from '../src/ui/hive/grid';
import { gridSize, itemsIn } from '../src/ui/hive/model';
import type { GridZone, HiveActions, ProfileView } from '../src/ui/hive/model';
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
  };
}
export { gridSize };
