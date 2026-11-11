import * as THREE from 'three';
import { BOSSES } from '../../data';
import { HIVE, ORGANIC } from '../render/palette';
import { bioNode, chitin, livingFlesh } from '../render/materials';
import { mutation } from '../render/dissolve';
import { gore } from '../render/gore';
import { merge, needleRing, rng, roughen, spike, taperTube, type Rand } from './parts';

/**
 * The Warden of the Long Seed (data/bosses.json `warden`): the seedship's gardener, a caretaker grown to tend
 * the embryos the ship carried, now fused with its reactor. A 20 m centipede of overlapping hull plates and roots
 * that moves along walls and ceiling as easily as the floor. Its head is a cluster of glass seed-pods, each with a
 * dormant embryo inside that twitches when it is hurt. Coolant pipes run through its body; it glows only where the
 * reactor shows through cracked plates. Weathered plate and wet root, no neon.
 *
 * Behaviour is PvE AI's. It moves and orients `root` (the head, on the surface; local +Y is away from the surface,
 * +Z forward) and writes `drive` every frame:
 *   drive.windup     0..1, the root-spear tell (the head rears back and the mandibles spread)
 *   drive.strike     world point the spear thrusts at, or null
 *   drive.rear       0..1, the front third lifts off the surface
 *   drive.look       world point the head tracks, or null
 *   drive.phase      'tend' | 'overheat' | 'meltdown' (the reactor shows more each phase)
 *   drive.surface    'floor' | 'wall' | 'ceiling' (for the AI's bookkeeping; the body follows root's up)
 *   drive.up         surface normal; when set, the root's up eases toward it so the head settles onto the surface
 *   drive.seamsOpen  4 values 0..1: reactor seam plates lift and expose the seam (weak points 5..8)
 * The body follows the head's trail, so it bends round corners and up walls the way the head went.
 * One-shot pulses: steam(i) bursts coolant at seam i, birth() makes the pods convulse and births embryos
 * (spawn at `birthPoint`), pulse() is the meltdown reactor pulse. Damage: popWeakPoint(i) for seed pods (0..4)
 * and reactor seams (5..8), hurt(fraction), destroy().
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));
const smooth = (t: number) => { const k = THREE.MathUtils.clamp(t, 0, 1); return k * k * (3 - 2 * k); };
const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));

const DEF = BOSSES.warden as unknown as { size?: { length: number; height: number }; weakPoints?: Record<string, { count?: number }> } | undefined;
const LENGTH = DEF?.size?.length ?? 20;
const HEIGHT = DEF?.size?.height ?? 3;
const PODS = Number(DEF?.weakPoints?.seedPods?.count ?? 5);
const SEAMS = Number(DEF?.weakPoints?.reactorSeams?.count ?? 4);
const SEGMENTS = 14;
const SPACING = LENGTH / (SEGMENTS + 1);
const RIDE = HEIGHT * 0.42; // spine height above the surface
const WIDTH = HEIGHT * 0.55;
/** Which segments carry the reactor seams (middle of the body). */
const SEAM_SEGS = Array.from({ length: SEAMS }, (_, i) => 3 + i * 2);

export type WardenPhase = 'tend' | 'overheat' | 'meltdown';
export type WardenSurface = 'floor' | 'wall' | 'ceiling';
export interface WardenDrive {
  windup: number;
  strike: THREE.Vector3 | null;
  rear: number;
  look: THREE.Vector3 | null;
  phase: WardenPhase;
  surface: WardenSurface;
  up: THREE.Vector3 | null;
  seamsOpen: number[];
}

export interface WardenHit {
  tag: 'plate' | 'segment' | 'seedPod' | 'reactorSeam' | 'head';
  index: number;
  local: THREE.Vector3; r: number; weak: boolean; world: THREE.Vector3; bone: THREE.Object3D;
}
export interface WardenWeakPoint { tag: 'seedPod' | 'reactorSeam'; index: number; mesh: THREE.Object3D; world: THREE.Vector3; radius: number; alive: boolean }

interface Segment {
  g: THREE.Group; scale: number;
  legs: { side: number; upper: THREE.Mesh; phase: number }[];
  seam?: { i: number; halves: THREE.Object3D[]; core: THREE.Mesh };
}
interface Pod { shell: THREE.Group; embryo: THREE.Object3D; rest: THREE.Vector3 }

