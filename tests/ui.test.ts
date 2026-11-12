import { describe, expect, it } from 'vitest';
import { CLASSES, CONTRACTS, LOOT, VIRUSES, ZONES } from '../data';
import { objectiveText } from '../src/ui/hive/vendors';
import { DRAWN_ITEMS, itemIcon } from '../src/ui/icons';
import { ALL_COLOURS } from '../src/render/palette';
import { hostPortrait } from '../src/ui/hosts';
import { GRAPHICS_WORDS, NAV, sag } from '../src/ui/hive/kit';
import { GRAPHICS_LEVELS } from '../src/ui/settings';
import { classTraits, LENS, LIVE_ZONE, plainLock, rim, raidPlan, zoneAccess, zoneRoster } from '../src/ui/hive/screens';
import { zoneExtracts, zoneMap } from '../src/ui/hive/zonemap';
import { BUILT_ZONES } from '../src/world/zones';
import { firstFit, fits, virusText } from '../src/ui/hive/grid';
import { gridSize, usage } from '../src/ui/hive/model';
import { getSettings, DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/ui/settings';
import { fixtureActions, fixtureProfile } from '../mocks/fixtures';
import { source } from '../src/ui/hive/stash';
import { HiveStage, STAGE } from '../src/ui/hive-stage';
import type { Pipeline } from '../src/render/pipeline';

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


describe('podLayout (TAB overlay pod grid)', async () => {
  const { podLayout } = await import('../src/ui/raid-hud');
  it('keeps one entry per pod stack, in order, without overlaps', () => {
    const items = [{ item: 'glitchingHeart', count: 1 }, { item: 'clotGel', count: 4 }, { item: 'mutagenVial', count: 1 }, { item: 'lanternGland', count: 1 }, { item: 'broodHeartSeed', count: 1 }];
    const lay = podLayout(items);
    expect(lay.items.map((i) => i.item)).toEqual(items.map((i) => i.item));
    expect(lay.size[1]).toBeGreaterThanOrEqual(3);
    for (const a of lay.items) for (const b of lay.items) {
      if (a === b) continue;
      expect(fits({ zone: 'pod', label: '', size: lay.size, items: [b] }, a.item, a.x, a.y, a.rotated)).not.toBe('blocked');
    }
  });
});

describe('Hive stage', () => {
  it('draws only while active, and at most every STAGE.testFrameMs in automated runs', () => {
    const st = new HiveStage({} as Pipeline);
    expect(st.due(0, false)).toBe(false);
    st.active = true;
    expect(st.due(0, false)).toBe(true);
    expect(st.due(1, false)).toBe(true);
    expect(st.due(10, true)).toBe(false);
    expect(st.due(1 + STAGE.testFrameMs, true)).toBe(true);
  });
  it('stays off until the host is ready, and in automated runs until the menu has settled', () => {
    const st = new HiveStage({} as Pipeline);
    expect(st.set(true, 'neuroInfiltrator', 1.6, 0, true)).toBe(false);
    expect(st.set(true, 'neuroInfiltrator', 1.6, STAGE.testSettleMs - 1, true)).toBe(false);
    expect(st.set(false, 'neuroInfiltrator', 1.6, STAGE.testSettleMs, true)).toBe(false);
    expect(st.active).toBe(false);
  });
});

describe('Zone roster', () => {
  it('lists every zone in travel order with the live zone open and the rest saying what opens them', () => {
    const r = zoneRoster();
    expect(r.map((z) => z.order)).toEqual([...r.map((z) => z.order)].sort((a, b) => a - b));
    expect(r.find((z) => z.id === LIVE_ZONE)?.open).toBe(true);
    for (const z of r.filter((x) => !x.open)) expect(z.access).not.toBe('OPEN');
    expect(zoneAccess('contract signalInTheWreck (Archivist)')).toMatch(/^UNLOCKS WHEN YOU FINISH THE CONTRACT /);
    expect(zoneAccess('open')).toBe('OPEN');
  });
  it('says why a zone is shut in plain words, never a milestone name', () => {
    expect(plainLock('host level 4 or finish Lights in the Fen')).toBe('Unlocks at host level 4 or when you finish the contract Lights in the Fen');
    expect(plainLock('arrives in Apex')).toMatch(/later update/);
    expect(plainLock('its map is still growing')).toMatch(/still being built/);
    for (const [id, z] of Object.entries(ZONES)) expect(zoneAccess(z.access), id).not.toMatch(/APEX|HOST MILESTONE|LARVA|SPORE/);
  });
});

describe('Raid select map per zone', () => {
  it('draws every built zone from its own layout: its own drop point and extracts, inside the disc', () => {
    for (const id of BUILT_ZONES) {
      const m = zoneMap(id);
      expect(m.shape, id).not.toBe('uncharted');
      const drop = m.marks.filter((x) => x.kind === 'drop');
      expect(drop, id).toHaveLength(1);
      expect(m.marks.filter((x) => x.kind === 'extract').length, id).toBeGreaterThan(0);
      for (const x of m.marks) expect(Math.hypot(x.x, x.z), `${id} ${x.kind} ${x.label}`).toBeLessThanOrEqual(m.radius * 1.01);
    }
    // Different zones, different maps.
    const drops = BUILT_ZONES.map((id) => JSON.stringify(zoneMap(id).marks.find((x) => x.kind === 'drop')));
    expect(new Set(drops).size).toBe(BUILT_ZONES.length);
    expect(zoneMap('hollowChoir').shape).toBe('uncharted');
    expect(zoneExtracts('ochreReach').count).toBe(3);
  });
});

describe('Observation lens menu', () => {
  it('hangs the places and the log from the lens rim, inside a 16:9 screen', () => {
    for (const side of ['left', 'right'] as const) for (let d = -45; d <= 60; d += 5) {
      const p = rim(d, side);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(LENS.r);
      expect(Math.sign(p.x)).toBe(side === 'left' ? -1 : 1);
    }
    // Every anchor stays clear of the header (top 7u) and the key hints (bottom 3u) with the lens centred 1.2u low.
    for (const d of [...LENS.left, ...LENS.right, LENS.loadout, LENS.release]) {
      const y = 28.125 + 1.2 + rim(d, 'right', 5.5).y;
      expect(y).toBeGreaterThan(7);
      expect(y).toBeLessThan(56.25 - 3);
    }
  });
  it('hangs the nav on a symmetric vein and never names a milestone on a shut tab', () => {
    expect(sag(0, 9)).toBe(1); expect(sag(8, 9)).toBe(1); expect(sag(4, 9)).toBe(0); expect(sag(2, 9)).toBeCloseTo(sag(6, 9));
    for (const n of NAV) if (n.locked) expect(n.locked).not.toMatch(/SPORE|LARVA|HOST|HIVE|APEX/);
  });
});

describe('Contract objectives', () => {
  it('reads every contracts.json objective as a plain sentence', () => {
    for (const c of CONTRACTS) for (const o of c.objectives) {
      const t = objectiveText(o);
      expect(t.length, `${c.id}/${o.type}`).toBeGreaterThan(6);
      expect(t, `${c.id}/${o.type}`).not.toMatch(/undefined|NaN/);
      expect(t).not.toBe(o.type);
    }
  });
});

describe('membrane HUD and Hive kit', () => {
  it('bearing tape puts what is ahead at 0, right positive, behind at 180', async () => {
    const { relBearing } = await import('../src/ui/raid/hud');
    // yaw 0 looks down -Z; right is +X.
    expect(relBearing(0, 0, 0, -10, 0)).toBeCloseTo(0);
    expect(relBearing(0, 0, 10, 0, 0)).toBeCloseTo(90);
    expect(relBearing(0, 0, -10, 0, 0)).toBeCloseTo(-90);
    expect(Math.abs(relBearing(0, 0, 0, 10, 0))).toBeCloseTo(180);
    // Turning right by 90 degrees (yaw -PI/2 in this convention) brings +X dead ahead.
    expect(relBearing(0, 0, 10, 0, -Math.PI / 2)).toBeCloseTo(0);
  });
  it('capsule labels read as sentences', async () => {
    const { sentence } = await import('../src/ui/hive/kit');
    expect(sentence('ENTER EXCLUSION ZONE')).toBe('Enter exclusion zone');
    expect(sentence('RETURN TO HIVE')).toBe('Return to Hive');
  });
});

describe('settings words', () => {
  it('every graphics level has plain words', () => {
    for (const g of GRAPHICS_LEVELS) expect(GRAPHICS_WORDS[g][0].length).toBeGreaterThan(0);
  });
});

describe('graft toast', () => {
  it('names the graft and the gun it budded onto', async () => {
    const { graftToast } = await import('../src/ui/raid/hud');
    expect(graftToast('Hush Gill', 'Synapse Burster')).toBe('HUSH GILL TAKES HOLD · SYNAPSE BURSTER');
  });
});
