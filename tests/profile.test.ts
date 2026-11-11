import { describe, expect, it } from 'vitest';
import { CLASSES, LOOT, PROFILE, stashRowCost } from '../data';
import { ItemGrid } from '../src/game/grid';
import { Carried } from '../src/game/inventory';
import {
  deploy, die, expandStash, extract, loadProfile, memoryStorage, newProfile, placeAt, pouchSize, rotate, saveProfile, transfer, upgradePouch,
} from '../src/game/profile';

const total = (entries: { item: string; count: number }[], item: string) => entries.reduce((n, e) => n + (e.item === item ? e.count : 0), 0);

describe('item grid', () => {
  it('places by size, refuses overlaps and out-of-bounds, and rotates', () => {
    const g = new ItemGrid(5, 4);
    expect(LOOT.items.glitchingHeart.size).toEqual([2, 2]);
    expect(g.place('glitchingHeart', 1, 0, 0)).not.toBeNull();
    expect(g.fits('clotGel', 1, 1)).toBe(false);
    expect(g.fits('clotGel', 2, 0)).toBe(true);
    expect(g.fits('synapseLens', 4, 0)).toBe(false); // 2x1 off the right edge
    expect(g.fits('synapseLens', 4, 0, true)).toBe(true); // turned 1x2 fits
    const lens = g.place('synapseLens', 1, 2, 0)!;
    expect(g.move(lens, 4, 0, true)).toBe(true);
    expect(g.usedCells).toBe(4 + 2);
  });

  it('tops up stacks before opening new ones and reports what did not fit', () => {
    const limit = LOOT.items.clotGel.stack;
    const g = new ItemGrid(2, 1);
    expect(g.add('clotGel', limit + 1)).toBe(0);
    expect(g.entries.map((e) => e.count)).toEqual([limit, 1]);
    expect(g.add('clotGel', limit)).toBe(1); // one slot left in the second stack, rest overflow
    expect(g.count('clotGel')).toBe(limit * 2);
    expect(g.remove('clotGel', limit + 1)).toBe(limit + 1);
    expect(g.count('clotGel')).toBe(limit - 1);
  });

  it('re-packs saved placements that overlap', () => {
    const g = new ItemGrid(3, 1, [{ item: 'synapseLens', count: 1, x: 0, y: 0, rotated: false }, { item: 'clotGel', count: 1, x: 1, y: 0, rotated: false }]);
    expect(g.entries.map((e) => [e.item, e.x])).toEqual([['synapseLens', 0], ['clotGel', 2]]);
  });
});

describe('carried in raid', () => {
  it('fills cavities then the gut pouch, spends cavity stock first, and values the haul', () => {
    const c = new Carried([1, 1], [1, 1]);
    const limit = LOOT.items.clotGel.stack;
    expect(c.add('clotGel', limit + 1)).toBe(0);
    expect(c.cavity.count('clotGel')).toBe(limit);
    expect(c.pouch.count('clotGel')).toBe(1);
    expect(c.add('synapseLens')).toBe(1); // no room anywhere: reported, never dropped
    c.consume('clotGel');
    expect(c.cavity.count('clotGel')).toBe(limit - 1);
    expect(c.pouch.count('clotGel')).toBe(1);
    c.dna = 7;
    expect(c.value).toBe(limit * LOOT.items.clotGel.value + 7);
  });
});

