/**
 * The Warden of the Long Seed in a raid (PvE AI). Joins the renderer-free brain (src/ai/warden.ts), Creature's body
 * (src/creatures/warden.ts) and World's reactor chamber (src/world/wreck.ts WardenArena): Biomass and weak points
 * (seed pods, reactor seams), hit tests, the coolant valves that crack its seams, and the brain's events turned into
 * what they do to the host. The reactor pulse comes from the core and is stopped by the shield pillars (anything
 * solid between the core and the host). Every number comes from data/bosses.json `warden` and data/ai.json `warden`.
 * The raid applies the results (src/game/raid.ts): host damage, the swarm, the falling catwalks and rewards.
 */
import * as THREE from 'three';
import { AI, BOSSES, type Boss } from '../../data';
import { WardenBrain, type HostView, type WardenEvent, type WardenRoom } from '../ai';
import { Warden, type WardenHit } from '../creatures/warden';
import { SOLIDS } from '../world/zone7';
import type { WardenArena } from '../world/wreck';
import { segmentSphere } from './projectiles';
import type { HostStrike } from './boss';

export interface WardenFrame {
  strikes: HostStrike[];
  events: WardenEvent[];
  /** Embryos born this frame: spawn `count` of `type` at (x, z). */
  brood: { type: string; x: number; z: number; count: number }[];
  /** Catwalk ids that came down this frame. */
  fallen: string[];
}

/** How far past the first body surface a shot can still reach an exposed weak point. */
const WEAK_DEPTH = 1.2;
/** Hit radius of a coolant valve wheel (shoot it to vent). */
const VALVE_RADIUS = 0.7;
/** Chest height of a host above its feet: the pulse and the spear test against it. */
const CHEST = 1.2;

export class RaidWarden {
  readonly t: Boss;
  readonly brain: WardenBrain;
  readonly body: Warden;
  readonly id = 'warden';
  readonly room: WardenRoom;
  biomass: number;
  readonly pods: number[];
  /** Seconds each valve's plume keeps venting. */
  private readonly venting: number[];
  private readonly q = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();
  private puff = 0;

  constructor(readonly arena: WardenArena, scene?: THREE.Object3D, seed = 13) {
    this.t = BOSSES[this.id];
    const s = arena.bossSpawn;
    this.room = { x0: arena.x0, x1: arena.x1, z0: arena.z0, z1: arena.z1, floorY: arena.floorY, height: arena.ceiling - arena.floorY };
    this.brain = new WardenBrain(s.x, s.y, s.z, seed);
    this.body = new Warden(seed, scene);
    const wp = this.t.weakPoints as { seedPods: { count: number; biomassEach: number } };
    this.biomass = this.t.biomass;
    this.pods = Array.from({ length: wp.seedPods.count }, () => wp.seedPods.biomassEach);
    this.venting = arena.valves.map(() => 0);
    // Settle the head onto its wall before the first frame so the body lies along it.
    this.brain.step(0, { host: { x: 1e5, y: 0, z: 1e5, vx: 0, vz: 0, alive: false, hidden: true, visibility: 0, forward: null }, fraction: 1, room: this.room });
    this.sync(1);
    this.body.plant();
  }

  get alive(): boolean { return this.brain.state !== 'dead'; }
  get awake(): boolean { return this.brain.state === 'awake'; }
  get fraction(): number { return this.biomass / this.t.biomass; }
  get position(): THREE.Vector3 { return this.body.root.position; }

  /** Middle of the body (the head end) in world space. */
  centre(out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.body.hitSpheres.find((x) => x.tag === 'head');
    return h ? out.copy(h.world) : out.copy(this.position);
  }

  /** True when this sphere takes weak-point damage right now. */
  exposed(s: WardenHit): boolean {
    if (s.tag === 'seedPod') return (this.pods[s.index] ?? 0) > 0;
    if (s.tag === 'reactorSeam') return this.brain.seamExposed(s.index);
    return false;
  }

