import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { STEP_HEIGHT, type Vec3Like } from '../src/world/collision';
import { buildOchre, OCHRE_ZONE as D, ochreGround, ochreLandmarkAt, slopeAt } from '../src/world/ochre';
import { SOLIDS, groundHeight, setTerrain } from '../src/world/zone7';
import { ABOMINATIONS, LOOT } from '../data';
import { SPECIES } from '../src/creatures/species';

const scene = new THREE.Scene();
const world = buildOchre(scene, 2);
afterAll(() => setTerrain(null));

/** Walks a 0.4 m capsule through waypoints the way the Player does: push out of walls, then settle on floors. */
function walk(start: Vec3Like, path: [number, number][], step = 0.15): Vec3Like {
  const p = { ...start };
  for (const [tx, tz] of path) {
    for (let i = 0; i < 4000; i++) {
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      p.x += (dx / d) * Math.min(step, d); p.z += (dz / d) * Math.min(step, d);
      SOLIDS.collide(p, 0.4, 1.8);
      p.y = SOLIDS.floorAt(p.x, p.z, p.y + STEP_HEIGHT);
    }
  }
  return p;
}
const near = (p: Vec3Like, x: number, z: number) => Math.hypot(p.x - x, p.z - z);

describe('the Ochre Reach', () => {
  it('is an 800 m map on its own ground, walled by escarpments past the edge', () => {
    expect(groundHeight(123, -45)).toBeCloseTo(ochreGround(123, -45), 6);
    expect(world.layout.playableRadius).toBe(400);
    for (let a = 0; a < 12; a++) {
      const at = (r: number) => ochreGround(Math.cos(a) * r, Math.sin(a) * r);
      expect(at(560) - at(380)).toBeGreaterThan(30);
    }
  });

  it('keeps the village, the rig yard, the spawn and every extract flat', () => {
    for (const f of [...D.flats, ...D.extracts.map((e) => ({ ...e, radius: 8 }))]) {
      const h = ochreGround(f.x, f.z);
      for (let a = 0; a < 8; a++) expect(Math.abs(ochreGround(f.x + Math.cos(a) * f.radius * 0.8, f.z + Math.sin(a) * f.radius * 0.8) - h)).toBeLessThan(0.35);
    }
  });

  it('has real dunes in the Dune Sea and a cut gulch through the mesa', () => {
    const ds = D.landmarks.duneSea;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 60; i++) { const h = ochreGround(ds.x - 60 + i * 2, ds.z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    expect(hi - lo).toBeGreaterThan(4);
    const [gx, gz] = D.gulch.path[2];
    expect(ochreGround(D.gulch.plateau.x - 40, D.gulch.plateau.z + 60) - ochreGround(gx, gz)).toBeGreaterThan(10);
  });

  it('names Design’s landmarks where they stand', () => {
    for (const [id, l] of Object.entries(D.landmarks)) expect(ochreLandmarkAt(l.x, l.z)).toBe(id);
    expect(world.landmarkAt(D.spawn.x, D.spawn.z)).toBeNull();
  });

  it('lets the host walk from the plaza through a hut door and stops it at the wall', () => {
    const elder = D.village.huts[0], plaza = D.village.plaza;
    const start = { x: plaza.x, y: ochreGround(plaza.x, plaza.z), z: plaza.z - 6 };
    const inside = walk(start, [[elder.x, elder.z + elder.r + 2], [elder.x, elder.z]]);
    expect(near(inside, elder.x, elder.z)).toBeLessThan(0.5);
    // From inside, walking straight out the back is blocked by the wall.
    const back = walk(inside, [[elder.x, elder.z - elder.r - 4]]);
    expect(back.z).toBeGreaterThan(elder.z - elder.r);
  });

  it('climbs the lookout ramp onto the deck', () => {
    const L = D.rig.lookout, yaw = (L.yaw * Math.PI) / 180;
    const at = (u: number) => [L.x + u * Math.cos(yaw), L.z - u * Math.sin(yaw)] as [number, number];
    const [sx, sz] = at(-21);
    const p = walk({ x: sx, y: ochreGround(sx, sz), z: sz }, [at(-12), at(0)]);
    expect(p.y - ochreGround(L.x, L.z)).toBeCloseTo(L.deck, 0);
  });

  it('stands every loot spot on a floor with a real container type', () => {
    expect(world.structures.loot.length).toBeGreaterThanOrEqual(10);
    for (const l of world.structures.loot) {
      expect(LOOT.containers[l.container ?? 'bioPod'], l.id).toBeDefined();
      expect(Math.abs(SOLIDS.floorAt(l.x, l.z, l.y + 0.5) - l.y), l.id).toBeLessThan(0.3);
    }
  });

  it('places every creature at a fixed home inside the map, burrowers on their mounds', () => {
    const spawns = world.layout.spawns!;
    expect(spawns.length).toBe(D.spawns.length);
    for (const s of spawns) {
      expect(ABOMINATIONS[s.kind as keyof typeof ABOMINATIONS], s.kind).toBeDefined();
      expect(s.kind in SPECIES, `${s.kind} has a body`).toBe(true);
      expect(Math.hypot(s.x, s.z)).toBeLessThan(D.playableRadius - 10);
      expect(Math.hypot(s.x - D.spawn.x, s.z - D.spawn.z)).toBeGreaterThan(60);
      if (s.buried) expect(D.burrows.some((b) => Math.hypot(b.x - s.x, b.z - s.z) < 1)).toBe(true);
    }
    // Most of the Dune Sea's life waits under the sand.
    const dune = spawns.filter((s) => ochreLandmarkAt(s.x, s.z) === 'duneSea');
    expect(dune.filter((s) => s.buried).length).toBeGreaterThanOrEqual(4);
  });

  it('opens two extracts at the start and a third later, all inside the map on gentle ground', () => {
    const ex = world.layout.extracts;
    expect(ex.filter((e) => e.opensAt <= 0)).toHaveLength(2);
    expect(ex.some((e) => e.opensAt > 0)).toBe(true);
    for (const e of ex) { expect(Math.hypot(e.x, e.z)).toBeLessThan(D.playableRadius); expect(slopeAt(e.x, e.z)).toBeLessThan(0.1); }
  });

  it('grows trees on the flats and grass only where the ground is flat and not dune', () => {
    const grass = scene.getObjectByName('dry-grass') as THREE.InstancedMesh;
    expect(grass.count).toBeGreaterThan(3000);
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    let inDunes = 0;
    for (let i = 0; i < grass.count; i += 7) {
      grass.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      if (Math.hypot(p.x - D.landmarks.duneSea.x, p.z - D.landmarks.duneSea.z) < D.landmarks.duneSea.radius * 0.6) inDunes++;
    }
    expect(inDunes).toBe(0);
    let flatsTrees = 0;
    for (let k = 0; k < 3; k++) {
      const t = scene.getObjectByName(`thorn-trunks-${k}`) as THREE.InstancedMesh;
      for (let i = 0; i < t.count; i++) { t.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (ochreLandmarkAt(p.x, p.z) === 'acaciaFlats') flatsTrees++; }
    }
    expect(flatsTrees).toBeGreaterThanOrEqual(D.trees.acaciaFlats * 0.8);
  });
});

describe('the Skyfall Crater (Sandwidow arena)', () => {
  const w = world.structures.widow!;
  it('exposes fixed pillars that are solid rocks a host can stand on', () => {
    expect(w.id).toBe('skyfallCrater');
    expect(w.pillars.map((p) => p.id)).toEqual(D.crater.pillars.map((p) => p.id));
    for (const p of w.pillars) {
      expect(Math.hypot(p.x - w.x, p.z - w.z)).toBeLessThan(w.radius * 0.65);
      expect(p.top).toBeGreaterThan(groundHeight(p.x, p.z) + 1.5);
      expect(SOLIDS.floorAt(p.x, p.z, p.top + 0.5)).toBeCloseTo(p.top, 1);
    }
  });
  it('opens three cuts through the rim lip and keeps rubble out of them', () => {
    expect(w.entrances).toHaveLength(3);
    for (const e of w.entrances) {
      const a = Math.atan2(e.z - w.z, e.x - w.x), at = (r: number) => groundHeight(w.x + Math.cos(a) * r, w.z + Math.sin(a) * r);
      const side = (r: number) => groundHeight(w.x + Math.cos(a + 0.5) * r, w.z + Math.sin(a + 0.5) * r);
      // The lip stands on the rim elsewhere but is gone in the cut.
      expect(side(w.radius * 1.05) - at(w.radius * 1.05)).toBeGreaterThan(2);
      // Walk in: no step on the way down is higher than the host can take.
      for (let r = w.radius * 1.3; r > w.radius * 0.3; r -= 1) expect(Math.abs(at(r) - at(r - 1))).toBeLessThan(STEP_HEIGHT);
    }
    expect(w.floorY).toBeLessThan(groundHeight(w.entrances[0].x, w.entrances[0].z) - 5);
  });
});
