import { HIVE } from '../render/palette';
import * as THREE from 'three';
import { alienEye, bioNode, chitin, livingFlesh, membrane } from '../render/materials';
import { meshSdf } from './sdf';
import * as P from './parts';
import { aimBone, solveTwoBone } from './ik';
import type { BodyPlan, HitSpec, LimbSpec, MaterialSlot, PartSpec } from './plan';

/**
 * Rig builder: turns a BodyPlan into one skinned mesh (flesh, armour, bone and glow as material groups of a
 * single geometry, so a whole creature is a handful of draw calls however many legs it has), a skeleton the
 * locomotion code poses, separate meshes for the parts that animate on their own (eyes, pustules, wings,
 * translucent bells), and hit spheres bound to bones.
 */

export interface LimbRig {
  spec: LimbSpec;
  /** Segment bones root to tip, plus the tip marker as the last element. */
  bones: THREE.Bone[];
  severed: boolean;
}

export interface PartRig { spec: PartSpec; mesh: THREE.Mesh; bone: THREE.Object3D; base: THREE.Matrix4 }

export interface RigHit { spec: HitSpec; bone: THREE.Object3D; local: THREE.Vector3; world: THREE.Vector3 }

export interface Rig {
  plan: BodyPlan;
  /** Place and yaw this in the world. Its origin is on the ground under the body. */
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  /** Second skinned mesh holding only the parts new at `growStage` (so they can grow in on their own). */
  growth: THREE.SkinnedMesh | null;
  skeleton: THREE.Skeleton;
  /** Body bones in plan order; [0] is 'body'. */
  bones: THREE.Bone[];
  limbs: Map<string, LimbRig>;
  parts: Map<string, PartRig>;
  hits: RigHit[];
  materials: Record<MaterialSlot, THREE.Material>;
  /** Index ranges of each limb's triangles per material group, for dismemberment. */
  limbRanges: Map<string, { group: number; start: number; count: number }[]>;
  /** Glowing materials whose intensity behaviour code may drive, with their base intensity. */
  glows: { mat: THREE.MeshStandardMaterial; base: number }[];
}

export interface BuildOptions {
  /** Parts and limbs at or above this stage go into `rig.growth` (mutation diffing). */
  growStage?: number;
  /** Shared SDF geometry cache key: species meshes are reused across instances of the same seed and stage. */
  cache?: boolean;
}

export const SLOTS: MaterialSlot[] = ['flesh', 'raw', 'chitin', 'bone', 'glow', 'glass', 'eye', 'membrane'];

/** A fresh material for one slot; same program as every other creature's material for that slot. */
/**
 * Glow restraint (Brandon's playtest, 2026-11-11: heavy neon reads as AI-made). Veins, rims and chitin glow are
 * scaled down so form and wet surface detail carry the creature; eyes, weak points and nodes stay the accents.
 */
const RESTRAINT = { vein: 1, rim: 1, chitinGlow: 1 }; // Rendering's global bioGlow/bioSat restraint now does the dimming (#32)
const scaleHex = (c: string, k: number) => `#${new THREE.Color(c).multiplyScalar(k).getHexString()}`;

