import { describe, expect, it } from 'vitest';
import { ALL_COLOURS } from '../src/render/palette';
import { FLAT_SPOTS, groundHeight, ISLAND_RADIUS, mulberry32 } from '../src/world/zone7';
import classes from '../data/classes.json';

describe('art bible palette', () => {
  it('uses six-digit hex colours only', () => {
    for (const [name, hex] of Object.entries(ALL_COLOURS)) expect(hex, name).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('zone 7', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(7), b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('keeps gameplay spots flat and walls the basin with mountains at the rim', () => {
    for (const s of FLAT_SPOTS) {
      const h = groundHeight(s.x, s.z);
      for (let a = 0; a < 8; a++) expect(Math.abs(groundHeight(s.x + Math.cos(a) * s.radius * 0.8, s.z + Math.sin(a) * s.radius * 0.8) - h), s.name).toBeLessThan(0.3);
    }
    // Past the walkable edge the ground climbs into the mountains that ring the basin, all the way round.
    for (let a = 0; a < 16; a++) {
      const at = (r: number) => groundHeight(Math.cos(a) * ISLAND_RADIUS * r, Math.sin(a) * ISLAND_RADIUS * r);
      expect(at(1.1) - at(0.8)).toBeGreaterThan(15);
    }
  });
});

describe('class data', () => {
  it('orders the hosts light to heavy', () => {
    const { venomWraith: l, neuroInfiltrator: m, goreBehemoth: h } = classes;
    expect(l.moveSpeed).toBeGreaterThan(m.moveSpeed);
    expect(m.moveSpeed).toBeGreaterThan(h.moveSpeed);
    expect(h.biomass).toBeGreaterThan(m.biomass);
    expect(m.biomass).toBeGreaterThan(l.biomass);
  });
});
