import * as THREE from 'three';
import { HIVE, ORGANIC, ZONE7_SHADE } from '../render/palette';
import { bioNode, bioTime, chitin, liquidLight, membrane, zoneRock } from '../render/materials';
import type { Collider, CollisionWorld } from './collision';
import type { CaveLair } from './cave';
import type { WardenArena } from './wreck';
import { mulberry32 } from './rng';
import { noise3 } from '../render/geometry';

/**
 * Enterable World structures for Zone 7: the Hollow Spire (a chitin hive tower with three floors) and the
 * Reliquary Bowl (the boss arena). Every walkable or blocking part is a collider (src/world/collision.ts) with a
 * mesh that matches it; organic dressing on top does not collide. Tone: bone, chitin and dark stone with sparse,
 * soft glow (Brandon: ethereal, not neon).
 */

type Height = (x: number, z: number) => number;

/** Weathered bone: the Art Bible's bone, dimmed so it reads as old and lit, not glowing. */
export function oldBone(glow: string = ORGANIC.mist, scale = 0.5): THREE.MeshPhysicalMaterial {
  const m = chitin(HIVE.bone, glow, scale);
  m.color.multiplyScalar(0.42);
  m.sheen = 0.15;
  return m;
}

/** Where loot can sit inside a structure; y is the floor it stands on. */
export interface LootSpot { id: string; x: number; y: number; z: number; /** loot.json container type; falls back to bioPod if unknown. */ container?: string }

export interface ArenaInfo {
  id: string; x: number; z: number; radius: number; floorY: number;
  entrances: { x: number; z: number }[];
  /** Destructible cover: `destroy()` hides the pillar and drops its collider (boss phase 2). */
  pillars: { id: string; x: number; z: number; radius: number; readonly broken: boolean; destroy(): void }[];
  pool: { x: number; z: number; radius: number };
  bossSpawn: { x: number; z: number };
  /** The raised ledge round the north half: walkable top at `y`, between `innerR` and `outerR` from the centre. */
  ledge: { y: number; innerR: number; outerR: number; halfArc: number; yaw: number };
  /** True when (x, z) is on the ledge (the enrage flood spares it). */
  onLedge(x: number, z: number): boolean;
}

export interface BuiltStructures {
  group: THREE.Group;
  loot: LootSpot[];
  arena: ArenaInfo | null;
  /** The Pale Vigil's cave lair (src/world/cave.ts), on zones that have one. */
  lair?: CaveLair | null;
  /** The Warden's reactor-chamber arena (src/world/wreck.ts), on the Wreck. */
  warden?: WardenArena | null;
  /** Break an arena pillar (boss phase 2): hides it and removes its collider. */
  breakPillar(id: string): void;
}

/** A structure's local frame: (u, v) metres from its centre, rotated by `yaw`. */
export class Kit {
  readonly group = new THREE.Group();
  constructor(readonly solids: CollisionWorld, readonly x: number, readonly z: number, readonly yaw: number, readonly base: number) {
    this.group.position.set(x, base, z);
    this.group.rotation.y = yaw;
  }

  /** World x, z of local (u, v). */
  at(u: number, v: number): [number, number] {
    const co = Math.cos(this.yaw), si = Math.sin(this.yaw);
    return [this.x + u * co + v * si, this.z - u * si + v * co];
  }

  /** A solid box (local centre u, v; half sizes; local yaw; heights relative to the structure base). */
  box(u: number, v: number, hu: number, hv: number, y0: number, y1: number, mat: THREE.Material, o: { yaw?: number; rise?: number; tag?: string } = {}): { mesh: THREE.Mesh; collider: Collider } {
    const geo = new THREE.BoxGeometry(hu * 2, y1 - y0, hv * 2, Math.max(1, Math.round(hu)), 1, Math.max(1, Math.round(hv)));
    if (o.rise) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0) p.setY(i, p.getY(i) - o.rise * (0.5 - p.getX(i) / (2 * hu)));
      }
      geo.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(u, (y0 + y1) / 2, v);
    mesh.rotation.y = o.yaw ?? 0;
    this.group.add(mesh);
    const [cx, cz] = this.at(u, v);
    const collider = this.solids.add({ cx, cz, hx: hu, hz: hv, yaw: this.yaw + (o.yaw ?? 0), y0: this.base + y0, y1: this.base + y1, rise: o.rise, tag: o.tag });
    return { mesh, collider };
  }
}