export function slotMaterial(plan: BodyPlan, slot: MaterialSlot): THREE.Material {
  // Rim: mostly bone-white, a hint of the species colour, so silhouettes separate from Zone 7's dark ground as
  // light catching wet skin rather than as neon.
  const rim = `#${new THREE.Color(plan.palette.rim).lerp(new THREE.Color(HIVE.bone), 0.65).multiplyScalar(RESTRAINT.rim).getHexString()}`;
  const pal = { ...plan.palette, vein: scaleHex(plan.palette.vein, RESTRAINT.vein), rim, chitinGlow: scaleHex(plan.palette.chitinGlow, RESTRAINT.chitinGlow) };
  let m: THREE.Material;
  switch (slot) {
    case 'flesh': { const f = livingFlesh(pal.flesh, pal.vein, pal.rim, plan.fleshScale); f.vertexColors = true; f.clearcoatRoughness = 0.32; f.roughness = 0.5; m = f; break; }
    case 'raw': { const f = livingFlesh(pal.flesh, scaleHex(pal.fluid, 0.5), scaleHex(pal.fluid, 0.4), plan.fleshScale * 1.8); f.side = THREE.DoubleSide; m = f; break; }
    case 'chitin': m = chitin(pal.chitin, pal.chitinGlow, 3.5); break;
    case 'bone': m = chitin(pal.bone, pal.chitinGlow, 7); break;
    case 'glow': m = bioNode(pal.glow, 2.6); break;
    case 'glass': m = new THREE.MeshPhysicalMaterial({
      // Glassy tissue first, colour second: a pale, mostly clear body with a breath of the species hue.
      color: new THREE.Color(pal.membrane).lerp(new THREE.Color(HIVE.bone), 0.55), transparent: true, opacity: 0.26, roughness: 0.06, clearcoat: 1,
      emissive: pal.membrane, emissiveIntensity: 0.05, depthWrite: false, side: THREE.DoubleSide,
    }); break;
    case 'eye': m = alienEye(pal.iris, pal.sclera); break;
    // Tissue before light: a paler, dimmer membrane so bells and wings read as skin with veins in it.
    case 'membrane': m = membrane(`#${new THREE.Color(pal.membrane).lerp(new THREE.Color(HIVE.bone), 0.4).multiplyScalar(0.7).getHexString()}`, 0.42); break;
  }
  // The bio shaders seed their noise from the object's world position; creatures move, so pin it. One value for
  // every creature keeps one shader program per material slot (a define per seed would multiply programs).
  m.defines = { ...(m.defines ?? {}), BIO_SEED: '3.7' };
  return m;
}

/** One material set per creature, so each can pulse and dissolve on its own; programs are shared by key. */
export function creatureMaterials(plan: BodyPlan): Record<MaterialSlot, THREE.Material> {
  return Object.fromEntries(SLOTS.map((s) => [s, slotMaterial(plan, s)])) as Record<MaterialSlot, THREE.Material>;
}

interface Acc { pos: number[]; nor: number[]; col: number[]; si: number[]; sw: number[]; idx: number[] }
const acc = (): Acc => ({ pos: [], nor: [], col: [], si: [], sw: [], idx: [] });

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

/** Append geometry transformed by `m`, rigidly bound to `bone`. Returns the index range appended. */
function append(a: Acc, g: THREE.BufferGeometry, m: THREE.Matrix4, bone: number, tint = 1): [number, number] {
  const base = a.pos.length / 3, start = a.idx.length;
  const p = g.attributes.position, n = g.attributes.normal;
  _nm.getNormalMatrix(m);
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i).applyMatrix4(m);
    _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
    a.pos.push(_v.x, _v.y, _v.z); a.nor.push(_n.x, _n.y, _n.z); a.col.push(tint, tint, tint);
    a.si.push(bone, 0, 0, 0); a.sw.push(1, 0, 0, 0);
  }
  if (g.index) for (let i = 0; i < g.index.count; i++) a.idx.push(base + g.index.getX(i));
  else for (let i = 0; i < p.count; i++) a.idx.push(base + i);
  return [start, a.idx.length - start];
}

