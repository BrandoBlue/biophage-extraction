import * as THREE from 'three';
import { NESTS } from '../../data';
import { HIVE, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, chitin, livingFlesh, membrane } from '../render/materials';
import { mutation } from '../render/dissolve';
import { gore } from '../render/gore';
import { horn, merge, pustule, rng, roughen, taperTube, vent } from './parts';
import { meshSdf, type SdfPrim } from './sdf';

/**
 * The Brood Heart (data/nests.json `broodHeart`): a wave-spawning nest in its crater. A swollen
 * multi-lobed heart, half sunk in the ground, caged by chitin ribs and rooted by arteries. It beats
 * all the time, heaves and vents spores when a wave is born, and carries glowing weak-point
 * pustules (count from data) that pop when shot out. Nest logic (waves, activation, the Brood Cache)
 * is Gameplay's; this is the body it drives:
 *   heart.pulse()            a wave is born
 *   heart.popWeakPoint(i)    a weak point was destroyed
 *   heart.hurt(fraction)     biomass lost, 0..1 (the beat falters and the glow sickens)
 *   heart.destroy()          collapse and burn away
 * Origin at the ground in the crater centre; about 5 m tall.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;

export interface NestWeakPoint { mesh: THREE.Mesh; world: THREE.Vector3; radius: number; alive: boolean }

function heartPrims(): SdfPrim[] {
  return [
    { shape: 'ellipsoid', a: V(0, 1.7, 0), radii: V(1.7, 1.9, 1.5), bone: 0 },
    { shape: 'ellipsoid', a: V(-0.9, 2.5, 0.2), radii: V(1.0, 1.2, 0.95), blend: 0.5, bone: 0 },
    { shape: 'ellipsoid', a: V(0.95, 2.7, -0.2), radii: V(0.9, 1.1, 0.9), blend: 0.5, bone: 0 },
    { shape: 'ellipsoid', a: V(0.2, 0.5, 0), radii: V(2.3, 0.8, 2.0), blend: 0.6, bone: 0, tint: new THREE.Color(0.6, 0.6, 0.7) },
    // Great vessels leaving the crown.
    { shape: 'cone', a: V(-0.4, 3.2, 0), b: V(-0.7, 4.6, 0.3), ra: 0.45, rb: 0.3, blend: 0.3, bone: 0 },
    { shape: 'cone', a: V(0.5, 3.3, 0.1), b: V(0.9, 4.4, -0.4), ra: 0.38, rb: 0.24, blend: 0.3, bone: 0 },
    // Ventricle groove.
    { shape: 'cone', a: V(0.1, 3.0, 1.3), b: V(-0.3, 0.9, 1.5), ra: 0.18, rb: 0.12, subtract: true, blend: 0.2, bone: 0 },
  ];
}

let heartGeo: THREE.BufferGeometry | null = null;
function heartGeometry(): THREE.BufferGeometry {
  heartGeo ??= meshSdf(heartPrims(), 1, { resolution: 56, noise: { amp: 0.05, freq: 3.2, seed: 21 } }).geometry;
  return heartGeo;
}

export class BroodHeart {
  readonly root = new THREE.Group();
  readonly weakPoints: NestWeakPoint[] = [];
  /** Body hit sphere (local), for shots that miss the weak points. */
  readonly body = { centre: V(0, 2, 0), radius: 2.1 };
  private heart: THREE.Mesh;
  private flesh: THREE.MeshPhysicalMaterial;
  private veins: THREE.MeshStandardMaterial;
  private vents: THREE.Object3D[] = [];
  private time = 0;
  private heave = 0;
  private health = 1;
  private dead = false;
  private colour = ZONE7.magenta as string;

  constructor(seed = 1, private scene?: THREE.Object3D) {
    this.root.name = 'brood-heart';
    const rand = rng(seed);
    const fleshBase = hex(new THREE.Color(ZONE7_SHADE.flesh).lerp(new THREE.Color(ZONE7_SHADE.rockDeep), 0.25));
    this.flesh = livingFlesh(fleshBase, hex(new THREE.Color(ZONE7.magenta).multiplyScalar(0.7)), ZONE7.magenta, 3);
    this.flesh.vertexColors = true;
    this.heart = new THREE.Mesh(heartGeometry(), this.flesh);
    this.heart.name = 'heart';
    this.root.add(this.heart);

    // Arteries root the heart into the crater floor.
    this.veins = bioNode(ZONE7.magenta, 1.1);
    const roots: THREE.BufferGeometry[] = [], glows: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand() * 0.4, reach = 3.5 + rand() * 3;
      const pts = [V(Math.cos(a) * 1.4, 1.1, Math.sin(a) * 1.2)];
      for (let k = 1; k <= 4; k++) {
        const d = 1.4 + (reach - 1.4) * (k / 4);
        pts.push(V(Math.cos(a + (rand() - 0.5) * 0.3) * d, 1.1 * (1 - k / 4) ** 1.5 + 0.05, Math.sin(a + (rand() - 0.5) * 0.3) * d));
      }
      roots.push(taperTube(pts, [0.42, 0.34, 0.26, 0.16, 0.06], 8, 4));
      glows.push(taperTube(pts.map((p) => p.clone().add(V(0, 0.18, 0))), [0.07, 0.06, 0.05, 0.03, 0.01], 5, 4));
    }
    this.root.add(new THREE.Mesh(roughen(merge(roots), 0.05, 2.5, 22), livingFlesh(hex(new THREE.Color(ZONE7_SHADE.flesh).multiplyScalar(0.7)), hex(new THREE.Color(ZONE7.magenta).multiplyScalar(0.5)), ZONE7.magenta, 4)));
    this.root.add(new THREE.Mesh(merge(glows), this.veins));

    // A cage of chitin ribs arching over the heart.
    const ribs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const rib = horn(4.4 + rand() * 0.8, 0.22, 1.1, rand);
      rib.rotateZ(0.5).rotateY(-a).translate(Math.cos(a) * 2.4, 0.1, Math.sin(a) * 2.2);
      ribs.push(rib);
    }
    this.root.add(new THREE.Mesh(merge(ribs), chitin(hex(new THREE.Color(HIVE.bone).multiplyScalar(0.6)), ZONE7.magenta, 3)));

    // Spore vents on the crown.
    const ventMat = chitin(hex(new THREE.Color(ZONE7_SHADE.rock).multiplyScalar(0.9)), ZONE7.violet, 4);
    for (const [x, y, z] of [[-0.7, 4.55, 0.3], [0.9, 4.35, -0.4], [0.1, 3.6, -1.0]] as const) {
      const v = new THREE.Mesh(vent(0.32, 0.45), ventMat);
      v.position.set(x, y, z);
      v.lookAt(x * 2, y + 2, z * 2);
      v.rotateX(Math.PI / 2);
      this.root.add(v);
      this.vents.push(v);
    }

    // Membrane egg sacs clustered at the base, where the waves are born.
    const sacs = new THREE.Group();
    const sacMat = membrane(ZONE7.magenta, 0.5);
    const embryo = bioNode(ZONE7.lime, 1.6);
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2, d = 1.9 + rand() * 0.6, r = 0.35 + rand() * 0.25;
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), sacMat);
      s.position.set(Math.cos(a) * d, r * 0.7, Math.sin(a) * d);
      const e = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 10, 8).scale(1, 0.6, 1.4), embryo);
      s.add(e);
      sacs.add(s);
    }
    this.root.add(sacs);

    // Weak points from data: glowing pustules around the heart's flanks.
    const n = NESTS.broodHeart?.weakPoints.count ?? 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.6, y = 1.6 + (i % 2) * 1.0;
      const m = new THREE.Mesh(pustule(0.38, 30 + i), bioNode(HIVE.acid, 3 + i * 0.4));
      m.position.set(Math.cos(a) * 1.65, y, Math.sin(a) * 1.45);
      m.lookAt(Math.cos(a) * 4, y, Math.sin(a) * 4);
      m.rotateX(Math.PI / 2);
      m.name = `weak${i}`;
      this.root.add(m);
      this.weakPoints.push({ mesh: m, world: new THREE.Vector3(), radius: 0.45, alive: true });
    }
    this.root.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    this.refresh();
  }

  get alive(): boolean { return !this.dead; }

  /** Update weak point world positions (call after moving the root). */
  refresh(): void {
    this.root.updateMatrixWorld(true);
    for (const w of this.weakPoints) w.mesh.getWorldPosition(w.world);
  }

  /** A wave is born: a hard contraction and spores out of the vents. */
  pulse(): void {
    if (this.dead) return;
    this.heave = 1;
    if (this.scene) {
      const p = new THREE.Vector3();
      for (const v of this.vents) {
        v.getWorldPosition(p);
        gore.burst(this.scene, { point: p.clone(), normal: V(0, 1, 0), colour: ZONE7.violet, count: 22, speed: 6 });
      }
    }
  }

  popWeakPoint(i: number): void {
    const w = this.weakPoints[i];
    if (!w || !w.alive) return;
    w.alive = false;
    if (this.scene) {
      gore.burst(this.scene, { point: w.world.clone(), colour: HIVE.acid, count: 60, speed: 7 });
      gore.splat(this.scene, { point: w.world.clone(), normal: w.world.clone().sub(this.root.getWorldPosition(new THREE.Vector3())).setY(0).normalize(), size: 1.2, colour: HIVE.acid });
    }
    mutation.dissolveOut(w.mesh, { duration: 0.5, colour: HIVE.acid, done: () => { w.mesh.visible = false; } });
    this.heave = Math.max(this.heave, 0.6);
  }

  hurt(fraction: number): void { this.health = THREE.MathUtils.clamp(1 - fraction, 0, 1); }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.scene) {
      const c = this.root.localToWorld(this.body.centre.clone());
      gore.burst(this.scene, { point: c, colour: this.colour, count: 220, speed: 12 });
      gore.splat(this.scene, { point: this.root.getWorldPosition(new THREE.Vector3()).add(V(0, 0.05, 0)), normal: V(0, 1, 0), size: 9, colour: this.colour });
    }
    mutation.dissolveOut(this.heart, { duration: 3.5, colour: ZONE7.magenta });
    for (const w of this.weakPoints) if (w.alive) { w.alive = false; w.mesh.visible = false; }
  }

  update(dt: number): void {
    this.time += dt;
    this.heave = Math.max(0, this.heave - dt * 1.6);
    if (this.dead) {
      // The burst heart slumps into the crater.
      this.heart.scale.y = Math.max(0.35, this.heart.scale.y - dt * 0.25);
      this.veins.emissiveIntensity = Math.max(0, this.veins.emissiveIntensity - dt * 0.5);
      return;
    }
    // Lub-dub, slowing and weakening as it is hurt.
    const rate = 0.9 + this.health * 0.5, t = this.time * rate * Math.PI * 2;
    const beat = Math.pow(Math.max(0, Math.sin(t)), 10) + 0.6 * Math.pow(Math.max(0, Math.sin(t - 0.7)), 10);
    const k = 1 + beat * 0.035 * (0.5 + this.health * 0.5) + this.heave * 0.09;
    this.heart.scale.set(k, 1 + (k - 1) * 0.6, k);
    this.veins.emissiveIntensity = 0.5 + beat * 2.2 * this.health + this.heave * 3;
  }
}
