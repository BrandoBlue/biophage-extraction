import * as THREE from 'three';
import { BOSSES } from '../../../data';
import { FAUNA, ORGANIC } from '../../render/palette';
import { bioNode, chitin, livingFlesh } from '../../render/materials';
import { mutation } from '../../render/dissolve';
import { gore } from '../../render/gore';
import { merge, rng, roughen, spike, taperTube, type Rand } from '../parts';
import { vnoise } from '../sdf';
import { GroundFx } from './fx';

/**
 * The Nethermaw (data/bosses.json `nethermaw`): the thing at the bottom of the Marrow Pit. A brain-coral mass the size
 * of a house grown into the pit floor: five great lobes of meandering folds around a lipless mouth rimmed with cilia,
 * breathing the updraft. The folds are dark bone-grey coral; the sick green light lives *under* them and shows
 * through the grooves, so the whole mass looks lit from inside. Roots run from it across the floor and up the walls.
 * It never moves; the pit moves for it. The green is the only light, dim and sickly.
 *
 * Behaviour is PvE AI's. Place `root` on the pit floor at the arena centre; it writes `drive` every frame:
 *   drive.breath   -1..1: 1 is a full inhale (the mouth dilates, cilia lean in), -1 a full exhale.
 *   drive.swell    5 values 0..1: a lobe swells and its light rises before its spore pulse. Lobes are only
 *                  hittable while swollen (> 0.3), as the brief says.
 *   drive.phase    'breathe' | 'dream' | 'swallow': the light grows sicker and the folds writhe each phase.
 *   drive.look     unused by the body (it has no eyes; it does not need them).
 * Pulses: pulse(i) bursts lobe i's spores; raise() convulses the mouth as it sends up Hollowed (spawn at
 * `risePoint`); dreamLight() flashes a false glow. Damage: popWeakPoint(i) bursts lobe i (0..4), hurt(fraction),
 * destroy(). World owns the four root columns in the arena; this body's own roots are dressing.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));

const DEF = BOSSES.nethermaw as unknown as { size?: { diameter: number; height: number }; weakPoints?: Record<string, { count?: number }> } | undefined;
const DIAMETER = DEF?.size?.diameter ?? 14;
const HEIGHT = DEF?.size?.height ?? 8;
const LOBES = Number(DEF?.weakPoints?.lobes?.count ?? 5);
const MOUTH = DIAMETER * 0.16;

export type NethermawPhase = 'breathe' | 'dream' | 'swallow';
export interface NethermawDrive { breath: number; swell: number[]; phase: NethermawPhase; look: THREE.Vector3 | null }
export interface NethermawHit { tag: 'body' | 'lobe' | 'mouth'; index: number; local: THREE.Vector3; r: number; weak: boolean; world: THREE.Vector3; bone: THREE.Object3D }
export interface NethermawWeakPoint { tag: 'lobe'; index: number; mesh: THREE.Object3D; world: THREE.Vector3; radius: number; alive: boolean }

interface Lobe { g: THREE.Group; shell: THREE.Mesh; core: THREE.MeshStandardMaterial; rest: THREE.Vector3; radius: number; alive: boolean; pulseT: number }

/** A coral lobe: a squashed sphere whose surface is cut by meandering grooves (brain-coral valleys). */
function coralLobe(r: number, rand: Rand, detail = 84): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, detail, Math.round(detail * 0.7));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const off = rand() * 50;
  const f = 4.2 / r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = vnoise(v.x * f + off, v.y * f * 1.3, v.z * f) * 0.65 + vnoise(v.x * f * 2.1, v.y * f * 2.1 + off, v.z * f * 2.1) * 0.35;
    // Valleys where the noise crosses its middle: a meander of narrow grooves between rounded ridges.
    const ridge = Math.min(1, Math.abs(n - 0.5) * 13);
    const depth = Math.pow(1 - ridge, 0.6) * 0.13 * r;
    const bump = ridge * 0.02 * r;
    v.multiplyScalar((r - depth + bump) / r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Nethermaw {
  readonly root = new THREE.Group();
  readonly drive: NethermawDrive = { breath: 0, swell: new Array(LOBES).fill(0), phase: 'breathe', look: null };
  readonly weakPoints: NethermawWeakPoint[] = [];
  readonly hitSpheres: NethermawHit[] = [];
  /** Where raised Hollowed climb out: the mouth. */
  readonly risePoint = new THREE.Object3D();
  private lobes: Lobe[] = [];
  private mouth = new THREE.Group();
  private cilia: THREE.Mesh[] = [];
  private throatGlow: THREE.MeshStandardMaterial;
  private rootGlow: THREE.MeshStandardMaterial;
  private fx: GroundFx;
  private rand: Rand;
  private time = 0;
  private health = 1;
  private dead = false;
  private deadFor = 0;
  private hurtT = 0;
  private raiseT = 0;
  private dreamT = 0;
  private sick = mix(FAUNA.sickGreen, ORGANIC.amber, 0.12);

  constructor(seed = 1, private scene?: THREE.Object3D) {
    this.rand = rng(seed);
    this.root.name = 'nethermaw';
    // Dark, mineral coral: bone gone grey in the damp; matte, faintly wet in the grooves.
    const coral = chitin(mix(FAUNA.pearl, FAUNA.soot, 0.62), FAUNA.sickGreen, 2);
    coral.roughness = 0.82; coral.clearcoat = 0.12;
    const flesh = livingFlesh(mix(ORGANIC.wetFleshDeep, FAUNA.soot, 0.4), mix(ORGANIC.vein, FAUNA.sickGreen, 0.3), FAUNA.pearl, 3);
    const rootMat = livingFlesh(mix(FAUNA.soot, FAUNA.rope, 0.35), ORGANIC.vein, FAUNA.pearl, 4);
    this.throatGlow = bioNode(this.sick, 0.6);
    this.rootGlow = bioNode(mix(this.sick, FAUNA.soot, 0.5), 0.8);
    const ciliaMat = chitin(mix(FAUNA.pearl, FAUNA.rope, 0.4), FAUNA.sickGreen, 6);

    // The bed: a low, fused mound of coral the lobes grow out of, sunk into the floor.
    const bed = new THREE.Mesh(coralLobe(DIAMETER * 0.52, this.rand, 64).scale(1, 0.28, 1).translate(0, -0.4, 0), coral);
    this.root.add(bed);
    const bedCore = new THREE.Mesh(new THREE.SphereGeometry(DIAMETER * 0.5, 32, 16).scale(1, 0.26, 1).translate(0, -0.45, 0), this.rootGlow);
    this.root.add(bedCore);
    // Five lobes in a ring round the mouth, each with its own light underneath the folds.
    for (let i = 0; i < LOBES; i++) {
      const a = (i / LOBES) * Math.PI * 2 + 0.3;
      const radius = DIAMETER * (0.2 + this.rand() * 0.04);
      const rest = V(Math.cos(a) * DIAMETER * 0.3, HEIGHT * 0.32 + this.rand() * 0.6, Math.sin(a) * DIAMETER * 0.3);
      const g = new THREE.Group();
      g.name = `lobe${i}`;
      g.position.copy(rest);
      g.rotation.set(this.rand() * 0.3, a, this.rand() * 0.3);
      const shell = new THREE.Mesh(coralLobe(radius, this.rand).scale(1.15, 0.85, 1), coral);
      const core = bioNode(this.sick, 0.9 + this.rand() * 0.6);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.95, 24, 16).scale(1.15, 0.85, 1), core);
      g.add(glow, shell);
      this.root.add(g);
      this.lobes.push({ g, shell, core, rest, radius, alive: true, pulseT: 0 });
      this.hitSpheres.push({ tag: 'lobe', index: i, local: V(0, 0, 0), r: 0, weak: true, world: new THREE.Vector3(), bone: g });
      this.weakPoints.push({ tag: 'lobe', index: i, mesh: g, world: new THREE.Vector3(), radius, alive: true });
      this.hitSpheres.push({ tag: 'body', index: i, local: V(0, -radius * 0.3, 0), r: radius * 0.85, weak: false, world: new THREE.Vector3(), bone: g });
    }
    // The mouth: a lipless, folded funnel into the dark, rimmed with long pale cilia that comb the air.
    this.mouth.position.set(0, HEIGHT * 0.38, 0);
    this.root.add(this.mouth);
    this.mouth.add(new THREE.Mesh(roughen(new THREE.TorusGeometry(MOUTH, MOUTH * 0.42, 14, 40).rotateX(Math.PI / 2), 0.12, 1.5, 3), flesh));
    const funnel = new THREE.Mesh(roughen(new THREE.CylinderGeometry(MOUTH * 0.95, MOUTH * 0.35, HEIGHT * 0.6, 28, 6, true).translate(0, -HEIGHT * 0.3, 0), 0.1, 2, 4), flesh);
    (funnel.material as THREE.Material).side = THREE.DoubleSide;
    this.mouth.add(funnel);
    this.mouth.add(new THREE.Mesh(new THREE.CircleGeometry(MOUTH * 0.36, 20).rotateX(-Math.PI / 2).translate(0, -HEIGHT * 0.58, 0), this.throatGlow));
    for (let ring = 0; ring < 2; ring++) {
      const n = 36 - ring * 8;
      const geo = merge(Array.from({ length: n }, (_, k) => {
        const a = (k / n) * Math.PI * 2 + ring * 0.1;
        const len = 1.2 + this.rand() * 0.9 - ring * 0.3;
        return spike(len, 0.06, 0.6, 4).rotateX(-0.25).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * MOUTH * (1.05 - ring * 0.25), MOUTH * 0.25, Math.sin(a) * MOUTH * (1.05 - ring * 0.25));
      }));
      const m = new THREE.Mesh(geo, ciliaMat);
      this.mouth.add(m);
      this.cilia.push(m);
    }
    this.hitSpheres.push({ tag: 'mouth', index: 0, local: V(0, -HEIGHT * 0.15, 0), r: MOUTH * 0.9, weak: false, world: new THREE.Vector3(), bone: this.mouth });
    this.risePoint.position.set(0, MOUTH * 0.3, 0);
    this.mouth.add(this.risePoint);
    // Roots: thick cords from the bed out across the floor and up toward the walls.
    const roots = merge(Array.from({ length: 9 }, (_, k) => {
      const a = (k / 9) * Math.PI * 2 + this.rand() * 0.3;
      const out = DIAMETER * (0.9 + this.rand() * 0.6);
      const pts = [V(Math.cos(a) * DIAMETER * 0.4, 0.3, Math.sin(a) * DIAMETER * 0.4), V(Math.cos(a + 0.1) * out * 0.7, 0.1, Math.sin(a + 0.1) * out * 0.7), V(Math.cos(a - 0.05) * out, 0.6 + this.rand() * 2, Math.sin(a - 0.05) * out), V(Math.cos(a) * out * 1.08, 3 + this.rand() * 5, Math.sin(a) * out * 1.08)];
      return taperTube(pts, [0.55, 0.42, 0.3, 0.12], 8, 6);
    }));
    this.root.add(new THREE.Mesh(roughen(roots, 0.08, 1.6, 7), rootMat));
    this.hitSpheres.push({ tag: 'body', index: LOBES, local: V(0, 0.5, 0), r: DIAMETER * 0.4, weak: false, world: new THREE.Vector3(), bone: this.root });
    this.fx = new GroundFx(this.root, { puffs: 30 });
    this.root.traverse((o) => { o.frustumCulled = false; });
  }

  get alive(): boolean { return !this.dead; }
  get lobesAlive(): number { return this.lobes.filter((l) => l.alive).length; }

  /** Lobe i bursts its spores (the 20 damage + Overload pulse). */
  pulse(i: number): void {
    const l = this.lobes[i];
    if (!l || !l.alive || this.dead) return;
    l.pulseT = 1;
    const at = l.g.getWorldPosition(new THREE.Vector3());
    for (let k = 0; k < 10; k++) this.fx.puff(at.clone().add(V((this.rand() - 0.5) * l.radius, l.radius * 0.6, (this.rand() - 0.5) * l.radius)), 1 + this.rand(), 4, 1.8);
  }

  /** The mouth convulses: Hollowed are sent up (spawn at `risePoint`). */
  raise(): void {
    if (this.dead) return;
    this.raiseT = 1;
    if (this.scene) gore.burst(this.scene, { point: this.risePoint.getWorldPosition(new THREE.Vector3()), colour: this.sick, count: 40, speed: 5 });
  }

  /** A false flash of light through every fold (the Dream phase's lie). */
  dreamLight(): void { this.dreamT = 1; }

  popWeakPoint(i: number): void {
    const w = this.weakPoints[i];
    if (!w || !w.alive) return;
    w.alive = false;
    this.lobes[i].alive = false;
    for (const h of this.hitSpheres) if (h.tag === 'lobe' && h.index === i) h.r = 0;
    this.hurtT = 1;
    if (this.scene) gore.burst(this.scene, { point: w.mesh.getWorldPosition(new THREE.Vector3()), colour: this.sick, count: 90, speed: 8 });
    // The shell cracks open and the light inside goes out.
    mutation.dissolveOut(this.lobes[i].shell, { duration: 1.2, colour: this.sick, done: () => { this.lobes[i].shell.visible = false; } });
  }

  hurt(fraction: number): void {
    const h = THREE.MathUtils.clamp(1 - fraction, 0, 1);
    if (h < this.health) this.hurtT = 1;
    this.health = h;
  }

  /** Death: the light drains out of every fold, the cilia go still and droop, the mouth sags open. */
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.deadFor = 0;
    if (this.scene) gore.burst(this.scene, { point: this.risePoint.getWorldPosition(new THREE.Vector3()), colour: this.sick, count: 220, speed: 11 });
    for (const h of this.hitSpheres) h.r = 0;
    for (const w of this.weakPoints) w.alive = false;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const d = this.drive, t = this.time;
    if (this.dead) this.deadFor += dt;
    this.hurtT = Math.max(0, this.hurtT - dt * 1.5);
    this.raiseT = Math.max(0, this.raiseT - dt * 0.6);
    this.dreamT = Math.max(0, this.dreamT - dt * 0.9);
    const phaseK = d.phase === 'breathe' ? 0 : d.phase === 'dream' ? 1 : 2;
    const fade = this.dead ? Math.max(0, 1 - this.deadFor / 3) : 1;
    const breath = this.dead ? -0.3 : THREE.MathUtils.clamp(d.breath, -1, 1);
    // A slow sick heartbeat under everything, faster each phase.
    const beat = Math.pow(Math.max(0, Math.sin(t * (0.8 + phaseK * 0.35))), 4);
    for (const [i, l] of this.lobes.entries()) {
      l.pulseT = Math.max(0, l.pulseT - dt * 1.4);
      const swell = l.alive && !this.dead ? THREE.MathUtils.clamp(d.swell[i] ?? 0, 0, 1) : 0;
      const writhe = (phaseK * 0.015 + this.hurtT * 0.03) * Math.sin(t * 3 + i * 1.7);
      const k = 1 + swell * 0.16 + Math.sin(t * 0.6 + i) * 0.015 + writhe - l.pulseT * 0.08;
      l.g.scale.set(k, k * (1 + swell * 0.08), k);
      l.g.position.copy(l.rest).add(V(0, swell * 0.5 + breath * 0.12, 0));
      l.core.emissiveIntensity = l.alive ? (0.35 + beat * 0.35 + swell * 1.3 + l.pulseT * 2.2 + this.dreamT * 2 + phaseK * 0.15) * fade : 0.02;
      for (const h of this.hitSpheres) if (h.tag === 'lobe' && h.index === i) h.r = l.alive && swell > 0.3 && !this.dead ? l.radius * 0.95 : 0;
    }
    this.rootGlow.emissiveIntensity = (0.25 + beat * 0.25 + this.dreamT * 1.2) * fade;
    this.throatGlow.emissiveIntensity = (0.8 + Math.max(0, breath) * 1.4 + this.raiseT * 2 + this.dreamT * 1.5) * fade;
    // Mouth: dilates on the inhale, puckers on the exhale, convulses when it raises the dead.
    const dil = 1 + breath * 0.18 + this.raiseT * Math.sin(t * 20) * 0.06;
    this.mouth.scale.set(dil, 1 - breath * 0.05, dil);
    this.cilia.forEach((m, k) => {
      const lean = this.dead ? 0.5 * Math.min(1, this.deadFor) : breath * 0.35;
      m.rotation.set(0, Math.sin(t * (0.7 + k * 0.2)) * 0.04 * fade, 0);
      m.scale.set(1 - lean * 0.25, 1 - Math.abs(lean) * 0.2 + Math.sin(t * 2.6 + k) * 0.04 * fade, 1 - lean * 0.25);
    });
    // The updraft: dust drawn into the mouth on the inhale, blown up and out on the exhale.
    if (!this.dead && Math.abs(breath) > 0.3 && this.rand() < dt * 10 * Math.abs(breath)) {
      const a = this.rand() * Math.PI * 2, r = MOUTH * (breath > 0 ? 2.5 : 0.6);
      const p = this.risePoint.getWorldPosition(new THREE.Vector3()).add(V(Math.cos(a) * r, 0, Math.sin(a) * r));
      this.fx.puff(p, 0.4 + this.rand() * 0.4, breath > 0 ? 0.5 : 6, 1.6);
    }
    this.fx.update(dt);
    this.root.updateMatrixWorld(true);
    for (const h of this.hitSpheres) h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
    for (const w of this.weakPoints) w.mesh.getWorldPosition(w.world);
  }
}
