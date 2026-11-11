import * as THREE from 'three';
import { bioTime } from '../render/materials';
import { aimBone, solveTwoBone } from './ik';
import { buildRig, refreshHits, type LimbRig, type Rig } from './rig';
import { planFor } from './species';
import type { BodyPlan, SpeciesId } from './plan';

/**
 * A living creature: rig + procedural locomotion + secondary animation. Behaviour code (Abomination, the
 * PvE AI) owns the root transform and tells it how fast it is going and how excited it is; this class makes
 * the body follow: feet plant and step on the terrain in gait groups, the body rides the feet, wings flap,
 * tendrils trail, eyes track, glows pulse with excitement and flare on wind-up.
 */

export type GroundFn = (x: number, z: number) => number;
const FLAT: GroundFn = () => 0;

interface Foot {
  limb: LimbRig;
  /** Planted world position, or the current swing position. */
  pos: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Swing progress 0..1; >= 1 when planted. */
  t: number;
}

interface Trail { limb: LimbRig; dirs: THREE.Vector3[] }

export interface DriveState {
  /** World-space velocity of the root (m/s). */
  velocity: THREE.Vector3;
  /** 0 = idle, 1 = hunting. Speeds gait and pulse, brightens glows. */
  excite: number;
  /** 0..1 attack wind-up: weak points swell and flare, the body coils. */
  windup: number;
  /** World point the eyes and head track, if any. */
  look: THREE.Vector3 | null;
  /** World point the arms strike toward while windup > 0 (mantis blades), if any. */
  strike: THREE.Vector3 | null;
  /** Extra glow multiplier (Psych-Wave reveal). */
  reveal: number;
  /** Hover and flight: body height above the root, overriding the plan's rest height. */
  altitude: number | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const _w = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Creature {
  readonly rig: Rig;
  readonly plan: BodyPlan;
  readonly drive: DriveState = { velocity: new THREE.Vector3(), excite: 0, windup: 0, look: null, strike: null, reveal: 1, altitude: null };
  ground: GroundFn = FLAT;
  /** Set false to freeze locomotion (dead bodies; the gore code poses them). */
  alive = true;
  private feet: Foot[] = [];
  private trails: Trail[] = [];
  private lastGroup = 1;
  private gait = 0;
  private bob = 0;
  private bodyRest: THREE.Vector3;
  private bodyTilt = new THREE.Euler();
  private time = Math.random() * 10;
  private planted = false;
  private deadFor = -1;
  private fallV = 0;

  constructor(planOrSpecies: BodyPlan | SpeciesId, seed = 1, stage = 0, opts: { growStage?: number } = {}) {
    this.plan = typeof planOrSpecies === 'string' ? planFor(planOrSpecies, seed, stage) : planOrSpecies;
    this.rig = buildRig(this.plan, opts);
    this.bodyRest = this.rig.bones[0].position.clone();
    for (const l of this.rig.limbs.values()) {
      if (l.spec.kind === 'leg') this.feet.push({ limb: l, pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1 });
      if (l.spec.kind === 'tendril') this.trails.push({ limb: l, dirs: l.spec.lengths.map(() => new THREE.Vector3()) });
    }
  }

  get root(): THREE.Group { return this.rig.root; }

  /** The root's world position (behaviour code may parent the rig under its own moving group). */
  private readonly _wp = new THREE.Vector3();
  get worldPos(): THREE.Vector3 { return this.rig.root.getWorldPosition(this._wp); }

  /** Collapse: walkers drop onto their belly with legs splayed, fliers and hoverers fall out of the air. */
  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.deadFor = 0;
    this.fallV = 0;
    this.drive.excite = 0;
    this.drive.windup = 0;
  }
  get species(): SpeciesId { return this.plan.species; }

