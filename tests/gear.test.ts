import { describe, expect, it } from 'vitest';
import { MARKET } from '../data';
import { Grenade, grenadeRules, huskRules, Mine, mineRules, throwVelocity } from '../src/game/gear';

const flat = () => 0;

describe('Flesh Market gear', () => {
  it('reads gear numbers from market.json', () => {
    expect(grenadeRules().fuse).toBe(MARKET.contraband.neuroSpikeGrenade.fuse);
    expect(mineRules().triggerRadius).toBe(MARKET.contraband.mawSeedMine.triggerRadius);
    expect(huskRules().reviveFraction).toBeGreaterThan(0);
    expect(huskRules().reviveDelay).toBeGreaterThan(0);
  });

  it('a grenade arcs, settles on the ground and explodes when its fuse runs out', () => {
    const g = new Grenade({ x: 0, y: 1.6, z: 0 }, throwVelocity({ x: 0, y: 0, z: -1 }));
    let t = 0, boom = false, maxY = 0;
    while (!boom && t < 10) { boom = g.update(0.02, flat); t += 0.02; maxY = Math.max(maxY, g.pos.y); }
    expect(boom).toBe(true);
    expect(t).toBeCloseTo(grenadeRules().fuse, 1);
    expect(maxY).toBeGreaterThan(1.6);
    expect(g.pos.z).toBeLessThan(-5);
    expect(g.pos.y).toBeGreaterThanOrEqual(0);
  });

  it('grenade damage falls off to half at the edge and zero outside', () => {
    const g = new Grenade({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const r = grenadeRules();
    expect(g.damageAt(0)).toBe(r.damage);
    expect(g.damageAt(r.radius)).toBeCloseTo(r.damage / 2);
    expect(g.damageAt(r.radius + 0.1)).toBe(0);
  });

  it('a mine ignores targets until armed, then fires once', () => {
    const m = new Mine({ x: 0, y: 0, z: 0 });
    const near = [{ x: 0.5, y: 0, z: 0 }];
    expect(m.update(mineRules().armTime / 2, near)).toBe(-1);
    expect(m.update(mineRules().armTime, near)).toBe(-1); // this step finishes arming
    expect(m.armed).toBe(true);
    expect(m.update(0.1, [{ x: 50, y: 0, z: 0 }])).toBe(-1);
    expect(m.update(0.1, near)).toBe(0);
    expect(m.update(0.1, near)).toBe(-1);
  });
});
