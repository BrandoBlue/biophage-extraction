/**
 * The Pale Vigil in a raid (PvE AI). Joins the renderer-free brain (src/ai/vigil.ts), Creature's body
 * (src/creatures/palevigil.ts) and World's cave lair (src/world/cave.ts CaveLair): Biomass and weak points (lure,
 * spines, limbs), hit tests, hanging from the roof and dropping to the floor, and the brain's events turned into what
 * they do to the host. Every number comes from data/bosses.json `paleVigil`. The raid applies the results
 * (src/game/raid.ts): host damage, Overload, the pin, the falling ceiling, the sealed cave mouths and rewards.
 */
import * as THREE from 'three';
import { BOSSES, type Boss } from '../../data';
import { PaleVigilBrain, type HostView, type VigilEvent } from '../ai';
import { PaleVigil, type VigilHit } from '../creatures/palevigil';
import type { CaveLair } from '../world/cave';
import { segmentSphere } from './projectiles';
import type { HostStrike } from './boss';

export interface VigilFrame {
  strikes: HostStrike[];
  /** Neural Overload to add to the host this frame (the lure's pull, the shriek). */
  overload: number;
  events: VigilEvent[];
}

/** How far past the first body surface a shot can still reach an exposed weak point. */
const WEAK_DEPTH = 1.2;
/** Highest the body hangs above the floor: the lure (about 7.5 m below the root) then sways near head height. */
const HANG_MAX = 9.5;

export class RaidVigil {
  readonly t: Boss;
  readonly brain: PaleVigilBrain;
  readonly body: PaleVigil;
  readonly id = 'paleVigil';
  biomass: number;
  lure: number;
  readonly spines: number[];
  readonly limbs: number[];
  /** Seconds the host stays held by a snatch, the damage per second while held, and the damage that frees it. */
  pinned = 0;
  private pinDps = 0;
  private pinBreak = 0;
  private readonly spot = new THREE.Vector3();

  constructor(readonly lair: CaveLair, scene?: THREE.Object3D, seed = 11) {
    this.t = BOSSES[this.id];
    const s = lair.bossSpawn;
    this.brain = new PaleVigilBrain(s.x, s.z, seed);
    this.body = new PaleVigil(seed, scene);
    const wp = this.t.weakPoints as { lure: { biomass: number }; spines: { count: number; biomassEach: number }; limbs: { count: number; biomassEach: number } };
    this.biomass = this.t.biomass;
    this.lure = wp.lure.biomass;
    this.spines = Array.from({ length: wp.spines.count }, () => wp.spines.biomassEach);
    this.limbs = Array.from({ length: wp.limbs.count }, () => wp.limbs.biomassEach);
    this.sync();
    this.body.plant();
  }

  get alive(): boolean { return this.brain.state !== 'dead'; }
  get awake(): boolean { return this.brain.state === 'awake'; }
  get fraction(): number { return this.biomass / this.t.biomass; }
  get position(): THREE.Vector3 { return this.body.root.position; }
  get limbsIntact(): number { return this.limbs.filter((l) => l > 0).length; }

  /** Body centre in world space. */
  centre(out = this.spot): THREE.Vector3 {
    const b = this.body.hitSpheres.find((h) => h.tag === 'body')!;
    return out.copy(b.world);
  }

