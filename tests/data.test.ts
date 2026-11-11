import { describe, expect, it } from 'vitest';
import {
  ABILITIES, ABOMINATIONS, CLASSES, HOST, LOOT, RAID, WEAPONS,
  extractTimeFor, haulValue, projectileDamage, rollContainer,
} from '../data';
import { mulberry32 } from '../src/world/zone7';

describe('design data integrity', () => {
  it('every loot table entry and guaranteed item exists', () => {
    for (const c of Object.values(LOOT.containers)) {
      for (const e of [...c.table, ...c.guaranteed]) expect(LOOT.items[e.item], e.item).toBeDefined();
    }
  });
  it('every raid spawn, guard and container references real data', () => {
    for (const g of RAID.spawnGroups) expect(ABOMINATIONS[g.type], g.type).toBeDefined();
    for (const w of RAID.reinforcements.wave) expect(ABOMINATIONS[w.type], w.type).toBeDefined();
    for (const c of RAID.containers) {
      expect(LOOT.containers[c.type], c.type).toBeDefined();
      if (c.guard) expect(ABOMINATIONS[c.guard], c.guard).toBeDefined();
    }
  });
  it('consumable abilities point at real items', () => {
    for (const a of Object.values(ABILITIES)) if (a.item) expect(LOOT.items[a.item], a.item).toBeDefined();
  });
  it('ability slots fit the five-slot HUD and do not collide', () => {
    const slots = Object.values(ABILITIES).map((a) => a.slot);
    expect(new Set(slots).size).toBe(slots.length);
    for (const s of slots) expect(s).toBeGreaterThanOrEqual(1), expect(s).toBeLessThanOrEqual(5);
  });
  it('only the Neuro-Infiltrator is playable in Spore', () => {
    const spore = Object.entries(CLASSES).filter(([, c]) => c.playableFrom === 'spore').map(([k]) => k);
    expect(spore).toEqual(['neuroInfiltrator']);
  });
});

describe('Spore balance targets (docs/gdd/03-combat.md)', () => {
  const gun = WEAPONS.synapseBurster;
  const bodyShotsToKill = (hp: number) => Math.ceil(hp / projectileDamage(gun, 10));

  it('a Needlemaw dies in under one second of sustained close fire', () => {
    expect(bodyShotsToKill(ABOMINATIONS.needlemaw.biomass) / gun.fireRate).toBeLessThan(1);
  });
  it('a Bile Cantor takes 2 to 4 seconds of body fire, so weak points matter', () => {
    const t = bodyShotsToKill(ABOMINATIONS.bilecantor.biomass) / gun.fireRate;
    expect(t).toBeGreaterThanOrEqual(2);
    expect(t).toBeLessThanOrEqual(4);
  });
  it('one magazine can kill a full Needlemaw pack', () => {
    const maxPack = ABOMINATIONS.needlemaw.packSize[1];
    expect(bodyShotsToKill(ABOMINATIONS.needlemaw.biomass) * maxPack).toBeLessThanOrEqual(gun.magazine);
  });
  it('a walking host is caught by Needlemaws, a sprinting one escapes', () => {
    const h = CLASSES.neuroInfiltrator;
    expect(ABOMINATIONS.needlemaw.speed).toBeGreaterThan(h.moveSpeed);
    expect(ABOMINATIONS.needlemaw.speed).toBeLessThan(h.moveSpeed * h.sprintMultiplier);
  });
  it('a host can sprint for 8 to 15 seconds from cold before Overloading', () => {
    const t = HOST.neuralOverload.max / HOST.neuralOverload.sprintFillPerSecond;
    expect(t).toBeGreaterThanOrEqual(8);
    expect(t).toBeLessThanOrEqual(15);
  });
  it('damage falls off with range but never below the floor', () => {
    expect(projectileDamage(gun, 0)).toBe(gun.damage);
    expect(projectileDamage(gun, 1000)).toBeCloseTo(gun.damage * gun.range.minMultiplier);
  });
  it('the extract channel scales by class', () => {
    expect(extractTimeFor('venomWraith')).toBeLessThan(extractTimeFor('neuroInfiltrator'));
    expect(extractTimeFor('goreBehemoth')).toBe(extractTimeFor('neuroInfiltrator') * 2);
  });
  it('spawn and extract sit on opposite sides of the pocket', () => {
    const diff = Math.abs(((RAID.extract.bearing - RAID.spawn.bearing + 540) % 360) - 180);
    expect(diff).toBeGreaterThan(150);
  });
});

describe('loot rolls', () => {
  it('are reproducible for a seed and always include the guaranteed item', () => {
    const a = rollContainer('bioPod', mulberry32(3));
    expect(a).toEqual(rollContainer('bioPod', mulberry32(3)));
    expect(a[0]).toEqual({ item: 'clotGel', count: 1 });
    expect(a).toHaveLength(1 + LOOT.containers.bioPod.rolls);
  });
  it('produce counts inside the table range', () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 500; i++) {
      for (const r of rollContainer('bioPod', rand).slice(1)) {
        const e = LOOT.containers.bioPod.table.find((t) => t.item === r.item)!;
        expect(r.count).toBeGreaterThanOrEqual(e.count[0]);
        expect(r.count).toBeLessThanOrEqual(e.count[1]);
      }
    }
  });
  it('haul value sums item DNA and kill DNA', () => {
    expect(haulValue([{ item: 'dnaStrand', count: 2 }], 5)).toBe(LOOT.items.dnaStrand.value * 2 + 5);
  });
});
