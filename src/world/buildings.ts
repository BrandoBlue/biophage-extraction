import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HIVE, ORGANIC, ZONE7_SHADE } from '../render/palette';
import { bioNode, chitin, grownWall, livingFlesh, membrane } from '../render/materials';
import { noise3 } from '../render/geometry';
import { roughen } from './organic';
import type { Kit, LootSpot } from './structures';
import type { LivingProps } from './life';

/**
 * Grown buildings and the things inside them (World & Level). Brandon, 2026-11-12: "actual buildings, organic, with
 * physics and things inside, not basic."
 *
 * A grown hall is an oval chamber: a ring of thick, lumpy wall segments (each a Kit box, so the collider is exact),
 * doorways left open in the ring with a lintel over each, a domed shell roof on top and bone buttresses arching down
 * the outside. Rooms join through short roofed passages. Interiors are dressed from a small kit of purposeful things:
 * growth tanks, nests, remains, sacs hanging from the dome, urns, grown caskets (the loot containers' shells) and
 * membrane curtains in the doorways. The moving and breakable ones are LivingProps (src/world/life.ts).
 */

export interface HallOptions {
  /** Centre in the Kit's frame (m). */
  u: number; v: number;
  /** Half-axes of the oval floor (m). */
  ru: number; rv: number;
  /** Wall height (m) and the dome's rise above it. */
  height?: number; dome?: number;
  /** Doorway directions, radians in the Kit's frame (0 = local +X, PI/2 = local +Z). */
  doors: number[];
  /** Doorway width (m). */
  doorWidth?: number;
  seed?: number;
  /** A zone's own wall, dome and rib materials (default: buildingMats()). */
  mats?: Partial<Pick<BuildingMats, 'wall' | 'shell' | 'bone'>>;
}

export interface Hall {
  /** Doorway centres in the Kit's frame and the direction each faces (outward). */
  doors: { u: number; v: number; yaw: number }[];
  ceiling: number;
}

export interface BuildingMats { wall: THREE.Material; shell: THREE.Material; bone: THREE.Material; flesh: THREE.Material; skin: THREE.Material; glass: THREE.Material; glow: THREE.Material; casket: THREE.Material }
let shared: BuildingMats | null = null;
/** One shared set of building materials (grounded tones; the glow stays an accent). */
export function buildingMats(): BuildingMats {
  return shared ??= {
    wall: doubleSided(grownWall({ base: ZONE7_SHADE.stem, seam: ZONE7_SHADE.rockDeep, vein: ORGANIC.vein, plate: 1.4 })),
    shell: doubleSided(grownWall({ base: ZONE7_SHADE.rock, seam: ZONE7_SHADE.rockDeep, vein: ORGANIC.vein, plate: 2.4 })),
    bone: chitin(HIVE.bone, ORGANIC.mist, 0.9),
    flesh: livingFlesh(ZONE7_SHADE.flesh, ORGANIC.vein, ORGANIC.wetFlesh),
    skin: membrane(ORGANIC.vein, 0.62),
    glass: membrane(ZONE7_SHADE.moss, 0.5),
    glow: bioNode(ORGANIC.amber, 0.9),
    casket: chitin(ZONE7_SHADE.flesh, ORGANIC.amber, 1.2),
  };
}

/** Underside of a doorway's lintel (m). */
export const LINTEL = 2.7;

function doubleSided<T extends THREE.Material>(m: T): T { m.side = THREE.DoubleSide; return m; }

const segs = (ru: number, rv: number) => Math.max(14, Math.round((Math.PI * (ru + rv)) / 1.7));

