import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { STEP_HEIGHT } from '../src/world/collision';
import {
  BIOMES, EXPANSE, EXPANSE_RADIUS, POOL_LEVEL, bridgeSpans, buildExpanse, chasmAt, chasmLip, expanseGround, expanseLandmarkAt, expanseLayout, rivalSpawns,
} from '../src/world/expanse';
import { SOLIDS, climbBlocked, groundHeight, setTerrain } from '../src/world/zone7';
import { BUILT_ZONES, buildZone } from '../src/world/zones';
import { planHabitats } from '../src/game/habitats';
import { RAID } from '../data';

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
      expect(l.extracts).toHaveLength(4);
      expect(l.extracts.filter((e) => e.opensAt === 0)).toHaveLength(RAID.host.extracts.openAtStart);
      expect(l.extracts.map((e) => e.opensAt)).toEqual([0, 0, 300, 600]);
      for (const e of l.extracts) expect(Math.hypot(e.x, e.z)).toBeGreaterThan(400);
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
