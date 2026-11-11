import * as THREE from 'three';
import { HIVE, PATH, ZONE7 } from '../render/palette';
import { bioNode, bioTime, chitin, livingFlesh } from '../render/materials';
import { mutation } from '../render/dissolve';
import { gore } from '../render/gore';
import { meshSdf, traceSkin, type SdfPrim } from './sdf';
import { pustule, rng, spike, taperTube, merge } from './parts';

/**
 * The host's first-person forearm and its virus mutations (docs/gdd/larva-milestone.md, data/viruses.json):
 *   plagueStalkerStrain  violet pustules spread up the forearm along infected veins
 *   adrenalineVirus      amber veins swell under translucent skin and pulse with the heartbeat
 *   splicedParasites     segmented larvae writhe under the skin and burst out on kills
 * `mutate(virus)` dissolve-grows the arm into the new look over `duration` (VIRUS_RULES.mutationGrowTime).
 *
 * Local space: the wrist at the origin, the forearm running up +Y to the elbow at y = LENGTH, top of the
 * forearm toward +Z. `attachToViewmodel` lines it up with the Synapse Burster's grip.
 */

export type VirusLook = 'plagueStalkerStrain' | 'adrenalineVirus' | 'splicedParasites';
export const VIRUS_LOOKS: VirusLook[] = ['plagueStalkerStrain', 'adrenalineVirus', 'splicedParasites'];

const LENGTH = 0.36;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;

/** Infiltrator forearm: slim, two muscle bellies, a bone ridge, a bulbous wrist joint. */
function forearmPrims(swell = 0): SdfPrim[] {
  const s = 1 + swell;
  return [
    { shape: 'cone', a: V(0, 0.0, 0), b: V(0, LENGTH, 0), ra: 0.034 * s, rb: 0.05 * s, bone: 0 },
    { shape: 'ellipsoid', a: V(0.012, LENGTH * 0.62, -0.012), radii: V(0.045, 0.11, 0.04).multiplyScalar(s), blend: 0.03, bone: 0 },
    { shape: 'ellipsoid', a: V(-0.016, LENGTH * 0.45, 0.008), radii: V(0.036, 0.1, 0.038).multiplyScalar(s), blend: 0.03, bone: 0 },
    { shape: 'cone', a: V(0, 0.03, 0.03), b: V(0, LENGTH * 0.9, 0.045), ra: 0.012, rb: 0.016, blend: 0.02, bone: 0, tint: new THREE.Color(1.6, 1.5, 1.3) },
    { shape: 'ellipsoid', a: V(0, -0.005, 0), radii: V(0.042, 0.03, 0.04), blend: 0.02, bone: 0 },
    { shape: 'ellipsoid', a: V(0, LENGTH + 0.02, 0), radii: V(0.06, 0.05, 0.058), blend: 0.03, bone: 0 },
  ];
}

const skinCache = new Map<number, THREE.BufferGeometry>();
function forearmGeometry(swell = 0): THREE.BufferGeometry {
  let g = skinCache.get(swell);
  if (!g) {
    g = meshSdf(forearmPrims(swell), 1, { resolution: 44, noise: { amp: 0.0012, freq: 140, seed: 3 } }).geometry;
    skinCache.set(swell, g);
  }
  return g;
}

/** Random points on the forearm skin, ordered wrist to elbow, for growths that spread upward. */
function skinPoints(n: number, seed: number, swell = 0): { at: THREE.Vector3; normal: THREE.Vector3 }[] {
  const r = rng(seed), prims = forearmPrims(swell), out: { at: THREE.Vector3; normal: THREE.Vector3 }[] = [];
  for (let i = 0; i < n; i++) {
    const y = 0.03 + (i / n) * (LENGTH - 0.03) + (r() - 0.5) * 0.02;
    const a = (r() - 0.5) * Math.PI * 1.3 + Math.PI / 2; // mostly the top and outer side (what the camera sees)
    const dir = V(Math.cos(a), 0, Math.sin(a));
    const hit = traceSkin(prims, V(0, y, 0).addScaledVector(dir, 0.3), dir.clone().negate(), 0.5);
    if (hit) out.push({ at: hit.at, normal: hit.normal });
  }
  return out;
}

/** Veins as tubes snaking along the skin from the wrist to the elbow. */
function veinGeometry(seed: number, count: number, radius: number, swell = 0): THREE.BufferGeometry {
  const r = rng(seed), prims = forearmPrims(swell), parts: THREE.BufferGeometry[] = [];
  for (let v = 0; v < count; v++) {
    const a0 = Math.PI / 2 + (r() - 0.5) * 2.2;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 7; k++) {
      const y = 0.01 + (k / 7) * (LENGTH - 0.02);
      const a = a0 + Math.sin(k * 1.3 + v * 2) * 0.35;
      const dir = V(Math.cos(a), 0, Math.sin(a));
      const hit = traceSkin(prims, V(0, y, 0).addScaledVector(dir, 0.3), dir.clone().negate(), 0.5);
      if (hit) pts.push(hit.at.addScaledVector(hit.normal, radius * 0.2));
    }
    if (pts.length >= 3) parts.push(taperTube(pts, pts.map((_, i) => radius * (1.1 - (i / pts.length) * 0.4)), 5, 3));
  }
  return merge(parts);
}