  /** What a segment hits on the body. An exposed weak point wins near the body surface. */
  hit(a: THREE.Vector3, b: THREE.Vector3): { t: number; sphere: WardenHit } | null {
    if (!this.alive) return null;
    const len = a.distanceTo(b) || 1;
    let near: { t: number; sphere: WardenHit } | null = null, weak: { t: number; sphere: WardenHit } | null = null;
    for (const s of this.body.hitSpheres) {
      if (s.r <= 0) continue;
      const t = segmentSphere(a, b, s.world, s.r);
      if (t === null) continue;
      if (this.exposed(s)) { if (!weak || t < weak.t) weak = { t, sphere: s }; }
      else if (!near || t < near.t) near = { t, sphere: s };
    }
    if (weak && (!near || (weak.t - near.t) * len <= WEAK_DEPTH)) return weak;
    return near;
  }

  /** Which coolant valve a segment hits (shooting the wheel vents it), or null. */
  valveHit(a: THREE.Vector3, b: THREE.Vector3): { t: number; index: number } | null {
    let best: { t: number; index: number } | null = null;
    this.arena.valves.forEach((v, index) => {
      const t = segmentSphere(a, b, new THREE.Vector3(v.x, v.y, v.z), VALVE_RADIUS);
      if (t !== null && (!best || t < best.t)) best = { t, index };
    });
    return best;
  }

  /** Vents valve i: its plume shows, and while the Warden lives the reactor seam beside it cracks open. */
  vent(i: number): void {
    if (i < 0 || i >= this.venting.length) return;
    this.venting[i] = AI.warden.seamOpenTime;
    this.arena.vent(i, true);
    if (!this.alive) return;
    this.brain.vent(i);
    this.body.steam(i);
  }

  /** Applies a hit (`sphere` null: splash or a blast on the plates). */
  damage(amount: number, sphere: WardenHit | null): { dealt: number; killed: boolean; weak: boolean; popped: string | null } {
    if (!this.alive || amount <= 0) return { dealt: 0, killed: false, weak: false, popped: null };
    const wp = this.t.weakPoints as { seedPods: { multiplier: number }; reactorSeams: { multiplier: number } };
    let dealt = amount * this.brain.bodyMultiplier(), weak = false, popped: string | null = null;
    if (sphere && this.exposed(sphere)) {
      weak = true;
      if (sphere.tag === 'seedPod') {
        dealt = amount * wp.seedPods.multiplier;
        this.pods[sphere.index] = Math.max(0, this.pods[sphere.index] - dealt);
        if (this.pods[sphere.index] === 0) { this.body.popWeakPoint(sphere.index); popped = `seedPod${sphere.index}`; }
      } else dealt = amount * wp.reactorSeams.multiplier;
    }
    this.biomass = Math.max(0, this.biomass - dealt);
    this.brain.hurt();
    this.body.hurt(1 - this.fraction);
    if (this.biomass > 0) return { dealt, killed: false, weak, popped };
    this.brain.kill();
    this.body.destroy();
    return { dealt, killed: true, weak, popped };
  }