function geometryFrom(accs: Map<MaterialSlot, Acc>): { geo: THREE.BufferGeometry; offsets: Map<MaterialSlot, { group: number; idxOffset: number }> } {
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [], col: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
  const offsets = new Map<MaterialSlot, { group: number; idxOffset: number }>();
  let group = 0;
  for (const slot of SLOTS) {
    const a = accs.get(slot);
    if (!a || a.idx.length === 0) continue;
    const base = pos.length / 3, start = idx.length;
    for (const x of a.pos) pos.push(x);
    for (const x of a.nor) nor.push(x);
    for (const x of a.col) col.push(x);
    for (const x of a.si) si.push(x);
    for (const x of a.sw) sw.push(x);
    for (const i of a.idx) idx.push(base + i);
    geo.addGroup(start, a.idx.length, SLOTS.indexOf(slot));
    offsets.set(slot, { group: group++, idxOffset: start });
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return { geo, offsets };
}

/** Matrix placing a part-local frame (+Y = dir, +Z = fwd) at `at`. */
export function partMatrix(at: THREE.Vector3, dir: THREE.Vector3, fwd?: THREE.Vector3, scale = 1): THREE.Matrix4 {
  const y = dir.clone().normalize();
  const z = (fwd ? fwd.clone() : new THREE.Vector3(0, 0, 1)).addScaledVector(y, -(fwd ?? new THREE.Vector3(0, 0, 1)).dot(y));
  if (z.lengthSq() < 1e-6) z.set(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).scale(new THREE.Vector3(scale, scale, scale)).setPosition(at);
}

/** Part geometry in its local frame. */
export function partGeometry(s: PartSpec, rand: P.Rand): THREE.BufferGeometry {
  const p = s.p ?? [];
  switch (s.type) {
    case 'spike': return P.spike(s.size, s.size * (p[0] ?? 0.12), p[1] ?? 0.25);
    case 'horn': return P.horn(s.size, s.size * (p[0] ?? 0.14), p[1] ?? 1, rand);
    case 'blade': return P.blade(s.size, s.size * (p[0] ?? 0.22), s.size * 0.025);
    case 'plate': return P.plate(s.size * (p[0] ?? 1), s.size * (p[1] ?? 1), s.size * (p[2] ?? 0.3), rand, p[3] ?? 0.3);
    case 'pustule': case 'node': case 'sac': return P.pustule(s.size, rand() * 9);
    case 'lens': { const g = new THREE.SphereGeometry(s.size, 20, 14); g.scale(1, 0.55, 1); return g; }
    case 'eye': return new THREE.SphereGeometry(s.size, 20, 14);
    case 'lid': return P.lid(s.size);
    case 'eyelids': return P.eyelids(s.size, p[0] ?? 0.32);
    case 'needleRing': return P.needleRing(s.size, p[0] ?? 12, s.size * (p[1] ?? 1), rand, p[2] ?? 0.5);
    case 'crystals': return P.crystals(s.size, rand, p[0] ?? 5);
    case 'fungus': return P.fungus(s.size, rand, p[0] ?? 4);
    case 'vent': return P.vent(s.size, s.size * (p[0] ?? 2.2));
    case 'skull': return P.skull(s.size, p[0] ?? 0);
    case 'wing': return P.wing(s.size, s.size * (p[0] ?? 0.6), rand, p[1] ?? 1);
    case 'membraneDome': {
      const g = new THREE.SphereGeometry(s.size, 28, 16, 0, Math.PI * 2, 0, Math.PI * (p[0] ?? 0.6));
      g.scale(1, p[1] ?? 1, 1);
      return P.roughen(g, s.size * 0.03, 6 / s.size, rand() * 9);
    }
    case 'frill': {
      // A rippling fin skirt along +Z, hanging out along +Y.
      const len = s.size, w = s.size * (p[0] ?? 0.25);
      const g = new THREE.PlaneGeometry(w, len, 4, 18);
      g.translate(0, 0, 0);
      g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i), y = pos.getY(i) + w / 2;
        pos.setY(i, y);
        pos.setX(i, Math.sin(z / len * Math.PI * 6) * y * 0.35);
      }
      g.computeVertexNormals();
      return g;
    }
    case 'cord': {
      const len = s.size;
      const pts = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(Math.sin(t * 5) * len * 0.05, t * len, 0));
      const g = P.taperTube(pts, [len * 0.03, len * 0.02, len * 0.018, len * 0.035], 4, 2);
      return P.merge([g, new THREE.SphereGeometry(len * 0.06, 6, 5).translate(pts[3].x, len, 0)]);
    }
    case 'cup': {
      const r = s.size;
      const pts = [[r * 0.25, 0], [r * 0.5, r * 0.6], [r * 0.85, r * 1.5], [r, r * 2], [r * 0.85, r * 1.95], [r * 0.4, r * 0.6]].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.LatheGeometry(pts, 12);
    }
  }
}

/** alienEye gazes down its local -Z; parts point along +Y. */
const EYE_GAZE = new THREE.Matrix4().makeRotationX(Math.PI / 2);

const sdfCache = new Map<string, ReturnType<typeof meshSdf>>();

