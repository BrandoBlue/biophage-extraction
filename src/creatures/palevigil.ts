import * as THREE from 'three';
import { BOSSES } from '../../data';
import { HIVE, ORGANIC } from '../render/palette';
import { bioNode, chitin, livingFlesh } from '../render/materials';
import { mutation } from '../render/dissolve';
import { gore } from '../render/gore';
import { solveTwoBone } from './ik';
import { merge, rng, roughen, spike, taperTube, type Rand } from './parts';
import { meshSdf, type SdfPrim } from './sdf';

/**
 * The Pale Vigil (data/bosses.json `paleVigil`): a 7 m, starvation-thin thing that hangs upside down from the
 * fungal-cave ceiling on four long jointed limbs. Its body is a pale, translucent sack of folded skin with slow
 * organs visible inside; from its chest a 4 m stalk hangs a soft, warm lure at head height, the only light on it.
 * No face: a vertical slit that opens to the ribs when it shrieks. Anglerfish, harvestman, cave weta, a hanged coat.
 *
 * Behaviour is PvE AI's. `root` sits on whatever surface it clings to (ceiling or floor): local +Y points away
 * from the surface, +Z forward. On the ceiling, turn root upside down and the body hangs beneath its limbs.
 *   drive.windup    0..1, the tell: the lure goes still and the body draws in
 *   drive.strike    world point the front limb snatches at, or null
 *   drive.rear      0..1, rears up to shriek (spines stand out, the slit opens)
 *   drive.look      world point the body turns toward, or null
 *   drive.phase     'hang' | 'stalk' | 'unravel' (unravel: the skin visibly splits)
 *   drive.hanging   0..1, folded tight against the surface (1) or unfolded on long limbs (0)
 *   drive.lureGlow  0..1, the lure's light
 *   drive.dim       0..1, the silhouette darkens until it is nearly gone
 * The lure stalk hangs under real gravity whichever way up it is. Pulses: shriek(). Damage: popWeakPoint(i)
 * (0 = lure, 1..3 = spines), severLimb(i) / sever('limbN'), hurt(fraction), destroy().
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));
const smooth = (t: number) => { const k = THREE.MathUtils.clamp(t, 0, 1); return k * k * (3 - 2 * k); };
const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));

const DEF = BOSSES.paleVigil as unknown as { size?: { height: number; limbSpan: number; lureLength: number }; weakPoints?: { spines?: { count: number }; limbs?: { count: number } } } | undefined;
const HEIGHT = DEF?.size?.height ?? 7;
const SPAN = DEF?.size?.limbSpan ?? 9;
const LURE = DEF?.size?.lureLength ?? 4;
const SPINES = DEF?.weakPoints?.spines?.count ?? 3;
const LIMBS = DEF?.weakPoints?.limbs?.count ?? 4;
const L1 = SPAN * 0.4, L2 = SPAN * 0.42;
/** Shoulder height off the surface, unfolded and folded. */
const BODY_OPEN = 2.4, BODY_FOLDED = 1.1;
const LURE_LINKS = 10;

export type VigilPhase = 'hang' | 'stalk' | 'unravel';
export interface VigilDrive {
  windup: number; strike: THREE.Vector3 | null; rear: number; look: THREE.Vector3 | null;
  phase: VigilPhase; hanging: number; lureGlow: number; dim: number;
}
export interface VigilHit {
  tag: 'body' | 'lure' | 'spine' | 'limb';
  index: number;
  local: THREE.Vector3; r: number; weak: boolean; world: THREE.Vector3; bone: THREE.Object3D;
  limb?: string;
}
export interface VigilWeakPoint { tag: 'lure' | 'spine'; index: number; mesh: THREE.Object3D; world: THREE.Vector3; radius: number; alive: boolean }

interface Limb { i: number; hip: THREE.Object3D; upper: THREE.Object3D; lower: THREE.Object3D; angle: number; severed: boolean; foot: THREE.Vector3 }