/** Curved bone/chitin tube through local points (no collision). */
function rib(points: THREE.Vector3[], radius: number, mat: THREE.Material, seg = 32): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), seg, radius, 7), mat);
}

/**
 * The Hollow Spire: an octagonal chitin hive tower, open to the sky. Two ground doorways; inside, a ramp climbs to
 * a half-deck at 5 m, a second ramp to a half-deck at 10 m with slit windows looking out over the island.
 * Loot: one cache on the ground floor, a richer one on the top deck.
 */
export function hollowSpire(solids: CollisionWorld, x: number, z: number, yaw: number, height: Height, seed = 11): { group: THREE.Group; loot: LootSpot[] } {
  const rand = mulberry32(seed);
  const base = height(x, z);
  const k = new Kit(solids, x, z, yaw, base);
  k.group.name = 'hollow-spire';
  const shell = chitin(ZONE7_SHADE.stem, ORGANIC.vein, 0.35);
  const deck = zoneRock({ veinColour: ORGANIC.vein, mossColour: ZONE7_SHADE.moss, scale: 1.6 });
  const R = 8, H = 18, T = 0.6;
  const side = 2 * R * Math.tan(Math.PI / 8);
  const doors = new Set([0, 4]);
  const windows = new Set([2, 3, 6]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const u = Math.sin(a) * R, v = Math.cos(a) * R;
    const wyaw = a;
    // The south walls stop at chest height above the roost (15 m): a parapet to shoot over.
    const top = i >= 3 && i <= 5 ? 16.1 : H;
    // Each wall is built in its own frame: local u along the wall.
    const seg = (along: number, half: number, y0: number, y1: number) => {
      const cu = u + Math.cos(wyaw) * along, cv = v - Math.sin(wyaw) * along;
      k.box(cu, cv, half, T, y0, y1, shell, { yaw: wyaw, tag: `spire-wall-${i}` });
    };
    if (doors.has(i)) {
      const gap = 1.5;
      const half = (side / 2 - gap) / 2;
      seg(-(gap + half), half, -1, top);
      seg(gap + half, half, -1, top);
      seg(0, gap, 3.4, top);
    } else if (windows.has(i)) {
      seg(0, side / 2, -1, 11);
      seg(-side / 4 - 0.4, side / 4 - 0.4, 11, top);
      seg(side / 4 + 0.4, side / 4 - 0.4, 11, top);
      seg(0, 0.4, 11, top);
      seg(0, side / 2, 12.6, top);
    } else seg(0, side / 2, -1, top);
  }
  // Ground floor slab, then ramp up the east wall to the north half-deck (5 m), then a ramp up the west wall to
  // the south half-deck (10 m).
  k.box(0, 0, R - 0.2, R - 0.2, -1.5, 0.15, deck, { tag: 'spire-floor' });
  k.box(4.6, -0.6, 4, 1.0, -0.2, 5, deck, { yaw: Math.PI / 2, rise: 5.2, tag: 'spire-ramp-1' });
  k.box(-1.5, -4.6, 5.2, 2.6, 4.6, 5, deck, { tag: 'spire-deck-1' });
  k.box(-4.6, 0.4, 4, 1.0, 4.8, 10, deck, { yaw: -Math.PI / 2, rise: 5.2, tag: 'spire-ramp-2' });
  k.box(1.5, 4.6, 5.2, 2.6, 9.6, 10, deck, { tag: 'spire-deck-2' });
  // Third ramp up the east wall from the top deck to the sniper roost behind the south parapet (15 m).
  k.box(4.6, -2, 4, 1.0, 9.8, 15, deck, { yaw: Math.PI / 2, rise: 5.2, tag: 'spire-ramp-3' });
  k.box(0.85, -5.6, 2.85, 1.6, 14.6, 15, deck, { tag: 'spire-roost' });

  // Crown: chitin spikes curling inward over the open top, and resin veins down the outside.
  const bone = oldBone(ORGANIC.mist, 0.6);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rand() * 0.2;
    const r0 = R + 0.2, h = H + 4 + rand() * 7;
    const pts = [
      new THREE.Vector3(Math.sin(a) * r0, H - 3, Math.cos(a) * r0),
      new THREE.Vector3(Math.sin(a) * (r0 + 1.2), H + 2, Math.cos(a) * (r0 + 1.2)),
      new THREE.Vector3(Math.sin(a) * (r0 * 0.7), h, Math.cos(a) * (r0 * 0.7)),
      new THREE.Vector3(Math.sin(a) * (r0 * 0.35), h - 1.5 - rand() * 2, Math.cos(a) * (r0 * 0.35)),
    ];
    k.group.add(rib(pts, 0.35 + rand() * 0.2, bone));
  }
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2, top = 4 + rand() * (H - 4);
    const pts = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(Math.sin(a + t * 0.3) * (R + T + 0.1), top * (1 - t), Math.cos(a + t * 0.3) * (R + T + 0.1)));
    k.group.add(rib(pts, 0.12 + rand() * 0.1, bone, 16));
  }
  // Corner columns: thick bone ribs up each octagon corner, flaring at the base and curling into the crown.
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const rc = R / Math.cos(Math.PI / 8) + 0.5;
    const pts = [
      new THREE.Vector3(Math.sin(a) * (rc + 2.2), -0.5, Math.cos(a) * (rc + 2.2)),
      new THREE.Vector3(Math.sin(a) * (rc + 0.4), 3, Math.cos(a) * (rc + 0.4)),
      new THREE.Vector3(Math.sin(a) * rc, H * 0.6, Math.cos(a) * rc),
      new THREE.Vector3(Math.sin(a) * (rc + 0.6), H + 1, Math.cos(a) * (rc + 0.6)),
      new THREE.Vector3(Math.sin(a) * (rc - 1), H + 5, Math.cos(a) * (rc - 1)),
    ];
    k.group.add(rib(pts, 0.75, bone, 40));
  }
  // Horizontal sinew bands wrapping the shell at each floor.
  for (const y of [4.8, 9.8, 15]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R / Math.cos(Math.PI / 8) + 0.35, 0.28, 8, 48), bone);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    k.group.add(ring);
  }
  // One dim light inside so the rooms read; the windows and the open top do the rest.
  const lamp = new THREE.PointLight(ORGANIC.amber, 28, 22, 2);
  lamp.position.set(0, 7.5, 0);
  k.group.add(lamp);
  // Inside: a few softly glowing egg clusters on the decks (the only light in the tower).
  const glow = bioNode(ORGANIC.amber, 0.8);
  for (const [u, y, v] of [[-3, 0.3, 3], [2, 5.3, -5.5], [-2, 10.3, 5.6], [4, 10.3, 5]]) {
    for (let j = 0; j < 4; j++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.22 + rand() * 0.18, 10, 8), glow);
      m.position.set(u + (rand() - 0.5), y, v + (rand() - 0.5));
      k.group.add(m);
    }
  }
  // Interior: roots climbing the inner walls, cocoons hanging under the decks, bone railings on the deck edges,
  // and shards on the floors, so the rooms read as a hive that grew rather than a box.
  const sinew = chitin(ZONE7_SHADE.stem, ZONE7_SHADE.moss, 2);
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2, r0 = R - T - 0.15, y0 = rand() * 3, y1 = y0 + 4 + rand() * 9;
    const pts = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(Math.sin(a + Math.sin(t * 5 + i) * 0.08) * r0, y0 + (y1 - y0) * t, Math.cos(a + Math.sin(t * 5 + i) * 0.08) * r0));
    k.group.add(rib(pts, 0.06 + rand() * 0.08, sinew, 18));
  }
  const cocoon = membrane(ZONE7_SHADE.flesh, 0.75);
  for (const [u, v, y] of [[-3, -5, 4.4], [1, -6, 4.4], [-4.5, -3.5, 4.3], [3, 5, 9.4], [-1, 6, 9.4], [0.5, 3, 9.4]]) {
    const len = 0.8 + rand() * 0.9;
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), cocoon);
    c.scale.set(1, len * 1.6, 1);
    c.position.set(u + (rand() - 0.5), y - len * 0.6, v + (rand() - 0.5) * 0.6);
    k.group.add(c, rib([new THREE.Vector3(c.position.x, y, c.position.z), new THREE.Vector3(c.position.x, c.position.y + len * 0.4, c.position.z)], 0.03, sinew, 3));
  }
  for (const [u0, v0, u1, y] of [[-6.6, -2.1, 3.6, 5], [-3.6, 2.1, 6.6, 10]]) {
    for (let t = 0; t <= 1.001; t += 0.25) {
      const u = u0 + (u1 - u0) * t;
      k.group.add(rib([new THREE.Vector3(u, y, v0), new THREE.Vector3(u + 0.1, y + 0.6, v0), new THREE.Vector3(u, y + 1.05, v0)], 0.06, bone, 6));
    }
    k.group.add(rib([new THREE.Vector3(u0, y + 1.05, v0), new THREE.Vector3((u0 + u1) / 2, y + 0.95, v0), new THREE.Vector3(u1, y + 1.05, v0)], 0.08, bone, 16));
  }
  for (let i = 0; i < 14; i++) {
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.08 + rand() * 0.1, 0.4 + rand() * 0.6, 5), bone);
    const fl = [0.15, 5, 10][i % 3];
    const [u, v] = fl === 0.15 ? [(rand() - 0.5) * 9, (rand() - 0.5) * 9] : fl === 5 ? [-5 + rand() * 7, -6.5 + rand() * 1.6] : [-2 + rand() * 7, 5.5 + rand() * 1.6];
    shard.position.set(u, fl + 0.1, v);
    shard.rotation.set(1.3 + rand() * 0.4, rand() * 6, 0);
    k.group.add(shard);
  }
  const lootAt = (id: string, u: number, y: number, v: number, container?: string): LootSpot => { const [lx, lz] = k.at(u, v); return { id, x: lx, y: base + y, z: lz, ...(container ? { container } : {}) }; };
  return { group: k.group, loot: [lootAt('spire-ground', -3.5, 0.15, 2.5), lootAt('spire-mid', -1, 5, -5.8), lootAt('spire-top', 2.5, 10, 5.4, 'bioPod'), lootAt('spire-roost', -1, 15, -6, 'bioPod')] };
}