export class Warden {
  readonly root = new THREE.Group();
  readonly drive: WardenDrive = { windup: 0, strike: null, rear: 0, look: null, phase: 'tend', surface: 'floor', up: null, seamsOpen: new Array(SEAMS).fill(0) };
  readonly weakPoints: WardenWeakPoint[] = [];
  readonly hitSpheres: WardenHit[] = [];
  /** Where birthed embryos (Oculimoths) emerge: between the seed pods. */
  readonly birthPoint = new THREE.Object3D();
  readonly segments: Segment[] = [];
  private head = new THREE.Group();
  private pods: Pod[] = [];
  private mandibles: THREE.Object3D[] = [];
  private spear: THREE.Mesh;
  private trail: { p: THREE.Vector3; up: THREE.Vector3 }[] = [];
  private time = 0;
  private health = 1;
  private dead = false;
  private started = false;
  private hurtT = 0;
  private birthT = 0;
  private pulseT = 0;
  private steamPuffs: { obj: THREE.Mesh; age: number; v: THREE.Vector3 }[] = [];
  private rand: Rand;
  private reactor: THREE.MeshStandardMaterial;
  private seamMat: THREE.MeshStandardMaterial;
  private steamMat: THREE.MeshStandardMaterial;
  private fluid = mix(ORGANIC.vein, ORGANIC.amber, 0.25);

