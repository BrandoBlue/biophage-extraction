import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ABOMINATIONS, NESTS } from '../data';
import { HarvestFx, organMesh } from '../src/creatures/organs';
import { BroodHeart } from '../src/creatures/broodheart';
import { bioTime } from '../src/render/materials';
import { mutation } from '../src/render/dissolve';

const size = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());

describe('harvest organs', () => {
  const items = Object.values(ABOMINATIONS).map((a) => a.harvest?.item).filter((i): i is string => !!i);

  it.each(items)('%s builds a hand-sized organ', (item) => {
    const o = organMesh(item);
    expect(o.children.length).toBeGreaterThan(0);
    const s = size(o);
    expect(Math.max(s.x, s.y, s.z)).toBeGreaterThan(0.06);
    expect(Math.max(s.x, s.y, s.z)).toBeLessThan(0.4);
  });

  it('the cut opens a wound, pulls the organ into the hand, then stows it', () => {
    const scene = new THREE.Scene(), hand = new THREE.Group();
    hand.position.set(0, 1.5, 0);
    scene.add(hand);
    const fx = new HarvestFx();
    const corpse = { centre: new THREE.Vector3(3, 0.5, 0), fluid: new THREE.Color(1, 0, 1) };
    fx.progress(scene, corpse, 0.3);
    const wound = scene.getObjectByName('harvest-wound')!;
    const w0 = wound.scale.x;
    fx.progress(scene, corpse, 0.9);
    expect(wound.scale.x).toBeGreaterThan(w0);
    const organ = fx.done(scene, 'needlemawGland', corpse.centre, hand);
    for (let i = 0; i < 20; i++) fx.update(0.05);
    expect(organ.parent).toBe(hand);
    const t0 = bioTime.value;
    for (let i = 1; i <= 40; i++) { bioTime.value = t0 + i * 0.05; mutation.update(); fx.update(0.05); }
    expect(organ.parent).toBeNull();
    expect(fx.active).toBe(0);
  });
});

describe('Brood Heart', () => {
  it('carries the weak points from data, beats, pops them and dies', () => {
    const scene = new THREE.Scene();
    const h = new BroodHeart(3, scene);
    scene.add(h.root);
    h.root.position.set(10, 2, -4);
    h.refresh();
    expect(h.weakPoints.length).toBe(NESTS.broodHeart.weakPoints.count);
    for (const w of h.weakPoints) expect(w.world.distanceTo(new THREE.Vector3(10, 2, -4))).toBeLessThan(4);
    const heart = h.root.getObjectByName('heart')!;
    const scales: number[] = [];
    for (let i = 0; i < 40; i++) { h.update(1 / 30); scales.push(heart.scale.x); }
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.01); // it beats
    h.pulse();
    h.update(1 / 30);
    expect(heart.scale.x).toBeGreaterThan(1.05); // a wave heaves it
    h.popWeakPoint(0);
    expect(h.weakPoints.filter((w) => w.alive).length).toBe(h.weakPoints.length - 1);
    h.destroy();
    expect(h.alive).toBe(false);
    for (let i = 0; i < 60; i++) h.update(1 / 30);
    expect(heart.scale.y).toBeLessThan(1);
  });
});

describe('host bodies', () => {
  it.each(['neuroInfiltrator', 'venomWraith', 'goreBehemoth'] as const)('%s stands on y = 0, about 2 m tall, facing +Z, and idles', async (id) => {
    const { createHostBody } = await import('../src/creatures/hosts');
    const h = createHostBody(id);
    h.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(h.root);
    expect(box.min.y).toBeGreaterThan(-0.03);
    expect(box.min.y).toBeLessThan(0.05);
    expect(box.max.y).toBeGreaterThan(1.7);
    expect(box.max.y).toBeLessThan(2.6);
    for (let i = 0; i < 30; i++) h.update(1 / 30);
    expect(h.root.getObjectByName('body')).toBeTruthy();
  });
});
