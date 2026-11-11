import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ALL_COLOURS } from '../src/render/palette';
import { GRADE_PRESETS } from '../src/render/presets';
import { capGeometry, floatingIslandGeometry, ribbonGeometry, stemGeometry } from '../src/render/geometry';
import { FLAT_SPOTS, groundHeight, isReserved, mulberry32, POOLS, poolLevel, scatterFungi } from '../src/world/zone7';

const palette = new Set(Object.values(ALL_COLOURS));

describe('grading presets', () => {
  it('only use Art Bible palette colours', () => {
    for (const [name, p] of Object.entries(GRADE_PRESETS)) {
      for (const k of ['shadow', 'highlight', 'hit'] as const) expect(palette.has(p[k]), `${name}.${k}`).toBe(true);
    }
  });
  it('keep bloom and exposure in a sane range', () => {
    for (const p of Object.values(GRADE_PRESETS)) {
      expect(p.bloom.strength).toBeGreaterThan(0);
      expect(p.bloom.strength).toBeLessThan(2);
      expect(p.exposure).toBeGreaterThan(0.3);
    }
  });
});

describe('procedural geometry', () => {
  it('fungus cap normals face up on top (lit from the sky, gills underneath)', () => {
    const g = capGeometry(16);
    const pos = g.attributes.position, n = g.attributes.normal;
    let topY = -Infinity, topN = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > topY) { topY = pos.getY(i); topN = n.getY(i); }
    expect(topN).toBeGreaterThan(0.9);
  });
  it('stems span unit height', () => {
    const box = new THREE.Box3().setFromBufferAttribute(stemGeometry().attributes.position as THREE.BufferAttribute);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(1);
  });
  it('floating islands hang below a flat top', () => {
    const box = new THREE.Box3().setFromBufferAttribute(floatingIslandGeometry(3).attributes.position as THREE.BufferAttribute);
    expect(box.max.y).toBeLessThan(0.4);
    expect(box.min.y).toBeLessThan(-1);
  });
  it('ribbons have two vertices per segment edge', () => {
    const curve = new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, -10, 0));
    expect(ribbonGeometry(curve, 2, 10).attributes.position.count).toBe(22);
  });
});

describe('zone 7 layout', () => {
  it('scatters flora deterministically and keeps big fungi out of gameplay spots', () => {
    const opts = { count: 200, minR: 5, maxR: 150, height: [5, 12] as [number, number], cap: [2, 5] as [number, number] };
    const a = scatterFungi(mulberry32(1), opts, groundHeight);
    const b = scatterFungi(mulberry32(1), opts, groundHeight);
    expect(a.map((f) => f.pos.x)).toEqual(b.map((f) => f.pos.x));
    for (const f of a) expect(isReserved(f.pos.x, f.pos.z)).toBe(false);
  });
  it('pools are not buried by the terrain', () => {
    for (const p of POOLS) expect(poolLevel(p)).toBeGreaterThan(groundHeight(p.x, p.z));
  });
  it('spawn has a clear eye-height line towards the extract beacon top', () => {
    const [s, e] = [FLAT_SPOTS[0], FLAT_SPOTS[1]];
    const from = new THREE.Vector3(s.x, groundHeight(s.x, s.z) + 1.7, s.z);
    const to = new THREE.Vector3(e.x, groundHeight(e.x, e.z) + 40, e.z);
    for (let t = 0.05; t < 1; t += 0.05) {
      const p = from.clone().lerp(to, t);
      expect(p.y, `t=${t.toFixed(2)}`).toBeGreaterThan(groundHeight(p.x, p.z));
    }
  });
});
