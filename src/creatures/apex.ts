import * as THREE from 'three';
import type { ClassId } from '../../data';
import { FAUNA, HIVE, OCHRE, ORGANIC, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioNode, chitin, livingFlesh, membrane } from '../render/materials';
import { horn, merge, needleRing, plate, pustule, roughen, spike, taperTube, vent, wing, type Rand } from './parts';
import type { SdfPrim } from './sdf';

/**
 * Apex evolution bodies (data/progression.json, milestone "apex"), grown on top of a class body by HostBody:
 *   shadowStalker    Wraith: light-eating velvet, a cloak of membranes for wings, an eyeless blade of a head
 *                    with two slits that glow only just before it strikes
 *   xenoflyer        Wraith: four huge oily wings in a fast flutter, legs tucked into a landing cage, a long
 *                    segmented dragonfly tail ending in a hooked stinger
 *   sporeCaster      Infiltrator: tiers of shelf fungus down the back, three spore chimneys breathing spores,
 *                    a frill of soft gills crowning the cranium, moss creeping over it
 *   psychWarlock     Infiltrator: floats; the skull split into a halo of orbiting neural lobes tethered by
 *                    threads of light around a bare brain stem; the legs become a trailing nervous system
 *   goreGorgon       Behemoth: a writhing crown of flesh-serpents with bone jaws; two of them grip the cannon
 *   juggernautTitan  Behemoth, twice the size: layered fused bone plates, a furnace heart in a rib cage, bone
 *                    mauls for hands (one fused round the cannon), moss and old spines stuck in its back
 * Glow stays dim and warm or cold-violet (Art Bible): it is a sign of life, not a light show.
 */

export const APEX_EVOLUTIONS = {
  shadowStalker: 'venomWraith', xenoflyer: 'venomWraith',
  sporeCaster: 'neuroInfiltrator', psychWarlock: 'neuroInfiltrator',
  goreGorgon: 'goreBehemoth', juggernautTitan: 'goreBehemoth',
} as const satisfies Record<string, ClassId>;
export type ApexEvolution = keyof typeof APEX_EVOLUTIONS;

/** How much bigger the Juggernaut-Titan stands than the Behemoth ("twice the size"). */
export const TITAN_SCALE = 1.9;
/** The Psych-Warlock's float above the ground, metres. */
export const WARLOCK_FLOAT = 0.12;

type V3 = [number, number, number];
/** The joint layout HostBody builds from (mirrors its Frame). */
export interface ApexFrame {
  hips: V3; waist: V3; chest: V3; neck: V3; head: V3; shoulder: V3; elbow: V3; wrist: V3; hip: V3; knee: V3; hock: V3; foot: V3;
  r: { pelvis: number; waist: number; chest: V3; arm: number; fore: number; thigh: number; shin: number };
  cranium: V3;
}

/** What a grower can reach on the body it is growing. */
export interface GrowKit {
  root: THREE.Group;
  f: ApexFrame;
  rand: Rand;
  bone: THREE.MeshPhysicalMaterial;
  skin: THREE.MeshPhysicalMaterial;
  /** The class glow colour. */
  glow: string;
  /** Sway an object about its rest rotation (HostBody's idle). */
  sway(obj: THREE.Object3D, amp: number, rate: number, phase: number): void;
  /** Run every frame with the body's clock. */
  tick(fn: (t: number, dt: number) => void): void;
  /** Seat a point on the meshed skin along a normal, `lift` metres proud of it. */
  onSkin(p: THREE.Vector3, n: THREE.Vector3, lift: number): THREE.Vector3;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const T = (a: V3, sx = 1) => V(a[0] * sx, a[1], a[2]);
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));
const dim = (c: string, k: number) => hex(new THREE.Color(c).multiplyScalar(k));
const UP = V(0, 1, 0);

/**
 * A plate's rotation: its convex side along `normal`, its lifted trailing edge (local +Z) pointing along `trail`
 * (down the body, down the limb), so rows of plates overlap like scales.
 */
export function scaleBasis(normal: THREE.Vector3, trail: THREE.Vector3 = V(0, -1, 0)): THREE.Quaternion {
  const y = normal.clone().normalize();
  let z = trail.clone().addScaledVector(y, -trail.dot(y));
  if (z.lengthSq() < 1e-6) z = V(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Place a geometry at p with its +Y along dir. */
function along(g: THREE.BufferGeometry, p: THREE.Vector3, dir: THREE.Vector3): THREE.BufferGeometry {
  return g.applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()), V(1, 1, 1)));
}

