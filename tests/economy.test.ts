import { describe, expect, it } from 'vitest';
import { CONTRACTS, VENDORS, VENDOR_REP_THRESHOLDS, ZONES, vendorBuyPrice } from '../data';
import {
  DEFAULT_ZONE, RaidLog, abandonContract, acceptContract, canVendorBuy, contractState, normaliseEconomy, openVendors, repLevel,
  selectZone, settleContracts, vendorBuy, vendorContracts, vendorSell, vendorStock, zoneAccess, zoneList,
} from '../src/game/economy';
import { deploy, loadProfile, memoryStorage, newProfile, pouchUpgradeCost, saveProfile, stashGrid } from '../src/game/profile';
import { PROFILE } from '../data';
import type { Profile } from '../src/game/profile';

const contract = (id: string) => CONTRACTS.find((c) => c.id === id)!;
const stashCount = (p: Profile, item: string) => stashGrid(p).count(item);
function giveStash(p: Profile, item: string, n: number): void { const g = stashGrid(p); g.add(item, n); p.stash = g.snapshot(); }
function finish(p: Profile, id: string): void { p.economy.contracts.done.push(id); }

describe('vendors and reputation', () => {
  it('opens the Larva vendors with stock; the Gullet Broker stays in the Flesh Market', () => {
    expect(openVendors()).toEqual(expect.arrayContaining(['motherClot', 'archivist']));
    expect(openVendors()).not.toContain('gulletBroker');
  });

  it('pays the vendor rate and earns rep from trading', () => {
    const p = newProfile();
    giveStash(p, 'needlemawGland', 2);
    const i = p.stash.findIndex((e) => e.item === 'needlemawGland');
    const dna = p.dna;
    const paid = vendorSell(p, 'motherClot', 'stash', i, 2);
    expect(paid).toBe(vendorBuyPrice('motherClot', 'needlemawGland') * 2);
    expect(p.dna).toBe(dna + paid);
    expect(p.economy.rep.motherClot).toBeCloseTo(paid / 100);
  });

  it('gates stock by rep level and refuses without DNA or space', () => {
    const p = newProfile();
    const top = VENDORS.motherClot.stock!.find((s) => s.rep === 4)!;
    expect(vendorStock(p, 'motherClot').find((s) => s.item === top.item)!.available).toBe(false);
    p.dna = 1e6;
    expect(canVendorBuy(p, 'motherClot', top.item)).toBe('rep');
    p.economy.rep.motherClot = VENDOR_REP_THRESHOLDS[3];
    expect(repLevel(p, 'motherClot')).toBe(4);
    const before = stashCount(p, top.item);
    expect(vendorBuy(p, 'motherClot', top.item)).toBe(true);
    expect(stashCount(p, top.item)).toBe(before + 1);
    expect(p.dna).toBe(1e6 - top.price);
    p.dna = 0;
    expect(canVendorBuy(p, 'motherClot', 'clotGel')).toBe('dna');
    expect(vendorBuy(p, 'motherClot', 'clotGel')).toBe(false);
    expect(canVendorBuy(p, 'motherClot', 'blackBox')).toBe('not-stocked');
  });
});

describe('vendor perks', () => {
  it('applies Mother Clot perks from vendors.json `perks` once the rep level is reached', () => {
    const v = VENDORS.motherClot as { perks?: unknown };
    const saved = v.perks;
    v.perks = { pouchUpgradeDiscount: { rep: 2, fraction: 0.1 }, deployGift: { rep: 4, item: 'clotGel', count: 1, to: 'pouch' } };
    try {
      const p = newProfile();
      const base = PROFILE.gutPouch.upgrades[0].cost;
      expect(pouchUpgradeCost(p)).toBe(base);
      p.economy.rep.motherClot = VENDOR_REP_THRESHOLDS[1];
      expect(pouchUpgradeCost(p)).toBe(Math.round(base * 0.9));
      const gel = (d: ReturnType<typeof deploy>) => d.loadout.pouch.filter((e) => e.item === 'clotGel').reduce((n, e) => n + e.count, 0);
      expect(gel(deploy(newProfile()))).toBe(0);
      p.economy.rep.motherClot = VENDOR_REP_THRESHOLDS[3];
      expect(gel(deploy(p))).toBe(1);
    } finally { v.perks = saved; }
  });
});

