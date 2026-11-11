import { describe, expect, it } from 'vitest';
import { HABITATS, RAID, ZONE7_SITES } from '../data';
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

describe('zone 1 structures', () => {
  it('keep the Hollow Spire and the Reliquary Bowl clear of every other site', () => {
    const others = [CATALOGUE.spawn, ...CATALOGUE.pads, ...CATALOGUE.pods, ...CATALOGUE.nests, ...CATALOGUE.blooms, ...CATALOGUE.anomalies];
    for (const s of others) {
      expect(dist(s, CATALOGUE.spire), s.id).toBeGreaterThan(CATALOGUE.spire.radius + 12);
      expect(dist(s, CATALOGUE.bowl), s.id).toBeGreaterThan(CATALOGUE.bowl.radius * 1.15 + 4);
      expect(dist(s, CATALOGUE.debris), s.id).toBeGreaterThan(CATALOGUE.debris.radius + 6);
    }
    for (const p of POOLS) expect(dist(p, CATALOGUE.debris)).toBeGreaterThan(p.radius + CATALOGUE.debris.radius);
    expect(Math.hypot(CATALOGUE.bowl.x, CATALOGUE.bowl.z) + CATALOGUE.bowl.radius).toBeLessThan(ISLAND_RADIUS * 0.84);
  });
  it('puts an extract pad within 80 m of the boss arena (Design: a winner can leave)', () => {
    expect(Math.min(...CATALOGUE.pads.map((p) => dist(p, CATALOGUE.bowl)))).toBeLessThan(80);
  });
  it('sinks the bowl by its depth and keeps its entrances walkable', () => {
    const floor = groundHeight(CATALOGUE.bowl.x, CATALOGUE.bowl.z);
    const rim = groundHeight(CATALOGUE.bowl.x, CATALOGUE.bowl.z + CATALOGUE.bowl.radius * 1.2);
    expect(rim - floor).toBeGreaterThan(CATALOGUE.bowl.depth * 0.6);
    // Along an entrance (local u = world x at yaw 0) the slope stays under 45 degrees.
    for (let r = 0; r < CATALOGUE.bowl.radius * 1.15; r += 1) {
      const a = groundHeight(CATALOGUE.bowl.x - r, CATALOGUE.bowl.z), b = groundHeight(CATALOGUE.bowl.x - r - 1, CATALOGUE.bowl.z);
      expect(Math.abs(b - a), `r=${r}`).toBeLessThan(1);
    }
  });
});

describe('zone landmarks', () => {
  it('resolve every Glowmire landmark Design lists that World has built', async () => {
    const { glowmireLandmarks } = await import('../src/world/zones');
    const ids = glowmireLandmarks().map((l) => l.id);
    for (const id of ['chitinTower', 'sunkenBowl', 'longSeedDebris', 'seedSpireNorth', 'seedSpireEast']) expect(ids).toContain(id);
  });
});

describe("Design's habitat bands on Glowmire Isle (data/habitats.json)", () => {
  type Band = { radius: [number, number]; bearing: [number, number] };
  const inBand = (p: { x: number; z: number }, b: Band) => {
    const r = Math.hypot(p.x, p.z) / RAID.playableRadius;
    const bearing = ((Math.atan2(p.x, -p.z) * 180) / Math.PI + 360) % 360;
    return r >= b.radius[0] && r <= b.radius[1] && bearing >= b.bearing[0] && bearing <= b.bearing[1];
  };
  const zone = HABITATS.zones.glowmireIsle ?? {};
  const bands = Object.values(zone).flatMap((h) => (h?.groups ?? []).map((g) => (g.where as { band?: Band }).band).filter((b): b is Band => !!b));

  it('gives every creature band a named area to live in', () => {
    expect(bands.length).toBeGreaterThan(0);
    const areas = ZONE7_SITES.areas.filter((a) => a.tag !== 'arena');
    for (const b of bands) expect(areas.some((a) => inBand(a, b)), JSON.stringify(b)).toBe(true);
  });

  it('puts a Bio-Pod in every band Design places one', () => {
    for (const l of HABITATS.loot.glowmireIsle ?? []) {
      const band = (l.at as { band?: Band }).band;
      if (!band) continue;
      expect(CATALOGUE.pods.filter((p) => p.type === l.container && inBand(p, band)).length, JSON.stringify(band)).toBeGreaterThanOrEqual(l.count);
    }
  });
});

describe('the Fungal Caves on Glowmire', () => {
  it('sits on one level floor across the chamber, tunnels and mouth', async () => {
    const { caveDistance } = await import('../src/world/cave');
    const c = ZONE7_SITES.caves[0];
    const floor = groundHeight(c.x, c.z);
    let n = 0;
    for (let x = c.x - 40; x <= c.x + 40; x += 1.5) for (let z = c.z - 40; z <= c.z + 40; z += 1.5) {
      if (caveDistance(c, x, z) > 0) continue;
      n++;
      expect(Math.abs(groundHeight(x, z) - floor), `${x},${z}`).toBeLessThan(0.35);
    }
    expect(n).toBeGreaterThan(400);
  });
});

describe('Glowmire ground ecology', () => {
  it('grows thicker by the water, thinner on steep ground, ridge crests and worn trails', async () => {
    const { zone7Ecology, TRAILS, POOLS: pools } = await import('../src/world/zone7');
    const eco = zone7Ecology();
    // Lush at a pool's edge, bare on the trail strip.
    const p = pools[0];
    const shore = eco.density(p.x + p.radius + 4, p.z);
    expect(shore).toBeGreaterThan(0.6);
    const mid = TRAILS[0][Math.floor(TRAILS[0].length / 2)];
    expect(eco.trailDist(mid[0], mid[1])).toBeLessThan(1);
    expect(eco.density(mid[0], mid[1])).toBeLessThan(0.2);
    // Steep cells are sparser than flat ones on average.
    let steep = 0, ns = 0, flat = 0, nf = 0;
    for (let x = -140; x <= 140; x += 3) for (let z = -140; z <= 140; z += 3) {
      if (Math.hypot(x, z) > 140) continue;
      const s = eco.slope(x, z), d = eco.density(x, z);
      if (s > 0.6) { steep += d; ns++; } else if (s < 0.1) { flat += d; nf++; }
    }
    expect(ns).toBeGreaterThan(10);
    expect(steep / ns).toBeLessThan((flat / nf) * 0.5);
  });

  it('links named areas with trails and keeps rock outcrops off trails, sites and caves', async () => {
    const { outcrops, onTrail, isReserved, TRAILS } = await import('../src/world/zone7');
    const { caveDistance } = await import('../src/world/cave');
    const { mulberry32 } = await import('../src/world/rng');
    expect(TRAILS.length).toBe(ZONE7_SITES.trails.length);
    const rocks = outcrops(mulberry32(5));
    expect(rocks.length).toBeGreaterThan(ZONE7_SITES.outcrops.clusters);
    for (const r of rocks) {
      expect(onTrail(r.x, r.z), `${r.x},${r.z}`).toBe(false);
      expect(isReserved(r.x, r.z)).toBe(false);
      for (const c of ZONE7_SITES.caves) expect(caveDistance(c, r.x, r.z)).toBeGreaterThan(0);
    }
  });
});
