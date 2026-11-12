import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { STEP_HEIGHT } from '../src/world/collision';
import {
  BIOMES, EXPANSE, EXPANSE_RADIUS, POOL_LEVEL, bridgeSpans, buildExpanse, chasmAt, chasmLip, expanseGround, expanseLandmarkAt, expanseLayout, rivalSpawns, OUTPOSTS, reachIsland, HULL, HULL_BULKHEADS, HULL_GALLERY_Y, hullAt,
} from '../src/world/expanse';
import { SOLIDS, climbBlocked, groundHeight, setTerrain } from '../src/world/zone7';
import { BUILT_ZONES, buildZone } from '../src/world/zones';
import { planHabitats } from '../src/game/habitats';
import { RAID } from '../data';
import { LOOKOUT_Y } from '../src/world/outposts';
import type { Vec3Like } from '../src/world/collision';

const scene = new THREE.Scene();
const t0 = performance.now();
const world = buildExpanse(scene, 3);
const buildMs = performance.now() - t0;
afterAll(() => setTerrain(null));

describe('The Expanse layout', () => {
  it('drops the host into the Flats away from the pools and opens two rim extracts, then one every shift', () => {
    const spawns = new Set<string>();
    for (let s = 1; s <= 40; s++) {
      const l = expanseLayout(s);
      expect(expanseLandmarkAt(l.spawn.x, l.spawn.z)).toBe('glowmireFlats');
      for (const p of EXPANSE.flats.pools) expect(Math.hypot(l.spawn.x - p.x, l.spawn.z - p.z)).toBeGreaterThan(p.r + 8);
      spawns.add(`${l.spawn.x.toFixed(1)},${l.spawn.z.toFixed(1)}`);
      const rim = l.extracts.filter((e) => !e.costDna), paid = l.extracts.filter((e) => e.costDna);
      expect(rim).toHaveLength(4);
      expect(rim.filter((e) => e.opensAt === 0)).toHaveLength(RAID.host.extracts.openAtStart);
      expect(rim.map((e) => e.opensAt)).toEqual([0, 0, 300, 600]);
      for (const e of rim) expect(Math.hypot(e.x, e.z)).toBeGreaterThan(400);
      // Design's paid tether: open from the start, inside the map at bearing 140, with its own price and channel.
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ opensAt: 0, costDna: RAID.host.extracts.paidExtract.costDna, time: RAID.host.extracts.paidExtract.extractTime });
      expect(Math.hypot(paid[0].x, paid[0].z)).toBeCloseTo(EXPANSE_RADIUS * 0.3, 0);
      expect(l.playableRadius).toBe(500);
      expect(l.nests.map((n) => n.type)).toEqual(['broodHeart', 'broodHeart']);
      expect(l.spawns).toBeUndefined(); // creatures come from the biome habitats
    }
    expect(spawns.size).toBeGreaterThanOrEqual(4);
    for (const p of rivalSpawns()) expect(Math.hypot(p.x, p.z)).toBeCloseTo(EXPANSE_RADIUS * RAID.host.spawns.radius, 3);
  });

  it('gives every Expanse habitat group a home in its biome', () => {
    const l = expanseLayout(1);
    const homes = planHabitats({ zone: 'expanse', playable: EXPANSE_RADIUS, extract: l.extracts[0], pods: l.pods, rand: () => 0.5 }, 'host');
    expect(homes.length).toBeGreaterThan(10);
    for (const h of homes) {
      expect(expanseLandmarkAt(h.home.x, h.home.z)).not.toBeNull();
      expect(chasmAt(h.home.x, h.home.z).d).toBeGreaterThan(chasmAt(h.home.x, h.home.z).halfWidth + h.home.spread * 0.5);
    }
  });

  it('names the biome at each biome centre', () => {
    for (const [id, b] of Object.entries(BIOMES)) expect(expanseLandmarkAt(b.x, b.z)).toBe(id);
    expect(expanseLandmarkAt(300, 300)).toBeNull();
  });

  it('is a registered zone', () => {
    expect(BUILT_ZONES).toContain('expanse');
  });
});

