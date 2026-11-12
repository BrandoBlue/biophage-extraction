import * as THREE from 'three';
import { BOSSES } from '../../data';
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, chitin, livingFlesh, membrane } from '../render/materials';
import { mutation } from '../render/dissolve';
import { gore } from '../render/gore';
import { limbSegment, merge, needleRing, rng, roughen, skull, spike, taperTube, vent, type Rand } from './parts';
import { meshSdf, type SdfPrim } from './sdf';

/**
 * The Reliquary (data/bosses.json `reliquary`): a 12 m colony organism, part hermit crab, part
 * siphonophore, part banyan. On its back it wears a cathedral of fused host ribcages; it walks on six
 * pillar legs with root toes; a brood sac hangs beneath; three throat hearts glow through a bone cage
 * and are the only bright things on it. Wet bone and dark flesh, no neon.
 *
 * Behaviour is PvE AI's (src/ai/reliquary.ts). It moves `root` and writes `drive` every frame:
 *   drive.windup      0..1, every attack's tell (the body coils; with `strike` set, a foreleg rises)
 *   drive.strike      stamp point (world) or null
 *   drive.rear        0..1, ribcage open: the front rears and the shell and throat cage split
 *   drive.heartsOpen  hearts exposed (the cage stays open while true)
 *   drive.look        world point the head tracks, or null
 *   drive.phase       'stalk' | 'bloom' | 'collapse' (collapse: the hind legs give out, it drags itself)
 * One-shot pulses: slam() stamps the raised foreleg down, vent() blows spores out of the spires,
 * birth() squeezes the brood sac (spawn Needlemaws at `sacBone`). Damage: popWeakPoint(i) for
 * hearts (0..2) and the brood sac (3), severLeg(i), hurt(fraction), destroy(). The flesh burns away
 * on death and the bone cathedral stays behind as a relic.
 * Origin on the ground under the body, facing +Z. Legs IK-walk on `ground(x, z)` (default flat y = 0).
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));
const dim = (c: string, k: number) => hex(new THREE.Color(c).multiplyScalar(k));
const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
const smooth = (t: number) => { const k = THREE.MathUtils.clamp(t, 0, 1); return k * k * (3 - 2 * k); };
const UP = V(0, 1, 0);

/** Body height (underside clearance comes from bosses.json crawlHeight). */
const SIZE = BOSSES.reliquary?.size ?? { length: 12, height: 9, crawlHeight: 5 };
const BODY_Y = SIZE.crawlHeight;
const COLLAPSE_Y = 2.3;
const L1 = 2.9, L2 = 3.4;
/** Hip anchors in body space, legs 0 FL, 1 FR, 2 ML, 3 MR, 4 HL, 5 HR. */
const HIPS = [V(-1.8, -0.5, 3.0), V(1.8, -0.5, 3.0), V(-2.1, -0.4, 0.3), V(2.1, -0.4, 0.3), V(-1.9, -0.5, -2.6), V(1.9, -0.5, -2.6)];
const TRIPOD = [0, 1, 1, 0, 0, 1];
const PIVOT_Z = -2.6;

export type ReliquaryPhase = 'stalk' | 'bloom' | 'collapse';
export interface ReliquaryDrive {
  windup: number;
  strike: THREE.Vector3 | null;
  rear: number;
  heartsOpen: boolean;
  look: THREE.Vector3 | null;
  phase: ReliquaryPhase;
}

/** Same shape as the Abomination HitSphere, plus a tag and index. */
export interface ReliquaryHit {
  tag: 'body' | 'shell' | 'heart' | 'broodSac' | 'leg';
  index: number;
  local: THREE.Vector3; r: number; weak: boolean; world: THREE.Vector3; bone: THREE.Object3D;
  limb?: string;
}

export interface ReliquaryWeakPoint { tag: 'heart' | 'broodSac'; index: number; mesh: THREE.Object3D; world: THREE.Vector3; radius: number; alive: boolean }

interface Leg {
  i: number; side: number; hip: THREE.Vector3;
  upper: THREE.Mesh; lower: THREE.Mesh; toes: THREE.Mesh;
  planted: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; step: number; stepping: boolean;
  foot: THREE.Vector3; severed: boolean;
}

interface Gib { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; rest: boolean; age: number }

// ---------- geometry (built once, shared) ----------

function torsoPrims(): SdfPrim[] {
  const flesh = new THREE.Color(1, 1, 1), belly = new THREE.Color(0.75, 0.7, 0.72);
  return [
    { shape: 'ellipsoid', a: V(0, 0, -1.2), radii: V(2.3, 1.6, 3.8), bone: 0, tint: flesh },
    // Segmented abdomen: banded like a siphonophore stem.
    { shape: 'cone', a: V(0, 0.05, -4.6), b: V(0, 0.1, 1.6), ra: 1.75, rb: 1.7, blend: 0.6, bone: 0, ribs: { freq: 1.3, depth: 0.12 } },
    { shape: 'ellipsoid', a: V(0, 0.1, 2.0), radii: V(1.9, 1.4, 2.2), blend: 0.8, bone: 0 },
    // Throat: the heart chamber, slung low at the front.
    { shape: 'ellipsoid', a: V(0, -0.5, 3.9), radii: V(1.5, 1.45, 1.35), blend: 0.6, bone: 0 },
    // Sagging belly and the tail lobe.
    { shape: 'ellipsoid', a: V(0, -1.15, -0.6), radii: V(1.6, 0.85, 2.7), blend: 0.7, bone: 0, tint: belly },
    { shape: 'cone', a: V(0, -0.2, -4.8), b: V(0, -1.5, -6.2), ra: 1.2, rb: 0.45, blend: 0.5, bone: 0 },
    // Gill folds along the flanks.
    { shape: 'cone', a: V(-2.05, -0.2, -3.5), b: V(-2.0, -0.3, 1.5), ra: 0.18, rb: 0.16, subtract: true, blend: 0.15, bone: 0 },
    { shape: 'cone', a: V(2.05, -0.2, -3.5), b: V(2.0, -0.3, 1.5), ra: 0.18, rb: 0.16, subtract: true, blend: 0.15, bone: 0 },
  ];
}