/** The body's joint layout for an Apex form (legs tucked, columns for arms), else the class frame. */
export function apexFrame(evo: ApexEvolution, base: ApexFrame): ApexFrame {
  const f: ApexFrame = JSON.parse(JSON.stringify(base));
  if (evo === 'xenoflyer') {
    // Stretched thin, legs drawn up under the body into a landing cage.
    f.r.chest = [f.r.chest[0] * 0.8, f.r.chest[1], f.r.chest[2] * 0.85];
    f.r.waist *= 0.8; f.r.pelvis *= 0.85;
    f.knee = [0.12, 0.8, 0.2]; f.hock = [0.11, 0.62, -0.02]; f.foot = [0.1, 0.56, 0.12];
  }
  if (evo === 'psychWarlock') {
    f.r.arm *= 0.85; f.r.fore *= 0.8; f.r.pelvis *= 0.7;
    f.wrist = [0.27, 0.95, 0.2];
  }
  if (evo === 'juggernautTitan') {
    // Arms become columns ending low in bone mauls.
    f.r.arm *= 1.2; f.r.fore *= 1.45;
    f.wrist = [0.56, 0.6, 0.3];
  }
  return f;
}

/** Which class-body pieces an Apex form drops (HostBody asks before growing them). */
export function apexDrops(evo: ApexEvolution | null): { legs: boolean; cranium: boolean; eyes: boolean; antennae: boolean; abdomen: boolean; wings: boolean; crown: boolean; nodes: boolean } {
  return {
    legs: evo === 'psychWarlock',
    cranium: evo === 'psychWarlock' || evo === 'shadowStalker',
    eyes: evo === 'psychWarlock' || evo === 'shadowStalker',
    antennae: evo === 'psychWarlock' || evo === 'shadowStalker' || evo === 'sporeCaster',
    abdomen: evo === 'xenoflyer',
    wings: evo === 'xenoflyer' || evo === 'shadowStalker',
    crown: evo === 'goreGorgon',
    nodes: evo === 'shadowStalker',
  };
}

/** Flesh an Apex form adds to the meshed body. */
export function apexPrims(evo: ApexEvolution | null, f: ApexFrame): SdfPrim[] {
  const hd = T(f.head);
  if (evo === 'shadowStalker') {
    // The head narrows to a blade: a long flat wedge swept forward, a crest running back over the skull.
    return [
      { shape: 'cone', a: hd.clone().add(V(0, 0.04, -0.08)), b: hd.clone().add(V(0, 0.0, 0.26)), ra: 0.075, rb: 0.012, blend: 0.05, bone: 0 },
      { shape: 'ellipsoid', a: hd.clone().add(V(0, 0.09, -0.06)), radii: V(0.035, 0.08, 0.2), blend: 0.05, bone: 0 },
    ];
  }
  if (evo === 'psychWarlock') {
    // The bare brain stem rising from the neck where the skull used to be.
    return [
      { shape: 'cone', a: T(f.neck), b: hd.clone().add(V(0, 0.12, -0.04)), ra: 0.04, rb: 0.03, blend: 0.04, bone: 0, ribs: { freq: 70, depth: 0.003 } },
      { shape: 'ellipsoid', a: hd.clone().add(V(0, 0.14, -0.04)), radii: V(0.045, 0.04, 0.05), blend: 0.03, bone: 0 },
      // The torso thins and trails away below the ribs.
      { shape: 'cone', a: T(f.waist), b: T(f.hips).add(V(0, -0.16, -0.02)), ra: f.r.waist, rb: 0.03, blend: 0.05, bone: 0 },
    ];
  }
  if (evo === 'goreGorgon') {
    // A swollen serpent root mass over the head and shoulders.
    return [{ shape: 'ellipsoid', a: hd.clone().add(V(0, 0.1, -0.08)), radii: V(0.2, 0.12, 0.16), blend: 0.08, bone: 0 }];
  }
  if (evo === 'juggernautTitan') {
    // Barrel chest and a heavier hump to carry the plates.
    const ch = T(f.chest);
    return [
      { shape: 'ellipsoid', a: ch.clone().add(V(0, 0.02, -0.02)), radii: V(f.r.chest[0] * 1.05, f.r.chest[1] * 1.05, f.r.chest[2]), blend: 0.08, bone: 0 },
      { shape: 'ellipsoid', a: ch.clone().add(V(0, 0.24, -0.16)), radii: V(f.r.chest[0] * 0.85, f.r.chest[1] * 0.6, f.r.chest[2] * 0.75), blend: 0.1, bone: 0 },
    ];
  }
  return [];
}

