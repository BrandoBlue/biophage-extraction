import * as THREE from 'three';
import { BOSSES } from '../../../data';
import { FAUNA, HIVE, ORGANIC } from '../../render/palette';
import { bioNode, chitin, livingFlesh, membrane } from '../../render/materials';
import { mutation } from '../../render/dissolve';
import { gore } from '../../render/gore';
import { merge, needleRing, rng, roughen, spike, taperTube, type Rand } from '../parts';
import { GroundFx, damp, smooth } from './fx';

/**
 * The Sandwidow (data/bosses.json `sandwidow`): mother of every Dunewake, the Ochre Reach boss in the Skyfall
 * Crater. A 25 m segmented sand-swimmer with a body like a dune given muscle: sand-coloured hide in heavy folds,
 * worn bone saddles down the spine, grit pouring off her in sheets when she rises. Her head is a crown of six fused
 * jaw-plates that closes into a blunt bud for swimming and splits open like a flower around a wet pink throat ringed
 * with four pale egg sacs (with Dunewake young curled inside). No neon: sand, bone, the throat.
 *
 * Behaviour is PvE AI's. It moves and yaws `root` (the head's point on the crater floor, +Z forward), sets `ground`,
 * and writes `drive` every frame:
 *   drive.surface  0..1: 0 swims under the sand (only a moving ridge of humps shows), 1 breached: the front rears
 *                  up to `size.surfaceHeight` and the throat sacs are exposed (when the crown is open).
 *   drive.open     0..1, the crown petals spread (the breathe/bite tell).
 *   drive.windup   0..1, the front coils back before the lunge or the eruption.
 *   drive.strike   world point the head lunges at, or null.
 *   drive.look     world point the head tracks, or null.
 *   drive.thrash   0..1, the Drown phase: the body whips side to side.
 *   drive.phase    'circle' | 'erupt' | 'drown' (bookkeeping; the grit and thrash grow each phase).
 * Pulses: breach() throws a ring of sand as she bursts out; blast() is the sand blast from the throat (blind 2 s);
 * call() convulses the egg sacs (spawn Dunewake at `broodPoint`). Damage: popWeakPoint(i) for throat sacs (0..3)
 * and jaw petals (4..9: a petal shears off), hurt(fraction), destroy().
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));

const DEF = BOSSES.sandwidow as unknown as { size?: { length: number; surfaceHeight: number }; weakPoints?: Record<string, { count?: number }> } | undefined;
const LENGTH = DEF?.size?.length ?? 25;
const RISE = DEF?.size?.surfaceHeight ?? 6;
const SACS = Number(DEF?.weakPoints?.throatSacs?.count ?? 4);
const PETALS = Number(DEF?.weakPoints?.jawPetals?.count ?? 6);
const SEGMENTS = 16;
const SPACING = LENGTH / (SEGMENTS + 1);
const WIDTH = 2.3;
const THICK = 1.9;
/** Depth of the spine under the sand while she swims. */
const SWIM_DEPTH = 1.6;

export type WidowPhase = 'circle' | 'erupt' | 'drown';
export interface WidowDrive {
  surface: number;
  open: number;
  windup: number;
  strike: THREE.Vector3 | null;
  look: THREE.Vector3 | null;
  thrash: number;
  phase: WidowPhase;
}
export interface WidowHit {
  tag: 'segment' | 'head' | 'throatSac' | 'petal';
  index: number;
  local: THREE.Vector3; r: number; weak: boolean; world: THREE.Vector3; bone: THREE.Object3D;
}
export interface WidowWeakPoint { tag: 'throatSac' | 'petal'; index: number; mesh: THREE.Object3D; world: THREE.Vector3; radius: number; alive: boolean }

interface Segment { g: THREE.Group; scale: number; depth: number }
interface Petal { hinge: THREE.Group; pivot: THREE.Group; angle: number; alive: boolean; fall: number }