describe('contracts', () => {
  it('chains through requires, one active per vendor', () => {
    const p = newProfile();
    expect(contractState(p, 'firstBlood')).toBe('available');
    expect(contractState(p, 'songForTheCreche')).toBe('locked');
    expect(acceptContract(p, 'songForTheCreche')).toBe(false);
    expect(acceptContract(p, 'firstBlood')).toBe(true);
    expect(contractState(p, 'firstBlood')).toBe('active');
    expect(acceptContract(p, 'eyesInTheGlass')).toBe(true); // another vendor
    expect(vendorContracts(p, 'motherClot').map((c) => c.state)[0]).toBe('active');
    expect(contractState(p, 'husksAndLiars')).toBe('coming'); // Gullet Broker arrives in Host
    expect(abandonContract(p, 'motherClot')).toBe(true);
    expect(contractState(p, 'firstBlood')).toBe('available');
  });

  it('banks harvest progress across raids only when you extract, then pays out', () => {
    const p = newProfile();
    acceptContract(p, 'firstBlood');
    const c = contract('firstBlood');
    const need = c.objectives[0].count!;
    const log = new RaidLog();
    for (let i = 0; i < need - 1; i++) log.harvest('needlemawGland');
    expect(settleContracts(p, log, false)).toEqual([]); // died: nothing counts
    expect(p.economy.contracts.progress.firstBlood).toEqual([0]);
    settleContracts(p, log, true);
    expect(p.economy.contracts.progress.firstBlood).toEqual([need - 1]);
    const dna = p.dna, gel = stashCount(p, 'clotGel');
    const next = new RaidLog();
    next.harvest('needlemawGland'); next.harvest('needlemawGland');
    const [r] = settleContracts(p, next, true);
    expect(r.completed).toBe(true);
    expect(p.dna).toBe(dna + c.reward.dna);
    expect(p.economy.rep.motherClot).toBe(c.reward.rep);
    expect(stashCount(p, 'clotGel')).toBe(gel + c.reward.items![0].count);
    expect(contractState(p, 'firstBlood')).toBe('done');
    expect(contractState(p, 'songForTheCreche')).toBe('available');
    expect(p.economy.contracts.active.motherClot).toBeUndefined();
  });

  it('extractWith hands the item over from the stash and grants the unlock', () => {
    const p = newProfile();
    finish(p, 'firstBlood'); finish(p, 'songForTheCreche');
    acceptContract(p, 'heartOfTheBrood');
    giveStash(p, 'broodHeartSeed', 1);
    const [r] = settleContracts(p, new RaidLog(), true);
    expect(r.completed).toBe(true);
    expect(stashCount(p, 'broodHeartSeed')).toBe(0);
    expect(p.economy.unlocks).toContain(contract('heartOfTheBrood').reward.unlock);
  });

  it('needs every objective: visit plus delivery', () => {
    const p = newProfile();
    finish(p, 'eyesInTheGlass');
    acceptContract(p, 'signalInTheWreck');
    giveStash(p, 'blackBox', 1);
    const log = new RaidLog();
    let [r] = settleContracts(p, log, true);
    expect(r.completed).toBe(false);
    expect(r.progress).toEqual([0, 1]);
    log.visit('longSeedDebris');
    [r] = settleContracts(p, log, true);
    expect(r.completed).toBe(true);
    expect(p.economy.unlocks).toContain('zone:longSeedWreck');
  });
});

describe('zones', () => {
  it('Glowmire Isle is open; the Wreck opens with its contract; later milestones are coming', () => {
    const p = newProfile();
    expect(zoneAccess(p, DEFAULT_ZONE).state).toBe('open');
    const wreck = zoneAccess(p, 'longSeedWreck');
    expect(wreck.state).toBe('locked');
    expect(wreck.state === 'locked' && wreck.reason).toContain(contract('signalInTheWreck').title);
    expect(selectZone(p, 'longSeedWreck')).toBe(false);
    p.economy.unlocks.push('zone:longSeedWreck');
    expect(selectZone(p, 'longSeedWreck')).toBe(true);
    expect(deploy(p).zone).toBe('longSeedWreck');
    expect(zoneAccess(p, 'expanse').state).toBe('open'); // opened early for playtesting (zones.json accessNote)
    expect(zoneAccess(p, 'hollowChoir').state).toBe('coming');
    expect(zoneAccess(p, 'longSeedWreck', 0, ['glowmireIsle']).state).toBe('coming'); // unlocked, but no map yet
    expect(selectZone(p, 'longSeedWreck', 0, ['glowmireIsle'])).toBe(false);
    expect(zoneList(p).map((z) => z.id)).toEqual(Object.entries(ZONES).sort(([, a], [, b]) => a.order - b.order).map(([id]) => id));
  });
});

describe('economy save data', () => {
  it('survives a save and load, and repairs junk', () => {
    const kv = memoryStorage();
    const p = newProfile();
    acceptContract(p, 'firstBlood');
    p.economy.rep.archivist = 42;
    p.economy.unlocks.push('zone:longSeedWreck');
    selectZone(p, 'longSeedWreck');
    saveProfile(kv, p);
    const back = loadProfile(kv).profile;
    expect(back.economy).toEqual(p.economy);
    const fixed = normaliseEconomy({ rep: { nobody: 5 } as never, contracts: { active: { motherClot: 'nope' }, progress: {}, done: ['nope'] }, zone: 'atlantis', unlocks: [] });
    expect(fixed.rep).toEqual({});
    expect(fixed.contracts.active).toEqual({});
    expect(fixed.contracts.done).toEqual([]);
    expect(fixed.zone).toBe(DEFAULT_ZONE);
    // An older save without economy fields loads with defaults.
    const { economy: _drop, ...old } = newProfile();
    expect(normaliseEconomy((old as Partial<Profile>).economy).zone).toBe(DEFAULT_ZONE);
  });
});
