import * as THREE from 'three';
import { BOSSES } from '../../../data';
import { FAUNA, ORGANIC } from '../../render/palette';
import { alienEye, bioNode, chitin, livingFlesh } from '../../render/materials';
import { mutation } from '../../render/dissolve';
import { gore } from '../../render/gore';
import { merge, rng, roughen, spike, taperTube, type Rand } from '../parts';
import { GroundFx } from './fx';

/**
 * The Mire Regent (data/bosses.json `mireRegent`): the thing under the black pool of the Weeping Fen. A bloated
 * amphibian the size of a barge: a frog's mouth as wide as a door, a mossy back, a soft pale belly hung with pearls
 * of something it has grown, two long arms like drowned branches, and two eyes on top of its head only, so it
 * watches the surface from below. When it rises, water sheets off the moss. No neon: black water, pale belly, moss,
 * a faint glow in the pearls.
 *
 * Behaviour is PvE AI's. Place `root` at the pool's centre with y = the water surface; write `drive` every frame:
 *   drive.rise     0 lurking (only the eyes break the surface) .. 1 reared up out of the pool, belly and pearls
 *                  exposed (the pearls are only hittable while rise > 0.5, as the brief says).
 *   drive.open     0..1 the mouth.
 *   drive.tongue   0..1 the tongue shoots out along the head's forward axis to TONGUE_RANGE (the pull).
 *   drive.reach    two world points (or null): an arm rises out of the water and reaches for it (dragUnder).
 *                  `hands[i]` is the grip point to pin a host to.
 *   drive.thrash   0..1 (drown phase): it rolls and churns the pool.
 *   drive.phase    'lurk' | 'rise' | 'drown'.
 * Moves: slam() (belly slam: rings and a sheet of spray), ripple() (the ripple wave), call() (the brood call;
 * spawn Mirebrood at `broodPoint`). An eye hit makes it dive: `diving` is true for a few seconds and the body
 * pulls itself under whatever drive.rise says. Damage: popWeakPoint(i) (0..4 pearls, 5..6 eyes), hurt, destroy.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));

const DEF = BOSSES.mireRegent as unknown as { size?: { length: number; height: number }; weakPoints?: Record<string, { count?: number }>; phases?: { attacks?: { tongue?: { range?: number } } }[] } | undefined;
const LENGTH = DEF?.size?.length ?? 14;
const HEIGHT = DEF?.size?.height ?? 5;
const PEARLS = Number(DEF?.weakPoints?.pearls?.count ?? 5);
const EYES = Number(DEF?.weakPoints?.eyes?.count ?? 2);
export const TONGUE_RANGE = Number(DEF?.phases?.find((p) => p.attacks?.tongue)?.attacks?.tongue?.range ?? 20);
const HALF = LENGTH / 2;
const WIDTH = LENGTH * 0.46;

export type RegentPhase = 'lurk' | 'rise' | 'drown';
export interface RegentDrive {
  rise: number; open: number; tongue: number; thrash: number;
  reach: [THREE.Vector3 | null, THREE.Vector3 | null];
  phase: RegentPhase; look: THREE.Vector3 | null;
}
export interface RegentHit { tag: 'body' | 'head' | 'pearl' | 'eye' | 'arm'; index: number; local: THREE.Vector3; r: number; weak: boolean; world: THREE.Vector3; bone: THREE.Object3D }
export interface RegentWeakPoint { tag: 'pearl' | 'eye'; index: number; mesh: THREE.Object3D; world: THREE.Vector3; radius: number; alive: boolean }

interface Arm { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Object3D; side: number; rest: THREE.Quaternion; reach: number }

/** A soft, lumpy ellipsoid: the hull, belly and jaw. */
function blob(rx: number, ry: number, rz: number, rand: Rand, amp = 0.06, detail = 48): THREE.BufferGeometry {
  return roughen(new THREE.SphereGeometry(1, detail, Math.round(detail * 0.6)).scale(rx, ry, rz), amp * Math.min(rx, ry, rz), 1.4 / Math.min(rx, ry), Math.floor(rand() * 1000));
}