/** Retune the class skin and bone for the Apex form. */
export function apexSkin(evo: ApexEvolution | null, skin: THREE.MeshPhysicalMaterial, bone: THREE.MeshPhysicalMaterial): void {
  if (evo === 'shadowStalker') {
    // Velvet that eats the light: matte, no gloss, a faint violet sheen only at grazing angles.
    skin.color.set(mix(mix(ZONE7.void, ORGANIC.wetFleshDeep, 0.45), ZONE7_SHADE.rockDeep, 0.35));
    skin.roughness = 0.97; skin.clearcoat = 0; skin.sheen = 1; skin.sheenRoughness = 0.85;
    skin.sheenColor.set(dim(mix(ZONE7.violet, ORGANIC.mist, 0.55), 0.35));
    bone.color.set(mix(ZONE7_SHADE.rockDeep, ZONE7.void, 0.4)); bone.clearcoat = 0.25; bone.roughness = 0.7;
  }
  if (evo === 'sporeCaster') {
    // Lichen-grey skin taking on the moss.
    skin.color.lerp(new THREE.Color(ZONE7_SHADE.moss), 0.3);
    skin.clearcoat = 0.2; skin.roughness = 0.7;
  }
  if (evo === 'psychWarlock') {
    // Thin, pale, almost translucent: what is left of a body under the mind.
    skin.color.lerp(new THREE.Color(HIVE.bone), 0.2);
    skin.sheen = 0.5; skin.sheenColor.set(dim(ZONE7.violet, 0.25));
  }
  if (evo === 'goreGorgon') {
    // Exposed, wet, raw muscle.
    skin.color.set(mix(ORGANIC.wetFlesh, HIVE.danger, 0.28));
    skin.clearcoat = 1; skin.clearcoatRoughness = 0.08; skin.roughness = 0.3;
  }
  if (evo === 'juggernautTitan') {
    skin.color.lerp(new THREE.Color(ZONE7_SHADE.rock), 0.25);
    skin.clearcoat = 0.3;
  }
}

/** Grow the Apex form's own parts onto the body. */
export function growApex(evo: ApexEvolution, k: GrowKit): void {
  ({ shadowStalker, xenoflyer, sporeCaster, psychWarlock, goreGorgon, juggernautTitan } as Record<ApexEvolution, (k: GrowKit) => void>)[evo](k);
}

function shadowStalker(k: GrowKit): void {
  const { f, root } = k, hd = T(f.head);
  // Two slits along the blade, dark until the half-second before a strike.
  const slit = new THREE.MeshStandardMaterial({ color: ZONE7.void, emissive: mix(ZONE7.violet, ORGANIC.mist, 0.35), emissiveIntensity: 0.05, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), slit);
    e.scale.set(0.006, 0.006, 0.05);
    e.position.copy(hd).add(V(s * 0.045, 0.03, 0.08));
    e.rotation.set(0, s * 0.25, s * 0.2);
    e.name = 'slit';
    root.add(e);
  }
  k.tick((t) => {
    // Every few seconds the slits flare briefly, as if it were about to strike.
    const c = (t % 4.6) / 4.6;
    slit.emissiveIntensity = 0.05 + Math.max(0, Math.sin(Math.max(0, c - 0.88) / 0.12 * Math.PI)) * 1.2;
  });
  // The cloak: long membranes from the shoulders and back, hanging to the knees and dragging without sound.
  const cloth = new THREE.MeshStandardMaterial({ color: mix(mix(ZONE7.void, ZONE7_SHADE.rockDeep, 0.5), ZONE7.violet, 0.08), roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });
  const ch = T(f.chest);
  for (let i = 0; i < 6; i++) {
    const s = i < 3 ? -1 : 1, j = i % 3;
    const g = new THREE.Group();
    g.position.copy(ch).add(V(s * (0.04 + j * 0.07), 0.16 - j * 0.03, -f.r.chest[2] * 0.8));
    const w = new THREE.Mesh(wing(1.3 - j * 0.12, 0.42, k.rand, 2), cloth);
    w.rotation.set(Math.PI, s < 0 ? Math.PI : 0, 0);
    g.rotation.set(0.12 + j * 0.05, s * (0.25 + j * 0.25), s * (0.1 + j * 0.08));
    g.add(w);
    root.add(g);
    k.sway(g, 0.03, 0.5, i * 0.9);
  }
}

