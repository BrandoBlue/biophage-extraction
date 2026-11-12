import { describe, expect, it } from 'vitest';
import { MODS, WEAPONS, modFits, weaponSpec, type WeaponDef } from '../data';
import { applyMods, canFitMod, fitMod, removeMod, special } from '../src/game/mods';
import { STARTER_WEAPON, equipWeapon, unequipWeapon } from '../src/game/arsenal';
import { deploy, die, extract, loadProfile, memoryStorage, newProfile, saveProfile, stashGrid } from '../src/game/profile';

const give = (p: ReturnType<typeof newProfile>, item: string, n = 1) => { const g = stashGrid(p); g.add(item, n); p.stash = g.snapshot(); };
const modFor = (gun: string, slot?: string) => Object.keys(MODS).find((m) => modFits(MODS[m], WEAPONS[gun] as WeaponDef) && (!slot || MODS[m].slot === slot))!;

describe('applyMods', () => {
  it('multiplies and sets fields by dotted path and collects specials', () => {
    const base = weaponSpec('synapseBurster');
    for (const id of Object.keys(MODS)) {
      const m = MODS[id];
      const s = applyMods(base, [id]);
      expect(s.mods).toEqual([id]);
      for (const [path, k] of Object.entries(m.effects.mult ?? {})) {
        const get = (o: unknown) => path.split('.').reduce((a: unknown, key) => (a as Record<string, unknown> | null)?.[key], o);
        const before = get(base);
        if (typeof before !== 'number') continue;
        if (path === 'magazine') expect(s.magazine).toBe(Math.max(1, Math.round(before * k)));
        else if (!m.effects.set || !(path in m.effects.set)) expect(get(s)).toBeCloseTo(before * k);
      }
      for (const [path, v] of Object.entries(m.effects.set ?? {})) {
        expect(path.split('.').reduce((a: unknown, key) => (a as Record<string, unknown>)[key], s)).toEqual(v);
      }
      if (m.effects.special) expect(special(s, m.effects.special.id)).toBeDefined();
    }
    expect(base.mods).toEqual([]); // the base spec is untouched
    expect(base.noise.gunfire).toBe(1);
  });

  it('gives a gun without ADS a scope when a graft sets one', () => {
    const noAds = Object.keys(WEAPONS).find((id) => !weaponSpec(id).ads);
    const setter = Object.keys(MODS).find((id) => MODS[id].effects.set?.['ads.zoom'] !== undefined);
    if (!noAds || !setter) return;
    const s = applyMods(weaponSpec(noAds), [setter]);
    expect(s.ads?.zoom).toBe(MODS[setter].effects.set!['ads.zoom']);
  });
});

describe('grafting in the Hive', () => {
  it('fits from the stash, swaps a socket back, and refuses what does not fit', () => {
    const p = newProfile();
    const a = modFor(STARTER_WEAPON);
    expect(canFitMod(p, 0, a)).toBe('notInStash');
    give(p, a, 2);
    expect(fitMod(p, 0, a)).toBe('ok');
    expect(p.weaponMods[0]).toEqual([a]);
    expect(stashGrid(p).count(a)).toBe(1);
    expect(fitMod(p, 0, a)).toBe('ok'); // same socket: the old one goes back
    expect(p.weaponMods[0]).toEqual([a]);
    expect(stashGrid(p).count(a)).toBe(1);
    expect(fitMod(p, 1, a)).toBe('noWeapon');
    const misfit = Object.keys(MODS).find((m) => !modFits(MODS[m], WEAPONS[STARTER_WEAPON] as WeaponDef));
    if (misfit) { give(p, misfit); expect(fitMod(p, 0, misfit)).toBe('doesNotFit'); }
    expect(removeMod(p, 0, MODS[a].slot)).toBe(true);
    expect(stashGrid(p).count(a)).toBe(2);
    const kv = memoryStorage(); fitMod(p, 0, a); saveProfile(kv, p);
    expect(loadProfile(kv).profile.weaponMods[0]).toEqual([a]);
  });

  it('grafts ride into the raid, come home on extraction, are lost with the gun on death, and come off on unequip', () => {
    const other = Object.keys(WEAPONS).find((id) => id !== STARTER_WEAPON && modFor(id));
    if (!other) return;
    const p = newProfile();
    give(p, other); const m = modFor(other); give(p, m); const s = modFor(STARTER_WEAPON); give(p, s);
    expect(equipWeapon(p, 0, other)).toBe(true);
    expect(fitMod(p, 1, m)).toBe('ok');
    expect(fitMod(p, 0, s)).toBe('ok');
    const d = deploy(p);
    expect(d.weapons).toEqual([STARTER_WEAPON, other]);
    expect(d.mods).toEqual([[s], [m]]);
    extract(p, { cavity: [], pouch: [], dna: 0, weapons: d.weapons, mods: d.mods }, 0);
    expect(p.weaponSlots[0]).toBe(other);
    expect(p.weaponMods[1]).toEqual([m]);
    expect(unequipWeapon(p, 0)).toBe(true);
    expect(stashGrid(p).count(m)).toBe(1);
    expect(stashGrid(p).count(other)).toBe(1);
    expect(p.weaponMods[1]).toEqual([]);
    // Death: the equipped gun and its graft are gone, the starter keeps its own.
    equipWeapon(p, 0, other); fitMod(p, 1, m);
    deploy(p);
    die(p, { pouch: [] }, 0);
    expect(p.weaponSlots[0]).toBeNull();
    expect(p.weaponMods[1]).toEqual([]);
    expect(p.weaponMods[0]).toEqual([s]);
  });
});