export class MireRegent {
  readonly root = new THREE.Group();
  readonly drive: RegentDrive = { rise: 0, open: 0, tongue: 0, thrash: 0, reach: [null, null], phase: 'lurk', look: null };
  readonly weakPoints: RegentWeakPoint[] = [];
  readonly hitSpheres: RegentHit[] = [];
  /** The arms' grip points (world via getWorldPosition): pin a dragged host here. */
  readonly hands: THREE.Object3D[] = [];
  /** Where the brood call sends its Mirebrood from: the water beside the mouth. */
  readonly broodPoint = new THREE.Object3D();
  private pivot = new THREE.Group();
  private hull = new THREE.Group();
  private jaw = new THREE.Group();
  private tongue: THREE.Mesh;
  private throat = new THREE.Group();
  private arms: Arm[] = [];
  private pearls: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; alive: boolean; rest: THREE.Vector3 }[] = [];
  private eyes: { g: THREE.Group; alive: boolean }[] = [];
  private fx: GroundFx;
  private rand: Rand;
  private time = 0;
  private rise = 0;
  private open = 0;
  private tongueK = 0;
  private slamT = 0;
  private rippleT = 0;
  private callT = 0;
  private diveT = 0;
  private hurtT = 0;
  private health = 1;
  private dead = false;
  private deadFor = 0;
  private lastRise = 0;
  private glow = mix(FAUNA.pearl, ORGANIC.amber, 0.3);

  constructor(seed = 1, private scene?: THREE.Object3D) {
    this.rand = rng(seed);
    this.root.name = 'mireRegent';
    const back = livingFlesh(mix(FAUNA.fenMoss, FAUNA.reed, 0.25), mix(ORGANIC.vein, FAUNA.peat, 0.5), FAUNA.pearl, 1.2);
    back.roughness = 0.55;
    const belly = livingFlesh(mix(FAUNA.pearl, FAUNA.rope, 0.35), mix(ORGANIC.vein, FAUNA.rope, 0.4), FAUNA.pearl, 1.5);
    const inner = livingFlesh(mix(ORGANIC.wetFleshDeep, FAUNA.peat, 0.35), ORGANIC.vein, FAUNA.rope, 3);
    const wood = chitin(mix(FAUNA.peat, FAUNA.reed, 0.35), FAUNA.fenMoss, 2);
    wood.roughness = 0.85; wood.clearcoat = 0.1;
    const moss = livingFlesh(mix(FAUNA.fenMoss, FAUNA.reed, 0.2), FAUNA.peat, FAUNA.reed, 6);
    const eyeMat = alienEye(mix(ORGANIC.amber, FAUNA.reed, 0.4), FAUNA.soot);

    // The pivot sits at the tail end, under water: rising rotates the front up out of the pool.
    this.pivot.position.set(0, -HEIGHT * 0.5, -HALF * 0.7);
    this.root.add(this.pivot);
    this.hull.position.set(0, 0, HALF * 0.7);
    this.pivot.add(this.hull);
    // Hull: a mossy, flattened back over a pale belly that sags below it.
    this.hull.add(new THREE.Mesh(blob(WIDTH / 2, HEIGHT * 0.42, HALF, this.rand, 0.08), back));
    this.hull.add(new THREE.Mesh(blob(WIDTH * 0.44, HEIGHT * 0.36, HALF * 0.88, this.rand, 0.05).translate(0, -HEIGHT * 0.16, 0.2), belly));
    // Warty ridges along the back.
    this.hull.add(new THREE.Mesh(merge(Array.from({ length: 26 }, (_, k) => {
      const x = (this.rand() - 0.5) * WIDTH * 0.7, z = (this.rand() - 0.5) * LENGTH * 0.8;
      const y = HEIGHT * 0.42 * Math.sqrt(Math.max(0, 1 - (2 * x / WIDTH) ** 2 - (z / HALF) ** 2)) - 0.1;
      const r = 0.25 + this.rand() * 0.4;
      return roughen(new THREE.SphereGeometry(r, 10, 7).scale(1 + this.rand() * 0.4, 0.5 + this.rand() * 0.3, 1 + this.rand() * 0.4), 0.15 * r, 3 / r, k).translate(x, y, z);
    })), back));
    // The head: the front of the hull, a door-wide upper lip, and the lower jaw on its hinge.
    const lip = new THREE.Mesh(roughen(new THREE.TorusGeometry(WIDTH * 0.36, 0.32, 10, 36, Math.PI).rotateX(Math.PI / 2).rotateY(-Math.PI / 2).scale(1, 1, 0.55).translate(0, -0.15, HALF * 0.82), 0.06, 2, 3), back);
    this.hull.add(lip);
    this.jaw.position.set(0, -HEIGHT * 0.12, HALF * 0.25);
    this.hull.add(this.jaw);
    this.jaw.add(new THREE.Mesh(blob(WIDTH * 0.38, HEIGHT * 0.16, HALF * 0.62, this.rand, 0.04).translate(0, -0.25, HALF * 0.38), belly));
    // Mouth interior: dark and wet, revealed as the jaw drops.
    this.hull.add(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(WIDTH * 0.34, HEIGHT * 0.3, HALF * 0.55).translate(0, -HEIGHT * 0.08, HALF * 0.5), inner));
    this.throat.position.set(0, -HEIGHT * 0.12, HALF * 0.55);
    this.hull.add(this.throat);
    const tongueGeo = taperTube([V(0, 0, 0), V(0, 0.15, 0.3), V(0, 0.1, 0.65), V(0, 0, 1)], [0.38, 0.3, 0.26, 0.42], 10, 6);
    this.tongue = new THREE.Mesh(tongueGeo, inner);
    this.tongue.visible = false;
    this.throat.add(this.tongue);
    // Eyes on the top of the head only: bumps with a lidded eye in each, watching up through the surface.
    for (let i = 0; i < EYES; i++) {
      const side = i ? 1 : -1;
      const g = new THREE.Group();
      g.name = `regentEye${i}`;
      g.position.set(side * WIDTH * 0.2, HEIGHT * 0.42 + 0.15, HALF * 0.55);
      g.add(new THREE.Mesh(blob(0.75, 0.55, 0.8, this.rand, 0.05, 20), back));
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), eyeMat);
      eye.position.set(side * 0.08, 0.32, 0.12);
      eye.rotation.set(-1.2, 0, 0);
      g.add(eye);
      this.hull.add(g);
      this.eyes.push({ g, alive: true });
      this.weakPoints.push({ tag: 'eye', index: i, mesh: eye, world: new THREE.Vector3(), radius: 0.45, alive: true });
      this.hitSpheres.push({ tag: 'eye', index: i, local: V(side * 0.08, 0.32, 0.12), r: 0.5, weak: true, world: new THREE.Vector3(), bone: g });
    }
    // Pearls: grown in pale sacs hanging along the belly, glowing faintly.
    for (let i = 0; i < PEARLS; i++) {
      const u = (i - (PEARLS - 1) / 2) / ((PEARLS - 1) / 2 || 1);
      const rest = V(u * WIDTH * 0.3, -HEIGHT * 0.48 + Math.abs(u) * 0.35, HALF * (0.0 + (1 - Math.abs(u)) * 0.22));
      const sac = new THREE.Mesh(blob(0.6, 0.55, 0.6, this.rand, 0.04, 18).translate(0, 0.3, 0), belly);
      sac.position.copy(rest);
      this.hull.add(sac);
      const mat = bioNode(this.glow, 0.5 + this.rand() * 0.4);
      mat.emissiveIntensity = 0.4;
      const mesh = new THREE.Mesh(roughen(new THREE.SphereGeometry(0.42, 20, 14).scale(1, 0.9 + this.rand() * 0.2, 1.1), 0.04, 5, i), mat);
      mesh.name = `pearl${i}`;
      mesh.position.copy(rest).add(V(0, -0.15, 0));
      this.hull.add(mesh);
      this.pearls.push({ mesh, mat, alive: true, rest: mesh.position.clone() });
      this.weakPoints.push({ tag: 'pearl', index: i, mesh, world: new THREE.Vector3(), radius: 0.42, alive: true });
      this.hitSpheres.push({ tag: 'pearl', index: i, local: V(0, 0, 0), r: 0, weak: true, world: new THREE.Vector3(), bone: mesh });
    }
    // Arms: drowned branches, a long upper limb and a forearm splitting into twig fingers.
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const shoulder = new THREE.Group();
      shoulder.position.set(side * WIDTH * 0.42, -HEIGHT * 0.1, HALF * 0.35);
      this.hull.add(shoulder);
      const upper = taperTube([V(0, 0, 0), V(side * 0.6, 0.25, 1.4), V(side * 0.4, 0.4, 2.8), V(side * 0.7, 0.3, 4.2)], [0.55, 0.45, 0.38, 0.32], 9, 4);
      shoulder.add(new THREE.Mesh(roughen(upper, 0.07, 2.5, 11 + i), wood));
      const elbow = new THREE.Group();
      elbow.position.set(side * 0.7, 0.3, 4.2);
      shoulder.add(elbow);
      const fore = taperTube([V(0, 0, 0), V(-side * 0.3, -0.2, 1.5), V(-side * 0.1, -0.1, 3.0), V(0, 0, 4.2)], [0.32, 0.27, 0.22, 0.2], 9, 4);
      const fingers = Array.from({ length: 5 }, (_, k) => {
        const a = (k - 2) * 0.35;
        const len = 1.4 + this.rand() * 0.9;
        return taperTube([V(0, 0, 4.1), V(Math.sin(a) * 0.5, -0.15, 4.1 + len * 0.5), V(Math.sin(a) * 0.9, -0.5 - this.rand() * 0.3, 4.1 + len)], [0.14, 0.09, 0.02], 6, 3);
      });
      elbow.add(new THREE.Mesh(roughen(merge([fore, ...fingers]), 0.05, 3, 21 + i), wood));
      // Moss trailing off the branch.
      elbow.add(new THREE.Mesh(merge(Array.from({ length: 6 }, (_, k) => {
        const z = 0.4 + k * 0.6, len = 0.6 + this.rand() * 1.0;
        return taperTube([V(0, -0.2, z), V(side * 0.1, -0.2 - len * 0.5, z + 0.1), V(0, -0.2 - len, z + 0.15)], [0.08, 0.05, 0.01], 5, 2);
      })), moss));
      const hand = new THREE.Object3D();
      hand.position.set(0, -0.2, 5.0);
      elbow.add(hand);
      this.hands.push(hand);
      this.arms.push({ shoulder, elbow, hand, side, rest: shoulder.quaternion.clone(), reach: 0 });
      this.hitSpheres.push({ tag: 'arm', index: i, local: V(side * 0.4, 0.3, 2.4), r: 0.8, weak: false, world: new THREE.Vector3(), bone: shoulder });
      this.hitSpheres.push({ tag: 'arm', index: i, local: V(0, 0, 2.4), r: 0.6, weak: false, world: new THREE.Vector3(), bone: elbow });
    }
    // Moss hanging in sheets off the flanks, and a few reed-like spines along the back ridge.
    this.hull.add(new THREE.Mesh(merge(Array.from({ length: 34 }, () => {
      const a = this.rand() * Math.PI * 2, z = (this.rand() - 0.5) * LENGTH * 0.85;
      const k = Math.sqrt(Math.max(0.05, 1 - (z / HALF) ** 2));
      const x = Math.cos(a) * WIDTH * 0.5 * k, y = Math.abs(Math.sin(a)) * HEIGHT * 0.2 * k;
      const len = 0.8 + this.rand() * 1.8;
      return taperTube([V(x, y, z), V(x * 1.04, y - len * 0.5, z + 0.1), V(x * 1.02, y - len, z + 0.2)], [0.12, 0.07, 0.015], 5, 2);
    })), moss));
    this.hull.add(new THREE.Mesh(merge(Array.from({ length: 12 }, (_, k) => {
      const z = -HALF * 0.6 + k * LENGTH * 0.06;
      return spike(0.8 + this.rand() * 0.8, 0.07, 0.3, 5).rotateX(-0.5).translate((this.rand() - 0.5) * 1.5, HEIGHT * 0.4, z);
    })), wood));
    this.hitSpheres.push({ tag: 'body', index: 0, local: V(0, 0, -HALF * 0.35), r: WIDTH * 0.45, weak: false, world: new THREE.Vector3(), bone: this.hull });
    this.hitSpheres.push({ tag: 'body', index: 1, local: V(0, 0, HALF * 0.15), r: WIDTH * 0.45, weak: false, world: new THREE.Vector3(), bone: this.hull });
    this.hitSpheres.push({ tag: 'head', index: 0, local: V(0, 0, HALF * 0.65), r: WIDTH * 0.38, weak: false, world: new THREE.Vector3(), bone: this.hull });
    this.broodPoint.position.set(WIDTH * 0.65, 0, HALF * 0.5);
    this.root.add(this.broodPoint);
    this.fx = new GroundFx(this.root, { rings: 16, sprays: 48 });
    this.root.traverse((o) => { o.frustumCulled = false; });
  }

  get alive(): boolean { return !this.dead; }
  get pearlsAlive(): number { return this.pearls.filter((p) => p.alive).length; }
  get eyesAlive(): number { return this.eyes.filter((e) => e.alive).length; }
  /** True while it is diving after an eye hit (overrides drive.rise). */
  get diving(): boolean { return this.diveT > 0; }
  /** Current rise after smoothing and diving (0 under .. 1 reared). */
  get risen(): number { return this.rise; }

  private water(at: THREE.Vector3): THREE.Vector3 { at.y = this.root.getWorldPosition(new THREE.Vector3()).y + 0.02; return at; }

  /** The belly slam: it crashes down into the pool. */
  slam(): void {
    if (this.dead) return;
    this.slamT = 1;
  }

  /** The ripple wave: a ring of water pushed out from the body. */
  ripple(): void {
    if (this.dead) return;
    this.rippleT = 1;
    const c = this.water(this.hull.getWorldPosition(new THREE.Vector3()));
    for (let k = 0; k < 3; k++) this.fx.ring(c, LENGTH * (0.5 + k * 0.25), 1.6 + k * 0.3);
  }

  /** The brood call: the throat swells and the water beside it boils (spawn Mirebrood at `broodPoint`). */
  call(): void {
    if (this.dead) return;
    this.callT = 1;
    const p = this.water(this.broodPoint.getWorldPosition(new THREE.Vector3()));
    for (let k = 0; k < 8; k++) this.fx.spray(p.clone().add(V((this.rand() - 0.5) * 3, 0, (this.rand() - 0.5) * 3)), 0.3, 2.5);
    this.fx.ring(p, 3, 1.5);
  }

  popWeakPoint(i: number): void {
    const w = this.weakPoints[i];
    if (!w || !w.alive) return;
    w.alive = false;
    for (const h of this.hitSpheres) if (h.tag === w.tag && h.index === w.index) h.r = 0;
    this.hurtT = 1;
    const at = w.mesh.getWorldPosition(new THREE.Vector3());
    if (w.tag === 'pearl') {
      const p = this.pearls[w.index];
      p.alive = false;
      if (this.scene) gore.burst(this.scene, { point: at, colour: this.glow, count: 60, speed: 6 });
      mutation.dissolveOut(p.mesh, { duration: 0.8, colour: this.glow, done: () => { p.mesh.visible = false; } });
    } else {
      this.eyes[w.index].alive = false;
      if (this.scene) gore.burst(this.scene, { point: at, colour: ORGANIC.vein, count: 50, speed: 5 });
      (w.mesh as THREE.Mesh).scale.setScalar(0.4);
      // An eye hit makes it dive early.
      this.diveT = 3;
    }
  }

  hurt(fraction: number): void {
    const h = THREE.MathUtils.clamp(1 - fraction, 0, 1);
    if (h < this.health) this.hurtT = 1;
    this.health = h;
  }

  /** Death: it rolls half over, pale belly up, and sinks until only the belly breaks the surface. */
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.deadFor = 0;
    if (this.scene) gore.burst(this.scene, { point: this.hull.getWorldPosition(new THREE.Vector3()), colour: ORGANIC.vein, count: 200, speed: 9 });
    for (const h of this.hitSpheres) h.r = 0;
    for (const w of this.weakPoints) w.alive = false;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const d = this.drive, t = this.time;
    if (this.dead) this.deadFor += dt;
    this.hurtT = Math.max(0, this.hurtT - dt * 1.5);
    this.diveT = Math.max(0, this.diveT - dt);
    this.slamT = Math.max(0, this.slamT - dt / 1.2);
    this.rippleT = Math.max(0, this.rippleT - dt);
    this.callT = Math.max(0, this.callT - dt / 1.2);
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    const want = this.dead ? 0.15 : this.diveT > 0 ? 0 : THREE.MathUtils.clamp(d.rise, 0, 1);
    this.rise += (want - this.rise) * k(this.diveT > 0 ? 3 : want > this.rise ? 1.3 : 1.8);
    this.open += ((this.dead ? 0.35 : Math.max(d.open, d.tongue > 0 ? 0.8 : 0, this.callT * 0.5)) - this.open) * k(8);
    this.tongueK += ((this.dead ? 0 : THREE.MathUtils.clamp(d.tongue, 0, 1)) - this.tongueK) * k(d.tongue > this.tongueK ? 14 : 6);
    const thrash = this.dead ? 0 : THREE.MathUtils.clamp(d.thrash, 0, 1);
    // The slam: a short rise then a crash below rest.
    const slam = this.slamT > 0.6 ? Math.sin((1 - this.slamT) / 0.4 * Math.PI / 2) * 0.35 : -Math.sin(this.slamT / 0.6 * Math.PI) * 0.25;
    const breathe = Math.sin(t * 0.5) * 0.08;
    const r = this.rise;
    // Rearing: the front tips up round the tail end and the whole body lifts.
    this.pivot.rotation.x = -r * 0.85 - Math.max(0, slam) * 0.4 + Math.min(0, slam) * -0.15 + Math.sin(t * 1.7) * 0.05 * thrash;
    this.pivot.rotation.z = Math.sin(t * 1.1) * 0.22 * thrash + (this.dead ? Math.min(1, this.deadFor / 2.5) * 2.4 : 0);
    this.pivot.position.y = -HEIGHT * 0.5 + r * HEIGHT * 0.45 + breathe + Math.min(0, slam) * 1.5 - (this.dead ? Math.min(1, this.deadFor / 3) * HEIGHT * 0.1 : 0);
    // Water: rising out of the pool it sheds sheets of water off the moss; the slam throws up a wall of spray.
    const lifting = this.rise - this.lastRise;
    this.lastRise = this.rise;
    if (lifting > 0.002 && this.rand() < Math.min(1, lifting * 120)) {
      for (let n = 0; n < 4; n++) {
        const a = this.rand() * Math.PI * 2;
        const p = this.hull.localToWorld(V(Math.cos(a) * WIDTH * 0.5, 0, Math.sin(a) * HALF * 0.9));
        this.fx.spray(this.water(p), 0.35 + this.rand() * 0.3, 1.5 + this.rand(), 1.1);
      }
    }
    if (this.slamT > 0 && this.slamT < 0.62 && this.slamT + dt / 1.2 >= 0.62) {
      const c = this.water(this.hull.getWorldPosition(new THREE.Vector3()));
      this.fx.ring(c, LENGTH * 0.7, 1.4);
      this.fx.ring(c, LENGTH * 0.45, 1.1);
      for (let n = 0; n < 30; n++) {
        const a = this.rand() * Math.PI * 2, rr = WIDTH * (0.5 + this.rand() * 0.4);
        this.fx.spray(c.clone().add(V(Math.cos(a) * rr, 0, Math.sin(a) * rr * 1.6)), 0.4 + this.rand() * 0.4, 5 + this.rand() * 4, 1.3);
      }
    }
    if (thrash > 0 && this.rand() < dt * 8 * thrash) {
      const a = this.rand() * Math.PI * 2;
      this.fx.spray(this.water(this.hull.localToWorld(V(Math.cos(a) * WIDTH * 0.55, 0, Math.sin(a) * HALF))), 0.4, 3, 1);
    }
    // Mouth and tongue.
    this.jaw.rotation.x = this.open * 0.55 + this.callT * Math.sin(t * 18) * 0.04;
    this.throat.scale.set(1 + this.callT * 0.25, 1 + this.callT * 0.3, 1);
    this.tongue.visible = this.tongueK > 0.02;
    this.tongue.scale.set(1, 1, Math.max(0.01, this.tongueK * TONGUE_RANGE));
    this.tongue.rotation.x = r * 0.45;
    // Eyes: they swivel to track whatever drive.look is.
    for (const e of this.eyes) {
      if (!e.alive) continue;
      const eye = e.g.children[1];
      let yaw = Math.sin(t * 0.3 + e.g.position.x) * 0.3;
      if (d.look) { const l = e.g.worldToLocal(d.look.clone()); yaw = Math.atan2(l.x, l.z) * 0.5; }
      eye.rotation.set(-1.2 + Math.sin(t * 0.7) * 0.05, THREE.MathUtils.clamp(yaw, -0.7, 0.7), 0);
    }
    // Arms: at rest they lie forward along the bottom; reaching, an arm swings up and out toward its target.
    for (const [i, a] of this.arms.entries()) {
      const target = this.dead ? null : d.reach[i];
      a.reach += ((target ? 1 : 0) - a.reach) * k(target ? 5 : 2.5);
      const idle = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25 + r * 0.6 + Math.sin(t * 0.6 + i) * 0.06 + thrash * Math.sin(t * 3 + i * 2) * 0.3, a.side * (0.25 + Math.sin(t * 0.4 + i) * 0.08), 0));
      a.shoulder.quaternion.copy(a.rest).multiply(idle);
      if (target && a.reach > 0.01) {
        a.shoulder.parent!.updateWorldMatrix(true, false);
        const local = a.shoulder.parent!.worldToLocal(target.clone()).sub(a.shoulder.position);
        const aim = new THREE.Quaternion().setFromUnitVectors(V(a.side * 0.12, 0.08, 1).normalize(), local.clone().normalize());
        a.shoulder.quaternion.slerp(aim, a.reach);
        // Fold the elbow so the hand lands on the target when it is closer than the full arm.
        const fold = THREE.MathUtils.clamp(1 - local.length() / 9.2, 0, 1);
        a.elbow.rotation.set(fold * 1.4 * a.reach, 0, 0);
      } else a.elbow.rotation.set(0.15 + Math.sin(t * 0.8 + i) * 0.05 + r * 0.3, 0, 0);
    }
    // Pearls: a slow glow under the belly skin, brighter when reared; only hittable while reared.
    for (const [i, p] of this.pearls.entries()) {
      p.mat.emissiveIntensity = p.alive ? (0.25 + r * 0.45 + Math.max(0, Math.sin(t * 0.9 + i * 1.3)) * 0.2 + this.hurtT * 0.3) * (this.dead ? Math.max(0, 1 - this.deadFor) : 1) : 0;
      p.mesh.position.copy(p.rest).add(V(0, Math.sin(t * 1.3 + i) * 0.05, 0));
      for (const h of this.hitSpheres) if (h.tag === 'pearl' && h.index === i) h.r = p.alive && !this.dead && r > 0.5 ? 0.5 : 0;
    }
    this.fx.update(dt);
    this.root.updateMatrixWorld(true);
    for (const h of this.hitSpheres) h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
    for (const w of this.weakPoints) w.mesh.getWorldPosition(w.world);
  }
}