describe('profile', () => {
  it('starts with the Design starter kit', () => {
    const p = newProfile();
    expect(p.dna).toBe(PROFILE.newProfile.dna);
    for (const s of PROFILE.newProfile.stash) expect(total(p.stash, s.item)).toBe(s.count);
    expect(p.stashRows).toBe(PROFILE.stash.rowsBase);
    expect(pouchSize(0)).toEqual(PROFILE.gutPouch.size);
  });

  it('survives a save and load round trip', () => {
    const kv = memoryStorage();
    const p = newProfile();
    transfer(p, 'stash', 0, 'cavity');
    p.dna = 321;
    saveProfile(kv, p);
    const back = loadProfile(kv);
    expect(back.notice).toBeNull();
    expect(back.profile).toEqual(p);
  });

  it('backs up an unknown or corrupt save instead of wiping it', () => {
    for (const raw of ['{"schemaVersion":99,"dna":5}', '{not json']) {
      const kv = memoryStorage();
      kv.setItem(PROFILE.storageKey, raw);
      const r = loadProfile(kv);
      expect(r.notice).toMatch(/backed up/);
      expect(kv.getItem(`${PROFILE.storageKey}.bak`)).toBe(raw);
      expect(r.profile.dna).toBe(PROFILE.newProfile.dna);
    }
  });

  it('moves stacks between stash, cavities and pouch, keeping what does not fit', () => {
    const p = newProfile();
    const gel = p.stash.findIndex((e) => e.item === 'clotGel');
    expect(transfer(p, 'stash', gel, 'cavity')).toBe(3);
    expect(total(p.cavity, 'clotGel')).toBe(3);
    expect(total(p.stash, 'clotGel')).toBe(0);
    expect(transfer(p, 'cavity', 0, 'pouch')).toBe(3);
    expect(total(p.gutPouch, 'clotGel')).toBe(3);
    // A 2x2 organ does not fit the 2x1 pouch: nothing moves.
    p.stash.push({ item: 'glitchingHeart', count: 1, x: 8, y: 4, rotated: false });
    expect(transfer(p, 'stash', p.stash.length - 1, 'pouch')).toBe(0);
    expect(total(p.stash, 'glitchingHeart')).toBe(1);
    p.stash.push({ item: 'synapseLens', count: 1, x: 5, y: 3, rotated: false });
    expect(rotate(p, 'stash', p.stash.length - 1)).toBe(true);
    expect(p.stash[p.stash.length - 1].rotated).toBe(true);
  });

  it('drag and drop places at a cell, tops up same-item stacks, and refuses blocked drops', () => {
    const p = newProfile();
    p.stash = [{ item: 'clotGel', count: 2, x: 0, y: 0, rotated: false }, { item: 'clotGel', count: 2, x: 1, y: 0, rotated: false }, { item: 'synapseLens', count: 1, x: 3, y: 0, rotated: false }];
    expect(placeAt(p, 'stash', 2, 'cavity', 0, 0, true)).toBe(true);
    expect(p.cavity).toEqual([{ item: 'synapseLens', count: 1, x: 0, y: 0, rotated: true }]);
    expect(placeAt(p, 'stash', 0, 'cavity', 0, 1)).toBe(false); // the turned lens covers (0, 1)
    const limit = LOOT.items.clotGel.stack;
    expect(placeAt(p, 'stash', 0, 'stash', 1, 0)).toBe(true); // onto the other gel stack
    expect(p.stash.map((e) => e.count)).toEqual([4 - limit, limit].filter((n) => n > 0));
    expect(placeAt(p, 'stash', 0, 'stash', 9, 5)).toBe(true);
    expect(p.stash[0]).toMatchObject({ x: 9, y: 5 });
  });

  it('buys stash rows and pouch upgrades with banked DNA, up to the caps', () => {
    const p = newProfile();
    p.dna = 1e6;
    let rows = 0;
    while (expandStash(p)) rows++;
    expect(p.stashRows).toBe(PROFILE.stash.rowExpansion.maxRows);
    let spent = 0;
    for (let n = 0; n < rows; n++) spent += stashRowCost(n);
    expect(p.dna).toBe(1e6 - spent);
    while (upgradePouch(p)) { /* to the top */ }
    expect(pouchSize(p.gutPouchLevel)).toEqual(PROFILE.gutPouch.upgrades.at(-1)!.size);
    const broke = newProfile();
    broke.dna = 0;
    expect(expandStash(broke)).toBe(false);
    expect(upgradePouch(broke)).toBe(false);
  });

  it('deploy hands over the loadout, empties the saved cavities and grows free Clot Gel when broke', () => {
    const p = newProfile();
    p.stash = p.stash.filter((e) => e.item !== 'clotGel');
    p.cavity = [{ item: 'synapseLens', count: 1, x: 0, y: 0, rotated: false }];
    p.gutPouch = [{ item: 'mutagenVial', count: 1, x: 0, y: 0, rotated: true }];
    const d = deploy(p);
    expect(d.cavitySize).toEqual(CLASSES.neuroInfiltrator.cavityGrid);
    expect(d.freeKit).toBe(PROFILE.freeKit.clotGelFloor);
    expect(total(d.loadout.cavity, 'clotGel')).toBe(PROFILE.freeKit.clotGelFloor);
    expect(total(d.loadout.cavity, 'synapseLens')).toBe(1);
    expect(total(d.loadout.pouch, 'mutagenVial')).toBe(1);
    expect(p.cavity).toEqual([]);
    expect(total(p.gutPouch, 'mutagenVial')).toBe(1); // secure: survives a mid-raid quit
    expect(p.stats.raids).toBe(1);
    expect(deploy(newProfile()).freeKit).toBe(0);
  });

  it('extract moves the haul to the stash, converts DNA strands and banks kill DNA', () => {
    const p = newProfile();
    const d = deploy(p);
    const c = new Carried(d.cavitySize, d.pouchSize);
    c.load(d.loadout, d.cavitySize, d.pouchSize);
    c.add('glitchingHeart'); c.add('dnaStrand', 4); c.dna = 30;
    c.pouch.add('needlemawGland', 2);
    const before = p.dna;
    const st = extract(p, c.snapshot(), 2);
    expect(st.dnaBanked).toBe(30 + 4 * LOOT.items.dnaStrand.value);
    expect(p.dna).toBe(before + st.dnaBanked);
    expect(total(p.stash, 'glitchingHeart')).toBe(1);
    expect(total(p.stash, 'dnaStrand')).toBe(2); // the starter bundles in the stash stay items
    expect(total(p.gutPouch, 'needlemawGland')).toBe(2);
    expect(p.cavity).toEqual([]);
    expect(p.stats).toMatchObject({ extracts: 1, kills: 2 });
  });

  it('extract keeps what the stash cannot hold in the cavities', () => {
    const p = newProfile();
    p.stash = [];
    for (let i = 0; i < PROFILE.stash.gridColumns * p.stashRows; i++) p.stash.push({ item: 'needlemawGland', count: 1, x: i % PROFILE.stash.gridColumns, y: Math.floor(i / PROFILE.stash.gridColumns), rotated: false });
    for (const e of p.stash) e.count = LOOT.items.needlemawGland.stack;
    const st = extract(p, { cavity: [{ item: 'synapseLens', count: 1, x: 0, y: 0, rotated: false }], pouch: [], dna: 0 }, 0);
    expect(st.overflow).toEqual([{ item: 'synapseLens', count: 1 }]);
    expect(total(p.cavity, 'synapseLens')).toBe(1);
  });

  it('death loses the cavities and kill DNA, keeps the gut pouch and banked DNA', () => {
    const p = newProfile();
    const d = deploy(p);
    const c = new Carried();
    c.load(d.loadout, d.cavitySize, d.pouchSize);
    c.add('glitchingHeart'); c.dna = 50;
    c.pouch.add('clotGel', 1);
    const banked = p.dna;
    die(p, c.snapshot(), 1);
    expect(p.dna).toBe(banked);
    expect(p.cavity).toEqual([]);
    expect(total(p.stash, 'glitchingHeart')).toBe(0);
    expect(total(p.gutPouch, 'clotGel')).toBe(1);
    expect(p.stats).toMatchObject({ deaths: 1, kills: 1, raids: 1 });
  });
});