  /** Put every foot on the ground under its rest point (after teleporting the root). */
  plant(): void {
    this.rig.root.updateMatrixWorld(true);
    for (const f of this.feet) {
      this.restFoot(f.limb, f.pos, 0);
      f.from.copy(f.pos); f.to.copy(f.pos); f.t = 1;
    }
    for (const t of this.trails) {
      const d = t.limb.spec.rest.clone().sub(t.limb.spec.mount).normalize().transformDirection(this.rig.root.matrixWorld);
      for (const v of t.dirs) v.copy(d);
    }
    this.planted = true;
  }

  /** Where this leg's foot wants to be: its rest point, pushed ahead by velocity, on the ground. */
  private restFoot(l: LimbRig, out: THREE.Vector3, lead: number): THREE.Vector3 {
    out.copy(l.spec.rest).applyMatrix4(this.rig.root.matrixWorld);
    out.addScaledVector(this.drive.velocity, lead);
    out.y = this.ground(out.x, out.z);
    return out;
  }

  update(dt: number): void {
    if (!this.planted) this.plant();
    this.time += dt;
    const root = this.rig.root;
    root.updateMatrixWorld(true);
    const d = this.drive;
    const speed = Math.hypot(d.velocity.x, d.velocity.z);
    const body = this.rig.bones[0];
    const loco = this.plan.locomotion;
    const scale = this.plan.radius;

    if (loco === 'walker' && this.alive) this.walk(dt, speed);
    if (!this.alive) { this.deathPose(dt); return; }

    // Body ride: bob with the gait, lean into acceleration, coil on wind-up.
    this.gait += dt * (0.6 + speed * 2.2 / Math.max(0.4, scale));
    const stride = Math.min(1, speed / (2 + scale));
    if (loco === 'walker') {
      this.bob = Math.abs(Math.sin(this.gait * 2)) * 0.04 * scale * stride;
      // Missing legs sag the body toward their side.
      let sagX = 0, sagZ = 0, missing = 0;
      for (const f of this.feet) if (f.limb.severed) { sagX += f.limb.spec.mount.x; sagZ += f.limb.spec.mount.z; missing++; }
      const restY = this.bodyRest.y - missing * 0.06 * scale;
      body.position.set(this.bodyRest.x, restY + this.bob - d.windup * 0.08 * scale + this.footHeightOffset(), this.bodyRest.z);
      this.bodyTilt.set(-d.windup * 0.25 + this.feetPitch() + sagZ * 0.15, 0, -sagX * 0.25 + Math.sin(this.gait) * 0.03 * stride);
    } else if (loco === 'hover') {
      body.position.set(this.bodyRest.x, (d.altitude ?? this.bodyRest.y) + Math.sin(this.time * 0.9) * 0.25, this.bodyRest.z);
      this.bodyTilt.set(Math.cos(this.time * 0.6) * 0.05 + d.velocity.z * 0.02, 0, Math.sin(this.time * 0.7) * 0.06 - d.velocity.x * 0.02);
    } else {
      body.position.set(this.bodyRest.x, (d.altitude ?? this.bodyRest.y) + Math.sin(this.time * 6) * 0.04 + Math.sin(this.time * 1.3) * 0.15, this.bodyRest.z);
      this.bodyTilt.set(0.2 * Math.min(1, speed / 6) + Math.sin(this.time * 6) * 0.05, 0, Math.sin(this.time * 2.1) * 0.12);
    }
    body.quaternion.setFromEuler(this.bodyTilt);
    body.updateMatrixWorld(true);

    // After the body moved, re-reach planted feet so they stay nailed to the ground.
    if (loco === 'walker') for (const f of this.feet) if (!f.limb.severed) this.reach(f);
    this.animateLimbs(dt, speed);
    this.animateParts();
    refreshHits(this.rig);
  }