function xenoflyer(k: GrowKit): void {
  const { f, root, rand } = k, ch = T(f.chest), hp = T(f.hips);
  // Four huge wings, oil-sheen smoky panes, in a fast shimmering flutter (fore and hind pairs out of phase).
  const pane = membrane(dim(mix(ORGANIC.mist, ZONE7.violet, 0.25), 0.55), 0.38);
  pane.emissiveIntensity = 0.08;
  pane.metalness = 0.3;
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    g.position.copy(ch).add(V(s * 0.05, 0.12 - i * 0.1, -f.r.chest[2] * 0.7 - i * 0.06));
    const w = new THREE.Mesh(wing(1.75 - i * 0.2, 0.32, rand, 1 + i), pane);
    w.rotation.set(0, s < 0 ? Math.PI : 0, 0);
    g.rotation.set(-0.15 + i * 0.25, 0, -s * (Math.PI / 2 - 0.2));
    g.add(w);
    root.add(g);
    const base = g.rotation.z;
    k.tick((t) => { g.rotation.z = base + s * Math.sin(t * 38 + i * Math.PI) * 0.14; });
  }
  // The dragonfly tail: long, segmented, ending in a hooked stinger.
  const pts = [hp.clone().add(V(0, 0.02, -0.06)), hp.clone().add(V(0, -0.02, -0.4)), hp.clone().add(V(0, -0.04, -0.8)), hp.clone().add(V(0, 0.0, -1.15)), hp.clone().add(V(0, 0.05, -1.4))];
  const radii = [0.055, 0.042, 0.036, 0.03, 0.02];
  const tail: THREE.BufferGeometry[] = [taperTube(pts, radii, 12, 6)];
  const c = new THREE.CatmullRomCurve3(pts);
  for (let i = 1; i < 12; i++) {
    const t = i / 12, p = c.getPointAt(t), d = c.getTangentAt(t), r = radii[Math.min(3, Math.floor(t * 4))] * 1.05;
    tail.push(new THREE.TorusGeometry(r, 0.006, 8, 18).applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d), V(1, 1, 1))));
  }
  // The stinger hooks down and forward under the tail tip.
  tail.push(along(spike(0.18, 0.022, -0.9), pts[4], V(0, -0.4, -1)));
  const tailMesh = new THREE.Mesh(merge(tail), k.bone);
  root.add(tailMesh);
  k.sway(tailMesh, 0.02, 0.7, 0.4);
}

