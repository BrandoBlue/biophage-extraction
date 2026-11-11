import { describe, expect, it } from 'vitest';
import { CollisionWorld, STEP_HEIGHT, type Vec3Like } from '../src/world/collision';
import { hollowSpire, longSeedDebris, reliquaryBowl } from '../src/world/structures';

const flat = () => 0;

/** A crude walker: steps toward each waypoint, pushed by walls, standing on whatever floor is under it. */
function walk(w: CollisionWorld, start: Vec3Like, path: [number, number][], step = 0.15): Vec3Like {
  const p = { ...start };
  for (const [tx, tz] of path) {
    for (let i = 0; i < 400; i++) {
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      p.x += (dx / d) * Math.min(step, d); p.z += (dz / d) * Math.min(step, d);
      w.collide(p, 0.4, 1.8);
      p.y = w.floorAt(p.x, p.z, p.y);
    }
  }
  return p;
}

describe('collision world', () => {
  it('walls block a body; it slides out on the near side', () => {
    const w = new CollisionWorld(flat);
    w.add({ cx: 0, cz: 0, hx: 5, hz: 0.3, yaw: 0, y0: 0, y1: 3 });
    const p = walk(w, { x: 0, y: 0, z: 3 }, [[0, -3]]);
    expect(p.z).toBeGreaterThan(0.6);
  });
  it('a body steps onto a low deck and a ramp carries it up', () => {
    const w = new CollisionWorld(flat);
    w.add({ cx: 0, cz: 0, hx: 4, hz: 1, yaw: 0, y0: 0, y1: 4, rise: 4 });
    w.add({ cx: 6, cz: 0, hx: 2, hz: 2, yaw: 0, y0: 3.6, y1: 4 });
    const p = walk(w, { x: -6, y: 0, z: 0 }, [[6, 0]]);
    expect(p.y).toBeCloseTo(4);
    expect(w.floorAt(6, 0, 0)).toBe(0); // from the ground, the deck is overhead, not a floor
    expect(w.ceilingAt(6, 0, 0)).toBeCloseTo(3.6);
  });
  it('does not climb a sheer side', () => {
    const w = new CollisionWorld(flat);
    w.add({ cx: 0, cz: 0, hx: 2, hz: 2, yaw: 0.4, y0: 0, y1: STEP_HEIGHT + 0.3 });
    const p = walk(w, { x: -5, y: 0, z: 0 }, [[0, 0]]);
    expect(p.y).toBe(0);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(2);
  });
  it('finds the first blocker on a sight line', () => {
    const w = new CollisionWorld(flat);
    w.add({ cx: 5, cz: 0, hx: 0.5, hz: 3, yaw: 0, y0: 0, y1: 3 });
    expect(w.blocked({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 })).toBeCloseTo(0.45);
    expect(w.blocked({ x: 0, y: 4, z: 0 }, { x: 10, y: 4, z: 0 })).toBeNull();
    expect(w.blocked({ x: 0, y: 1, z: 5 }, { x: 10, y: 1, z: 5 })).toBeNull();
  });
  it('queries only nearby colliders', () => {
    const w = new CollisionWorld(flat);
    for (let i = 0; i < 200; i++) w.add({ cx: (i % 20) * 30, cz: Math.floor(i / 20) * 30, hx: 1, hz: 1, yaw: 0, y0: 0, y1: 2 });
    expect(w.near(0, 0, 2).length).toBeLessThan(4);
  });
});

describe('the Hollow Spire', () => {
  for (const yaw of [0, 1.1]) {
    it(`can be entered by its door and climbed to the top deck (yaw ${yaw})`, () => {
      const w = new CollisionWorld(flat);
      const s = hollowSpire(w, 20, -10, yaw, flat);
      const at = (u: number, v: number): [number, number] => [20 + u * Math.cos(yaw) + v * Math.sin(yaw), -10 - u * Math.sin(yaw) + v * Math.cos(yaw)];
      const [sx, sz] = at(0, 14);
      const p = walk(w, { x: sx, y: 0, z: sz }, [at(0, 5), at(4.6, 3.2), at(4.6, -4.5), at(0, -4.6), at(-4.6, -3.2), at(-4.6, 4.4), at(2, 4.6)]);
      expect(p.y).toBeCloseTo(10, 1);
      const roost = walk(w, p, [at(4.6, 2.6), at(4.6, -5.8), at(0, -5.6)]);
      expect(roost.y).toBeCloseTo(15, 1);
      expect(s.loot.map((l) => l.id)).toEqual(['spire-ground', 'spire-mid', 'spire-top', 'spire-roost']);
      for (const l of s.loot) expect(w.floorAt(l.x, l.z, l.y), l.id).toBeCloseTo(l.y, 1);
    });
  }
  it('keeps you out except through a door', () => {
    const w = new CollisionWorld(flat);
    hollowSpire(w, 0, 0, 0, flat);
    const p = walk(w, { x: 14, y: 0, z: 0 }, [[0, 0]]);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(7.5);
  });
});

