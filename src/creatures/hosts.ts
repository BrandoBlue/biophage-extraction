import * as THREE from 'three';
import type { ClassId } from '../../data';
import { HIVE, ORGANIC, ZONE7, ZONE7_SHADE } from '../render/palette';
import { alienEye, bioNode, chitin, livingFlesh, membrane } from '../render/materials';
import { blade, horn, merge, plate, rng, roughen, spike, taperTube, vent, wing } from './parts';
import { meshSdf, type SdfPrim } from './sdf';
import { mutation } from '../render/dissolve';

/**
 * Playable host bodies for the Hive menu, host select and results screens (Art Bible creature rule 1,
 * reference 02):
 *   neuroInfiltrator  slim biped, bulbous cranium, glowing antennae, long clawed arms
 *   venomWraith       gaunt and tall, blade forearms, four insect wings
 *   goreBehemoth      hunched mass of raw red flesh, ivory bone crown, plates and spikes
 * `createHostBody(classId)` returns a HostBody: `root` stands with its feet at y = 0, faces +Z and is
 * about 2 m tall (the Behemoth is broader, not taller). Call `update(dt)` for the idle: breathing,
 * antenna and wing sway, eye glow.
 *
 * `createHostBody(classId, evolution)` grows the class's first evolution (Host milestone, data/progression.json):
 *   acidParasite     Wraith: a translucent acid bladder for an abdomen, wing stubs, corroded hooks for blades
 *   neuroHound       Infiltrator: down on four legs, a long eyeless snout ringed with sweeping antennae, nerve
 *                    nodes along the spine, the Burster grafted along the right forelimb
 *   crustaceanGrunt  Behemoth: segmented crab plate over the muscle, a crushing claw for a right hand, barnacle
 *                    crusts on the shoulders, eye stalks rising from the bone crown
 * Any other evolution id (the Apex ones, still to come) falls back to the class body.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));

/** Joint layout for one side (x > 0); mirrored for the other. Metres, feet at y = 0, facing +Z. */
interface Frame {
  hips: [number, number, number]; waist: [number, number, number]; chest: [number, number, number]; neck: [number, number, number]; head: [number, number, number];
  shoulder: [number, number, number]; elbow: [number, number, number]; wrist: [number, number, number];
  hip: [number, number, number]; knee: [number, number, number]; hock: [number, number, number]; foot: [number, number, number];
  /** Radii: pelvis, waist, chest (x, y, z), upper arm, forearm, thigh, shin. */
  r: { pelvis: number; waist: number; chest: [number, number, number]; arm: number; fore: number; thigh: number; shin: number };
  cranium: [number, number, number];
}

interface Build {
  frame: Frame;
  skin: { base: string; vein: string; rim: string };
  bone: string;
  glow: string;
}

const BUILDS: Record<ClassId, Build> = {
  // Reference 02, centre: gaunt, wasp-waisted, big swept-back cranium, long thin clawed arms, bent legs.
  neuroInfiltrator: {
    frame: {
      hips: [0, 0.98, -0.02], waist: [0, 1.16, 0.0], chest: [0, 1.4, 0.06], neck: [0, 1.62, 0.12], head: [0, 1.78, 0.2],
      shoulder: [0.17, 1.52, 0.06], elbow: [0.29, 1.2, 0.0], wrist: [0.3, 0.88, 0.16],
      hip: [0.09, 0.98, -0.02], knee: [0.15, 0.6, 0.16], hock: [0.14, 0.26, -0.1], foot: [0.15, 0.03, 0.02],
      r: { pelvis: 0.14, waist: 0.075, chest: [0.17, 0.19, 0.13], arm: 0.04, fore: 0.032, thigh: 0.065, shin: 0.04 },
      cranium: [0.15, 0.15, 0.22],
    },
    // Grey, sutured chitin-skin; the only colour is a cold glint in the eyes.
    skin: { base: mix(mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.55), ORGANIC.mist, 0.15), vein: ORGANIC.vein, rim: ORGANIC.mist }, bone: mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.25), glow: mix(ZONE7.cyan, ORGANIC.mist, 0.65),
  },
  // Reference 02, left: taller and thinner still, small head, blade forearms, wings.
  venomWraith: {
    frame: {
      hips: [0, 1.04, -0.02], waist: [0, 1.22, 0.0], chest: [0, 1.46, 0.07], neck: [0, 1.68, 0.14], head: [0, 1.82, 0.2],
      shoulder: [0.15, 1.58, 0.06], elbow: [0.27, 1.28, -0.04], wrist: [0.27, 1.05, 0.2],
      hip: [0.08, 1.04, -0.02], knee: [0.14, 0.64, 0.18], hock: [0.13, 0.28, -0.12], foot: [0.14, 0.03, 0.0],
      r: { pelvis: 0.12, waist: 0.06, chest: [0.15, 0.18, 0.12], arm: 0.034, fore: 0.028, thigh: 0.055, shin: 0.034 },
      cranium: [0.11, 0.12, 0.2],
    },
    // Bruise-dark wasp hide; venom glands are the only light on it.
    skin: { base: mix(mix(ORGANIC.wetFleshDeep, ZONE7_SHADE.rockDeep, 0.35), HIVE.bone, 0.18), vein: mix(HIVE.acid, ORGANIC.vein, 0.75), rim: ORGANIC.mist }, bone: mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.4), glow: mix(HIVE.acid, ORGANIC.amber, 0.6),
  },
  // Reference 02, right: hunched mass, head slung low between huge shoulders, long heavy arms.
  goreBehemoth: {
    frame: {
      hips: [0, 0.92, -0.1], waist: [0, 1.1, 0.0], chest: [0, 1.38, 0.14], neck: [0, 1.52, 0.34], head: [0, 1.47, 0.47],
      shoulder: [0.4, 1.58, 0.1], elbow: [0.56, 1.13, 0.2], wrist: [0.55, 0.68, 0.36],
      hip: [0.19, 0.92, -0.1], knee: [0.27, 0.56, 0.14], hock: [0.25, 0.24, -0.08], foot: [0.27, 0.04, 0.06],
      r: { pelvis: 0.26, waist: 0.21, chest: [0.37, 0.3, 0.26], arm: 0.13, fore: 0.12, thigh: 0.16, shin: 0.11 },
      cranium: [0.11, 0.1, 0.13],
    },
    // Raw dark muscle, not a red balloon: the bone does the talking.
    skin: { base: mix(ORGANIC.wetFleshDeep, HIVE.danger, 0.18), vein: ORGANIC.amber, rim: HIVE.bone }, bone: mix(HIVE.bone, ZONE7_SHADE.rockDeep, 0.25), glow: ORGANIC.amber,
  },
};

