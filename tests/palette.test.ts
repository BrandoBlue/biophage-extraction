import { describe, expect, it } from 'vitest';
import { ALL_COLOURS } from '../src/render/palette';
import { groundHeight, mulberry32 } from '../src/world/zone7';
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
  it('has a walkable centre and falls away at the rim', () => {
    expect(Math.abs(groundHeight(0, 0))).toBeLessThan(3);
    expect(groundHeight(70, 0)).toBeLessThan(-5);
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
