/**
 * Brood Heart nest entity (Larva set piece, data/nests.json). PvE AI owns the logic: Biomass, ventricle weak points,
 * waves through src/ai's WaveDirector, and hit tests. The body is Creature & Mutation's (src/creatures/broodheart.ts,
 * same NestBody shape); until it lands a stand-in heart built here fills in. The raid owns spawning, gore, the
 * shockwave and the Brood Cache.
 */
import * as THREE from 'three';
import { NESTS, type Nest } from '../../data';
import { WaveDirector, type NestSpawn } from '../ai';
import { HIVE, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, chitin, livingFlesh } from '../render/materials';
import { groundHeight } from '../world/zone7';
import { segmentSphere } from './projectiles';
import { organic } from './viewmodel';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The body contract Creature's BroodHeart implements. */
export interface NestBody {
  readonly root: THREE.Object3D;
  readonly weakPoints: { mesh: THREE.Object3D; world: THREE.Vector3; radius: number; alive: boolean }[];
  /** Body hit sphere, centre in root space. */
  readonly body: { centre: THREE.Vector3; radius: number };
  readonly alive: boolean;
  refresh(): void;
  /** A wave is born: heave and vent. */
  pulse(): void;
  popWeakPoint(i: number): void;
  /** 0..1 damage taken: the beat falters. */
  hurt(fraction: number): void;
  destroy(): void;
  update(dt: number): void;
}

/** Stand-in heart until Creature's body lands: a half-buried flesh sphere in a bone cage with four ventricles. */
export class StandInHeart implements NestBody {
  readonly root = new THREE.Group();
  readonly weakPoints: NestBody['weakPoints'] = [];
  readonly body = { centre: new THREE.Vector3(0, 1.4, 0), radius: 2.1 };
  alive = true;
  private core: THREE.Mesh;
  private beat = 0;
  private heave = 0;
  private falter = 0;
  private dying = -1;

  constructor(count: number) {
    this.core = new THREE.Mesh(organic(new THREE.SphereGeometry(2.2, 40, 28), 0.22, 1.6, 7), livingFlesh(ZONE7_SHADE.flesh, ZONE7.violet, ZONE7.magenta, 9));
    this.core.position.copy(this.body.centre);
    this.root.add(this.core);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const rib = new THREE.TorusGeometry(2.45, 0.11, 6, 24, Math.PI * 0.75);
      rib.rotateZ(Math.PI * 0.12); rib.rotateY((i / 6) * Math.PI * 2); rib.translate(0, 1.2, 0);
      parts.push(rib.toNonIndexed());
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + i * 0.37;
      const pts = [new THREE.Vector3(Math.cos(a) * 1.6, 0.9, Math.sin(a) * 1.6), new THREE.Vector3(Math.cos(a) * 3.2, 0.2, Math.sin(a) * 3.2), new THREE.Vector3(Math.cos(a + 0.3) * 5, -0.3, Math.sin(a + 0.3) * 5)];
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.22 - (i % 3) * 0.04, 6).toNonIndexed());
    }
    this.root.add(new THREE.Mesh(mergeGeometries(parts), chitin(HIVE.bone, ZONE7.violet, 2)));
    const ventGeo = organic(new THREE.SphereGeometry(0.55, 18, 12), 0.08, 3, 3);
    const ventMat = bioNode(ZONE7.violet, 3.2);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.4;
      const m = new THREE.Mesh(ventGeo, ventMat);
      m.position.set(Math.cos(a) * 1.5, 2.85, Math.sin(a) * 1.5);
      this.root.add(m);
      this.weakPoints.push({ mesh: m, world: new THREE.Vector3(), radius: 0.6, alive: true });
    }
  }

  refresh(): void {
    this.root.updateMatrixWorld(true);
    for (const w of this.weakPoints) w.mesh.getWorldPosition(w.world);
  }
  pulse(): void { this.heave = 1; }
  popWeakPoint(i: number): void { const w = this.weakPoints[i]; if (w) { w.alive = false; w.mesh.scale.setScalar(0.3); } }
  hurt(fraction: number): void { this.falter = fraction; }
  destroy(): void { this.alive = false; this.dying = 0; }
  update(dt: number): void {
    if (this.dying >= 0) {
      this.dying += dt;
      const s = Math.max(0.05, 1 - this.dying * 0.6);
      this.core.scale.set(1.1 * s + 0.1, 0.5 * s, 1.1 * s + 0.1);
      return;
    }
    this.heave = Math.max(0, this.heave - dt * 1.5);
    this.beat += dt * (1.6 + this.falter * 2.5) * (1 + this.heave);
    const p = 1 + Math.max(0, Math.sin(this.beat * Math.PI)) ** 6 * (0.06 + this.heave * 0.12);
    this.core.scale.set(p, 0.85 * p, 1.1 * p);
  }
}

