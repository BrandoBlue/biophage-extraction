import { describe, expect, it } from 'vitest';
import { CLASSES, LOOT, VIRUSES } from '../data';
import { DRAWN_ITEMS, itemIcon } from '../src/ui/icons';
import { ALL_COLOURS } from '../src/render/palette';
import { hostPortrait } from '../src/ui/hosts';
import { classTraits, raidPlan } from '../src/ui/hive/screens';
import { firstFit, fits, virusText } from '../src/ui/hive/grid';
import { gridSize, usage } from '../src/ui/hive/model';
import { getSettings, DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/ui/settings';
import { fixtureActions, fixtureProfile } from '../mocks/fixtures';
import { source } from '../src/ui/hive/stash';

describe('item icons', () => {
  it('gives every item in loot.json an icon, hand-drawn for every Larva and Host item so far', () => {
    for (const id of Object.keys(LOOT.items)) expect(itemIcon(id), id).toMatch(/^<svg class="icon"/);
    const drawnSoFar = ['clotGel', 'dnaStrand', 'mutagenVial', 'plagueStalkerStrain', 'synapseLens', 'glitchingHeart', 'needlemawGland', 'cantorSongSac',
      'glasswalkerLens', 'oculimothEye', 'mournbackMarrow', 'broodHeartSeed', 'adrenalineVirus', 'splicedParasites', 'weaverGanglion', 'mimicLure', 'lanternGland'];
    for (const id of drawnSoFar) expect(DRAWN_ITEMS, id).toContain(id);
  });
  it('sizes the viewBox to the footprint and swaps it when rotated', () => {
    const [w, h] = LOOT.items.glitchingHeart.size;
    expect(itemIcon('glitchingHeart')).toContain(`viewBox="0 0 ${w * 64} ${h * 64}"`);
    const [vw, vh] = LOOT.items.synapseLens.size;
    expect(itemIcon('synapseLens', true)).toContain(`viewBox="0 0 ${vh * 64} ${vw * 64}"`);
  });
  it('uses only palette colours', () => {
    const svg = Object.keys(LOOT.items).map((i) => itemIcon(i)).join('') + hostPortrait('neuroInfiltrator') + hostPortrait('goreBehemoth') + hostPortrait('venomWraith');
    const hexes = new Set(svg.match(/#[0-9A-Fa-f]{6}\b/g));
    for (const h of hexes) expect(Object.values(ALL_COLOURS), h).toContain(h);
  });
});

describe('host select copy', () => {
  it('words buffs and negatives from classes.json against the Infiltrator', () => {
    const w = classTraits('venomWraith');
    const pct = Math.round((CLASSES.venomWraith.moveSpeed / CLASSES.neuroInfiltrator.moveSpeed - 1) * 100);
    expect(w.buffs.map((b) => b[1])).toContain(`+${pct}% Movement Speed`);
    expect(w.negatives.some((n) => n[1].includes('Vulnerability'))).toBe(true);
    const b = classTraits('goreBehemoth');
    expect(b.negatives.some((n) => n[1].includes('Movement Speed'))).toBe(true);
    expect(b.buffs.some((n) => n[1].includes('Max Biomass'))).toBe(true);
    expect(classTraits('neuroInfiltrator').negatives.some((n) => n[1].includes('Mutagen'))).toBe(true);
  });
});

describe('raid select', () => {
  it('summarises the Larva roster and threat from raid.json', () => {
    const p = raidPlan();
    expect(p.pods).toBe(3);
    expect(p.nests).toBe(1);
    expect(p.hostiles.map((h) => h.type)).toEqual(expect.arrayContaining(['needlemaw', 'bilecantor', 'glasswalker', 'oculimoth', 'mournback']));
    expect(p.threat).toBeGreaterThanOrEqual(1);
    expect(p.threat).toBeLessThanOrEqual(5);
  });
});

describe('grid preview', () => {
  const p = fixtureProfile();
  it('matches grid sizes to data', () => {
    expect(gridSize('cavity', p)).toEqual(CLASSES.neuroInfiltrator.cavityGrid);
    expect(gridSize('stash', p)).toEqual([10, 6]);
    expect(usage('cavity', p)[1]).toBe(20);
  });
  it('blocks overlaps and the edge, allows stacking onto a non-full stack', () => {
    const s = source('stash', p);
    expect(fits(s, 'clotGel', 0, 0, false)).toBe('blocked');
    expect(fits(s, 'glitchingHeart', 9, 5, false)).toBe('blocked');
    expect(fits(s, 'needlemawGland', 0, 3, false)).toBe('stack');
    expect(fits(s, 'clotGel', 9, 5, false)).toBe('fit');
  });
  it('finds space and moves items through the actions', () => {
    const q = fixtureProfile();
    const a = fixtureActions(q);
    const t = firstFit(source('cavity', q), 'glitchingHeart');
    expect(t).not.toBeNull();
    const i = q.stash.findIndex((s) => s.item === 'glitchingHeart');
    expect(a.move('stash', i, 'cavity', t!.x, t!.y, t!.rotated)).toBe(true);
    expect(q.cavity.some((s) => s.item === 'glitchingHeart')).toBe(true);
  });
});

describe('virus text', () => {
  it('describes gain and cost for each virus', () => {
    for (const v of Object.values(VIRUSES)) {
      const t = virusText(v.item)!;
      expect(t.gain.length, v.item).toBeGreaterThan(5);
      expect(t.cost.length, v.item).toBeGreaterThan(5);
    }
  });
});

describe('settings', () => {
  it('clamps stored values and survives junk', () => {
    const store = (v: string | null) => ({ getItem: (k: string) => (k === SETTINGS_KEY ? v : null) });
    expect(getSettings(store(null))).toEqual(DEFAULT_SETTINGS);
    expect(getSettings(store('{bad'))).toEqual(DEFAULT_SETTINGS);
    const s = getSettings(store(JSON.stringify({ fov: 400, sensitivity: -2, volume: 'x' })));
    expect(s.fov).toBe(100);
    expect(s.sensitivity).toBe(0.2);
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
  });
});
