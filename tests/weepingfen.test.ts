import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { STEP_HEIGHT, type Vec3Like } from '../src/world/collision';
import { FEN, buildWeepingFen, fenAreaAt, fenHeight, regentPool } from '../src/world/weepingfen';
import { SOLIDS, groundHeight, setTerrain } from '../src/world/zone7';
import { BUILT_ZONES } from '../src/world/zones';
import { HABITATS, LOOT, ZONES } from '../data';

const scene = new THREE.Scene();
const world = buildWeepingFen(scene, 3);
afterAll(() => setTerrain(null));

/** Walks a 0.4 m capsule through waypoints the way the Player does: push out of walls, then settle on floors. */
function walk(start: Vec3Like, path: [number, number][], step = 0.15): Vec3Like {
  const p = { ...start };
  for (const [tx, tz] of path) {
    for (let i = 0; i < 4000; i++) {
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      p.x += (dx / d) * Math.min(step, d); p.z += (dz / d) * Math.min(step, d);
      SOLIDS.collide(p, 0.4, 1.8);
      const f = SOLIDS.floorAt(p.x, p.z, p.y);
      if (f >= p.y - STEP_HEIGHT * 4) p.y = f;
    }
  }
  return p;
}
const near = (p: Vec3Like, x: number, z: number) => Math.hypot(p.x - x, p.z - z);
const polar = (cx: number, cz: number, a: number, r: number): [number, number] => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];