function headPrims(): SdfPrim[] {
  // A blind, drooping snout: no eyes, a lamprey mouth at the tip.
  return [
    { shape: 'cone', a: V(0, 0, 0), b: V(0, -1.0, 1.4), ra: 0.85, rb: 0.5, bone: 0, ribs: { freq: 3, depth: 0.05 } },
    { shape: 'ellipsoid', a: V(0, 0.15, 0.3), radii: V(0.9, 0.7, 0.9), blend: 0.3, bone: 0 },
    { shape: 'ellipsoid', a: V(0, -1.05, 1.5), radii: V(0.38, 0.38, 0.3), subtract: true, blend: 0.12, bone: 0 },
  ];
}

let torsoGeo: THREE.BufferGeometry | null = null, headGeo: THREE.BufferGeometry | null = null;

/** One rib: an arch from the spine (x = 0) down to the flank on side `s`. */
function rib(s: number, z: number, top: number, reach: number, drop: number, r: number, rand: Rand): THREE.BufferGeometry {
  const j = () => (rand() - 0.5) * 0.15;
  const pts = [V(0, top, z), V(s * reach * 0.55, top - 0.1 + j(), z + j()), V(s * reach, top - drop * 0.45, z + 0.15 + j()), V(s * reach * 1.04, top - drop * 0.85, z + 0.3), V(s * reach * 0.9, top - drop, z + 0.4)];
  return taperTube(pts, [r, r * 0.9, r * 0.8, r * 0.6, r * 0.35], 7, 4);
}

/** A small fused host ribcage (sternum and curled ribs), the bones of something that died in Zone 7. */
function hostRibcage(size: number, rand: Rand): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [taperTube([V(0, 0, 0), V(0, size * 0.5, 0.05 * size), V(0, size, 0)], [0.05 * size, 0.045 * size, 0.03 * size], 6, 3)];
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
    const y = size * (0.15 + i * 0.17), w = size * (0.45 - Math.abs(i - 2) * 0.06);
    parts.push(taperTube([V(0, y, 0), V(s * w * 0.7, y + 0.05 * size, -w * 0.3), V(s * w, y - 0.08 * size, -w * 0.9), V(s * w * 0.55, y - 0.15 * size, -w * 1.4)], [0.035 * size, 0.03 * size, 0.022 * size, 0.01 * size], 5, 3));
  }
  return roughen(merge(parts), 0.008 * size, 6 / size, rand() * 20);
}

function toeRoots(rand: Rand): THREE.BufferGeometry {
  // Banyan toes: roots spreading from the foot over the ground, forward-biased (+Z).
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI * 0.55 + (i / 5) * Math.PI * 1.1 + (rand() - 0.5) * 0.25, len = 1.0 + rand() * 0.8;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, d = 0.15 + t * len, w = a + Math.sin(t * 3 + i) * 0.15;
      pts.push(V(Math.sin(w) * d, 0.35 * (1 - t) ** 2 + 0.04, Math.cos(w) * d));
    }
    parts.push(taperTube(pts, [0.2, 0.15, 0.1, 0.06, 0.015], 6, 3));
  }
  return roughen(merge(parts), 0.025, 5, rand() * 9);
}

export class Reliquary {
  readonly root = new THREE.Group();
  readonly drive: ReliquaryDrive = { windup: 0, strike: null, rear: 0, heartsOpen: false, look: null, phase: 'stalk' };
  readonly weakPoints: ReliquaryWeakPoint[] = [];
  readonly hitSpheres: ReliquaryHit[] = [];
  /** Coarse body sphere (local), for hits that miss everything else. */
  readonly body = { centre: V(0, BODY_Y, 0), radius: 4.2 };
  /** Where the brood drops from (Needlemaw spawns). */
  readonly sacBone = new THREE.Object3D();
  /** Ground height under a world x, z. */
  ground: (x: number, z: number) => number = () => 0;

  private pivot = new THREE.Group();
  private bodyGroup = new THREE.Group();
  private torso: THREE.Mesh;
  private head = new THREE.Group();
  private shellL = new THREE.Group();
  private shellR = new THREE.Group();
  private cageL = new THREE.Group();
  private cageR = new THREE.Group();
  private sacPivot = new THREE.Group();
  private sac: THREE.Mesh;
  private hearts: THREE.Mesh[] = [];
  private heartMats: THREE.MeshStandardMaterial[] = [];
  private legs: Leg[] = [];
  private legsGroup = new THREE.Group();
  private tendrils: { obj: THREE.Object3D; phase: number }[] = [];
  private vents: THREE.Object3D[] = [];
  private flesh: THREE.Material[] = [];
  private gibs: Gib[] = [];
  private spurts: { leg: Leg; left: number; next: number }[] = [];
  private fluid = mix(PATH.melee, HIVE.danger, 0.35);
  private time = 0;
  private lift = BODY_Y;
  private pitch = 0;
  private roll = 0;
  private open = 0;
  private slamT = 0;
  private birthT = 0;
  private ventT = 0;
  private stampLeg = -1;
  private health = 1;
  private dead = false;
  private deadT = 0;
  private lastPos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private started = false;