/** Host-milestone evolutions that have their own body, and the class each grows from. */
export const HOST_EVOLUTIONS = { acidParasite: 'venomWraith', neuroHound: 'neuroInfiltrator', crustaceanGrunt: 'goreBehemoth' } as const satisfies Record<string, ClassId>;
export type HostEvolution = keyof typeof HOST_EVOLUTIONS;

/**
 * The Neuro-Hound on all fours, in the same Frame terms: the "arms" are forelimbs planted ahead of the chest, the
 * "legs" are hind legs with a dog's backward hock, and the head is slung forward at shoulder height.
 */
const HOUND_FRAME: Frame = {
  hips: [0, 0.86, -0.46], waist: [0, 0.86, -0.16], chest: [0, 0.9, 0.16], neck: [0, 0.98, 0.42], head: [0, 1.0, 0.6],
  shoulder: [0.14, 0.94, 0.22], elbow: [0.17, 0.52, 0.1], wrist: [0.16, 0.1, 0.3],
  hip: [0.1, 0.86, -0.48], knee: [0.15, 0.56, -0.28], hock: [0.13, 0.24, -0.6], foot: [0.13, 0.03, -0.5],
  r: { pelvis: 0.13, waist: 0.075, chest: [0.16, 0.15, 0.22], arm: 0.042, fore: 0.034, thigh: 0.07, shin: 0.038 },
  cranium: [0.1, 0.09, 0.15],
};

const T = (a: [number, number, number], sx = 1) => V(a[0] * sx, a[1], a[2]);

/**
 * A plate's rotation: its convex side along `normal`, its lifted trailing edge (local +Z) pointing along `trail`
 * (down the body, down the limb), so rows of plates overlap like scales.
 */