  /** What a segment hits. Nothing while it hides in the roof; an exposed weak point wins near the body surface. */
  hit(a: THREE.Vector3, b: THREE.Vector3): { t: number; sphere: VigilHit } | null {
    if (!this.alive || this.brain.hidden) return null;
    const len = a.distanceTo(b) || 1;
    let near: { t: number; sphere: VigilHit } | null = null, weak: { t: number; sphere: VigilHit } | null = null;
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

  /** True when this sphere takes weak-point damage right now. */
  exposed(s: VigilHit): boolean {
    if (s.tag === 'lure') return this.lure > 0;
    if (s.tag === 'spine') return this.brain.spinesExposed && (this.spines[s.index] ?? 0) > 0;
    if (s.tag === 'limb') return this.brain.limbsSeverable && (this.limbs[s.index] ?? 0) > 0;
    return false;
  }

  /** Applies a hit (`sphere` null: splash or a blast on the body). */
  damage(amount: number, sphere: VigilHit | null): { dealt: number; killed: boolean; weak: boolean; popped: string | null } {
    if (!this.alive || amount <= 0) return { dealt: 0, killed: false, weak: false, popped: null };
    const wp = this.t.weakPoints as { lure: { multiplier: number }; spines: { multiplier: number } };
    let dealt = amount * this.brain.bodyMultiplier(), weak = false, popped: string | null = null;
    if (sphere && this.exposed(sphere)) {
      weak = true;
      if (sphere.tag === 'lure') {
        dealt = amount * wp.lure.multiplier;
        this.lure = Math.max(0, this.lure - dealt);
        if (this.lure === 0) { this.body.popWeakPoint(0); popped = 'lure'; }
      } else if (sphere.tag === 'spine') {
        dealt = amount * wp.spines.multiplier;
        this.spines[sphere.index] = Math.max(0, this.spines[sphere.index] - dealt);
        if (this.spines[sphere.index] === 0) { this.body.popWeakPoint(1 + sphere.index); popped = `spine${sphere.index}`; }
      } else if (sphere.tag === 'limb') {
        dealt = amount;
        this.limbs[sphere.index] = Math.max(0, this.limbs[sphere.index] - dealt);
        if (this.limbs[sphere.index] === 0) { this.body.severLimb(sphere.index); popped = `limb${sphere.index}`; }
      }
    }
    this.biomass = Math.max(0, this.biomass - dealt);
    this.brain.hurt();
    this.body.hurt(1 - this.fraction);
    if (this.pinned > 0) { this.pinBreak -= dealt; if (this.pinBreak <= 0) this.pinned = 0; }
    if (this.biomass > 0) return { dealt, killed: false, weak, popped };
    this.brain.kill();
    this.body.destroy();
    this.pinned = 0;
    return { dealt, killed: true, weak, popped };
  }

  /** Advances the fight. `forward` is where the host is looking (the lure pulls only when looked at). */
  update(dt: number, host: HostView): VigilFrame {
    const out: VigilFrame = { strikes: [], overload: 0, events: [] };
    if (this.alive) {
      const b = this.brain, L = this.lair;
      const input = { host, fraction: this.fraction, lureAlive: this.lure > 0, limbsIntact: this.limbsIntact, arena: { x: L.x, z: L.z, radius: L.radius } };
      b.step(dt, input);
      this.sync();
      const feet = new THREE.Vector3(b.body.x, L.floorY, b.body.z);
      const toHost = Math.hypot(host.x - b.body.x, host.z - b.body.z);
      // The lure's pull: looking at it within range fills Overload.
      const pull = b.lurePull(input);
      if (pull > 0 && host.alive && host.forward) {
        const lx = b.body.x - host.x, lz = b.body.z - host.z, d = Math.hypot(lx, lz) || 1;
        if ((host.forward.x * lx + host.forward.z * lz) / d > 0.6) out.overload += pull * dt;
      }
      // Held by a snatch: it feeds while it holds you.
      if (this.pinned > 0) {
        this.pinned = Math.max(0, this.pinned - dt);
        if (host.alive) out.strikes.push({ damage: this.pinDps * dt, source: 'grip', from: null, pin: this.pinned });
      }
      for (const e of b.events) {
        out.events.push(e);
        if (!host.alive) continue;
        switch (e.type) {
          case 'drop':
            if (Math.hypot(host.x - e.at.x, host.z - e.at.z) <= e.radius) out.strikes.push({ damage: e.damage, source: 'drop', from: feet.clone(), knock: 6 });
            break;
          case 'grab':
            this.pinned = e.pin;
            this.pinDps = e.pinDamagePerSecond;
            this.pinBreak = e.freedByDamage;
            out.strikes.push({ damage: e.damage, source: 'snatch', from: feet.clone(), pin: e.pin });
            break;
          case 'lunge':
            out.strikes.push({ damage: e.damage, source: e.how === 'ambush' ? 'lunge from behind' : 'frenzy', from: feet.clone(), knock: 8 });
            break;
          case 'rake':
            out.strikes.push({ damage: e.damage, source: 'rake', from: feet.clone(), knock: 5 });
            break;
          case 'shriek':
            this.body.shriek();
            if (toHost <= e.radius) {
              out.strikes.push({ damage: e.damage, source: 'shriek', from: feet.clone(), knock: 3 });
              out.overload += e.overload;
            }
            break;
          case 'chunk':
            if (Math.hypot(host.x - e.at.x, host.z - e.at.z) <= e.radius && host.y - L.floorY < 2) out.strikes.push({ damage: e.damage, source: 'falling ceiling', from: new THREE.Vector3(e.at.x, L.floorY, e.at.z), knock: 4 });
            break;
          default: break;
        }
      }
      b.events.length = 0;
    } else this.pinned = 0;
    this.body.update(dt);
    return out;
  }

  /** Copies the brain onto Creature's body: on the roof upside down while it hangs, on the floor when it is down. */
  private sync(): void {
    const b = this.brain, L = this.lair, r = this.body.root, d = this.body.drive;
    const roof = Math.min(L.ceilingAt(b.body.x, b.body.z), L.floorY + HANG_MAX);
    const up = b.hang > 0.5;
    r.position.set(b.body.x, THREE.MathUtils.lerp(L.floorY, roof, b.hang), b.body.z);
    // Upside down on the roof (local +Y points away from the surface it clings to).
    r.rotation.set(0, b.body.yaw, up ? Math.PI : 0);
    r.updateMatrixWorld(true);
    d.windup = b.windup;
    d.rear = b.rear;
    d.phase = b.phase.id as typeof d.phase;
    d.hanging = b.hang;
    d.lureGlow = b.lureGlow;
    d.dim = b.dim;
    d.strike = b.strike ? (d.strike ?? new THREE.Vector3()).set(b.strike.x, b.strike.y, b.strike.z) : null;
    d.look = b.look ? (d.look ?? new THREE.Vector3()).set(b.look.x, b.look.y, b.look.z) : null;
  }
}
