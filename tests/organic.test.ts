import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { organicBox, roughen } from '../src/world/organic';

function extent(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  return geo.boundingBox!;
}

describe('organic shaping', () => {
  it('stays close to the box collider it dresses', () => {
    for (const [hu, hy, hv] of [[4, 3, 0.3], [0.8, 0.6, 0.6], [30, 9, 0.5], [2, 0.05, 2]]) {
      const bb = extent(organicBox(hu, hy, hv, { seed: 7, flatTop: true }));
      expect(bb.max.x).toBeLessThan(hu + 0.6);
      expect(bb.min.x).toBeGreaterThan(-hu - 0.6);
      expect(bb.max.z).toBeLessThan(hv + 0.6);
      expect(bb.max.x).toBeGreaterThan(hu * 0.85);
      expect(bb.max.y).toBeCloseTo(hy, 3);
      expect(bb.min.y).toBeCloseTo(-hy, 3);
    }
  });

  it('keeps a walkable top flat, and roughs up a broken one', () => {
    const flat = organicBox(3, 2, 3, { seed: 2, flatTop: true });
    const p = flat.attributes.position;
    let topFlat = 0, topCount = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getX(i)) < 2 && Math.abs(p.getZ(i)) < 2 && p.getY(i) > 1.5) { topCount++; if (Math.abs(p.getY(i) - 2) < 1e-6) topFlat++; }
    }
    expect(topCount).toBeGreaterThan(0);
    expect(topFlat).toBe(topCount);
    const ragged = extent(organicBox(10, 4, 0.4, { seed: 2, flatTop: false }));
    expect(ragged.max.y).toBeLessThan(4);
    // Unset: a low slab stays flat, a tall wall grows a crest above its collider but never dips below it.
    expect(extent(organicBox(2, 0.5, 2, { seed: 1 })).max.y).toBeCloseTo(0.5, 3);
    expect(extent(organicBox(3, 3, 2, { seed: 1 })).max.y).toBeCloseTo(3, 3); // a tall block you might stand on
    const crest = organicBox(6, 3, 0.4, { seed: 1 });
    expect(extent(crest).max.y).toBeGreaterThan(3.05);
    expect(extent(crest).max.y).toBeLessThan(3.6);
  });

  it('never tears seams: vertices that started together stay together', () => {
    const plain = new THREE.BoxGeometry(6, 4, 2, 9, 6, 3);
    const shaped = organicBox(3, 2, 1, { seed: 5 });
    const a = plain.attributes.position, b = shaped.attributes.position;
    const seen = new Map<string, string>();
    for (let i = 0; i < a.count; i++) {
      const key = `${a.getX(i).toFixed(4)},${a.getY(i).toFixed(4)},${a.getZ(i).toFixed(4)}`;
      const val = `${b.getX(i).toFixed(4)},${b.getY(i).toFixed(4)},${b.getZ(i).toFixed(4)}`;
      if (seen.has(key)) expect(seen.get(key)).toBe(val);
      else seen.set(key, val);
    }
  });

  it('is deterministic and amount 0 is a clean box', () => {
    const a = organicBox(2, 1, 2, { seed: 9 }).attributes.position.array;
    const b = organicBox(2, 1, 2, { seed: 9 }).attributes.position.array;
    expect(Array.from(a)).toEqual(Array.from(b));
    const clean = extent(organicBox(2, 1, 2, { amount: 0 }));
    expect(clean.max.x).toBe(2);
    expect(clean.max.z).toBe(2);
  });

  it('roughens a column without leaving its footprint', () => {
    const col = roughen(new THREE.CylinderGeometry(1.1, 1.4, 18, 14, 10), 0.7, 3);
    const bb = extent(col);
    expect(bb.max.x).toBeLessThan(1.4 + 1.2);
    expect(bb.min.x).toBeGreaterThan(-1.4 - 1.2);
    expect(bb.max.y).toBeCloseTo(9, 3);
    const p = col.attributes.position;
    let moved = 0;
    for (let i = 0; i < p.count; i++) if (Math.abs(Math.hypot(p.getX(i), p.getZ(i)) - (1.25 - (p.getY(i) / 18) * 0.3)) > 0.02) moved++;
    expect(moved).toBeGreaterThan(p.count / 2);
  });
});
