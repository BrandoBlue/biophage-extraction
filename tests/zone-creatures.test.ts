import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Creature } from '../src/creatures/creature';
import { SPECIES_IDS } from '../src/creatures/species';
import { ZONE_SPECIES } from '../src/creatures/zones';
import { Sandwidow } from '../src/creatures/zones/sandwidow';

const run = (c: { update(dt: number): void }, secs: number, each?: (t: number) => void) => { for (let t = 0; t < secs; t += 1 / 30) { each?.(t); c.update(1 / 30); } };
const bone = (c: Creature, n: string) => c.rig.bones.find((b) => b.name === n)!;
const worldY = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).y;

describe('new-zone creatures', () => {
  it('registers every zone species with the shared generator', () => {
    for (const id of Object.keys(ZONE_SPECIES)) expect(SPECIES_IDS).toContain(id);
  });

  it('every zone species has an eye cluster, a weak point and stays inside the draw budget', () => {
    for (const id of Object.keys(ZONE_SPECIES) as (keyof typeof ZONE_SPECIES)[]) {
      const c = new Creature(id, 3, 0);
      run(c, 0.3);
      const eyes = [...c.rig.parts.values()].filter((p) => p.spec.type === 'eye').length;
      expect(eyes, id).toBeGreaterThanOrEqual(5);
      expect(c.rig.hits.some((h) => h.spec.weak), id).toBe(true);
      let meshes = 0;
      c.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
      expect(meshes, id).toBeLessThan(80);
    }
  });

  it('a Dunewake dives head first, swims under the sand leaving a ripple line, and bursts out', () => {
    const c = new Creature('dunewake', 7, 0);
    run(c, 0.2);
    const head = bone(c, 'head'), tail = bone(c, `spine7`);
    expect(worldY(head)).toBeGreaterThan(0);
    // Dive: halfway through, the head is deeper than the tail.
    run(c, 0.25, (t) => { c.drive.burrow = Math.min(1, t / 0.5); });
    expect(worldY(head)).toBeLessThan(worldY(tail));
    run(c, 0.6, () => { c.drive.burrow = 1; });
    expect(worldY(head)).toBeLessThan(-0.2);
    expect(worldY(tail)).toBeLessThan(0);
    // Swimming under: ripples appear on the surface along its path.
    const motion = (c as unknown as { motion: { fx: { active: number } } }).motion;
    run(c, 1, (t) => { c.drive.velocity.set(0, 0, 8); c.root.position.z = t * 8; });
    expect(motion.fx.active).toBeGreaterThan(2);
    // Surfacing: the head breaks out before the tail.
    c.drive.velocity.set(0, 0, 0);
    run(c, 0.2, (t) => { c.drive.burrow = 1 - t / 0.5; });
    expect(worldY(head)).toBeGreaterThan(worldY(tail));
    run(c, 1, () => { c.drive.burrow = 0; });
    expect(worldY(tail)).toBeGreaterThan(0);
  });

  it('a Dunewake rears into an S and splits its jaw on the strike', () => {
    const c = new Creature('dunewake', 7, 0);
    run(c, 0.2);
    const jaw = c.rig.parts.get('jaw0')!.mesh;
    const q0 = jaw.quaternion.clone();
    c.drive.windup = 1;
    run(c, 0.6);
    expect(worldY(bone(c, 'head'))).toBeGreaterThan(0.45);
    expect(jaw.quaternion.angleTo(q0)).toBeGreaterThan(0.4);
  });

  it('a Bristleback racks its quills, sloshes its cistern and grazes', () => {
    const c = new Creature('bristleback', 7, 0);
    run(c, 1.5);
    const neck = bone(c, 'neck');
    const grazing = neck.quaternion.clone();
    const quill = bone(c, 'quillL');
    c.drive.excite = 1; c.drive.windup = 1;
    run(c, 0.6);
    expect(quill.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.3);
    expect(neck.quaternion.angleTo(grazing)).toBeGreaterThan(0.2);
    // Running then stopping hard tips the water.
    const water = c.rig.parts.get('water')!.mesh;
    c.drive.windup = 0;
    run(c, 1, () => c.drive.velocity.set(0, 0, 9));
    c.drive.velocity.set(0, 0, 0);
    run(c, 0.15);
    const rest = new THREE.Quaternion().setFromRotationMatrix(c.rig.parts.get('water')!.base);
    expect(water.quaternion.angleTo(rest)).toBeGreaterThan(0.05);
  });

  it('a Shroudling slides its lamprey neck out of the hood to spit', () => {
    const c = new Creature('shroudling', 7, 0);
    run(c, 0.3);
    const head = bone(c, 'head');
    const z0 = head.position.z;
    c.drive.windup = 1;
    c.drive.look = new THREE.Vector3(0, 1.6, 20);
    run(c, 0.8);
    expect(head.position.z - z0).toBeGreaterThan(0.3);
    // Its sleeves swing when it walks.
    const sleeve = bone(c, 'sleeveL');
    const q0 = sleeve.quaternion.clone();
    run(c, 1, () => c.drive.velocity.set(0, 0, 3));
    expect(sleeve.quaternion.angleTo(q0)).toBeGreaterThan(0.02);
  });
});

describe('The Sandwidow body', () => {
  it('is a 25 m body that swims under the sand and rears out to breach', () => {
    const w = new Sandwidow(1);
    w.plant();
    run(w, 0.5);
    const box = new THREE.Box3().setFromObject(w.root);
    expect(box.max.z - box.min.z).toBeGreaterThan(18);
    // Swimming: the head is under the sand.
    expect(w.root.getObjectByName('widowHead')!.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0);
    w.drive.surface = 1;
    run(w, 1);
    expect(w.root.getObjectByName('widowHead')!.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(4);
  });

  it('exposes the throat sacs only when up and open; petals shear off; it dies', () => {
    const w = new Sandwidow(2, new THREE.Scene());
    run(w, 0.2);
    expect(w.hitSpheres.filter((h) => h.tag === 'throatSac').every((h) => h.r === 0)).toBe(true);
    w.drive.surface = 1; w.drive.open = 1;
    run(w, 1);
    expect(w.hitSpheres.filter((h) => h.tag === 'throatSac').every((h) => h.r > 0)).toBe(true);
    const petal = w.weakPoints.findIndex((p) => p.tag === 'petal');
    w.popWeakPoint(petal);
    expect(w.petalsAlive).toBe(5);
    w.popWeakPoint(0);
    expect(w.sacsAlive).toBe(3);
    w.destroy();
    expect(w.alive).toBe(false);
    run(w, 0.5);
    expect(w.hitSpheres.every((h) => h.r === 0)).toBe(true);
  });

  it('follows its head round a turn', () => {
    const w = new Sandwidow(3);
    w.plant();
    run(w, 3, (t) => { w.root.position.set(0, 0, t * 4); });
    run(w, 3, (t) => { w.root.position.set(t * 4, 0, 12); });
    const tail = w.segments[w.segments.length - 1].g.getWorldPosition(new THREE.Vector3());
    expect(tail.z).toBeLessThan(10);
  });
});