/** An oval grown hall in Kit `k`. Walls collide; the dome does not (nobody reaches it). */
export function grownHall(k: Kit, o: HallOptions): Hall {
  const M = { ...buildingMats(), ...o.mats };
  const H = o.height ?? 3.6, dome = o.dome ?? Math.min(o.ru, o.rv) * 0.55, dw = o.doorWidth ?? 2;
  const n = segs(o.ru, o.rv);
  const doors: Hall['doors'] = [];
  const at = (a: number, s = 1): [number, number] => [o.u + Math.cos(a) * o.ru * s, o.v + Math.sin(a) * o.rv * s];
  const doorAt = (a: number) => o.doors.some((d) => { const [x0, z0] = at(a), [x1, z1] = at(d); return Math.hypot(x1 - x0, z1 - z0) < dw / 2 + 0.85; });
  // Colliders: a ring of boxes round the oval (lintels over the doorways). Their meshes are dropped: one grown
  // shell is drawn over them instead, so the wall reads as a single living surface rather than panels.
  const hide = (b: { mesh: THREE.Mesh }) => { k.group.remove(b.mesh); b.mesh.geometry.dispose(); };
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const [x0, z0] = at(a0), [x1, z1] = at(a1), [xm, zm] = at(am);
    const len = Math.hypot(x1 - x0, z1 - z0) / 2 + 0.25;
    const yaw = Math.atan2(-(z1 - z0), x1 - x0);
    if (doorAt(am)) hide(k.box(xm, zm, len, 0.45, LINTEL, H, M.wall, { yaw, tag: 'hall-lintel' }));
    else hide(k.box(xm, zm, len, 0.45, -0.3, H, M.wall, { yaw, tag: 'hall-wall' }));
  }
  const wall = new THREE.Mesh(ringWall(o.ru, o.rv, H, (a) => doorAt(a), o.seed ?? 3), M.wall);
  wall.position.set(o.u, 0, o.v);
  wall.userData.noOrganic = true;
  wall.castShadow = wall.receiveShadow = true;
  k.group.add(wall);
  for (const d of o.doors) { const [du, dv] = at(d); doors.push({ u: du, v: dv, yaw: d }); }
  // Dome: a squashed hemisphere over the oval, roughened, a lip overhanging the wall top; torn open if asked.
  const shell = new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = shell.attributes.position;
  const seed = o.seed ?? 3;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const sag = 1 - 0.12 * noise3(x * 2 + seed, y * 2, z * 2);
    p.setXYZ(i, x * (o.ru + 0.6), H - 0.15 + y * dome * sag, z * (o.rv + 0.6));
  }
  shell.computeVertexNormals();
  const domeMesh = new THREE.Mesh(roughen(shell, 0.8, seed), M.shell);
  domeMesh.position.set(o.u, 0, o.v);
  domeMesh.userData.noOrganic = true;
  domeMesh.castShadow = true;
  k.group.add(domeMesh);
  // Buttresses: bone ribs arching from the ground up over the dome, every few metres round the wall.
  const ribs: THREE.BufferGeometry[] = [];
  const nr = Math.max(5, Math.round(n / 3));
  for (let i = 0; i < nr; i++) {
    const a = (i / nr) * Math.PI * 2 + 0.2;
    if (doorAt(a)) continue;
    // Foot out on the ground, up the wall's outer face, then over the dome just proud of its surface.
    const ov = (f: number, lift: number) => {
      const [x, z] = at(a, f), ux = (x - o.u) / (o.ru + 0.6), uz = (z - o.v) / (o.rv + 0.6), uy = Math.sqrt(Math.max(0, 1 - ux * ux - uz * uz));
      return new THREE.Vector3(x, H - 0.15 + uy * dome * (1 - 0.12 * noise3(ux * 2 + seed, uy * 2, uz * 2)) + lift, z);
    };
    const [fx, fz] = at(a, 1.32), [wx, wz] = at(a, 1.2);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(fx, -0.3, fz), new THREE.Vector3(wx, H * 0.6, wz), new THREE.Vector3(wx, H + 0.45, wz), ov(0.85, 0.55), ov(0.55, 0.55)]);
    ribs.push(taperedTube(curve, 0.32, 0.1, 20, 7));
  }
  if (ribs.length) {
    const m = new THREE.Mesh(mergeGeometries(ribs), M.bone);
    m.userData.noOrganic = true;
    k.group.add(m);
  }
  return { doors, ceiling: H };
}