  private deathPose(dt: number): void {
    this.deadFor += dt;
    const k = Math.min(1, this.deadFor / 0.7), e = k * k;
    const body = this.rig.bones[0];
    const r = this.plan.radius;
    if (this.plan.locomotion === 'walker') {
      // Drop onto the belly and roll a little; the planted feet splay out as the body sinks.
      const belly = Math.max(0.15, this.bodyRest.y * 0.35);
      body.position.y = THREE.MathUtils.lerp(this.bodyRest.y, belly + this.footHeightOffset(), e);
      body.rotation.set(THREE.MathUtils.lerp(0, 0.12, e), 0, THREE.MathUtils.lerp(0, 0.35, e) * (this.plan.seed % 2 ? 1 : -1));
      if (this.deadFor < 0.7) for (const f of this.feet) {
        if (f.limb.severed) continue;
        f.pos.addScaledVector(_v.copy(f.pos).sub(this.worldPos).setY(0).normalize(), (0.35 * r * dt) / 0.7);
        f.pos.y = this.ground(f.pos.x, f.pos.z);
      }
      body.updateMatrixWorld(true);
      for (const f of this.feet) if (!f.limb.severed) this.reach(f);
      // Twitching.
      for (const l of this.rig.limbs.values()) if (l.spec.kind !== 'leg' && !l.severed && l.bones[1]) l.bones[1].rotateX(Math.sin(this.deadFor * 30) * 0.02 * (1 - k));
    } else {
      // Out of the sky: gravity until the body rests on the ground.
      const w = this.worldPos;
      const floor = this.ground(w.x, w.z) - w.y + r * 0.45;
      if (body.position.y > floor) { this.fallV += 12 * dt; body.position.y = Math.max(floor, body.position.y - this.fallV * dt); }
      body.rotation.x = THREE.MathUtils.lerp(0, 0.5, e);
      for (const t of this.trails) for (let i = 0; i < t.dirs.length; i++) { t.dirs[i].lerp(_v.set(Math.sin(i + t.limb.spec.mount.x) * 0.8, -0.3, Math.cos(i) * 0.8).normalize(), dt * 2).normalize(); aimBone(t.limb.bones[i], t.dirs[i], UP); }
    }
    for (const g of this.rig.glows) g.mat.emissiveIntensity = Math.max(0.04, g.mat.emissiveIntensity - dt * 1.2);
    for (const p of this.rig.parts.values()) {
      const m = p.mesh.material as THREE.MeshStandardMaterial;
      if (m.emissive && (p.spec.weak || p.spec.type === 'pustule')) m.emissiveIntensity = Math.max(0.04, m.emissiveIntensity - dt * 2);
    }
    body.updateMatrixWorld(true);
    refreshHits(this.rig);
  }

  /** Average planted foot height relative to the root (slopes lift or drop the body). */
  private footHeightOffset(): number {
    let s = 0, n = 0;
    for (const f of this.feet) if (!f.limb.severed) { s += f.pos.y; n++; }
    return n ? s / n - this.worldPos.y : 0;
  }

  private feetPitch(): number {
    let front = 0, nf = 0, back = 0, nb = 0;
    for (const f of this.feet) {
      if (f.limb.severed) continue;
      if (f.limb.spec.rest.z >= 0) { front += f.pos.y; nf++; } else { back += f.pos.y; nb++; }
    }
    if (!nf || !nb) return 0;
    const span = Math.max(0.5, this.plan.radius * 1.5);
    return -Math.atan2(front / nf - back / nb, span) * 0.8;
  }

