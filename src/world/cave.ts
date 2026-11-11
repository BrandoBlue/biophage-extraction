import * as THREE from 'three';
import type { CaveSpec } from '../../data';
import { ORGANIC, ZONE7_SHADE } from '../render/palette';
import { bioNode, chitin, membrane, zoneRock } from '../render/materials';
import { hazeVolume } from '../render/atmos';
import { noise3 } from '../render/geometry';
import type { CollisionWorld, Collider } from './collision';
import { mulberry32 } from './rng';
import { Kit, type LootSpot } from './structures';

/**
 * The Fungal Caves (data/zone7.json `caves`): a dark domed chamber under the east cliff with a wide mouth toward
 * the island and two side tunnels. It is the Pale Vigil's lair (Design's bosses.json `paleVigil.arena`): roots
 * across the ceiling for it to crawl, five glow-fungus patches as the only light, six pieces of cover, points where
 * the ceiling can fall, and entrances that web-roots can seal in the enrage.
 */

const rad = (d: number) => (d * Math.PI) / 180;
const MOUTH_ANGLE = Math.PI;

export interface CaveEntrance {
  id: string; x: number; z: number;
  /** Unit vector (world x, z) pointing out of the cave through this entrance. */
  out: { x: number; z: number };
  width: number; height: number;
  readonly sealed: boolean;
  /** Grow (or clear) the web-roots across this entrance: blocks bodies and hides the opening. */
  seal(): void; unseal(): void;
}

export interface CaveLair {
  id: string; x: number; z: number; floorY: number;
  /** Chamber radius and ceiling height at its centre (metres). */
  radius: number; height: number;
  entrances: CaveEntrance[];
  /** World y of the chamber ceiling's underside at (x, z); the floor outside the chamber. */
  ceilingAt(x: number, z: number): number;
  /** Climb graph along the ceiling roots: nodes hang just under the ceiling, links join neighbours. */
  ceiling: { anchors: { x: number; y: number; z: number }[]; links: [number, number][] };
  /** Hard cover on the chamber floor. */
  cover: { id: string; x: number; z: number; radius: number; height: number }[];
  /** The glow-fungus patches: the only light in the chamber besides the boss's lure. */
  glowPatches: { x: number; z: number; radius: number }[];
  /** Candidate points where the ceiling falls in; clear of the cover. */
  collapsePoints: { x: number; z: number }[];
  /** Where the boss hangs when the raid starts. */
  bossSpawn: { x: number; y: number; z: number };
  /** Mid-points of the side tunnels: the escorts' ambush posts. */
  escorts: { x: number; z: number }[];
  /** Open ground just outside the main mouth: the nearest way out. */
  exit: { x: number; z: number };
}

export interface BuiltCave {
  group: THREE.Group;
  loot: LootSpot[];
  /** Fungus spots for the zone's flora pass: the glow patches, dense and small. */
  glow: { x: number; z: number; big: boolean }[];
  lair: CaveLair;
  floorY: number;
}

/** Local (u, v) of a world point in the cave's frame. */
function local(c: CaveSpec, x: number, z: number): [number, number] {
  const yaw = rad(c.yaw), co = Math.cos(yaw), si = Math.sin(yaw), dx = x - c.x, dz = z - c.z;
  return [dx * co - dz * si, dx * si + dz * co];
}

/** Signed distance (metres) from (x, z) to the cave's footprint: chamber, tunnels and the apron at the mouth. */
export function caveDistance(c: CaveSpec, x: number, z: number): number {
  const [u, v] = local(c, x, z);
  let d = Math.hypot(u, v) - c.radius;
  const capsule = (a: number, len: number, half: number) => {
    const ax = Math.cos(a), ay = Math.sin(a);
    const s = Math.min(len, Math.max(0, u * ax + v * ay));
    d = Math.min(d, Math.hypot(u - ax * s, v - ay * s) - half);
  };
  for (const t of c.tunnels) capsule(rad(t.angle), c.radius + t.length, t.width / 2);
  capsule(MOUTH_ANGLE, c.radius + 6, c.mouth.width / 2 + 2);
  return d;
}

/** Ceiling height above the floor at local radius r: the dome's underside, kept clear of its rocky bumps. */
function domeHeight(c: CaveSpec, r: number): number {
  return c.height * 0.93 * Math.sqrt(Math.max(0, 1 - (r / c.radius) ** 2)) - 0.4;
}