describe('The Expanse ground', () => {
  it('shapes each biome: marsh basin, raised plateau, furrow, crater bowls, deep rift', () => {
    const F = BIOMES.glowmireFlats, S = BIOMES.chitinSpires;
    expect(expanseGround(S.x, S.z) - expanseGround(F.x, F.z)).toBeGreaterThan(6);
    for (const p of EXPANSE.flats.pools) expect(expanseGround(p.x, p.z)).toBeLessThan(POOL_LEVEL - 0.3);
    const W = EXPANSE.wreck, mx = (W.from.x + W.to.x) / 2, mz = (W.from.z + W.to.z) / 2;
    const nx = -(W.to.z - W.from.z), nz = W.to.x - W.from.x, n = Math.hypot(nx, nz);
    const bank = expanseGround(mx + (nx / n) * W.furrowWidth * 0.62, mz + (nz / n) * W.furrowWidth * 0.62);
    expect(bank - expanseGround(mx, mz)).toBeGreaterThan(W.furrowDepth);
    for (const c of EXPANSE.brood.craters) expect(expanseGround(c.x + c.r * 1.05, c.z) - expanseGround(c.x, c.z)).toBeGreaterThan(c.d * 0.8);
    const mid = EXPANSE.chasm.points[2];
    const c = chasmAt(mid.x, mid.z);
    expect(expanseGround(mid.x, mid.z)).toBeLessThan(expanseGround(mid.x - c.tz * 40, mid.z + c.tx * 40) - 75);
    expect(expanseGround(400, 400)).toBeGreaterThan(30); // the rim beyond the corner
  });

  it('keeps extract pads and spawn points level', () => {
    const l = expanseLayout(5);
    for (const p of [...l.extracts, l.spawn, ...rivalSpawns()]) {
      const y = expanseGround(p.x, p.z);
      for (let a = 0; a < 6.28; a += 0.7) expect(Math.abs(expanseGround(p.x + Math.cos(a) * 5, p.z + Math.sin(a) * 5) - y)).toBeLessThan(0.05);
    }
  });

  it('walls the rift: its sides are too steep to climb, but both ends ramp down to a walkable floor', () => {
    const P = EXPANSE.chasm.points;
    const mid = chasmAt(P[2].x, P[2].z);
    const floor = expanseGround(mid.cx, mid.cz);
    // Climbing straight out of the middle is blocked.
    let blocked = false;
    for (let d = 0; d < 30 && !blocked; d += 0.5) {
      const x0 = mid.cx - mid.tz * d, z0 = mid.cz + mid.tx * d;
      const y = expanseGround(x0, z0);
      blocked = climbBlocked(y, x0, z0, x0 - mid.tz * 0.5, z0 + mid.tx * 0.5);
    }
    expect(blocked).toBe(true);
    // Walking the centre line in from either end never meets a climb the map forbids.
    for (const [a, b] of [[P[0], P[1]], [P[P.length - 1], P[P.length - 2]]]) {
      const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      for (let t = -30; t < len; t += 0.5) {
        const x0 = a.x + ux * t, z0 = a.z + uz * t;
        expect(climbBlocked(expanseGround(x0, z0), x0 + ux * 0.5, z0 + uz * 0.5, x0, z0)).toBe(false); // walking back out
      }
    }
    expect(floor).toBeLessThan(expanseGround(P[0].x, P[0].z) - 70);
  });
});