  private walk(dt: number, speed: number): void {
    const scale = this.plan.radius;
    const stepTime = THREE.MathUtils.clamp(0.42 * Math.sqrt(scale) / (0.6 + speed * 0.25), 0.1, 0.6);
    const threshold = (0.18 + 0.25 * scale) * (speed > 0.1 ? 1 : 0.5);
    const lead = stepTime * 0.6;
    // Advance swings.
    let swinging = [0, 0];
    for (const f of this.feet) {
      if (f.limb.severed) continue;
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / stepTime);
        const k = f.t * f.t * (3 - 2 * f.t);
        f.pos.lerpVectors(f.from, f.to, k);
        f.pos.y += Math.sin(f.t * Math.PI) * (0.08 + scale * 0.12) * Math.min(1, 0.4 + speed * 0.2);
        if (f.t < 1) swinging[f.limb.spec.gait]++;
      }
    }
    // Start steps: one gait group at a time, alternating.
    const group = (this.lastGroup + 1) % 2;
    if (swinging[0] + swinging[1] === 0) {
      let started = false;
      for (const g of [group, this.lastGroup]) {
        for (const f of this.feet) {
          if (f.limb.severed || f.limb.spec.gait !== g) continue;
          this.restFoot(f.limb, _w, lead);
          if (_w.distanceTo(f.pos) > threshold) started = true;
        }
        if (started) {
          for (const f of this.feet) {
            if (f.limb.severed || f.limb.spec.gait !== g) continue;
            f.from.copy(f.pos);
            this.restFoot(f.limb, f.to, lead);
            f.t = 0;
          }
          this.lastGroup = g;
          break;
        }
      }
    }
    swinging = [0, 0];
  }

  /** IK a leg to its foot. Three-segment legs keep the last segment pointing down at the foot. */
  private reach(f: Foot): void {
    const l = f.limb, s = l.spec;
    const pole = _v.copy(s.pole).transformDirection(this.rig.root.matrixWorld);
    if (s.lengths.length >= 3) {
      _w.copy(f.pos); _w.y += s.lengths[2] * 0.92;
      solveTwoBone(l.bones[0], l.bones[1], s.lengths[0], s.lengths[1], _w, pole);
      const ankle = l.bones[2].getWorldPosition(new THREE.Vector3());
      aimBone(l.bones[2], _w.copy(f.pos).sub(ankle), pole);
    } else {
      solveTwoBone(l.bones[0], l.bones[1], s.lengths[0], s.lengths[1], f.pos, pole);
    }
  }

  private animateLimbs(dt: number, speed: number): void {
    const d = this.drive, root = this.rig.root;
    for (const l of this.rig.limbs.values()) {
      if (l.severed) continue;
      const s = l.spec;
      if (s.kind === 'arm') {
        // Mantis arms: folded at rest, unfold toward the strike point on wind-up.
        const rest = _w.copy(s.rest).applyMatrix4(root.matrixWorld);
        rest.y += Math.sin(this.time * 1.7 + s.mount.x * 10) * 0.02;
        if (d.strike && d.windup > 0) rest.lerp(d.strike, Math.min(1, d.windup * 1.2));
        const pole = _v.copy(s.pole).transformDirection(root.matrixWorld);
        const goal = rest.clone();
        solveTwoBone(l.bones[0], l.bones[1], s.lengths[0], s.lengths[1], goal, pole);
        if (s.lengths.length >= 3) {
          // Fold the blade back along the forearm, or snap it forward when striking.
          const wrist = l.bones[2].getWorldPosition(new THREE.Vector3());
          const shoulder = l.bones[0].getWorldPosition(new THREE.Vector3());
          const bladeDir = new THREE.Vector3().subVectors(shoulder, wrist).normalize().lerp(UP.clone().negate(), 0.3);
          if (d.windup > 0.6 && d.strike) bladeDir.subVectors(d.strike, wrist);
          aimBone(l.bones[2], bladeDir, pole);
        }
      } else if (s.kind === 'wing') {
        // Moth flap: fast beat around the body's long axis, phase-offset fore and hind pairs.
        const side = Math.sign(s.mount.x) || 1;
        const phase = s.mount.z * 8;
        const flap = Math.sin(this.time * (16 + d.excite * 8) + phase) * 0.9;
        const out = new THREE.Vector3().subVectors(s.rest, s.mount).normalize();
        out.applyAxisAngle(new THREE.Vector3(0, 0, 1), side * flap * 0.8);
        out.transformDirection(this.rig.bones[0].matrixWorld);
        const pole = _v.set(0, 0, 1).transformDirection(this.rig.bones[0].matrixWorld);
        aimBone(l.bones[0], out, pole);
      }
    }
    // Tendrils: each segment eases toward hanging straight down, dragged back by velocity and swayed by a slow wave.
    for (const t of this.trails) {
      if (t.limb.severed) continue;
      const l = t.limb;
      const pole = _v.copy(l.spec.pole).transformDirection(root.matrixWorld);
      for (let i = 0; i < t.dirs.length; i++) {
        const target = new THREE.Vector3(
          -d.velocity.x * 0.12 + Math.sin(this.time * 1.2 + i * 0.7 + l.spec.mount.x * 3) * 0.18 * (i + 1) * 0.5,
          -1,
          -d.velocity.z * 0.12 + Math.cos(this.time * 1.0 + i * 0.9 + l.spec.mount.z * 3) * 0.18 * (i + 1) * 0.5,
        ).normalize();
        t.dirs[i].lerp(target, 1 - Math.exp(-dt * (3 - i * 0.4))).normalize();
        aimBone(l.bones[i], t.dirs[i], pole);
      }
    }
    void speed;
  }

  private animateParts(): void {
    const d = this.drive, time = bioTime.value + this.time;
    const rig = this.rig;
    const glowK = (0.75 + d.excite * 0.55) * d.reveal;
    for (const g of rig.glows) g.mat.emissiveIntensity = g.base * glowK;
    for (const p of rig.parts.values()) {
      const s = p.spec, m = p.mesh;
      m.position.setFromMatrixPosition(p.base);
      if (s.weak || s.type === 'pustule') {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (p.mesh.userData.popped) continue;
        const swell = 1 + d.windup * 0.5 + Math.sin(time * 4 + s.at.x * 5) * 0.04;
        m.scale.setScalar(swell);
        mat.emissiveIntensity = (0.75 + d.windup * 4) * d.reveal;
      } else if (s.type === 'membraneDome') {
        // Bells and bladders breathe; faster when hunting, clench on wind-up.
        const rate = this.plan.locomotion === 'hover' ? 1.6 : 2.5 + d.excite * 4.5;
        const k = Math.sin(time * rate) * (this.plan.locomotion === 'hover' ? 0.025 : 0.07);
        m.scale.set(1 + k - d.windup * 0.12, 1 + k - d.windup * 0.12, 1 - k * 0.7);
      } else if (s.type === 'eye' && d.look) {
        // Eyes track the target, within a cone.
        _w.copy(d.look);
        p.bone.worldToLocal(_w);
        const rest = new THREE.Quaternion().setFromRotationMatrix(p.base);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rest);
        const to = _w.sub(m.position).normalize();
        if (to.dot(fwd) > 0.2) {
          _q.setFromUnitVectors(fwd, to);
          m.quaternion.copy(_q.multiply(rest));
        }
      } else if (s.type === 'frill') {
        m.rotation.setFromRotationMatrix(p.base);
        m.rotateY(Math.sin(time * 5 + s.at.z * 6) * 0.15);
      }
    }
    // Bile Cantor vocal sacs swell as it sings.
    for (const b of rig.bones) {
      if (!b.name.startsWith('sac')) continue;
      const i = Number(b.name.slice(3));
      const k = Math.sin(time * 6 + i) * (0.08 + d.windup * 0.25);
      b.scale.set(1 + k, 1 + k * 1.6, 1 + k);
    }
  }

  /** Swap this creature's look for a mutated stage with the dissolve-grow transition; returns the new creature. */
  static grown(from: Creature, stage: number): Creature {
    const next = new Creature(planFor(from.species, from.plan.seed, stage), 1, 0, { growStage: from.plan.stage + 1 });
    next.root.position.copy(from.root.position);
    next.root.quaternion.copy(from.root.quaternion);
    next.ground = from.ground;
    next.time = from.time;
    // Carry the planted feet over so the swap is seamless.
    from.feet.forEach((f, i) => { const g = next.feet[i]; if (g) { g.pos.copy(f.pos); g.from.copy(f.from); g.to.copy(f.to); g.t = f.t; } });
    next.planted = from.planted;
    return next;
  }
}

export { refreshHits };