const angleTo = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export function fungalCaves(solids: CollisionWorld, c: CaveSpec, floorY: number, seed = 41): BuiltCave {
  const rand = mulberry32(seed);
  const yaw = rad(c.yaw);
  const k = new Kit(solids, c.x, c.z, yaw, floorY);
  k.group.name = 'fungal-caves';
  const R = c.radius, H = c.height;
  const rock = zoneRock({ veinColour: ORGANIC.vein, mossColour: ZONE7_SHADE.moss, scale: 1.6 });
  rock.side = THREE.DoubleSide;
  const hidden = new THREE.MeshBasicMaterial({ visible: false });

  // Openings in the dome: the main mouth and where each tunnel joins, as (angle, half-angle, height fraction).
  const holes: [number, number, number][] = [
    [MOUTH_ANGLE, Math.asin(c.mouth.width / 2 / R) + 0.03, c.mouth.height / H],
    ...c.tunnels.map((t): [number, number, number] => [rad(t.angle), Math.asin(t.width / 2 / R) + 0.03, t.height / H]),
  ];

  // The dome: a noise-sculpted half-ellipsoid, bulging outward only so the walls stay where the colliders are.
  const sphere = new THREE.SphereGeometry(1, 80, 26, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  const p = sphere.attributes.position;
  const keep: number[] = [];
  for (let t = 0; t < p.count; t += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < 3; j++) { cx += p.getX(t + j); cy += p.getY(t + j); cz += p.getZ(t + j); }
    const a = Math.atan2(cz, cx);
    if (holes.some(([ha, half, hy]) => angleTo(a, ha) < half && cy / 3 < hy)) continue;
    for (let j = 0; j < 3; j++) {
      const vx = p.getX(t + j), vy = p.getY(t + j), vz = p.getZ(t + j);
      const bump = 1 + noise3(vx * 3 + seed, vy * 3, vz * 3) * 0.12 + noise3(vx * 9, vy * 9, vz * 9) * 0.05;
      keep.push(vx * R * bump, vy * H * bump - 0.4, vz * R * bump);
    }
  }
  const dome = new THREE.BufferGeometry();
  dome.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  dome.computeVertexNormals();
  const shell = new THREE.Mesh(dome, rock);
  shell.name = 'cave-dome';
  k.group.add(shell);

  // Chamber walls: invisible boxes round the inside of the dome, open at the mouth and the tunnels.
  const n = 44;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    if (holes.some(([ha, half]) => angleTo(a, ha) < half + 0.02)) continue;
    const rc = R + 0.4;
    const seg = (Math.PI * R) / n + 0.5;
    k.box(Math.cos(a) * rc, Math.sin(a) * rc, 0.4, seg, -1, H, hidden, { yaw: -a, tag: 'cave-wall' });
  }

  // Side tunnels: low arched passages, each wall a collider, ending in a mouth on the slope.
  const escorts: CaveLair['escorts'] = [];
  const tunnelEnds: { id: string; a: number; s: number; width: number; height: number }[] = [];
  for (const t of c.tunnels) {
    const a = rad(t.angle), ax = Math.cos(a), ay = Math.sin(a), px = -ay, py = ax;
    const s0 = Math.sqrt(R * R - (t.width / 2) ** 2) - 1.5, s1 = R + t.length;
    const rings = 18, arc = 16, pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= rings; i++) {
      const s = s0 + ((s1 - s0) * i) / rings;
      for (let j = 0; j <= arc; j++) {
        const th = (j / arc) * Math.PI;
        const b = 1 + Math.max(0, noise3(s * 0.4, th * 2, t.angle)) * 0.25;
        const lat = Math.cos(th) * (t.width / 2 + 0.5) * b, up = Math.sin(th) * t.height * b;
        pos.push(ax * s + px * lat, up - 0.3, ay * s + py * lat);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < arc; j++) {
      const q = i * (arc + 1) + j;
      idx.push(q, q + arc + 1, q + 1, q + 1, q + arc + 1, q + arc + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tube = new THREE.Mesh(g, rock);
    tube.name = `cave-${t.id}`;
    k.group.add(tube);
    const mid = (s0 + s1) / 2, half = (s1 - s0) / 2;
    for (const side of [-1, 1]) {
      const off = t.width / 2 + 0.4;
      k.box(ax * mid + px * off * side, ay * mid + py * off * side, half, 0.4, -1, t.height, hidden, { yaw: -a, tag: 'cave-wall' });
    }
    const [ex, ez] = k.at(ax * (R + t.length * 0.5), ay * (R + t.length * 0.5));
    escorts.push({ x: ex, z: ez });
    tunnelEnds.push({ id: t.id, a, s: s1, width: t.width, height: t.height });
  }

  // Cover: three columns from floor to ceiling and three boulders to crouch behind, off the paths in.
  const coverAngles = [25, 62, 128, -25, -62, -128].map(rad).slice(0, c.cover);
  const cover: CaveLair['cover'] = [];
  coverAngles.forEach((a, i) => {
    const column = i % 2 === 0;
    const r = column ? R * 0.42 : R * 0.64;
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    const size = column ? 1.7 : 1.5;
    const top = column ? domeHeight(c, r) + 1 : 1.5;
    const g = new THREE.IcosahedronGeometry(1, 3);
    const gp = g.attributes.position;
    for (let j = 0; j < gp.count; j++) {
      const vx = gp.getX(j), vy = gp.getY(j), vz = gp.getZ(j);
      const b = 1 + (noise3(vx * 2 + u, vy * 2, vz * 2 + v) - 0.5) * 0.45;
      gp.setXYZ(j, vx * size * b, (vy * 0.5 + 0.5) * top * (0.92 + 0.12 * b), vz * size * b);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, rock);
    m.position.set(u, -0.3, v);
    m.name = column ? 'cave-column' : 'cave-boulder';
    k.group.add(m);
    const [wx, wz] = k.at(u, v);
    k.solids.add({ cx: wx, cz: wz, hx: size * 0.75, hz: size * 0.75, yaw, y0: floorY - 1, y1: floorY + top - 0.3, tag: column ? 'cave-column' : 'cave-boulder' });
    cover.push({ id: `cave-cover-${i}`, x: wx, z: wz, radius: size, height: top - 0.3 });
  });

  // Ceiling roots: thick runners across the underside of the dome, the boss's climbing routes.
  const rootMat = chitin(ZONE7_SHADE.stem, ZONE7_SHADE.moss, 1.2);
  const anchorsL: [number, number, number][] = [];
  const links: [number, number][] = [];
  for (let i = 0; i < c.roots; i++) {
    const a0 = (i / c.roots) * Math.PI * 2 + 0.3, a1 = a0 + Math.PI * (0.62 + rand() * 0.3);
    const r0 = R * 0.86;
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s <= 12; s++) {
      const f = s / 12;
      const u = THREE.MathUtils.lerp(Math.cos(a0) * r0, Math.cos(a1) * r0, f) + Math.sin(f * 9 + i) * 0.6;
      const v = THREE.MathUtils.lerp(Math.sin(a0) * r0, Math.sin(a1) * r0, f) + Math.cos(f * 7 + i) * 0.6;
      const y = domeHeight(c, Math.min(R * 0.97, Math.hypot(u, v))) - 0.35;
      pts.push(new THREE.Vector3(u, y, v));
      anchorsL.push([u, y, v]);
      if (s > 0) links.push([anchorsL.length - 2, anchorsL.length - 1]);
    }
    const root = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.32 + rand() * 0.12, 7), rootMat);
    root.name = 'cave-root';
    k.group.add(root);
    // Strands hanging from the runner.
    for (let s = 2; s < 12; s += 3) {
      const top = pts[s], len = 1 + rand() * 2.5;
      const strand = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([top, top.clone().add(new THREE.Vector3(rand() * 0.6 - 0.3, -len * 0.5, rand() * 0.6 - 0.3)), top.clone().add(new THREE.Vector3(rand() - 0.5, -len, rand() - 0.5))]), 8, 0.07, 5), rootMat);
      k.group.add(strand);
    }
  }
  // Where runners pass close to each other the boss can cross between them.
  for (let i = 0; i < anchorsL.length; i++) for (let j = i + 1; j < anchorsL.length; j++) {
    if (Math.floor(i / 13) === Math.floor(j / 13)) continue;
    const [a, b] = [anchorsL[i], anchorsL[j]];
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 2.6) links.push([i, j]);
  }
  const anchors = anchorsL.map(([u, y, v]) => { const [x, z] = k.at(u, v); return { x, y: floorY + y, z }; });

  // Glow patches: low luminous growth on the floor near the walls; the zone's flora pass adds their fungi.
  const glow: BuiltCave['glow'] = [];
  const glowPatches: CaveLair['glowPatches'] = [];
  const patchMat = bioNode(ORGANIC.mist, 0.5);
  for (let i = 0; i < c.glowPatches; i++) {
    const a = rad([0, 45, 135, -135, -45][i % 5] + Math.floor(i / 5) * 20), r = R * 0.74;
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    const bed = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20).rotateX(-Math.PI / 2), patchMat);
    bed.position.set(u, 0.04, v);
    bed.name = 'cave-glow-bed';
    k.group.add(bed);
    const [wx, wz] = k.at(u, v);
    glowPatches.push({ x: wx, z: wz, radius: 2.2 });
    for (let j = 0; j < 9; j++) {
      const ga = rand() * Math.PI * 2, gd = rand() * 2;
      const [fx, fz] = k.at(u + Math.cos(ga) * gd, v + Math.sin(ga) * gd);
      glow.push({ x: fx, z: fz, big: j === 0 });
    }
  }
  // One weak glow low in the middle so the room has shape; everything else is the patches and the lure.
  const light = new THREE.PointLight(ORGANIC.mist, 5, 20, 2);
  light.position.set(0, 1.2, 0);
  k.group.add(light);
  const haze = hazeVolume({ centre: new THREE.Vector3(0, H * 0.3, 0), size: new THREE.Vector3(R * 1.8, H * 0.6, R * 1.8), colour: ZONE7_SHADE.rockDeep, density: 0.035 });
  haze.name = 'cave-haze';
  k.group.add(haze);

  // Where the ceiling can come down: across the chamber floor, clear of the cover.
  const collapsePoints: CaveLair['collapsePoints'] = [];
  for (let tries = 0; collapsePoints.length < c.collapsePoints && tries < 400; tries++) {
    const a = rand() * Math.PI * 2, r = R * (0.15 + rand() * 0.6);
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    const [wx, wz] = k.at(u, v);
    if (cover.some((q) => Math.hypot(q.x - wx, q.z - wz) < q.radius + 2.5)) continue;
    if (collapsePoints.some((q) => Math.hypot(q.x - wx, q.z - wz) < 4.5)) continue;
    collapsePoints.push({ x: wx, z: wz });
  }

  // Entrances, each with web-roots that can seal it.
  const webMat = membrane(ZONE7_SHADE.stem, 0.8);
  const entrance = (id: string, a: number, s: number, width: number, height: number): CaveEntrance => {
    const u = Math.cos(a) * s, v = Math.sin(a) * s;
    const g = new THREE.PlaneGeometry(width + 1, height + 0.6, 10, 8);
    const gp = g.attributes.position;
    for (let j = 0; j < gp.count; j++) gp.setZ(j, (noise3(gp.getX(j) * 0.8, gp.getY(j) * 0.8, s) - 0.5) * 0.8);
    g.computeVertexNormals();
    const web = new THREE.Mesh(g, webMat);
    web.position.set(u, height / 2, v);
    web.rotation.y = Math.PI / 2 - a;
    web.visible = false;
    web.name = `web-${id}`;
    k.group.add(web);
    const gate: Collider = k.box(u, v, 0.5, width / 2 + 0.6, 0, height, hidden, { yaw: -a, tag: `web-${id}` }).collider;
    const top = gate.y1;
    gate.y1 = gate.y0;
    const [x, z] = k.at(u, v);
    return {
      id, x, z, out: { x: Math.cos(a - yaw), z: Math.sin(a - yaw) }, width, height,
      get sealed() { return web.visible; },
      seal() { web.visible = true; gate.y1 = top; },
      unseal() { web.visible = false; gate.y1 = gate.y0; },
    };
  };
  const mouthS = Math.sqrt(R * R - (c.mouth.width / 2) ** 2);
  const entrances = [entrance('mouth', MOUTH_ANGLE, mouthS, c.mouth.width, c.mouth.height), ...tunnelEnds.map((t) => entrance(t.id, t.a, t.s, t.width, t.height))];

  // A cache at the far end of the first tunnel, where the escorts wait.
  const t0 = tunnelEnds[0];
  const [lx, lz] = k.at(Math.cos(t0.a) * (t0.s - 3) - Math.sin(t0.a) * 1.6, Math.sin(t0.a) * (t0.s - 3) + Math.cos(t0.a) * 1.6);
  const [xx, xz] = k.at(-(R + 6), 0);
  const lair: CaveLair = {
    id: c.id, x: c.x, z: c.z, floorY, radius: R, height: H, entrances,
    ceilingAt(x, z) {
      const [u, v] = local(c, x, z);
      return floorY + Math.max(0, domeHeight(c, Math.hypot(u, v)));
    },
    ceiling: { anchors, links },
    cover, glowPatches, collapsePoints, escorts,
    bossSpawn: { x: c.x, y: floorY + domeHeight(c, 0) - 1.2, z: c.z },
    exit: { x: xx, z: xz },
  };
  return { group: k.group, loot: [{ id: 'cave-cache', x: lx, y: floorY, z: lz, container: 'bioPod' }], glow, lair, floorY };
}
