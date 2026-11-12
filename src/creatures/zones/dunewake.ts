import * as THREE from 'three';
import { FAUNA, ORGANIC } from '../../render/palette';
import { PlanBuilder, V, mix, mutate, tint } from '../builder';
import { rng } from '../parts';
import { organic, readable } from './organic';
import type { BodyPlan, Palette } from '../plan';
import type { Creature } from '../creature';
import { GroundFx, damp, smooth } from './fx';

/**
 * Dunewake (data/abominations.json `dunewake`): an eel-bodied sand swimmer the length of a person. Sandfish skink ×
 * lamprey × mole. Skin like wet sandpaper the colour of the dunes, a row of worn dorsal hooks, sculling paddles
 * along its flanks, and a blunt shovel of four fused plates for a head. The shovel splits four ways to show a
 * ring of glass-clear teeth around a raw gullet (the weak point, "split jaw").
 *
 * Drive (the PvE AI writes these on Creature.drive):
 *   burrow   0 = on the sand, 1 = swimming under it. Ease it over ~0.5 s. Diving: the head goes under first and the
 *            tail follows; surfacing: the head breaks out first, throwing sand. Buried and moving, it leaves the
 *            line of racing ripples that is its only tell.
 *   windup   the front third rears like a striking snake and the jaw plates split open.
 *   action   jaws open without rearing (feeding, the hiss).
 *   velocity drives the swimming wave; the body hugs the ground under every spine bone.
 */

const SPINE = 8; // head + 7 trunk/tail bones, front to back
const SPACING = 0.3;

