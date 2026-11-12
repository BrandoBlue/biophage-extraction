// The WEAPONS tab's numbers and its view over a real Profile (src/ui/hive/arsenal.ts, arsenal-view.ts).
import { describe, expect, it } from 'vitest';
import { MODS, weaponSpec } from '../data';
import { STARTER_WEAPON, equipWeapon, weaponSlots } from '../src/game/arsenal';
import { applyMods, fitMod } from '../src/game/mods';
import { newProfile, stashGrid } from '../src/game/profile';
import { slotName, specDps, statLines } from '../src/ui/hive/arsenal';
import { arsenalView } from '../src/ui/hive/arsenal-view';
import { fixtureArsenal } from '../mocks/fixtures';

const stock = (ids: string[]) => {
  const p = newProfile();
  const g = stashGrid(p);
  for (const id of ids) g.add(id, 1);
  p.stash = g.snapshot();
  return p;
};

describe('weapon numbers', () => {
  it('per second follows the fire mode', () => {
    const auto = weaponSpec(STARTER_WEAPON);
    expect(auto.fireMode).toBe('auto');
    expect(specDps(auto)).toBeCloseTo((auto.damage * auto.pellets + (auto.projectile.splash?.damage ?? 0)) * auto.fireRate, 5);
    const burst = weaponSpec('cicadine');
    expect(burst.fireMode).toBe('burst');
    expect(specDps(burst)).toBeGreaterThan(0);
    expect(specDps(burst)).toBeLessThan(burst.damage * burst.pellets * burst.fireRate + 1e-9);
  });

  it('stat lines show a graft against the bare gun, and which way is good', () => {
    const base = weaponSpec('cicadine');
    const lines = statLines(applyMods(base, ['stalkEye']), base);
    const zoom = lines.find((l) => l.key === 'zoom')!;
    expect(zoom.delta).toBeGreaterThan(0);
    expect(zoom.better).toBe(true);
    expect(lines.find((l) => l.key === 'reload')!.better).toBe(false);
    for (const l of statLines(base)) expect(l.delta).toBe(0);
  });

  it('names slots in plain words', () => {
    expect(slotName(0)).toBe('Innate');
    expect(slotName(1)).toBe('Slot I');
  });
});

describe('arsenal view', () => {
  it('a new host carries only the starter, with empty slots', () => {
    const v = arsenalView(newProfile());
    expect(v.slots).toHaveLength(1 + weaponSlots());
    expect(v.slots[0]).toMatchObject({ weapon: STARTER_WEAPON, starter: true });
    expect(v.slots.slice(1).every((s) => s.weapon === null && s.spec === null)).toBe(true);
    expect(v.armoury.length).toBeGreaterThan(0);
  });

  it('a gun in the stash can be equipped, then shows in its slot with its sockets', () => {
    const p = stock(['quillet', 'stalkEye']);
    let v = arsenalView(p);
    expect(v.guns.map((g) => g.id)).toContain('quillet');
    expect(equipWeapon(p, 0, 'quillet')).toBe(true);
    v = arsenalView(p);
    expect(v.guns.map((g) => g.id)).not.toContain('quillet');
    expect(v.slots[1].weapon).toBe('quillet');
    expect(v.slots[1].sockets.length).toBeGreaterThan(0);
  });

  it('a graft lists the slots it fits, and a fitted graft changes the spec', () => {
    const p = stock(['cicadine', 'stalkEye']);
    equipWeapon(p, 0, 'cicadine');
    const eye = arsenalView(p).mods.find((m) => m.id === 'stalkEye')!;
    expect(eye.socket).toBe(MODS.stalkEye.slot);
    expect(eye.fits).toContain(1);
    expect(fitMod(p, 1, 'stalkEye')).toBe('ok');
    const s = arsenalView(p).slots[1];
    expect(s.sockets.find((k) => k.socket === MODS.stalkEye.slot)!.mod).toBe('stalkEye');
    expect(s.spec!.ads?.zoom).not.toBe(s.base!.ads?.zoom);
  });

  it('the Armoury opens with class level and knows what you can afford', () => {
    const p = newProfile();
    p.classXp = { [p.host]: 1e6 };
    p.dna = 0;
    const own = arsenalView(p).armoury.filter((a) => a.cls === p.host);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((a) => a.unlocked && !a.affordable)).toBe(true);
  });

  it('the mock fixture is a valid loadout', () => {
    const v = arsenalView(fixtureArsenal());
    expect(v.slots[1].weapon).toBe('cicadine');
    expect(v.armoury.some((a) => a.unlocked)).toBe(true);
  });
});