function sporeCaster(k: GrowKit): void {
  const { f, root, rand } = k, ch = T(f.chest), ws = T(f.waist), hd = T(f.head);
  const shelf = chitin(mix(OCHRE.dust, ORGANIC.wetFlesh, 0.35), dim(ORGANIC.amber, 0.1), 8);
  shelf.roughness = 0.75; shelf.clearcoat = 0.15;
  // Tiers of bracket caps down the back, each a shelf with gills beneath.
  const caps: THREE.BufferGeometry[] = [];
  for (let tier = 0; tier < 4; tier++) for (const s of [-1, 0, 1]) {
    if (s === 0 && tier % 2) continue;
    const p = ch.clone().lerp(ws, tier / 3).add(V(s * 0.08, 0.04 - tier * 0.02, 0));
    const at = k.onSkin(p, V(s * 0.6, 0.1, -1), -0.01);
    const w = 0.17 - tier * 0.018 + rand() * 0.03;
    caps.push(plate(w, w * 0.75, 0.04, rand, 0.05, 0.9).applyMatrix4(new THREE.Matrix4().compose(at, scaleBasis(V(s * 0.25, 1, -0.2), V(s * 0.5, 0, -1)), V(1, 1, 1))));
  }
  root.add(new THREE.Mesh(merge(caps), shelf));
  // Three chimney stalks from the shoulders, breathing a slow drift of spores.
  const stalk: THREE.BufferGeometry[] = [];
  const mouths: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const s = i - 1, base = ch.clone().add(V(s * 0.11, f.r.chest[1] * 0.7, -f.r.chest[2] * 0.45));
    const h = 0.42 - Math.abs(s) * 0.1;
    const top = base.clone().add(V(s * 0.08, h, -0.06));
    stalk.push(taperTube([base, base.clone().lerp(top, 0.5).add(V(s * 0.02, 0, -0.02)), top], [0.05, 0.04, 0.036], 12, 4));
    stalk.push(along(vent(0.036, 0.08), top.clone().add(V(0, -0.01, 0)), V(s * 0.2, 1, -0.1)));
    mouths.push(top.clone().add(V(0, 0.07, 0)));
  }
  root.add(new THREE.Mesh(roughen(merge(stalk), 0.004, 40, 3), shelf));
  const spore = bioNode(mix(FAUNA.sickGreen, ORGANIC.amber, 0.4), 1.2);
  spore.emissiveIntensity = 0.4;
  const motes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.008, 6, 4), spore, mouths.length * 6);
  motes.name = 'spores';
  const m = new THREE.Matrix4();
  root.add(motes);
  k.tick((t) => {
    for (let i = 0; i < motes.count; i++) {
      const mouth = mouths[i % mouths.length], life = ((t * 0.35 + i * 0.173) % 1);
      const p = mouth.clone().add(V(Math.sin(i * 7.1 + t) * 0.04 * life, life * 0.45, Math.cos(i * 3.3 + t * 0.8) * 0.04 * life));
      m.compose(p, new THREE.Quaternion(), V(1, 1, 1).multiplyScalar(1 - life * 0.7));
      motes.setMatrixAt(i, m);
    }
    motes.instanceMatrix.needsUpdate = true;
  });
  // A frill of soft gills crowning the cranium, breathing open and closed.
  const frill = new THREE.Group();
  frill.position.copy(hd).add(V(0, f.cranium[1] * 0.9 + 0.06, -0.12));
  const gill = membrane(dim(mix(ORGANIC.wetFlesh, OCHRE.dust, 0.4), 0.7), 0.85);
  gill.emissiveIntensity = 0.06;
  for (let i = 0; i < 9; i++) {
    const a = (i / 8 - 0.5) * 2.6;
    const w = new THREE.Mesh(wing(0.2 + (1 - Math.abs(a) / 1.3) * 0.08, 0.07, rand, 1), gill);
    w.rotation.set(-0.9, 0, a);
    frill.add(w);
  }
  root.add(frill);
  k.tick((t) => { const b = 1 + Math.sin(t * 1.1) * 0.08; frill.scale.set(b, b, 1); });
  // Moss and lichen creeping over the shoulders, arms and thighs.
  const moss: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const sh = T(f.shoulder, s), el = T(f.elbow, s), hip = T(f.hip, s), kn = T(f.knee, s);
    for (let i = 0; i < 14; i++) {
      const src = i < 6 ? sh.clone().lerp(el, rand() * 0.6) : i < 10 ? ch.clone().add(V(s * rand() * 0.15, (rand() - 0.5) * 0.2, 0)) : hip.clone().lerp(kn, rand() * 0.7);
      const n = V(s * (0.5 + rand()), 0.6 + rand() * 0.5, i >= 6 && i < 10 ? -1 : (rand() - 0.5));
      moss.push(along(pustule(0.012 + rand() * 0.012, i + s), k.onSkin(src, n, -0.006), n));
    }
  }
  const lichen = chitin(mix(ZONE7_SHADE.moss, FAUNA.fenMoss, 0.6), dim(FAUNA.sickGreen, 0.05), 20);
  lichen.roughness = 0.95; lichen.clearcoat = 0;
  root.add(new THREE.Mesh(merge(moss), lichen));
}