export function dunewake(seed: number, stage = 0): BodyPlan {
  const r = rng(seed);
  const pal: Palette = {
    flesh: FAUNA.sand, vein: ORGANIC.vein, rim: FAUNA.dustPale,
    chitin: FAUNA.sandDeep, chitinGlow: ORGANIC.amber, bone: FAUNA.dustPale,
    glow: ORGANIC.amber, fluid: ORGANIC.vein, membrane: FAUNA.dustPale, iris: ORGANIC.amber, sclera: FAUNA.soot,
  };
  const s = 0.92 + r() * 0.16;
  const h = 0.2 * s;
  const b = new PlanBuilder('dunewake', seed, stage, { locomotion: 'walker', bodyHeight: h, radius: 0.55 * s, skinNoise: { amp: 0.005, freq: 46 }, skinResolution: 64, fleshScale: 14, palette: pal });
  organic(b, rng(seed * 17 + 3));
  // Sand-coloured on purpose: the shared naturalise pass would turn it to wet meat. Keep the dune tones.
  b.plan.palette = { ...b.plan.palette, flesh: mix(FAUNA.sand, FAUNA.ochre, 0.18), chitin: mix(FAUNA.sandDeep, FAUNA.ochre, 0.3), bone: mix(FAUNA.dustPale, FAUNA.sand, 0.3), rim: FAUNA.dustPale, membrane: mix(FAUNA.dustPale, FAUNA.sand, 0.5) };
  readable(b);
  const body = b.bone('body', -1, V(0, h, 0));
  const zAt = (i: number) => (1.0 - i * SPACING) * s;
  const radius = [0.12, 0.125, 0.13, 0.125, 0.11, 0.09, 0.065, 0.04].map((x) => x * s);
  // Flat spine: every spine bone hangs straight off the body, so the swim wave can place each one directly.
  const spine: number[] = [];
  for (let i = 0; i < SPINE; i++) spine.push(b.bone(i === 0 ? 'head' : `spine${i}`, body, V(0, h, zAt(i))));
  const head = spine[0];
  const belly = tint('#ffffff', 1.22), back = tint('#ffffff', 0.86);
  // Trunk: overlapping ribbed cones, a little flattened by a pale belly keel.
  for (let i = 0; i < SPINE - 1; i++) {
    b.skin({ shape: 'cone', a: V(0, h, zAt(i)), b: V(0, h - 0.01 * i * s, zAt(i + 1)), ra: radius[i], rb: radius[i + 1], blend: 0.08 * s, bone: spine[i + 1], ribs: { freq: 22 / s, depth: 0.006 }, tint: back });
    b.skin({ shape: 'ellipsoid', a: V(0, h - radius[i] * 0.45, zAt(i) - SPACING * 0.5 * s), radii: V(radius[i] * 0.95, radius[i] * 0.5, SPACING * 0.75 * s), blend: 0.06 * s, bone: spine[i + 1], tint: belly });
  }
  b.skin({ shape: 'cone', a: V(0, h - 0.03 * s, zAt(SPINE - 1)), b: V(0, h - 0.05 * s, zAt(SPINE - 1) - 0.25 * s), ra: radius[SPINE - 1], rb: 0.012 * s, blend: 0.05, bone: spine[SPINE - 1] });
  // Head: a blunt wedge, wider than tall, with the mouth bored into its front.
  b.skin({ shape: 'ellipsoid', a: V(0, h + 0.005, zAt(0) + 0.09 * s), radii: V(0.16, 0.085, 0.2).multiplyScalar(s), blend: 0.07 * s, bone: head, tint: back });
  b.skin({ shape: 'cone', a: V(0, h, zAt(0) + 0.32 * s), b: V(0, h, zAt(0) + 0.06 * s), ra: 0.1 * s, rb: 0.035 * s, subtract: true, blend: 0.03, bone: head });
  // Four fused jaw plates: the shovel. They split open on the strike (dynamic, the motion swings them).
  const mouthZ = zAt(0) + 0.2 * s;
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sy], i) => {
    b.part({ id: `jaw${i}`, type: 'plate', bone: head, at: V(sx * 0.065 * s, h + sy * 0.05 * s, mouthZ - 0.06 * s), dir: V(sx * 0.9, sy * 1.0, 0.35), fwd: V(0, 0, 1), size: 0.13 * s, p: [0.62, 1.35, 0.3, 0.6], material: 'chitin', dynamic: true });
  });
  b.part({ id: 'teeth', type: 'needleRing', bone: head, at: V(0, h, mouthZ - 0.02 * s), dir: V(0, 0, 1), fwd: V(0, 1, 0), size: 0.07 * s, p: [16, 0.9, 0.85], material: 'glass' });
  b.part({ id: 'teeth2', type: 'needleRing', bone: head, at: V(0, h, mouthZ - 0.08 * s), dir: V(0, 0, 1), fwd: V(0, 1, 0), size: 0.05 * s, p: [11, 1, 0.9], material: 'glass' });
  // The gullet: raw, wet, the only soft target. Swells on the strike.
  b.part({ id: 'gullet', type: 'pustule', bone: head, at: V(0, h, mouthZ - 0.13 * s), dir: V(0, 0, 1), size: 0.05 * s, material: 'raw', dynamic: true, weak: true });
  // Pit eyes: a crescent of six small sunken eyes over the shovel. They barely see; the body feels the ground.
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.045;
    const hit = b.surf(V(x * s, h + 0.4 * s, zAt(0) + (0.05 - Math.abs(i - 2.5) * 0.02) * s), V(0, -1, 0.1));
    b.part({ id: `eye${i}`, type: 'eye', bone: head, at: hit.at.clone().addScaledVector(hit.normal, -0.008), dir: hit.normal.clone().add(V(0, 0.1, 0.7)), size: (0.013 + (i === 2 || i === 3 ? 0.004 : 0)) * s, material: 'eye', dynamic: true });
  }
  // Dorsal barbs: short, worn hooks down the spine.
  for (let i = 1; i < SPINE - 1; i++) {
    const hit = b.surf(V(0, h + 0.5 * s, zAt(i)), V(0, -1, 0));
    b.part({ id: `barb${i}`, type: 'spike', bone: spine[i], at: hit.at, dir: hit.normal.clone().add(V(0, 0, -1.4)), fwd: V(0, 1, 0), size: radius[i] * (0.45 + r() * 0.2), p: [0.16, 0.3], material: 'chitin' });
  }
  // Sculling fins: short paddles low on each flank, one pair per trunk bone so they ride the wave.
  for (let i = 2; i <= 5; i += 1) b.both((side, n) => b.part({ id: `fin${n}${i}`, type: 'plate', bone: spine[i], at: V(side * radius[i] * 0.85, h - radius[i] * 0.45, zAt(i)), dir: V(side, -0.6, -0.2), fwd: V(0, 0, -1), size: radius[i] * 0.8, p: [0.5, 1.6, 0.12, 0.2], material: 'chitin' }));
  // Hits: one per pair of spine bones, the head, and the gullet.
  b.hit({ bone: spine[2], at: V(0, h, zAt(2)), r: 0.22 * s, weak: false });
  b.hit({ bone: head, at: V(0, h, zAt(0) + 0.08 * s), r: 0.19 * s, weak: false });
  b.hit({ bone: spine[4], at: V(0, h, zAt(4)), r: 0.2 * s, weak: false });
  b.hit({ bone: spine[6], at: V(0, h, zAt(6)), r: 0.15 * s, weak: false });
  b.hit({ bone: head, at: V(0, h, mouthZ - 0.06 * s), r: 0.09 * s, weak: true, part: 'gullet' });
  mutate(b, stage, {
    dorsal: [1, 2, 3, 4, 5].map((i) => V(0, h + 0.5 * s, zAt(i))), flank: [V(0.3 * s, h, zAt(2)), V(0.3 * s, h, zAt(4))],
    growth: 'crystals', growthSize: 0.08 * s, nodeSize: 0.02 * s, plateSize: 0.09 * s,
    extra: (bb) => bb.both((side, n) => {
      // Stage 3: a pair of digging forelimbs grows back behind the head (the skink remembers its legs).
      bb.limb({ id: `digger${n}`, kind: 'arm', bone: spine[1], mount: V(side * 0.12 * s, h - 0.05 * s, zAt(1)), lengths: [0.12 * s, 0.14 * s, 0.08 * s], radii: [0.025, 0.02, 0.014, 0.004].map((x) => x * s), style: 'mantis', material: 'chitin', rest: V(side * 0.24 * s, 0.02, zAt(1) + 0.12 * s), pole: V(side, 1, 0), stage: 3 });
    }),
  });
  return b.plan;
}

