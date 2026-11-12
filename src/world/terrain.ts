import * as THREE from 'three';

/**
 * Chunked terrain: the ground as a grid of square tiles, each a THREE.LOD with coarser meshes further away.
 *
 * Built for maps bigger than Glowmire's first 360 m (World's ~800 m plan): every tile is culled on its own, distant
 * tiles draw a quarter or a sixteenth of the triangles, and the height function is sampled once per fine grid point
 * (all levels and all normals read that one cache), so load time grows with area, not with level count.
 * Neighbouring tiles at different levels can disagree slightly along their shared edge; each tile hangs a skirt
 * below its border so no crack ever shows the sky.
 */

export interface TerrainTileOptions {
  /** Half-size of the square to cover (metres from the origin). Rounded up to whole tiles. */
  extent: number;
  /** Tile edge (m). */
  tile?: number;
  /** Fine-grid cells per tile edge at the nearest level (each further level halves it). Power of two. */
  cells?: number;
  /** Number of detail levels (1 to 4). */
  levels?: number;
  /** Camera distance (m, to the tile centre) where each level after the first takes over. */
  distances?: number[];
  /** How far the border skirt hangs below the tile edge (m). */
  skirt?: number;
  /** Tiles whose every sample satisfies this are left out (e.g. wholly under another mesh). */
  skip?: (x: number, z: number) => boolean;
  name?: string;
}

export interface TerrainTiles {
  group: THREE.Group;
  /** Number of tiles built. */
  tiles: number;
  /** Fine-grid spacing (m). */
  spacing: number;
  /** Cached height at a fine-grid point (i, j) from the south-west corner; for tests. */
  sample(i: number, j: number): number;
  /** Total triangles at each level, summed over all tiles. */
  triangles: number[];
}

export function terrainTiles(height: (x: number, z: number) => number, material: THREE.Material, o: TerrainTileOptions): TerrainTiles {
  const tile = o.tile ?? 100;
  const cells = o.cells ?? 64;
  const levels = Math.max(1, Math.min(4, o.levels ?? 3));
  const distances = o.distances ?? [0, 150, 300, 600];
  const skirt = o.skirt ?? 6;
  const count = Math.max(1, Math.ceil((o.extent * 2) / tile));
  const origin = -(count * tile) / 2;
  const n = count * cells; // fine cells across the whole square
  const step = tile / cells;
  // One height sample per fine grid point, plus a one-sample apron for the edge normals.
  const H = new Float32Array((n + 3) * (n + 3));
  const clampI = (i: number) => (i < -1 ? -1 : i > n + 1 ? n + 1 : i);
  const at = (i: number, j: number) => H[(clampI(j) + 1) * (n + 3) + (clampI(i) + 1)]; // coarse normals may reach past the apron
  for (let j = -1; j <= n + 1; j++) for (let i = -1; i <= n + 1; i++) H[(j + 1) * (n + 3) + (i + 1)] = height(origin + i * step, origin + j * step);

  const group = new THREE.Group();
  group.name = o.name ?? 'terrain';
  const triangles = new Array(levels).fill(0);
  let built = 0;
  for (let tj = 0; tj < count; tj++) for (let ti = 0; ti < count; ti++) {
    const i0 = ti * cells, j0 = tj * cells;
    if (o.skip) {
      let all = true;
      for (let j = 0; j <= cells && all; j += cells / 4) for (let i = 0; i <= cells && all; i += cells / 4) {
        if (!o.skip(origin + (i0 + i) * step, origin + (j0 + j) * step)) all = false;
      }
      if (all) continue;
    }
    const lod = new THREE.LOD();
    lod.name = `${group.name}-${ti}-${tj}`;
    const cx = origin + (ti + 0.5) * tile, cz = origin + (tj + 0.5) * tile;
    lod.position.set(cx, 0, cz);
    for (let l = 0; l < levels; l++) {
      const s = 1 << l; // sample stride
      const m = cells / s;
      if (m < 2) break;
      const geo = tileGeometry(at, i0, j0, m, s, step, cx - origin, cz - origin, skirt);
      triangles[l] += geo.index!.count / 3;
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      lod.addLevel(mesh, distances[l] ?? distances[distances.length - 1] * 2 ** (l - distances.length + 1));
    }
    lod.matrixAutoUpdate = false;
    lod.updateMatrix();
    group.add(lod);
    built++;
  }
  return { group, tiles: built, spacing: step, sample: at, triangles };
}

/**
 * One tile at one level: an (m+1)² grid sampled every `s` fine points from (i0, j0), positions local to the tile
 * centre, normals from the fine cache, then a skirt ring hanging `skirt` metres below the border.
 */
function tileGeometry(at: (i: number, j: number) => number, i0: number, j0: number, m: number, s: number, step: number, ox: number, oz: number, skirt: number): THREE.BufferGeometry {
  const side = m + 1;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const push = (i: number, j: number) => {
    const fi = i0 + i * s, fj = j0 + j * s;
    pos.push(fi * step - ox, at(fi, fj), fj * step - oz);
    // Central differences over this level's footprint, so distant tiles shade as smoothly as they are shaped.
    const e = Math.max(1, Math.floor(s / 2));
    const dx = (at(fi + e, fj) - at(fi - e, fj)) / (2 * e * step);
    const dz = (at(fi, fj + e) - at(fi, fj - e)) / (2 * e * step);
    const len = Math.hypot(dx, 1, dz);
    nor.push(-dx / len, 1 / len, -dz / len);
    uv.push(fi * step / 100, fj * step / 100);
  };
  for (let j = 0; j <= m; j++) for (let i = 0; i <= m; i++) push(i, j);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const a = j * side + i, b = a + side;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // Skirt: walk the border once, dropping a copy of each border vertex, and stitch a strip facing outward.
  const border: number[] = [];
  for (let i = 0; i < m; i++) border.push(i); // south edge, west to east
  for (let j = 0; j < m; j++) border.push(j * side + m); // east edge, south to north
  for (let i = m; i > 0; i--) border.push(m * side + i); // north edge, east to west
  for (let j = m; j > 0; j--) border.push(j * side); // west edge, north to south
  const base = pos.length / 3;
  for (const v of border) {
    pos.push(pos[v * 3], pos[v * 3 + 1] - skirt, pos[v * 3 + 2]);
    nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
    uv.push(uv[v * 2], uv[v * 2 + 1]);
  }
  for (let k = 0; k < border.length; k++) {
    const a = border[k], b = border[(k + 1) % border.length];
    const a2 = base + k, b2 = base + ((k + 1) % border.length);
    idx.push(a, b, a2, b, b2, a2); // faces outward
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
