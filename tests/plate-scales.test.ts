import { describe, expect, it } from 'vitest';
import { plate, rng } from '../src/creatures/parts';

// Rendering's organic note: plates overlap like scales, with lifted edges that show their thickness.
describe('armour plates lie like scales', () => {
  const rimHeight = (g: ReturnType<typeof plate>, l: number, sign: number) => {
    const pos = g.attributes.position;
    let best = -Infinity;
    for (let i = 0; i < pos.count; i++) if (sign * pos.getZ(i) > l * 0.85) best = Math.max(best, pos.getY(i));
    return best;
  };

  it('the trailing (+Z) edge lifts; the leading edge stays down', () => {
    const flat = plate(0.2, 0.2, 0.06, rng(3), 0.2, 0), lifted = plate(0.2, 0.2, 0.06, rng(3), 0.2, 0.6);
    expect(rimHeight(lifted, 0.2, 1) - rimHeight(flat, 0.2, 1)).toBeGreaterThan(0.06 * 0.25);
    expect(Math.abs(rimHeight(lifted, 0.2, -1) - rimHeight(flat, 0.2, -1))).toBeLessThan(0.06 * 0.05);
  });

  it('has an underside facing into the body', () => {
    const g = plate(0.2, 0.2, 0.06, rng(3));
    const n = g.attributes.normal;
    let down = 0;
    for (let i = 0; i < n.count; i++) if (n.getY(i) < -0.5) down++;
    expect(down).toBeGreaterThan(n.count * 0.3);
  });
});