const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Swim wave, burrowing and the strike for a Dunewake. */
export function dunewakeMotion(c: Creature) {
  const rig = c.rig;
  const spine = Array.from({ length: SPINE }, (_, i) => rig.bones.find((bn) => bn.name === (i === 0 ? 'head' : `spine${i}`))!);
  const rest = spine.map((bn) => bn.position.clone());
  const depth = new Array(SPINE).fill(0);
  const jaws = [0, 1, 2, 3].map((i) => rig.parts.get(`jaw${i}`)!).filter(Boolean);
  const fx = new GroundFx(rig.root, { mounds: 14, puffs: 18 });
  const s = c.plan.radius / 0.55;
  const DIVE = 0.55 * s; // how deep it runs under the sand
  let phase = Math.random() * 10;
  let lastBurrow = c.drive.burrow;
  let diving = true;
  let rippleT = 0;
  let open = 0;
  let rear = 0;
  return {
    update(dt: number): void {
      const d = c.drive;
      const speed = Math.hypot(d.velocity.x, d.velocity.z);
      const db = d.burrow - lastBurrow;
      if (Math.abs(db) > 1e-4) diving = db > 0;
      lastBurrow = d.burrow;
      const alive = c.alive;
      phase += dt * (alive ? 2.2 + speed * 2.6 + d.excite * 1.5 : 0);
      const amp = alive ? (0.035 + Math.min(1, speed / 6) * 0.11 + d.excite * 0.02) * s : 0;
      open = damp(open, alive ? Math.max(d.windup, d.action) : 0.25, 14, dt);
      rear = damp(rear, alive && d.burrow < 0.5 ? d.windup : 0, 10, dt);
      rig.root.updateMatrixWorld(true);
      const rootY = c.worldPos.y;
      const emerging: number[] = [];
      for (let i = 0; i < SPINE; i++) {
        const t = i / (SPINE - 1);
        // Head leads both ways: diving it goes under first, surfacing it breaks out first.
        const lag = diving ? t * 0.5 : (1 - t) * 0.5;
        const target = smooth(d.burrow * 1.5 - lag);
        const before = depth[i];
        depth[i] = damp(depth[i], target, 16, dt);
        if ((before - 0.5) * (depth[i] - 0.5) < 0) emerging.push(i);
        // Lateral wave, travelling back along the body, stronger toward the tail.
        const x = Math.sin(phase - i * 0.95) * amp * (0.35 + t * 0.9);
        const yawSlope = Math.cos(phase - i * 0.95) * amp * (0.35 + t * 0.9) * 0.95 / (SPACING * s);
        // The strike: the front third rears into an S and the head points down at the target.
        const reared = rear * Math.max(0, 1 - i / 3.2);
        // Hug the ground under this bone.
        _w.copy(rest[i]).applyMatrix4(rig.root.matrixWorld);
        const groundOff = c.ground(_w.x, _w.z) - rootY;
        const bn = spine[i];
        bn.position.set(rest[i].x + x * (1 - reared), rest[i].y + groundOff - depth[i] * DIVE + reared * 0.55 * s, rest[i].z - reared * 0.12 * s);
        const nextDepth = depth[Math.min(SPINE - 1, i + 1)], prevDepth = depth[Math.max(0, i - 1)];
        const pitch = Math.atan2((nextDepth - prevDepth) * DIVE, SPACING * s * 2) * 0.9 - reared * (i === 0 ? -0.5 : 0.9);
        _e.set(pitch, -Math.atan(yawSlope) * (1 - reared), x * 1.5 / s);
        bn.quaternion.setFromEuler(_e);
      }
      // The body bone carries no skin of its own: hold it at rest so the spine places itself.
      // Jaws: each plate swings out along its own direction from the mouth.
      for (const [i, p] of jaws.entries()) {
        p.mesh.position.setFromMatrixPosition(p.base);
        p.mesh.quaternion.setFromRotationMatrix(p.base);
        const sx = i % 2 ? 1 : -1, sy = i < 2 ? 1 : -1;
        _q.setFromEuler(_e.set(-sy * open * 0.75, 0, -sx * open * 0.55));
        p.mesh.quaternion.premultiply(_q);
      }
      // Sand: spray where a bone breaks or leaves the surface, and the racing ripple line while it swims under.
      for (const i of emerging) {
        spine[i].getWorldPosition(_w);
        _w.y = c.ground(_w.x, _w.z);
        for (let k = 0; k < 2; k++) fx.puff(_w, (0.16 + Math.random() * 0.1) * s, diving ? 1.4 : 2.6);
        fx.mound(_w, 0.35 * s, 0, 0.9);
      }
      rippleT -= dt;
      if (alive && d.burrow > 0.7 && speed > 0.4 && rippleT <= 0) {
        rippleT = THREE.MathUtils.clamp(0.5 / speed, 0.06, 0.25);
        spine[0].getWorldPosition(_w);
        _w.y = c.ground(_w.x, _w.z);
        const yaw = Math.atan2(d.velocity.x, d.velocity.z);
        fx.mound(_w, (0.24 + Math.random() * 0.08) * s, yaw, 1.4);
        if (Math.random() < 0.35) fx.puff(_w, 0.1 * s, 0.8, 0.7);
      }
      fx.update(dt);
    },
    get fx() { return fx; },
  };
}
