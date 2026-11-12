import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { STEP_HEIGHT, type Vec3Like } from '../src/world/collision';
import { buildWreck, WRECK, wreckLandmarkAt } from '../src/world/wreck';
import { SOLIDS, groundHeight, setTerrain } from '../src/world/zone7';
import { ZONES, LOOT } from '../data';

const scene = new THREE.Scene();
const world = buildWreck(scene, 3);
afterAll(() => setTerrain(null));

/** Walks a 0.4 m capsule through waypoints the way the Player does: push out of walls, then settle on floors. */
function walk(start: Vec3Like, path: [number, number][], step = 0.15): Vec3Like {
  const p = { ...start };
  for (const [tx, tz] of path) {
    for (let i = 0; i < 2000; i++) {
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      p.x += (dx / d) * Math.min(step, d); p.z += (dz / d) * Math.min(step, d);
      SOLIDS.collide(p, 0.4, 1.8);
      const f = SOLIDS.floorAt(p.x, p.z, p.y);
      if (f >= p.y - STEP_HEIGHT * 4) p.y = f;
    }
  }
  return p;
}
const near = (p: Vec3Like, x: number, z: number) => Math.hypot(p.x - x, p.z - z);

describe('the Wreck of the Long Seed', () => {
  it('is a flat deck map with its own spawn outside the prow and the prow extract open', () => {
    expect(groundHeight(10, 10)).toBe(0);
    expect(world.layout.spawn.x).toBeGreaterThan(WRECK.hull.halfLength);
    expect(world.layout.extracts[0]).toMatchObject({ id: 'breachedProw', opensAt: 0 });
    expect(world.layout.extracts[1].opensAt).toBe(Infinity);
    expect(world.layout.area).toBeDefined();
  });

  it('walks from the spawn through the prow and both holds, the warrens and the gallery into the reactor', () => {
    const s = world.layout.spawn;
    const p = walk({ x: s.x, y: 0, z: s.z }, [[100, 0], [70, 0], [36, 0], [0, 0], [-35, 0], [-62, 0], [-74, 0]]);
    expect(near(p, -74, 0)).toBeLessThan(0.5);
    expect(p.y).toBeLessThan(0.1);
  });

  it('climbs the Hold A ramp to the north catwalk and crosses into the upper warren deck', () => {
    const top = walk({ x: 37, y: 0, z: 12 }, [[39, 12], [54.6, 12], [54.6, 17], [36, 17], [20, 17], [-1.5, 17], [-1.5, 0], [-20, 0]]);
    expect(top.y).toBeCloseTo(WRECK.hull.deck, 1);
    expect(near(top, -20, 0)).toBeLessThan(0.5);
  });

  it('climbs the reactor ramp onto the catwalk ring', () => {
    const r = WRECK.reactor;
    const p = walk({ x: -64, y: 0, z: 0 }, [[-64, 13], [r.x + 1, 13], [r.x, r.ringRadius]]);
    expect(p.y).toBeCloseTo(WRECK.hull.deck, 1);
    expect(world.valves).toHaveLength(r.valves);
    for (const v of world.valves) expect(SOLIDS.floorAt(v.x, v.z, v.y + 1)).toBeCloseTo(v.y, 1);
  });

  it('stands every loot spot on a floor, clear of walls, with a real container type', () => {
    for (const l of world.structures.loot) {
      expect(LOOT.containers[l.container!], l.id).toBeDefined();
      expect(SOLIDS.floorAt(l.x, l.z, l.y + 1), l.id).toBeCloseTo(l.y, 1);
      const probe = { x: l.x, y: l.y, z: l.z };
      SOLIDS.collide(probe, 0.4, 1.8);
      expect(near(probe, l.x, l.z), l.id).toBeLessThan(0.05);
    }
    const containers = world.structures.loot.reduce<Record<string, number>>((n, l) => ({ ...n, [l.container!]: (n[l.container!] ?? 0) + 1 }), {});
    expect(containers).toEqual(ZONES.longSeedWreck.containers);
  });

  it('names every Design landmark, and the pod bay wins over the reactor around it', () => {
    const ids = WRECK.rooms.map((r) => r.id).sort();
    expect(ids).toEqual([...(ZONES.longSeedWreck.landmarks ?? [])].sort());
    expect(wreckLandmarkAt(-88, -16)).toBe('escapePodBay');
    expect(wreckLandmarkAt(-88, 10)).toBe('reactorChamber');
    expect(wreckLandmarkAt(50, 0)).toBe('cargoHoldA');
    expect(wreckLandmarkAt(300, 0)).toBeNull();
  });
});

describe("the Warden's reactor-chamber arena", () => {
  const a = world.warden;
  it('exposes the room, core, valves, cover, catwalks, spawn and exits', () => {
    const r = WRECK.reactor;
    expect(world.structures.warden).toBe(a);
    expect(a.x1 - a.x0).toBeGreaterThan(30);
    expect(a.ceiling).toBe(WRECK.hull.height);
    expect(a.core).toEqual({ x: r.x, z: r.z, radius: r.coreRadius });
    expect(a.valves).toHaveLength(4);
    expect(a.pillars.length).toBeGreaterThanOrEqual(2);
    expect(new Set(a.catwalks.map((c) => c.level))).toEqual(new Set([1, 2]));
    for (const e of a.exits) expect(Math.hypot(e.x - r.x, e.z - r.z)).toBeLessThan(60);
    a.vent(0);
    a.vent(0, false);
  });

  it('shield pillars block a body and the core pulse line', () => {
    const q = a.pillars[0];
    const dx = q.x - a.core.x, dz = q.z - a.core.z, d = Math.hypot(dx, dz);
    const beyond = { x: a.core.x + (dx / d) * (d + 3), y: 1, z: a.core.z + (dz / d) * (d + 3) };
    expect(SOLIDS.blocked({ x: a.core.x + (dx / d) * (a.core.radius + 0.5), y: 1, z: a.core.z + (dz / d) * (a.core.radius + 0.5) }, beyond)).not.toBeNull();
  });

  it('drops a catwalk segment out from under a body when it collapses', () => {
    const r = WRECK.reactor;
    const east = a.catwalks.find((c) => c.id === 'ring-east')!;
    const x = r.x + r.ringRadius, z = r.z;
    expect(SOLIDS.floorAt(x, z, WRECK.hull.deck + 1)).toBeCloseTo(WRECK.hull.deck, 1);
    east.collapse();
    expect(east.collapsed).toBe(true);
    expect(SOLIDS.floorAt(x, z, WRECK.hull.deck + 1)).toBeLessThan(1);
  });
});