  /** Fraction 0..1 of the reactor pulse that reaches a point: 0 behind a shield pillar (or anything solid). */
  pulseReach(x: number, y: number, z: number): number {
    const c = this.arena.core, dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz) || 1;
    // From the core's skin at chest height, so the column itself does not count as cover.
    const from = { x: c.x + (dx / d) * (c.radius + 0.4), y: y, z: c.z + (dz / d) * (c.radius + 0.4) };
    return SOLIDS.blocked(from, { x, y, z }) === null ? 1 : 0;
  }

  /** Advances the fight. */
  update(dt: number, host: HostView, powered = false): WardenFrame {
    const out: WardenFrame = { strikes: [], events: [], brood: [], fallen: [] };
    for (let i = 0; i < this.venting.length; i++) {
      if (this.venting[i] <= 0) continue;
      this.venting[i] -= dt;
      if (this.venting[i] <= 0) this.arena.vent(i, false);
    }
    if (this.alive) {
      const b = this.brain, A = this.arena;
      b.step(dt, { host, fraction: this.fraction, room: this.room, powered });
      this.sync(dt);
      const head = this.position.clone();
      const chest = { x: host.x, y: host.y + CHEST, z: host.z };
      for (const e of b.events) {
        out.events.push(e);
        switch (e.type) {
          case 'spear':
            if (host.alive && Math.hypot(host.x - e.at.x, host.z - e.at.z) <= e.radius && Math.abs(host.y - e.at.y) < 2.5) out.strikes.push({ damage: e.damage, source: 'root spear', from: head.clone(), knock: 7 });
            break;
          case 'steam': {
            this.body.steam(this.puff++ % this.brain.seamOpen.length);
            if (host.alive && Math.hypot(host.x - e.at.x, host.z - e.at.z) <= e.radius && Math.abs(host.y - e.at.y) < 4) out.strikes.push({ damage: e.damage, source: 'steam', from: new THREE.Vector3(e.at.x, e.at.y, e.at.z), knock: 4 });
            break;
          }
          case 'swarm': {
            this.body.birth();
            const p = this.body.birthPoint.getWorldPosition(new THREE.Vector3());
            const m = 1.5;
            out.brood.push({ type: e.spawnType, count: e.count, x: Math.min(A.x1 - m, Math.max(A.x0 + m, p.x)), z: Math.min(A.z1 - m, Math.max(A.z0 + m, p.z)) });
            break;
          }
          case 'catwalk': {
            let best: WardenArena['catwalks'][number] | null = null, bd = Infinity;
            for (const c of A.catwalks) {
              if (c.collapsed) continue;
              const d = Math.hypot(Math.max(c.x0 - e.near.x, 0, e.near.x - c.x1), Math.max(c.z0 - e.near.z, 0, e.near.z - c.z1));
              if (d < bd) { bd = d; best = c; }
            }
            if (best) { best.collapse(); out.fallen.push(best.id); }
            break;
          }
          case 'pulse':
            this.body.pulse();
            if (host.alive && Math.hypot(host.x - A.core.x, host.z - A.core.z) <= e.radius && this.pulseReach(chest.x, chest.y, chest.z) > 0) out.strikes.push({ damage: e.damage, source: 'reactor pulse', from: new THREE.Vector3(A.core.x, chest.y, A.core.z), knock: 9 });
            break;
          default: break;
        }
      }
      b.events.length = 0;
    }
    this.body.update(dt);
    return out;
  }

  /** Copies the brain onto Creature's body: head on its surface, facing where it is going, back to the surface. */
  private sync(dt: number): void {
    const b = this.brain, r = this.body.root, d = this.body.drive;
    r.position.set(b.head.x, b.head.y, b.head.z);
    const up = new THREE.Vector3(b.up.x, b.up.y, b.up.z);
    let fwd = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw)).projectOnPlane(up);
    // Facing into the wall it clings to: climb instead.
    if (fwd.lengthSq() < 0.04) fwd = new THREE.Vector3(0, 1, 0).projectOnPlane(up);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    const side = new THREE.Vector3().crossVectors(up, fwd).normalize();
    this.m.makeBasis(side, up, fwd);
    this.q.setFromRotationMatrix(this.m);
    r.quaternion.slerp(this.q, dt >= 1 ? 1 : 1 - Math.exp(-6 * dt));
    r.updateMatrixWorld(true);
    d.up = null;
    d.windup = b.windup;
    d.rear = b.rear;
    d.phase = b.phase.id as typeof d.phase;
    d.surface = b.surface;
    d.strike = b.strike ? (d.strike ?? new THREE.Vector3()).set(b.strike.x, b.strike.y, b.strike.z) : null;
    d.look = b.look ? (d.look ?? new THREE.Vector3()).set(b.look.x, b.look.y, b.look.z) : null;
    for (let i = 0; i < d.seamsOpen.length; i++) d.seamsOpen[i] = b.seamExposed(i) ? 1 : 0;
  }
}
