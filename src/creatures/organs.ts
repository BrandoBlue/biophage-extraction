import * as THREE from 'three';
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../render/palette';
import { alienEye, bioNode, chitin, crystal, goreFluid, livingFlesh, membrane } from '../render/materials';
import { mutation } from '../render/dissolve';
import { gore } from '../render/gore';
import { merge, needleRing, rng, roughen, spike, taperTube } from './parts';

/**
 * Harvest organs (docs/gdd/larva-milestone.md, "Corpse harvesting") and the wet, glowing cut that frees
 * them. Organs are hand-sized (10 to 25 cm), modelled so the item reads at a glance in the hand:
 *   needlemawGland   a pink teardrop sac with a glowing duct and a crown of needles
 *   cantorSongSac    a translucent ribbed bladder with acid sloshing inside
 *   glasswalkerLens  a glass lens set in a fleshy iris ring, trailing its nerve
 *   oculimothEye     a whole eye with its optic stalk
 *   mournbackMarrow  a cracked bone shaft with glowing marrow
 * Anything else gets a generic glowing organ, so new data items never crash the cut.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const dim = (c: string, k: number) => hex(new THREE.Color(c).multiplyScalar(k));

function blob(r: number, sx: number, sy: number, sz: number, seed: number, segs = 20): THREE.BufferGeometry {
  return roughen(new THREE.SphereGeometry(r, segs, Math.round(segs * 0.75)).scale(sx, sy, sz), r * 0.08, 9 / r, seed);
}

function nerve(len: number, r: number, seed: number): THREE.BufferGeometry {
  const rand = rng(seed);
  const pts = [V(0, 0, 0)];
  for (let i = 1; i <= 4; i++) pts.push(V((rand() - 0.5) * len * 0.25, -len * i / 4, (rand() - 0.5) * len * 0.25));
  return taperTube(pts, [r, r * 0.8, r * 0.6, r * 0.4, r * 0.15], 6, 3);
}

/** Build the organ mesh for a loot item id. Origin at the organ's centre. */
export function organMesh(item: string): THREE.Group {
  const g = new THREE.Group();
  g.name = `organ:${item}`;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, at?: THREE.Vector3) => {
    const m = new THREE.Mesh(geo, mat);
    if (at) m.position.copy(at);
    g.add(m);
    return m;
  };
  switch (item) {
    case 'needlemawGland': {
      add(blob(0.05, 1, 1.5, 1, 1).translate(0, -0.02, 0), livingFlesh(ZONE7_SHADE.flesh, dim(ZONE7.magenta, 0.6), ZONE7.magenta, 9));
      add(nerve(0.06, 0.012, 2).translate(0, -0.08, 0), bioNode(ZONE7.magenta, 2.6));
      add(needleRing(0.022, 9, 0.05, rng(3), -0.3).translate(0, 0.05, 0), chitin(HIVE.bone, ZONE7.magenta, 8));
      break;
    }
    case 'cantorSongSac': {
      const ribs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) {
        const y = -0.07 + i * 0.035, r = 0.095 * Math.sqrt(1 - (y / 0.12) ** 2);
        ribs.push(new THREE.TorusGeometry(r, 0.006, 5, 22).rotateX(Math.PI / 2).translate(0, y, 0));
      }
      add(merge(ribs), livingFlesh(dim(HIVE.panel, 1.4), dim(HIVE.acid, 0.5), HIVE.acid, 7));
      add(blob(0.045, 1, 1.1, 1, 4, 16), bioNode(HIVE.acid, 1.5));
      add(blob(0.1, 1, 1.2, 1, 5), membrane(HIVE.acid, 0.28));
      add(nerve(0.07, 0.016, 6).translate(0, -0.11, 0), livingFlesh(ZONE7_SHADE.flesh, dim(HIVE.acid, 0.4), HIVE.acid, 9));
      break;
    }
    case 'glasswalkerLens': {
      add(new THREE.SphereGeometry(0.075, 28, 16).scale(1, 1, 0.38), crystal(ZONE7.cyan));
      add(roughen(new THREE.TorusGeometry(0.078, 0.018, 10, 28), 0.004, 60, 7), livingFlesh(ZONE7_SHADE.moss, dim(ZONE7.cyan, 0.5), ZONE7.cyan, 9));
      add(nerve(0.12, 0.014, 8).rotateX(Math.PI / 2).translate(0, 0, -0.02), bioNode(ZONE7.cyan, 2));
      break;
    }
    case 'oculimothEye': {
      // alienEye looks along local -Z: turn it to face the viewer's side.
      add(new THREE.SphereGeometry(0.045, 28, 18), alienEye(PATH.melee, HIVE.bone));
      add(nerve(0.09, 0.016, 9).rotateX(-Math.PI / 2).translate(0, 0, 0.035), livingFlesh(ZONE7_SHADE.flesh, dim(ZONE7.magenta, 0.5), ZONE7.magenta, 9));
      break;
    }
    case 'mournbackMarrow': {
      const shaft = new THREE.CylinderGeometry(0.035, 0.042, 0.2, 14, 6, true);
      add(roughen(shaft, 0.004, 40, 10), chitin(HIVE.bone, PATH.melee, 9));
      add(blob(0.05, 1, 0.5, 1, 11).translate(0, -0.11, 0), chitin(HIVE.bone, PATH.melee, 9));
      add(new THREE.CylinderGeometry(0.028, 0.03, 0.2, 12).translate(0, 0.01, 0), bioNode(PATH.melee, 1.8));
      const shards: THREE.BufferGeometry[] = [];
      const rand = rng(12);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        shards.push(spike(0.03 + rand() * 0.03, 0.01, 0.1).rotateZ(-a * 0.2).translate(Math.cos(a) * 0.033, 0.1, Math.sin(a) * 0.033));
      }
      add(merge(shards), chitin(HIVE.bone, PATH.melee, 9));
      break;
    }
    default: {
      add(blob(0.06, 1.2, 1, 1, 13), livingFlesh(ZONE7_SHADE.flesh, dim(ZONE7.violet, 0.5), ZONE7.violet, 9));
      add(blob(0.018, 1, 1, 1, 14, 10), bioNode(ZONE7.violet, 2.2), V(0.03, 0.04, 0.03));
    }
  }
  return g;
}