  constructor(seed = 1, private scene?: THREE.Object3D) {
    this.rand = rng(seed);
    this.root.name = 'warden';
    const reactorHue = mix(ORGANIC.amber, HIVE.danger, 0.35);
    // Hull plate: weathered, mineral-dark bone with a faint amber stain in its relief, no shine.
    const plateMat = chitin(mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.8), ORGANIC.amber, 3);
    // Old hull, not lacquer: matte, pitted, barely a sheen.
    plateMat.roughness = 0.62; plateMat.clearcoat = 0.2; plateMat.clearcoatRoughness = 0.5;
    const plateEdge = chitin(mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.45), ORGANIC.amber, 6);
    const belly = livingFlesh(mix(ORGANIC.wetFleshDeep, ORGANIC.wetFlesh, 0.35), ORGANIC.vein, ORGANIC.mist, 3);
    const root = livingFlesh(mix(ORGANIC.wetFleshDeep, HIVE.bone, 0.2), ORGANIC.vein, ORGANIC.mist, 6);
    const pipe = chitin(mix(HIVE.bone, ORGANIC.mist, 0.35), ORGANIC.mist, 8);
    this.reactor = bioNode(reactorHue, 1.4);
    this.seamMat = bioNode(mix(reactorHue, HIVE.bone, 0.2), 3);
    this.steamMat = new THREE.MeshStandardMaterial({ color: mix(ORGANIC.mist, HIVE.bone, 0.5), transparent: true, opacity: 0.16, roughness: 1, depthWrite: false });

    // Shared segment geometry (one set for the whole body keeps the draw cost flat).
    // Each segment's armour: a broad hull plate with two narrower plates shingled over it, pitted and chipped.
    const plateGeo = merge([
      roughen(new THREE.SphereGeometry(1, 30, 12, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(WIDTH * 1.05, HEIGHT * 0.22, SPACING * 0.8).translate(0, RIDE * 0.55, 0), 0.03, 10, 2),
      ...[-1, 1].map((sd) => roughen(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(WIDTH * 0.42, HEIGHT * 0.12, SPACING * 0.62).rotateZ(-sd * 0.35).translate(sd * WIDTH * 0.6, RIDE * 0.55 + HEIGHT * 0.1, -SPACING * 0.12), 0.02, 12, 3 + sd)),
      roughen(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(WIDTH * 0.3, HEIGHT * 0.1, SPACING * 0.55).translate(0, RIDE * 0.55 + HEIGHT * 0.17, -SPACING * 0.2), 0.02, 12, 5),
    ]);
    const ridgeGeo = roughen(merge([
      new THREE.TorusGeometry(WIDTH * 1.04, 0.1, 6, 28, Math.PI).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, HEIGHT * 0.22 / WIDTH, 1).translate(0, RIDE * 0.55, -SPACING * 0.62),
      spike(0.7, 0.14, 0.6).rotateX(-0.6).translate(0, RIDE * 0.55 + HEIGHT * 0.26, -SPACING * 0.3),
      ...[-1, 1].map((sd) => spike(0.55, 0.1, 0.7).rotateZ(-sd * 1.2).rotateX(-0.4).translate(sd * WIDTH * 0.98, RIDE * 0.5, -SPACING * 0.4)),
    ]), 0.02, 6, 3);
    const crackGeo = new THREE.TorusGeometry(WIDTH * 1.0, 0.08, 5, 28, Math.PI).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, HEIGHT * 0.2 / WIDTH, 1).translate(0, RIDE * 0.56, -SPACING * 0.74);
    const bellyGeo = roughen(new THREE.SphereGeometry(1, 18, 12).scale(WIDTH * 0.8, HEIGHT * 0.22, SPACING * 0.65).translate(0, RIDE * 0.3, 0), 0.03, 4, 4);
    const pipeGeo = merge([-1, 1].map((sd) => merge([
      taperTube([V(sd * WIDTH * 0.92, RIDE * 0.5, SPACING * 0.5), V(sd * WIDTH * 1.0, RIDE * 0.52, 0), V(sd * WIDTH * 0.92, RIDE * 0.5, -SPACING * 0.5)], [0.11, 0.12, 0.11], 8, 4),
      new THREE.TorusGeometry(0.15, 0.04, 6, 12).translate(sd * WIDTH * 1.0, RIDE * 0.52, 0),
    ])));
    const legGeo = roughen(merge([
      taperTube([V(0, 0, 0), V(0.7, 0.55, 0.05), V(1.5, 0.1, 0.15), V(1.75, -RIDE * 0.55, 0.3)], [0.17, 0.14, 0.09, 0.03], 7, 4),
      ...[0, 1, 2].map((k) => taperTube([V(1.7, -RIDE * 0.45, 0.25), V(1.8 + k * 0.1 - 0.1, -RIDE * 0.55, 0.4 + (k - 1) * 0.2)], [0.03, 0.008], 4, 2)),
    ]), 0.015, 9, 5);
    const rootsGeo = merge(Array.from({ length: 5 }, (_, k) => {
      const x = (k - 2) * WIDTH * 0.3, l = 0.5 + this.rand() * 0.6;
      return taperTube([V(x, RIDE * 0.15, 0.2), V(x * 1.1, RIDE * 0.05 - l * 0.4, -0.2), V(x * 1.2, RIDE * 0.05 - l, -0.5)], [0.05, 0.03, 0.006], 5, 3);
    }));

    for (let i = 0; i < SEGMENTS; i++) {
      const g = new THREE.Group();
      g.name = `wardenSeg${i}`;
      // The tail tapers over its last five segments.
      const scale = i < SEGMENTS - 5 ? 1 - i * 0.008 : 0.92 - (i - (SEGMENTS - 5)) * 0.13;
      const seamIdx = SEAM_SEGS.indexOf(i);
      const seg: Segment = { g, scale, legs: [] };
      if (seamIdx >= 0) {
        // A seam segment: its plate is split down the spine; the halves lift to show the reactor seam inside.
        const halves: THREE.Object3D[] = [];
        for (const sd of [-1, 1]) {
          const hinge = new THREE.Group();
          hinge.position.set(0, RIDE * 0.55, 0);
          const half = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10, sd > 0 ? 0 : Math.PI, Math.PI, 0, Math.PI * 0.5).scale(WIDTH * 1.05, HEIGHT * 0.22, SPACING * 0.8), plateMat);
          hinge.add(half);
          g.add(hinge);
          halves.push(hinge);
        }
        const core = new THREE.Mesh(roughen(new THREE.SphereGeometry(1, 16, 10).scale(WIDTH * 0.35, HEIGHT * 0.12, SPACING * 0.5), 0.03, 6, i), this.seamMat);
        core.position.set(0, RIDE * 0.62, 0);
        g.add(core);
        seg.seam = { i: seamIdx, halves, core };
      } else g.add(new THREE.Mesh(plateGeo, plateMat));
      g.add(new THREE.Mesh(ridgeGeo, plateEdge));
      g.add(new THREE.Mesh(crackGeo, this.reactor));
      g.add(new THREE.Mesh(bellyGeo, belly));
      g.add(new THREE.Mesh(pipeGeo, pipe));
      if (i % 2 === 1) g.add(new THREE.Mesh(rootsGeo, root));
      for (const sd of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, root);
        leg.position.set(sd * WIDTH * 0.7, RIDE * 0.35, 0);
        if (sd < 0) leg.rotation.y = Math.PI; // mirror by turning, never a negative scale (winding)
        g.add(leg);
        seg.legs.push({ side: sd, upper: leg, phase: i * 0.55 + (sd > 0 ? Math.PI : 0) });
      }
      g.scale.setScalar(scale);
      this.root.add(g);
      this.segments.push(seg);
      this.hitSpheres.push({ tag: 'plate', index: i, local: V(0, RIDE * 0.75, 0), r: WIDTH * 0.95 * scale, weak: false, world: new THREE.Vector3(), bone: g });
      this.hitSpheres.push({ tag: 'segment', index: i, local: V(0, RIDE * 0.15, 0), r: WIDTH * 0.6 * scale, weak: false, world: new THREE.Vector3(), bone: g });
      if (seg.seam) {
        this.hitSpheres.push({ tag: 'reactorSeam', index: seamIdx, local: V(0, RIDE * 0.7, 0), r: 0, weak: true, world: new THREE.Vector3(), bone: g });
      }
    }

    // Head: a heavy plate cowl over a root-mandible mouth, crowned with the glass seed pods.
    this.head.name = 'wardenHead';
    this.root.add(this.head);
    this.head.add(new THREE.Mesh(roughen(new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(WIDTH * 1.2, HEIGHT * 0.42, SPACING * 1.1).translate(0, RIDE * 0.5, 0.2), 0.05, 3, 7), plateMat));
    this.head.add(new THREE.Mesh(roughen(new THREE.SphereGeometry(1, 18, 12).scale(WIDTH * 0.85, HEIGHT * 0.26, SPACING * 0.9).translate(0, RIDE * 0.32, 0.4), 0.04, 4, 8), belly));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const m = new THREE.Group();
      m.position.set(Math.cos(a) * WIDTH * 0.45, RIDE * 0.32 + Math.sin(a) * HEIGHT * 0.15, SPACING * 1.1);
      m.add(new THREE.Mesh(roughen(spike(1.1, 0.13, 0.9).rotateX(Math.PI / 2 - 0.3).rotateZ(a - Math.PI / 2), 0.02, 6, k), plateEdge));
      this.head.add(m);
      this.mandibles.push(m);
    }
    this.head.add(new THREE.Mesh(needleRing(WIDTH * 0.42, 14, 0.25, this.rand, 0.9).rotateX(Math.PI / 2).translate(0, RIDE * 0.32, SPACING * 1.2), plateEdge));
    // The root spear: coiled in the throat, thrust out on the strike.
    this.spear = new THREE.Mesh(roughen(merge([
      taperTube([V(0, 0, 0), V(0.05, 0.1, 2), V(0, 0, 4)], [0.14, 0.1, 0.05], 7, 8),
      spike(0.7, 0.12, 0.1).rotateX(Math.PI / 2).translate(0, 0, 4),
    ]), 0.015, 8, 9), root);
    this.spear.position.set(0, RIDE * 0.32, SPACING * 0.9);
    this.spear.scale.set(1, 1, 0.05);
    this.head.add(this.spear);
    // Seed pods: glass shells, each with an embryo of some never-born thing curled inside.
    const glass = new THREE.MeshPhysicalMaterial({ color: mix(HIVE.bone, ORGANIC.mist, 0.4), transparent: true, opacity: 0.3, roughness: 0.08, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
    const embryoMat = livingFlesh(mix(ORGANIC.wetFlesh, HIVE.bone, 0.35), ORGANIC.vein, ORGANIC.amber, 14);
    const podGlow = bioNode(mix(ORGANIC.amber, HIVE.bone, 0.3), 1.6);
    for (let k = 0; k < PODS; k++) {
      const a = -0.9 + (k / Math.max(1, PODS - 1)) * 1.8;
      const rest = V(Math.sin(a) * WIDTH * 0.75, RIDE * 0.5 + HEIGHT * 0.38 + Math.cos(a * 1.4) * 0.25, 0.1 - Math.abs(a) * 0.4);
      const shell = new THREE.Group();
      shell.name = `seedPod${k}`;
      shell.position.copy(rest);
      shell.rotation.set(-0.5, 0, -a * 0.6);
      shell.add(new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 14).scale(1, 1.5, 1), glass));
      // A root stalk anchoring the pod into the cowl.
      shell.add(new THREE.Mesh(taperTube([V(0, -0.7, 0), V(0, -1.0, 0.1), V(0, -1.35, 0)], [0.12, 0.14, 0.2], 6, 3), root));
      const embryo = new THREE.Group();
      embryo.add(new THREE.Mesh(roughen(merge([
        taperTube([V(0, 0.3, 0), V(0.18, 0.1, 0.08), V(0.1, -0.2, 0.1), V(-0.12, -0.25, 0), V(-0.1, -0.05, -0.05)], [0.16, 0.13, 0.1, 0.06, 0.03], 8, 4),
        new THREE.SphereGeometry(0.17, 12, 10).translate(0, 0.33, 0.02),
      ]), 0.01, 20, k), embryoMat));
      embryo.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6).translate(0.07, 0.36, 0.14), podGlow));
      shell.add(embryo);
      this.head.add(shell);
      this.pods.push({ shell, embryo, rest });
      this.hitSpheres.push({ tag: 'seedPod', index: k, local: V(0, 0, 0), r: 0.55, weak: true, world: new THREE.Vector3(), bone: shell });
      this.weakPoints.push({ tag: 'seedPod', index: k, mesh: shell, world: new THREE.Vector3(), radius: 0.55, alive: true });
    }
    for (const s of this.segments) if (s.seam) {
      this.weakPoints.push({ tag: 'reactorSeam', index: s.seam.i, mesh: s.seam.core, world: new THREE.Vector3(), radius: WIDTH * 0.45, alive: true });
    }
    this.hitSpheres.push({ tag: 'head', index: 0, local: V(0, RIDE * 0.45, 0.4), r: WIDTH * 0.95, weak: false, world: new THREE.Vector3(), bone: this.head });
    this.birthPoint.position.set(0, RIDE + HEIGHT * 0.5, 0);
    this.head.add(this.birthPoint);
    this.root.traverse((o) => { o.frustumCulled = false; });
  }

  get alive(): boolean { return !this.dead; }
  get podsAlive(): number { return this.weakPoints.filter((w) => w.tag === 'seedPod' && w.alive).length; }
  get seamsAlive(): number { return this.weakPoints.filter((w) => w.tag === 'reactorSeam' && w.alive).length; }

  /** Lay the body out straight behind the head (call after placing `root`, or the first update does it). */
  plant(): void {
    this.root.updateMatrixWorld(true);
    const head = this.root.getWorldPosition(new THREE.Vector3());
    const back = V(0, 0, -1).transformDirection(this.root.matrixWorld);
    const up = V(0, 1, 0).transformDirection(this.root.matrixWorld);
    this.trail = [];
    for (let k = 0; k <= SEGMENTS + 2; k++) this.trail.push({ p: head.clone().addScaledVector(back, k * SPACING), up: up.clone() });
    this.started = true;
  }

  /** A burst of coolant steam from seam i (a valve vented beside it). */
  steam(i: number): void {
    const seg = this.segments.find((s) => s.seam?.i === i);
    if (!seg) return;
    for (let k = 0; k < 7; k++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), this.steamMat);
      puff.position.set((this.rand() - 0.5) * WIDTH, RIDE * 0.8, (this.rand() - 0.5) * SPACING * 0.6);
      puff.frustumCulled = false;
      seg.g.add(puff);
      this.steamPuffs.push({ obj: puff, age: 0, v: V((this.rand() - 0.5) * 2, 3 + this.rand() * 2, (this.rand() - 0.5) * 2) });
    }
  }

  /** The pods convulse and the embryos are born (spawn the swarm at `birthPoint`). */
  birth(): void {
    if (this.dead || this.podsAlive === 0) return;
    this.birthT = 1;
    if (this.scene) gore.burst(this.scene, { point: this.birthPoint.getWorldPosition(new THREE.Vector3()), colour: this.fluid, count: 50, speed: 4 });
  }

  /** The meltdown reactor pulse: every crack flares and the body convulses. */
  pulse(): void { this.pulseT = 1; }

  /** Shatter a seed pod (0..4) or burst a reactor seam (5..8). */
  popWeakPoint(i: number): void {
    const w = this.weakPoints[i];
    if (!w || !w.alive) return;
    w.alive = false;
    for (const h of this.hitSpheres) if (h.tag === w.tag && h.index === w.index) h.r = 0;
    this.hurtT = 1;
    if (this.scene) gore.burst(this.scene, { point: w.mesh.getWorldPosition(new THREE.Vector3()), colour: this.fluid, count: 70, speed: 7 });
    mutation.dissolveOut(w.mesh, { duration: 0.8, colour: this.fluid, done: () => { w.mesh.visible = false; } });
  }

  hurt(fraction: number): void {
    const h = THREE.MathUtils.clamp(1 - fraction, 0, 1);
    if (h < this.health) this.hurtT = 1;
    this.health = h;
  }

  /** Death: the reactor gutters out, the roots wither, the plates stay as a husk. */
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.scene) gore.burst(this.scene, { point: this.root.getWorldPosition(new THREE.Vector3()), colour: this.fluid, count: 200, speed: 10 });
    for (const w of this.weakPoints) if (w.alive) { w.alive = false; mutation.dissolveOut(w.mesh, { duration: 1.5, colour: this.fluid }); }
    for (const h of this.hitSpheres) h.r = 0;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const d = this.drive, t = this.time;
    if (!this.started) this.plant();
    // Ease the head onto the surface it is clinging to.
    if (d.up && !this.dead) {
      const cur = V(0, 1, 0).applyQuaternion(this.root.quaternion);
      const q = new THREE.Quaternion().setFromUnitVectors(cur, d.up.clone().normalize());
      this.root.quaternion.premultiply(new THREE.Quaternion().slerp(q, 1 - Math.exp(-4 * dt)));
    }
    this.root.updateMatrixWorld(true);
    const headW = this.root.getWorldPosition(new THREE.Vector3());
    const upW = V(0, 1, 0).transformDirection(this.root.matrixWorld);
    // Record the head's path; the body follows it segment by segment.
    if (this.trail.length === 0 || this.trail[0].p.distanceTo(headW) > 0.2) {
      this.trail.unshift({ p: headW.clone(), up: upW.clone() });
      let len = 0;
      for (let k = 1; k < this.trail.length; k++) {
        len += this.trail[k].p.distanceTo(this.trail[k - 1].p);
        if (len > LENGTH + SPACING * 3) { this.trail.length = k + 1; break; }
      }
    } else { this.trail[0].p.copy(headW); this.trail[0].up.copy(upW); }

    this.hurtT = Math.max(0, this.hurtT - dt * 1.5);
    this.birthT = Math.max(0, this.birthT - dt * 0.8);
    this.pulseT = Math.max(0, this.pulseT - dt * 0.6);
    const phaseK = d.phase === 'tend' ? 0 : d.phase === 'overheat' ? 1 : 2;
    // The reactor shows a little more each phase, and throbs in the meltdown.
    const throb = phaseK === 2 ? 0.5 + 0.5 * Math.pow(Math.max(0, Math.sin(t * 2.2)), 3) : 0;
    this.reactor.emissiveIntensity = this.dead ? 0.02 : (0.55 + phaseK * 0.5 + throb * 0.8 + this.pulseT * 2.5) * (0.6 + 0.4 * this.health);
    this.seamMat.emissiveIntensity = this.dead ? 0.02 : 1.0 + phaseK * 0.6 + this.pulseT * 2;

    // Body segments along the trail (in root space), with a slow slither and leg ripple.
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const speedShiver = this.pulseT * 0.05 + (phaseK === 2 ? 0.015 : 0);
    const rear = this.dead ? 0 : smooth(d.rear) + smooth(d.windup) * 0.4;
    this.segments.forEach((seg, i) => {
      const dist = (i + 1) * SPACING;
      const a = this.sample(dist), b = this.sample(dist - SPACING * 0.5);
      const p = a.p.clone().applyMatrix4(inv), ahead = b.p.clone().applyMatrix4(inv);
      const up = a.up.clone().transformDirection(inv);
      // The front third lifts with the rear (a centipede rearing at you).
      const lift = rear * Math.max(0, 1 - i / 5) * HEIGHT * 0.9;
      p.addScaledVector(up, lift + (this.dead ? -RIDE * 0.4 : 0));
      ahead.addScaledVector(up, rear * Math.max(0, 1 - (i - 0.5) / 5) * HEIGHT * 0.9);
      const side = Math.sin(t * 1.3 - i * 0.6) * 0.12 * (this.dead ? 0 : 1);
      seg.g.position.copy(p).add(V(side, 0, 0)).add(V((Math.random() - 0.5) * speedShiver, 0, 0));
      const m = new THREE.Matrix4().lookAt(ahead, p, up);
      seg.g.quaternion.setFromRotationMatrix(m);
      for (const l of seg.legs) {
        const ph = t * 4 + l.phase;
        l.upper.rotation.z = (this.dead ? -0.6 : Math.sin(ph) * 0.25) * l.side * (l.side < 0 ? -1 : 1);
        l.upper.rotation.x = this.dead ? 0 : Math.max(0, Math.sin(ph)) * 0.2;
      }
      if (seg.seam) {
        const open = this.dead ? 0 : smooth(d.seamsOpen[seg.seam.i] ?? 0);
        seg.seam.halves.forEach((h, k) => { h.rotation.z = (k === 0 ? 1 : -1) * open * 0.9; });
        const alive = this.weakPoints.find((w) => w.tag === 'reactorSeam' && w.index === seg.seam!.i)?.alive ?? false;
        for (const h of this.hitSpheres) if (h.tag === 'reactorSeam' && h.index === seg.seam.i) h.r = alive && open > 0.3 ? WIDTH * 0.45 * seg.scale : 0;
      }
    });

    // Head: rear for the tell, aim the spear, spread the mandibles, embryos twitch when hurt.
    const look = d.strike ?? d.look;
    this.head.rotation.set(0, 0, 0);
    this.head.position.set(0, rear * HEIGHT * 0.9, 0);
    if (look && !this.dead) {
      const lp = this.root.worldToLocal(look.clone());
      const yaw = Math.atan2(lp.x, Math.max(0.1, lp.z));
      const pitch = -Math.atan2(lp.y - this.head.position.y, Math.hypot(lp.x, lp.z));
      this.head.rotation.set(THREE.MathUtils.clamp(pitch, -0.8, 0.6), THREE.MathUtils.clamp(yaw, -0.9, 0.9), 0);
    }
    this.head.rotation.x -= smooth(d.windup) * 0.5;
    const spread = smooth(d.windup) + this.birthT * 0.5;
    this.mandibles.forEach((m, k) => { m.rotation.set(Math.sin(t * 3 + k) * 0.05, 0, 0); m.scale.setScalar(1 + spread * 0.25); });
    const target = d.strike && !this.dead ? 1 : 0;
    this.spear.scale.z = damp(this.spear.scale.z, 0.05 + target * 0.95, target ? 18 : 4, dt);
    this.pods.forEach((p, k) => {
      const tw = (this.hurtT + this.birthT) * Math.sin(t * (30 + k * 7));
      p.embryo.rotation.set(tw * 0.4, Math.sin(t * 0.3 + k) * 0.2, tw * 0.3);
      p.shell.position.copy(p.rest).add(V(0, this.birthT * Math.sin(t * 20 + k) * 0.06, 0));
    });

    for (const s of this.steamPuffs) {
      s.age += dt;
      s.obj.position.addScaledVector(s.v, dt);
      s.obj.scale.setScalar(1 + s.age * 3);
    }
    this.steamMat.opacity = 0.3;
    this.steamPuffs = this.steamPuffs.filter((s) => { if (s.age > 1.6) { s.obj.parent?.remove(s.obj); return false; } return true; });

    this.root.updateMatrixWorld(true);
    for (const h of this.hitSpheres) h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
    for (const w of this.weakPoints) w.mesh.getWorldPosition(w.world);
  }

  /** Point on the head's trail `dist` metres behind the head (extrapolated straight past its end). */
  private sample(dist: number): { p: THREE.Vector3; up: THREE.Vector3 } {
    let acc = 0;
    for (let k = 1; k < this.trail.length; k++) {
      const a = this.trail[k - 1], b = this.trail[k];
      const seg = a.p.distanceTo(b.p);
      if (acc + seg >= dist && seg > 1e-6) {
        const f = (dist - acc) / seg;
        return { p: a.p.clone().lerp(b.p, f), up: a.up.clone().lerp(b.up, f).normalize() };
      }
      acc += seg;
    }
    const last = this.trail[this.trail.length - 1], prev = this.trail[Math.max(0, this.trail.length - 2)];
    const dir = last.p.clone().sub(prev.p);
    if (dir.lengthSq() < 1e-8) dir.copy(V(0, 0, -1).transformDirection(this.root.matrixWorld));
    return { p: last.p.clone().addScaledVector(dir.normalize(), dist - acc), up: last.up.clone() };
  }
}
