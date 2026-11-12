import * as THREE from 'three';
import { ORGANIC, ZONE7_SHADE } from '../render/palette';
import { bioNode, grownWall, zoneRock } from '../render/materials';
import { mulberry32 } from './rng';
import { roughen } from './organic';
import { Kit, oldBone, type LootSpot } from './structures';
import type { CollisionWorld } from './collision';

/**
 * Waypoint outposts for the open ground between big landmarks (World & Level). Left by the seedship's survey crews,
 * long overgrown: a reason to cross the plain, cover on the way and a few lockers worth the detour.
 *
 *  - camp: a walled two-room compound you walk into (doorways on three sides, the west room roofed), with a lookout
 *    platform up a ramp outside the east wall. A Settler Locker in the roofed room, a cargo crate on the lookout.
 *  - relay: a roofed shelter at the foot of a tall signal mast whose lamp is visible across the map, so players can
 *    steer by it. A Sealed Locker inside, a Bio-Pod by the door.
 *
 * Every wall, deck and ramp is a Kit box (collider plus grown mesh); the ground under each outpost must be level over
 * `OUTPOST_FOOTPRINT` (the zone flattens it).
 */

export type OutpostType = 'camp' | 'relay';
export interface OutpostSite { type: string; x: number; z: number; yaw: number }

/** Flat footprint each outpost needs: centre offset along local +X (m) and radius (m). */
export const OUTPOST_FOOTPRINT: Record<OutpostType, { u: number; r: number }> = { camp: { u: 5, r: 17 }, relay: { u: 0, r: 9 } };

/** Height of the lookout deck and of the camp walls (m). */
export const LOOKOUT_Y = 5;
const WALL_H = 3.2;

interface Mats { wall: THREE.Material; deck: THREE.Material; bone: THREE.Material; lamp: THREE.Material }
let shared: Mats | null = null;
function mats(): Mats {
  return shared ??= {
    wall: grownWall({ base: ZONE7_SHADE.stem, seam: ZONE7_SHADE.rockDeep, vein: ORGANIC.vein, plate: 1.8 }),
    deck: zoneRock({ veinColour: ORGANIC.vein, mossColour: ZONE7_SHADE.moss, scale: 1.4 }),
    bone: oldBone(ORGANIC.mist, 0.25),
    lamp: bioNode(ORGANIC.amber, 0.9),
  };
}

/** A wall along local X from u0 to u1 at v, with door gaps [from, to] cut out. */
function wallX(k: Kit, u0: number, u1: number, v: number, gaps: [number, number][], m: THREE.Material, h = WALL_H): void {
  let a = u0;
  for (const [g0, g1] of [...gaps, [u1, u1] as [number, number]]) {
    if (g0 - a > 0.4) k.box((a + g0) / 2, v, (g0 - a) / 2, 0.25, 0, h, m, { tag: 'outpost-wall' });
    a = g1;
  }
}
/** A wall along local Z from v0 to v1 at u. */
function wallZ(k: Kit, v0: number, v1: number, u: number, gaps: [number, number][], m: THREE.Material, h = WALL_H): void {
  let a = v0;
  for (const [g0, g1] of [...gaps, [v1, v1] as [number, number]]) {
    if (g0 - a > 0.4) k.box(u, (a + g0) / 2, 0.25, (g0 - a) / 2, 0, h, m, { tag: 'outpost-wall' });
    a = g1;
  }
}

function camp(k: Kit, id: string, rand: () => number, loot: LootSpot[]): void {
  const M = mats();
  const lootAt = (lid: string, u: number, y: number, v: number, container: string) => { const [x, z] = k.at(u, v); loot.push({ id: `${id}-${lid}`, x, y: k.base + y, z, container }); };
  // Floor and walls: 16 x 11 m, a partition with a doorway, doors north, south and east.
  k.box(0, 0, 8.2, 5.7, -0.6, 0.12, M.deck, { flatTop: true, organic: 0.5, tag: 'outpost-floor' });
  wallX(k, -8, 8, -5.5, [[-1.1, 1.1]], M.wall);
  wallX(k, -8, 8, 5.5, [[3, 5.2]], M.wall);
  wallZ(k, -5.25, 5.25, -7.75, [], M.wall);
  wallZ(k, -5.25, 5.25, 7.75, [[-1.1, 1.1]], M.wall);
  wallZ(k, -5.25, 5.25, 1, [[1.4, 3.4]], M.wall);
  // The west room is roofed (dark inside, a lamp in the corner), its roof sagging and broken at the east edge.
  k.box(-3.6, 0, 4.6, 5.8, WALL_H, WALL_H + 0.35, M.deck, { flatTop: false, organic: 0.8, tag: 'outpost-roof' });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), M.lamp);
  lamp.position.set(-7.2, 2.6, -4.8);
  const glow = new THREE.PointLight(ORGANIC.amber, 9, 12, 2);
  glow.position.set(-6.6, 2.4, -4.2);
  k.group.add(lamp, glow);
  lootAt('locker', -6.4, 0.12, 3.6, 'settlerLocker');
  // Lookout outside the east wall: a ramp up to a railed deck.
  k.box(13, 0, 4, 1.1, -0.2, LOOKOUT_Y, M.deck, { rise: LOOKOUT_Y + 0.2, tag: 'outpost-ramp' });
  k.box(18.6, 0, 1.6, 1.6, LOOKOUT_Y - 0.5, LOOKOUT_Y, M.deck, { flatTop: true, tag: 'outpost-lookout' });
  for (const [pu, pv] of [[17.3, -1.3], [19.9, -1.3], [17.3, 1.3], [19.9, 1.3]]) k.box(pu, pv, 0.18, 0.18, 0, LOOKOUT_Y - 0.5, M.bone, { tag: 'outpost-post' });
  for (const pv of [-1.5, 1.5]) k.box(18.6, pv, 1.6, 0.12, LOOKOUT_Y, LOOKOUT_Y + 1, M.bone, { tag: 'outpost-rail', organic: 0.4 });
  k.box(20.1, 0, 0.12, 1.4, LOOKOUT_Y, LOOKOUT_Y + 1, M.bone, { tag: 'outpost-rail', organic: 0.4 });
  lootAt('lookout', 18.9, LOOKOUT_Y, 0, 'cargoCrate');
  // Overgrowth: root ribs arching over the walls.
  for (let i = 0; i < 3; i++) {
    const u = -6 + i * 6 + rand() * 2, side = rand() < 0.5 ? -1 : 1;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(u, 0, side * 7.5), new THREE.Vector3(u + 0.6, WALL_H + 1.6, side * 5.2), new THREE.Vector3(u + 1.4, WALL_H + 0.4, side * 2.6)]);
    k.group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.28, 6), M.bone));
  }
}

