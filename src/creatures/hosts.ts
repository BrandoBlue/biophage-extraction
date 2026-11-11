import * as THREE from 'three';
import type { ClassId } from '../../data';
import { HIVE, ORGANIC, PATH, ZONE7, ZONE7_SHADE } from '../render/palette';
import { alienEye, bioNode, chitin, livingFlesh, membrane } from '../render/materials';
import { blade, horn, merge, plate, rng, roughen, spike, taperTube, wing } from './parts';
import { meshSdf, type SdfPrim } from './sdf';

/**
 * Playable host bodies for the Hive menu, host select and results screens (Art Bible creature rule 1,
 * reference 02):
 *   neuroInfiltrator  slim biped, bulbous cranium, glowing antennae, long clawed arms
 *   venomWraith       gaunt and tall, blade forearms, four insect wings
 *   goreBehemoth      hunched mass of raw red flesh, ivory bone crown, plates and spikes
 * `createHostBody(classId)` returns a HostBody: `root` stands with its feet at y = 0, faces +Z and is
 * about 2 m tall (the Behemoth is broader, not taller). Call `update(dt)` for the idle: breathing,
 * antenna and wing sway, eye glow.
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
    skin: { base: mix(HIVE.panel, HIVE.bone, 0.3), vein: mix(HIVE.acid, ZONE7.cyan, 0.5), rim: ZONE7.cyan }, bone: mix(HIVE.bone, HIVE.panel, 0.2), glow: ZONE7.cyan,
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
    skin: { base: mix(mix(HIVE.panel, ZONE7_SHADE.rockDeep, 0.35), HIVE.bone, 0.3), vein: HIVE.acid, rim: mix(HIVE.bone, HIVE.acid, 0.25) }, bone: mix(HIVE.bone, HIVE.panel, 0.35), glow: HIVE.acid,
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
    skin: { base: mix(ORGANIC.wetFleshDeep, HIVE.danger, 0.18), vein: ORGANIC.amber, rim: HIVE.bone }, bone: mix(HIVE.bone, ZONE7_SHADE.rockDeep, 0.25), glow: PATH.melee,
  },
};

const T = (a: [number, number, number], sx = 1) => V(a[0] * sx, a[1], a[2]);

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

const geoCache = new Map<ClassId, THREE.BufferGeometry>();

export class HostBody {
  readonly root = new THREE.Group();
  private sway: { obj: THREE.Object3D; base: THREE.Euler; amp: number; rate: number; phase: number }[] = [];
  private chest: THREE.Mesh;
  private glows: THREE.MeshStandardMaterial[] = [];
  private time = 0;

  constructor(readonly classId: ClassId) {
    const b = BUILDS[classId], f = b.frame;
    const rand = rng(classId.length * 17);
    this.root.name = `host:${classId}`;
    let geo = geoCache.get(classId);
    if (!geo) {
      geo = meshSdf(bodyPrims(f), 1, { resolution: 112, noise: { amp: 0.003, freq: 45, seed: 5 } }).geometry;
      geoCache.set(classId, geo);
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
    if (!big) for (const s of [-1, 1]) {
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
      for (let i = 0; i < 3; i++) {
        claws.push(spike(len, f.r.fore * (big ? 0.38 : 0.32), 0.45).rotateX(Math.PI * 0.85).rotateZ(s * (i - 1) * 0.28).translate(wr.x + s * (i - 1) * f.r.fore * 0.6, wr.y - 0.05, wr.z + 0.02));
      }
    }
    this.root.add(new THREE.Mesh(merge(claws), bone));

    // A few soft nodes: sternum and spine (accents, not a light show).
    const nodes: THREE.BufferGeometry[] = [];
    const ch = T(f.chest);
    for (let i = 0; i < 3; i++) nodes.push(new THREE.SphereGeometry(0.012, 10, 8).translate(ch.x, ch.y - 0.06 + i * 0.06, ch.z + f.r.chest[2] * 0.95));
    this.root.add(new THREE.Mesh(merge(nodes), node));

    // Spine ridge of small bone plates down the back.
    const spine: THREE.BufferGeometry[] = [];
    for (let i = 0; i < (big ? 0 : 7); i++) {
      const p = T(f.hips).lerp(T(f.neck), i / 6);
      spine.push(spike(big ? 0.12 : 0.05, big ? 0.04 : 0.014, 0.3).rotateX(-1.1).translate(p.x, p.y, p.z - (i < 4 ? f.r.waist + 0.01 : f.r.chest[2] * 0.9)));
    }
    if (spine.length) this.root.add(new THREE.Mesh(merge(spine), bone));

    if (classId === 'neuroInfiltrator' || classId === 'venomWraith') {
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
      const pts = [hp.clone().add(V(0, 0.02, -0.08)), hp.clone().add(V(0, -0.06, -0.3)), hp.clone().add(V(0, -0.24, -0.44)), hp.clone().add(V(0, -0.46, -0.42)), hp.clone().add(V(0, -0.6, -0.3))];
      const radii = [0.05, 0.11, 0.1, 0.07, 0.03];
      const tube = taperTube(pts, radii, 10, 6);
      // This curl's Frenet frame comes out mirrored, so the tube's normals point inward: flip them.
      const nrm = tube.attributes.normal;
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
      const abd: THREE.BufferGeometry[] = [tube];
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
      // Blade forearms and four insect wings.
      for (const s of [-1, 1]) {
        const el = T(f.elbow, s);
        const bl = new THREE.Mesh(blade(0.72, 0.1, 0.014), bone);
        bl.position.copy(el);
        bl.rotation.set(Math.PI * 0.95, s * 0.15, s * 0.05);
        this.root.add(bl);
        for (let i = 0; i < 2; i++) {
          const w = new THREE.Mesh(wing(1.05 - i * 0.25, 0.32, rand, 1 + i), membrane(mix(HIVE.bone, HIVE.acid, 0.3), 0.4));
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
      const plateAt = (p: THREE.Vector3, normal: THREE.Vector3, w: number, l: number, h: number) => {
        q.setFromUnitVectors(up, normal.clone().normalize());
        bones.push(plate(w, l, h, rand, 0.5).applyMatrix4(m.compose(p, q, V(1, 1, 1))));
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
      this.root.add(new THREE.Mesh(roughen(merge(bones), 0.006, 30, 4), chitin(b.bone, hex(new THREE.Color(PATH.melee).multiplyScalar(0.08)), 6)));
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
  }
}

/** The host body for a class (Hive menu, host select, results). */
export function createHostBody(classId: ClassId): HostBody {
  return new HostBody(classId);
}
