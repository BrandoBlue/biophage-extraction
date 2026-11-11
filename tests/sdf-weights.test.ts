import { describe, expect, it } from 'vitest';
import { SPECIES_IDS, planFor } from '../src/creatures/species';
import { meshSdf } from '../src/creatures/sdf';

describe('SDF skin weights', () => {
  // A NaN weight puts the vertex nowhere and the GPU drops the whole body skin (bodies with fewer than 4 bones).
  it.each(SPECIES_IDS)('%s skin weights are finite and sum to 1', (id) => {
    const plan = planFor(id, 3, 0);
    const sdf = meshSdf(plan.skin, plan.bones.length, { resolution: 24, noise: { ...plan.skinNoise, seed: 3 } });
    for (let i = 0; i < sdf.skinWeight.length; i += 4) {
      const w = [0, 1, 2, 3].map((k) => sdf.skinWeight[i + k]);
      expect(w.every(Number.isFinite)).toBe(true);
      expect(Math.abs(w.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-4);
    }
  });
});
