import { describe, expect, it } from 'vitest';
import { HIVE_ORGANS, RECIPES } from '../data';
import { describeLevel } from '../src/ui/hive/body';
import { newProfile } from '../src/game/profile';
import { growOrgan } from '../src/game/hive';
import { fixtureActions, fixtureProfile } from '../mocks/fixtures';

describe('Hive Body screen text', () => {
  it('describes every organ level in plain words, never raw keys', () => {
    for (const [id, o] of Object.entries(HIVE_ORGANS)) {
      for (const l of o.levels) {
        const lines = describeLevel(l);
        expect(lines.length, id).toBeGreaterThan(0);
        for (const t of lines) expect(t, id).not.toMatch(/[a-z][A-Z]/);
      }
    }
  });

  it('names what the vat grows, including pooled strains', () => {
    const all = describeLevel({ cost: { dna: 0, items: [] }, recipes: Object.keys(RECIPES) }).join(' ');
    expect(all).toMatch(/Clot Gel/);
    expect(all).toMatch(/random strain/);
  });

  it('describes nothing for an organ not grown', () => {
    expect(describeLevel(null)).toEqual([]);
  });

  it('the fixture Hive Body covers every organ with a cost or a max state', () => {
    const v = fixtureActions(fixtureProfile()).hiveBody!();
    expect(v.organs.map((o) => o.id).sort()).toEqual(Object.keys(HIVE_ORGANS).sort());
    for (const o of v.organs) expect(o.next !== null || o.state === 'max').toBe(true);
  });

  it('the live Hive logic the screen calls is there (grow needs DNA and items)', () => {
    const p = newProfile();
    p.dna = 0;
    expect(growOrgan(p, 'sporeGarden')).toBe(false);
  });
});