/**
 * The Reliquary Bowl: a sunken arena (`radius`, `depth`) with sheer stone walls except at two entrances (local
 * -u and +u), a ledge 3 m up around the north half, four pillars of hard cover, a liquid-light pool at the centre,
 * and the ribcage of a dead sky-leviathan arching over it as the landmark. The terrain bowl itself is carved by
 * zone7.ts `groundHeight` (see arenaBowl).
 */
export function reliquaryBowl(solids: CollisionWorld, x: number, z: number, yaw: number, radius: number, floorY: number, height: Height, seed = 23): { group: THREE.Group; arena: ArenaInfo; pillars: Map<string, { mesh: THREE.Mesh; collider: Collider }> } {
  const rand = mulberry32(seed);
  const k = new Kit(solids, x, z, yaw, floorY);
  k.group.name = 'reliquary-bowl';
  const stone = zoneRock({ veinColour: ORGANIC.vein, mossColour: ZONE7_SHADE.moss, scale: 0.8 });
  const bone = oldBone(ORGANIC.mist, 0.4);

  // Sheer walls: a ring of stone segments inside the rim, open at the two entrances (local angle 90° and 270°).
  const wallR = radius * 0.8, n = 30, entranceHalf = 0.3;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    if (Math.abs(Math.cos(a)) < entranceHalf) continue;
    const u = Math.sin(a) * wallR, v = Math.cos(a) * wallR;
    const [wx, wz] = k.at(u, v);
    const top = Math.max(height(wx, wz), floorY + 2) - floorY + 0.4;
    const half = (Math.PI * wallR) / n + 0.15;
    // Collider only: the visible cliff is the sculpted face below.
    k.box(u, v, half, 1.4, -1, top, stone, { yaw: a, tag: `bowl-wall-${i}` }).mesh.visible = false;
  }
  // The cliff face: two sculpted arcs of layered stone with overhangs and fissures, following the rim's height.
  const cliffMat = zoneRock({ veinColour: ORGANIC.vein, mossColour: ZONE7_SHADE.moss, scale: 1.3 });
  cliffMat.side = THREE.DoubleSide;
  const arcHalf = Math.acos(entranceHalf);
  for (const centre of [0, Math.PI]) {
    const AS = 72, VS = 14;
    const geo = new THREE.PlaneGeometry(1, 1, AS, VS);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const fa = pos.getX(i) + 0.5, fv = pos.getY(i) + 0.5;
      const a = centre - arcHalf + fa * arcHalf * 2;
      const u0 = Math.sin(a) * wallR, v0 = Math.cos(a) * wallR;
      const [wx, wz] = k.at(u0, v0);
      const top = Math.max(height(wx, wz), floorY + 2) - floorY + 0.6;
      const y = -1 + fv * (top + 1);
      const strata = Math.sin(y * 1.7 + noise3(a * 4, y * 0.3, 1) * 3) * 0.25;
      const bulge = (noise3(a * 7, y * 0.35, 3) - 0.5) * 2.2 + (noise3(a * 22, y * 1.2, 5) - 0.5) * 0.6 + strata;
      // Ends of each arc curl back into the entrance cut so there is no paper edge.
      const endFade = Math.min(1, Math.min(fa, 1 - fa) * 8);
      const r = wallR - 1.4 - Math.max(0, bulge) * endFade + (1 - endFade) * 1.5;
      pos.setXYZ(i, Math.sin(a) * r, y, Math.cos(a) * r);
    }
    geo.computeVertexNormals();
    const cliff = new THREE.Mesh(geo, cliffMat);
    cliff.name = 'bowl-cliff';
    k.group.add(cliff);
  }
  // The ledge: 3 m up around the north half (local +v), reached by ramps beside each entrance.
  const ledgeR = wallR - 2.6;
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) / 12) * Math.PI;
    const u = Math.sin(a) * ledgeR, v = Math.cos(a) * ledgeR;
    if (Math.abs(Math.sin(a)) > 0.93) continue;
    k.box(u, v, (Math.PI * ledgeR) / 12 / 2 + 0.25, 1.5, -1, 3, stone, { yaw: a, tag: `bowl-ledge-${i}` });
  }
  const ledgeHalfArc = Math.asin(0.93) + (Math.PI / 12) * 0.5;
  const endA = -Math.PI / 2 + (1.5 / 12) * Math.PI;
  for (const s of [-1, 1]) {
    const u = s * Math.abs(Math.sin(endA)) * ledgeR, v = Math.cos(endA) * ledgeR;
    // Ramp climbs north (+v) onto the ledge's end, just inside each entrance.
    k.box(u, v - 1.5 - 3.6, 3.6, 1.3, -1, 3, stone, { yaw: -Math.PI / 2, rise: 4, tag: `bowl-ledge-ramp-${s > 0 ? 'e' : 'w'}` });
  }
  // Four pillars of hard cover (fungal bone columns); boxes approximate their round trunks.
  const pillars = new Map<string, { mesh: THREE.Mesh; collider: Collider }>();
  const pillarInfo: ArenaInfo['pillars'] = [];
  [[0.42, 0.55], [-0.45, 0.4], [0.4, -0.45], [-0.38, -0.5]].forEach(([fu, fv], i) => {
    const u = fu * radius * 0.75, v = fv * radius * 0.75;
    const id = `bowl-pillar-${i}`;
    const p = k.box(u, v, 1.3, 1.3, -0.5, 7 + rand() * 3, bone, { yaw: rand() * 3, tag: id });
    p.mesh.geometry.dispose();
    p.mesh.geometry = pillarGeometry(p.collider.y1 - p.collider.y0, i + seed);
    pillars.set(id, p);
    const [px, pz] = k.at(u, v);
    pillarInfo.push({
      id, x: px, z: pz, radius: 1.5,
      get broken() { return !p.mesh.visible; },
      destroy() {
        if (!p.mesh.visible) return;
        p.mesh.visible = false;
        p.collider.y1 = p.collider.y0; // a zero-height collider never blocks or holds anything up
      },
    });
  });
  // Centre pool of liquid light (pale, slow: it floods outward in phase 3).
  const pool = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.18, 48).rotateX(-Math.PI / 2), liquidLight({ pool: true, a: ZONE7_SHADE.moss, b: ZONE7_SHADE.stem, c: ORGANIC.mist, flow: 0.2 }));
  pool.position.y = 0.08;
  pool.name = 'reliquary-pool';
  k.group.add(pool);

  // Landmark: the dead leviathan's ribcage arching over the bowl, its spine along local v, a skull at the north.
  for (let i = 0; i < 9; i++) {
    const v = -radius * 0.75 + (i / 8) * radius * 1.5;
    const span = radius * (0.95 - Math.abs(i - 4) * 0.06);
    const h = 26 - Math.abs(i - 4) * 2.2;
    for (const s of [-1, 1]) {
      const pts = [
        new THREE.Vector3(s * span, 4, v + (rand() - 0.5) * 2),
        new THREE.Vector3(s * span * 1.02, h * 0.55, v),
        new THREE.Vector3(s * span * 0.6, h, v),
        new THREE.Vector3(s * 0.4, h + 3, v),
      ];
      k.group.add(rib(pts, 0.55 + (4 - Math.abs(i - 4)) * 0.08, bone, 36));
    }
  }
  const spine = rib([-1.1, -0.5, 0, 0.5, 1.1].map((t) => new THREE.Vector3(0, 28 + Math.cos(t) * 2 - 2, t * radius * 0.85)), 1.1, bone, 48);
  k.group.add(spine);
  // Vertebrae along the spine, each with a pair of short processes.
  for (let i = 0; i < 9; i++) {
    const v = -radius * 0.9 + (i / 8) * radius * 1.8;
    const y = 26 + Math.cos((v / (radius * 0.85)) * 0.9) * 2 - 2;
    const vert = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), bone);
    vert.scale.set(1.3, 0.9, 0.8);
    vert.position.set(0, y + 0.6, v);
    k.group.add(vert, rib([new THREE.Vector3(0, y + 1, v), new THREE.Vector3(0.3, y + 3.5, v - 0.8), new THREE.Vector3(0, y + 5, v - 2)], 0.3, bone, 10));
  }
  // A few hanging membranes between ribs, faintly lit: the boss's shed skin.
  const veil = membrane(ORGANIC.vein, 0.25);
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6 + rand() * 6, 8 + rand() * 8, 6, 8), veil);
    m.position.set((rand() - 0.5) * radius, 14 + rand() * 6, (rand() - 0.5) * radius);
    m.rotation.set(0, rand() * Math.PI, (rand() - 0.5) * 0.3);
    k.group.add(m);
  }
  const animate = () => { pool.rotation.y = bioTime.value * 0.01; };
  pool.onBeforeRender = animate;

  const entrances = [-1, 1].map((s) => { const [ex, ez] = k.at(s * radius * 1.05, 0); return { x: ex, z: ez }; });
  const [poolX, poolZ] = k.at(0, 0);
  const [bx, bz] = k.at(0, radius * 0.35);
  return {
    group: k.group,
    pillars,
    arena: { id: 'reliquaryBowl', x, z, radius, floorY, entrances, pillars: pillarInfo, pool: { x: poolX, z: poolZ, radius: radius * 0.18 }, bossSpawn: { x: bx, z: bz },
      ledge: { y: floorY + 3, innerR: ledgeR - 1.5, outerR: ledgeR + 1.5, halfArc: ledgeHalfArc, yaw },
      onLedge(px, pz) {
        const dx = px - x, dz = pz - z, c = Math.cos(yaw), s = Math.sin(yaw);
        const u = dx * c - dz * s, v = dx * s + dz * c, r = Math.hypot(u, v);
        return r >= ledgeR - 1.5 && r <= ledgeR + 1.5 && Math.abs(Math.atan2(u, v)) <= ledgeHalfArc;
      },
    },
  };
}

