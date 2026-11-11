import * as THREE from 'three';
import { HIVE, ORGANIC, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, bioTime, grownWall, liquidLight, membrane, zoneRock } from '../render/materials';
import { hazeVolume, lightShaft } from '../render/atmos';
import { zone7Sky, cloudSea, starField } from '../render/sky';
import { horizonLands } from '../render/horizon';
import { ZONE_SITES } from '../../data';
import { mulberry32 } from './rng';
import type { Collider } from './collision';
import { Kit, oldBone, type BuiltStructures, type LootSpot } from './structures';
import type { SiteDressing } from './sites';
import type { ExtractSite, Zone7Layout } from './layout';
import { SOLIDS, setTerrain } from './zone7';

/**
 * Zone 2, the Wreck of the Long Seed (World & Level): the crashed seedship as its own map. Design's brief
 * (data/zones.json longSeedWreck, docs/gdd/08-zones-and-bosses.md): an interior on three levels, breached prow,
 * two cargo holds with catwalks, crew warrens, the embryo gallery, the reactor chamber and the escape pod bay.
 *
 * Frame: the hull lies along X, prow east (+X), stern west. Deck 0 is the ground (y 0), catwalks and the upper
 * warren deck at `deck` (6 m), the hull roof at `height`. Room boundaries, loot spots and extracts come from
 * data/zone7.json `longSeedWreck`; Gameplay owns doors, power, lockers and escape pods (it calls sites.setExtractOpen).
 */

interface Room { id: string; x0: number; x1: number; z0: number; z1: number }
interface WreckData {
  hull: { halfLength: number; halfWidth: number; height: number; deck: number; thickness: number };
  spawn: { x: number; z: number };
  rooms: Room[];
  extracts: { id: string; label: string; x: number; z: number; opensAt: number | null }[];
  loot: { id: string; container: string; x: number; y: number; z: number }[];
  reactor: { x: number; z: number; coreRadius: number; ringRadius: number; valves: number };
}

export const WRECK = ZONE_SITES.longSeedWreck as unknown as WreckData;

export interface WreckWorld {
  layout: Zone7Layout;
  sites: SiteDressing;
  structures: BuiltStructures;
  /** Coolant valve positions on the reactor catwalk (Gameplay's power state: insert rods here). */
  valves: { id: string; x: number; y: number; z: number }[];
  landmarkAt(x: number, z: number): string | null;
}

/** The wreck's layout in the Raid's terms: spawn outside the prow, extracts, no island sites. */
export function wreckLayout(seed: number): Zone7Layout {
  const extracts: ExtractSite[] = WRECK.extracts.map((e) => ({ id: e.id, label: e.label, x: e.x, z: e.z, opensAt: e.opensAt ?? Infinity }));
  const { halfLength: L, halfWidth: W } = WRECK.hull;
  return {
    seed,
    spawn: { id: 'spawn', ...WRECK.spawn },
    extracts,
    dormantPads: [],
    pods: [],
    nests: [],
    nodes: [],
    // No anomaly aboard: a zero-strength site far outside the map keeps gravityAt() at 1 everywhere.
    anomaly: { id: 'none', kind: 'none', x: 1e5, z: 1e5, radius: 1, gravityMultiplier: 1 },
    area: { x0: -L + 4, x1: L - 4, z0: -W + 3, z1: W - 3 },
  };
}

/** Landmark (zones.json id) whose room contains (x, z); the pod bay wins over the reactor around it. */
export function wreckLandmarkAt(x: number, z: number): string | null {
  for (const r of WRECK.rooms) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.id;
  return null;
}