/** A short roofed passage between two points in the Kit's frame (walls collide; open at both ends). */
export function grownPassage(k: Kit, a: [number, number], b: [number, number], width = 2.4, height = 3): void {
  const M = buildingMats();
  const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv), yaw = Math.atan2(-dv, du);
  const nu = -dv / len, nv = du / len, mu = (a[0] + b[0]) / 2, mv = (a[1] + b[1]) / 2;
  for (const s of [-1, 1]) k.box(mu + nu * s * (width / 2 + 0.3), mv + nv * s * (width / 2 + 0.3), len / 2, 0.35, -0.3, height, M.wall, { yaw, tag: 'passage-wall', flatTop: true });
  const roof = new THREE.CylinderGeometry(width / 2 + 0.7, width / 2 + 0.7, len, 16, 6, true, 0, Math.PI);
  roof.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(roughen(roof, 0.6, 4), M.shell);
  m.position.set(mu, height - 0.4, mv);
  m.rotation.y = yaw;
  m.userData.noOrganic = true;
  k.group.add(m);
}

/**
 * The grown wall of an oval hall as one shell: thick, bulging, flared at the foot, its top a rounded lip, with the
 * doorways left open below the lintel. Arcs where `door(a)` is true only run from the lintel up.
 */
export function ringWall(ru: number, rv: number, H: number, door: (a: number) => boolean, seed: number, half = 0.45): THREE.BufferGeometry {
  const N = Math.max(48, Math.round((Math.PI * (ru + rv)) / 0.35));
  const flags = Array.from({ length: N }, (_, i) => door(((i + 0.5) / N) * Math.PI * 2));
  // Runs of equal flag (wrapping round), each drawn as its own strip so the jambs are clean.
  const runs: { i0: number; i1: number; d: boolean }[] = [];
  const start = flags.findIndex((f, i) => f !== flags[(i + N - 1) % N]);
  const s0 = start < 0 ? 0 : start;
  for (let k = 0; k < N;) {
    const i0 = s0 + k, d = flags[i0 % N];
    let len = 0;
    while (k + len < N && flags[(s0 + k + len) % N] === d) len++;
    runs.push({ i0, i1: i0 + len, d });
    k += len;
  }
  const P = (a: number, y: number, side: number): THREE.Vector3 => {
    const t = y / H;
    const flare = 0.4 * (1 - t) ** 3;
    const lump = 0.16 * noise3(Math.cos(a) * 3 + seed, y * 0.7, Math.sin(a) * 3);
    const lip = t > 0.92 ? -(t - 0.92) * 3 * half * side : 0; // round the lip inward on the outer face, out on the inner
    const off = side * (half + (side > 0 ? flare : flare * 0.3)) + lump + lip;
    const ex = Math.cos(a), ez = Math.sin(a);
    // Normal of the ellipse at a (scaled), to offset the faces along.
    const nx = ex / ru, nz = ez / rv, nl = Math.hypot(nx, nz);
    return new THREE.Vector3(ex * ru + (nx / nl) * off, y, ez * rv + (nz / nl) * off);
  };
  const parts: THREE.BufferGeometry[] = [];
  const grid = (cols: number, rows: number, f: (c: number, r: number) => THREE.Vector3, flip = false) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { const v = f(c, r); pos.push(v.x, v.y, v.z); uv.push(c / cols, r / rows); }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      if (flip) idx.push(a, d, b, b, d, e); else idx.push(a, b, d, b, e, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const ROWS = 7;
  for (const run of runs) {
    const cols = run.i1 - run.i0;
    // A doorway's head is a low arch: springing at 2.3 m by the jambs, LINTEL + 0.2 at the crown.
    const y0 = (c: number) => (run.d ? 2.3 + (LINTEL + 0.2 - 2.3) * Math.sin((Math.PI * c) / cols) ** 0.6 : -0.3);
    const A = (c: number) => ((run.i0 + c) / N) * Math.PI * 2;
    const Y = (c: number, r: number) => y0(c) + (H - y0(c)) * (r / ROWS);
    parts.push(grid(cols, ROWS, (c, r) => P(A(c), Y(c, r), 1), true)); // outer face
    parts.push(grid(cols, ROWS, (c, r) => P(A(c), Y(c, r), -1))); // inner face
    parts.push(grid(cols, 2, (c, r) => { const i = P(A(c), H, -1), o = P(A(c), H, 1); const m = i.clone().lerp(o, r / 2); if (r === 1) m.y += 0.12; return m; }, true)); // rounded top
    if (run.d) parts.push(grid(cols, 1, (c, r) => P(A(c), y0(c), r ? 1 : -1))); // arch soffit
    // Jambs at each end of a run.
    for (const [c, flip] of [[0, false], [cols, true]] as const) parts.push(grid(1, ROWS, (q, r) => P(A(c), Y(c, r), q ? 1 : -1), flip));
  }
  return mergeGeometries(parts);
}

/** A tube whose radius tapers from r0 to r1 along the curve. */
export function taperedTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 16, radial = 6): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, seg, 1, radial);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = Math.floor(i / (radial + 1)) / seg, c = curve.getPoint(Math.min(1, s)), r = r0 + (r1 - r0) * s;
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * r, c.y + (p.getY(i) - c.y) * r, c.z + (p.getZ(i) - c.z) * r);
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ interior kit