function sackPrims(): SdfPrim[] {
  // A hanged coat: narrow shoulders near the surface, the sack sagging away from it, folds pinched in.
  const pale = new THREE.Color(1, 1, 1), fold = new THREE.Color(0.78, 0.74, 0.74);
  const p: SdfPrim[] = [
    { shape: 'ellipsoid', a: V(0, BODY_OPEN, 0), radii: V(0.62, 0.4, 0.45), bone: 0, tint: pale },
    { shape: 'cone', a: V(0, BODY_OPEN + 0.2, 0), b: V(0, BODY_OPEN + 2.2, 0.05), ra: 0.42, rb: 0.5, blend: 0.35, bone: 0, ribs: { freq: 5.5, depth: 0.07 } },
    { shape: 'cone', a: V(0, BODY_OPEN + 2.2, 0.05), b: V(0.05, HEIGHT - 1.3, 0.15), ra: 0.5, rb: 0.78, blend: 0.4, bone: 0, ribs: { freq: 2.4, depth: 0.05 }, tint: fold },
    { shape: 'ellipsoid', a: V(0.05, HEIGHT - 1.25, 0.15), radii: V(0.78, 0.7, 0.62), blend: 0.45, bone: 0, tint: fold },
    { shape: 'cone', a: V(0.05, HEIGHT - 0.8, 0.12), b: V(0.18, HEIGHT, -0.05), ra: 0.42, rb: 0.08, blend: 0.35, bone: 0 },
  ];
  // Pinched folds hanging down the sack, like cloth.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    p.push({ shape: 'cone', a: V(Math.cos(a) * 0.5, BODY_OPEN + 1.2, Math.sin(a) * 0.42), b: V(Math.cos(a) * 0.82, HEIGHT - 1.3, Math.sin(a) * 0.7), ra: 0.05, rb: 0.1, subtract: true, blend: 0.2, bone: 0 });
  }
  // The slit down the chest front.
  p.push({ shape: 'cone', a: V(0, BODY_OPEN + 1.0, 0.5), b: V(0, HEIGHT - 1.6, 0.8), ra: 0.05, rb: 0.07, subtract: true, blend: 0.1, bone: 0 });
  return p;
}

let sackGeo: THREE.BufferGeometry | null = null;

export class PaleVigil {
  readonly root = new THREE.Group();
  readonly drive: VigilDrive = { windup: 0, strike: null, rear: 0, look: null, phase: 'hang', hanging: 1, lureGlow: 0.6, dim: 0 };
  readonly weakPoints: VigilWeakPoint[] = [];
  readonly hitSpheres: VigilHit[] = [];
  readonly limbs: Limb[] = [];
  private body = new THREE.Group();
  private sack: THREE.Mesh;
  private organs: THREE.Mesh[] = [];
  private spines: THREE.Object3D[] = [];
  private tears: THREE.Mesh[] = [];
  /** Two limp, over-long arms that dangle under gravity like empty sleeves. */
  private sleeves: THREE.Object3D[] = [];
  private slit: THREE.Mesh;
  private ribs: THREE.Object3D;
  private lureLinks: { p: THREE.Vector3; prev: THREE.Vector3 }[] = [];
  private stalk: THREE.Mesh;
  private lure = new THREE.Group();
  private lureMat: THREE.MeshStandardMaterial;
  private dimmed: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[] = [];
  private time = 0;
  health = 1;
  private dead = false;
  private shriekT = 0;
  private started = false;
  private rand: Rand;
  private fluid = mix(ORGANIC.vein, ORGANIC.wetFleshDeep, 0.3);