/** Builds the wreck into `scene` (SOLIDS reset; terrain set flat). */
export function buildWreck(scene: THREE.Scene, seed: number): WreckWorld {
  const rand = mulberry32(seed * 31 + 5);
  setTerrain(() => 0);
  SOLIDS.clear();
  const layout = wreckLayout(seed);
  const { halfLength: L, halfWidth: W, height: H, deck: D, thickness: T } = WRECK.hull;

  // ---- Outside: a sliver of the misty island seen through the breaches.
  const sky = zone7Sky();
  sky.userData.bake = true;
  scene.add(sky, cloudSea(-240), starField(rand), horizonLands({ seed: 23 }));
  scene.background = new THREE.Color(ZONE7.void);
  scene.fog = new THREE.FogExp2(ZONE7_SHADE.skyHorizon, 0.006);
  scene.add(new THREE.HemisphereLight(ORGANIC.mist, ORGANIC.wetFleshDeep, 0.55));
  const moon = new THREE.DirectionalLight(ORGANIC.mist, 0.6);
  moon.position.set(80, 120, 40);
  scene.add(moon);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 64).rotateX(-Math.PI / 2), zoneRock({ veinColour: ZONE7.violet, mossColour: ZONE7.cyan, scale: 1.2 }));
  ground.position.y = -0.02;
  ground.name = 'ground';
  scene.add(ground);

  const k = new Kit(SOLIDS, 0, 0, 0, 0);
  k.group.name = 'long-seed-wreck';
  const hull = grownWall({ base: ZONE7_SHADE.stem, seam: ZONE7_SHADE.rockDeep, vein: ZONE7.cyan, plate: 2.2 });
  const deckMat = grownWall({ base: ZONE7_SHADE.rockDeep, seam: '#000000', vein: ORGANIC.amber, plate: 1.4 });
  const bone = oldBone(ZONE7.cyan, 0.2);
  const crateMat = oldBone(ORGANIC.amber, 0.15);
  const strip = bioNode(ORGANIC.amber, 0.6);
  const tankGlass = membrane(HIVE.acid, 0.22);
  const embryo = bioNode(HIVE.acid, 0.8);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(L * 2, 0.1, W * 2), deckMat);
  floor.position.y = -0.04;
  k.group.add(floor);

  // ---- Hull shell: side walls with breaches up high, the stern wall, a roof torn open over the prow and the holds.
  for (const side of [-1, 1]) {
    // Low wall solid the full length; upper wall broken by breaches that let shafts of light in.
    k.box(0, side * (W + T / 2), L, T / 2, 0, 9, hull, { tag: `hull-${side}` });
    let x = -L;
    while (x < L - 2) {
      const len = 10 + rand() * 18, x1 = Math.min(L, x + len);
      k.box((x + x1) / 2, side * (W + T / 2), (x1 - x) / 2, T / 2, 9, H, hull, { tag: 'hull-upper' });
      x = x1 + 3 + rand() * 4;
    }
  }
  k.box(-L - T / 2, 0, T / 2, W + T, 0, H, hull, { tag: 'stern' });
  // Roof plates (no collision: nobody reaches them), missing over the prow and in a few breaches.
  let rx = -L;
  while (rx < L - 30) {
    const len = 12 + rand() * 22, x1 = Math.min(L - 30, rx + len);
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - rx, T, W * 2 + T * 2), hull);
    m.position.set((rx + x1) / 2, H + T / 2, 0);
    k.group.add(m);
    rx = x1 + 4 + rand() * 5;
  }
  // Hull ribs: bone frames arching over the interior every 7 m, the seedship's skeleton.
  for (let x = -L + 4; x < L - 4; x += 7) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(W, 0.35, 6, 24, Math.PI).rotateY(Math.PI / 2), bone);
    arch.position.set(x, H - W * 0.55, 0);
    arch.scale.y = 0.55;
    k.group.add(arch);
  }

  // ---- Bulkheads between rooms: a door on deck 0 in the middle; an upper door where the catwalks pass.
  const bulkhead = (x: number, upper: [number, number] | null, doorHalf = 2.2) => {
    k.box(x, -(W + doorHalf) / 2, T / 2, (W - doorHalf) / 2, 0, 4.2, hull, { tag: `bulkhead-${x}` });
    k.box(x, (W + doorHalf) / 2, T / 2, (W - doorHalf) / 2, 0, 4.2, hull, { tag: `bulkhead-${x}` });
    if (!upper) { k.box(x, 0, T / 2, W, 4.2, H, hull, { tag: `bulkhead-${x}` }); return; }
    const [z0, z1] = upper;
    // Above the deck door, leave a doorway at catwalk height between z0 and z1.
    k.box(x, (-W + z0) / 2, T / 2, (z0 + W) / 2, 4.2, H, hull, { tag: `bulkhead-${x}` });
    k.box(x, (z1 + W) / 2, T / 2, (W - z1) / 2, 4.2, H, hull, { tag: `bulkhead-${x}` });
    k.box(x, (z0 + z1) / 2, T / 2, (z1 - z0) / 2, 4.2, D, hull, { tag: `bulkhead-${x}` });
    k.box(x, (z0 + z1) / 2, T / 2, (z1 - z0) / 2, D + 3.4, H, hull, { tag: `bulkhead-${x}` });
  };
  const room = (id: string) => WRECK.rooms.find((r) => r.id === id)!;
  const north: [number, number] = [W - 6, W];
  bulkhead(room('cargoHoldA').x1, null, 3.5); // the prow breach opens into Hold A through a wide torn door
  bulkhead(room('cargoHoldB').x1, north);
  bulkhead(room('crewWarrens').x1, north);
  bulkhead(room('embryoGallery').x1, null);
  bulkhead(room('reactorChamber').x1, null, 3);

  // ---- Catwalks: along the north wall through both holds into the upper warren deck.
  const walk = (x0: number, x1: number, z0: number, z1: number, tag: string) =>
    k.box((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, D - 0.4, D, deckMat, { tag });
  const holdA = room('cargoHoldA'), holdB = room('cargoHoldB'), warrens = room('crewWarrens');
  walk(holdB.x0, holdA.x1, W - 6, W, 'catwalk-north');
  walk(holdB.x0 + 6, holdB.x1 - 6, -W, -W + 4, 'catwalk-south');
  walk(holdB.x0, holdB.x0 + 6, -W, W, 'catwalk-cross');
  // Ramps up from the hold floors (rise toward +x in local frame; yaw turns them).
  k.box(holdA.x0 + 12, W - 8, 8, 2, 0, D, deckMat, { rise: D, tag: 'ramp-holdA' });
  k.box(holdB.x1 - 14, -W + 6, 8, 2, 0, D, deckMat, { yaw: Math.PI, rise: D, tag: 'ramp-holdB' });
  // Railings (visual).
  for (const [x0, x1, z] of [[holdB.x0, holdA.x1, W - 6], [holdB.x0 + 6, holdB.x1 - 6, -W + 4]]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, x1 - x0, 5).rotateZ(Math.PI / 2), bone);
    rail.position.set((x0 + x1) / 2, D + 1, z);
    k.group.add(rail);
  }

  // ---- Cargo: crate stacks in both holds (cover and climbing routes); some hold loot.
  const crates: Collider[] = [];
  const crate = (x: number, z: number, s: number, y0 = 0) => {
    const c = k.box(x, z, s / 2, s / 2, y0, y0 + s * 0.9, crateMat, { yaw: (rand() - 0.5) * 0.4, tag: 'crate' });
    crates.push(c.collider);
    return y0 + s * 0.9;
  };
  for (const r of [holdA, holdB]) {
    for (let i = 0; i < 9; i++) {
      // Stacks stand in two bands either side of the central aisle, clear of the wall ramps and catwalks.
      const x = r.x0 + 5 + rand() * (r.x1 - r.x0 - 10), z = (rand() < 0.5 ? -1 : 1) * (3.5 + rand() * (W - 15));
      if (WRECK.loot.some((l) => Math.hypot(l.x - x, l.z - z) < 3)) continue; // leave loot spots clear
      const top = crate(x, z, 1.6 + rand() * 1.2);
      if (rand() < 0.5) crate(x + (rand() - 0.5) * 0.4, z + (rand() - 0.5) * 0.4, 1.2 + rand() * 0.6, top);
    }
  }

  // ---- Crew warrens: an upper deck over cramped cabins, a central corridor on each level, stairs at the stern end.
  k.box((warrens.x0 + warrens.x1) / 2, 0, (warrens.x1 - warrens.x0) / 2, W, D - 0.4, D, deckMat, { tag: 'warrens-deck' });
  for (const level of [0, D]) {
    for (let x = warrens.x0 + 5; x < warrens.x1 - 3; x += 6) {
      for (const side of [-1, 1]) {
        // Cabin partition walls perpendicular to the corridor (corridor |z| < 2).
        k.box(x, side * (W + 2.5) / 2, 0.15, (W - 2.5) / 2, level, level + (level ? H - D : D - 0.4), hull, { tag: 'cabin' });
        // Cabin front walls with a doorway.
        k.box(x + 1.6, side * 2.5, 1.4, 0.15, level, level + 3, hull, { tag: 'cabin-front' });
      }
    }
  }

  // ---- Embryo gallery: two rows of glass tanks with embryos curled inside; the green light of the room.
  const gallery = room('embryoGallery');
  const tankGeo = new THREE.CylinderGeometry(1.1, 1.1, 3.4, 18, 1, true);
  const embryoGeo = new THREE.SphereGeometry(0.55, 14, 10);
  for (let x = gallery.x0 + 4; x < gallery.x1 - 2; x += 4.5) {
    for (const side of [-1, 1]) {
      const z = side * 8;
      k.box(x, z, 1.15, 1.15, 0, 0.5, deckMat, { tag: 'tank-base' });
      k.solids.add({ cx: x, cz: z, hx: 1.1, hz: 1.1, yaw: 0, y0: 0, y1: 3.9, tag: 'tank' });
      const glass = new THREE.Mesh(tankGeo, tankGlass);
      glass.position.set(x, 2.2, z);
      const e = new THREE.Mesh(embryoGeo, embryo);
      e.position.set(x, 2 + rand() * 0.6, z);
      e.scale.set(1, 1.3, 0.8);
      e.rotation.set(rand(), rand() * 6, rand());
      k.group.add(glass, e);
    }
  }
  const galleryLight = new THREE.PointLight(HIVE.acid, 30, 24, 2);
  galleryLight.position.set((gallery.x0 + gallery.x1) / 2, 6, 0);
  k.group.add(galleryLight);

  // ---- Reactor chamber: the cold core, a catwalk ring at deck height with four coolant valves, ramps up.
  const re = WRECK.reactor;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(re.coreRadius, re.coreRadius * 1.2, H - 1, 28, 6, true), oldBone(ZONE7.cyan, 0.35));
  core.position.set(re.x, (H - 1) / 2, re.z);
  k.group.add(core);
  k.solids.add({ cx: re.x, cz: re.z, hx: re.coreRadius, hz: re.coreRadius, yaw: 0, y0: 0, y1: H, tag: 'reactor-core' });
  const coreGlow = new THREE.Mesh(new THREE.CylinderGeometry(re.coreRadius * 0.7, re.coreRadius * 0.7, H - 2, 20, 1, true), liquidLight({ a: ZONE7_SHADE.rockDeep, b: ZONE7_SHADE.moss, c: ZONE7.cyan, flow: 0.15 }));
  coreGlow.position.copy(core.position);
  k.group.add(coreGlow);
  const segs = 16;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const u = re.x + Math.cos(a) * re.ringRadius, v = re.z + Math.sin(a) * re.ringRadius;
    k.box(u, v, 1.4, (Math.PI * re.ringRadius) / segs + 0.2, D - 0.4, D, deckMat, { yaw: -a, tag: 'reactor-ring' });
  }
  // Two bridges from the ring to the side walls; a ramp up the north wall from the gallery door meets a landing
  // that runs back to the north bridge, so the doorway itself stays clear.
  k.box(re.x, re.z + (re.ringRadius + W) / 2, 1.3, (W - re.ringRadius) / 2, D - 0.4, D, deckMat, { tag: 'reactor-bridge' });
  k.box(re.x, re.z - (re.ringRadius + W) / 2, 1.3, (W - re.ringRadius) / 2, D - 0.4, D, deckMat, { tag: 'reactor-bridge' });
  const rampTop = re.x + 9, rampZ = re.z + 13;
  k.box(rampTop + 6, rampZ, 6, 1.6, 0, D, deckMat, { yaw: Math.PI, rise: D, tag: 'reactor-ramp' });
  k.box((re.x + 1.3 + rampTop) / 2, rampZ, (rampTop - re.x - 1.3) / 2 + 0.1, 1.6, D - 0.4, D, deckMat, { tag: 'reactor-landing' });
  const valves = Array.from({ length: re.valves }, (_, i) => {
    const a = Math.PI / 4 + (i / re.valves) * Math.PI * 2;
    const x = re.x + Math.cos(a) * (re.ringRadius - 0.6), z = re.z + Math.sin(a) * (re.ringRadius - 0.6);
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.4, 10), oldBone(ORGANIC.amber, 0.4));
    v.position.set(x, D + 0.7, z);
    k.group.add(v);
    return { id: `coolant-valve-${i}`, x, y: D, z };
  });

  // ---- Escape pod bay: pods in their cradles along the south wall of the reactor room.
  const bay = room('escapePodBay');
  for (let x = bay.x0 + 3; x < bay.x1 - 2; x += 5) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 2.2, 6, 14), oldBone(ZONE7.cyan, 0.25));
    pod.position.set(x, 1.8, bay.z0 + 2.4);
    pod.rotation.x = 0.25;
    k.group.add(pod);
    k.solids.add({ cx: x, cz: bay.z0 + 2.4, hx: 1.2, hz: 1.2, yaw: 0, y0: 0, y1: 3.6, tag: 'escape-pod' });
  }

  // ---- Prow: torn open to the sky, the hull plates splayed outward, roots creeping in from the island.
  const prow = room('breachedProw');
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const petal = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 6), hull);
      petal.position.set(prow.x1 - 3 + i * 1.5, 4 + i * 2.6, side * (W - 2 + i * 1.2));
      petal.rotation.set(side * (0.5 + i * 0.15), 0, -0.3 - i * 0.12);
      k.group.add(petal);
    }
  }
  for (let i = 0; i < 6; i++) {
    const pts = [new THREE.Vector3(prow.x1 + 8 + rand() * 10, -0.5, (rand() - 0.5) * 30)];
    for (let j = 1; j < 5; j++) pts.push(new THREE.Vector3(pts[0].x - j * (5 + rand() * 4), j < 4 ? 0.2 + rand() * 2.5 : 4 + rand() * 6, pts[0].z + (rand() - 0.5) * 6 * j));
    k.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.25 + rand() * 0.2, 6), oldBone(ZONE7.cyan, 0.1)));
  }

  // ---- Failing emergency strips along both walls at knee height, broken into flickering runs.
  for (const side of [-1, 1]) {
    let x = -L + 2;
    while (x < prow.x0) {
      const len = 3 + rand() * 8;
      const s = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.06), strip);
      s.position.set(x + len / 2, 0.6, side * (W - 0.05));
      k.group.add(s);
      x += len + 1 + rand() * 6;
    }
  }
  // A few warm work lights still burning (holds, warrens) and the reactor's cold glow; few lights, wide falloff.
  for (const [x, y, z, colour, power, range] of [
    [(holdA.x0 + holdA.x1) / 2, D + 5, -6, ORGANIC.amber, 60, 34],
    [(holdB.x0 + holdB.x1) / 2, D + 5, 6, ORGANIC.amber, 50, 30],
    [(warrens.x0 + warrens.x1) / 2, 3.2, 0, ORGANIC.amber, 22, 18],
    [re.x, H - 3, re.z, ZONE7.cyan, 50, 30],
  ] as [number, number, number, string, number, number][]) {
    const l = new THREE.PointLight(colour, power, range, 2);
    l.position.set(x, y, z);
    k.group.add(l);
    // The fitting itself: a dim amber bulb in a bone cage.
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), bioNode(colour, 0.4));
    bulb.position.set(x, y, z);
    k.group.add(bulb);
  }

  // ---- Atmosphere: light shafts through the hull breaches, haze in each room.
  for (let x = -L + 10; x < prow.x0; x += 16 + rand() * 10) {
    const side = rand() < 0.5 ? -1 : 1;
    k.group.add(lightShaft({ from: new THREE.Vector3(x, H - 1, side * (W - 1)), to: new THREE.Vector3(x - 3, 0, side * (W - 12)), width: 2.6, colour: ORGANIC.mist, strength: 0.09 }));
  }
  for (const r of WRECK.rooms.filter((q) => q.id !== 'escapePodBay')) {
    const h = r.id === 'breachedProw' ? 8 : H;
    k.group.add(hazeVolume({ centre: new THREE.Vector3((r.x0 + r.x1) / 2, h / 2, 0), size: new THREE.Vector3(r.x1 - r.x0, h, W * 2), colour: r.id === 'embryoGallery' ? ZONE7_SHADE.moss : ZONE7_SHADE.skyHorizon, density: 0.02 }));
  }
  const pulse = () => { strip.emissiveIntensity = 0.6 + 0.4 * Math.sin(bioTime.value * 7.3) * Math.sin(bioTime.value * 2.1); };
  core.onBeforeRender = pulse;
  scene.add(k.group);

  // ---- Extract markers: a ring on the floor at each extract (Gameplay's Seed Spire prop stands on it).
  const group = new THREE.Group();
  group.name = 'wreck-sites';
  const rings = new Map<string, THREE.Mesh>();
  for (const e of layout.extracts) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.08, 6, 48).rotateX(-Math.PI / 2), bioNode(e.opensAt > 0 ? ZONE7.violet : ZONE7.lime, 3));
    ring.position.set(e.x, 0.06, e.z);
    ring.visible = e.opensAt <= 0;
    rings.set(e.id, ring);
    group.add(ring);
  }
  scene.add(group);

  const loot: LootSpot[] = WRECK.loot.map((l) => ({ ...l }));
  return {
    layout,
    sites: { group, setExtractOpen(id, open) { const r = rings.get(id); if (r) r.visible = open; }, setNodeHarvested() { /* no harvest nodes aboard */ } },
    structures: { group: k.group, loot, arena: null, breakPillar() { /* the reactor has no pillars */ } },
    valves,
    landmarkAt: wreckLandmarkAt,
  };
}
