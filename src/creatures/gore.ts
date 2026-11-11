import * as THREE from 'three';
import { gore } from '../render/gore';
import { goreFluid, bioTime } from '../render/materials';
import { mutation } from '../render/dissolve';
import type { Creature, GroundFn } from './creature';
import { slotMaterial, SLOTS, type LimbRig } from './rig';

/**
 * Creature gore: dismemberment, glowing stumps that pulse fluid, tumbling gibs, and death bursts.
 * Visual only; damage rules stay in gameplay code. Call `creatureGore.update(dt)` once per frame.
 *
 *   creatureGore.sever(scene, creature, 'legL1', impulse)   // shoot a leg off
 *   creatureGore.burstAll(scene, creature)                   // blow a small creature apart on death
 */

interface Gib { mesh: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; age: number; rest: boolean; ground: GroundFn; r: number }
interface Spurt { at: THREE.Object3D; colour: string; left: number; next: number; normal: THREE.Vector3; scene: THREE.Object3D }

const gibs: Gib[] = [];
const spurts: Spurt[] = [];
const GIB_LIFE = 14;
const MAX_GIBS = 40;
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Bake a limb's skinned triangles (in their current pose) into a rigid world-space mesh. */
function bakeLimb(c: Creature, l: LimbRig): THREE.Mesh | null {
  const rig = c.rig, mesh = rig.mesh, geo = mesh.geometry;
  const ranges = rig.limbRanges.get(l.spec.id);
  if (!ranges?.length) return null;
  const idx = geo.index!, pos = geo.attributes.position, nor = geo.attributes.normal;
  mesh.updateMatrixWorld(true);
  rig.skeleton.update();
  const groups = new Map<number, number[]>();
  const outPos: number[] = [], outNor: number[] = [];
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  let centre = new THREE.Vector3(), count = 0;
  for (const r of ranges) {
    const list = groups.get(r.group) ?? [];
    groups.set(r.group, list);
    for (let i = r.start; i < r.start + r.count; i++) {
      const vi = idx.getX(i);
      _v.fromBufferAttribute(pos, vi);
      mesh.applyBoneTransform(vi, _v);
      _v.applyMatrix4(mesh.matrixWorld);
      // Rigid limbs: rotate the normal with the vertex's bone.
      const bi = geo.attributes.skinIndex.getX(vi);
      const bone = rig.skeleton.bones[bi];
      _n.fromBufferAttribute(nor, vi).applyMatrix3(nm);
      const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, rig.skeleton.boneInverses[bi]));
      _n.applyMatrix3(rot).normalize();
      list.push(outPos.length / 3);
      outPos.push(_v.x, _v.y, _v.z);
      outNor.push(_n.x, _n.y, _n.z);
      centre.add(_v); count++;
    }
  }
  if (!count) return null;
  centre = centre.divideScalar(count);
  for (let i = 0; i < outPos.length; i += 3) { outPos[i] -= centre.x; outPos[i + 1] -= centre.y; outPos[i + 2] -= centre.z; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(outNor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(outPos.length).fill(1), 3));
  const allIdx: number[] = [];
  const gibMats: THREE.Material[] = [];
  for (const [group, list] of groups) {
    const matIndex = geo.groups[group].materialIndex!;
    g.addGroup(allIdx.length, list.length, gibMats.length);
    gibMats.push(slotMaterial(c.plan, SLOTS[matIndex])); // own materials: the gib dissolves alone
    for (const x of list) allIdx.push(x);
  }
  g.setIndex(allIdx);
  const out = new THREE.Mesh(g, gibMats);
  out.position.copy(centre);
  out.name = `gib:${l.spec.id}`;
  return out;
}

/** Hide a limb's triangles on the skinned mesh (degenerate them: offsets of the other limbs stay valid). */
function hideLimb(c: Creature, id: string): void {
  const geo = c.rig.mesh.geometry, idx = geo.index!;
  for (const r of c.rig.limbRanges.get(id) ?? []) for (let i = r.start; i < r.start + r.count; i++) idx.setX(i, 0);
  idx.needsUpdate = true;
}

function stumpMaterial(colour: string): THREE.Material {
  const m = goreFluid(colour);
  m.defines = { ...(m.defines ?? {}), BIO_SEED: '3.0' };
  return m;
}