function psychWarlock(k: GrowKit): void {
  const { f, root, rand } = k, hd = T(f.head);
  // The halo: neural lobes orbiting the stem, tethered one to the next by threads of light.
  const halo = new THREE.Group();
  halo.name = 'halo';
  halo.position.copy(hd).add(V(0, 0.15, -0.05));
  halo.rotation.x = -0.25;
  const brain = livingFlesh(mix(mix(ORGANIC.wetFlesh, HIVE.bone, 0.35), ZONE7.violet, 0.06), ORGANIC.vein, ORGANIC.mist, 30);
  const thread = bioNode(mix(ZONE7.violet, ORGANIC.mist, 0.5), 1.4);
  thread.emissiveIntensity = 0.5;
  const N = 7, R = 0.27, pos: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, p = V(Math.cos(a) * R, Math.sin(i * 2.1) * 0.03, Math.sin(a) * R);
    pos.push(p);
    const g = roughen(new THREE.SphereGeometry(0.065 + rand() * 0.015, 22, 16).scale(1, 0.75, 1.25), 0.008, 70, i);
    const lobe = new THREE.Mesh(g, brain);
    lobe.position.copy(p);
    lobe.lookAt(0, p.y, 0);
    lobe.name = 'lobe';
    halo.add(lobe);
  }
  const threads: THREE.BufferGeometry[] = [];
  for (let i = 0; i < N; i++) {
    const a = pos[i], b = pos[(i + 1) % N], mid = a.clone().lerp(b, 0.5).multiplyScalar(0.92);
    threads.push(taperTube([a, mid, b], [0.003, 0.002, 0.003], 5, 4));
    threads.push(taperTube([a, a.clone().multiplyScalar(0.5).add(V(0, -0.02, 0)), V(0, -0.02, 0)], [0.0025, 0.0018, 0.0025], 5, 3));
  }
  halo.add(new THREE.Mesh(merge(threads), thread));
  root.add(halo);
  k.tick((t, dt) => { halo.rotation.y += dt * 0.22; halo.position.y = hd.y + 0.15 + Math.sin(t * 0.9) * 0.012; });
  // The body below trails into a nervous system, like a jellyfish.
  const nerve = livingFlesh(mix(HIVE.bone, ORGANIC.wetFlesh, 0.5), ORGANIC.vein, ORGANIC.mist, 40);
  const hp = T(f.hips).add(V(0, -0.1, -0.02));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, rr = 0.03 + (i % 3) * 0.02, len = 0.75 + rand() * 0.2;
    const g = new THREE.Group();
    g.position.copy(hp).add(V(Math.cos(a) * rr, 0, Math.sin(a) * rr));
    const out = V(Math.cos(a), 0, Math.sin(a));
    const pts = [V(0, 0, 0), out.clone().multiplyScalar(0.05).add(V(0, -len * 0.3, 0)), out.clone().multiplyScalar(0.03).add(V(Math.sin(i) * 0.04, -len * 0.65, -0.05)), out.clone().multiplyScalar(0.08).add(V(0, -len, -0.12))];
    const beads: THREE.BufferGeometry[] = [];
    const c = new THREE.CatmullRomCurve3(pts);
    for (let j = 1; j < 5; j++) beads.push(new THREE.SphereGeometry(0.008, 8, 6).translate(...c.getPointAt(j / 5).toArray() as V3));
    g.add(new THREE.Mesh(taperTube(pts, [0.012, 0.008, 0.005, 0.0015], 7, 5), nerve));
    g.add(new THREE.Mesh(merge(beads), thread));
    root.add(g);
    k.sway(g, 0.07, 0.6 + (i % 3) * 0.15, i * 0.8);
  }
}