describe('the Weeping Fen', () => {
  it('is a built zone Design has data for, and the ground every system reads is the fen floor', () => {
    expect(BUILT_ZONES).toContain('weepingFen');
    expect(groundHeight(FEN.spawn.x, FEN.spawn.z)).toBeCloseTo(fenHeight(FEN.spawn.x, FEN.spawn.z), 6);
    if (ZONES.weepingFen) for (const id of ['rootHut', 'stiltVillage', 'spiderHollow', 'drownedPod', 'regentPool', 'mushroomCathedral', 'mistwaderShallows']) {
      expect(FEN.areas.some((a) => a.id === id), id).toBe(true);
    }
  });

  it('is mostly knee-deep water over mud, with dry islets for the spawn and extracts and deep water in the pool', () => {
    let wet = 0, n = 0;
    for (let x = -120; x <= 120; x += 6) for (let z = -120; z <= 120; z += 6) { if (Math.hypot(x, z) > 130) continue; n++; if (fenHeight(x, z) < 0) wet++; }
    expect(wet / n).toBeGreaterThan(0.55);
    expect(fenHeight(FEN.spawn.x, FEN.spawn.z)).toBeGreaterThan(0.3);
    for (const e of FEN.extracts) expect(fenHeight(e.x, e.z), e.id).toBeGreaterThan(0.3);
    // Shallows never drown the host (eyes at 1.6 m stay above the surface everywhere inside the ring).
    for (let x = -370; x <= 370; x += 5) for (let z = -370; z <= 370; z += 5) if (Math.hypot(x, z) < FEN.radius - 8) expect(fenHeight(x, z)).toBeGreaterThan(-1.45);
    expect(regentPool!.floorY).toBeLessThan(-1);
  });

  it('spawns on the landing, opens the Lantern Lift first, and keeps creatures inside the ring', () => {
    const l = world.layout;
    expect(l.spawn).toMatchObject(FEN.spawn);
    expect(l.extracts[0]).toMatchObject({ id: 'lanternLift', opensAt: 0 });
    expect(l.extracts[1].opensAt).toBeGreaterThan(0);
    expect(Math.max(Math.abs(l.area!.x0), l.area!.x1, Math.abs(l.area!.z0), l.area!.z1)).toBeLessThan(FEN.radius);
    expect(fenAreaAt(FEN.spawn.x, FEN.spawn.z)?.id).toBe('fenLanding');
    expect(world.landmarkAt(-58, 8)).toBe('rootHut');
  });

  it('walks from the spawn along the trails through the shallows to every extract', () => {
    const s = FEN.spawn;
    for (const e of FEN.extracts) {
      const trail = FEN.trails.list.find((t) => t.to === e.id)!;
      expect(trail, e.id).toBeDefined();
      const p = walk({ x: s.x, y: fenHeight(s.x, s.z), z: s.z }, trail.points);
      expect(near(p, e.x, e.z), e.id).toBeLessThan(1);
    }
  });

  it('fills Design\'s 380 m ring: named districts out to the edge, extracts near the rim', () => {
    expect(FEN.radius).toBe((ZONES.weepingFen as { size?: { playableRadius?: number } })?.size?.playableRadius ?? 380);
    for (const e of FEN.extracts) expect(Math.hypot(e.x, e.z), e.id).toBeGreaterThan(FEN.radius * 0.6);
    // Every compass quarter of the outer ring has a named district.
    for (let q = 0; q < 4; q++) {
      const hit = FEN.areas.some((a) => Math.hypot(a.x, a.z) > 180 && Math.floor(((Math.atan2(a.z, a.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) === q);
      expect(hit, `quarter ${q}`).toBe(true);
    }
  });

  it('climbs the Root Hut ramp round the Hollow Elder into the upper room', () => {
    const t = FEN.titans.find((x) => x.hollow)!, rh = FEN.rootHut, base = fenHeight(t.x, t.z);
    const door = (rh.doorBearing * Math.PI) / 180, start = door + (28 * Math.PI) / 180, sweep = (150 * Math.PI) / 180;
    const Rr = t.radius + 1.5;
    const path: [number, number][] = [polar(t.x, t.z, start - 0.25, Rr + 1.5)];
    for (let k = 0; k <= 16; k++) path.push(polar(t.x, t.z, start + (k / 16) * sweep, Rr));
    const upper = start + sweep + (8 * Math.PI) / 180;
    path.push(polar(t.x, t.z, upper, t.radius + 1), polar(t.x, t.z, upper, 2), [t.x, t.z]);
    const from = polar(t.x, t.z, start - 0.25, Rr + 3);
    const p = walk({ x: from[0], y: fenHeight(from[0], from[1]), z: from[1] }, path);
    expect(near(p, t.x, t.z)).toBeLessThan(0.6);
    expect(p.y).toBeCloseTo(base + rh.deck, 1);
  });

  it('enters the Root Hut ground room through its door, and the trunk walls stop you elsewhere', () => {
    const t = FEN.titans.find((x) => x.hollow)!, door = (FEN.rootHut.doorBearing * Math.PI) / 180;
    const out = polar(t.x, t.z, door, t.radius + 3);
    const p = walk({ x: out[0], y: fenHeight(out[0], out[1]), z: out[1] }, [[t.x, t.z]]);
    expect(near(p, t.x, t.z)).toBeLessThan(0.6);
    const side = polar(t.x, t.z, door + Math.PI, t.radius + 3);
    const q = walk({ x: side[0], y: fenHeight(side[0], side[1]), z: side[1] }, [[t.x, t.z]]);
    expect(near(q, t.x, t.z)).toBeGreaterThan(5);
  });

  it('walks up a Stilt Village ramp onto the boardwalks and across to the far hut', () => {
    const v = FEN.stiltVillage, hut = (id: string) => v.huts.find((h) => h.id === id)!;
    const r = v.ramps[0], A = hut('stiltHutA'), B = hut('stiltHutB'), C = hut('stiltHutC');
    const rimA = polar(A.x, A.z, Math.atan2(B.z - A.z, B.x - A.x), A.radius + 1.3);
    const rimB0 = polar(B.x, B.z, Math.atan2(A.z - B.z, A.x - B.x), B.radius + 1.3);
    const rimB1 = polar(B.x, B.z, Math.atan2(C.z - B.z, C.x - B.x), B.radius + 1.3);
    const rimC = polar(C.x, C.z, Math.atan2(B.z - C.z, B.x - C.x), C.radius + 1.3);
    const toA = Math.atan2(A.z - r.z, A.x - r.x);
    const onA = polar(A.x, A.z, toA + Math.PI, A.radius + 1.3);
    // Round the hut on its platform (outside the wall), along each boardwalk.
    const around = (h: typeof A, a0: number, a1: number): [number, number][] => {
      let d = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
      const out: [number, number][] = [];
      for (let k = 1; k <= 8; k++) out.push(polar(h.x, h.z, a0 + (d * k) / 8, h.radius + 1.3));
      d = 0;
      return out;
    };
    const p = walk({ x: r.x, y: fenHeight(r.x, r.z), z: r.z }, [onA, ...around(A, toA + Math.PI, Math.atan2(B.z - A.z, B.x - A.x)), rimA, rimB0,
      ...around(B, Math.atan2(A.z - B.z, A.x - B.x), Math.atan2(C.z - B.z, C.x - B.x)), rimB1, rimC]);
    expect(near(p, rimC[0], rimC[1])).toBeLessThan(0.6);
    expect(p.y).toBeCloseTo(v.deck, 1);
  });

  it('climbs the Great Spire\'s shelf brackets to the Mushroom Cathedral gallery and crosses the gill bridge to the chapel', () => {
    const C = FEN.cathedral, sp = C.spire, ch = C.chapel;
    const sb = fenHeight(sp.x, sp.z), toChapel = Math.atan2(ch.z - sp.z, ch.x - sp.x);
    const sweep = C.climb.turns * Math.PI * 2, start = toChapel - C.climb.endShort - sweep, Rr = sp.radius + 2.2;
    const path: [number, number][] = [];
    for (let k = 0; k <= 30; k++) path.push(polar(sp.x, sp.z, start + (k / 30) * sweep, Rr));
    const gal = polar(sp.x, sp.z, toChapel, C.gallery.out);
    path.push(gal);
    const from = polar(sp.x, sp.z, start - 0.3, Rr + 0.5);
    const p = walk({ x: from[0], y: fenHeight(from[0], from[1]), z: from[1] }, path);
    expect(near(p, gal[0], gal[1])).toBeLessThan(0.6);
    expect(p.y).toBeCloseTo(sb + C.climb.top, 1);
    const back = toChapel + Math.PI, land = polar(ch.x, ch.z, back, ch.radius + 1.6);
    const q = walk(p, [land]);
    expect(near(q, land[0], land[1])).toBeLessThan(0.6);
    expect(q.y).toBeCloseTo(fenHeight(ch.x, ch.z) + ch.deck, 1);
  });

  it('crosses the Fallen Span log from the landing', () => {
    const lg = FEN.logs[0];
    const p = walk({ x: lg.x0 - (lg.x1 - lg.x0) * 0.2, y: 1, z: lg.z0 - (lg.z1 - lg.z0) * 0.2 }, [[(lg.x0 + lg.x1) / 2, (lg.z0 + lg.z1) / 2]]);
    expect(p.y).toBeGreaterThan(Math.max(0, fenHeight(lg.x0, lg.z0)) + 0.8);
  });

  it('stands every loot spot on a floor with a real container type, and the pods on dry ground', () => {
    expect(world.structures.loot.length).toBe(FEN.loot.length);
    for (const l of world.structures.loot) {
      expect(LOOT.containers[l.container ?? 'bioPod'], l.id).toBeDefined();
      expect(SOLIDS.floorAt(l.x, l.z, l.y + 0.3), l.id).toBeCloseTo(l.y, 1);
    }
    for (const p of [...world.layout.pods, ...world.layout.nodes]) expect(fenHeight(p.x, p.z), p.id).toBeGreaterThan(0.1);
  });

  it('rings the Regent\'s Pool with arches and leaves gaps to wade in', () => {
    expect(regentPool!.arches).toHaveLength(FEN.regentPool.arches);
    const c = regentPool!;
    for (const e of c.entrances) {
      const out = polar(c.x, c.z, Math.atan2(e.z - c.z, e.x - c.x), c.radius + 6);
      const p = walk({ x: out[0], y: fenHeight(out[0], out[1]), z: out[1] }, [[c.x, c.z]]);
      expect(near(p, c.x, c.z)).toBeLessThan(1);
    }
  });

  it('gives every creature Design asked for a home in its landmark, and places Design\'s containers', () => {
    const want = HABITATS.zones.weepingFen as Record<string, { groups: { where: { landmark?: string }; count: number }[] }>;
    for (const [kind, h] of Object.entries(want)) {
      const placed = world.layout.spawns!.filter((s) => s.kind === kind);
      expect(placed.reduce((a, s) => a + (s.count ?? 1), 0), kind).toBe(h.groups.reduce((a, g) => a + g.count, 0));
      for (const g of h.groups) {
        const area = FEN.areas.find((a) => a.id === g.where.landmark)!;
        expect(placed.some((s) => Math.hypot(s.x - area.x, s.z - area.z) <= area.radius), `${kind} in ${area.id}`).toBe(true);
      }
    }
    // Homes stand clear (the Drowned Pod's glasswalkers stand on its deck).
    for (const s of world.layout.spawns!) expect(SOLIDS.floorAt(s.x, s.z, 50) - fenHeight(s.x, s.z), `${s.kind} not inside a solid`).toBeLessThan(1.5);
    const got: Record<string, number> = {};
    for (const c of [...world.structures.loot.map((l) => l.container!), ...world.layout.pods.map((p) => p.type)]) got[c] = (got[c] ?? 0) + 1;
    for (const l of (HABITATS.loot.weepingFen ?? []) as { container: string; count: number }[]) expect(got[l.container] ?? 0, l.container).toBeGreaterThanOrEqual(l.count);
  });
});