interface Flight { organ: THREE.Group; from: THREE.Vector3; hand: THREE.Object3D; t: number; held: boolean }

/**
 * The harvest cut. `progress` opens a glowing wound on the corpse that spurts as the hold goes on;
 * `done` pulls the organ out into the host's hand, where it throbs briefly before it is stowed
 * (dissolves into the cavities). `cancel` leaves the wound but stops the spurting.
 */
export class HarvestFx {
  private wound: THREE.Mesh | null = null;
  private woundAt = new THREE.Vector3();
  private colour = ZONE7.violet as string;
  private sinceSpurt = 0;
  private flights: Flight[] = [];
  private scene: THREE.Object3D | null = null;
  private p = 0;

  get active(): number { return this.flights.length + (this.wound ? 1 : 0); }

  progress(scene: THREE.Object3D, corpse: { centre: THREE.Vector3; fluid: THREE.Color }, p: number): void {
    this.scene = scene;
    this.p = p;
    if (!this.wound) {
      this.colour = `#${corpse.fluid.getHexString()}`;
      const mat = goreFluid(this.colour);
      mat.emissive.set(this.colour);
      mat.emissiveIntensity = 2.2;
      this.wound = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8).scale(0.04, 0.03, 0.32), mat);
      this.wound.name = 'harvest-wound';
      this.woundAt.copy(corpse.centre);
      this.wound.position.copy(corpse.centre);
      this.wound.rotation.y = Math.random() * Math.PI;
      scene.add(this.wound);
      gore.burst(scene, { point: corpse.centre.clone(), colour: this.colour, count: 14, speed: 2.5 });
    }
    // The slit lengthens and gapes as the cut goes deeper.
    this.wound.scale.set(0.6 + p * 1.2, 1, 0.2 + p * 0.9);
  }

  cancel(): void {
    this.p = 0;
    this.wound = null; // the wound stays on the corpse; it just stops growing
  }

  done(scene: THREE.Object3D, item: string, from: THREE.Vector3, hand: THREE.Object3D): THREE.Group {
    this.scene = scene;
    if (this.wound) gore.burst(scene, { point: this.woundAt.clone(), colour: this.colour, count: 40, speed: 5 });
    this.wound = null;
    this.p = 0;
    const organ = organMesh(item);
    organ.position.copy(from);
    organ.traverse((o) => { o.frustumCulled = false; });
    scene.add(organ);
    this.flights.push({ organ, from: from.clone(), hand, t: 0, held: false });
    return organ;
  }

  update(dt: number): void {
    if (this.wound && this.scene && this.p > 0) {
      this.sinceSpurt += dt;
      if (this.sinceSpurt > 0.35) {
        this.sinceSpurt = 0;
        gore.burst(this.scene, { point: this.woundAt.clone(), normal: V(0, 1, 0), colour: this.colour, count: 6, speed: 2 + this.p * 2 });
      }
    }
    const to = new THREE.Vector3();
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      if (!f.held) {
        // Rip out, arc up, land in the palm.
        const k = Math.min(1, f.t / 0.55), e = k * k * (3 - 2 * k);
        f.hand.getWorldPosition(to);
        f.organ.position.lerpVectors(f.from, to, e);
        f.organ.position.y += Math.sin(k * Math.PI) * 0.35;
        f.organ.rotation.x += dt * 9 * (1 - k);
        if (k >= 1) {
          f.held = true;
          f.hand.attach(f.organ);
          f.organ.position.set(0.02, -0.08, 0.1);
          f.organ.userData.base = 0.7 / Math.max(1e-3, f.hand.getWorldScale(to).x);
          f.t = 0;
        }
      } else {
        const beat = Math.pow(Math.max(0, Math.sin(f.t * 8)), 6);
        f.organ.scale.setScalar((f.organ.userData.base as number) * (1 + beat * 0.08));
        if (f.t > 1.1 && !f.organ.userData.stowing) {
          f.organ.userData.stowing = true;
          mutation.dissolveOut(f.organ, { duration: 0.6, colour: this.colour, done: () => f.organ.removeFromParent() });
        }
        if (f.t > 1.8) this.flights.splice(i, 1);
      }
    }
  }
}
