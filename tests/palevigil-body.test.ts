import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BOSSES } from '../data';
import { PaleVigil } from '../src/creatures/palevigil';

const run = (v: PaleVigil, secs: number) => { for (let t = 0; t < secs; t += 1 / 30) v.update(1 / 30); };
const spec = BOSSES.paleVigil as unknown as { size: { height: number; limbSpan: number; lureLength: number }; weakPoints: { spines: { count: number }; limbs: { count: number } } };
const CEILING = 16;
const onCeiling = (seed: number, scene?: THREE.Scene) => {
  const v = new PaleVigil(seed, scene);
  v.root.position.set(0, CEILING, 0);
  v.root.rotation.set(0, 0, Math.PI); // upside down: local +Y points away from the ceiling (down)
  v.plant();
  return v;
};

describe('The Pale Vigil body', () => {
  it('hangs about 7 m down from the ceiling, its lure hanging below it under gravity', () => {
    const v = onCeiling(1);
    v.drive.hanging = 0;
    run(v, 3);
    const box = new THREE.Box3().setFromObject(v.root);
    expect(box.max.y).toBeLessThanOrEqual(CEILING + 0.6);
    const drop = CEILING - box.min.y;
    expect(drop).toBeGreaterThan(spec.size.height * 0.8);
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    expect(span).toBeGreaterThan(spec.size.limbSpan * 0.7);
    // The lure falls toward the floor, well below its chest anchor, in world space.
    const lure = v.weakPoints[0].world;
    expect(lure.y).toBeLessThan(CEILING - 3.5);
    expect(lure.y).toBeGreaterThan(CEILING - 3.5 - spec.size.lureLength - 1);
  });

  it('carries the tags PvE AI asked for, with spines exposed only while hanging or rearing', () => {
    const v = onCeiling(2);
    run(v, 0.5);
    const count = (tag: string) => v.hitSpheres.filter((h) => h.tag === tag).length;
    expect(count('spine')).toBe(spec.weakPoints.spines.count);
    expect(count('limb')).toBe(spec.weakPoints.limbs.count);
    expect(count('lure')).toBe(1);
    expect(count('body')).toBe(1);
    expect(v.hitSpheres.find((h) => h.tag === 'lure')!.weak).toBe(true);
    const spines = () => v.hitSpheres.filter((h) => h.tag === 'spine');
    expect(spines().every((h) => h.r > 0)).toBe(true); // hanging: exposed
    v.drive.hanging = 0;
    run(v, 0.5);
    expect(spines().every((h) => h.r === 0)).toBe(true); // unfolded and calm: hidden
    v.drive.rear = 1;
    run(v, 0.2);
    expect(spines().every((h) => h.r > 0)).toBe(true); // rearing to shriek: exposed again
  });

  it('the front limb snatches at the strike point', () => {
    const v = onCeiling(3);
    v.drive.hanging = 0;
    run(v, 1);
    const target = new THREE.Vector3(1, CEILING - 7, 3);
    v.drive.strike = target;
    run(v, 1);
    const tip = v.limbs[0].lower.localToWorld(new THREE.Vector3(0, spec.size.limbSpan * 0.42, 0));
    expect(tip.distanceTo(target)).toBeLessThan(1.2);
  });

  it('limbs sever, the lure and spines pop, and it dies', () => {
    const v = onCeiling(4, new THREE.Scene());
    run(v, 0.3);
    v.sever('limb2');
    expect(v.limbsIntact).toBe(spec.weakPoints.limbs.count - 1);
    expect(v.hitSpheres.find((h) => h.tag === 'limb' && h.index === 2)!.r).toBe(0);
    v.popWeakPoint(0);
    expect(v.lureAlive).toBe(false);
    v.popWeakPoint(1);
    run(v, 0.2);
    expect(v.hitSpheres.find((h) => h.tag === 'spine' && h.index === 0)!.r).toBe(0);
    v.drive.phase = 'unravel';
    v.shriek();
    run(v, 0.5);
    v.destroy();
    expect(v.alive).toBe(false);
    expect(v.hitSpheres.every((h) => h.r === 0)).toBe(true);
  });
});
