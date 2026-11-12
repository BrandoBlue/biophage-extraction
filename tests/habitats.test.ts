import { describe, expect, it } from 'vitest';
import { HABITATS, ZONE_SITES } from '../data';
import { planHabitats, resolveWhere, usesHabitats, type HabitatMap } from '../src/game/habitats';
import { glowmireLandmarks } from '../src/world/zones';

const map = (zone: string): HabitatMap => {
  let s = 1;
  return { zone, playable: 150, extract: { x: 40, z: -60 }, pods: [{ type: 'bioPod', x: 10, z: 10 }, { type: 'bioPod', x: -30, z: 20 }], rand: () => ((s = (s * 16807) % 2147483647) / 2147483647) };
};

describe('creature habitats', () => {
  it('places every built-zone group at its home, never at random', () => {
    expect(usesHabitats('glowmireIsle')).toBe(true);
    const plan = planHabitats(map('glowmireIsle'));
    const kinds = new Set(plan.map((g) => g.kind));
    for (const k of ['needlemaw', 'bilecantor', 'oculimoth', 'mournback']) expect(kinds.has(k)).toBe(true);
    // The Long Seed debris pack sits on the debris landmark.
    const debris = glowmireLandmarks().find((l) => l.id === 'longSeedDebris')!;
    const pack = plan.find((g) => g.kind === 'needlemaw' && 'landmark' in g.group.where)!;
    expect(Math.hypot(pack.home.x - debris.x, pack.home.z - debris.z)).toBeLessThan(1e-6);
    // Band groups land inside their bearing wedge.
    for (const g of plan.filter((p) => 'band' in p.group.where)) {
      const band = (g.group.where as { band: { radius: [number, number]; bearing: [number, number] } }).band;
      const r = Math.hypot(g.home.x, g.home.z) / 150;
      expect(r).toBeGreaterThanOrEqual(band.radius[0] - 1e-6);
      expect(r).toBeLessThanOrEqual(band.radius[1] + 1e-6);
      const bearing = ((Math.atan2(g.home.x, -g.home.z) * 180) / Math.PI + 360) % 360;
      expect(bearing).toBeGreaterThanOrEqual(band.bearing[0] - 1e-3);
      expect(bearing).toBeLessThanOrEqual(band.bearing[1] + 1e-3);
    }
    // Guards stand by a pod; an unbuilt landmark falls back.
    const guard = plan.find((g) => 'guards' in g.group.where)!;
    expect(Math.min(...map('x').pods.map((p) => Math.hypot(guard.home.x - p.x, guard.home.z - p.z)))).toBeLessThan(5.01);
    const cave = HABITATS.zones.glowmireIsle!.glasswalker!.groups.find((g) => 'landmark' in g.where && g.where.landmark === 'fungalCaves');
    if (cave?.fallback) expect(plan.some((g) => g.group === cave)).toBe(true);
  });

  it('puts the Long Seed crew in their rooms and leaves later-milestone groups out', () => {
    const rooms = (ZONE_SITES.longSeedWreck as { rooms: { id: string; x0: number; x1: number; z0: number; z1: number }[] }).rooms;
    const plan = planHabitats(map('longSeedWreck'), 'larva');
    expect(plan.length).toBeGreaterThan(0);
    for (const g of plan) {
      const id = (g.group.where as { room?: string }).room;
      if (!id) continue;
      const r = rooms.find((q) => q.id === id)!;
      expect(g.home.x).toBeGreaterThanOrEqual(r.x0); expect(g.home.x).toBeLessThanOrEqual(r.x1);
      expect(g.home.z).toBeGreaterThanOrEqual(r.z0); expect(g.home.z).toBeLessThanOrEqual(r.z1);
      expect(g.group.milestone === 'host').toBe(false);
    }
    expect(resolveWhere({ room: 'cargoHoldA' }, map('glowmireIsle'))).toBeNull();
  });
});