describe('The Expanse crossings', () => {
  it('spans the rift with bridges square to it, landing on both banks', () => {
    const spans = bridgeSpans();
    expect(spans).toHaveLength(EXPANSE.chasm.bridges.length);
    for (const s of spans) {
      for (const [x, z] of [[s.x0, s.z0], [s.x1, s.z1]]) expect(chasmAt(x, z).d).toBeGreaterThan(chasmAt(x, z).halfWidth);
      const mx = (s.x0 + s.x1) / 2, mz = (s.z0 + s.z1) / 2;
      expect(expanseGround(mx, mz)).toBeLessThan(Math.min(s.y0, s.y1) - 40);
    }
  });

  it('carries a host across each bridge without falling into the rift', () => {
    for (const s of bridgeSpans()) {
      const p = { x: s.x0, y: s.y0, z: s.z0 };
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0, len = Math.hypot(dx, dz);
      let lowest = Infinity;
      for (let t = 0; t <= len; t += 0.15) {
        p.x = s.x0 + (dx / len) * t; p.z = s.z0 + (dz / len) * t;
        p.y = SOLIDS.floorAt(p.x, p.z, p.y + STEP_HEIGHT);
        lowest = Math.min(lowest, p.y);
      }
      expect(lowest).toBeGreaterThan(Math.min(s.y0, s.y1) - 1);
      expect(p.y).toBeGreaterThan(s.y1 - 0.5);
    }
  });

  it('lines the deep rift with a lip that stops a walker at the edge, open where the bridges land', () => {
    const lip = chasmLip();
    expect(lip.length).toBeGreaterThan(80);
    for (const s of bridgeSpans()) {
      for (const p of lip) {
        const dx = s.x1 - s.x0, dz = s.z1 - s.z0, t = Math.max(0, Math.min(1, ((p.x - s.x0) * dx + (p.z - s.z0) * dz) / (dx * dx + dz * dz)));
        expect(Math.hypot(p.x - s.x0 - dx * t, p.z - s.z0 - dz * t)).toBeGreaterThan(s.width / 2);
      }
    }
    // Walk from the bank at the rift's middle straight at the edge: the lip stops the host on the bank.
    const P = EXPANSE.chasm.points[2], c = chasmAt(P.x, P.z);
    const sx = c.cx - c.tz * 40, sz = c.cz + c.tx * 40;
    const p = { x: sx, y: groundHeight(sx, sz), z: sz };
    for (let i = 0; i < 400; i++) {
      p.x += c.tz * 0.15; p.z -= c.tx * 0.15;
      SOLIDS.collide(p, 0.4, 1.8);
      p.y = SOLIDS.floorAt(p.x, p.z, p.y + STEP_HEIGHT);
    }
    expect(chasmAt(p.x, p.z).d).toBeGreaterThan(c.halfWidth);
    expect(p.y).toBeGreaterThan(groundHeight(sx, sz) - 8);
  });
});

describe('The Expanse build', () => {
  it('builds in good time with loot in its structures and the biomes in the scene', () => {
    expect(buildMs).toBeLessThan(8000);
    expect(world.layout.playableRadius).toBe(500);
    expect(world.structures.loot.length).toBeGreaterThan(4);
    expect(scene.getObjectByName('ground')).toBeTruthy();
    expect(scene.getObjectByName('chasm-bridge')).toBeTruthy();
    expect(scene.getObjectByName('expanse-structures')).toBeTruthy();
    // Every loot spot stands on a floor, not in the air or under the ground.
    for (const l of world.structures.loot) expect(Math.abs(SOLIDS.floorAt(l.x, l.z, l.y + 0.5) - l.y)).toBeLessThan(0.6);
  });

  it('is what buildZone builds for the expanse id', () => {
    const w = buildZone(new THREE.Scene(), 'expanse', 4);
    expect(w.zone).toBe('expanse');
    expect(w.layout.playableRadius).toBe(500);
  });
});

/** Walks a 0.4 m capsule through waypoints the way the Player does: push out of walls, then settle on floors. */
function walk(start: Vec3Like, path: [number, number][], step = 0.15): Vec3Like {
  const p = { ...start };
  for (const [tx, tz] of path) {
    for (let i = 0; i < 4000; i++) {
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      p.x += (dx / d) * Math.min(step, d); p.z += (dz / d) * Math.min(step, d);
      SOLIDS.collide(p, 0.4, 1.8);
      p.y = SOLIDS.floorAt(p.x, p.z, p.y + STEP_HEIGHT);
    }
  }
  return p;
}

