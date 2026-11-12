import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { noise3, organicEligible, organicGeometry, organicize } from '../src/render/organic';

describe('organic shapes', () => {
  it('turns a box into a welded, rounded, smooth-shaded shape of about the same size', () => {
    const box = new THREE.BoxGeometry(4, 2, 1);
    const g = organicGeometry(box);
    expect(g.index).not.toBeNull();
    expect(g.attributes.normal).toBeDefined();
    expect(g.attributes.position.count).toBeGreaterThan(box.attributes.position.count);
    const s = g.boundingBox!.getSize(new THREE.Vector3());
    expect(s.x).toBeGreaterThan(3.2); expect(s.x).toBeLessThan(4.5);
    expect(s.y).toBeGreaterThan(1.4); expect(s.y).toBeLessThan(2.4);
    // Corners are rounded: no vertex sits on the original sharp corner.
    const pos = g.attributes.position;
    let cornerDist = Infinity;
    for (let i = 0; i < pos.count; i++) cornerDist = Math.min(cornerDist, Math.hypot(pos.getX(i) - 2, pos.getY(i) - 1, pos.getZ(i) - 0.5));
    expect(cornerDist).toBeGreaterThan(0.05);
    for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
  });

  it('stays inside the vertex budget', () => {
    const g = organicGeometry(new THREE.BoxGeometry(30, 10, 30), { maxVerts: 3000 });
    expect(g.attributes.position.count).toBeLessThan(9000);
  });

  it('noise is smooth and bounded', () => {
    for (let i = 0; i < 200; i++) { const v = noise3(i * 0.37, i * 0.11, i * 0.73, 3); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(Math.abs(noise3(1.5, 2.5, 3.5) - noise3(1.501, 2.5, 3.5))).toBeLessThan(0.01);
  });

  it('organicizes eligible meshes once per shared geometry and skips textured, shader and opted-out ones', () => {
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const mat = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    const a = new THREE.Mesh(geo, mat), b = new THREE.Mesh(geo, mat);
    const tex = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
    const shader = new THREE.Mesh(geo, new THREE.ShaderMaterial());
    const sculpted = new THREE.Mesh(new THREE.BufferGeometry().copy(new THREE.SphereGeometry(1)), mat);
    const out = new THREE.Mesh(geo, mat); out.userData.noOrganic = true;
    root.add(a, b, tex, shader, out, sculpted);
    expect(organicize(root)).toBe(2);
    expect(a.geometry).toBe(b.geometry);
    expect(a.geometry).not.toBe(geo);
    expect(tex.geometry).toBe(geo);
    expect(organicEligible(a)).toBe(false); // already organic
  });
});