  constructor(seed = 1, private scene?: THREE.Object3D) {
    this.root.name = 'reliquary';
    const rand = rng(seed * 7 + 3);

    // Materials: dark wet flesh, stained bone, and one warm glow for the hearts.
    const heartGlow = this.fluid;
    const fleshMat = livingFlesh(mix(ZONE7_SHADE.flesh, ZONE7_SHADE.rockDeep, 0.5), dim(heartGlow, 0.12), mix(HIVE.bone, ZONE7_SHADE.flesh, 0.5), 2.2);
    fleshMat.vertexColors = true;
    const legMat = livingFlesh(mix(ZONE7_SHADE.stem, ZONE7_SHADE.rockDeep, 0.55), dim(heartGlow, 0.06), mix(HIVE.bone, ZONE7_SHADE.stem, 0.6), 1.6);
    const boneMat = chitin(mix(HIVE.bone, ZONE7_SHADE.rockDeep, 0.3), dim(heartGlow, 0.12), 1.2);
    const oldBone = chitin(mix(HIVE.bone, ZONE7_SHADE.moss, 0.35), dim(ZONE7.cyan, 0.05), 3);
    this.flesh.push(fleshMat, legMat);

    this.root.add(this.pivot);
    this.pivot.position.set(0, BODY_Y, PIVOT_Z);
    this.pivot.add(this.bodyGroup);
    this.bodyGroup.position.set(0, 0, -PIVOT_Z);
    this.bodyGroup.name = 'body';

    torsoGeo ??= meshSdf(torsoPrims(), 1, { resolution: 72, noise: { amp: 0.06, freq: 2.2, seed: 41 } }).geometry;
    this.torso = new THREE.Mesh(torsoGeo, fleshMat);
    this.torso.name = 'torso';
    this.bodyGroup.add(this.torso);

    // Head: a blind drooping snout with a lamprey mouth and a crown of hooks.
    headGeo ??= meshSdf(headPrims(), 1, { resolution: 40, noise: { amp: 0.03, freq: 4, seed: 42 } }).geometry;
    this.head.position.set(0, -0.6, 4.9);
    this.head.name = 'head';
    const snout = new THREE.Mesh(headGeo, fleshMat);
    this.head.add(snout);
    const mouth = new THREE.Mesh(needleRing(0.32, 14, 0.28, rand, 0.7), boneMat);
    mouth.position.set(0, -1.0, 1.42);
    mouth.quaternion.setFromUnitVectors(UP, V(0, -0.55, 0.85).normalize());
    this.head.add(mouth);
    const hooks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 5 - 0.5) * 2.2;
      hooks.push(spike(0.7 + rand() * 0.3, 0.08, 0.5).rotateX(-0.9).rotateZ(a * 0.6).translate(Math.sin(a) * 0.6, 0.55, -0.1 + Math.cos(a) * 0.2));
    }
    this.head.add(new THREE.Mesh(merge(hooks), boneMat));
    this.bodyGroup.add(this.head);

    // Hearts: three throat chambers, half sunk in the throat, each in a thin membrane sac.
    const heartSpots = [V(-0.72, -0.55, 4.65), V(0.72, -0.55, 4.65), V(0, 0.15, 4.85)];
    const n = Number(BOSSES.reliquary?.weakPoints.hearts?.count ?? 3);
    const sacMat = membrane(mix(heartGlow, HIVE.bone, 0.4), 0.3);
    for (let i = 0; i < n; i++) {
      const at = heartSpots[i % heartSpots.length].clone().add(V(0, -Math.floor(i / 3) * 0.8, 0));
      const mat = bioNode(heartGlow, 1.7 + i * 0.2);
      this.heartMats.push(mat);
      const h = new THREE.Mesh(roughen(new THREE.SphereGeometry(0.5, 18, 14).scale(1, 1.15, 0.9), 0.04, 6, 50 + i), mat);
      h.position.copy(at);
      h.name = `heart${i}`;
      const skin = new THREE.Mesh(new THREE.SphereGeometry(0.64, 18, 14).scale(1, 1.1, 0.9), sacMat);
      h.add(skin);
      this.bodyGroup.add(h);
      this.hearts.push(h);
      this.weakPoints.push({ tag: 'heart', index: i, mesh: h, world: new THREE.Vector3(), radius: 0.62, alive: true });
      this.hitSpheres.push({ tag: 'heart', index: i, local: V(0, 0, 0), r: 0.62, weak: true, world: new THREE.Vector3(), bone: h });
    }

    // Throat cage: bone bars over the hearts, split in two halves hinged along the top of the throat.
    const hinge = V(0, 1.05, 4.2);
    for (const [g, s] of [[this.cageL, -1], [this.cageR, 1]] as const) {
      g.position.copy(hinge);
      const bars: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 5; k++) {
        const z = -0.4 + k * 0.32, r0 = 1.55 - Math.abs(k - 2) * 0.12;
        const pts = [V(0, 0.05, z), V(s * r0 * 0.75, -0.35, z + 0.35), V(s * r0, -1.4, z + 0.55), V(s * r0 * 0.8, -2.4, z + 0.45), V(s * 0.25, -2.95, z + 0.2)];
        bars.push(taperTube(pts, [0.13, 0.12, 0.1, 0.08, 0.05], 7, 4));
      }
      g.add(new THREE.Mesh(roughen(merge(bars), 0.03, 4, s + 7), boneMat));
      this.bodyGroup.add(g);
    }

    // The cathedral: fused ribcages over the back, split in two halves hinged on the spine.
    const spine = new THREE.Group();
    this.bodyGroup.add(spine);
    const shellBones: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []];
    const relics: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []];
    for (let k = 0; k < 9; k++) {
      const z = -4.6 + k * 0.95, arch = Math.sin((k / 8) * Math.PI);
      const top = 2.0 + arch * 0.7;
      for (const s of [-1, 1]) {
        const side = s < 0 ? 0 : 1;
        shellBones[side].push(rib(s, z, top, 2.35 + arch * 0.45, 2.6 + arch * 0.5, 0.17 + arch * 0.06, rand));
        // Thinner secondary ribs between the main ones.
        if (k < 8) shellBones[side].push(rib(s, z + 0.48, top - 0.15, 2.2 + arch * 0.4, 2.0 + arch * 0.4, 0.08, rand));
      }
    }
    // Fused host ribcages and skulls crusted onto the shell.
    for (let i = 0; i < 10; i++) {
      const s = i % 2 ? 1 : -1, z = -4.2 + rand() * 7.5, a = 0.5 + rand() * 0.8;
      const reach = 2.4, at = V(s * Math.sin(a) * reach, 1.8 + Math.cos(a) * 1.2, z);
      const g = i % 3 === 0 ? skull(0.55 + rand() * 0.2, i) : hostRibcage(0.9 + rand() * 0.5, rand);
      g.applyMatrix4(new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(UP, V(s * Math.sin(a), Math.cos(a), 0).normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2)), V(1, 1, 1)));
      relics[s < 0 ? 0 : 1].push(g);
    }
    for (const [g, side] of [[this.shellL, 0], [this.shellR, 1]] as const) {
      g.position.set(0, 2.6, 0);
      for (const geo of [...shellBones[side], ...relics[side]]) geo.translate(0, -2.6, 0);
      g.add(new THREE.Mesh(roughen(merge(shellBones[side]), 0.035, 3, side + 3), boneMat));
      g.add(new THREE.Mesh(merge(relics[side]), oldBone));
      spine.add(g);
    }
    // Spine: vertebrae along the ridge, spires rising like a ruined nave, buttresses and vents.
    const spineBones: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 16; k++) {
      const z = -4.8 + k * 0.62, arch = Math.sin(((z + 4.8) / 9.6) * Math.PI);
      spineBones.push(roughen(new THREE.SphereGeometry(0.28, 10, 8).scale(1, 0.8, 1.3), 0.03, 6, k).translate(0, 2.05 + arch * 0.7, z));
    }
    const spireAt = [-3.6, -1.9, -0.2, 1.3, 2.6];
    spireAt.forEach((z, i) => {
      const arch = Math.sin(((z + 4.8) / 9.6) * Math.PI), h = 1.0 + arch * 1.2 + rand() * 0.3;
      const base = V((rand() - 0.5) * 0.3, 2.1 + arch * 0.7, z);
      const pts = [base, base.clone().add(V(0, h * 0.35, -0.1)), base.clone().add(V((rand() - 0.5) * 0.3, h * 0.7, -0.35)), base.clone().add(V(0, h, -0.7))];
      spineBones.push(roughen(taperTube(pts, [0.32, 0.22, 0.12, 0.02], 8, 4), 0.04, 4, i + 11));
      // Smaller thorns around each spire's foot.
      for (let k = 0; k < 3; k++) spineBones.push(spike(0.5 + rand() * 0.5, 0.09, 0.4).rotateX(-0.5 - rand() * 0.4).rotateZ((k - 1) * 0.7).translate(base.x, base.y, base.z - 0.25));
      if (i % 2 === 0) {
        const v = new THREE.Mesh(vent(0.26, 0.36), boneMat);
        v.position.copy(base).add(V(0, 0.2, 0.45));
        v.quaternion.setFromUnitVectors(UP, V(0, 1, 0.6).normalize());
        spine.add(v);
        this.vents.push(v);
      }
    });
    spine.add(new THREE.Mesh(merge(spineBones), boneMat));

    // Siphonophore tendrils hanging from the belly (they drag in collapse).
    const tendrilMat = livingFlesh(mix(ZONE7_SHADE.flesh, HIVE.bone, 0.15), dim(heartGlow, 0.1), mix(HIVE.bone, ZONE7_SHADE.flesh, 0.4), 4);
    this.flesh.push(tendrilMat);
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const x = (rand() - 0.5) * 2.6, z = -4.5 + rand() * 6.5;
      g.position.set(x, -1.3 - Math.abs(x) * 0.1, z);
      const len = 1.8 + rand() * 2.0, pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 5; k++) pts.push(V(Math.sin(k + i) * 0.12 * k, -len * (k / 5), Math.cos(k * 1.3 + i) * 0.1 * k - k * 0.06));
      g.add(new THREE.Mesh(taperTube(pts, [0.12, 0.1, 0.08, 0.06, 0.04, 0.012], 6, 3), tendrilMat));
      this.bodyGroup.add(g);
      this.tendrils.push({ obj: g, phase: rand() * 6 });
    }

    // Brood sac: a pendulous translucent sac on a fleshy stalk, curled embryos inside.
    this.sacPivot.position.set(0, -1.55, -1.3);
    this.bodyGroup.add(this.sacPivot);
    this.sacPivot.add(new THREE.Mesh(taperTube([V(0, 0.2, 0), V(0.05, -0.4, 0.05), V(0, -0.9, 0)], [0.55, 0.42, 0.5], 9, 3), fleshMat));
    const sacGeo = roughen(new THREE.SphereGeometry(1, 28, 20), 0.05, 2.5, 33).scale(1.15, 1.25, 1.1).translate(0, -1.95, 0);
    this.sac = new THREE.Mesh(sacGeo, membrane(mix(ZONE7_SHADE.flesh, HIVE.bone, 0.5), 0.5));
    this.sac.name = 'broodSac';
    this.sacPivot.add(this.sac);
    const embryoMat = livingFlesh(mix(ZONE7_SHADE.flesh, HIVE.bone, 0.3), dim(ZONE7.magenta, 0.15), dim(HIVE.bone, 0.4), 9);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2, pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) { const t = k / 6, w = a + t * 3.6; pts.push(V(Math.cos(w) * 0.35 * (1 - t * 0.5), -1.6 - i * 0.18 - t * 0.3, Math.sin(w) * 0.35 * (1 - t * 0.5))); }
      this.sacPivot.add(new THREE.Mesh(taperTube(pts, [0.2, 0.22, 0.18, 0.14, 0.1, 0.06, 0.02], 7, 3), embryoMat));
    }
    this.sacBone.position.set(0, -3.2, 0);
    this.sacBone.name = 'sacBone';
    this.sacPivot.add(this.sacBone);
    this.weakPoints.push({ tag: 'broodSac', index: 0, mesh: this.sac, world: new THREE.Vector3(), radius: 1.25, alive: true });
    this.hitSpheres.push({ tag: 'broodSac', index: 0, local: V(0, -1.95, 0), r: 1.25, weak: true, world: new THREE.Vector3(), bone: this.sac });

    // Legs: pillar legs with banyan root toes, IK-solved each frame in root space.
    this.root.add(this.legsGroup);
    const upperGeo = roughen(limbSegment(L1, 0.72, 0.56, 'pillar', rand), 0.04, 3, 61);
    const lowerGeo = roughen(limbSegment(L2, 0.58, 0.42, 'pillar', rand, true), 0.035, 3, 62);
    HIPS.forEach((hip, i) => {
      const upper = new THREE.Mesh(upperGeo, legMat), lower = new THREE.Mesh(lowerGeo, legMat);
      const toes = new THREE.Mesh(toeRoots(rand), legMat);
      upper.name = `leg${i}upper`;
      lower.name = `leg${i}lower`;
      this.legsGroup.add(upper, lower, toes);
      // Bone sheath on the upper segment: the legs carry the shell's colour up to the cathedral.
      const sheath = new THREE.Mesh(roughen(limbSegment(L1 * 0.7, 0.78, 0.62, 'bone', rand), 0.05, 3, 70 + i), boneMat);
      sheath.position.y = L1 * 0.12;
      sheath.scale.set(1, 1, 0.75);
      upper.add(sheath);
      const leg: Leg = { i, side: Math.sign(hip.x), hip, upper, lower, toes, planted: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), step: 0, stepping: false, foot: new THREE.Vector3(), severed: false };
      this.legs.push(leg);
      this.hitSpheres.push({ tag: 'leg', index: i, local: V(0, L1 * 0.5, 0), r: 0.7, weak: false, world: new THREE.Vector3(), bone: upper, limb: `leg${i}` });
      this.hitSpheres.push({ tag: 'leg', index: i, local: V(0, L2 * 0.5, 0), r: 0.55, weak: false, world: new THREE.Vector3(), bone: lower, limb: `leg${i}` });
    });

    // Body and shell spheres (shell blocks frontal fire; armour rules are PvE AI's).
    this.hitSpheres.push({ tag: 'body', index: 0, local: V(0, 0, -1.5), r: 2.6, weak: false, world: new THREE.Vector3(), bone: this.bodyGroup });
    this.hitSpheres.push({ tag: 'body', index: 1, local: V(0, -0.4, 2.6), r: 1.9, weak: false, world: new THREE.Vector3(), bone: this.bodyGroup });
    this.hitSpheres.push({ tag: 'shell', index: 0, local: V(0, 2.4, -0.5), r: 3.0, weak: false, world: new THREE.Vector3(), bone: this.bodyGroup });

    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.sac.castShadow = false;
    this.root.updateMatrixWorld(true);
    this.plant();
  }

  get alive(): boolean { return !this.dead; }
  get legsIntact(): number { return this.legs.filter((l) => !l.severed).length; }
  get sacAlive(): boolean { return this.weakPoints.some((w) => w.tag === 'broodSac' && w.alive); }

  /** Put every foot at its rest spot under the current root transform (after teleporting the root). */
  plant(): void {
    this.root.updateMatrixWorld(true);
    this.root.getWorldPosition(this.lastPos);
    this.started = true;
    for (const l of this.legs) {
      this.restWorld(l, l.planted);
      l.foot.copy(l.planted);
      l.stepping = false;
    }
    this.solveLegs();
    this.refresh();
  }

  /** Update hit sphere and weak point world positions (update() calls this). */
  refresh(): void {
    this.root.updateMatrixWorld(true);
    for (const h of this.hitSpheres) h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
    for (const w of this.weakPoints) {
      if (w.tag === 'broodSac') w.world.copy(this.hitSpheres.find((h) => h.tag === 'broodSac')!.world);
      else w.mesh.getWorldPosition(w.world);
    }
  }

  // ---------- pulses and damage ----------

  /** Stamp the raised foreleg down (on `drive.strike` if set). */
  slam(): void {
    if (this.dead) return;
    this.slamT = 1;
    const l = this.stampLeg >= 0 ? this.legs[this.stampLeg] : null;
    if (l && !l.severed) {
      const at = this.drive.strike ? this.drive.strike.clone() : l.foot.clone();
      at.y = this.ground(at.x, at.z);
      l.planted.copy(at);
      l.foot.copy(at);
      l.stepping = false;
      if (this.scene) {
        gore.burst(this.scene, { point: at.clone().add(V(0, 0.2, 0)), normal: UP.clone(), colour: mix(ZONE7_SHADE.rock, HIVE.bone, 0.3), count: 40, speed: 7 });
      }
    }
    this.stampLeg = -1;
  }

  /** Spores blown out of the spire vents (rear-and-vent). */
  vent(): void {
    if (this.dead) return;
    this.ventT = 1;
    if (!this.scene) return;
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (const v of this.vents) {
      v.getWorldPosition(p);
      n.set(0, 1, 0).applyQuaternion(v.getWorldQuaternion(new THREE.Quaternion()));
      gore.burst(this.scene, { point: p.clone(), normal: n.clone(), colour: mix(HIVE.bone, ZONE7.violet, 0.35), count: 30, speed: 5 });
    }
  }

  /** The brood sac squeezes out a brood (spawn at `sacBone`). */
  birth(): void {
    if (this.dead || !this.sacAlive) return;
    this.birthT = 1;
    if (this.scene) gore.burst(this.scene, { point: this.sacBone.getWorldPosition(new THREE.Vector3()), colour: this.fluid, count: 50, speed: 4 });
  }

  /** Destroy a heart (0..2) or the brood sac (3). */
  popWeakPoint(i: number): void {
    const w = this.weakPoints[i];
    if (!w || !w.alive) return;
    w.alive = false;
    this.refresh();
    if (this.scene) {
      gore.burst(this.scene, { point: w.world.clone(), colour: this.fluid, count: 80, speed: 8 });
      gore.splat(this.scene, { point: V(w.world.x, this.ground(w.world.x, w.world.z) + 0.05, w.world.z), normal: UP.clone(), size: 2.5, colour: this.fluid });
    }
    mutation.dissolveOut(w.mesh, { duration: 0.8, colour: this.fluid, done: () => { w.mesh.visible = false; } });
    this.slamT = Math.max(this.slamT, 0.6);
  }

  /** Shoot a leg off (from phase 2). The body lists toward the stump. */
  severLeg(i: number): void {
    const l = this.legs[i];
    if (!l || l.severed) return;
    l.severed = true;
    for (const h of this.hitSpheres) if (h.tag === 'leg' && h.index === i) h.r = 0;
    const parts = [l.upper, l.lower, l.toes];
    if (this.scene) {
      const hipW = this.bodyGroup.localToWorld(l.hip.clone());
      gore.burst(this.scene, { point: hipW, colour: this.fluid, count: 90, speed: 9 });
      this.spurts.push({ leg: l, left: 4, next: 0 });
      for (const p of parts) {
        this.scene.attach(p);
        const out = V(l.side, 0.6, (Math.random() - 0.5) * 0.6).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
        this.gibs.push({ obj: p, vel: out.multiplyScalar(4 + Math.random() * 2), spin: V(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(2.5), rest: false, age: 0 });
      }
    } else for (const p of parts) p.visible = false;
  }

  /** Accepts the HitSphere limb id ('leg3'). */
  sever(limb: string): void {
    const m = /^leg(\d)$/.exec(limb);
    if (m) this.severLeg(Number(m[1]));
  }

  hurt(fraction: number): void { this.health = THREE.MathUtils.clamp(1 - fraction, 0, 1); }

  /** Death: the flesh burns away, the body sinks, and the bone cathedral stays as a relic. */
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.scene) {
      const c = this.bodyGroup.localToWorld(V(0, 0, 2));
      gore.burst(this.scene, { point: c, colour: this.fluid, count: 260, speed: 12 });
      const g = this.root.getWorldPosition(new THREE.Vector3());
      gore.splat(this.scene, { point: g.add(V(0, 0.05, 0)), normal: UP.clone(), size: 12, colour: this.fluid });
    }
    for (const w of this.weakPoints) if (w.alive) { w.alive = false; mutation.dissolveOut(w.mesh, { duration: 1.5, colour: this.fluid }); }
    mutation.dissolveOut(this.torso, { duration: 6, colour: this.fluid });
    mutation.dissolveOut(this.head, { duration: 5, colour: this.fluid });
    for (const t of this.tendrils) mutation.dissolveOut(t.obj, { duration: 4, colour: this.fluid });
    mutation.dissolveOut(this.sacPivot, { duration: 3, colour: this.fluid });
  }

  // ---------- per frame ----------

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const d = this.drive, t = this.time;
    this.root.updateMatrixWorld(true);
    const pos = this.root.getWorldPosition(new THREE.Vector3());
    if (!this.started) this.plant();
    this.vel.lerp(pos.clone().sub(this.lastPos).divideScalar(dt), 1 - Math.exp(-6 * dt));
    this.lastPos.copy(pos);
    this.slamT = Math.max(0, this.slamT - dt * 2);
    this.birthT = Math.max(0, this.birthT - dt * 1.2);
    this.ventT = Math.max(0, this.ventT - dt * 0.8);

    const collapse = d.phase === 'collapse' || this.legsIntact <= 2;
    const lost = this.legs.filter((l) => l.severed);
    const listRoll = lost.reduce((a, l) => a + l.side * 0.06, 0);
    const lostHind = lost.filter((l) => l.i >= 2).length;

    // Body height, pitch and roll: coil for the tell, rear for the bloom, sag on lost legs, slump in collapse.
    const rear = this.dead ? 0 : smooth(d.rear);
    let targetY = collapse ? COLLAPSE_Y : BODY_Y - d.windup * 0.7 - lostHind * 0.2 + rear * 0.8;
    let targetPitch = -rear * 0.55 + d.windup * 0.05 + (collapse ? -0.1 : 0);
    if (this.dead) { this.deadT += dt; targetY = 1.6; targetPitch = 0.08; }
    const breathe = Math.sin(t * (0.55 + this.health * 0.25));
    this.lift = damp(this.lift, targetY - this.slamT * 0.35 + breathe * 0.06, this.dead ? 0.8 : 3, dt);
    this.pitch = damp(this.pitch, targetPitch + this.slamT * 0.04, 3, dt);
    this.roll = damp(this.roll, (this.dead ? 0.1 : listRoll) + Math.sin(t * 0.45) * 0.015, 2, dt);
    this.pivot.position.y = this.lift;
    this.pivot.rotation.set(this.pitch, 0, this.roll);
    const k = 1 + breathe * 0.012 + this.birthT * 0.02;
    this.torso.scale.set(k, 1 + breathe * 0.008, 1 + breathe * 0.006);

    // The cathedral and the throat cage split open as it rears (and stay open while hearts are exposed).
    const openTarget = this.dead ? 0.25 : Math.max(rear, d.heartsOpen ? 1 : 0, collapse ? 1 : 0);
    this.open = damp(this.open, openTarget, 2.5, dt);
    const creak = Math.sin(t * 0.8) * 0.01 + this.ventT * 0.06 * Math.sin(t * 30);
    this.shellL.rotation.z = -(this.open * 0.32 + creak);
    this.shellR.rotation.z = this.open * 0.32 + creak;
    this.cageL.rotation.set(this.open * 0.25, 0, -this.open * 1.0);
    this.cageR.rotation.set(this.open * 0.25, 0, this.open * 1.0);

    // Hearts: a slow lub-dub that glows through the bone, flaring once the cage opens.
    const rate = 0.7 + this.health * 0.4, ph = t * rate * Math.PI * 2;
    this.hearts.forEach((h, i) => {
      if (!this.weakPoints[i].alive) return;
      const b = Math.pow(Math.max(0, Math.sin(ph - i * 0.35)), 8);
      h.scale.setScalar(1 + b * 0.07);
      this.heartMats[i].emissiveIntensity = (0.22 + this.open * 0.6) * (0.6 + b * 1.1) * (0.5 + this.health * 0.5);
    });

    // Head: tracks the look target within limits, sways when idle.
    const look = d.look && !this.dead ? this.bodyGroup.worldToLocal(d.look.clone()).sub(this.head.position) : null;
    const yaw = look ? THREE.MathUtils.clamp(Math.atan2(look.x, look.z), -0.7, 0.7) : Math.sin(t * 0.3) * 0.15;
    const tilt = look ? THREE.MathUtils.clamp(-Math.atan2(look.y + 1, Math.hypot(look.x, look.z)) * 0.6, -0.4, 0.5) : 0.1;
    this.head.rotation.y = damp(this.head.rotation.y, yaw, 2.5, dt);
    this.head.rotation.x = damp(this.head.rotation.x, tilt + d.windup * 0.25 + this.open * 0.55 + (this.dead ? 0.6 : 0), 2.5, dt);

    // Sac swings against the motion; squeezes on birth.
    const vLocal = this.vel.clone().applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()).invert());
    this.sacPivot.rotation.x = damp(this.sacPivot.rotation.x, THREE.MathUtils.clamp(-vLocal.z * 0.08, -0.4, 0.4) + Math.sin(t * 1.1) * 0.04 - rear * 0.3, 2, dt);
    this.sacPivot.rotation.z = damp(this.sacPivot.rotation.z, THREE.MathUtils.clamp(vLocal.x * 0.08, -0.4, 0.4) + Math.sin(t * 0.8 + 1) * 0.04, 2, dt);
    const sq = Math.sin(this.birthT * Math.PI);
    this.sac.scale.set(1 - sq * 0.15, 1 + sq * 0.12, 1 - sq * 0.15);

    for (const tn of this.tendrils) {
      tn.obj.rotation.x = Math.sin(t * 0.9 + tn.phase) * 0.12 - THREE.MathUtils.clamp(vLocal.z * 0.06, -0.5, 0.5) + (collapse ? 0.9 : 0);
      tn.obj.rotation.z = Math.sin(t * 0.7 + tn.phase * 1.3) * 0.1;
    }

    if (!this.dead || this.deadT < 6) this.walk(dt, collapse, rear);
    this.updateGibs(dt);
    this.refresh();
  }

  /** Rest spot for a foot, in world space. */
  private restWorld(l: Leg, out: THREE.Vector3, collapse = false): THREE.Vector3 {
    const x = collapse && l.i >= 2 ? l.side * 3.3 : l.side * (Math.abs(l.hip.x) + 1.5);
    const z = collapse ? (l.i < 2 ? 6.0 : PIVOT_Z + (l.hip.z - PIVOT_Z) * 0.9 - 1.0) : l.hip.z * 1.2 + (l.i < 2 ? 0.8 : 0);
    out.set(x, 0, z);
    this.root.localToWorld(out);
    out.y = this.ground(out.x, out.z);
    return out;
  }

  private walk(dt: number, collapse: boolean, rear: number): void {
    const d = this.drive, speed = this.vel.length();
    const desired = new THREE.Vector3();
    const stepping = [0, 0];
    for (const l of this.legs) if (l.stepping && !l.severed) stepping[TRIPOD[l.i]]++;

    // The stamp: a foreleg on the strike side rises through the wind-up.
    if (!this.dead && d.windup > 0.05 && d.strike && this.stampLeg < 0) {
      const sl = this.root.worldToLocal(d.strike.clone());
      const pick = sl.x < 0 ? 0 : 1;
      this.stampLeg = this.legs[pick].severed ? (this.legs[1 - pick].severed ? -1 : 1 - pick) : pick;
    }
    if (d.windup <= 0.01 && this.slamT === 0) this.stampLeg = -1;

    for (const l of this.legs) {
      if (l.severed) continue;
      const limp = collapse && l.i >= 2;
      this.restWorld(l, desired, collapse);
      if (limp || this.dead) {
        // Dead legs drag: the feet slide with the body.
        l.planted.lerp(desired, 1 - Math.exp(-3 * dt));
        l.foot.copy(l.planted);
        continue;
      }
      if (l.i < 2 && (l.i === this.stampLeg || rear > 0.25)) {
        // Raised foreleg: for the stamp it lifts toward the strike, when rearing it paws the air.
        const hipW = this.bodyGroup.localToWorld(l.hip.clone());
        const air = l.i === this.stampLeg && d.strike
          ? l.planted.clone().lerp(d.strike, d.windup * 0.5).add(V(0, d.windup * 3.6, 0))
          : this.root.localToWorld(V(l.side * 3.2, 0, l.hip.z + 3.5)).setY(hipW.y - 2.6 + Math.sin(this.time * 2 + l.i) * 0.4);
        l.foot.lerp(air, 1 - Math.exp(-6 * dt));
        l.planted.copy(desired);
        l.stepping = false;
        continue;
      }
      desired.addScaledVector(this.vel, collapse ? 0.25 : 0.45);
      desired.y = this.ground(desired.x, desired.z);
      const reach = collapse ? 2.8 : 2.0;
      if (!l.stepping && l.planted.distanceTo(desired) > reach && stepping[1 - TRIPOD[l.i]] === 0) {
        l.stepping = true;
        l.step = 0;
        l.from.copy(l.foot);
        l.to.copy(desired);
        stepping[TRIPOD[l.i]]++;
      } else if (!l.stepping && l.foot.distanceTo(l.planted) > 0.05) {
        // Coming down from a rear or a raise: plant at rest.
        l.stepping = true;
        l.step = 0;
        l.from.copy(l.foot);
        l.to.copy(desired);
      }
      if (l.stepping) {
        const dur = collapse ? 0.4 : THREE.MathUtils.clamp(0.75 - speed * 0.08, 0.4, 0.75);
        l.step = Math.min(1, l.step + dt / dur);
        l.to.lerp(desired, 1 - Math.pow(0.8, dt * 60)); // same pull per second at any frame rate
        const e = smooth(l.step);
        l.foot.lerpVectors(l.from, l.to, e);
        l.foot.y += Math.sin(l.step * Math.PI) * (collapse ? 0.7 : 1.3);
        if (l.step >= 1) {
          l.stepping = false;
          l.planted.copy(l.to);
          l.foot.copy(l.to);
          if (collapse) this.lift -= 0.12; // the drag: a lurch with every heave
        }
      } else l.foot.copy(l.planted);
    }
    this.solveLegs();
  }

  /** Two-bone IK from the hips (on the moving body) to the feet, knees up and out. */
  private solveLegs(): void {
    this.root.updateMatrixWorld(true);
    const hip = new THREE.Vector3(), foot = new THREE.Vector3(), knee = new THREE.Vector3(), pole = new THREE.Vector3();
    const dir = new THREE.Vector3(), tmp = new THREE.Vector3();
    for (const l of this.legs) {
      if (l.severed) continue;
      this.root.worldToLocal(this.bodyGroup.localToWorld(hip.copy(l.hip)));
      this.root.worldToLocal(foot.copy(l.foot));
      dir.subVectors(foot, hip);
      const dist = THREE.MathUtils.clamp(dir.length(), 0.3, L1 + L2 - 0.01);
      dir.normalize();
      const a = (L1 * L1 + dist * dist - L2 * L2) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      pole.set(l.side * 1.6, 0.9, l.i < 2 ? 0.6 : l.i < 4 ? 0 : -0.5);
      pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      knee.copy(hip).addScaledVector(dir, a).addScaledVector(pole, h);
      const end = tmp.copy(hip).addScaledVector(dir, dist);
      this.place(l.upper, hip, knee);
      this.place(l.lower, knee, end);
      l.toes.position.copy(end).setY(Math.min(end.y, foot.y) - 0.05);
      const outward = Math.atan2(l.side * 0.6, l.i < 2 ? 1 : l.i < 4 ? 0.1 : -0.8);
      l.toes.rotation.set(0, outward, 0);
      // Toes curl up off the ground when the foot is in the air.
      const air = THREE.MathUtils.clamp((foot.y - this.root.worldToLocal(V(l.foot.x, this.ground(l.foot.x, l.foot.z), l.foot.z)).y) * 0.4, 0, 0.6);
      l.toes.rotation.x = -air;
    }
  }

  private place(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  }

  private updateGibs(dt: number): void {
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.age += dt;
      if (!g.rest) {
        g.vel.y -= 14 * dt;
        g.obj.position.addScaledVector(g.vel, dt);
        g.obj.rotation.x += g.spin.x * dt;
        g.obj.rotation.z += g.spin.z * dt;
        const floor = this.ground(g.obj.position.x, g.obj.position.z) + 0.4;
        if (g.obj.position.y < floor) {
          g.obj.position.y = floor;
          if (Math.abs(g.vel.y) < 2.5) g.rest = true;
          g.vel.multiplyScalar(0.35).setY(Math.abs(g.vel.y) * 0.3);
          g.spin.multiplyScalar(0.4);
        }
      }
      if (g.age > 14 && !g.obj.userData.going) {
        g.obj.userData.going = true;
        mutation.dissolveOut(g.obj, { duration: 2, colour: this.fluid, done: () => g.obj.removeFromParent() });
      }
      if (g.age > 17) this.gibs.splice(i, 1);
    }
    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const s = this.spurts[i];
      s.left -= dt;
      s.next -= dt;
      if (s.next <= 0 && this.scene) {
        s.next = 0.3;
        const p = this.bodyGroup.localToWorld(s.leg.hip.clone());
        gore.burst(this.scene, { point: p, normal: V(s.leg.side, -0.3, 0).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion())), colour: this.fluid, count: 10, speed: 3 + s.left });
      }
      if (s.left <= 0) this.spurts.splice(i, 1);
    }
  }
}