/**
 * The Long Seed Debris Field: torn hull sections of the crashed seedship lying on the island, each a half-buried
 * tunnel you can walk through, ribbed with bulkhead frames and overgrown with roots; cargo crates as cover and loot,
 * and the ship's black box in the largest section.
 */
export function longSeedDebris(solids: CollisionWorld, x: number, z: number, yaw: number, height: Height, seed = 31): { group: THREE.Group; loot: LootSpot[] } {
  const rand = mulberry32(seed);
  const base = height(x, z);
  const k = new Kit(solids, x, z, yaw, base);
  k.group.name = 'long-seed-debris';
  const hull = oldBone(ORGANIC.mist, 0.25);
  const plate = chitin(ZONE7_SHADE.rock, ORGANIC.mist, 0.8);
  const crateMat = chitin(ZONE7_SHADE.stem, HIVE.acid, 1.4);
  const roots = chitin(ZONE7_SHADE.stem, ZONE7_SHADE.moss, 2);
  const loot: LootSpot[] = [];
  const lootAt = (id: string, u: number, y: number, v: number, container = 'cargoCrate') => { const [lx, lz] = k.at(u, v); loot.push({ id, x: lx, y: base + y, z: lz, container }); };
  // Each section: (u, v) centre, local yaw, length, radius, how much of the arc survives.
  const sections: [number, number, number, number, number, number][] = [[-6, -4, 0.15, 16, 4.6, 0.62], [9, 6, -0.5, 11, 3.8, 0.55], [-3, 13, 1.25, 8, 3.4, 0.5]];
  sections.forEach(([u, v, syaw, len, r, arc], si) => {
    const sec = new THREE.Group();
    sec.position.set(u, 0, v);
    sec.rotation.y = syaw;
    k.group.add(sec);
    // The shell: an open cylinder lying along local Z, its arc over the top, sunk a little into the ground.
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 40, 6, true, Math.PI * (1 - arc), Math.PI * 2 * arc), hull);
    shell.geometry.rotateX(Math.PI / 2);
    shell.position.y = r * 0.55;
    sec.add(shell);
    // Bulkhead frames every 2.5 m, some snapped.
    for (let f = -len / 2 + 1; f < len / 2; f += 2.5) {
      if (rand() < 0.25) continue;
      const sweep = Math.PI * 2 * arc * (0.6 + rand() * 0.4);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r - 0.15, 0.22, 6, 40, sweep), plate);
      ring.rotation.z = Math.PI / 2 - sweep / 2 + (rand() - 0.5) * 0.4;
      ring.position.set(0, r * 0.55, f);
      sec.add(ring);
    }
    // Side walls collide; the curved roof is out of reach. Colliders in the structure frame.
    const co = Math.cos(syaw), sn = Math.sin(syaw);
    for (const sideU of [-1, 1]) {
      const wu = sideU * (r - 0.3);
      const cu = u + wu * co, cv = v - wu * sn;
      solids.add({ ...colliderFrom(k, cu, cv), hx: 0.35, hz: len / 2, yaw: yaw + syaw, y0: base - 1, y1: base + r * 0.9, tag: `debris-wall-${si}` });
    }
    // Roots breaking through the plating.
    for (let i = 0; i < 6; i++) {
      const f = (rand() - 0.5) * len, a = (rand() - 0.5) * 2.4;
      const pts = [new THREE.Vector3(Math.sin(a) * (r + 2), -0.3, f + 1), new THREE.Vector3(Math.sin(a) * r, r * 0.55 + Math.cos(a) * r * 0.9, f), new THREE.Vector3(Math.sin(a) * (r - 1.5), r * 0.4, f - 1.5)];
      sec.add(rib(pts, 0.08 + rand() * 0.1, roots, 14));
    }
  });
  // Cargo crates: hard cover inside and around the sections (colliders), some of them lootable.
  const crates: [number, number, number][] = [[-7.5, -7, 0.2], [-4.5, 1, -0.3], [-8, 3.5, 0.6], [6, 2, 0.1], [11, 9, -0.4], [2, 10, 0.8], [-1, -12, 0.3]];
  crates.forEach(([u, v, cy], i) => {
    const s = 0.7 + rand() * 0.25;
    const box = k.box(u, v, s, s * 0.8, -0.1, s * 1.5, crateMat, { yaw: cy, tag: `debris-crate-${i}` });
    box.mesh.geometry.dispose();
    box.mesh.geometry = new THREE.BoxGeometry(s * 2, s * 1.6, s * 1.6);
    if (i === 0 || i === 4) lootAt(`debris-crate-${i}`, u + Math.sin(cy + 1.57) * (s + 0.9), 0, v + Math.cos(cy + 1.57) * (s + 0.9));
  });
  // The black box: a pale capsule at the back of the largest section, its status light a single green point.
  const bb = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.6, 6, 12), plate);
  bb.rotation.z = Math.PI / 2;
  bb.position.set(-6 + Math.sin(0.15) * -6, 0.4, -4 + Math.cos(0.15) * -6);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), bioNode(HIVE.acid, 4));
  led.position.copy(bb.position).add(new THREE.Vector3(0, 0.36, 0));
  k.group.add(bb, led);
  lootAt('debris-blackbox', bb.position.x + 1, 0, bb.position.z, 'cargoCrate');
  return { group: k.group, loot };
}