describe('the Reliquary Bowl', () => {
  it('has two entrances you can walk through and walls elsewhere', () => {
    const w = new CollisionWorld(flat);
    const { arena } = reliquaryBowl(w, 0, 0, 0, 30, 0, flat);
    expect(arena.entrances).toHaveLength(2);
    expect(arena.pillars).toHaveLength(4);
    for (const e of arena.entrances) {
      const p = walk(w, { x: e.x * 1.3, y: 0, z: e.z * 1.3 }, [[0, -3]]);
      expect(Math.hypot(p.x, p.z + 3)).toBeLessThan(1);
    }
    const blocked = walk(w, { x: 0, y: 0, z: -40 }, [[0, -3]]);
    expect(Math.hypot(blocked.x, blocked.z)).toBeGreaterThan(20);
  });
});

describe('the Reliquary arena hooks', () => {
  it('reports the ledge where its colliders stand, at any yaw', () => {
    for (const yaw of [0, 1.1]) {
      const w = new CollisionWorld(flat);
      const { arena } = reliquaryBowl(w, 5, -7, yaw, 30, 0, flat);
      const mid = (arena.ledge.innerR + arena.ledge.outerR) / 2;
      // Local +v (the north half) is world (sin yaw, cos yaw) from the centre.
      const on = { x: 5 + Math.sin(yaw) * mid, z: -7 + Math.cos(yaw) * mid };
      expect(arena.onLedge(on.x, on.z)).toBe(true);
      expect(w.floorAt(on.x, on.z, 10)).toBeCloseTo(arena.ledge.y, 1);
      expect(arena.onLedge(5 - Math.sin(yaw) * mid, -7 - Math.cos(yaw) * mid)).toBe(false);
      expect(arena.onLedge(5, -7)).toBe(false);
    }
  });
  it('destroys a pillar: it stops blocking and reports broken', () => {
    const w = new CollisionWorld(flat);
    const { arena } = reliquaryBowl(w, 0, 0, 0, 30, 0, flat);
    const p = arena.pillars[0];
    expect(p.broken).toBe(false);
    const through = (): number => { const s = walk(w, { x: p.x - 4, y: 0, z: p.z }, [[p.x + 4, p.z]]); return s.x; };
    expect(through()).toBeLessThan(p.x);
    p.destroy();
    expect(p.broken).toBe(true);
    expect(through()).toBeGreaterThan(p.x + 2);
  });
});

describe('the Long Seed debris field', () => {
  it('has hull tunnels you can walk through end to end, and crates with loot', () => {
    const w = new CollisionWorld(flat);
    const d = longSeedDebris(w, 0, 0, 0, flat);
    // The largest section lies along local v at u = -6 (yaw 0.15): walk its length.
    const along = (f: number): [number, number] => [-6 + Math.sin(0.15) * f, -4 + Math.cos(0.15) * f];
    const start = along(-10);
    const p = walk(w, { x: start[0], y: 0, z: start[1] }, [along(10)]);
    expect(Math.hypot(p.x - along(10)[0], p.z - along(10)[1])).toBeLessThan(0.5);
    // Its sides block a body walking across it.
    const side = walk(w, { x: -14, y: 0, z: -4 }, [[-6, -4]]);
    expect(side.x).toBeLessThan(-9);
    expect(d.loot.some((l) => l.id === 'debris-blackbox')).toBe(true);
    expect(d.loot.length).toBeGreaterThanOrEqual(4);
  });
});
