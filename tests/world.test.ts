import { describe, expect, it } from 'vitest';
import { RAID, ZONE7_SITES } from '../data';
import { CATALOGUE, gravityAt, zone7Layout } from '../src/world/layout';
import { CRATERS, FLAT_SPOTS, groundHeight, ISLAND_RADIUS, POOLS } from '../src/world/zone7';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('zone 7 raid layout', () => {
  it('is reproducible per seed and varies across seeds', () => {
    expect(zone7Layout(42)).toEqual(zone7Layout(42));
    const combos = new Set(Array.from({ length: 40 }, (_, i) => {
      const l = zone7Layout(i + 1);
      return `${l.extracts.map((e) => e.id).join('>')}|${l.anomaly.id}`;
    }));
    expect(combos.size).toBeGreaterThan(6);
  });

  it('opens two distinct Seed Spires, far apart, with RAID.larva timing', () => {
    for (let seed = 1; seed < 60; seed++) {
      const l = zone7Layout(seed);
      expect(l.extracts).toHaveLength(RAID.larva.extracts.length);
      const [a, b] = l.extracts;
      expect(a.id).not.toBe(b.id);
      expect(dist(a, b)).toBeGreaterThanOrEqual(ZONE7_SITES.extractMinSeparation);
      expect(a.opensAt).toBe(RAID.larva.extracts[0].opensAt);
      expect(b.opensAt).toBe(RAID.larva.extracts[1].opensAt);
      expect(l.dormantPads.length + l.extracts.length).toBe(ZONE7_SITES.extractPool.length);
      expect(l.nodes).toHaveLength(ZONE7_SITES.geneBlooms.perRaid);
    }
  });

  it('every live extract is a real route away from the spawn', () => {
    for (const p of CATALOGUE.pads) expect(dist(p, CATALOGUE.spawn), p.id).toBeGreaterThan(120);
  });

  it('puts the Brood Heart at bearing 300 and the pods where Design placed them', () => {
    const n = CATALOGUE.nests[0];
    expect((Math.atan2(n.x, -n.z) * 180) / Math.PI + 360).toBeCloseTo(300, 3);
    expect(CATALOGUE.pods).toHaveLength(RAID.larva.containers.length);
  });

  it('keeps every site on the island and off the pools and each other', () => {
    const all = [CATALOGUE.spawn, ...CATALOGUE.pads, ...CATALOGUE.pods, ...CATALOGUE.nests, ...CATALOGUE.blooms, ...CATALOGUE.anomalies];
    for (const s of all) {
      expect(Math.hypot(s.x, s.z), s.id).toBeLessThan(ISLAND_RADIUS * 0.84);
      for (const p of POOLS) expect(dist(s, p), `${s.id} vs pool`).toBeGreaterThan(p.radius + 6);
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      expect(dist(all[i], all[j]), `${all[i].id} vs ${all[j].id}`).toBeGreaterThan(14);
    }
  });

  it('sinks the Brood Heart into a crater with a lip', () => {
    for (const c of CRATERS) {
      const bed = groundHeight(c.x, c.z);
      const lip = Math.max(...[0, 1, 2, 3, 4, 5].map((k) => groundHeight(c.x + Math.cos(k) * c.radius * 1.05, c.z + Math.sin(k) * c.radius * 1.05)));
      expect(lip - bed).toBeGreaterThan(c.depth * 0.8);
      // The bed is walkable, not a spike.
      expect(Math.abs(groundHeight(c.x + 3, c.z) - bed)).toBeLessThan(0.5);
    }
  });

  it('flattens every candidate pad and clearing whatever the seed', () => {
    for (const p of [...CATALOGUE.pads, ...CATALOGUE.blooms]) expect(FLAT_SPOTS.some((s) => dist(s, p) < 0.5), p.id).toBe(true);
  });

  it('lightens gravity inside the anomaly only', () => {
    const l = zone7Layout(3);
    const a = l.anomaly;
    expect(gravityAt(l, a.x, a.z)).toBeCloseTo(a.gravityMultiplier);
    expect(a.gravityMultiplier).toBeLessThan(1);
    expect(gravityAt(l, a.x + a.radius + 1, a.z)).toBe(1);
    const mid = gravityAt(l, a.x + a.radius * 0.8, a.z);
    expect(mid).toBeGreaterThan(a.gravityMultiplier);
    expect(mid).toBeLessThan(1);
  });
});

describe('seed 1', () => {
  it('is Design\'s RAID.larva layout, which the Raid uses until it reads the layout itself', () => {
    const l = zone7Layout(1);
    const bearings = l.extracts.map((e) => Math.round(((Math.atan2(e.x, -e.z) * 180) / Math.PI + 360) % 360));
    expect(bearings).toEqual(RAID.larva.extracts.map((e) => e.bearing));
  });
});
