import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { STEP_HEIGHT, type Vec3Like } from '../src/world/collision';
import { buildPit, edgeRadius, layerIndex, layerY, PIT, pitHeight, pitLandmarkAt, pitLandmarks, polar, wallPointAt } from '../src/world/pit';
import { SOLIDS, climbBlocked, groundHeight, setTerrain } from '../src/world/zone7';
import { HOST, LOOT } from '../data';
import habitats from '../data/habitats.json';

const scene = new THREE.Scene();
const world = buildPit(scene, 3);
afterAll(() => setTerrain(null));

const D2R = Math.PI / 180;

/**
 * Walks a capsule through waypoints the way the Player does: cliffs refuse the step, walls push out, then the body
 * settles on the floor (dropping if the floor fell away). Reports the worst drop and any refused step.
 */
function walk(start: Vec3Like, path: [number, number][], step = 0.2): { p: Vec3Like; worstDrop: number; refused: [number, number] | null } {
  const p = { ...start };
  let worstDrop = 0, falling = 0, refused: [number, number] | null = null;
  for (const [tx, tz] of path) {
    for (let i = 0; i < 4000; i++) {
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      const nx = p.x + (dx / d) * Math.min(step, d), nz = p.z + (dz / d) * Math.min(step, d);
      if (climbBlocked(p.y, p.x, p.z, nx, nz)) { refused ??= [nx, nz]; break; }
      p.x = nx; p.z = nz;
      SOLIDS.collide(p, 0.4, 1.8);
      const f = SOLIDS.floorAt(p.x, p.z, p.y);
      // A drop bigger than a step leaves the ground: consecutive ones add up to one fall.
      falling = p.y - f > STEP_HEIGHT ? falling + (p.y - f) : 0;
      worstDrop = Math.max(worstDrop, falling, p.y - f);
      p.y = f;
    }
  }
  return { p, worstDrop, refused };
}

/** Waypoints along a ledge path, in its middle. */
function rampLine(id: string, stepDeg = 2): [number, number][] {
  const rp = PIT.ramps.find((r) => r.id === id)!;
  const k = layerIndex(rp.upper);
  const out: [number, number][] = [];
  for (let b = rp.start; b <= rp.end; b += stepDeg) out.push(polar(b, edgeRadius(k, b * D2R) - PIT.cliff - rp.width / 2));
  return out;
}
const shelf = (k: number, from: number, to: number, inset: number, stepDeg = 2): [number, number][] => {
  const out: [number, number][] = [];
  for (let b = from; b <= to; b += stepDeg) out.push(polar(b, edgeRadius(k, b * D2R) + inset));
  return out;
};

