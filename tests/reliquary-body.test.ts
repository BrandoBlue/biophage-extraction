import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BOSSES } from '../data';
import { Reliquary } from '../src/creatures/reliquary';

const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);

describe('The Reliquary body', () => {
  const scene = new THREE.Scene();
  const r = new Reliquary(1, scene);
  scene.add(r.root);
  r.root.position.set(20, 0, -10);
  r.plant();

  it('is boss-sized and stands on the ground', () => {
    r.update(1 / 30);
    const b = box(r.root), s = b.getSize(new THREE.Vector3());
    expect(s.y).toBeGreaterThan(BOSSES.reliquary.size.height * 0.8);
    expect(s.y).toBeLessThan(BOSSES.reliquary.size.height * 1.25);
    expect(s.z).toBeGreaterThan(BOSSES.reliquary.size.length * 0.8);
    expect(b.min.y).toBeGreaterThan(-0.3);
    expect(b.min.y).toBeLessThan(0.3);
  });

  it('carries the weak points from data, tagged for PvE AI', () => {
    const wp = BOSSES.reliquary.weakPoints as { hearts: { count: number }; legs: { count: number } };
    expect(r.weakPoints.filter((w) => w.tag === 'heart').length).toBe(wp.hearts.count);
    expect(r.weakPoints.filter((w) => w.tag === 'broodSac').length).toBe(1);
    expect(r.legsIntact).toBe(wp.legs.count);
    const legs = r.hitSpheres.filter((h) => h.tag === 'leg');
    expect(new Set(legs.map((h) => h.limb))).toEqual(new Set([0, 1, 2, 3, 4, 5].map((i) => `leg${i}`)));
    for (const w of r.weakPoints) expect(w.world.distanceTo(r.root.position)).toBeLessThan(9);
    // The sac bone hangs low under the body.
    const sac = r.sacBone.getWorldPosition(new THREE.Vector3());
    expect(sac.y).toBeLessThan(3);
  });

  it('walks: the feet stay planted then step after the moving root', () => {
    const foot = () => r.root.getObjectByName('leg2lower')!.getWorldPosition(new THREE.Vector3());
    const ys: number[] = [];
    for (let i = 0; i < 90; i++) {
      r.root.position.z += 2.4 / 30;
      r.update(1 / 30);
      ys.push(r.hitSpheres.find((h) => h.limb === 'leg2')!.world.y);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.2); // the leg lifted for a step
    expect(foot().z).toBeGreaterThan(-10 + 3);
  });

  it('rears and opens in bloom, stamps, births, loses legs and collapses', () => {
    const heartY0 = r.weakPoints[0].world.y;
    r.drive.phase = 'bloom';
    r.drive.rear = 1;
    r.drive.heartsOpen = true;
    for (let i = 0; i < 60; i++) r.update(1 / 30);
    expect(r.weakPoints[0].world.y).toBeGreaterThan(heartY0 + 1);
    r.vent();
    r.birth();
    r.drive.rear = 0;
    r.drive.strike = r.root.localToWorld(new THREE.Vector3(-3, 0, 7));
    for (let i = 0; i <= 20; i++) { r.drive.windup = i / 20; r.update(1 / 30); }
    const raised = r.root.getObjectByName('leg0lower')!.getWorldPosition(new THREE.Vector3()).y;
    r.slam();
    r.drive.windup = 0;
    r.drive.strike = null;
    for (let i = 0; i < 10; i++) r.update(1 / 30);
    expect(r.root.getObjectByName('leg0lower')!.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(raised);

    r.popWeakPoint(0);
    expect(r.weakPoints[0].alive).toBe(false);
    r.sever('leg4');
    r.severLeg(5);
    expect(r.legsIntact).toBe(4);
    expect(r.hitSpheres.filter((h) => h.limb === 'leg4').every((h) => h.r === 0)).toBe(true);
    r.drive.phase = 'collapse';
    for (let i = 0; i < 90; i++) r.update(1 / 30);
    const body = r.hitSpheres.find((h) => h.tag === 'body')!.world.y;
    expect(body).toBeLessThan(BOSSES.reliquary.size.crawlHeight * 0.75);
    r.destroy();
    expect(r.alive).toBe(false);
    for (let i = 0; i < 30; i++) r.update(1 / 30);
  });
});
