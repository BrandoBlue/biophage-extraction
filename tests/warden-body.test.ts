import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BOSSES } from '../data';
import { Warden } from '../src/creatures/warden';

const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
const run = (w: Warden, secs: number, each?: (t: number) => void) => { for (let t = 0; t < secs; t += 1 / 30) { each?.(t); w.update(1 / 30); } };
const spec = BOSSES.warden as unknown as { size: { length: number; height: number }; weakPoints: { seedPods: { count: number }; reactorSeams: { count: number } } };

describe('The Warden of the Long Seed body', () => {
  it('is a 20 m centipede lying on the floor behind its head', () => {
    const w = new Warden(1);
    w.root.position.set(5, 0, 0);
    w.plant();
    run(w, 0.5);
    const s = box(w.root).getSize(new THREE.Vector3());
    expect(s.z).toBeGreaterThan(spec.size.length * 0.8);
    expect(s.z).toBeLessThan(spec.size.length * 1.3);
    expect(s.y).toBeGreaterThan(spec.size.height * 0.7);
    expect(s.y).toBeLessThan(spec.size.height * 2);
    // The tail trails behind (-Z of the head).
    const tail = w.segments[w.segments.length - 1].g.getWorldPosition(new THREE.Vector3());
    expect(tail.z).toBeLessThan(-spec.size.length * 0.7);
  });

  it('carries the weak points and tags PvE AI asked for', () => {
    const w = new Warden(2);
    run(w, 0.1);
    expect(w.weakPoints.filter((p) => p.tag === 'seedPod').length).toBe(spec.weakPoints.seedPods.count);
    expect(w.weakPoints.filter((p) => p.tag === 'reactorSeam').length).toBe(spec.weakPoints.reactorSeams.count);
    const tags = new Set(w.hitSpheres.map((h) => h.tag));
    for (const t of ['plate', 'segment', 'seedPod', 'reactorSeam', 'head']) expect(tags.has(t as never), t).toBe(true);
    // Seams are closed (radius 0) until their plates lift.
    expect(w.hitSpheres.filter((h) => h.tag === 'reactorSeam').every((h) => h.r === 0)).toBe(true);
    w.drive.seamsOpen = [1, 0, 0, 0];
    run(w, 0.3);
    const seams = w.hitSpheres.filter((h) => h.tag === 'reactorSeam');
    expect(seams.find((h) => h.index === 0)!.r).toBeGreaterThan(0);
    expect(seams.filter((h) => h.index !== 0).every((h) => h.r === 0)).toBe(true);
  });

  it('the body follows the head round a corner and up a wall', () => {
    const w = new Warden(3);
    w.plant();
    // Crawl forward 10 m, then turn up a wall (head now faces +Y with its up toward -Z).
    run(w, 3, (t) => w.root.position.set(0, 0, (t / 3) * 10));
    w.root.position.set(0, 0, 10);
    w.root.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    run(w, 2, (t) => w.root.position.set(0, (t / 2) * 6, 10));
    const front = w.segments[1].g.getWorldPosition(new THREE.Vector3());
    const back = w.segments[w.segments.length - 1].g.getWorldPosition(new THREE.Vector3());
    expect(front.y).toBeGreaterThan(2.5); // already up the wall
    expect(back.y).toBeLessThan(1.5); // still on the floor
    expect(back.z).toBeLessThan(front.z);
  });

  it('the strike thrusts the root spear out; pods and seams pop; it dies', () => {
    const w = new Warden(4, new THREE.Scene());
    run(w, 0.2);
    const spear = () => w.root.getObjectByName('wardenHead')!.children.find((c) => (c as THREE.Mesh).isMesh && c.scale.z !== 1 && c.position.z > 0)!;
    const before = spear().scale.z;
    w.drive.windup = 1;
    w.drive.strike = new THREE.Vector3(0, 1, 15);
    run(w, 0.5);
    expect(spear().scale.z).toBeGreaterThan(before + 0.5);
    w.popWeakPoint(0);
    expect(w.podsAlive).toBe(spec.weakPoints.seedPods.count - 1);
    w.popWeakPoint(spec.weakPoints.seedPods.count); // first seam
    expect(w.seamsAlive).toBe(spec.weakPoints.reactorSeams.count - 1);
    w.destroy();
    expect(w.alive).toBe(false);
    expect(w.hitSpheres.every((h) => h.r === 0)).toBe(true);
  });
});
