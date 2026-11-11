import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { meshSdf, traceSkin, type SdfPrim } from '../src/creatures/sdf';
import { planFor, SPECIES_IDS } from '../src/creatures/species';
import { Creature } from '../src/creatures/creature';
import { solveTwoBone } from '../src/creatures/ik';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('SDF skin', () => {
  const sphere: SdfPrim[] = [{ shape: 'ellipsoid', a: V(0, 0, 0), radii: V(0.5, 0.5, 0.5), bone: 0 }];

  it('meshes a sphere onto its surface with outward normals and winding', () => {
    const { geometry } = meshSdf(sphere, 1, { resolution: 24 });
    const p = geometry.attributes.position, n = geometry.attributes.normal;
    expect(p.count).toBeGreaterThan(200);
    for (let i = 0; i < p.count; i += 7) {
      const v = V(p.getX(i), p.getY(i), p.getZ(i));
      expect(Math.abs(v.length() - 0.5)).toBeLessThan(0.03);
      expect(V(n.getX(i), n.getY(i), n.getZ(i)).dot(v.normalize())).toBeGreaterThan(0.9);
    }
    // Triangle winding agrees with the gradient normals (front faces face out).
    const idx = geometry.index!;
    let agree = 0, total = 0;
    for (let t = 0; t < idx.count; t += 3 * 5) {
      const a = V(p.getX(idx.getX(t)), p.getY(idx.getX(t)), p.getZ(idx.getX(t)));
      const b = V(p.getX(idx.getX(t + 1)), p.getY(idx.getX(t + 1)), p.getZ(idx.getX(t + 1)));
      const c = V(p.getX(idx.getX(t + 2)), p.getY(idx.getX(t + 2)), p.getZ(idx.getX(t + 2)));
      const face = b.clone().sub(a).cross(c.clone().sub(a));
      if (face.dot(a.clone().add(b).add(c)) > 0) agree++;
      total++;
    }
    expect(agree / total).toBeGreaterThan(0.98);
  });

  it('traces the skin from outside', () => {
    const hit = traceSkin(sphere, V(0, 3, 0), V(0, -1, 0))!;
    expect(hit.at.y).toBeCloseTo(0.5, 1);
    expect(hit.normal.y).toBeGreaterThan(0.95);
  });
});

describe('two-bone IK', () => {
  it('lands the chain end on a reachable target', () => {
    const a = new THREE.Bone(), b = new THREE.Bone(), tip = new THREE.Bone();
    b.position.y = 1; tip.position.y = 1;
    a.add(b); b.add(tip);
    const scene = new THREE.Group();
    scene.add(a);
    scene.updateMatrixWorld(true);
    const target = V(0.8, -0.9, 0.4);
    expect(solveTwoBone(a, b, 1, 1, target, V(0, 1, 0))).toBe(0);
    scene.updateMatrixWorld(true);
    expect(tip.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-3);
    // Knee bends toward the pole.
    expect(b.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(-0.45);
  });
});

describe('species generator', () => {
  it.each(SPECIES_IDS)('%s is deterministic and every stage only adds to the last', (id) => {
    const a = planFor(id, 42, 0), b = planFor(id, 42, 0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (let s = 1; s <= 3; s++) {
      const prev = planFor(id, 42, s - 1), next = planFor(id, 42, s);
      const ids = new Set(next.parts.map((p) => p.id));
      for (const p of prev.parts) expect(ids.has(p.id)).toBe(true);
      expect(next.parts.length + next.limbs.length).toBeGreaterThan(prev.parts.length + prev.limbs.length);
      // Old parts are unchanged.
      const before = JSON.stringify(prev.parts), after = JSON.stringify(next.parts.slice(0, prev.parts.length));
      expect(after).toBe(before);
    }
  });

  it.each(SPECIES_IDS)('%s builds a skinned rig with a weak point and walks without NaNs', (id) => {
    const c = new Creature(id, 7, 0);
    expect(c.rig.mesh.geometry.attributes.position.count).toBeGreaterThan(500);
    expect(c.rig.hits.some((h) => h.spec.weak)).toBe(true);
    c.drive.velocity.set(0, 0, 2);
    for (let i = 0; i < 60; i++) {
      c.root.position.addScaledVector(c.drive.velocity, 1 / 30);
      c.update(1 / 30);
    }
    for (const h of c.rig.hits) expect(Number.isFinite(h.world.x + h.world.y + h.world.z)).toBe(true);
    for (const b of c.rig.skeleton.bones) expect(Number.isFinite(b.quaternion.x + b.quaternion.w)).toBe(true);
  });

  it('feet stay planted while a walker stands still', () => {
    const c = new Creature('mournback', 3, 0);
    c.update(1 / 30);
    const foot = c.rig.limbs.get('legL0')!.bones.at(-1)!.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 30; i++) c.update(1 / 30);
    const after = c.rig.limbs.get('legL0')!.bones.at(-1)!.getWorldPosition(new THREE.Vector3());
    expect(after.distanceTo(foot)).toBeLessThan(0.05);
    expect(after.y).toBeLessThan(0.1);
  });
});

describe('creature under a moving parent', () => {
  it('rides terrain height in world space when parented to a raised group', () => {
    const parent = new THREE.Group();
    parent.position.set(5, 12, -3);
    const c = new Creature('needlemaw', 2, 0);
    c.ground = () => 12;
    parent.add(c.root);
    parent.updateMatrixWorld(true);
    c.plant();
    for (let i = 0; i < 10; i++) c.update(1 / 30);
    const body = c.rig.bones[0].getWorldPosition(new THREE.Vector3());
    expect(body.y - 12).toBeGreaterThan(c.plan.bodyHeight * 0.6);
    expect(body.y - 12).toBeLessThan(c.plan.bodyHeight * 1.4);
  });
});
