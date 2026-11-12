import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PROGRESSION } from '../data';
import { APEX_EVOLUTIONS, TITAN_SCALE, WARLOCK_FLOAT, type ApexEvolution } from '../src/creatures/apex';
import { createHostBody } from '../src/creatures/hosts';

const box = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const snapshot = (o: THREE.Object3D) => { const out: number[] = []; o.traverse((c) => out.push(...c.rotation.toArray().slice(0, 3) as number[], c.scale.x)); return out; };

describe('apex evolutions', () => {
  it('covers every Apex evolution in progression data, on the right class', () => {
    const evos = PROGRESSION.evolutions as unknown as Record<string, { id: string; milestone: string }[]>;
    const apex = Object.entries(evos).flatMap(([cls, list]) => list.filter((x) => x.milestone === 'apex').map((x) => [x.id, cls]));
    expect(apex.length).toBe(6);
    for (const [id, cls] of apex) expect(APEX_EVOLUTIONS[id as ApexEvolution]).toBe(cls);
  });

  for (const [id, cls] of Object.entries(APEX_EVOLUTIONS)) {
    it(`${id} grows its own body, stands on the ground and lives`, () => {
      const h = createHostBody(cls, id);
      expect(h.evolution).toBe(id);
      const b = box(h.root);
      expect(b.min.y).toBeGreaterThan(-0.03);
      const before = snapshot(h.root);
      for (let i = 0; i < 40; i++) h.update(1 / 30);
      expect(snapshot(h.root)).not.toEqual(before);
    }, 30000);
  }

  it('the Juggernaut-Titan stands about twice the Behemoth', () => {
    const base = box(createHostBody('goreBehemoth').root), titan = box(createHostBody('goreBehemoth', 'juggernautTitan').root);
    expect(titan.max.y / base.max.y).toBeGreaterThan(TITAN_SCALE * 0.85);
    expect(titan.max.y / base.max.y).toBeLessThan(TITAN_SCALE * 1.3);
  }, 30000);

  it('the Psych-Warlock floats: nothing touches the ground, and its halo of lobes orbits', () => {
    const h = createHostBody('neuroInfiltrator', 'psychWarlock');
    expect(box(h.root).min.y).toBeCloseTo(WARLOCK_FLOAT, 2);
    const halo = h.root.getObjectByName('halo')!;
    let lobes = 0;
    halo.traverse((o) => { if (o.name === 'lobe') lobes++; });
    expect(lobes).toBeGreaterThanOrEqual(6);
    const r0 = halo.rotation.y;
    for (let i = 0; i < 30; i++) h.update(1 / 30);
    expect(halo.rotation.y).not.toBeCloseTo(r0, 3);
  }, 30000);

  it('the Xenoflyer spans far wider than the Wraith it grew from', () => {
    const base = box(createHostBody('venomWraith').root), fly = box(createHostBody('venomWraith', 'xenoflyer').root);
    expect(fly.max.x - fly.min.x).toBeGreaterThan((base.max.x - base.min.x) * 1.5);
  }, 30000);

  it('the Shadow-Stalker has no eyes, only slits that flare before a strike', () => {
    const h = createHostBody('venomWraith', 'shadowStalker');
    const slits: THREE.Mesh[] = [];
    h.root.traverse((o) => { if (o.name === 'slit') slits.push(o as THREE.Mesh); });
    expect(slits.length).toBe(2);
    const mat = slits[0].material as THREE.MeshStandardMaterial;
    let lo = Infinity, hi = 0;
    for (let i = 0; i < 160; i++) { h.update(1 / 30); lo = Math.min(lo, mat.emissiveIntensity); hi = Math.max(hi, mat.emissiveIntensity); }
    expect(lo).toBeLessThan(0.1);
    expect(hi).toBeGreaterThan(0.6);
  }, 30000);
});