/**
 * A grown casket: the shell of a loot container, standing on its flared foot, a seam and lid across its shoulder.
 * Unit height, base radius about 0.45. Replaces plain crates as cover (give it a box collider of its size).
 */
export function casketGeometry(seed: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const r = 0.36 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.92 + 0.12) + 0.08 * Math.exp(-t * 10) + (Math.abs(t - 0.62) < 0.03 ? 0.03 : 0);
    pts.push(new THREE.Vector2(Math.max(0.02, r), t));
  }
  const body = roughen(new THREE.LatheGeometry(pts, 14), 0.6, seed);
  const seam = new THREE.TorusGeometry(0.33, 0.035, 5, 20).rotateX(Math.PI / 2).translate(0, 0.62, 0);
  return mergeGeometries([stripUv(body), stripUv(seam)]);
}

/** A sac hanging from its origin: a tendril, then a swollen membrane body with a dim core. */
export function sacMesh(length: number, r: number, seed: number): THREE.Group {
  const M = buildingMats();
  const g = new THREE.Group();
  const stalk = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05 * Math.sin(seed), -length * 0.35, 0.05), new THREE.Vector3(0, -(length - r * 1.6), 0)]);
  g.add(new THREE.Mesh(taperedTube(stalk, 0.06, 0.03, 10, 5), M.flesh));
  const body = roughen(new THREE.SphereGeometry(r, 14, 10).scale(1, 1.35, 1), 0.7, seed);
  const bm = new THREE.Mesh(body, M.flesh);
  bm.position.y = -length + r * 0.9;
  g.add(bm);
  return g;
}

/** One half of a doorway curtain, hinged at its origin, hanging into +X (dir 1) or -X (dir -1). */
export function curtainHalf(width: number, height: number, dir: 1 | -1, seed: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(width, height, 6, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + width / 2, y = p.getY(i) + height / 2;
    const ripple = Math.sin(x * 3 + seed) * 0.06 + Math.sin(y * 2.2 + seed * 2) * 0.04;
    p.setXYZ(i, x * dir, y + (x / width) * 0.25 * (1 - y / height), ripple);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, buildingMats().skin);
}

