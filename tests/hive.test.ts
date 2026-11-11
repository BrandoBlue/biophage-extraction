import { describe, expect, it } from 'vitest';
import { HIVE_ORGANS, RECIPES } from '../data';
import {
  canGrowOrgan, canStartRecipe, collectGarden, collectVat, gardenStored, growOrgan, hiveEffects, normaliseHive, organLevel,
  organLockedBy, startRecipe, vatRecipes, vatStatus,
} from '../src/game/hive';
import { loadProfile, memoryStorage, newProfile, saveProfile, stashGrid, type Profile } from '../src/game/profile';

const HOUR = 3600e3;
const give = (p: Profile, item: string, n: number) => { const g = stashGrid(p); g.add(item, n); p.stash = g.snapshot(); };
const count = (p: Profile, item: string) => stashGrid(p).count(item);
/** Gives exactly the next level's cost. */
function afford(p: Profile, id: string): void {
  const lvl = HIVE_ORGANS[id].levels[p.hive.organs[id] ?? 0];
  p.dna += lvl.cost.dna;
  for (const c of lvl.cost.items) give(p, c.item, c.count);
}

describe('Hive Body organs', () => {
  it('grow with DNA and stash items, level by level, to the top', () => {
    const p = newProfile();
    expect(canGrowOrgan(p, 'memoryCoral')).not.toBe('ok');
    afford(p, 'memoryCoral');
    const dna = p.dna;
    const cost = HIVE_ORGANS.memoryCoral.levels[0].cost;
    expect(growOrgan(p, 'memoryCoral')).toBe(true);
    expect(organLevel(p, 'memoryCoral')).toBe(1);
    expect(p.dna).toBe(dna - cost.dna);
    for (const c of cost.items) expect(count(p, c.item)).toBe(0);
    expect(hiveEffects(p)).toMatchObject(HIVE_ORGANS.memoryCoral.levels[0].effect!);
    for (let l = 1; l < HIVE_ORGANS.memoryCoral.levels.length; l++) { afford(p, 'memoryCoral'); expect(growOrgan(p, 'memoryCoral')).toBe(true); }
    expect(canGrowOrgan(p, 'memoryCoral')).toBe('max');
  });

  it('refuses without DNA or items, changing nothing', () => {
    const p = newProfile();
    p.dna = 0;
    expect(canGrowOrgan(p, 'sporeGarden')).toBe('dna');
    p.dna = 1e6;
    expect(canGrowOrgan(p, 'sporeGarden')).toBe('items');
    expect(growOrgan(p, 'sporeGarden')).toBe(false);
    expect(p.dna).toBe(1e6);
  });

  it('keeps the Gestation Vat locked until Heart of the Brood unlocks it; Host organs are coming', () => {
    const p = newProfile();
    afford(p, 'gestationVat');
    expect(canGrowOrgan(p, 'gestationVat')).toBe('locked');
    expect(organLockedBy(p, 'gestationVat')).toBe('heartOfTheBrood');
    p.economy.unlocks.push('gestationVat');
    expect(growOrgan(p, 'gestationVat')).toBe(true);
    expect(canGrowOrgan(p, 'antibodyWell')).toBe('coming');
  });
});

describe('Spore Garden', () => {
  it('fruits DNA per hour up to its cap and banks it on collection', () => {
    const p = newProfile();
    afford(p, 'sporeGarden');
    const t0 = 1_000_000;
    growOrgan(p, 'sporeGarden', t0);
    const lvl = HIVE_ORGANS.sporeGarden.levels[0];
    expect(gardenStored(p, t0 + 2 * HOUR)).toBe(2 * lvl.dnaPerHour!);
    expect(gardenStored(p, t0 + 1000 * HOUR)).toBe(lvl.cap);
    const dna = p.dna;
    expect(collectGarden(p, t0 + 2 * HOUR)).toBe(2 * lvl.dnaPerHour!);
    expect(p.dna).toBe(dna + 2 * lvl.dnaPerHour!);
    expect(gardenStored(p, t0 + 2 * HOUR)).toBe(0);
  });
});

describe('Gestation Vat', () => {
  function vatProfile(): Profile {
    const p = newProfile();
    p.economy.unlocks.push('gestationVat');
    afford(p, 'gestationVat');
    growOrgan(p, 'gestationVat');
    return p;
  }

  it('grows a recipe from stash inputs over real time, one job at a time', () => {
    const p = vatProfile();
    const id = vatRecipes(p)[0], r = RECIPES[id];
    expect(canStartRecipe(p, id)).toBe('items');
    for (const c of r.inputs) give(p, c.item, c.count * 2);
    const t0 = 5_000_000;
    expect(startRecipe(p, id, t0)).toBe(true);
    for (const c of r.inputs) expect(count(p, c.item)).toBe(c.count);
    expect(canStartRecipe(p, id)).toBe('busy');
    expect(vatStatus(p, t0)!.ready).toBe(false);
    expect(collectVat(p, t0 + 1000)).toBeNull();
    const before = count(p, r.output.item!);
    expect(collectVat(p, t0 + r.time * 1000)).toEqual({ item: r.output.item, count: r.output.count });
    expect(count(p, r.output.item!)).toBe(before + r.output.count);
    expect(vatStatus(p)).toBeNull();
  });

  it('only knows the recipes of its level', () => {
    const p = vatProfile();
    const later = HIVE_ORGANS.gestationVat.levels.at(-1)!.recipes!.find((r) => !vatRecipes(p).includes(r))!;
    expect(canStartRecipe(p, later)).toBe('unknown');
    expect(canStartRecipe(newProfile(), vatRecipes(p)[0])).toBe('no-vat');
  });
});

describe('Hive save data', () => {
  it('round-trips and repairs junk', () => {
    const kv = memoryStorage();
    const p = newProfile();
    afford(p, 'sporeGarden');
    growOrgan(p, 'sporeGarden', 42);
    saveProfile(kv, p);
    expect(loadProfile(kv).profile.hive).toEqual(p.hive);
    const fixed = normaliseHive({ organs: { sporeGarden: 99, nothing: 2 } as never, gardenSince: -5, vat: { recipe: 'nope', readyAt: 1 } });
    expect(fixed.organs).toEqual({ sporeGarden: HIVE_ORGANS.sporeGarden.levels.length });
    expect(fixed.gardenSince).toBe(0);
    expect(fixed.vat).toBeNull();
  });
});