function relay(k: Kit, id: string, rand: () => number, loot: LootSpot[]): void {
  const M = mats();
  const lootAt = (lid: string, u: number, y: number, v: number, container: string) => { const [x, z] = k.at(u, v); loot.push({ id: `${id}-${lid}`, x, y: k.base + y, z, container }); };
  // Shelter: 7 x 5 m, roofed, doorway facing +X.
  k.box(0, 0, 3.7, 2.7, -0.6, 0.12, M.deck, { flatTop: true, organic: 0.5, tag: 'outpost-floor' });
  wallZ(k, -2.25, 2.25, -3.25, [], M.wall, 2.8);
  wallZ(k, -2.25, 2.25, 3.25, [[-0.9, 0.9]], M.wall, 2.8);
  wallX(k, -3.5, 3.5, -2.5, [], M.wall, 2.8);
  wallX(k, -3.5, 3.5, 2.5, [], M.wall, 2.8);
  k.box(0, 0, 3.9, 2.9, 2.8, 3.1, M.deck, { flatTop: false, organic: 0.8, tag: 'outpost-roof' });
  lootAt('locker', -2.2, 0.12, -1.2, 'sealedLocker');
  lootAt('pod', 5, 0, 2.6, 'bioPod');
  const inside = new THREE.PointLight(ORGANIC.amber, 7, 9, 2);
  inside.position.set(-1.5, 2.2, 0);
  k.group.add(inside);
  // The mast: a grown, tapering spire behind the shelter, guyed with sinew, a lamp at the top.
  const H = 24 + rand() * 8;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(Math.max(0.12, 1.1 * (1 - t * 0.85) * (1 + 0.12 * Math.sin(t * 40))), t * H)); }
  const mast = new THREE.Mesh(roughen(new THREE.LatheGeometry(pts, 10), 0.8, 5), M.bone);
  mast.position.set(-5.5, -0.3, 0);
  k.group.add(mast);
  k.solids.add({ ...colliderAt(k, -5.5, 0), hx: 1, hz: 1, yaw: k.yaw, y0: k.base - 1, y1: k.base + H * 0.5, tag: 'relay-mast' });
  for (const a of [0.6, 2.7, 4.6]) {
    const top = new THREE.Vector3(-5.5, H * 0.7, 0), foot = new THREE.Vector3(-5.5 + Math.cos(a) * 9, -0.2, Math.sin(a) * 9);
    const mid = top.clone().lerp(foot, 0.5).add(new THREE.Vector3(0, -1.2, 0));
    k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([top, mid, foot]), 12, 0.06, 4), M.bone));
  }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), M.lamp);
  bulb.position.set(-5.5, H + 0.6, 0);
  const beacon = new THREE.PointLight(ORGANIC.amber, 40, 40, 2);
  beacon.position.copy(bulb.position);
  k.group.add(bulb, beacon);
}

function colliderAt(k: Kit, u: number, v: number): { cx: number; cz: number } {
  const [cx, cz] = k.at(u, v);
  return { cx, cz };
}

/** Builds one outpost on level ground at `base`. Returns its group and loot. */
export function buildOutpost(solids: CollisionWorld, site: OutpostSite, base: number, index: number): { group: THREE.Group; loot: LootSpot[] } {
  const k = new Kit(solids, site.x, site.z, (site.yaw * Math.PI) / 180, base);
  k.group.name = `outpost-${site.type}-${index}`;
  const loot: LootSpot[] = [];
  const rand = mulberry32(index * 97 + 13);
  if (site.type === 'relay') relay(k, k.group.name, rand, loot);
  else camp(k, k.group.name, rand, loot);
  return { group: k.group, loot };
}

/** World centre of an outpost's flat footprint. */
export function outpostFootprint(site: OutpostSite): { x: number; z: number; r: number } {
  const f = OUTPOST_FOOTPRINT[site.type === 'relay' ? 'relay' : 'camp'];
  const y = (site.yaw * Math.PI) / 180;
  return { x: site.x + f.u * Math.cos(y), z: site.z - f.u * Math.sin(y), r: f.r };
}