interface Larva { root: THREE.Group; segs: THREE.Mesh[]; base: THREE.Vector3; normal: THREE.Vector3; phase: number }

export class HostArm {
  readonly root = new THREE.Group();
  /** The current visible look (base arm or a mutated arm); swapped by mutate(). */
  private look: THREE.Group;
  private virus: VirusLook | null = null;
  private veins: THREE.MeshStandardMaterial[] = [];
  private pustules: { mesh: THREE.Mesh; t: number }[] = [];
  private larvae: Larva[] = [];
  private time = 0;
  private sinceMutate = 99;
  private duration = 2.5;

  constructor() {
    this.root.name = 'host-arm';
    this.look = this.build(null);
    this.root.add(this.look);
  }

  get current(): VirusLook | null { return this.virus; }

  /** Build the arm for a virus look (null = clean host). */
  private build(virus: VirusLook | null): THREE.Group {
    const g = new THREE.Group();
    g.name = `arm:${virus ?? 'clean'}`;
    this.veins = [];
    this.pustules = [];
    this.larvae = [];
    const base = new THREE.Color(ZONE7.void).lerp(new THREE.Color(HIVE.panel), 0.5).lerp(new THREE.Color(HIVE.bone), 0.18);
    const swell = virus === 'adrenalineVirus' ? 0.06 : 0;
    // Adrenaline turns the skin translucent and amber-veined; the others keep the host's teal-grey hide.
    const skin = virus === 'adrenalineVirus'
      ? livingFlesh(hex(base.clone().lerp(new THREE.Color(PATH.melee), 0.18)), hex(new THREE.Color(PATH.melee).multiplyScalar(0.9)), PATH.melee, 26)
      : livingFlesh(hex(base), hex(new THREE.Color(virus === 'plagueStalkerStrain' ? PATH.viral : HIVE.acid).multiplyScalar(0.35)), ZONE7.cyan, 26);
    skin.vertexColors = true;
    if (virus === 'adrenalineVirus') { skin.transparent = true; skin.opacity = 0.88; }
    g.add(new THREE.Mesh(forearmGeometry(swell), skin));

    // Chitin bracers and a couple of wrist spurs: the Infiltrator's armour.
    const plates = chitin(hex(base.clone().multiplyScalar(1.6)), HIVE.acid, 30);
    const r = rng(11), plateGeo: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const y = 0.05 + i * 0.07;
      const ring = new THREE.TorusGeometry(0.045 + y * 0.03 + swell * 0.04, 0.006, 5, 18, Math.PI * 0.9);
      ring.rotateX(Math.PI / 2); ring.rotateY(-Math.PI * 0.05 + r() * 0.1);
      ring.translate(0, y, 0);
      plateGeo.push(ring);
    }
    for (let i = 0; i < 2; i++) plateGeo.push(spike(0.05, 0.007, 0.4).rotateX(-0.9).translate(-0.02 + i * 0.03, 0.02, 0.035));
    g.add(new THREE.Mesh(merge(plateGeo), plates));