/** Build a creature rig. Deterministic for a plan. */
export function buildRig(plan: BodyPlan, opts: BuildOptions = {}): Rig {
  const root = new THREE.Group();
  root.name = `creature:${plan.species}`;
  const materials = creatureMaterials(plan);
  const rand = P.rng(plan.seed * 7 + 13);

  // ---- Bones: body chain, then limb chains.
  const bones: THREE.Bone[] = plan.bones.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; return bone; });
  plan.bones.forEach((b, i) => {
    if (b.parent < 0) bones[i].position.copy(b.at);
    else { bones[i].position.copy(b.at).sub(plan.bones[b.parent].at); bones[b.parent].add(bones[i]); }
  });
  root.add(bones[0]);
  root.updateMatrixWorld(true);

  const limbs = new Map<string, LimbRig>();
  const all: THREE.Bone[] = [...bones];
  for (const l of plan.limbs) {
    const chain: THREE.Bone[] = [];
    let parent: THREE.Object3D = bones[l.bone];
    for (let s = 0; s <= l.lengths.length; s++) {
      const b = new THREE.Bone();
      b.name = `${l.id}:${s}`;
      if (s === 0) b.position.copy(l.mount).sub(plan.bones[l.bone].at);
      else b.position.set(0, l.lengths[s - 1], 0);
      parent.add(b);
      parent = b;
      chain.push(b);
      all.push(b);
    }
    limbs.set(l.id, { spec: l, bones: chain, severed: false });
  }
  root.updateMatrixWorld(true);
  for (const l of limbs.values()) restPose(l);
  root.updateMatrixWorld(true);
  const boneIndex = new Map(all.map((b, i) => [b, i]));

  // ---- Static geometry, accumulated per material slot.
  const main = new Map<MaterialSlot, Acc>(), grow = new Map<MaterialSlot, Acc>();
  const accFor = (m: Map<MaterialSlot, Acc>, slot: MaterialSlot) => { let a = m.get(slot); if (!a) m.set(slot, (a = acc())); return a; };
  const isGrowth = (stage: number) => opts.growStage !== undefined && stage >= opts.growStage;

  // Flesh: the SDF body. Shared between instances of the same species, seed and stage.
  const key = `${plan.species}:${plan.seed}:${plan.stage}`;
  let sdf = sdfCache.get(key);
  if (!sdf) {
    sdf = meshSdf(plan.skin, plan.bones.length, { resolution: plan.skinResolution, noise: { ...plan.skinNoise, seed: plan.seed % 101 } });
    if (opts.cache !== false) sdfCache.set(key, sdf);
  }
  {
    const a = accFor(main, 'flesh');
    const g = sdf.geometry;
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      a.pos.push(p.getX(i), p.getY(i), p.getZ(i)); a.nor.push(n.getX(i), n.getY(i), n.getZ(i)); a.col.push(c.getX(i), c.getY(i), c.getZ(i));
      for (let s = 0; s < 4; s++) { a.si.push(sdf.skinIndex[i * 4 + s]); a.sw.push(sdf.skinWeight[i * 4 + s]); }
    }
    for (let i = 0; i < g.index!.count; i++) a.idx.push(g.index!.getX(i));
  }

  // Limb segments.
  const limbRangesBySlot = new Map<string, { slot: MaterialSlot; start: number; count: number; growth: boolean }[]>();
  for (const l of limbs.values()) {
    const s = l.spec;
    const target = isGrowth(s.stage) ? grow : main;
    const ranges: { slot: MaterialSlot; start: number; count: number; growth: boolean }[] = [];
    for (let i = 0; i < s.lengths.length; i++) {
      const tip = i === s.lengths.length - 1;
      const g = P.limbSegment(s.lengths[i], s.radii[i], s.radii[i + 1], s.style, rand, tip && s.kind === 'leg');
      const [start, count] = append(accFor(target, s.material), g, l.bones[i].matrixWorld, boneIndex.get(l.bones[i])!);
      ranges.push({ slot: s.material, start, count, growth: target === grow });
    }
    limbRangesBySlot.set(s.id, ranges);
  }

  // Parts.
  const parts = new Map<string, PartRig>();
  const partBone = (s: PartSpec): THREE.Bone => typeof s.bone === 'number' ? bones[s.bone] : limbs.get(s.bone.limb)!.bones[s.bone.seg];
  for (const s of plan.parts) {
    const bone = partBone(s);
    // Body-bone parts are specified in body space; limb parts in segment space.
    const local = partMatrix(s.at, s.dir, s.fwd);
    if (s.type === 'eye') local.multiply(EYE_GAZE);
    const inBody = typeof s.bone === 'number' ? local : new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, local);
    const g = partGeometry(s, rand);
    if (s.dynamic) {
      // Weak points pulse and pop on their own, so they get their own material instance.
      const mat = s.weak || s.type === 'pustule' || isGrowth(s.stage) ? slotMaterial(plan, s.material) : materials[s.material];
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = s.id;
      const base = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(inBody);
      base.decompose(mesh.position, mesh.quaternion, mesh.scale);
      bone.add(mesh);
      if (isGrowth(s.stage)) mesh.userData.growth = true;
      parts.set(s.id, { spec: s, mesh, bone, base });
    } else {
      const target = isGrowth(s.stage) ? grow : main;
      const [start, count] = append(accFor(target, s.material), g, inBody, boneIndex.get(bone)!);
      if (typeof s.bone !== 'number') limbRangesBySlot.get(s.bone.limb)!.push({ slot: s.material, start, count, growth: target === grow });
    }
  }

  // ---- Skinned meshes.
  const skeleton = new THREE.Skeleton(all);
  const matList = SLOTS.map((s) => materials[s]);
  const { geo, offsets } = geometryFrom(main);
  const mesh = new THREE.SkinnedMesh(geo, matList);
  mesh.name = 'creature-skin';
  mesh.frustumCulled = false; // bounds move with the skeleton; creatures are few
  root.add(mesh);
  mesh.bind(skeleton);
  let growth: THREE.SkinnedMesh | null = null;
  let growOffsets: Map<MaterialSlot, { group: number; idxOffset: number }> | null = null;
  if ([...grow.values()].some((a) => a.idx.length)) {
    const gm = geometryFrom(grow);
    growOffsets = gm.offsets;
    // Its own materials, so the growth can dissolve in without touching the old body.
    const gmats = creatureMaterials(plan);
    growth = new THREE.SkinnedMesh(gm.geo, SLOTS.map((s) => gmats[s]));
    growth.name = 'creature-growth';
    growth.frustumCulled = false;
    root.add(growth);
    growth.bind(skeleton);
  }

  const limbRanges = new Map<string, { group: number; start: number; count: number }[]>();
  for (const [id, rs] of limbRangesBySlot) {
    limbRanges.set(id, rs.filter((r) => !r.growth).map((r) => ({ group: offsets.get(r.slot)!.group, start: offsets.get(r.slot)!.idxOffset + r.start, count: r.count })));
    void growOffsets;
  }

  // ---- Hit spheres.
  const hits: RigHit[] = plan.hits.map((h) => {
    const bone = typeof h.bone === 'number' ? bones[h.bone] : limbs.get(h.bone.limb)!.bones[h.bone.seg];
    const local = typeof h.bone === 'number' ? bone.worldToLocal(h.at.clone()) : h.at.clone();
    return { spec: h, bone, local, world: new THREE.Vector3() };
  });

  const glows: Rig['glows'] = [];
  for (const m of [materials.glow, ...[...parts.values()].map((p) => p.mesh.material as THREE.Material)]) {
    if (m instanceof THREE.MeshStandardMaterial && m.emissive && !glows.some((g) => g.mat === m)) glows.push({ mat: m, base: m.emissiveIntensity });
  }

  return { plan, root, mesh, growth, skeleton, bones, limbs, parts, hits, materials, limbRanges, glows };
}

