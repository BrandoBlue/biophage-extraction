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
    const neck = bone(c, 'neck');
    // Grazing comes and goes on a slow random cycle (it lifts its head to look round): find the deepest graze.
    let grazing = neck.quaternion.clone(), deepest = -1;
    run(c, 20, () => { const a = neck.quaternion.x; if (a > deepest) { deepest = a; grazing = neck.quaternion.clone(); } });
    const quill = bone(c, 'quillL');
    c.drive.excite = 1; c.drive.windup = 1;
    run(c, 1.2);
    expect(quill.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.3);
    expect(neck.quaternion.angleTo(grazing)).toBeGreaterThan(0.25);
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
    let reach = 0;
    run(c, 1.2, () => { reach = Math.max(reach, head.position.z - z0); });
    expect(reach).toBeGreaterThan(0.25);
    // Its sleeves swing when it walks.
    const sleeve = bone(c, 'sleeveL');
    const q0 = sleeve.quaternion.clone();
    let swing = 0;
    run(c, 2, () => { c.drive.velocity.set(0, 0, 3); swing = Math.max(swing, sleeve.quaternion.angleTo(q0)); });
    expect(swing).toBeGreaterThan(0.02);
  });

  it('a Cablecrawler clings to a wall plane and scissors its shears', () => {
    const c = new Creature('cablecrawler', 7, 0);
    // A wall facing +X at x = 0: the root sits on it with +Y along the normal.
    c.root.position.set(0, 2, 0);
    c.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    c.surface = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    c.plant();
    run(c, 0.5);
    const feet = [...c.rig.limbs.values()].filter((l) => l.spec.kind === 'leg').map((l) => l.bones[l.bones.length - 1].getWorldPosition(new THREE.Vector3()));
    for (const f of feet) expect(Math.abs(f.x)).toBeLessThan(0.15);
    const m = bone(c, 'mandL'), q0 = m.quaternion.clone();
    c.drive.action = 1;
    let moved = 0;
    run(c, 0.6, () => { moved = Math.max(moved, m.quaternion.angleTo(q0)); });
    expect(moved).toBeGreaterThan(0.2);
  });

  it('a Veilwing undulates its torn sail, folds to drop and closes its tentacles on a grab', () => {
    const c = new Creature('veilwing', 7, 0);
    run(c, 0.3);
    const sail = c.root.getObjectByName('veil') as THREE.Mesh;
    expect(sail).toBeTruthy();
    const span = () => { sail.geometry.computeBoundingBox(); return sail.geometry.boundingBox!.getSize(new THREE.Vector3()).x; };
    const open = span();
    expect(open).toBeGreaterThan(3.5);
    c.drive.windup = 1;
    run(c, 1);
    expect(span()).toBeLessThan(open * 0.85);
    const tip = () => { const l = c.rig.limbs.get('tentacle0')!; return l.bones[l.bones.length - 1].getWorldPosition(new THREE.Vector3()); };
    c.drive.windup = 0;
    run(c, 0.5);
    const hanging = tip().y;
    c.drive.action = 1;
    run(c, 0.8);
    expect(tip().y).toBeGreaterThan(hanging + 0.5);
  });

  it('the Hollowed holds a real gun in both hands and raises it onto its target', () => {
    const c = new Creature('hollowed', 7, 0);
    const motion = c.motion as unknown as { weapon: { muzzle: THREE.Object3D } };
    run(c, 0.3);
    expect(motion.weapon).toBeTruthy();
    const muzzle = () => motion.weapon.muzzle.getWorldPosition(new THREE.Vector3());
    const lowered = muzzle().y;
    c.drive.windup = 1;
    c.drive.look = new THREE.Vector3(0, 1.5, 30);
    run(c, 0.8);
    expect(muzzle().y).toBeGreaterThan(lowered + 0.1);
    // Both hands on the gun.
    for (const id of ['armL', 'armR']) {
      const l = c.rig.limbs.get(id)!;
      expect(l.bones[2].getWorldPosition(new THREE.Vector3()).distanceTo(muzzle())).toBeLessThan(1.2);
    }
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

describe('The Nethermaw body', () => {
  it('is a house-sized coral mass whose lobes are only hittable while they swell', async () => {
    const { Nethermaw } = await import('../src/creatures/zones/nethermaw');
    const n = new Nethermaw(1, new THREE.Scene());
    run(n, 0.3);
    const size = new THREE.Box3().setFromObject(n.root).getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeGreaterThan(12);
    expect(n.hitSpheres.filter((h) => h.tag === 'lobe').every((h) => h.r === 0)).toBe(true);
    n.drive.swell[2] = 1;
    run(n, 0.2);
    const lobes = n.hitSpheres.filter((h) => h.tag === 'lobe');
    expect(lobes.find((h) => h.index === 2)!.r).toBeGreaterThan(0);
    expect(lobes.filter((h) => h.index !== 2).every((h) => h.r === 0)).toBe(true);
    n.pulse(2);
    n.popWeakPoint(2);
    expect(n.lobesAlive).toBe(4);
    n.drive.breath = 1;
    run(n, 0.5);
    n.destroy();
    run(n, 0.2);
    expect(n.alive).toBe(false);
    expect(n.hitSpheres.every((h) => h.r === 0)).toBe(true);
  });
});
