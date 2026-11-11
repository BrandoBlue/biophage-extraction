import { describe, expect, it } from 'vitest';
import { AI, RAID } from '../data';
import { HabitatPlanner, habitatTags, type Habitat } from '../src/ai/habitats';
import { interimHabitats } from '../src/game/habitats';
import { zone7Layout } from '../src/world/layout';
import { BOWL } from '../src/world/zone7';
import { mulberry32 } from '../src/world/zone7';

const areas: Habitat[] = [
  { id: 'g0', tag: 'grove', x: 50, z: 0, radius: 10 },
  { id: 'g1', tag: 'grove', x: -50, z: 0, radius: 10 },
  { id: 'g2', tag: 'grove', x: 0, z: 8, radius: 10 },
  { id: 'p0', tag: 'pool', x: 0, z: 80, radius: 12 },
  { id: 'c0', tag: 'crater', x: 0, z: -60, radius: 15 },
];

describe('habitats: monsters live where they belong', () => {
  it('every Abomination kind with a brain has a habitat in data', () => {
    for (const kind of Object.keys(AI.archetypes)) expect(habitatTags(kind).length, kind).toBeGreaterThan(0);
  });

  it('places a kind in its preferred areas, falls back to its next tag, and gives up when the zone has none', () => {
    const h = new HabitatPlanner(areas, mulberry32(1));
    const s = h.place('needlemaw', { x: 0, z: 0 }, 20)!;
    expect(s.area.tag).toBe('grove');
    expect(Math.hypot(s.x - s.area.x, s.z - s.area.z)).toBeLessThanOrEqual(s.area.radius * AI.habitats.spread + 1e-6);
    // Bile Cantors prefer ridges; there are none, so they take the pool.
    expect(h.place('bilecantor', { x: 0, z: 0 }, 20)!.area.id).toBe('p0');
    // Mournbacks need open ground.
    expect(h.place('mournback', { x: 0, z: 0 }, 20)).toBeNull();
  });

  it('keeps clear of the host spawn and spreads packs across their areas', () => {
    const h = new HabitatPlanner(areas, mulberry32(2));
    const ids = Array.from({ length: 4 }, () => h.place('needlemaw', { x: 0, z: 0 }, 20)!.area.id);
    expect(ids).not.toContain('g2'); // its edge is inside the spawn clearance
    expect(new Set(ids.slice(0, 2))).toEqual(new Set(['g0', 'g1']));
  });

  it('reinforcements come from the nearest area of their kind that is far enough from the host', () => {
    const h = new HabitatPlanner(areas, mulberry32(3));
    expect(h.nearest('needlemaw', { x: 45, z: 0 }, 25)!.area.id).toBe('g2');
    expect(h.nearest('needlemaw', { x: 45, z: 0 }, 60)!.area.id).toBe('g1');
  });

  it('Zone 7 has groves, pools, interiors, craters and open ground, and none of it in the boss bowl', () => {
    const list = interimHabitats(zone7Layout(1), RAID.playableRadius);
    for (const tag of ['grove', 'pool', 'interior', 'crater', 'open']) expect(list.some((a) => a.tag === tag), tag).toBe(true);
    for (const a of list.filter((x) => x.tag === 'open')) expect(Math.hypot(a.x - BOWL.x, a.z - BOWL.z)).toBeGreaterThan(BOWL.radius);
    const h = new HabitatPlanner(list, mulberry32(4));
    const spawn = zone7Layout(1).spawn;
    for (const kind of ['needlemaw', 'bilecantor', 'glasswalker', 'oculimoth', 'mournback']) expect(h.place(kind, spawn, 30), kind).not.toBeNull();
  });

  it('a zone without named areas (the Wreck, for now) keeps the old placement', () => {
    expect(interimHabitats({ ...zone7Layout(1), area: { x0: -10, x1: 10, z0: -5, z1: 5 } }, 100)).toEqual([]);
    const given: Habitat[] = [{ id: 'room', tag: 'interior', x: 0, z: 0, radius: 4 }];
    expect(interimHabitats({ ...zone7Layout(1), habitats: given }, 100)).toBe(given);
  });
});