export class Sandwidow {
  readonly root = new THREE.Group();
  readonly drive: WidowDrive = { surface: 0, open: 0, windup: 0, strike: null, look: null, thrash: 0, phase: 'circle' };
  readonly weakPoints: WidowWeakPoint[] = [];
  readonly hitSpheres: WidowHit[] = [];
  /** Where called Dunewake erupt from: in the throat. */
  readonly broodPoint = new THREE.Object3D();
  readonly segments: Segment[] = [];
  /** Ground height under a world point (the crater floor). */
  ground: (x: number, z: number) => number = () => 0;
  private head = new THREE.Group();
  private crown = new THREE.Group();
  private petals: Petal[] = [];
  private sacs: THREE.Group[] = [];
  private throat: THREE.MeshPhysicalMaterial;
  private sacGlow: THREE.MeshStandardMaterial;
  private trail: THREE.Vector3[] = [];
  private fx: GroundFx;
  private rand: Rand;
  private time = 0;
  private health = 1;
  private dead = false;
  private deadFor = 0;
  private started = false;
  private breachT = 0;
  private blastT = 0;
  private callT = 0;
  private hurtT = 0;
  private lastSurface = 0;
  private gritT = 0;
  private lunge = 0;
  private fluid = mix(ORGANIC.vein, FAUNA.sandDeep, 0.3);

