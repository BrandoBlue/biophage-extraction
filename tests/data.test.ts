import { describe, expect, it } from 'vitest';
import {
  ABILITIES, ABOMINATIONS, CLASSES, HOST, KITS, LOOT, MARKET, NESTS, PROFILE, PROGRESSION, RAID, RIVALS, SYNAPSE, VIRAL_LAB, VIRUSES, WEAPONS,
  itemDef, levelForXp, marketPrice, nodeMutagenCost,
  extractTimeFor, haulValue, layoutPosition, stashRowCost, projectileDamage, rollContainer,
} from '../data';
import { mulberry32 } from '../src/world/zone7';
import { PATH } from '../src/render/palette';

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

describe('raid layout', () => {
  it('maps bearings to world axes (0 = -Z, 90 = +X)', () => {
    const [nx, nz] = layoutPosition({ radius: 1, bearing: 0 }, 10);
    expect(nx).toBeCloseTo(0); expect(nz).toBeCloseTo(-10);
    const [ex, ez] = layoutPosition({ radius: 0.5, bearing: 90 }, 10);
    expect(ex).toBeCloseTo(5); expect(ez).toBeCloseTo(0);
  });
  it('puts spawn and extract more than 200 m apart on the full pocket', () => {
    const [sx, sz] = layoutPosition(RAID.spawn);
    const [ex, ez] = layoutPosition(RAID.extract);
    expect(Math.hypot(ex - sx, ez - sz)).toBeGreaterThan(200);
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

describe('Larva data (docs/gdd/larva-milestone.md)', () => {
  it('every abomination has a harvestable organ that exists', () => {
    for (const [k, a] of Object.entries(ABOMINATIONS)) {
      const h = a.harvest as { item: string } | undefined;
      expect(h, k).toBeDefined();
      expect(LOOT.items[h!.item], h!.item).toBeDefined();
    }
  });
  it('ships five Abomination types by Larva', () => {
    const larva = Object.values(ABOMINATIONS).filter((a) => ['spore', 'larva'].includes(a.introducedIn as string));
    expect(larva).toHaveLength(5);
  });
  it('every virus is a virus item, and every virus item has a definition', () => {
    for (const v of Object.values(VIRUSES)) expect(LOOT.items[v.item]?.kind).toBe('virus');
    for (const [id, item] of Object.entries(LOOT.items)) if (item.kind === 'virus') expect(Object.values(VIRUSES).some((v) => v.item === id), id).toBe(true);
  });
  it('nest waves, drops and Larva layout reference real data', () => {
    for (const n of Object.values(NESTS)) {
      for (const wave of n.waves) for (const s of wave) expect(ABOMINATIONS[s.type], s.type).toBeDefined();
      expect(LOOT.containers[n.onDestroyed.container]).toBeDefined();
    }
    for (const n of RAID.larva.nests) expect(NESTS[n.type], n.type).toBeDefined();
    for (const g of RAID.larva.spawnGroups) expect(ABOMINATIONS[g.type], g.type).toBeDefined();
    for (const c of RAID.larva.containers) expect(LOOT.containers[c.type], c.type).toBeDefined();
    for (const it of PROFILE.newProfile.stash) expect(LOOT.items[it.item], it.item).toBeDefined();
  });
  it('a new profile fits its stash and gut pouch upgrades get bigger and pricier', () => {
    const cells = PROFILE.newProfile.stash.reduce((s, { item, count }) => s + LOOT.items[item].size[0] * LOOT.items[item].size[1] * Math.ceil(count / LOOT.items[item].stack), 0);
    expect(cells).toBeLessThanOrEqual(PROFILE.stash.gridColumns * PROFILE.stash.rowsBase);
    let area = PROFILE.gutPouch.size[0] * PROFILE.gutPouch.size[1], cost = 0;
    for (const u of PROFILE.gutPouch.upgrades) {
      expect(u.size[0] * u.size[1]).toBeGreaterThan(area);
      expect(u.cost).toBeGreaterThan(cost);
      area = u.size[0] * u.size[1]; cost = u.cost;
    }
  });
  it('stash rows get more expensive and stop at the cap', () => {
    expect(stashRowCost(1)).toBeGreaterThan(stashRowCost(0));
    const maxBuys = (PROFILE.stash.rowExpansion.maxRows - PROFILE.stash.rowsBase) / PROFILE.stash.rowExpansion.rows;
    expect(stashRowCost(maxBuys)).toBe(Infinity);
  });
  it('the Mournback cannot be beaten from the front with one magazine', () => {
    const m = ABOMINATIONS.mournback as unknown as { biomass: number; frontArmour: { multiplier: number } };
    const gun = WEAPONS.synapseBurster;
    expect(gun.magazine * gun.damage * m.frontArmour.multiplier).toBeLessThan(m.biomass);
    expect(gun.magazine * gun.damage).toBeGreaterThan(m.biomass * 0.6);
  });
});

describe('Host data (docs/gdd/host-milestone.md)', () => {
  const classIds = ['venomWraith', 'neuroInfiltrator', 'goreBehemoth'] as const;
  it('every class has a kit with two ability slots', () => {
    for (const c of classIds) {
      const slots = Object.values(KITS[c].abilities).map((a) => a.slot).sort();
      expect(slots, c).toEqual([1, 2]);
    }
  });
  it('every class has three Synapse paths of five nodes with rising cost and level, each with a visual brief', () => {
    const ids = new Set<string>();
    for (const c of classIds) {
      const paths = Object.values(SYNAPSE[c]);
      expect(paths, c).toHaveLength(3);
      for (const p of paths) {
        expect(PATH[p.colour], p.label).toBeDefined();
        expect(p.nodes).toHaveLength(5);
        for (let i = 0; i < p.nodes.length; i++) {
          const n = p.nodes[i];
          expect(ids.has(`${c}.${n.id}`), n.id).toBe(false);
          ids.add(`${c}.${n.id}`);
          expect(n.visual.length, n.id).toBeGreaterThan(20);
          if (i > 0) {
            expect(n.dna).toBeGreaterThan(p.nodes[i - 1].dna);
            expect(n.level).toBeGreaterThanOrEqual(p.nodes[i - 1].level);
          }
        }
      }
    }
  });
  it('each class has exactly one Host-milestone evolution with a body brief, at the reference-02 level', () => {
    const want = { venomWraith: 2, neuroInfiltrator: 3, goreBehemoth: 1 };
    for (const c of classIds) {
      const host = PROGRESSION.evolutions[c].filter((e) => e.milestone === 'host');
      expect(host, c).toHaveLength(1);
      expect(host[0].level).toBe(want[c]);
      expect(host[0].body.length).toBeGreaterThan(80);
    }
  });
  it('levels are strictly increasing and levelForXp is consistent', () => {
    const L = PROGRESSION.levels;
    for (let i = 1; i < L.length; i++) expect(L[i]).toBeGreaterThan(L[i - 1]);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(L[1])).toBe(2);
    expect(levelForXp(1e12)).toBe(L.length);
    for (const k of Object.keys(PROGRESSION.xp.kill)) if (k !== 'rivalHost') expect(ABOMINATIONS[k], k).toBeDefined();
  });
  it('the Infiltrator pays its +15% mutagen tax', () => {
    const node = SYNAPSE.neuroInfiltrator.mind.nodes[4];
    expect(nodeMutagenCost('neuroInfiltrator', node)).toBeGreaterThan(nodeMutagenCost('venomWraith', node));
  });
  it('Viral Lab and Flesh Market reference real items', () => {
    for (const id of Object.keys(VIRAL_LAB.cost)) expect(Object.values(VIRUSES).some((v) => v.item === id), id).toBe(true);
    for (const e of MARKET.catalogue) expect(itemDef(e.item), e.item).toBeDefined();
    for (const t of RIVALS.loadoutTiers) for (const it of t.items) expect(itemDef(it.item), it.item).toBeDefined();
  });
  it('the Flesh Market never buys for more than it sells', () => {
    for (const e of MARKET.catalogue) {
      const buyBack = itemDef(e.item)!.value * MARKET.buyRate;
      expect(marketPrice(e.price, MARKET.mood.max), e.item).toBeGreaterThan(buyBack);
    }
    expect(marketPrice(100, 99)).toBe(marketPrice(100, MARKET.mood.max));
  });
  it('rival class mix and personality weights sum to 1', () => {
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(RIVALS.classMix)).toBeCloseTo(1);
    expect(sum(Object.fromEntries(Object.entries(RIVALS.personalities).map(([k, v]) => [k, v.weight])))).toBeCloseTo(1);
  });
  it('the Host map holds 3 to 5 biomes and enough extracts to shift', () => {
    expect(RAID.host.biomes.length).toBeGreaterThanOrEqual(3);
    expect(RAID.host.biomes.length).toBeLessThanOrEqual(5);
    expect(RAID.host.extracts.pool.length).toBeGreaterThan(RAID.host.extracts.maxOpen);
  });
  it('class melee and weapon kits keep the light-to-heavy shape', () => {
    expect(KITS.goreBehemoth.melee.damage).toBeGreaterThan(KITS.venomWraith.melee.damage);
    const lancet = KITS.venomWraith.weapon as unknown as { damage: number; fireRate: number };
    const cannon = KITS.goreBehemoth.weapon as unknown as { pellets: number; damagePerPellet: number; fireRate: number };
    expect(cannon.pellets * cannon.damagePerPellet).toBeGreaterThan(lancet.damage * 5);
    expect(lancet.fireRate).toBeGreaterThan(cannon.fireRate);
  });
});