    if (virus === 'plagueStalkerStrain') {
      // Infected veins and violet pustules climbing the forearm.
      const veinMat = bioNode(PATH.viral, 3.2);
      this.veins.push(veinMat);
      g.add(new THREE.Mesh(veinGeometry(5, 6, 0.0035), veinMat));
      skinPoints(22, 21).forEach((p, i) => {
        const m = new THREE.Mesh(pustule(0.008 + (i % 4) * 0.004, i), bioNode(ZONE7.violet, 2.6 + (i % 3)));
        m.position.copy(p.at);
        m.quaternion.setFromUnitVectors(V(0, 1, 0), p.normal);
        m.scale.setScalar(0.001);
        g.add(m);
        this.pustules.push({ mesh: m, t: p.at.y / LENGTH });
      });
    } else if (virus === 'adrenalineVirus') {
      // Swollen amber veins pulsing under the skin.
      const veinMat = bioNode(PATH.melee, 1.4);
      this.veins.push(veinMat);
      g.add(new THREE.Mesh(veinGeometry(9, 8, 0.0055, swell), veinMat));
    } else if (virus === 'splicedParasites') {
      // Larvae under translucent blisters.
      const blister = livingFlesh(hex(base.clone().lerp(new THREE.Color(HIVE.bone), 0.4)), hex(new THREE.Color(HIVE.acid).multiplyScalar(0.5)), HIVE.acid, 40);
      blister.transparent = true; blister.opacity = 0.55;
      const grub = bioNode(HIVE.acid, 5);
      skinPoints(5, 33).forEach((p, i) => {
        const lr = new THREE.Group();
        lr.position.copy(p.at).addScaledVector(p.normal, -0.004);
        lr.quaternion.setFromUnitVectors(V(0, 1, 0), p.normal);
        const segs: THREE.Mesh[] = [];
        for (let k = 0; k < 5; k++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.0065 - k * 0.0008, 8, 6), grub);
          s.position.set(0, 0, (k - 2) * 0.008);
          lr.add(s);
          segs.push(s);
        }
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8).scale(0.7, 0.35, 1.5), blister);
        lr.add(cap);
        g.add(lr);
        this.larvae.push({ root: lr, segs, base: lr.position.clone(), normal: p.normal.clone(), phase: i * 1.7 });
      });
      this.veins.push(grub);
    }
    g.traverse((o) => { o.frustumCulled = false; const m = (o as THREE.Mesh).material as THREE.Material & { fog?: boolean }; if (m && 'fog' in m) m.fog = false; });
    return g;
  }

  /** Dissolve-grow into a virus look (a second virus replaces the first). */
  mutate(virus: VirusLook, duration = 2.5): void {
    if (virus === this.virus) return;
    this.virus = virus;
    this.duration = duration;
    this.sinceMutate = 0;
    const old = this.look;
    const next = this.build(virus);
    this.root.add(next);
    this.look = next;
    mutation.swap(old, next, { duration, colour: virus === 'plagueStalkerStrain' ? PATH.viral : virus === 'adrenalineVirus' ? PATH.melee : HIVE.acid, done: () => old.removeFromParent() });
  }

  /** Spliced Parasites: a larva tears out of the arm on a kill. */
  onKill(scene: THREE.Object3D): void {
    if (this.virus !== 'splicedParasites' || !this.larvae.length) return;
    const l = this.larvae[Math.floor(Math.random() * this.larvae.length)];
    const at = l.root.getWorldPosition(new THREE.Vector3());
    gore.burst(scene, { point: at, normal: l.normal.clone().transformDirection(l.root.matrixWorld), colour: HIVE.acid, count: 18, speed: 2.5 });
    l.phase += 10; // a violent writhe
  }

  update(dt: number): void {
    this.time += dt;
    this.sinceMutate += dt;
    const t = this.time;
    // Pustules erupt in order from wrist to elbow during the mutation, then throb.
    const grow = Math.min(1, this.sinceMutate / this.duration);
    for (const p of this.pustules) {
      const k = THREE.MathUtils.clamp((grow * 1.3 - p.t) * 4, 0, 1);
      p.mesh.scale.setScalar(Math.max(0.001, k * (1 + Math.sin(t * 3 + p.t * 20) * 0.08)));
    }
    // Heartbeat: a double thump.
    const beat = Math.pow(Math.max(0, Math.sin(t * 7.5)), 8) + 0.6 * Math.pow(Math.max(0, Math.sin(t * 7.5 - 0.9)), 8);
    for (const v of this.veins) v.emissiveIntensity = this.virus === 'adrenalineVirus' ? 0.6 + beat * 2.4 : 1;
    // Larvae crawl back and forth under the blisters.
    for (const l of this.larvae) {
      l.phase += dt * 2.2;
      l.segs.forEach((s, k) => { s.position.x = Math.sin(l.phase * 2 + k * 0.9) * 0.004; s.position.y = Math.max(0, Math.sin(l.phase * 3 + k)) * 0.002; });
      l.root.position.copy(l.base).addScaledVector(V(0, 1, 0), Math.sin(l.phase * 0.5) * 0.01);
    }
    void bioTime;
  }
}

/**
 * Mount the arm on the Synapse Burster viewmodel: it replaces the plain wrist cylinder under the grip and
 * follows the gun's sway and recoil. `gun` is the viewmodel's gun group (the first group under view.root).
 */
export function attachToViewmodel(view: { root: THREE.Object3D; arm?: THREE.Object3D }, arm: HostArm): boolean {
  // Gameplay keeps the hand in `view.arm` ('host-arm'); older views keep it straight in the gun group.
  let wrist: THREE.Mesh | undefined;
  (view.arm ?? view.root).traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (!wrist && g instanceof THREE.CylinderGeometry && g.parameters.height === 0.3) wrist = o as THREE.Mesh;
  });
  const parent = wrist?.parent ?? view.arm
    ?? (view.root.children.find((o) => o instanceof THREE.Group && o !== arm.root) as THREE.Group | undefined);
  if (!parent) return false;
  if (wrist) {
    // Cylinder +Y runs up the forearm toward the elbow; its base end sits at the hand.
    const axis = V(0, 1, 0).applyQuaternion(wrist.quaternion);
    arm.root.position.copy(wrist.position).addScaledVector(axis, -0.15);
    arm.root.quaternion.copy(wrist.quaternion);
    arm.root.scale.setScalar(1.05);
    wrist.visible = false;
  } else {
    arm.root.position.set(0.04, -0.3, 0.12);
    arm.root.rotation.set(0.9, 0, -0.3);
  }
  parent.add(arm.root);
  return true;
}