  constructor(seed = 1, private scene?: THREE.Object3D) {
    this.rand = rng(seed);
    this.root.name = 'paleVigil';
    this.root.add(this.body);
    // Pale, translucent skin over dark organs; wet, near-black limbs; bone spines; one warm light.
    const skin = livingFlesh(mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.12), mix(ORGANIC.vein, ORGANIC.wetFleshDeep, 0.3), mix(HIVE.bone, ORGANIC.amber, 0.35), 3.5);
    skin.sheenColor.set(mix(HIVE.bone, ORGANIC.amber, 0.25));
    skin.transparent = true; skin.opacity = 0.7; skin.side = THREE.DoubleSide; skin.roughness = 0.5; skin.depthWrite = false;
    const organ = livingFlesh(mix(ORGANIC.vein, ORGANIC.wetFleshDeep, 0.4), ORGANIC.wetFleshDeep, ORGANIC.vein, 8);
    const limbMat = chitin(mix(ORGANIC.wetFleshDeep, HIVE.background, 0.5), ORGANIC.vein, 5);
    limbMat.roughness = 0.3; limbMat.clearcoat = 0.9;
    const bone = chitin(mix(HIVE.bone, ORGANIC.wetFleshDeep, 0.2), ORGANIC.amber, 8);
    const wound = livingFlesh(mix(ORGANIC.wetFleshDeep, ORGANIC.amber, 0.18), ORGANIC.wetFleshDeep, mix(ORGANIC.vein, ORGANIC.wetFleshDeep, 0.5), 20);
    this.lureMat = bioNode(mix(ORGANIC.amber, HIVE.bone, 0.35), 0.8);
    for (const m of [skin, organ, limbMat, bone]) this.dimmed.push({ mat: m, base: m.color.clone() });