/** A bone urn (origin at its base). */
export function urnMesh(seed: number): THREE.Mesh {
  const pts = [[0.02, 0], [0.22, 0.02], [0.32, 0.25], [0.3, 0.55], [0.18, 0.78], [0.14, 0.86], [0.2, 0.92]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.Mesh(roughen(new THREE.LatheGeometry(pts, 12), 0.5, seed), buildingMats().bone);
}

/** A growth tank's grown collar (origin at its base); it stays standing when the bell above it bursts. */
export function tankCollar(seed: number): THREE.Mesh {
  return new THREE.Mesh(roughen(new THREE.CylinderGeometry(0.75, 0.9, 0.45, 16, 2), 0.5, seed).translate(0, 0.22, 0), buildingMats().shell);
}

/** A growth tank's bell (origin at its base): membrane glass, a lid and the curled thing inside. */
export function tankMesh(seed: number): THREE.Group {
  const M = buildingMats();
  const g = new THREE.Group();
  const lid = new THREE.Mesh(roughen(new THREE.CylinderGeometry(0.45, 0.75, 0.35, 16, 2), 0.5, seed + 1).translate(0, 2.47, 0), M.shell);
  // Three bone struts grown up the bell from collar to lid.
  const struts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + seed;
    const pt = (y: number, r: number) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    struts.push(taperedTube(new THREE.CatmullRomCurve3([pt(0.35, 0.8), pt(1.4, 0.76), pt(2.4, 0.7)]), 0.07, 0.05, 10, 5));
  }
  const strut = new THREE.Mesh(mergeGeometries(struts), M.bone);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.7, 2, 20, 1, true).translate(0, 1.4, 0), M.glass);
  const embryo = new THREE.Mesh(roughen(new THREE.SphereGeometry(0.34, 14, 10).scale(1, 1.4, 0.9), 0.8, seed), M.flesh);
  embryo.position.set(0.05, 1.35, 0);
  embryo.rotation.set(seed, seed * 2, 0.4);
  const cord = new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 2.3, 0), new THREE.Vector3(0.15, 1.9, 0.1), new THREE.Vector3(0.05, 1.6, 0)]), 0.05, 0.03, 8, 5), M.flesh);
  g.add(glass, embryo, cord, lid, strut);
  return g;
}

/** Remains: a host's curled skeleton, rib cage open, skull to one side (lying at y 0). */
export function remainsMesh(seed: number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const spine = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.8, 0.12, 0), new THREE.Vector3(-0.2, 0.18, 0.25), new THREE.Vector3(0.4, 0.14, 0.1), new THREE.Vector3(0.8, 0.1, -0.2)]);
  parts.push(taperedTube(spine, 0.07, 0.05, 16, 5));
  for (let i = 0; i < 6; i++) {
    const t = 0.25 + i * 0.09, c = spine.getPoint(t);
    for (const s of [-1, 1]) {
      const rib = new THREE.CatmullRomCurve3([c, c.clone().add(new THREE.Vector3(0.05, 0.25, s * 0.2)), c.clone().add(new THREE.Vector3(0.1, 0.05 + 0.05 * Math.sin(i + seed), s * 0.38))]);
      parts.push(taperedTube(rib, 0.03, 0.015, 8, 4));
    }
  }
  parts.push(roughen(new THREE.SphereGeometry(0.17, 10, 8).scale(1.2, 0.9, 1), 0.4, seed).translate(-1.0, 0.15, 0.15));
  return new THREE.Mesh(mergeGeometries(parts.map(stripUv)), buildingMats().bone);
}

/** A nest: a woven bowl of roots with eggs bedded in it (origin at its base). */
export function nestMesh(seed: number, r = 1.4): THREE.Group {
  const M = buildingMats();
  const g = new THREE.Group();
  const strands: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + seed;
    const curve = new THREE.CatmullRomCurve3([0, 1, 2, 3].map((k) => { const b = a + k * 0.7; return new THREE.Vector3(Math.cos(b) * r * (0.75 + 0.1 * k), 0.15 + 0.2 * Math.sin(k + i), Math.sin(b) * r * (0.75 + 0.1 * k)); }));
    strands.push(taperedTube(curve, 0.09, 0.05, 12, 5));
  }
  g.add(new THREE.Mesh(mergeGeometries(strands), M.flesh));
  for (let i = 0; i < 5; i++) {
    const a = i * 1.9 + seed, d = r * 0.35 * (i % 3) / 2;
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10).scale(1, 1.3, 1), M.skin);
    egg.position.set(Math.cos(a) * d, 0.3, Math.sin(a) * d);
    g.add(egg);
  }
  return g;
}

function stripUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const key of Object.keys(n.attributes)) if (key !== 'position' && key !== 'normal') n.deleteAttribute(key);
  return n;
}

// ------------------------------------------------------------------ dressing helpers