export interface NestHit { t: number; vent: number | null }

export class BroodNest {
  readonly t: Nest;
  readonly director: WaveDirector;
  biomass: number;
  /** Remaining Biomass per ventricle; a popped ventricle takes body damage like the rest. */
  readonly ventricles: number[];
  /** Ids of creatures this nest spawned (for the alive cap). */
  readonly brood = new Set<number>();
  private readonly centre = new THREE.Vector3();

  constructor(readonly id: string, readonly type: string, readonly x: number, readonly z: number, readonly body: NestBody, rand: () => number = Math.random) {
    this.t = NESTS[type];
    if (!this.t) throw new Error(`unknown nest ${type}`);
    this.biomass = this.t.biomass;
    this.ventricles = Array.from({ length: this.t.weakPoints.count }, () => this.t.weakPoints.biomassEach);
    this.director = new WaveDirector(this.t, x, z, rand);
    body.root.position.set(x, groundHeight(x, z), z);
    body.refresh();
  }

  get alive(): boolean { return this.director.state !== 'destroyed'; }
  get state(): string { return this.director.state; }
  get fraction(): number { return this.biomass / this.t.biomass; }
  get position(): THREE.Vector3 { return this.body.root.position; }
  get wave(): number { return this.director.wave; }
  get waves(): number { return Math.min(this.t.maxWaves, this.t.waves.length); }
  isLiveVentricle(i: number): boolean { return (this.ventricles[i] ?? 0) > 0; }

  /** World centre of the body sphere. */
  core(out = this.centre): THREE.Vector3 { return out.copy(this.body.body.centre).add(this.body.root.position); }

  /**
   * Advances the nest. `hostDistance` wakes it; `aliveBrood` is how many of its spawn still live.
   * Returns creatures to spawn this frame (eject positions and velocities from the WaveDirector).
   */
  update(dt: number, hostDistance: number, aliveBrood: number): NestSpawn[] {
    this.body.update(dt);
    if (!this.alive) return [];
    const out = this.director.update(dt, hostDistance, aliveBrood);
    if (out.length) this.body.pulse();
    return out;
  }

  /** Nearest sphere a segment crosses: a live ventricle or the body. */
  hit(a: THREE.Vector3, b: THREE.Vector3): NestHit | null {
    if (!this.alive) return null;
    let best: NestHit | null = null;
    this.body.weakPoints.forEach((w, i) => {
      if (!this.isLiveVentricle(i)) return;
      const t = segmentSphere(a, b, w.world, w.radius);
      if (t !== null && (!best || t < best.t)) best = { t, vent: i };
    });
    const t = segmentSphere(a, b, this.core(), this.body.body.radius);
    if (t !== null && (!best || t < (best as NestHit).t)) best = { t, vent: null };
    return best;
  }

  /** Applies damage (×multiplier on a live ventricle). Wakes a dormant nest. Returns true on the killing hit. */
  damage(amount: number, vent: number | null = null): boolean {
    if (!this.alive || amount <= 0) return false;
    if (this.director.state === 'dormant') this.director.update(0, 0, this.brood.size);
    let dealt = amount;
    if (vent !== null && this.isLiveVentricle(vent)) {
      dealt = amount * this.t.weakPoints.multiplier;
      this.ventricles[vent] = Math.max(0, this.ventricles[vent] - dealt);
      if (this.ventricles[vent] === 0) this.body.popWeakPoint(vent);
    }
    this.biomass = Math.max(0, this.biomass - dealt);
    this.body.hurt(1 - this.fraction);
    if (this.biomass > 0) return false;
    this.director.destroy();
    this.body.destroy();
    return true;
  }
}
