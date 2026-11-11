import * as THREE from 'three';
import { FAUNA, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { aimBone } from '../ik';
import { rng } from '../parts';
import type { BodyPlan, Palette } from '../plan';
import type { Creature } from '../creature';
import { damp } from './fx';

/**
 * Veilwing (data/abominations.json `veilwing`): the silent grabber of the Marrow Pit's open shaft. Manta ray ×
 * siphonophore × bat × a jellyfish in a draught. A wide, ragged membrane like a torn sail (holes, frayed notches)
 * stretched over a small bony core, trailing a skirt of long tentacles. It glides the updrafts in slow undulations.
 *
 * Drive (it is a 'flyer': `altitude` sets its height):
 *   windup   it folds: the sail's edges curl down and in and it drops on its target.
 *   action   the grab: the tentacles curl up and in round whatever is under the core, and stay closed while > 0.
 *   velocity tilts it into the glide.
 * Weak point: the bony core (a raw sac under it).
 */

const TENTACLES = 10;
const SAIL_R = 2.6;

export function veilwing(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: FAUNA.rope, vein: ORGANIC.vein, rim: FAUNA.pearl,
    chitin: FAUNA.soot, chitinGlow: ORGANIC.amber, bone: FAUNA.pearl,
    glow: ORGANIC.amber, fluid: ORGANIC.vein, membrane: FAUNA.rope, iris: ORGANIC.mist, sclera: FAUNA.soot,
  };
  const s = 0.92 + r() * 0.16;
  const h = 9;
  const b = new PlanBuilder('veilwing', seed, stage, { locomotion: 'flyer', bodyHeight: h, radius: SAIL_R * s, skinNoise: { amp: 0.008, freq: 14 }, skinResolution: 48, fleshScale: 8, palette: pal });
  b.plan.palette = { ...b.plan.palette, flesh: mix(FAUNA.pearl, FAUNA.soot, 0.45), bone: mix(FAUNA.pearl, FAUNA.rope, 0.3), membrane: mix(FAUNA.rope, FAUNA.pearl, 0.3) };
  const S = (x: number, y: number, z: number) => V(x * s, h + y * s, z * s);
  const body = b.bone('body', -1, V(0, h, 0));
  // The core: a small knot of fused bone and grey flesh, ridged like a vertebra.
  b.skin({ shape: 'ellipsoid', a: S(0, 0, 0.05), radii: V(0.32, 0.2, 0.45).multiplyScalar(s), bone: body, tint: tint('#ffffff', 0.9) });
  b.skin({ shape: 'cone', a: S(0, 0.02, 0.35), b: S(0, -0.02, -0.7), ra: 0.2 * s, rb: 0.05 * s, blend: 0.1 * s, bone: body, ribs: { freq: 14 / s, depth: 0.01 } });
  b.skin({ shape: 'ellipsoid', a: S(0, -0.16, 0), radii: V(0.22, 0.1, 0.26).multiplyScalar(s), blend: 0.08 * s, bone: body, tint: tint('#ffffff', 1.2) });
  for (let i = 0; i < 4; i++) {
    const hit = b.surf(S(0, 1, 0.3 - i * 0.22), V(0, -1, 0));
    b.part({ id: `ridge${i}`, type: 'plate', bone: body, at: hit.at, dir: hit.normal.clone().add(V(0, 0, -0.3)), fwd: V(0, 0, 1), size: (0.2 - i * 0.03) * s, p: [1, 1.2, 0.4, 0.8], material: 'bone' });
  }
  // A ring of pale, lidless eyes under the core, looking down the shaft.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const hit = b.surf(S(Math.cos(a) * 0.2, -1, Math.sin(a) * 0.24), V(0, 1, 0));
    b.part({ id: `eye${i}`, type: 'eye', bone: body, at: hit.at.clone().addScaledVector(hit.normal, -0.01), dir: hit.normal.clone().add(V(Math.cos(a) * 0.3, -0.4, Math.sin(a) * 0.3)), size: 0.04 * s, material: 'eye', dynamic: true });
  }
  b.part({ id: 'core', type: 'sac', bone: body, at: S(0, -0.22, 0), dir: V(0, -1, 0), size: 0.11 * s, material: 'raw', dynamic: true, weak: true });
  // Tentacle skirt: long, thin, hanging from a ring under the core.
  for (let i = 0; i < TENTACLES; i++) {
    const a = (i / TENTACLES) * Math.PI * 2 + r() * 0.2;
    const len = (2.4 + r() * 1.6) * s;
    const id = `tentacle${i}`;
    b.limb({
      id, kind: 'tendril', bone: body, mount: S(Math.cos(a) * 0.24, -0.14, Math.sin(a) * 0.3),
      lengths: Array(4).fill(len / 4), radii: [0.03, 0.024, 0.016, 0.01, 0.004].map((x) => x * s), style: 'tendril', material: 'flesh',
      rest: S(Math.cos(a) * 0.4, -len / s, Math.sin(a) * 0.4), pole: V(Math.cos(a), 0, Math.sin(a)),
    });
    b.hit({ bone: { limb: id, seg: 1 }, at: V(0, 0.2, 0), r: 0.12 * s, weak: false, part: id });
  }
  b.hit({ bone: body, at: S(0, 0, 0), r: 0.5 * s, weak: false });
  b.hit({ bone: body, at: S(0, -0.22, 0), r: 0.2 * s, weak: true, part: 'core' });
  mutate(b, stage, {
    dorsal: [0.25, 0, -0.3].map((z) => S(0, 1, z)), flank: [S(0.6, 0, 0)],
    growth: 'crystals', growthSize: 0.12 * s, nodeSize: 0.03 * s, plateSize: 0.14 * s,
    extra: (bb) => {
      // Stage 3: two barbed grapple tentacles, longer than the rest.
      bb.both((side, n) => bb.limb({ id: `grapple${n}`, kind: 'tendril', bone: body, mount: S(side * 0.15, -0.15, 0.2), lengths: Array(4).fill(1.3 * s), radii: [0.045, 0.035, 0.025, 0.015, 0.006].map((x) => x * s), style: 'needle', material: 'bone', rest: S(side * 0.3, -5, 0.4), pole: V(side, 0, 0), stage: 3 }));
    },
  });
  return b.plan;
}

