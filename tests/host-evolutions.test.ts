import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PROGRESSION } from '../data';
import { HOST_EVOLUTIONS, createHostBody, type HostEvolution } from '../src/creatures/hosts';

const box = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

describe('host evolutions', () => {
  it('covers every Host-milestone evolution in progression data, on the right class', () => {
    const evos = PROGRESSION.evolutions as unknown as Record<string, { id: string; milestone: string }[]>;
    for (const [cls, list] of Object.entries(evos)) {
      for (const e of list.filter((x) => x.milestone === 'host')) expect(HOST_EVOLUTIONS[e.id as HostEvolution]).toBe(cls);
    }
  });

  it('ignores an evolution of another class, or one without its own body yet', () => {
    expect(createHostBody('goreBehemoth', 'neuroHound').evolution).toBeNull();
    expect(createHostBody('venomWraith', 'shadowStalker').evolution).toBeNull();
  }, 20000);

  it('the Neuro-Hound drops to four legs: longer than tall, low, with its snout out front', () => {
    const h = createHostBody('neuroInfiltrator', 'neuroHound');
    expect(h.evolution).toBe('neuroHound');
    const b = box(h.root);
    expect(b.min.y).toBeGreaterThan(-0.03);
    expect(b.max.y).toBeLessThan(1.5);
    expect(b.max.z - b.min.z).toBeGreaterThan(b.max.y);
    for (let i = 0; i < 30; i++) h.update(1 / 30);
  }, 20000);

  it('the Acid Parasite carries acid that sloshes inside its bladder', () => {
    const h = createHostBody('venomWraith', 'acidParasite');
    const acid = h.root.getObjectByName('acid')!;
    expect(acid).toBeTruthy();
    const p0 = acid.position.clone();
    for (let i = 0; i < 20; i++) h.update(1 / 30);
    expect(acid.position.distanceTo(p0)).toBeGreaterThan(0.001);
    expect(box(h.root).min.y).toBeGreaterThan(-0.03);
  }, 20000);

  it('the Crustacean Grunt is bulkier than the Behemoth it grew from', () => {
    const base = box(createHostBody('goreBehemoth').root), grunt = createHostBody('goreBehemoth', 'crustaceanGrunt');
    const b = box(grunt.root);
    expect(b.max.y).toBeLessThan(2.8);
    let meshes = 0;
    grunt.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(5);
    expect(b.max.z - b.min.z).toBeGreaterThan(base.max.z - base.min.z);
  }, 30000);
});
