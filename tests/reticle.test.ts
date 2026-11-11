import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../data';
import { RETICLE_BY_CLASS, coneRadius, gunOf, spreadNow } from '../src/ui/raid/reticle';

describe('living reticle', () => {
  it('has a mark for every weapon class in data/weapons.json', () => {
    for (const [id, w] of Object.entries(WEAPONS as Record<string, { class?: string }>)) {
      if (!w || typeof w !== 'object' || !w.class) continue;
      expect(RETICLE_BY_CLASS[w.class], `${id} (${w.class})`).toBeDefined();
      expect(gunOf(id).shape).toBe(RETICLE_BY_CLASS[w.class]);
    }
  });

  it('projects the cone through the FOV: 0 at 0 deg, half the height at the FOV edge', () => {
    expect(coneRadius(0, 75, 1080)).toBe(0);
    expect(coneRadius(37.5, 75, 1080)).toBeCloseTo(540, 5);
    expect(coneRadius(1.6, 75, 1080)).toBeGreaterThan(coneRadius(1.6, 90, 1080));
  });

  it('tightens with aim, opens with movement and recoil bloom', () => {
    const g = gunOf('synapseBurster');
    const hip = spreadNow(g, 0, 0, 0);
    expect(hip).toBeCloseTo(g.hip);
    expect(spreadNow(g, 1, 0, 0)).toBeCloseTo(g.ads);
    expect(spreadNow(g, 0, 1, 0)).toBeCloseTo(g.hip * g.moving);
    expect(spreadNow(g, 0, 0, 0.5)).toBeCloseTo(hip + 0.5);
  });

  it('knows which guns look through an eye scope', () => {
    expect(gunOf('eyestalkMarksman').scope).toBe(true);
    expect(gunOf('leviathanQuill').scope).toBe(true);
    expect(gunOf('synapseBurster').scope).toBe(false);
    expect(gunOf('gulletScatter').scope).toBe(false);
  });
});