function goreGorgon(k: GrowKit): void {
  const { f, root, rand } = k, hd = T(f.head);
  const muscle = livingFlesh(mix(HIVE.danger, ORGANIC.wetFleshDeep, 0.5), ORGANIC.amber, dim(HIVE.bone, 0.4), 22);
  muscle.clearcoat = 1; muscle.clearcoatRoughness = 0.08;
  const teeth = chitin(mix(HIVE.bone, ORGANIC.wetFlesh, 0.15), dim(ORGANIC.amber, 0.05), 6);
  /** One flesh serpent from `base` heading out along `dir`; returns its group (the head is at the last point). */
  const serpent = (base: THREE.Vector3, pts: THREE.Vector3[], r: number) => {
    const g = new THREE.Group();
    g.position.copy(base);
    const tube = taperTube(pts, pts.map((_, i) => r * (1 - (i / (pts.length - 1)) * 0.45)), 12, 5);
    const end = pts[pts.length - 1], dir = end.clone().sub(pts[pts.length - 2]).normalize();
    const skull = new THREE.SphereGeometry(r * 1.25, 14, 10).scale(1, 0.8, 1.5);
    skull.applyMatrix4(new THREE.Matrix4().compose(end, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir), V(1, 1, 1)));
    g.add(new THREE.Mesh(roughen(merge([tube, skull]), r * 0.08, 6 / r, rand() * 9), muscle));
    g.add(new THREE.Mesh(along(needleRing(r * 0.8, 7, r * 0.9, rand, 0.45), end.clone().addScaledVector(dir, r * 1.4), dir), teeth));
    root.add(g);
    return g;
  };
  // The crown: eight serpents bursting from the head and shoulders, each writhing and striking on its own.
  for (let i = 0; i < 8; i++) {
    const a = (i / 7 - 0.5) * 2.4, s = Math.sign(a) || 1;
    const base = hd.clone().add(V(Math.sin(a) * 0.16, 0.12, -0.08 + Math.cos(a) * 0.04));
    const len = 0.45 + rand() * 0.25, out = V(Math.sin(a) * 0.9, 0.8, 0.25 + rand() * 0.3).normalize();
    const pts = [V(0, 0, 0), out.clone().multiplyScalar(len * 0.35).add(V(s * 0.04, 0.05, -0.05)), out.clone().multiplyScalar(len * 0.7).add(V(-s * 0.05, 0.02, 0.04)), out.clone().multiplyScalar(len).add(V(0, -0.06, 0.12))];
    const g = serpent(base, pts, 0.042 - (i % 2) * 0.006);
    const ph = i * 1.37, rate = 0.9 + rand() * 0.6, every = 3 + rand() * 3;
    k.tick((t) => {
      // Slow writhing, and now and then a strike: a snap forward and back.
      const c = ((t + ph) % every) / every, strike = c > 0.9 ? Math.sin((c - 0.9) / 0.1 * Math.PI) : 0;
      g.rotation.set(Math.sin(t * rate + ph) * 0.18 + strike * 0.55, Math.sin(t * rate * 0.7 + ph) * 0.2, Math.sin(t * rate * 1.3 + ph) * 0.15);
    });
  }
  // The Marrow Cannon, gripped by two serpents instead of a hand.
  const wr = T(f.wrist), el = T(f.elbow);
  const c0 = wr.clone().add(V(0.06, 0.04, 0.0)), c1 = c0.clone().add(V(0.02, 0.06, 0.55));
  const barrel = taperTube([c0, c0.clone().lerp(c1, 0.5).add(V(0, 0.02, 0)), c1], [0.085, 0.075, 0.065], 14, 4);
  const muzzle = along(vent(0.06, 0.08), c1, c1.clone().sub(c0));
  root.add(new THREE.Mesh(roughen(merge([barrel, muzzle]), 0.006, 30, 7), k.bone));
  const sh = T(f.shoulder);
  for (let i = 0; i < 2; i++) {
    const grip = c0.clone().lerp(c1, 0.25 + i * 0.4).add(V(0, 0.09, 0)).sub(sh);
    const pts = [V(0, 0, 0), el.clone().sub(sh).multiplyScalar(0.5).add(V(0.12, 0.08 - i * 0.05, 0.05 + i * 0.05)), grip.clone().add(V(0.06, 0.12, -0.06)), grip];
    const g = serpent(sh.clone().add(V(0.06, 0.08 - i * 0.04, 0.04)), pts, 0.036);
    k.sway(g, 0.02, 1.2, i);
  }
}