/** The torn sail: a polar grid of the manta outline with frayed notches and holes; undulates every frame. */
function buildSail(seed: number, radius: number): { geo: THREE.BufferGeometry; rest: Float32Array; rr: Float32Array } {
  const rand = rng(seed * 13 + 5);
  const SPOKES = 56, RINGS = 9;
  const notch = Array.from({ length: SPOKES }, () => (rand() < 0.22 ? 0.55 + rand() * 0.3 : 1));
  const outline = (a: number, i: number) => {
    // Wide to the sides, short fore and aft, a shallow point at the front, frayed.
    const side = Math.pow(Math.abs(Math.sin(a)), 0.7);
    return radius * (0.3 + 0.7 * side + 0.12 * Math.max(0, Math.cos(a))) * notch[i];
  };
  const pos: number[] = [], rr: number[] = [];
  for (let ring = 0; ring <= RINGS; ring++) {
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2;
      const k = 0.12 + (ring / RINGS) * 0.88;
      const rad = outline(a, i) * k;
      pos.push(Math.sin(a) * rad, 0, Math.cos(a) * rad);
      rr.push(k);
    }
  }
  const idx: number[] = [];
  for (let ring = 0; ring < RINGS; ring++) {
    for (let i = 0; i < SPOKES; i++) {
      // Tears: a few cells missing, more toward the edge.
      if (ring > 3 && rand() < 0.035 * ring) continue;
      const a = ring * SPOKES + i, b2 = ring * SPOKES + ((i + 1) % SPOKES), c = a + SPOKES, d = b2 + SPOKES;
      idx.push(a, c, b2, b2, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, rest: new Float32Array(pos), rr: new Float32Array(rr) };
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Sail undulation and folding, and the tentacles closing on a grab. */
export function veilwingMotion(c: Creature) {
  const rig = c.rig;
  const s = c.plan.radius / SAIL_R;
  const { geo, rest, rr } = buildSail(c.plan.seed, SAIL_R * s);
  const mat = rig.materials.membrane as THREE.MeshStandardMaterial;
  mat.side = THREE.DoubleSide;
  const sail = new THREE.Mesh(geo, mat);
  sail.name = 'veil';
  sail.frustumCulled = false;
  sail.position.set(0, 0.08 * s, 0);
  rig.bones[0].add(sail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const tentacles = [...rig.limbs.values()].filter((l) => l.spec.kind === 'tendril');
  let t = Math.random() * 10, fold = 0, grab = 0, frame = 0;
  return {
    sail,
    update(dt: number): void {
      const d = c.drive;
      t += dt;
      const alive = c.alive;
      fold = damp(fold, alive ? d.windup : 0.8, alive ? 6 : 1.5, dt);
      grab = damp(grab, alive ? d.action : 0, 7, dt);
      const speed = Math.hypot(d.velocity.x, d.velocity.z);
      // Sail: a slow manta beat from the core out, a travelling ripple, camber, and the fold.
      if (frame++ % 2 === 0 || dt > 0.03) {
        const beat = alive ? Math.sin(t * (0.9 + speed * 0.05)) : 0;
        for (let i = 0; i < pos.count; i++) {
          const x = rest[i * 3], z = rest[i * 3 + 2], k = rr[i];
          const ax = Math.abs(x) / (SAIL_R * s);
          const shrink = 1 - fold * 0.35 * k;
          const ripple = Math.sin(t * 2.2 - k * 5 + z * 0.8) * 0.12 * k * s;
          const y = -0.25 * k * k * s + beat * 0.55 * ax * ax * s + ripple - fold * 1.9 * k * k * s - grab * 0.4 * k * s;
          pos.setXYZ(i, x * shrink, y, z * shrink);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
      }
      // Tentacles: trail (shared code), then close round the prey on a grab.
      if (grab > 0.02) {
        const core = rig.bones[0].getWorldPosition(_w);
        for (const l of tentacles) {
          if (l.severed) continue;
          const mount = l.bones[0].getWorldPosition(_v).clone();
          const out = mount.clone().sub(core).setY(0).normalize();
          for (let i = 0; i < l.bones.length - 1; i++) {
            const curl = grab * (i + 1) / l.bones.length;
            const dir = new THREE.Vector3(0, -1 + curl * 1.9, 0).addScaledVector(out, 0.5 * grab - curl * 1.5).normalize();
            aimBone(l.bones[i], dir, out);
          }
        }
      }
    },
  };
}