export const creatureGore = {
  /**
   * Shoot a limb off: it tumbles away as a gib (with any wing membrane on it), the joint left behind becomes a
   * glowing, pulsing stump that spurts fluid for a moment, and the creature walks on without it.
   * Returns false when the limb is missing, already gone, or not severable.
   */
  sever(scene: THREE.Object3D, c: Creature, limbId: string, impulse = new THREE.Vector3()): boolean {
    const l = c.rig.limbs.get(limbId);
    if (!l || l.severed || !l.spec.severable) return false;
    const colour = c.plan.palette.fluid;
    const gibMesh = bakeLimb(c, l);
    hideLimb(c, limbId);
    l.severed = true;
    // Child limbs and parts on this limb go with it.
    for (const other of c.rig.limbs.values()) if (other !== l && l.bones.some((b) => b === other.bones[0].parent)) { other.severed = true; hideLimb(c, other.spec.id); c.onLimbSevered?.(other.spec.id); }
    c.onLimbSevered?.(limbId);
    const group = new THREE.Group();
    if (gibMesh) { group.position.copy(gibMesh.position); gibMesh.position.set(0, 0, 0); group.add(gibMesh); }
    else l.bones[0].getWorldPosition(group.position);
    scene.add(group);
    group.updateMatrixWorld(true);
    for (const p of c.rig.parts.values()) {
      if (!l.bones.includes(p.bone as THREE.Bone)) continue;
      p.mesh.material = slotMaterial(c.plan, p.spec.material);
      group.attach(p.mesh);
    }
    for (const h of c.rig.hits) if (h.spec.part === limbId) h.spec.r = 0;
    const r = Math.max(...l.spec.lengths) * 0.5;
    gibs.push({ mesh: group, vel: impulse.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 2)), spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4), age: 0, rest: false, ground: c.ground, r });
    while (gibs.length > MAX_GIBS) { const g = gibs.shift()!; g.mesh.removeFromParent(); }

    // Stump: a swollen, glowing wound cap on the joint, and a spurting jet for a second and a half.
    const joint = l.bones[0];
    const stump = new THREE.Mesh(new THREE.SphereGeometry(Math.max(l.spec.radii[0] * 1.5, 0.025), 12, 8), stumpMaterial(colour));
    stump.name = 'stump';
    joint.parent!.add(stump);
    stump.position.copy(joint.position);
    const at = joint.getWorldPosition(new THREE.Vector3());
    const out = at.clone().sub(c.rig.bones[0].getWorldPosition(new THREE.Vector3())).normalize();
    gore.burst(scene, { point: at, normal: out, colour, count: 60, speed: 5 });
    spurts.push({ at: stump, colour, left: 1.5, next: 0, normal: out, scene });
    return true;
  },

  /** Death of a small creature: every severable limb flies off and the body pops in a burst. */
  burstAll(scene: THREE.Object3D, c: Creature, impulse = new THREE.Vector3()): void {
    for (const id of [...c.rig.limbs.keys()]) creatureGore.sever(scene, c, id, impulse.clone().multiplyScalar(0.5));
    const at = c.rig.bones[0].getWorldPosition(new THREE.Vector3());
    gore.burst(scene, { point: at, colour: c.plan.palette.fluid, count: 90, speed: 7 });
  },

  /** Fluid pooling under a corpse. */
  pool(scene: THREE.Object3D, c: Creature): void {
    const at = c.root.position.clone();
    at.y = c.ground(at.x, at.z) + 0.02;
    gore.splat(scene, { point: at, normal: new THREE.Vector3(0, 1, 0), size: Math.max(1.2, c.plan.radius * 2.2), colour: c.plan.palette.fluid });
  },

  update(dt: number): void {
    for (let i = gibs.length - 1; i >= 0; i--) {
      const g = gibs[i];
      g.age += dt;
      if (!g.rest) {
        g.vel.y -= 14 * dt;
        g.mesh.position.addScaledVector(g.vel, dt);
        g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.y += g.spin.y * dt; g.mesh.rotation.z += g.spin.z * dt;
        const floor = g.ground(g.mesh.position.x, g.mesh.position.z) + g.r * 0.25;
        if (g.mesh.position.y < floor) {
          g.mesh.position.y = floor;
          if (Math.abs(g.vel.y) < 1.5) g.rest = true;
          g.vel.set(g.vel.x * 0.4, -g.vel.y * 0.3, g.vel.z * 0.4);
          g.spin.multiplyScalar(0.4);
        }
      }
      if (g.age > GIB_LIFE && !g.mesh.userData.dissolving) {
        g.mesh.userData.dissolving = true;
        const m = g.mesh;
        mutation.dissolveOut(m, { duration: 1.5, done: () => m.removeFromParent() });
      }
      if (g.age > GIB_LIFE + 2) gibs.splice(i, 1);
    }
    for (let i = spurts.length - 1; i >= 0; i--) {
      const s = spurts[i];
      s.left -= dt;
      s.next -= dt;
      if (s.next <= 0 && s.at.parent) {
        // Pulsing arterial rhythm.
        s.next = 0.22 + Math.sin(bioTime.value * 7) * 0.05;
        const p = s.at.getWorldPosition(new THREE.Vector3());
        gore.burst(s.scene, { point: p, normal: s.normal, colour: s.colour, count: 14, speed: 3.5 });
      }
      const k = Math.max(0, s.left / 1.5);
      s.at.scale.setScalar(1 + Math.sin(bioTime.value * 9) * 0.15 * k);
      if (s.left <= 0) spurts.splice(i, 1);
    }
  },

  get live(): number { return gibs.length; },
};