    // Organs first (drawn before the translucent sack so they read through it).
    for (let k = 0; k < 4; k++) {
      const o = new THREE.Mesh(roughen(new THREE.SphereGeometry(1, 16, 12).scale(0.24 + k * 0.05, 0.5, 0.22), 0.04, 5, k), organ);
      o.position.set((this.rand() - 0.5) * 0.25, BODY_OPEN + 1.0 + k * 0.85, (this.rand() - 0.5) * 0.2);
      o.renderOrder = -1;
      this.body.add(o);
      this.organs.push(o);
    }
    sackGeo ??= meshSdf(sackPrims(), 1, { resolution: 56, noise: { amp: 0.035, freq: 3.5, seed: 77 } }).geometry;
    this.sack = new THREE.Mesh(sackGeo, skin);
    this.body.add(this.sack);
    // Ribs behind the slit; the slit's dark lips.
    const ribs = new THREE.Group();
    for (let k = 0; k < 5; k++) ribs.add(new THREE.Mesh(new THREE.TorusGeometry(0.34 - Math.abs(k - 2) * 0.03, 0.03, 5, 14, Math.PI * 0.9).rotateZ(Math.PI * 0.05).rotateX(-Math.PI / 2).rotateY(Math.PI / 2).translate(0, BODY_OPEN + 1.4 + k * 0.42, 0.3), bone));
    ribs.scale.set(1, 1, 0.2);
    this.ribs = ribs;
    this.body.add(ribs);
    this.slit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 16).scale(0.05, (HEIGHT - BODY_OPEN - 2.6) / 2, 0.05).translate(0, (BODY_OPEN + 1 + HEIGHT - 1.6) / 2, 0.7), wound);
    this.body.add(this.slit);
    // Splits in the skin that tear open in the unravel phase.
    for (let k = 0; k < 7; k++) {
      const a = this.rand() * Math.PI * 2, y = BODY_OPEN + 1.2 + this.rand() * (HEIGHT - BODY_OPEN - 2.4);
      const t = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 10).scale(0.02, 0.35 + this.rand() * 0.3, 0.06), wound);
      t.position.set(Math.cos(a) * 0.62, y, Math.sin(a) * 0.55);
      t.rotation.y = -a;
      this.body.add(t);
      this.tears.push(t);
    }
    // Spines along the back (-Z): bone blades that stand out of the skin.
    for (let k = 0; k < SPINES; k++) {
      const s = new THREE.Group();
      s.position.set(0, BODY_OPEN + 1.2 + k * ((HEIGHT - BODY_OPEN - 2.6) / Math.max(1, SPINES - 1)), -0.5);
      s.add(new THREE.Mesh(roughen(merge([spike(0.9, 0.11, 0.4).rotateX(-Math.PI / 2 - 0.4), spike(0.5, 0.07, 0.6).rotateX(-Math.PI / 2 - 0.9).translate(0.12, 0.15, 0)]), 0.01, 10, k), bone));
      s.name = `spine${k}`;
      this.body.add(s);
      this.spines.push(s);
      this.hitSpheres.push({ tag: 'spine', index: k, local: V(0, 0, -0.4), r: 0, weak: true, world: new THREE.Vector3(), bone: s });
    }
    // Limbs: four long jointed harvestman legs from the shoulders; the knees ride high above the body.
    const upperGeo = roughen(merge([taperTube([V(0, 0, 0), V(0, L1 * 0.5, 0.04), V(0, L1, 0)], [0.13, 0.09, 0.1], 7, 6), new THREE.SphereGeometry(0.14, 10, 8).translate(0, L1, 0)]), 0.01, 8, 1);
    const lowerGeo = roughen(merge([
      taperTube([V(0, 0, 0), V(0, L2 * 0.6, -0.05), V(0, L2, 0)], [0.1, 0.06, 0.02], 7, 6),
      ...[0, 1, 2].map((k) => spike(0.25, 0.025, 0.6).rotateZ(-0.6 + k * 0.1).translate(0.04, L2 * (0.3 + k * 0.18), 0)),
    ]), 0.008, 10, 2);
    for (let i = 0; i < LIMBS; i++) {
      const angle = (i / LIMBS) * Math.PI * 2 + Math.PI / 4;
      const hip = new THREE.Object3D();
      hip.position.set(Math.cos(angle) * 0.55, BODY_OPEN, Math.sin(angle) * 0.45);
      this.body.add(hip);
      const upper = new THREE.Object3D(), lower = new THREE.Object3D();
      upper.add(new THREE.Mesh(upperGeo, limbMat));
      lower.add(new THREE.Mesh(lowerGeo, limbMat));
      lower.position.set(0, L1, 0);
      upper.add(lower);
      hip.add(upper);
      upper.name = `limb${i}upper`; lower.name = `limb${i}lower`;
      this.limbs.push({ i, hip, upper, lower, angle, severed: false, foot: new THREE.Vector3() });
      this.hitSpheres.push({ tag: 'limb', index: i, local: V(0, L2 * 0.4, 0), r: 0.4, weak: false, world: new THREE.Vector3(), bone: lower, limb: `limb${i}` });
    }
    // Sleeves: thin limp arms from the upper chest, longer than a person, hanging toward the floor with long fingers.
    const ARM = 3.4;
    const sleeveGeo = roughen(merge([
      taperTube([V(0, 0, 0), V(0.03, ARM * 0.45, 0.04), V(0, ARM * 0.5, 0.02), V(-0.02, ARM, 0)], [0.07, 0.045, 0.05, 0.03], 6, 4),
      ...[0, 1, 2, 3].map((k) => spike(0.55 + (k % 2) * 0.15, 0.018, 0.35).rotateY((k - 1.5) * 0.5).rotateZ((k - 1.5) * 0.12).translate(0, ARM, 0)),
    ]), 0.006, 12, 3);
    for (const side of [-1, 1]) {
      const sl = new THREE.Group();
      sl.position.set(side * 0.42, BODY_OPEN + 0.7, 0.18);
      sl.add(new THREE.Mesh(sleeveGeo, limbMat));
      sl.name = side < 0 ? 'sleeveL' : 'sleeveR';
      this.body.add(sl);
      this.sleeves.push(sl);
    }
    // The lure stalk and its soft lantern.
    this.stalk = new THREE.Mesh(new THREE.BufferGeometry(), organ);
    this.root.add(this.stalk);
    this.lure.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12).scale(1, 1.3, 1), this.lureMat));
    this.lure.add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12).scale(1, 1.3, 1), new THREE.MeshPhysicalMaterial({ color: mix(HIVE.bone, ORGANIC.amber, 0.3), transparent: true, opacity: 0.35, roughness: 0.2, clearcoat: 1, depthWrite: false })));
    this.lure.name = 'lure';
    this.root.add(this.lure);
    this.weakPoints.push({ tag: 'lure', index: 0, mesh: this.lure, world: new THREE.Vector3(), radius: 0.3, alive: true });
    for (let k = 0; k < SPINES; k++) this.weakPoints.push({ tag: 'spine', index: k, mesh: this.spines[k], world: new THREE.Vector3(), radius: 0.35, alive: true });
    this.hitSpheres.push({ tag: 'lure', index: 0, local: V(0, 0, 0), r: 0.32, weak: true, world: new THREE.Vector3(), bone: this.lure });
    this.hitSpheres.push({ tag: 'body', index: 0, local: V(0, (BODY_OPEN + HEIGHT) / 2, 0), r: 1.0, weak: false, world: new THREE.Vector3(), bone: this.body });
    this.root.traverse((o) => { o.frustumCulled = false; });
  }

  get alive(): boolean { return !this.dead; }
  get limbsIntact(): number { return this.limbs.filter((l) => !l.severed).length; }
  get lureAlive(): boolean { return this.weakPoints[0].alive; }

  /** Plant the feet and hang the lure straight (call after placing `root`, or the first update does it). */
  plant(): void {
    this.body.position.y = THREE.MathUtils.lerp(BODY_OPEN, BODY_FOLDED, smooth(this.drive.hanging)) - BODY_OPEN;
    this.root.updateMatrixWorld(true);
    for (const l of this.limbs) l.foot.copy(this.footRest(l));
    const anchor = this.lureAnchor();
    const down = V(0, -1, 0);
    this.lureLinks = Array.from({ length: LURE_LINKS + 1 }, (_, k) => { const p = anchor.clone().addScaledVector(down, (k / LURE_LINKS) * LURE); return { p, prev: p.clone() }; });
    this.started = true;
  }

  /** It rears and shrieks: the slit splits open to the ribs. */
  shriek(): void { this.shriekT = 1; }

  /** Destroy the lure (0) or a spine (1..3). */
  popWeakPoint(i: number): void {
    const w = this.weakPoints[i];
    if (!w || !w.alive) return;
    w.alive = false;
    for (const h of this.hitSpheres) if (h.tag === w.tag && h.index === w.index) h.r = 0;
    if (this.scene) gore.burst(this.scene, { point: w.mesh.getWorldPosition(new THREE.Vector3()), colour: this.fluid, count: 60, speed: 6 });
    mutation.dissolveOut(w.mesh, { duration: 0.7, colour: this.fluid, done: () => { w.mesh.visible = false; } });
    if (w.tag === 'lure') this.stalk.visible = false;
  }

  severLimb(i: number): void {
    const l = this.limbs[i];
    if (!l || l.severed) return;
    l.severed = true;
    for (const h of this.hitSpheres) if (h.tag === 'limb' && h.index === i) h.r = 0;
    if (this.scene) gore.burst(this.scene, { point: l.hip.getWorldPosition(new THREE.Vector3()), colour: this.fluid, count: 70, speed: 7 });
    mutation.dissolveOut(l.upper, { duration: 1.2, colour: this.fluid, done: () => { l.upper.visible = false; } });
  }

  sever(limb: string): void {
    const m = /^limb(\d)$/.exec(limb);
    if (m) this.severLimb(Number(m[1]));
  }

  hurt(fraction: number): void { this.health = THREE.MathUtils.clamp(1 - fraction, 0, 1); }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.scene) gore.burst(this.scene, { point: this.body.localToWorld(V(0, HEIGHT * 0.6, 0)), colour: this.fluid, count: 220, speed: 10 });
    for (const w of this.weakPoints) if (w.alive) { w.alive = false; mutation.dissolveOut(w.mesh, { duration: 1.5, colour: this.fluid }); }
    for (const h of this.hitSpheres) h.r = 0;
    mutation.dissolveOut(this.body, { duration: 5, colour: this.fluid });
    this.stalk.visible = false;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const d = this.drive, t = this.time;
    if (!this.started) this.plant();
    this.shriekT = Math.max(0, this.shriekT - dt * 0.6);
    this.root.updateMatrixWorld(true);
    const fold = this.dead ? 1 : smooth(d.hanging);
    const tense = smooth(d.windup);
    const rear = Math.max(smooth(d.rear), this.shriekT);
    // The body: shoulders ride lower when folded, it draws in on the tell, sways like something hanged.
    const bodyY = THREE.MathUtils.lerp(BODY_OPEN, BODY_FOLDED, fold) - BODY_OPEN;
    this.body.position.set(Math.sin(t * 0.4) * 0.08 * (1 - tense), bodyY, 0);
    this.body.rotation.set(Math.sin(t * 0.31) * 0.04 - rear * 0.25, 0, Math.sin(t * 0.23) * 0.05 * (1 - tense));
    if (d.look && !this.dead) {
      const lp = this.root.worldToLocal(d.look.clone());
      this.body.rotation.y = damp(this.body.rotation.y, Math.atan2(lp.x, lp.z), 1.2, dt);
    }
    this.body.scale.set(1 - tense * 0.06, 1 - tense * 0.05 + rear * 0.05, 1 - tense * 0.06);
    this.organs.forEach((o, k) => o.scale.setScalar(1 + Math.sin(t * 0.7 + k * 1.9) * 0.06));
    // Spines stand out while it hangs or rears; tears split open in the unravel phase.
    const expose = Math.max(fold, rear);
    this.spines.forEach((s, k) => {
      s.scale.setScalar(0.25 + 0.75 * expose);
      const h = this.hitSpheres.find((x) => x.tag === 'spine' && x.index === k)!;
      h.r = this.weakPoints[1 + k].alive && expose > 0.5 && !this.dead ? 0.38 : 0;
    });
    const unravel = d.phase === 'unravel' ? 1 : 0;
    this.tears.forEach((tr, k) => tr.scale.set(1 + unravel * (5 + Math.sin(t * 3 + k) * 1.5), 1 + unravel * 0.6, 1));
    // The slit: closed until it shrieks, then it splits and the ribs show.
    const open = Math.max(rear * 0.6, this.shriekT);
    this.slit.scale.set(1 + open * 6, 1, 1 + open * 2);
    this.ribs.scale.set(1, 1, 0.2 + open * 0.8);
    // Dim: the whole silhouette sinks toward black.
    for (const m of this.dimmed) m.mat.color.copy(m.base).multiplyScalar(1 - d.dim * 0.85);
    this.lureMat.emissiveIntensity = this.dead || !this.lureAlive ? 0 : (0.3 + d.lureGlow * 1.4) * (0.85 + 0.15 * Math.sin(t * 1.7));

    // Sleeves hang toward the real floor, swaying out of step; they draw up and in on the tell.
    this.body.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, -1, 0).transformDirection(new THREE.Matrix4().copy(this.body.matrixWorld).invert());
    this.sleeves.forEach((sl, k) => {
      const dir = down.clone().add(V(Math.sin(t * 0.37 + k * 2.1) * 0.06 + (k ? 1 : -1) * (0.08 + tense * 0.25), 0, Math.cos(t * 0.29 + k) * 0.06 + tense * 0.35)).normalize();
      sl.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
      sl.scale.set(1, 1 - tense * 0.25, 1);
    });

    // Limbs: two-bone IK in world space, knees thrown high above the body (a harvestman's posture).
    this.body.updateMatrixWorld(true);
    const away = V(0, 1, 0).transformDirection(this.root.matrixWorld);
    for (const l of this.limbs) {
      if (l.severed) continue;
      let target = this.footRest(l);
      if (l.i === 0 && d.strike && !this.dead) target = d.strike.clone();
      else if (l.i === 0 && tense > 0) target.lerp(this.root.localToWorld(V(Math.cos(l.angle) * 2, 3.5, Math.sin(l.angle) * 2 + 1.5)), tense * 0.6);
      l.foot.lerp(target, 1 - Math.exp(-(d.strike && l.i === 0 ? 14 : 6) * dt));
      const hipW = l.hip.getWorldPosition(new THREE.Vector3());
      const out = l.foot.clone().sub(hipW).setComponent(1, 0);
      const pole = away.clone().multiplyScalar(2).add(out.normalize().multiplyScalar(0.5));
      solveTwoBone(l.upper, l.lower, L1, L2, l.foot, pole);
    }

    // The lure: a rope under world gravity from the chest, swaying; it goes still on the tell.
    if (this.lureAlive && !this.dead) {
      const anchor = this.lureAnchor();
      const seg = LURE / LURE_LINKS;
      const g = V(0, -9.8, 0).multiplyScalar(dt * dt);
      const sway = V(Math.sin(t * 0.7), 0, Math.cos(t * 0.53)).multiplyScalar(0.0006 * (1 - tense));
      const drag = 0.985 - tense * 0.1;
      this.lureLinks.forEach((k, idx) => {
        if (idx === 0) { k.p.copy(anchor); k.prev.copy(anchor); return; }
        const v = k.p.clone().sub(k.prev).multiplyScalar(drag);
        k.prev.copy(k.p);
        k.p.add(v).add(g).add(sway);
      });
      for (let it = 0; it < 6; it++) {
        this.lureLinks[0].p.copy(anchor);
        for (let k = 1; k < this.lureLinks.length; k++) {
          const a = this.lureLinks[k - 1].p, b = this.lureLinks[k].p;
          const dir = b.clone().sub(a), len = dir.length() || 1e-6;
          if (len <= seg) continue; // a rope goes slack, it never pushes
          const corr = dir.multiplyScalar((len - seg) / len);
          if (k === 1) b.sub(corr); else { a.addScaledVector(corr, 0.5); b.addScaledVector(corr, -0.5); }
        }
      }
      const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
      // A stiff root curls out of the chest before the stalk hangs free.
      const pts = [this.body.localToWorld(V(0, BODY_OPEN + 0.75, 0.35)), ...this.lureLinks.map((k) => k.p)].map((p) => p.clone().applyMatrix4(inv));
      this.stalk.geometry.dispose();
      this.stalk.geometry = taperTube(pts, pts.map((_, k) => 0.07 - (k / pts.length) * 0.05), 6, 1);
      this.lure.position.copy(pts[pts.length - 1]);
    }

    this.root.updateMatrixWorld(true);
    for (const h of this.hitSpheres) h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
    for (const w of this.weakPoints) w.mesh.getWorldPosition(w.world);
  }

  /** Where a limb's foot rests on the surface (world): spread wide unfolded, tucked in when folded. */
  private footRest(l: Limb): THREE.Vector3 {
    const r = THREE.MathUtils.lerp(SPAN / 2, SPAN * 0.3, this.dead ? 1 : smooth(this.drive.hanging));
    const a = l.angle + Math.sin(this.time * 0.2 + l.i) * 0.03;
    return this.root.localToWorld(V(Math.cos(a) * r, 0, Math.sin(a) * r));
  }

  /** The lure stalk's root on the chest (world). */
  private lureAnchor(): THREE.Vector3 {
    return this.body.localToWorld(V(0, BODY_OPEN + 1.0, 1.15));
  }
}