/** Pose a limb at rest: legs and arms reach their rest point with IK, wings and tendrils point straight at it. */
export function restPose(l: LimbRig): void {
  const s = l.spec;
  const root = l.bones[0].parent!;
  root.updateWorldMatrix(true, false);
  const world = (v: THREE.Vector3) => v.clone().applyMatrix4(rigRoot(root).matrixWorld);
  const rest = world(s.rest), pole = s.pole.clone().transformDirection(rigRoot(root).matrixWorld);
  if ((s.kind === 'leg' || s.kind === 'arm') && s.lengths.length >= 2) {
    const n = s.lengths.length;
    const goal = rest.clone();
    if (n >= 3) goal.y += s.lengths[2] * (s.kind === 'leg' ? 0.92 : 0.5);
    solveTwoBone(l.bones[0], l.bones[1], s.lengths[0], s.lengths[1], goal, pole);
    if (n >= 3) {
      const knee = l.bones[2].getWorldPosition(new THREE.Vector3());
      aimBone(l.bones[2], rest.clone().sub(knee), pole);
    }
  } else {
    const start = l.bones[0].getWorldPosition(new THREE.Vector3());
    const dir = rest.clone().sub(start);
    for (let i = 0; i < s.lengths.length; i++) aimBone(l.bones[i], dir, pole);
  }
}

function rigRoot(o: THREE.Object3D): THREE.Object3D {
  let r = o;
  while (r.parent && !(r.parent instanceof THREE.Scene)) {
    if (r.name.startsWith('creature:')) return r;
    r = r.parent;
  }
  return r;
}

/** Update hit sphere world positions (after posing). */
export function refreshHits(rig: Rig): void {
  for (const h of rig.hits) h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
}
