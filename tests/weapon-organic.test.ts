import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WEAPON_BODIES, createWeaponBody, ring, stalk, type WeaponId } from '../src/creatures/weapons/bodies';

// Brandon (2026-11-12): "less geometric, more organic". Weapon rings and stalks are grown, not machined.
describe('weapon bodies are grown, not machined', () => {
  it('a ring wanders: its tube thickness and its plane vary around the loop', () => {
    const g = ring(0.05, 0.006, 4, 12);
    const pos = g.attributes.position;
    let zMin = Infinity, zMax = -Infinity;
    const radii: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      zMin = Math.min(zMin, pos.getZ(i)); zMax = Math.max(zMax, pos.getZ(i));
      radii.push(Math.hypot(pos.getX(i), pos.getY(i)));
    }
    expect(pos.count).toBeGreaterThanOrEqual(11 * 19); // round tube (never 4 sides), at least 18 around
    expect(zMax - zMin).toBeGreaterThan(0.006 * 2 * 1.15); // thicker than a flat torus in places, or lifted off its plane
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.006 * 2);
  });

  it('a stalk has rounded rims, not a hard-edged cylinder', () => {
    const g = stalk(0.01, 0.012, 0.03);
    const raw = new THREE.CylinderGeometry(0.01, 0.012, 0.03, 14, 3);
    raw.computeBoundingBox(); g.computeBoundingBox();
    // Rounding pulls the rim corners in: no vertex sits at the raw cylinder's sharp top-rim corner.
    const pos = g.attributes.position;
    let cornerHits = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.0148 && Math.hypot(pos.getX(i), pos.getZ(i)) > 0.0099) cornerHits++;
    expect(cornerHits).toBe(0);
    expect(g.attributes.normal).toBeTruthy();
  });

  it('no weapon body keeps a raw cylinder or box part', () => {
    for (const id of WEAPON_BODIES) {
      const body = createWeaponBody(id as WeaponId);
      body.gun.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) expect(['CylinderGeometry', 'BoxGeometry'], `${id}:${m.name}`).not.toContain(m.geometry.type);
      });
    }
  });
});