function juggernautTitan(k: GrowKit): void {
  const { f, root, rand } = k, ch = T(f.chest), ws = T(f.waist), hp = T(f.hips);
  const ivory = chitin(mix(HIVE.bone, ZONE7_SHADE.rock, 0.3), dim(ORGANIC.amber, 0.05), 5);
  ivory.roughness = 0.6; ivory.clearcoat = 0.3;
  // Fused bone plates grown in overlapping layers like tree rings: back, flanks, thighs, forearms.
  const plates: THREE.BufferGeometry[] = [];
  const plateAt = (p: THREE.Vector3, n: THREE.Vector3, w: number, l: number, h: number, trail = V(0, -1, 0)) => {
    const at = k.onSkin(p, n, h * 0.2);
    plates.push(plate(w, l, h, rand, 0.25, 0.7).applyMatrix4(new THREE.Matrix4().compose(at, scaleBasis(n, trail), V(1, 1, 1))));
  };
  for (let row = 0; row < 5; row++) for (let c = -2; c <= 2; c++) {
    const t = row / 4, p = ch.clone().add(V(0, 0.3, -0.05)).lerp(hp, t).add(V(c * 0.13 + (row % 2) * 0.06, 0, 0));
    plateAt(p, V(c * 0.4, 0.5 - t * 0.4, -1), 0.17, 0.15, 0.06);
  }
  for (const s of [-1, 1]) {
    const sh = T(f.shoulder, s), el = T(f.elbow, s), wr = T(f.wrist, s), hip = T(f.hip, s), kn = T(f.knee, s);
    for (let i = 0; i < 4; i++) plateAt(ch.clone().lerp(ws, i / 3).add(V(s * f.r.chest[0] * 0.9, 0, -0.04)), V(s, 0.2, -0.15), 0.15, 0.14, 0.055);
    for (let i = 0; i < 3; i++) plateAt(sh.clone().lerp(el, 0.2 + i * 0.3).add(V(s * f.r.arm, 0, 0)), V(s, 0.3, -0.1), 0.16, 0.14, 0.055, el.clone().sub(sh));
    for (let i = 0; i < 3; i++) plateAt(el.clone().lerp(wr, 0.15 + i * 0.28).add(V(s * f.r.fore, 0, -0.03)), V(s, 0.1, -0.2), 0.17, 0.15, 0.06, wr.clone().sub(el));
    for (let i = 0; i < 2; i++) plateAt(hip.clone().lerp(kn, 0.3 + i * 0.35).add(V(s * 0.05, 0, f.r.thigh)), V(s * 0.3, 0.1, 1), 0.17, 0.15, 0.055, kn.clone().sub(hip));
  }
  root.add(new THREE.Mesh(merge(plates), ivory));
  // The furnace heart in a cage of ribs, glowing dull through the chest and slowly pulsing.
  const front = k.onSkin(ch.clone().add(V(0, -0.2, 0)), V(0, 0, 1), 0.03);
  const heat = bioNode(mix(ORGANIC.amber, HIVE.danger, 0.3), 0.9);
  heat.emissiveIntensity = 0.7;
  const heart = new THREE.Mesh(roughen(new THREE.SphereGeometry(0.11, 22, 16), 0.01, 30, 2), heat);
  heart.position.copy(front).add(V(0, 0, -0.03));
  heart.name = 'furnace';
  root.add(heart);
  k.tick((t) => {
    const beat = Math.pow(Math.max(0, Math.sin(t * 1.3)), 6);
    heat.emissiveIntensity = 0.85 + beat * 0.5;
    heart.scale.setScalar(1 + beat * 0.05);
  });
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const y = front.y + 0.14 - i * 0.09;
    ribs.push(taperTube([V(s * 0.2, y + 0.02, front.z - 0.12), V(s * 0.15, y, front.z + 0.04), V(s * 0.05, y - 0.02, front.z + 0.08), V(s * 0.012, y - 0.03, front.z + 0.06)], [0.024, 0.022, 0.016, 0.01], 9, 3));
  }
  root.add(new THREE.Mesh(roughen(merge(ribs), 0.004, 40, 5), ivory));
  // Bone mauls for hands; the right one fused around the cannon.
  const mauls: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const wr = T(f.wrist, s).add(V(0, -0.12, 0.04));
    mauls.push(roughen(new THREE.SphereGeometry(0.2, 22, 16).scale(1, 1.1, 1.05).translate(wr.x, wr.y, wr.z), 0.025, 12, 3 + s));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, n = V(Math.cos(a), -0.3, Math.sin(a)).normalize();
      mauls.push(along(horn(0.16, 0.05, 0.3, rand), wr.clone().addScaledVector(n, 0.17), n));
    }
    if (s > 0) {
      const c1 = wr.clone().add(V(0, 0.05, 0.62));
      mauls.push(taperTube([wr, wr.clone().lerp(c1, 0.5), c1], [0.12, 0.1, 0.085], 14, 4), along(vent(0.08, 0.1), c1, V(0, 0.08, 1)));
    }
  }
  root.add(new THREE.Mesh(merge(mauls), k.bone));
  // Moss on the back, and the spines of other hosts still stuck in it.
  const moss: THREE.BufferGeometry[] = [], spines: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) {
    const p = ch.clone().add(V(0, 0.3, -0.1)).lerp(ws, rand()).add(V((rand() - 0.5) * 0.5, 0, 0));
    const n = V((rand() - 0.5) * 0.8, 0.9, -1).normalize();
    moss.push(along(pustule(0.02 + rand() * 0.02, i), k.onSkin(p, n, 0.02), n));
  }
  for (let i = 0; i < 7; i++) {
    const p = ch.clone().add(V(0, 0.2, 0)).lerp(hp, rand() * 0.8).add(V((rand() - 0.5) * 0.45, 0, 0));
    const n = V((rand() - 0.5) * 1.2, 0.6 + rand() * 0.6, -1 - rand());
    spines.push(along(spike(0.32 + rand() * 0.25, 0.012, 0.05), k.onSkin(p, n, -0.04), n));
  }
  const lichen = chitin(mix(ZONE7_SHADE.moss, FAUNA.fenMoss, 0.5), dim(FAUNA.sickGreen, 0.04), 20);
  lichen.roughness = 0.95; lichen.clearcoat = 0;
  root.add(new THREE.Mesh(merge(moss), lichen), new THREE.Mesh(merge(spines), chitin(mix(ZONE7_SHADE.rockDeep, HIVE.bone, 0.3), dim(ORGANIC.amber, 0.02), 10)));
}
