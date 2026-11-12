import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/world/collision';
import { clearLife, lifeBlast, lifeShot, LivingProps } from '../src/world/life';
import { Kit } from '../src/world/structures';
import { grownHall } from '../src/world/buildings';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const far = V(500, 1.7, 500);
const run = (l: LivingProps, eye: THREE.Vector3, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) l.step(1 / 60, eye); };

describe('living props', () => {
  it('a hanging sac swings away when a host brushes it, and settles after', () => {
    const l = new LivingProps();
    const sac = new THREE.Group();
    l.sway(sac, V(0, 3.5, 0), 1.8, 0.4);
    run(l, V(-0.3, 1.7, 0), 0.4);
    expect(Math.abs(sac.rotation.z) + Math.abs(sac.rotation.x)).toBeGreaterThan(0.05);
    run(l, V(8, 1.7, 0), 8);
    expect(Math.abs(sac.rotation.z)).toBeLessThan(0.05);
  });

  it('a doorway curtain parts as a host walks up and sags shut after', () => {
    const l = new LivingProps();
    const a = new THREE.Object3D(), b = new THREE.Object3D();
    l.flap(a, b, V(0, 0, 0), 0, 2, 2.6);
    run(l, V(0, 1.7, 1), 0.6);
    expect(a.rotation.y).toBeGreaterThan(1);
    run(l, V(0, 1.7, 9), 5);
    expect(a.rotation.y).toBeLessThan(0.2);
  });

  it('an urn topples away from a host who walks into it, and breaks when shot', () => {
    const l = new LivingProps();
    const urn = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5));
    l.tip(urn, V(0, 0, 0), 0.32, 0.9);
    run(l, V(-0.5, 1.7, 0), 1);
    expect(urn.position.x).toBeGreaterThan(0.1); // fell toward +x, away from the host
    const l2 = new LivingProps();
    const urn2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5));
    l2.tip(urn2, V(0, 0, 0), 0.32, 0.9);
    expect(l2.shot(V(-10, 0.45, 0), V(1, 0, 0))).not.toBeNull();
    expect(urn2.visible).toBe(false);
    expect(l2.group.getObjectByName('living-shards')).toBeTruthy();
  });

  it('a tank bursts when shot, its shards fall to the floor, and it stops blocking', () => {
    const w = new CollisionWorld(() => 0);
    const l = new LivingProps(w);
    const c = w.add({ cx: 0, cz: 0, hx: 0.7, hz: 0.7, yaw: 0, y0: 0, y1: 2.6 });
    const tank = new THREE.Mesh(new THREE.BoxGeometry(1, 2.6, 1));
    l.fragile(tank, V(0, 0, 0), 0.72, 2.6, c);
    expect(l.shot(V(-10, 1.3, 0), V(1, 0, 0))).not.toBeNull();
    expect(c.y1).toBe(c.y0);
    run(l, far.clone().set(3, 1.7, 0), 2);
    const shards = l.group.getObjectByName('living-shards') as THREE.InstancedMesh;
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    for (let i = 0; i < shards.count; i++) { shards.getMatrixAt(i, m); p.setFromMatrixPosition(m); expect(p.y).toBeLessThan(0.1); }
  });

  it('a wall between the shooter and a prop stops the shot', () => {
    const w = new CollisionWorld(() => 0);
    w.add({ cx: -3, cz: 0, hx: 0.3, hz: 3, yaw: 0, y0: 0, y1: 4 });
    const l = new LivingProps(w);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(1, 2.6, 1));
    l.fragile(tank, V(0, 0, 0), 0.72, 2.6);
    expect(l.shot(V(-10, 1.3, 0), V(1, 0, 0))).toBeNull();
    expect(tank.visible).toBe(true);
  });

  it('shots and blasts reach every live set of props until the zone clears them', () => {
    clearLife();
    const l = new LivingProps();
    const sac = new THREE.Group();
    l.sway(sac, V(0, 3, 0), 1.5, 0.4);
    expect(lifeShot(V(-10, 2, 0), V(1, 0, 0))).toBe(true);
    const urn = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5));
    l.tip(urn, V(4, 0, 0), 0.32, 0.9);
    lifeBlast(V(4, 0.5, 1), 3);
    expect(urn.visible).toBe(false);
    clearLife();
    expect(lifeShot(V(-10, 2, 0), V(1, 0, 0))).toBe(false);
  });
});

describe('grown halls', () => {
  it('a ring of solid walls with open doorways, lintels overhead', () => {
    const w = new CollisionWorld(() => 0);
    const k = new Kit(w, 0, 0, 0, 0);
    const hall = grownHall(k, { u: 0, v: 0, ru: 6, rv: 4.5, doors: [0] });
    expect(hall.doors).toHaveLength(1);
    const walls = w.colliders.filter((c) => c.tag === 'hall-wall');
    expect(walls.length).toBeGreaterThan(10);
    // Through the doorway (local +X): only lintels above head height there.
    expect(w.blocked(V(10, 1.2, 0), V(0, 1.2, 0))).toBeNull();
    // Through the side: a wall.
    expect(w.blocked(V(0, 1.2, 10), V(0, 1.2, 0))).not.toBeNull();
    expect(w.ceilingAt(6, 0, 0)).toBeLessThan(4);
  });
});