/** Places a grown casket as cover (collider of its size) at (u, v) in the Kit's frame. */
export function casket(k: Kit, u: number, v: number, s: number, seed: number, tag = 'casket'): void {
  const M = buildingMats();
  const [x, z] = k.at(u, v);
  const m = new THREE.Mesh(casketGeometry(seed), M.casket);
  m.scale.set(s * 2.2, s * 1.6, s * 2.2);
  m.position.set(u, -0.05, v);
  m.rotation.y = seed;
  m.userData.noOrganic = true;
  m.castShadow = true;
  k.group.add(m);
  k.solids.add({ cx: x, cz: z, hx: s * 0.8, hz: s * 0.8, yaw: k.yaw, y0: k.base - 0.5, y1: k.base + s * 1.55, tag });
}

/** A growth tank at (u, v): the collar stays, the bell (solid until then) bursts when shot. */
export function growthTank(k: Kit, life: LivingProps, u: number, v: number, seed: number): void {
  const collar = tankCollar(seed);
  collar.position.set(u, 0, v);
  collar.userData.noOrganic = true;
  k.group.add(collar);
  const [x, z] = k.at(u, v);
  const c = k.solids.add({ cx: x, cz: z, hx: 0.7, hz: 0.7, yaw: k.yaw, y0: k.base - 0.3, y1: k.base + 2.6, tag: 'growth-tank' });
  k.solids.add({ cx: x, cz: z, hx: 0.75, hz: 0.75, yaw: k.yaw, y0: k.base - 0.3, y1: k.base + 0.45, tag: 'tank-collar' });
  life.fragile(tankMesh(seed), worldAt(k, u, 0, v), 0.72, 2.6, c);
}

/** A warm light under a dome, so an interior reads without washing out. */
export function hallLight(k: Kit, u: number, v: number, y: number, intensity = 14, range = 14): THREE.PointLight {
  const l = new THREE.PointLight(ORGANIC.amber, intensity, range, 2);
  l.position.set(u, y, v);
  k.group.add(l);
  return l;
}

/** World position of (u, y, v) in the Kit's frame. */
export function worldAt(k: Kit, u: number, y: number, v: number): THREE.Vector3 {
  const [x, z] = k.at(u, v);
  return new THREE.Vector3(x, k.base + y, z);
}

/**
 * Dresses a hall with life: sacs from the dome, urns by the wall, a curtain in each doorway. Returns nothing; the
 * moving things go to `life`, the still ones into the Kit's group.
 */
export function dressHall(k: Kit, life: LivingProps, hall: Hall, o: HallOptions, seed: number, opts: { sacs?: number; urns?: number; curtains?: boolean } = {}): void {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s % 10000) / 10000; };
  for (let i = 0; i < (opts.sacs ?? 3); i++) {
    const a = rnd() * Math.PI * 2, d = 0.25 + rnd() * 0.45;
    const u = o.u + Math.cos(a) * o.ru * d, v = o.v + Math.sin(a) * o.rv * d;
    const top = hall.ceiling + (o.dome ?? Math.min(o.ru, o.rv) * 0.55) * (1 - d * d) * 0.8;
    const len = 1.2 + rnd() * Math.max(0.5, top - 3.2);
    life.sway(sacMesh(len, 0.3 + rnd() * 0.25, i + seed), worldAt(k, u, top, v), len, 0.45);
  }
  for (let i = 0; i < (opts.urns ?? 2); i++) {
    const a = rnd() * Math.PI * 2;
    if (hall.doors.some((dd) => Math.abs(Math.atan2(Math.sin(dd.yaw - a), Math.cos(dd.yaw - a))) < 0.5)) continue;
    const u = o.u + Math.cos(a) * (o.ru - 1.1), v = o.v + Math.sin(a) * (o.rv - 1.1);
    life.tip(urnMesh(i + seed), worldAt(k, u, 0, v), 0.32, 0.9);
  }
  if (opts.curtains !== false) {
    for (const d of hall.doors) {
      const w = (o.doorWidth ?? 2) * 0.95;
      // The curtain hangs across the doorway: along the wall's tangent, square to the outward direction.
      const tangentYaw = k.yaw - d.yaw + Math.PI / 2;
      life.flap(curtainHalf(w / 2, 2.6, 1, seed + d.yaw), curtainHalf(w / 2, 2.6, -1, seed - d.yaw), worldAt(k, d.u, 0.05, d.v), tangentYaw, w, 2.6);
    }
  }
}

export type { LootSpot };