describe('the Marrow Pit', () => {
  it('is a shaft of shelves: the rim, the Cable Shelf, the Warrens and the Undermouth floor, each lower', () => {
    expect(world.layout.spawn).toBeDefined();
    expect(groundHeight(world.layout.spawn.x, world.layout.spawn.z)).toBeCloseTo(0, 0);
    for (const [k, l] of PIT.layers.entries()) {
      if (k === 0) continue;
      const [x, z] = polar(17, k === PIT.layers.length - 1 ? 20 : edgeRadius(k, 17 * D2R) + 3);
      expect(Math.abs(pitHeight(x, z) - l.y)).toBeLessThan(3.5);
      expect(l.y).toBeLessThan(PIT.layers[k - 1].y);
    }
    expect(layerY('deep')).toBeLessThan(-170);
  });

  it('walks from the rim camp all the way down the ledge paths to the Updraft without a dangerous drop', () => {
    const s = world.layout.spawn;
    const route: [number, number][] = [
      ...rampLine('rimPath'),
      ...shelf(layerIndex('cables'), 302, 358, 3),
      ...rampLine('cablePath'),
      polar(114, 88),
      ...rampLine('warrenPath'),
      polar(300, 45), polar(255, 42), polar(250, 10), [0, 0],
    ];
    const r = walk({ x: s.x, y: groundHeight(s.x, s.z), z: s.z }, [polar(199, 132), ...route]);
    expect(r.refused).toBeNull();
    expect(r.worstDrop).toBeLessThan(HOST.fallDamage.safeHeight);
    const up = world.layout.extracts.find((e) => e.id === 'updraft')!;
    expect(Math.hypot(r.p.x - up.x, r.p.z - up.z)).toBeLessThan(0.5);
    expect(r.p.y).toBeLessThan(layerY('deep') + 4);
  });

  it('cliff faces are walls: no walking up out of a lower layer', () => {
    for (const k of [0, 1, 2]) {
      const b = 75; // clear of every ledge path's start
      const below = polar(b, edgeRadius(k, b * D2R) - PIT.cliff - 9);
      const above = polar(b, edgeRadius(k, b * D2R) + 2);
      const r = walk({ x: below[0], y: pitHeight(...below), z: below[1] }, [above]);
      expect(r.refused).not.toBeNull();
      expect(r.p.y).toBeLessThan(PIT.layers[k].y - 5);
    }
  });

  it('a step off the edge is a fall that kills', () => {
    const b = 160, k = layerIndex('cables');
    const r = walk({ ...(() => { const [x, z] = polar(b, edgeRadius(k, b * D2R) + 2); return { x, y: pitHeight(x, z), z }; })() }, [polar(b, edgeRadius(k, b * D2R) - 20)]);
    const dmg = (r.worstDrop - HOST.fallDamage.safeHeight) * HOST.fallDamage.damagePerMetre;
    expect(dmg).toBeGreaterThan(250);
  });

  it('crosses the Cable Bridge from shelf to shelf over the hub', () => {
    const b = PIT.bridge, k = layerIndex(b.layer), y = layerY(b.layer);
    const far = (bearing: number) => polar(bearing, edgeRadius(k, bearing * D2R) + 3);
    const [sx, sz] = far(b.bearing + 180);
    const r = walk({ x: sx, y: pitHeight(sx, sz), z: sz }, [[0, -5], [0, 5], far(b.bearing)]);
    expect(r.refused).toBeNull();
    expect(r.worstDrop).toBeLessThan(1);
    expect(Math.abs(r.p.y - y)).toBeLessThan(1);
    expect(pitLandmarkAt(0, 0, y)).toBe('cableBridge');
    expect(pitLandmarkAt(0, 0, layerY('deep'))).toBe('undermouth');
  });

  it('names its places for contracts', () => {
    const s = world.layout.spawn;
    expect(pitLandmarkAt(s.x, s.z)).toBe('rimCamp');
    expect(pitLandmarkAt(...polar(160, 95))).toBe('hangingWarren');
    expect(pitLandmarkAt(...polar(265, 100))).toBe('boneGallery');
    expect(pitLandmarkAt(...polar(30, 42))).toBe('undermouth');
  });

  it('stands every cache on a floor, with the containers Design placed at each landmark', () => {
    const ids = new Set<string>();
    const placed: Record<string, Record<string, number>> = {};
    for (const l of world.structures.loot) {
      expect(ids.has(l.id)).toBe(false);
      ids.add(l.id);
      expect(LOOT.containers[l.container!]).toBeDefined();
      expect(SOLIDS.floorAt(l.x, l.z, l.y + 0.3)).toBeCloseTo(l.y, 1);
      const lm = pitLandmarkAt(l.x, l.z, l.y) ?? 'none';
      placed[lm] ??= {};
      placed[lm][l.container!] = (placed[lm][l.container!] ?? 0) + 1;
    }
    const want: Record<string, Record<string, number>> = {};
    for (const g of (habitats.loot as unknown as Record<string, { container: string; at: { landmark: string }; count: number }[]>).marrowPit) {
      want[g.at.landmark] ??= {};
      want[g.at.landmark][g.container] = (want[g.at.landmark][g.container] ?? 0) + g.count;
    }
    expect(placed).toEqual(want);
  });

  it('keeps the rim lift open and the Updraft shut until the boss falls, at the Nethermaw\'s mouth', () => {
    const [lift, updraft] = world.layout.extracts;
    expect(lift).toMatchObject({ id: 'rimLift', opensAt: 0 });
    expect(updraft.opensAt).toBe(Infinity);
    expect(groundHeight(lift.x, lift.z)).toBeGreaterThan(-1);
    expect(Math.hypot(updraft.x, updraft.z)).toBeLessThan(1);
    expect(groundHeight(updraft.x, updraft.z)).toBeLessThan(layerY('deep') + 4);
  });

  it('builds the Undermouth arena: four breakable root columns and three ledges you can climb', () => {
    const a = world.structures.arena!;
    expect(a.id).toBe('undermouth');
    expect(a.pillars).toHaveLength(4);
    const c = a.pillars[0];
    expect(SOLIDS.blocked({ x: c.x - 3, y: a.floorY + 1, z: c.z }, { x: c.x + 3, y: a.floorY + 1, z: c.z })).not.toBeNull();
    world.structures.breakPillar(c.id);
    expect(c.broken).toBe(true);
    expect(SOLIDS.floorAt(c.x, c.z, a.floorY + 1)).toBeLessThan(a.floorY + 1);
    for (const ld of PIT.undermouth.ledges) {
      const [lx, lz] = polar(ld.bearing, ld.radius), b = ld.bearing * D2R;
      const tx = -Math.sin(b), tz = Math.cos(b), len = Math.max(4, ld.height / 0.45);
      const foot: [number, number] = [lx + tx * (5 + len + 1), lz + tz * (5 + len + 1)];
      const r = walk({ x: foot[0], y: pitHeight(...foot), z: foot[1] }, [[lx, lz]]);
      expect(r.refused).toBeNull();
      expect(a.onLedge(r.p.x, r.p.z)).toBe(true);
      expect(r.p.y).toBeCloseTo(pitHeight(lx, lz) + ld.height, 0);
    }
  });

  it('gives every landmark a home point on its own layer (for habitats)', () => {
    const marks = pitLandmarks();
    expect(marks.map((m) => m.id).sort()).toEqual(Object.keys(PIT.landmarks).sort());
    for (const m of marks) {
      expect(pitLandmarkAt(m.x, m.z, m.y)).toBe(m.id);
      expect(Math.abs(m.y - layerY(m.layer))).toBeLessThan(4);
    }
  });

  it('cuts a bridge walkway out from under you', () => {
    const w = world.structures.walkways!;
    expect(w.length).toBeGreaterThan(40);
    const mid = w.find((s) => s.id === 'bridge-a-20')!;
    expect(SOLIDS.floorAt(mid.x, mid.z, mid.y + 0.3)).toBeCloseTo(mid.y, 1);
    mid.cut();
    expect(mid.isCut).toBe(true);
    expect(SOLIDS.floorAt(mid.x, mid.z, mid.y + 0.3)).toBeLessThan(mid.y - 20);
  });

  it('finds points on the shaft wall, facing into the shaft, for wall-clingers', () => {
    const w = wallPointAt(3, -100)!; // 172°: no ledge path under this stretch
    expect(w.layer).toBe('cables');
    expect(w.nx * w.x + w.nz * w.z).toBeLessThan(0);
    // Just in front of the wall is open air well below the point; just behind it is rock above it.
    expect(pitHeight(w.x + w.nx * 3, w.z + w.nz * 3)).toBeLessThan(w.y - 20);
    expect(pitHeight(w.x - w.nx * 2, w.z - w.nz * 2)).toBeGreaterThan(w.y);
    expect(wallPointAt(0, 5)).toBeNull();
    expect(wallPointAt(0, -300)).toBeNull();
  });

  it('homes Design\'s pit creatures on their landmarks\' shelves, tougher the deeper they live', () => {
    const sp = world.layout.spawns!;
    expect(sp.length).toBeGreaterThan(8);
    for (const s of sp) {
      const y = pitHeight(s.x, s.z);
      expect(pitLandmarkAt(s.x, s.z, y)).not.toBeNull();
      expect(s.toughness).toBeGreaterThanOrEqual(1);
    }
    const deep = sp.find((s) => pitLandmarkAt(s.x, s.z) === 'undermouth')!, rim = sp.find((s) => pitLandmarkAt(s.x, s.z) === 'rimCamp')!;
    expect(deep.toughness!).toBeGreaterThan(rim.toughness!);
  });
});