/** World centre of a structure-frame point, for colliders that live in a sub-frame. */
function colliderFrom(k: Kit, u: number, v: number): { cx: number; cz: number } {
  const [cx, cz] = k.at(u, v);
  return { cx, cz };
}

/**
 * A fungal-bone column: flared root foot, knotted growth rings, a split crown; vertices pitted by noise so it never
 * reads as a cylinder. Centred on its height like a BoxGeometry.
 */
function pillarGeometry(h: number, seed: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const flare = 1 + Math.pow(1 - t, 6) * 1.1;
    const rings = 1 + Math.max(0, Math.sin(t * 22 + seed)) * 0.08;
    const crown = t > 0.9 ? 1 - (t - 0.9) * 4 : 1;
    pts.push(new THREE.Vector2(1.25 * flare * rings * crown, t * h - h / 2));
  }
  const geo = new THREE.LatheGeometry(pts, 18);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + (noise3(x * 1.3 + seed, y * 0.7, z * 1.3) - 0.5) * 0.35 + (noise3(x * 4, y * 3, z * 4 + seed) - 0.5) * 0.08;
    p.setXYZ(i, x * n, y, z * n);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Low-key fungal stems round a structure's footprint so it sits in the island rather than on it. */
export function rootSkirt(group: THREE.Group, radius: number, count: number, seed: number): void {
  const rand = mulberry32(seed);
  const mat = chitin(ZONE7_SHADE.stem, ZONE7_SHADE.moss, 2);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r0 = radius + rand() * 1.5;
    const pts = [0, 0.5, 1].map((t) => new THREE.Vector3(Math.sin(a + t * 0.2) * (r0 + t * 3), 2.5 - t * 3, Math.cos(a + t * 0.2) * (r0 + t * 3)));
    group.add(rib(pts, 0.2 + rand() * 0.2, mat, 12));
  }
}

/** A cave built for the island: where its glowing growth goes (the zone adds them to its fungus set) and its loot. */

/**
 * The Fungal Caves under the east cliff: a low rock dome you walk into from the island, winding between rock
 * columns to a back chamber lit by glowing growth and a small pool, with a second, narrower way out. The dome is
 * shell only (no roof collision is needed: its walls stop you climbing it); the columns and walls are solid.
 */