function scaleBasis(normal: THREE.Vector3, trail: THREE.Vector3 = V(0, -1, 0)): THREE.Quaternion {
  const y = normal.clone().normalize();
  let z = trail.clone().addScaledVector(y, -trail.dot(y));
  if (z.lengthSq() < 1e-6) z = V(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Flesh an evolution adds to the meshed body (the hound's snout, the grunt's swollen claw arm). */
function evolutionPrims(evo: HostEvolution | null, f: Frame): SdfPrim[] {
  const hd = T(f.head);
  if (evo === 'neuroHound') {
    return [
      // The cranium drawn out into a long snout, tapering to the star of antennae.
      { shape: 'cone', a: hd.clone().add(V(0, 0.03, 0.02)), b: hd.clone().add(V(0, -0.03, 0.38)), ra: 0.085, rb: 0.035, blend: 0.05, bone: 0, ribs: { freq: 60, depth: 0.004 } },
      // A deep, narrow chest keel like a greyhound's.
      { shape: 'ellipsoid', a: T(f.chest).add(V(0, -0.1, 0.02)), radii: V(0.11, 0.14, 0.17), blend: 0.07, bone: 0 },
      // Lean haunches.
      ...[-1, 1].map((s): SdfPrim => ({ shape: 'ellipsoid', a: T(f.hip, s).add(V(0, -0.06, 0.04)), radii: V(0.07, 0.14, 0.11), blend: 0.06, bone: 0 })),
    ];
  }
  if (evo === 'crustaceanGrunt') {
    const el = T(f.elbow), wr = T(f.wrist);
    return [{ shape: 'ellipsoid', a: el.clone().lerp(wr, 0.55), radii: V(0.18, 0.25, 0.18), blend: 0.08, bone: 0 }];
  }
  return [];
}

/** Bilateral SDF body from a Frame. */
function bodyPrims(f: Frame): SdfPrim[] {
  const r = f.r, hump = r.chest[0] > 0.3;
  const prims: SdfPrim[] = [
    { shape: 'ellipsoid', a: T(f.hips), radii: V(r.pelvis, r.pelvis * 0.75, r.pelvis * 0.8), bone: 0 },
    { shape: 'cone', a: T(f.hips), b: T(f.waist), ra: r.waist * 1.1, rb: r.waist, blend: 0.05, bone: 0, ribs: { freq: 30, depth: 0.006 } },
    { shape: 'cone', a: T(f.waist), b: T(f.chest), ra: r.waist, rb: r.chest[0] * 0.7, blend: 0.06, bone: 0 },
    { shape: 'ellipsoid', a: T(f.chest), radii: V(...r.chest), blend: 0.06, bone: 0, ...(hump ? {} : { ribs: { freq: 16, depth: 0.012 } }) },
    { shape: 'cone', a: T(f.chest).add(V(0, r.chest[1] * 0.6, 0)), b: T(f.neck), ra: r.chest[0] * 0.35, rb: r.arm * 1.2, blend: 0.05, bone: 0 },
    { shape: 'cone', a: T(f.neck), b: T(f.head), ra: r.arm * 1.1, rb: r.arm, blend: 0.04, bone: 0 },
    // Cranium: bulbous, swept up and back from the face.
    { shape: 'ellipsoid', a: T(f.head).add(V(0, 0.07, -0.05)), radii: V(...f.cranium), blend: 0.04, bone: 0 },
    { shape: 'ellipsoid', a: T(f.head).add(V(0, 0.12, -0.17)), radii: V(f.cranium[0] * 0.9, f.cranium[1] * 0.85, f.cranium[2] * 0.75), blend: 0.05, bone: 0 },
    { shape: 'ellipsoid', a: T(f.head).add(V(0, -0.04, 0.06)), radii: V(f.cranium[0] * 0.42, f.cranium[1] * 0.35, f.cranium[2] * 0.4), blend: 0.04, bone: 0, tint: new THREE.Color(0.65, 0.65, 0.65) },
  ];
  if (hump) {
    // Heavy build: a hunched trapezius yoke, pectorals, lats, a jaw and fists, so the mass reads as muscle.
    const ch = T(f.chest), hd = T(f.head);
    prims.push({ shape: 'ellipsoid', a: ch.clone().add(V(0, 0.2, -0.1)), radii: V(r.chest[0] * 0.75, r.chest[1] * 0.55, r.chest[2] * 0.7), blend: 0.1, bone: 0 });
    for (const s of [-1, 1]) {
      const sh = T(f.shoulder, s), wr = T(f.wrist, s);
      prims.push(
        { shape: 'cone', a: T(f.neck).add(V(s * 0.06, -0.02, -0.08)), b: sh.clone().add(V(-s * 0.06, 0.06, -0.04)), ra: 0.13, rb: 0.15, blend: 0.08, bone: 0 },
        { shape: 'ellipsoid', a: ch.clone().add(V(s * 0.17, 0.04, r.chest[2] * 0.62)), radii: V(0.17, 0.12, 0.09), blend: 0.05, bone: 0 },
        { shape: 'ellipsoid', a: ch.clone().add(V(s * 0.27, -0.14, -0.06)), radii: V(0.11, 0.2, 0.15), blend: 0.06, bone: 0 },
        { shape: 'ellipsoid', a: wr.clone().add(V(0, -0.1, 0.04)), radii: V(r.fore * 1.0, r.fore * 0.95, r.fore * 1.15), blend: 0.04, bone: 0 },
      );
    }
    prims.push({ shape: 'ellipsoid', a: hd.clone().add(V(0, -0.08, 0.05)), radii: V(0.12, 0.065, 0.11), blend: 0.04, bone: 0, tint: new THREE.Color(0.7, 0.62, 0.62) });
  }
  for (const s of [-1, 1]) {
    const sh = T(f.shoulder, s), el = T(f.elbow, s), wr = T(f.wrist, s), hip = T(f.hip, s), kn = T(f.knee, s), hock = T(f.hock, s), ft = T(f.foot, s);
    prims.push(
      { shape: 'ellipsoid', a: sh, radii: V(r.arm * 1.7, r.arm * 1.5, r.arm * 1.5), blend: 0.05, bone: 0 },
      { shape: 'cone', a: sh, b: el, ra: r.arm, rb: r.arm * 0.7, blend: 0.03, bone: 0 },
      { shape: 'ellipsoid', a: sh.clone().lerp(el, 0.4), radii: V(r.arm * 1.15, r.arm * 2.4, r.arm * 1.15), blend: 0.03, bone: 0 },
      { shape: 'cone', a: el, b: wr, ra: r.fore, rb: r.fore * 0.7, blend: 0.02, bone: 0 },
      { shape: 'ellipsoid', a: el.clone().lerp(wr, 0.3), radii: V(r.fore * 1.2, r.fore * 2.6, r.fore * 1.2), blend: 0.02, bone: 0 },
      { shape: 'ellipsoid', a: wr.clone().add(V(0, -0.04, 0.03)), radii: V(r.fore * 0.9, r.fore * 1.6, r.fore * 1.2), blend: 0.02, bone: 0 },
      { shape: 'cone', a: hip, b: kn, ra: r.thigh, rb: r.thigh * 0.62, blend: 0.05, bone: 0 },
      { shape: 'ellipsoid', a: hip.clone().lerp(kn, 0.4), radii: V(r.thigh * 1.15, r.thigh * 2.4, r.thigh * 1.15), blend: 0.04, bone: 0 },
      { shape: 'cone', a: kn, b: hock, ra: r.shin, rb: r.shin * 0.7, blend: 0.02, bone: 0 },
      { shape: 'cone', a: hock, b: ft, ra: r.shin * 0.7, rb: r.shin * 0.6, blend: 0.02, bone: 0 },
      { shape: 'ellipsoid', a: V(ft.x, r.shin * 0.7, ft.z + 0.07), radii: V(r.shin * 1.1, r.shin * 0.7, r.shin * 2.6), blend: 0.03, bone: 0 },
    );
  }
  return prims;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

export class HostBody {
  readonly root = new THREE.Group();
  private sway: { obj: THREE.Object3D; base: THREE.Euler; amp: number; rate: number; phase: number }[] = [];
  private chest: THREE.Mesh;
  private glows: THREE.MeshStandardMaterial[] = [];
  /** Things that sweep about their own Z (the hound's antenna star) and slosh (the parasite's acid). */
  private sweeps: { obj: THREE.Object3D; amp: number; rate: number }[] = [];
  private slosh: { obj: THREE.Object3D; base: THREE.Vector3 } | null = null;
  private time = 0;
  /** The evolution this body has grown into, or null for the class body. */
  readonly evolution: HostEvolution | null;

  constructor(readonly classId: ClassId, evolution?: string | null) {
    const evo = evolution && evolution in HOST_EVOLUTIONS && HOST_EVOLUTIONS[evolution as HostEvolution] === classId ? (evolution as HostEvolution) : null;
    this.evolution = evo;
    const hound = evo === 'neuroHound', parasite = evo === 'acidParasite', grunt = evo === 'crustaceanGrunt';
    const b = BUILDS[classId], f = hound ? HOUND_FRAME : b.frame;
    const rand = rng(classId.length * 17);
    this.root.name = evo ? `host:${classId}:${evo}` : `host:${classId}`;
    const key = `${classId}:${evo ?? ''}`;
    let geo = geoCache.get(key);
    if (!geo) {
      geo = meshSdf([...bodyPrims(f), ...evolutionPrims(evo, f)], 1, { resolution: 112, noise: { amp: 0.005, freq: 32, seed: 5 } }).geometry;
      geoCache.set(key, geo);
    }
    // Restrained glow (Brandon, 2026-11-11: heavy neon reads as AI-made): faint veins, a soft rim.
    const skin = livingFlesh(b.skin.base, hex(new THREE.Color(b.skin.vein).multiplyScalar(0.18)), hex(new THREE.Color(b.skin.rim).multiplyScalar(0.35)), 6);
    skin.vertexColors = true;
    skin.clearcoat = 0.45;
    skin.sheen = 0.1;
    this.chest = new THREE.Mesh(geo, skin);
    this.chest.name = 'body';
    this.root.add(this.chest);
    const bone = chitin(b.bone, hex(new THREE.Color(b.glow).multiplyScalar(0.4)), 8);
    const node = bioNode(b.glow, 1.6);
    this.glows.push(node);
    const head = T(f.head), big = f.r.chest[0] > 0.3;

    // Eyes: large glossy almonds on the Infiltrator, narrow slits on the others.
    const eyeMat = alienEye(hex(new THREE.Color(b.glow).multiplyScalar(0.6)), mix(HIVE.background, HIVE.panel, 0.6));
    if (big) for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.018 - i * 0.004, 14, 10), eyeMat);
      e.scale.set(1.3, 0.6, 0.8);
      e.position.copy(head).add(V(s * (0.05 + i * 0.035), 0.03 + i * 0.025, f.cranium[2] * 0.82 - i * 0.03));
      e.rotation.set(0, Math.PI + s * 0.5, 0);
      this.root.add(e);
    }
    if (!big && !hound) for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 14), eyeMat);
      e.scale.set(1.35, classId === 'neuroInfiltrator' ? 0.85 : 0.4, 0.75);
      e.position.copy(head).add(V(0.062 * s, 0.03, f.cranium[2] * 0.42));
      e.rotation.set(-0.1, Math.PI + s * 0.45, s * 0.3);
      this.root.add(e);
    }

    // Claws: three long hooked fingers per hand.
    const claws: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const wr = T(f.wrist, s);
      const len = big ? 0.26 : 0.16;
      if (grunt && s === 1) continue; // the crushing claw replaces this hand
      for (let i = 0; i < 3; i++) {
        // On all fours the claws dig forward into the ground instead of hanging.
        if (hound) { claws.push(spike(0.09, f.r.fore * 0.3, 0.6).rotateX(Math.PI * 0.5).rotateY(s * (i - 1) * 0.3).translate(wr.x + s * (i - 1) * f.r.fore * 0.6, wr.y - 0.05, wr.z + 0.04)); continue; }
        claws.push(spike(len, f.r.fore * (big ? 0.38 : 0.32), 0.45).rotateX(Math.PI * 0.85).rotateZ(s * (i - 1) * 0.28).translate(wr.x + s * (i - 1) * f.r.fore * 0.6, wr.y - 0.05, wr.z + 0.02));
      }
    }
    this.root.add(new THREE.Mesh(merge(claws), bone));

    // A few soft nodes: sternum and spine (accents, not a light show).
    const nodes: THREE.BufferGeometry[] = [];
    const ch = T(f.chest);
    if (!hound) for (let i = 0; i < 3; i++) nodes.push(new THREE.SphereGeometry(0.012, 10, 8).translate(ch.x, ch.y - 0.06 + i * 0.06, ch.z + f.r.chest[2] * 0.95));
    this.root.add(new THREE.Mesh(merge(nodes), node));

    // Spine ridge of small bone plates down the back.
    const spine: THREE.BufferGeometry[] = [];
    for (let i = 0; i < (big || hound ? 0 : 7); i++) {
      const p = T(f.hips).lerp(T(f.neck), i / 6);
      spine.push(spike(big ? 0.12 : 0.05, big ? 0.04 : 0.014, 0.3).rotateX(-1.1).translate(p.x, p.y, p.z - (i < 4 ? f.r.waist + 0.01 : f.r.chest[2] * 0.9)));
    }
    if (spine.length) this.root.add(new THREE.Mesh(merge(spine), bone));

    if (hound) this.growHound(f, bone, node);
    if (!hound && (classId === 'neuroInfiltrator' || classId === 'venomWraith')) {
      // Antennae rising from the crown.
      const n = classId === 'neuroInfiltrator' ? 2 : 1;
      for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
        const g = new THREE.Group();
        g.position.copy(head).add(V(0.05 * s, f.cranium[1] + 0.06, -0.02 - i * 0.09));
        const len = classId === 'neuroInfiltrator' ? 0.4 - i * 0.12 : 0.28;
        const pts = [V(0, -0.03, 0), V(s * 0.04, len * 0.4, -0.02), V(s * 0.14, len * 0.75, -0.06), V(s * 0.25, len, -0.02)];
        g.add(new THREE.Mesh(taperTube(pts, [0.016, 0.011, 0.008, 0.005], 6, 5), bone));
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), node);
        tip.position.copy(pts[3]);
        g.add(tip);
        this.root.add(g);
        this.sway.push({ obj: g, base: g.rotation.clone(), amp: 0.06, rate: 1.1 + i * 0.4, phase: s + i });
      }
    }
    if (classId === 'venomWraith') {
      // A segmented wasp abdomen curling down behind the hips to a venom stinger, and mandibles.
      const hp = T(f.hips);
      // The Acid Parasite's abdomen is longer and swollen into a bladder.
      const pts = parasite
        ? [hp.clone().add(V(0, 0.02, -0.08)), hp.clone().add(V(0, -0.06, -0.36)), hp.clone().add(V(0, -0.3, -0.56)), hp.clone().add(V(0, -0.6, -0.52)), hp.clone().add(V(0, -0.8, -0.32))]
        : [hp.clone().add(V(0, 0.02, -0.08)), hp.clone().add(V(0, -0.06, -0.3)), hp.clone().add(V(0, -0.24, -0.44)), hp.clone().add(V(0, -0.46, -0.42)), hp.clone().add(V(0, -0.6, -0.3))];
      const radii = parasite ? [0.06, 0.17, 0.19, 0.15, 0.05] : [0.05, 0.11, 0.1, 0.07, 0.03];
      const flipped = (g: THREE.BufferGeometry) => {
        // This curl's Frenet frame comes out mirrored, so the tube's normals point inward: flip them.
        const nrm = g.attributes.normal;
        for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
        return g;
      };
      const tube = flipped(taperTube(pts, radii, parasite ? 16 : 10, 6));
      const abd: THREE.BufferGeometry[] = parasite ? [] : [tube];
      if (parasite) this.growBladder(tube, flipped(taperTube(pts, radii.map((r, i) => r * (i === 0 ? 0.4 : 0.8)), 14, 6)));
      for (let i = 1; i < 6; i++) {
        // Segment rims along the abdomen.
        const c = new THREE.CatmullRomCurve3(pts), t = i / 6.5, p = c.getPointAt(t), d = c.getTangentAt(t);
        const fi = t * 4, k = Math.min(3, Math.floor(fi)), r = (radii[k] + (radii[k + 1] - radii[k]) * (fi - k)) * 1.02;
        abd.push(new THREE.TorusGeometry(r, 0.008, 5, 18).applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d), V(1, 1, 1))));
      }
      const tip = new THREE.CatmullRomCurve3(pts).getTangentAt(1);
      abd.push(spike(0.16, 0.026, 0.15).applyMatrix4(new THREE.Matrix4().compose(pts[4], new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), tip), V(1, 1, 1))));
      for (const s of [-1, 1]) abd.push(spike(0.07, 0.012, 0.8).rotateX(Math.PI * 0.6).rotateZ(-s * 0.4).translate(head.x + s * 0.03, head.y - 0.07, head.z + f.cranium[2] * 0.55));
      this.root.add(new THREE.Mesh(merge(abd), bone));
      // Blade forearms and four insect wings (the parasite's blades corrode into hooks, its wings into stubs).
      const corroded = parasite ? chitin(mix(mix(b.bone, ORGANIC.wetFleshDeep, 0.35), HIVE.acid, 0.1), hex(new THREE.Color(HIVE.acid).multiplyScalar(0.12)), 9) : bone;
      if (parasite) corroded.roughness = 0.75;
      for (const s of [-1, 1]) {
        const el = T(f.elbow, s);
        if (parasite) {
          // A pitted hook curling forward and down from the forearm.
          const hook = new THREE.Mesh(roughen(horn(0.5, 0.045, 1.7, rand), 0.008, 70, 3 + s), corroded);
          hook.position.copy(el).add(V(0, -0.02, 0));
          hook.rotation.set(Math.PI * 0.95, s < 0 ? Math.PI : 0, s * 0.1);
          this.root.add(hook);
        } else {
          const bl = new THREE.Mesh(blade(0.72, 0.1, 0.014), bone);
          bl.position.copy(el);
          bl.rotation.set(Math.PI * 0.95, s * 0.15, s * 0.05);
          this.root.add(bl);
        }
        for (let i = 0; i < 2; i++) {
          const lace = parasite ? membrane(hex(new THREE.Color(mix(ORGANIC.amber, HIVE.acid, 0.3)).multiplyScalar(0.55)), 0.5) : membrane(mix(HIVE.bone, ORGANIC.mist, 0.35), 0.4);
          const w = new THREE.Mesh(wing(parasite ? 0.3 - i * 0.08 : 1.05 - i * 0.25, parasite ? 0.16 : 0.32, rand, 1 + i), lace);
          const g = new THREE.Group();
          g.position.copy(T(f.chest, s)).add(V(0.06 * s, 0.1 - i * 0.12, -f.r.chest[2] * 0.8));
          w.rotation.set(0, s < 0 ? Math.PI : 0, 0);
          g.rotation.set(-0.35 + i * 0.4, s * 0.55, s * (0.5 + i * 0.3));
          g.add(w);
          this.root.add(g);
          this.sway.push({ obj: g, base: g.rotation.clone(), amp: 0.05, rate: 0.9, phase: i * 1.7 });
        }
      }
    }
    if (classId === 'goreBehemoth') {
      // Reference 02, right: ivory bone breaking through raw muscle. Thick horns, not hairline spikes.
      const bones: THREE.BufferGeometry[] = [];
      const up = V(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4();
      const at = (g: THREE.BufferGeometry, p: THREE.Vector3, dir: THREE.Vector3) => {
        q.setFromUnitVectors(up, dir.clone().normalize());
        bones.push(g.applyMatrix4(m.compose(p, q, V(1, 1, 1))));
      };
      // A low crown of five swept horns on the slung head.
      for (let i = 0; i < 5; i++) {
        const a = (i / 4 - 0.5) * 2.0;
        at(horn(0.28 + (i % 2 ? 0 : 0.1) + (i === 2 ? 0.08 : 0), 0.045, 0.5, rand), head.clone().add(V(Math.sin(a) * 0.08, 0.07, -0.02 + Math.cos(a) * 0.02)), V(Math.sin(a) * 0.8, 1, -0.8));
      }
      // Mandible tusks curving forward and down from the jaw corners.
      for (const s of [-1, 1]) at(spike(0.16, 0.025, 0.6), head.clone().add(V(s * 0.08, -0.1, 0.1)), V(s * 0.3, -0.5, 1));
      for (const s of [-1, 1]) {
        const sh = T(f.shoulder, s), el = T(f.elbow, s), wr = T(f.wrist, s);
        // Three thick shoulder horns, an elbow spur, knuckle studs.
        for (let i = 0; i < 3; i++) at(horn(0.42 + i * 0.1, 0.075 - i * 0.01, 0.4, rand).rotateY(s < 0 ? Math.PI : 0), sh.clone().add(V(s * (0.02 - i * 0.06), 0.16 + i * 0.03, -0.04 - i * 0.08)), V(s * (0.6 - i * 0.15), 1, -0.4 - i * 0.2));
        at(spike(0.24, 0.05, 0.3), el.clone().add(V(s * 0.05, 0.02, -0.12)), V(s * 0.3, 0.2, -1));
        for (let i = 0; i < 3; i++) at(spike(0.07, 0.025, 0.1), wr.clone().add(V(s * (i - 1) * 0.06, -0.12, 0.17)), V(0, -0.2, 1));
        // Ribs breaking through the flank.
        for (let i = 0; i < 3; i++) {
          const y = T(f.chest).y - 0.08 - i * 0.09, x = s * (f.r.chest[0] * 0.9 - i * 0.015), z = T(f.chest).z;
          bones.push(taperTube([V(x * 0.85, y + 0.02, z - 0.2), V(x * 1.04, y, z - 0.03), V(x * 0.98, y - 0.02, z + 0.12), V(x * 0.7, y - 0.03, z + 0.22)], [0.022, 0.024, 0.02, 0.012], 6, 3));
        }
      }
      // Bone knobs along the hump.
      for (let i = 0; i < 5; i++) {
        const p = T(f.waist).lerp(T(f.neck), i / 4).add(V(0, 0.12 + Math.sin((i / 4) * Math.PI) * 0.12, -0.27 - Math.sin((i / 4) * Math.PI) * 0.08));
        at(horn(0.16 + (i % 2) * 0.06, 0.05, 0.3, rand), p, V(0, 1, -1.2));
      }
      // Ivory armour plates: pauldrons, forearm guards and the hump (reference 02's bone shell).
      const plateAt = (p: THREE.Vector3, normal: THREE.Vector3, w: number, l: number, h: number, trail?: THREE.Vector3) => {
        bones.push(plate(w, l, h, rand, 0.5).applyMatrix4(m.compose(p, scaleBasis(normal, trail), V(1, 1, 1))));
      };
      for (const s of [-1, 1]) {
        const sh = T(f.shoulder, s), el = T(f.elbow, s), wr = T(f.wrist, s);
        plateAt(sh.clone().add(V(s * 0.05, 0.14, -0.02)), V(s * 0.5, 1, -0.1), 0.2, 0.22, 0.09);
        plateAt(sh.clone().add(V(s * 0.15, 0.0, 0)), V(s, 0.35, 0), 0.15, 0.18, 0.07);
        plateAt(el.clone().lerp(wr, 0.45).add(V(s * 0.1, 0, -0.03)), V(s, 0.1, -0.3), 0.11, 0.2, 0.06);
        plateAt(wr.clone().add(V(0, -0.04, 0.12)), V(0, 0.4, 1), 0.12, 0.1, 0.05);
      }
      const ch = T(f.chest);
      for (let i = 0; i < 3; i++) plateAt(ch.clone().add(V(0, 0.27 - i * 0.16, -0.31 - i * 0.02)), V(0, 0.8 - i * 0.3, -1), 0.26 - i * 0.03, 0.17, 0.08);
      this.root.add(new THREE.Mesh(roughen(merge(bones), 0.006, 30, 4), chitin(b.bone, hex(new THREE.Color(ORGANIC.amber).multiplyScalar(0.08)), 6)));
      if (grunt) this.growCarapace(f, rand, eyeMat);
    }
    this.root.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    // Stand exactly on y = 0 whatever the frame's feet do.
    this.root.updateMatrixWorld(true);
    const floor = new THREE.Box3().setFromObject(this.root).min.y;
    for (const c of this.root.children) c.position.y -= floor;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const breath = Math.sin(t * 1.6);
    this.chest.scale.set(1 + breath * 0.006, 1 + breath * 0.003, 1 + breath * 0.01);
    for (const s of this.sway) {
      s.obj.rotation.set(s.base.x + Math.sin(t * s.rate + s.phase) * s.amp, s.base.y, s.base.z + Math.sin(t * s.rate * 0.7 + s.phase) * s.amp * 0.6);
    }
    for (const g of this.glows) g.emissiveIntensity = 0.45 + Math.pow(Math.max(0, Math.sin(t * 2.2)), 4) * 0.35;
    for (const s of this.sweeps) s.obj.rotation.z = Math.sin(t * s.rate) * s.amp;
    if (this.slosh) {
      // The acid lags the body: it rocks and settles against the bladder wall.
      const o = this.slosh.obj, k = Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.9) * 0.4;
      o.position.set(this.slosh.base.x + k * 0.012, this.slosh.base.y + Math.abs(k) * 0.006, this.slosh.base.z + Math.sin(t * 1.7) * 0.01);
      o.scale.set(1 - Math.abs(k) * 0.03, 1 + k * 0.02, 1);
    }
  }

  /** Neuro-Hound: the star of antennae on the snout, a nerve-node ridge down the spine, the Burster along the forelimb. */
  private growHound(f: Frame, bone: THREE.Material, node: THREE.Material): void {
    const hd = T(f.head);
    // Star-nosed ring: twelve fleshy feelers fanned around the snout tip, the whole star sweeping side to side.
    const star = new THREE.Group();
    star.position.copy(hd).add(V(0, -0.03, 0.39));
    const feelers: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, out = V(Math.cos(a), Math.sin(a), 0), len = 0.07 + (i % 2) * 0.04;
      const pts = [out.clone().multiplyScalar(0.025), out.clone().multiplyScalar(0.05).add(V(0, 0, len * 0.5)), out.clone().multiplyScalar(0.06 + len * 0.6).add(V(0, 0, len))];
      feelers.push(taperTube(pts, [0.009, 0.006, 0.002], 5, 3));
    }
    star.add(new THREE.Mesh(merge(feelers), this.chest.material as THREE.Material));
    this.root.add(star);
    this.sweeps.push({ obj: star, amp: 0.35, rate: 1.4 });
    // Two long swept-back antennae from the crown, like the Infiltrator's, laid flat along the skull.
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.copy(hd).add(V(0.04 * s, f.cranium[1] + 0.03, -0.02));
      const pts = [V(0, 0, 0), V(s * 0.05, 0.08, -0.12), V(s * 0.12, 0.1, -0.3), V(s * 0.2, 0.06, -0.48)];
      g.add(new THREE.Mesh(taperTube(pts, [0.012, 0.009, 0.006, 0.003], 6, 5), bone));
      this.root.add(g);
      this.sway.push({ obj: g, base: g.rotation.clone(), amp: 0.08, rate: 1.6, phase: s });
    }
    // Nerve nodes along the top of the spine, with small bone hooks between them.
    const nodes: THREE.BufferGeometry[] = [], hooks: THREE.BufferGeometry[] = [];
    const back = T(f.hips).add(V(0, 0.02, -0.06)), front = T(f.neck);
    for (let i = 0; i < 9; i++) {
      const t = i / 8, p = back.clone().lerp(front, t), top = THREE.MathUtils.lerp(f.r.pelvis * 0.75, f.r.chest[1], Math.sin(t * Math.PI * 0.6)) + 0.01;
      nodes.push(new THREE.SphereGeometry(0.018 + Math.sin(t * Math.PI) * 0.008, 10, 8).scale(1, 0.7, 1.3).translate(p.x, p.y + top, p.z));
      if (i < 8) hooks.push(spike(0.06, 0.012, 0.5).rotateX(-0.9).translate(p.x, p.y + top - 0.005, p.z + 0.04));
    }
    this.root.add(new THREE.Mesh(merge(nodes), node), new THREE.Mesh(merge(hooks), bone));
    // The Burster grafted along the right forelimb: a bone barrel fused to the forearm, a sac of shot behind it.
    const el = T(f.elbow), wr = T(f.wrist), side = V(0.045, 0, 0);
    const barrel = taperTube([el.clone().add(side).add(V(0, 0.02, -0.04)), el.clone().lerp(wr, 0.5).add(side).add(V(0, 0, 0.05)), wr.clone().add(side).add(V(0, 0.12, 0.12))], [0.03, 0.034, 0.028], 9, 4);
    const sac = new THREE.SphereGeometry(0.045, 12, 10).scale(1, 1.4, 1).translate(el.x + 0.06, el.y - 0.05, el.z);
    this.root.add(new THREE.Mesh(merge([barrel, sac]), bone));
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 6, 14), node);
    muzzle.position.copy(wr).add(side).add(V(0, 0.12, 0.12));
    muzzle.lookAt(muzzle.position.clone().add(wr.clone().sub(el).normalize().add(V(0, 0.4, 0.6))));
    this.root.add(muzzle);
  }

  /** Acid Parasite: a translucent bladder wall with a dark acid swilling inside it. */
  private growBladder(wall: THREE.BufferGeometry, fluid: THREE.BufferGeometry): void {
    const skin = new THREE.MeshPhysicalMaterial({
      color: mix(HIVE.bone, ORGANIC.wetFlesh, 0.55), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12,
      transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    });
    const acid = new THREE.MeshStandardMaterial({
      // Murky bile-green, not a glowstick: a faint inner light only.
      color: mix(mix(HIVE.acid, ORGANIC.amber, 0.35), ORGANIC.wetFleshDeep, 0.72), roughness: 0.3,
      emissive: hex(new THREE.Color(mix(HIVE.acid, ORGANIC.amber, 0.5)).multiplyScalar(0.08)), side: THREE.DoubleSide,
    });
    // Fill only the lower part of the bladder: the acid pools in the curl.
    fluid.computeBoundingBox();
    const bb = fluid.boundingBox!, cut = bb.min.y + (bb.max.y - bb.min.y) * 0.62, pos = fluid.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > cut) pos.setY(i, cut);
    fluid.computeVertexNormals();
    const inner = new THREE.Mesh(fluid, acid);
    inner.name = 'acid';
    inner.renderOrder = -1;
    this.root.add(inner, new THREE.Mesh(wall, skin));
    this.slosh = { obj: inner, base: inner.position.clone() };
  }

  /** Crustacean Grunt: carapace bands, the crushing claw, barnacle crusts and eye stalks. */
  private growCarapace(f: Frame, rand: () => number, eyeMat: THREE.Material): void {
    const shell: THREE.BufferGeometry[] = [], up = V(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4();
    // Seat each plate on the meshed skin: cast in from outside along its normal and sit just proud of the hit.
    const ray = new THREE.Raycaster();
    const onSkin = (p: THREE.Vector3, n: THREE.Vector3, lift: number) => {
      const dir = n.clone().normalize();
      ray.set(p.clone().addScaledVector(dir, 0.8), dir.clone().negate());
      const hit = ray.intersectObject(this.chest, false)[0];
      return hit ? hit.point.addScaledVector(dir, lift) : p;
    };
    const plateAt = (p: THREE.Vector3, normal: THREE.Vector3, w: number, l: number, h: number, trail?: THREE.Vector3) => {
      shell.push(plate(w, l, h, rand, 0.2).applyMatrix4(m.compose(onSkin(p, normal, h * 0.25), scaleBasis(normal, trail), V(1, 1, 1))));
    };
    const ch = T(f.chest), ws = T(f.waist), hp = T(f.hips);
    // Overlapping belly segments, chest to hips, each tucked under the one above like a lobster's tail.
    for (let i = 0; i < 6; i++) {
      const t = i / 5, p = ch.clone().lerp(hp, t).add(V(0, 0.14 - t * 0.05, 0));
      plateAt(p, V(0, 0.45 - t * 0.3, 1), 0.3 - t * 0.08, 0.16, 0.06);
    }
    // Back and flank segments under the bone hump plates.
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) plateAt(ch.clone().lerp(ws, i / 3).add(V(s * 0.12, 0.05, 0)), V(s * 1, 0.25, -0.2), 0.16, 0.12, 0.055);
    plateAt(hp.clone().add(V(0, 0.02, f.r.pelvis * 0.75)), V(0, 0.1, 1), 0.2, 0.12, 0.05);
    for (const s of [-1, 1]) {
      const sh = T(f.shoulder, s), el = T(f.elbow, s), wr = T(f.wrist, s), hip = T(f.hip, s), kn = T(f.knee, s), hock = T(f.hock, s);
      // Ringed bands down the upper arm, the left forearm, thighs and shins.
      for (let i = 0; i < 3; i++) plateAt(sh.clone().lerp(el, 0.25 + i * 0.25).add(V(s * f.r.arm * 0.95, 0, 0)), V(s, 0.25, 0.1), 0.12, 0.11, 0.045, el.clone().sub(sh));
      if (s < 0) for (let i = 0; i < 3; i++) plateAt(el.clone().lerp(wr, 0.15 + i * 0.25).add(V(s * f.r.fore * 0.9, 0, -0.02)), V(s, 0.1, -0.2), 0.11, 0.1, 0.04, wr.clone().sub(el));
      for (let i = 0; i < 2; i++) plateAt(hip.clone().lerp(kn, 0.3 + i * 0.35).add(V(s * 0.03, 0, f.r.thigh * 0.95)), V(s * 0.3, 0.1, 1), 0.13, 0.12, 0.045, kn.clone().sub(hip));
      plateAt(kn.clone().lerp(hock, 0.4).add(V(0, 0, f.r.shin * 0.9)), V(0, 0.2, 1), 0.09, 0.12, 0.04);
    }
    // The crushing claw on the right: a heavy fixed jaw and a hinged dactyl, toothed on their inner edges.
    const el = T(f.elbow), wr = T(f.wrist), base = wr.clone().add(V(0, -0.04, 0.06));
    const jaw = (dir: number) => {
      const pts = [base.clone(), base.clone().add(V(0.02, dir * 0.1, 0.18)), base.clone().add(V(0.02, dir * 0.1, 0.38)), base.clone().add(V(0, dir * 0.01, 0.52))];
      shell.push(roughen(taperTube(pts, dir < 0 ? [0.16, 0.14, 0.09, 0.02] : [0.12, 0.1, 0.065, 0.015], 12, 5), 0.008, 30, 2 + dir));
      for (let i = 0; i < 4; i++) {
        const p = new THREE.CatmullRomCurve3(pts).getPointAt(0.3 + i * 0.15), r = (dir < 0 ? 0.13 : 0.09) * (1 - i * 0.2);
        shell.push(spike(0.05, 0.018, 0.2).applyMatrix4(m.compose(p.add(V(0, -dir * r * 0.8, 0)), q.setFromUnitVectors(up, V(0, -dir, 0.15).normalize()), V(1, 1, 1))));
      }
    };
    jaw(-1); jaw(1);
    // Pale worn tips on the jaws.
    for (const dir of [-1, 1]) shell.push(spike(0.12, 0.03, 0.5).applyMatrix4(m.compose(base.clone().add(V(0, dir * 0.02, 0.44)), q.setFromUnitVectors(up, V(0, -dir * 0.6, 1).normalize()), V(1, 1, 1))));
    plateAt(el.clone().lerp(wr, 0.55).add(V(0.16, 0.02, 0)), V(1, 0.2, 0), 0.2, 0.24, 0.07);
    plateAt(el.clone().lerp(wr, 0.55).add(V(0, 0.02, 0.17)), V(0, 0.1, 1), 0.18, 0.22, 0.07);
    // Grey-brown crab shell, so it reads as armour against the red muscle.
    const crab = chitin(mix(mix(ZONE7_SHADE.rock, ORGANIC.wetFleshDeep, 0.35), HIVE.bone, 0.15), hex(new THREE.Color(ORGANIC.amber).multiplyScalar(0.05)), 7);
    crab.roughness = 0.5;
    crab.clearcoat = 0.5;
    this.root.add(new THREE.Mesh(merge(shell), crab));
    // Barnacle crusts: clusters of open bone cones on the shoulders.
    const barn: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const sh = T(f.shoulder, s);
      for (let i = 0; i < 9; i++) {
        const a = rand() * Math.PI * 2, d = rand() * 0.14, r = 0.018 + rand() * 0.02;
        const p = sh.clone().add(V(s * (0.06 + Math.cos(a) * d * 0.6), 0.12 + rand() * 0.04, -0.06 + Math.sin(a) * d));
        const n = V(s * (0.4 + rand() * 0.5), 1, (rand() - 0.5) * 0.8);
        barn.push(vent(r, r * (1.2 + rand())).applyMatrix4(m.compose(onSkin(p, n, -r * 0.3), q.setFromUnitVectors(up, n.normalize()), V(1, 1, 1))));
      }
    }
    const crust = chitin(mix(HIVE.bone, ZONE7_SHADE.rock, 0.45), hex(new THREE.Color(ORGANIC.amber).multiplyScalar(0.03)), 14);
    crust.roughness = 0.85;
    crust.clearcoat = 0.1;
    this.root.add(new THREE.Mesh(roughen(merge(barn), 0.002, 120, 6), crust));
    // Three eye stalks rising out of the bone crown, each swaying on its own.
    const hd = T(f.head);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group(), a = (i - 1) * 0.55, len = 0.22 + (i === 1 ? 0.08 : 0);
      g.position.copy(hd).add(V(Math.sin(a) * 0.07, 0.1, 0.02));
      const pts = [V(0, 0, 0), V(Math.sin(a) * 0.04, len * 0.5, 0.03), V(Math.sin(a) * 0.08, len, 0.06)];
      g.add(new THREE.Mesh(taperTube(pts, [0.016, 0.011, 0.009], 6, 4), this.chest.material as THREE.Material));
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10), eyeMat);
      eye.position.copy(pts[2]).add(V(0, 0.012, 0.01));
      eye.rotation.set(-0.3, Math.PI, 0);
      g.add(eye);
      this.root.add(g);
      this.sway.push({ obj: g, base: g.rotation.clone(), amp: 0.12, rate: 0.8 + i * 0.35, phase: i * 2.1 });
    }
  }
}

