import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { terrainTiles } from '../src/world/terrain';

const h = (x: number, z: number) => Math.sin(x * 0.05) * 4 + Math.cos(z * 0.07) * 3 + x * 0.02;
const mat = new THREE.MeshBasicMaterial();

describe('chunked terrain tiles', () => {
  it('covers the square in whole tiles, each with coarser levels', () => {
    const t = terrainTiles(h, mat, { extent: 180, tile: 100, cells: 32, levels: 3 });
    expect(t.tiles).toBe(16);
    expect(t.group.children.every((c) => c instanceof THREE.LOD && (c as THREE.LOD).levels.length === 3)).toBe(true);
    expect(t.triangles[1]).toBeLessThan(t.triangles[0] / 3);
    expect(t.triangles[2]).toBeLessThan(t.triangles[1] / 3);
  });

  it('puts every grid vertex on the height function, in world space', () => {
    const t = terrainTiles(h, mat, { extent: 100, tile: 100, cells: 16, levels: 2 });
    t.group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    for (const lod of t.group.children as THREE.LOD[]) {
      for (const lvl of lod.levels) {
        const mesh = lvl.object as THREE.Mesh;
        const p = mesh.geometry.attributes.position;
        let onSurface = 0;
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
          const d = h(v.x, v.z) - v.y;
          if (Math.abs(d) < 1e-3) onSurface++;
          else expect(d).toBeGreaterThan(5); // skirt vertices hang below
        }
        expect(p.count - onSurface).toBe(4 * (Math.sqrt(onSurface) - 1)); // the grid on the surface, one skirt ring below
      }
    }
  });

  it('shares edge heights between neighbouring tiles at the same level (no seams)', () => {
    const t = terrainTiles(h, mat, { extent: 100, tile: 100, cells: 16, levels: 1 });
    t.group.updateMatrixWorld(true);
    const edge = (lod: THREE.LOD, x: number) => {
      const mesh = lod.levels[0].object as THREE.Mesh;
      const p = mesh.geometry.attributes.position, v = new THREE.Vector3(), out: string[] = [];
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.x - x) < 1e-3 && h(v.x, v.z) - v.y < 1e-3) out.push(`${v.z.toFixed(3)}:${v.y.toFixed(3)}`);
      }
      return out.sort();
    };
    const [a, b] = t.group.children as THREE.LOD[]; // south-west and south-east tiles meet at x = 0
    expect(edge(a, 0)).toEqual(edge(b, 0));
    expect(edge(a, 0).length).toBe(17);
  });

  it('leaves out tiles the caller skips and normals point up out of the ground', () => {
    const t = terrainTiles(h, mat, { extent: 200, tile: 100, cells: 16, levels: 1, skip: (x, z) => x > 50 && z > 50 });
    expect(t.tiles).toBe(15);
    const mesh = (t.group.children[0] as THREE.LOD).levels[0].object as THREE.Mesh;
    const n = mesh.geometry.attributes.normal;
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0.5);
  });
});

describe('chunked terrain normals', () => {
  it('are finite on every level, edges included', () => {
    const t = terrainTiles(h, mat, { extent: 100, tile: 100, cells: 16, levels: 3 });
    for (const lod of t.group.children as THREE.LOD[]) for (const lvl of lod.levels) {
      const n = (lvl.object as THREE.Mesh).geometry.attributes.normal;
      for (let i = 0; i < n.array.length; i++) expect(Number.isFinite(n.array[i])).toBe(true);
    }
  });
});