describe('The Expanse between the biomes', () => {
  it('leaves no stretch of the playable map far from something worth reaching', () => {
    const l = world.layout;
    const poi = [...world.structures.loot, ...l.pods, ...l.extracts, ...l.nests];
    const allBlooms = EXPANSE.blooms.at.map(([x, z]) => ({ x, z }));
    let worst = 0;
    for (let x = -460; x <= 460; x += 20) for (let z = -460; z <= 460; z += 20) {
      if (Math.hypot(x, z) > 450 || chasmAt(x, z).d < chasmAt(x, z).halfWidth) continue;
      worst = Math.max(worst, Math.min(...[...poi, ...allBlooms].map((p) => Math.hypot(p.x - x, p.z - z))));
    }
    expect(worst).toBeLessThan(150);
  });

  it('grows a seeded handful of Gene Blooms on the routes', () => {
    const a = expanseLayout(1).nodes, b = expanseLayout(2).nodes;
    expect(a).toHaveLength(EXPANSE.blooms.perRaid);
    expect(a.map((n) => n.id)).not.toEqual(b.map((n) => n.id));
  });

  it('lets a host walk into a survey camp\'s roofed room and up its lookout', () => {
    const o = OUTPOSTS.find((s) => s.type === 'camp')!;
    const yaw = (o.yaw * Math.PI) / 180, at = (u: number, v: number): [number, number] => [o.x + u * Math.cos(yaw) + v * Math.sin(yaw), o.z - u * Math.sin(yaw) + v * Math.cos(yaw)];
    const base = groundHeight(o.x, o.z);
    const [sx, sz] = at(0, -12);
    // In through the north door to the roofed west room.
    const inside = walk({ x: sx, y: base, z: sz }, [at(0, -7), at(0, -2), at(-5, -2)]);
    expect(Math.hypot(inside.x - at(-5, -2)[0], inside.z - at(-5, -2)[1])).toBeLessThan(0.5);
    expect(SOLIDS.ceilingAt(inside.x, inside.z, inside.y + 1)).toBeLessThan(base + 4);
    // Through the partition doorway, out the east door and up the ramp to the lookout.
    const up = walk(inside, [at(-3, 2.4), at(4, 2.4), at(4, 0), at(8.5, 0), at(18.5, 0)]);
    expect(up.y).toBeCloseTo(base + LOOKOUT_Y, 0);
  });

  it('carries a host along the span to the island in the rift, and its cache sits there', () => {
    const R = reachIsland();
    const p = walk({ x: R.span.x1, y: R.span.y1, z: R.span.z1 }, [[R.span.x0, R.span.z0], [R.x, R.z]]);
    expect(Math.hypot(p.x - R.x, p.z - R.z)).toBeLessThan(0.5);
    expect(p.y).toBeGreaterThan(R.top - 0.3);
    expect(world.structures.loot.find((l) => l.id === 'chasm-reach-cache')?.container).toBe(R.container);
  });

  it('lets a host walk into the Long Seed through its torn front, through both bulkheads and up to the reactor gallery', () => {
    const L = HULL.len, sb = HULL_BULKHEADS[1] * L, floor = groundHeight(HULL.x, HULL.z);
    const [fx, fz] = hullAt(-L / 2 - 6, 0);
    const route: [number, number][] = [hullAt(-L / 2 + 2, 0), hullAt(HULL_BULKHEADS[0] * L + 2, 0), hullAt(sb + 0.5, 0), hullAt(sb + 0.5, -9), hullAt(sb + 10, -9), hullAt(L / 2 - 3, -6)];
    const p = walk({ x: fx, y: groundHeight(fx, fz), z: fz }, route);
    const [ex, ez] = route[route.length - 1];
    expect(Math.hypot(p.x - ex, p.z - ez)).toBeLessThan(0.5);
    expect(p.y).toBeCloseTo(floor + HULL_GALLERY_Y, 0);
    expect(world.structures.loot.filter((l) => l.id.startsWith('hull-'))).toHaveLength(4);
  });
});