/** The host body for a class (Hive menu, host select, results), grown into `evolution` when it has its own body. */
export function createHostBody(classId: ClassId, evolution?: string | null): HostBody {
  return new HostBody(classId, evolution);
}

/**
 * The evolution scene (Hive, after the player evolves): the host shudders and swells as the change takes hold,
 * then its body burns away bottom-up along a glowing front while the evolved body knits in right behind it.
 * Add `root` to the scene where the host stands, call `evolve(id)`, and `update(dt)` every frame (the render
 * pipeline advances the dissolve itself). `done` fires once the new body stands alone.
 */
export class EvolutionStage {
  /** Seconds of shudder before the burn starts, and of the burn-and-regrow. */
  static readonly SHUDDER = 0.9;
  static readonly GROW = 3.2;
  readonly root = new THREE.Group();
  body: HostBody;
  private leaving: HostBody | null = null;
  private shudder = -1;
  private onDone: (() => void) | undefined;
  /** 'idle', 'shudder' (old body trembling), 'growing' (dissolve-swap running). */
  phase: 'idle' | 'shudder' | 'growing' = 'idle';

  /** `prepare` runs on each new body before it is shown (the viewer's software-rendering simplifier). */
  constructor(readonly classId: ClassId, evolution?: string | null, private prepare?: (root: THREE.Object3D) => void) {
    this.body = createHostBody(classId, evolution);
    this.prepare?.(this.body.root);
    this.root.add(this.body.root);
  }