  constructor(seed = 1, private scene?: THREE.Object3D) {
    this.rand = rng(seed);
    this.root.name = 'sandwidow';
    // Dune hide: dry, dusty, deep folds; pale worn bone saddles; the throat the only wet thing on her.
    const hide = livingFlesh(mix(FAUNA.sand, FAUNA.ochre, 0.2), mix(FAUNA.sandDeep, ORGANIC.vein, 0.4), FAUNA.dustPale, 2.2);
    hide.clearcoat = 0.05; hide.roughness = 0.92; hide.sheen = 0.4;
    const belly = livingFlesh(mix(FAUNA.dustPale, FAUNA.sand, 0.4), FAUNA.sandDeep, FAUNA.dustPale, 3);
    belly.clearcoat = 0; belly.roughness = 0.95;
    const saddle = chitin(mix(FAUNA.dustPale, FAUNA.sandDeep, 0.25), ORGANIC.amber, 4);
    saddle.roughness = 0.75; saddle.clearcoat = 0.1;
    const petalMat = chitin(mix(FAUNA.dustPale, FAUNA.pearl, 0.3), ORGANIC.amber, 3);
    petalMat.roughness = 0.7; petalMat.clearcoat = 0.15;
    const petalInner = livingFlesh(mix(ORGANIC.wetFlesh, HIVE.bone, 0.25), ORGANIC.vein, ORGANIC.mist, 6);
    this.throat = livingFlesh(mix(ORGANIC.wetFlesh, '#C47A78', 0.4), ORGANIC.vein, ORGANIC.mist, 7);
    const sacSkin = membrane(mix(FAUNA.pearl, ORGANIC.wetFlesh, 0.2), 0.6);
    this.sacGlow = bioNode(mix(ORGANIC.amber, FAUNA.pearl, 0.4), 1.2);
    const tooth = chitin(FAUNA.pearl, ORGANIC.mist, 6);

    // One shared set of segment geometry: a muscular dune of a body, folded hide, and a worn bone saddle.
    const hideGeo = roughen(merge([
      new THREE.SphereGeometry(1, 28, 16).scale(WIDTH, THICK * 0.5, SPACING * 1.2),
      ...[-1, 1].map((sd) => new THREE.SphereGeometry(1, 16, 10).scale(WIDTH * 0.35, THICK * 0.3, SPACING * 0.8).translate(sd * WIDTH * 0.72, -THICK * 0.08, 0)),
    ]), 0.12, 1.4, 3);
    const foldGeo = roughen(new THREE.TorusGeometry(WIDTH * 0.97, 0.22, 8, 30, Math.PI).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, THICK * 0.5 / WIDTH, 1).translate(0, 0, -SPACING * 0.55), 0.08, 2, 5);
    const bellyGeo = roughen(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5).scale(WIDTH * 0.85, THICK * 0.35, SPACING * 0.9).translate(0, -THICK * 0.12, 0), 0.06, 3, 4);
    const saddleGeo = roughen(merge([
      new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.35).scale(WIDTH * 0.55, THICK * 0.42, SPACING * 0.6).translate(0, THICK * 0.18, -SPACING * 0.05),
      spike(0.9, 0.22, -0.5).rotateX(-0.9).translate(0, THICK * 0.55, -SPACING * 0.25),
      ...[-1, 1].map((sd) => spike(0.55, 0.14, -0.4).rotateZ(-sd * 0.9).rotateX(-0.7).translate(sd * WIDTH * 0.42, THICK * 0.42, -SPACING * 0.2)),
    ]), 0.05, 4, 6);
    for (let i = 0; i < SEGMENTS; i++) {
      const g = new THREE.Group();
      g.name = `widowSeg${i}`;
      const scale = i < SEGMENTS - 6 ? 1 - i * 0.012 : 0.88 - (i - (SEGMENTS - 6)) * 0.13;
      // No two segments alike: each swells, leans and twists a little, so the body reads as one animal, not a stack.
      const lump = new THREE.Mesh(hideGeo, hide);
      lump.scale.set(1 + (this.rand() - 0.5) * 0.16, 1 + (this.rand() - 0.5) * 0.22, 1 + (this.rand() - 0.5) * 0.2);
      lump.rotation.set((this.rand() - 0.5) * 0.1, (this.rand() - 0.5) * 0.12, (this.rand() - 0.5) * 0.16);
      g.add(lump);
      const fold = new THREE.Mesh(foldGeo, hide);
      fold.rotation.z = (this.rand() - 0.5) * 0.3;
      g.add(fold);
      g.add(new THREE.Mesh(bellyGeo, belly));
      if (i % 2 === 0 || i < 4) g.add(new THREE.Mesh(saddleGeo, saddle));
      g.scale.setScalar(Math.max(0.2, scale));
      this.root.add(g);
      this.segments.push({ g, scale, depth: SWIM_DEPTH });
      this.hitSpheres.push({ tag: 'segment', index: i, local: V(0, 0, 0), r: WIDTH * 0.85 * scale, weak: false, world: new THREE.Vector3(), bone: g });
    }

    // Head: a thick neck collar of hide, then the crown of six jaw petals around the throat.
    this.head.name = 'widowHead';
    this.root.add(this.head);
    this.head.add(new THREE.Mesh(roughen(new THREE.SphereGeometry(1, 26, 16).scale(WIDTH * 1.1, THICK * 0.6, SPACING * 0.75), 0.1, 1.6, 9), hide));
    this.head.add(new THREE.Mesh(roughen(new THREE.TorusGeometry(WIDTH * 0.95, 0.35, 10, 32).scale(1, 0.85, 1).translate(0, 0, SPACING * 0.45), 0.1, 2, 10), hide));
    this.crown.position.set(0, 0, SPACING * 0.5);
    this.head.add(this.crown);
    // The throat: a wet pink funnel with rings of glassy teeth, receding into the dark.
    const throatGeo = roughen(new THREE.CylinderGeometry(WIDTH * 0.62, WIDTH * 0.3, 2.4, 24, 6, true).rotateX(Math.PI / 2).translate(0, 0, 0.2), 0.08, 2.5, 11);
    const throatMesh = new THREE.Mesh(throatGeo, this.throat);
    (throatMesh.material as THREE.Material).side = THREE.DoubleSide;
    this.crown.add(throatMesh);
    this.crown.add(new THREE.Mesh(new THREE.CircleGeometry(WIDTH * 0.32, 20).translate(0, 0, -0.95), new THREE.MeshStandardMaterial({ color: FAUNA.soot, roughness: 1 })));
    for (let k = 0; k < 3; k++) {
      this.crown.add(new THREE.Mesh(needleRing(WIDTH * (0.58 - k * 0.1), 18 - k * 3, 0.42 - k * 0.08, this.rand, 0.9).rotateX(Math.PI / 2).translate(0, 0, 1.1 - k * 0.55), tooth));
    }
    // Egg sacs: pale translucent bulbs studding the throat rim, each with a curled young and a dim core.
    for (let k = 0; k < SACS; k++) {
      const a = (k / SACS) * Math.PI * 2 + Math.PI / SACS;
      const sac = new THREE.Group();
      sac.name = `throatSac${k}`;
      sac.position.set(Math.cos(a) * WIDTH * 0.48, Math.sin(a) * WIDTH * 0.48, 0.75);
      sac.add(new THREE.Mesh(roughen(new THREE.SphereGeometry(0.42, 16, 12).scale(1, 1, 1.25), 0.03, 6, k), sacSkin));
      const young = new THREE.Mesh(roughen(taperTube([V(0.12, 0.15, -0.1), V(-0.1, 0.1, 0), V(-0.12, -0.12, 0.08), V(0.1, -0.15, 0.1)], [0.11, 0.1, 0.07, 0.03], 7, 3), 0.01, 12, k), petalInner);
      sac.add(young);
      sac.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6).translate(0.08, 0.14, 0.05), this.sacGlow));
      this.crown.add(sac);
      this.sacs.push(sac);
      this.hitSpheres.push({ tag: 'throatSac', index: k, local: V(0, 0, 0), r: 0, weak: true, world: new THREE.Vector3(), bone: sac });
      this.weakPoints.push({ tag: 'throatSac', index: k, mesh: sac, world: new THREE.Vector3(), radius: 0.5, alive: true });
    }
    // Six jaw petals: long curved bone shells, fused into a blunt bud when closed. Each on a hinge at the rim.
    const petalGeo = roughen(merge([
      new THREE.SphereGeometry(1, 16, 12, -0.55, 1.1, 0, Math.PI * 0.5).rotateX(Math.PI / 2).scale(WIDTH * 0.95, WIDTH * 0.95, 3.4).translate(0, -WIDTH * 0.02, 0),
      spike(0.8, 0.2, 0.4).rotateX(Math.PI / 2).translate(0, WIDTH * 0.12, 3.1),
    ]), 0.06, 2.4, 12);
    const petalLining = roughen(new THREE.SphereGeometry(1, 12, 10, -0.5, 1.0, 0, Math.PI * 0.5).rotateX(Math.PI / 2).scale(WIDTH * 0.86, WIDTH * 0.86, 3.1), 0.05, 3, 13);
    for (let k = 0; k < PETALS; k++) {
      const angle = (k / PETALS) * Math.PI * 2;
      const hinge = new THREE.Group();
      hinge.name = `jawPetal${k}`;
      hinge.rotation.z = angle;
      // Pivot on the rim, so the petal swings outward like a flower opening.
      const pivot = new THREE.Group();
      pivot.position.set(-WIDTH * 0.95, 0, 0);
      const petal = new THREE.Group();
      petal.position.set(WIDTH * 0.95, 0, 0);
      petal.add(new THREE.Mesh(petalGeo, petalMat));
      const lining = new THREE.Mesh(petalLining, petalInner);
      lining.material.side = THREE.DoubleSide;
      petal.add(lining);
      // Inner teeth along the petal, following the shell's curve, pointing into the throat.
      for (let j = 0; j < 4; j++) {
        const z = 0.5 + j * 0.65;
        const rr = WIDTH * 0.86 * Math.sqrt(Math.max(0, 1 - Math.pow(z / 3.1, 2)));
        petal.add(new THREE.Mesh(spike(0.45, 0.08, 0.3).rotateZ(-Math.PI / 2).translate(-rr, 0, z), tooth));
      }
      pivot.add(petal);
      hinge.add(pivot);
      this.crown.add(hinge);
      this.petals.push({ hinge, pivot, angle, alive: true, fall: 0 });
      this.hitSpheres.push({ tag: 'petal', index: k, local: V(-WIDTH * 0.6, 0, 1.8), r: 0.9, weak: false, world: new THREE.Vector3(), bone: petal });
      this.weakPoints.push({ tag: 'petal', index: k, mesh: petal, world: new THREE.Vector3(), radius: 0.9, alive: true });
    }
    this.hitSpheres.push({ tag: 'head', index: 0, local: V(0, 0, 0), r: WIDTH * 1.05, weak: false, world: new THREE.Vector3(), bone: this.head });
    this.broodPoint.position.set(0, 0, 0.6);
    this.crown.add(this.broodPoint);
    this.fx = new GroundFx(this.root, { mounds: 28, puffs: 40 });
    this.root.traverse((o) => { o.frustumCulled = false; });
  }

  get alive(): boolean { return !this.dead; }
  get sacsAlive(): number { return this.weakPoints.filter((w) => w.tag === 'throatSac' && w.alive).length; }
  get petalsAlive(): number { return this.weakPoints.filter((w) => w.tag === 'petal' && w.alive).length; }

  /** Lay the body out straight behind the head (call after placing `root`, or the first update does it). */
  plant(): void {
    this.root.updateMatrixWorld(true);
    const head = this.root.getWorldPosition(new THREE.Vector3());
    const back = V(0, 0, -1).transformDirection(this.root.matrixWorld);
    back.y = 0; back.normalize();
    this.trail = [];
    for (let k = 0; k <= SEGMENTS + 2; k++) this.trail.push(head.clone().addScaledVector(back, k * SPACING));
    this.started = true;
  }

  /** She bursts out of the sand: a ring of thrown sand round the head. */
  breach(): void {
    this.breachT = 1;
    const at = this.root.getWorldPosition(new THREE.Vector3());
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const p = at.clone().add(V(Math.cos(a) * WIDTH * 1.4, 0, Math.sin(a) * WIDTH * 1.4));
      p.y = this.ground(p.x, p.z);
      this.fx.puff(p, 1.1 + this.rand() * 0.8, 7);
      if (k % 2 === 0) this.fx.mound(p, 2.2, a, 2.5);
    }
  }

  /** Sand blast from the throat (the 2 s blind). */
  blast(): void {
    this.blastT = 1;
    const at = this.broodPoint.getWorldPosition(new THREE.Vector3());
    const fwd = V(0, 0, 1).transformDirection(this.crown.matrixWorld);
    for (let k = 0; k < 16; k++) this.fx.puff(at.clone().addScaledVector(fwd, 1 + k * 0.7), 0.9 + k * 0.08, 1.5);
  }

  /** The egg sacs convulse: her brood is called (spawn Dunewake at `broodPoint`). */
  call(): void {
    if (this.dead || this.sacsAlive === 0) return;
    this.callT = 1;
    if (this.scene) gore.burst(this.scene, { point: this.broodPoint.getWorldPosition(new THREE.Vector3()), colour: this.fluid, count: 40, speed: 4 });
  }

  /** Burst a throat sac (0..3) or shear off a jaw petal (4..9). */
  popWeakPoint(i: number): void {
    const w = this.weakPoints[i];
    if (!w || !w.alive) return;
    w.alive = false;
    for (const h of this.hitSpheres) if (h.tag === w.tag && h.index === w.index) h.r = 0;
    this.hurtT = 1;
    if (this.scene) gore.burst(this.scene, { point: w.mesh.getWorldPosition(new THREE.Vector3()), colour: this.fluid, count: 70, speed: 7 });
    if (w.tag === 'petal') this.petals[w.index].alive = false;
    else mutation.dissolveOut(w.mesh, { duration: 0.8, colour: this.fluid, done: () => { w.mesh.visible = false; } });
  }

  hurt(fraction: number): void {
    const h = THREE.MathUtils.clamp(1 - fraction, 0, 1);
    if (h < this.health) this.hurtT = 1;
    this.health = h;
  }

  /** Death: she slumps half out of the sand, the crown sags open, the sacs go dark. */
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.deadFor = 0;
    if (this.scene) gore.burst(this.scene, { point: this.root.getWorldPosition(new THREE.Vector3()), colour: this.fluid, count: 200, speed: 10 });
    for (const w of this.weakPoints) if (w.alive && w.tag === 'throatSac') { w.alive = false; mutation.dissolveOut(w.mesh, { duration: 1.5, colour: this.fluid }); }
    for (const h of this.hitSpheres) h.r = 0;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const d = this.drive, t = this.time;
    if (!this.started) this.plant();
    if (this.dead) this.deadFor += dt;
    this.root.updateMatrixWorld(true);
    const headW = this.root.getWorldPosition(new THREE.Vector3());
    // The body follows the head's path through the sand.
    if (this.trail[0].distanceTo(headW) > 0.4) {
      this.trail.unshift(headW.clone());
      let len = 0;
      for (let k = 1; k < this.trail.length; k++) {
        len += this.trail[k].distanceTo(this.trail[k - 1]);
        if (len > LENGTH + SPACING * 3) { this.trail.length = k + 1; break; }
      }
    } else this.trail[0].copy(headW);

    this.breachT = Math.max(0, this.breachT - dt * 0.8);
    this.blastT = Math.max(0, this.blastT - dt * 1.2);
    this.callT = Math.max(0, this.callT - dt * 0.7);
    this.hurtT = Math.max(0, this.hurtT - dt * 1.5);
    const surface = this.dead ? Math.min(1, 0.35 + (1 - Math.min(1, this.deadFor)) * 0.3) : smooth(d.surface);
    if (!this.dead && d.surface - this.lastSurface > 0.25 && this.lastSurface < 0.3) this.breach();
    this.lastSurface = d.surface;
    const thrash = this.dead ? 0 : smooth(d.thrash) + (d.phase === 'drown' ? 0.2 : 0);
    const coil = this.dead ? 0 : smooth(d.windup);
    this.lunge = damp(this.lunge, d.strike && !this.dead ? 1 : 0, d.strike ? 9 : 3, dt);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const rootY = headW.y;

    // Spine: under the sand by default; the swim wave humps it through the surface in a moving ridge. Surfaced,
    // the front rears up in an arc to the rise height, coiled back on the wind-up, thrown forward on the lunge.
    const pts: THREE.Vector3[] = [];
    for (let i = -1; i < SEGMENTS; i++) {
      const dist = (i + 1) * SPACING;
      const p = this.sample(dist).clone();
      const groundY = this.ground(p.x, p.z);
      const k = Math.max(0, i + 1) / SEGMENTS;
      const hump = Math.max(0, Math.sin(t * 1.4 - i * 0.55)) * 1.4 * (1 - surface * 0.6);
      let y = groundY - SWIM_DEPTH + hump;
      const front = Math.max(0, 1 - (i + 1) / 6);
      const arc = Math.sin(front * Math.PI * 0.5);
      y += surface * (SWIM_DEPTH + arc * RISE * (1 - coil * 0.25) + (1 - front) * 0.4 * (i < 9 ? 1 : 0));
      p.applyMatrix4(inv);
      p.y = y - rootY;
      // Coil back, lunge forward, thrash sideways.
      p.z -= coil * front * 2.2;
      p.z += this.lunge * front * 3.5;
      p.x += Math.sin(t * 5.5 - i * 0.7) * thrash * 1.8 * (0.4 + k);
      p.x += Math.sin(t * 0.9 - i * 0.45) * 0.35 * (1 - surface);
      pts.push(p);
    }
    this.segments.forEach((seg, i) => {
      const p = pts[i + 1], ahead = pts[i];
      seg.g.position.copy(p);
      const up = V(0, 1, 0);
      seg.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(ahead, p, up));
      if (this.dead) seg.g.rotation.z += Math.sin(i) * 0.15 * Math.min(1, this.deadFor);
      seg.depth = this.ground(...this.worldXZ(seg.g)) - (p.y + rootY);
    });
    // Head at the front of the spine, nose along the arc; the crown tilts to the look or strike target.
    const h0 = pts[0], h1 = pts[1];
    this.head.position.copy(h0).addScaledVector(h0.clone().sub(h1).normalize(), SPACING * 0.3);
    this.head.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.head.position.clone().add(h0.clone().sub(h1)), this.head.position, V(0, 1, 0)));
    const look = d.strike ?? d.look;
    if (look && !this.dead && surface > 0.3) {
      const lp = this.head.worldToLocal(look.clone());
      const yaw = THREE.MathUtils.clamp(Math.atan2(lp.x, Math.max(0.5, lp.z)), -0.6, 0.6);
      const pitch = THREE.MathUtils.clamp(-Math.atan2(lp.y, Math.hypot(lp.x, lp.z)), -0.7, 0.9);
      this.crown.rotation.set(pitch * surface, yaw * surface, 0);
    } else this.crown.rotation.set(0, 0, 0);
    if (this.dead) this.crown.rotation.x = Math.min(1, this.deadFor) * 0.7;

    // Crown: petals closed into a bud for swimming, split open like a flower to breathe and bite.
    const open = this.dead ? 0.55 : Math.max(smooth(d.open), coil * 0.4, this.blastT, this.callT * 0.7);
    for (const p of this.petals) {
      if (!p.alive) {
        p.fall = Math.min(1, p.fall + dt * 1.5);
        p.pivot.rotation.y = -1.1 - p.fall * 1.2;
        p.pivot.position.z = -p.fall * 2;
        if (p.fall >= 1) p.hinge.visible = false;
        continue;
      }
      const chew = Math.sin(t * 9 + p.angle * 3) * 0.05 * (this.hurtT + this.callT);
      p.pivot.rotation.y = -open * 1.05 - chew;
    }
    // Sacs: exposed only when she is up and open; they throb when she calls.
    const exposed = !this.dead && surface > 0.5 && open > 0.4;
    this.sacs.forEach((s, k) => {
      const alive = this.weakPoints[k].alive;
      const pulse = 1 + Math.sin(t * 3 + k) * 0.04 + this.callT * Math.max(0, Math.sin(t * 18 + k)) * 0.25;
      s.scale.setScalar(pulse);
      for (const h of this.hitSpheres) if (h.tag === 'throatSac' && h.index === k) h.r = alive && exposed ? 0.55 : 0;
    });
    this.sacGlow.emissiveIntensity = this.dead ? 0.02 : 0.5 + this.callT * 1.5 + (exposed ? 0.3 : 0);

    // Sand: grit pours off her as she rises, ripples where the ridge cuts the surface, a spray on the lunge.
    this.gritT -= dt;
    if (this.gritT <= 0) {
      this.gritT = 0.08;
      for (const seg of this.segments) {
        if (Math.abs(seg.depth) < 0.9 && this.rand() < 0.25) {
          const w = seg.g.getWorldPosition(new THREE.Vector3());
          w.y = this.ground(w.x, w.z);
          this.fx.mound(w, WIDTH * 0.9 * seg.scale, this.rand() * 3, 1.8);
          if (this.rand() < 0.5) this.fx.puff(w, 0.6, 1.2, 1.2);
        }
      }
      if (surface > 0.4 && !this.dead) {
        // Sheets of grit falling from the raised front.
        for (let i = 0; i < 4; i++) {
          if (this.rand() > surface * 0.8) continue;
          const w = this.segments[i].g.getWorldPosition(new THREE.Vector3());
          w.x += (this.rand() - 0.5) * WIDTH; w.z += (this.rand() - 0.5) * SPACING;
          this.fx.puff(w, 0.35 + this.rand() * 0.3, -0.5, 1.4);
        }
      }
    }
    this.fx.update(dt);

    this.root.updateMatrixWorld(true);
    for (const h of this.hitSpheres) {
      h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
      // Spheres below the sand cannot be hit.
      if (h.tag === 'segment' && !this.dead) h.r = this.segments[h.index].depth > WIDTH * 0.5 ? 0 : WIDTH * 0.85 * this.segments[h.index].scale;
    }
    for (const w of this.weakPoints) w.mesh.getWorldPosition(w.world);
  }

  private worldXZ(o: THREE.Object3D): [number, number] { const w = o.getWorldPosition(new THREE.Vector3()); return [w.x, w.z]; }

  /** World point on the head's trail `dist` metres behind the head (extrapolated straight past its end). */
  private sample(dist: number): THREE.Vector3 {
    let acc = 0;
    for (let k = 1; k < this.trail.length; k++) {
      const a = this.trail[k - 1], b = this.trail[k];
      const seg = a.distanceTo(b);
      if (acc + seg >= dist && seg > 1e-6) return a.clone().lerp(b, (dist - acc) / seg);
      acc += seg;
    }
    const last = this.trail[this.trail.length - 1], prev = this.trail[Math.max(0, this.trail.length - 2)];
    const dir = last.clone().sub(prev);
    if (dir.lengthSq() < 1e-8) dir.copy(V(0, 0, -1).transformDirection(this.root.matrixWorld));
    return last.clone().addScaledVector(dir.normalize(), dist - acc);
  }
}