  evolve(evolution: string, done?: () => void): void {
    if (this.phase !== 'idle') return;
    this.leaving = this.body;
    this.body = createHostBody(this.classId, evolution);
    this.prepare?.(this.body.root);
    this.body.root.visible = false;
    this.root.add(this.body.root);
    this.onDone = done;
    this.shudder = 0;
    this.phase = 'shudder';
  }

  update(dt: number): void {
    this.body.update(dt);
    const old = this.leaving;
    if (!old) return;
    old.update(dt);
    if (this.phase === 'shudder') {
      this.shudder += dt;
      const k = Math.min(1, this.shudder / EvolutionStage.SHUDDER), t = this.shudder;
      // Convulsions that build: a hard tremor, and the body swelling against itself.
      old.root.position.set(Math.sin(t * 71) * 0.012 * k, 0, Math.sin(t * 53 + 1) * 0.012 * k);
      old.root.rotation.set(Math.sin(t * 37) * 0.03 * k, Math.sin(t * 23) * 0.05 * k, Math.sin(t * 41) * 0.03 * k);
      old.root.scale.setScalar(1 + k * k * 0.05 + Math.sin(t * 19) * 0.01 * k);
      if (k >= 1) {
        this.phase = 'growing';
        this.body.root.visible = true;
        this.root.updateMatrixWorld(true);
        mutation.swap(old.root, this.body.root, {
          duration: EvolutionStage.GROW,
          // A dim ember front, not a neon line: the dissolve shader multiplies its colour up at the edge.
          colour: hex(new THREE.Color(ORGANIC.amber).lerp(new THREE.Color(ORGANIC.wetFleshDeep), 0.3).multiplyScalar(0.28)),
          done: () => {
            old.root.removeFromParent();
            this.leaving = null;
            this.phase = 'idle';
            this.onDone?.();
          },
        });
      }
    }
  }
}
