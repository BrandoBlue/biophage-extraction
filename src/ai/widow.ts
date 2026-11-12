/**
 * The Sandwidow (data/bosses.json `sandwidow`), the Ochre Reach boss in the Skyfall Crater. Renderer-free: it moves
 * a head point round the crater floor and says what it does through `events`; src/game/widow.ts turns that into
 * damage, Dunewake broods and quicksand, and drives Creature's body.
 *
 * - Dormant until a host steps onto the crater floor (or shoots her).
 * - circle: she swims under the sand round the host, out of reach. The undertow sinks a funnel under where the host
 *   stands, then she bites up through it. Every `surface.every` s she breaches to breathe for `surface.duration` s:
 *   crown open, throat sacs exposed. She calls Dunewake from her throat.
 * - erupt: she bursts out under the host and stays up longer between dives; up, she sand-blasts a cone that blinds.
 *   Jaw petals can be severed from here (each takes 15% off her bite).
 * - drown: the crater floor turns to quicksand (a share of it; all of it once enraged) and she thrashes on the surface.
 * Numbers come from bosses.json `sandwidow`; movement and tells it does not give come from ai.json `widow`.
 */
import { AI, BOSSES, bossPhase, type Boss, type BossPhase } from '../../data';
import type { HostView, Vec2 } from './types';

interface Atk { windup?: number; cooldown?: number; damage?: number; radius?: number; [k: string]: unknown }

export type WidowEvent =
  | { type: 'wake' }
  | { type: 'phase'; id: string }
  /** The sand starts sinking into a funnel at `at` (the undertow's tell). */
  | { type: 'funnel'; at: Vec2; radius: number; warning: number }
  /** She bites up through the funnel. */
  | { type: 'undertow'; at: Vec2; radius: number; damage: number }
  /** She bursts out of the sand at `at`. */
  | { type: 'breach'; at: Vec2; radius: number; damage: number }
  /** A cone of sand from the throat: hits within `range` and `cone` degrees of `yaw`, and blinds. */
  | { type: 'blast'; from: Vec2; yaw: number; cone: number; range: number; damage: number; blind: number }
  | { type: 'thrash'; at: Vec2; radius: number; damage: number }
  /** Call Dunewake out of her throat. */
  | { type: 'brood'; spawnType: string; count: number }
  /** The crater floor turns to quicksand: `fraction` of its radius from the centre out. */
  | { type: 'quicksand'; fraction: number; slow: number; damagePerSecond: number }
  | { type: 'surface' }
  | { type: 'dive' }
  | { type: 'enrage' };

/** The crater as the brain sees it: its centre, the radius of the floor she swims in, and the floor height. */
export interface WidowCrater { x: number; z: number; radius: number; floorY: number }

export interface WidowInput {
  host: HostView;
  /** Remaining Biomass / max. */
  fraction: number;
  crater: WidowCrater;
}

const W = () => AI.widow;

export class WidowBrain {
  readonly t: Boss;
  state: 'dormant' | 'awake' | 'dead' = 'dormant';
  phase: BossPhase;
  /** What it is doing: 'swim', 'up' (breathing), or an attack id. */
  action = 'swim';
  actionTime = 0;
  /** The head's point on the crater floor. */
  readonly head: Vec2 = { x: 0, z: 0 };
  yaw = 0;
  // Drive outputs.
  surface = 0;
  open = 0;
  windup = 0;
  thrash = 0;
  look: Vec2 | null = null;
  strike: Vec2 | null = null;
  enraged = false;
  /** Quicksand: the share of the crater radius that sucks (0 until drown). */
  quicksand = 0;
  /** Jaw petals severed (each takes `petalBite` off her bite). */
  petalsLost = 0;
  readonly events: WidowEvent[] = [];
  private awakeFor = 0;
  private cd = new Map<string, number>();
  private aim: Vec2 = { x: 0, z: 0 };
  private upFor = 0;
  private surfaceTarget = 0;
  private orbit = 1;
  private seed: number;

  constructor(x: number, z: number, seed = 17, readonly id = 'sandwidow') {
    this.t = BOSSES[id];
    if (!this.t) throw new Error(`no boss ${id}`);
    this.phase = this.t.phases[0];
    this.seed = seed >>> 0 || 1;
    this.head.x = x; this.head.z = z;
    this.orbit = this.rand() < 0.5 ? 1 : -1;
  }

  get awake(): boolean { return this.state === 'awake'; }
  /** Throat sacs take weak-point damage: she is up and her crown is open. */
  get sacsExposed(): boolean { return this.surface > 0.5 && this.open > 0.4; }
  /** Jaw petals can be shot off from erupt on, while she is up. */
  get petalsSeverable(): boolean { return this.phase.id !== 'circle' && this.surface > 0.5; }
  /** Under the sand nothing reaches her. */
  get submerged(): boolean { return this.surface < W().hittableAbove; }
  bodyMultiplier(): number { return Number(this.phase.bodyDamageMultiplier ?? 1); }
  /** Her bite after severed petals. */
  biteScale(): number { return Math.max(0, 1 - this.petalsLost * W().petalBite); }

  wake(): void {
    if (this.state !== 'dormant') return;
    this.state = 'awake';
    this.events.push({ type: 'wake' });
    this.resetCooldowns();
  }
  hurt(): void { this.wake(); }
  kill(): void { this.state = 'dead'; this.windup = 0; this.strike = null; this.thrash = 0; this.open = 0; this.quicksand = 0; }
  severPetal(): void { this.petalsLost++; }
  /** Brings her up to breathe for `seconds` now (debug and tests). */
  breathe(seconds: number): void { if (this.state !== 'awake') return; this.cancel(); this.goUp(seconds); this.surface = 1; this.open = 1; }

  step(dt: number, i: WidowInput): void {
    if (this.state === 'dead') return;
    const h = i.host, C = i.crater;
    if (this.state === 'dormant') {
      const onFloor = h.alive && !h.hidden && Math.hypot(h.x - C.x, h.z - C.z) <= C.radius && h.y - C.floorY < W().floorHeight;
      const near = h.alive && !h.hidden && Math.hypot(h.x - this.head.x, h.z - this.head.z) <= Math.min(this.t.wakeRadius, C.radius);
      if (onFloor && near) this.wake();
      else { this.ease(dt); return; }
    }
    this.awakeFor += dt;
    this.actionTime += dt;
    for (const [k, v] of this.cd) this.cd.set(k, v - dt);

    const next = bossPhase(this.id, i.fraction);
    if (next.id !== this.phase.id) {
      this.phase = next;
      this.events.push({ type: 'phase', id: next.id });
      this.cancel();
      this.resetCooldowns();
      const qs = this.attacks().quicksand;
      if (qs) this.sink(Number(qs.floorFraction));
    }
    if (!this.enraged && this.awakeFor >= this.t.enrage.after) {
      this.enraged = true;
      this.events.push({ type: 'enrage' });
      this.sink(1);
    }

    if (!h.alive || h.hidden) { this.cancel(); this.look = null; this.swimTo(C.x + Math.cos(this.awakeFor * 0.2) * C.radius * 0.5, C.z + Math.sin(this.awakeFor * 0.2) * C.radius * 0.5, dt, i); this.ease(dt); return; }
    this.look = { x: h.x, z: h.z };
    if (this.action !== 'swim' && this.action !== 'up') this.runAttack(dt, i);
    else this.move(dt, i);
    this.ease(dt);
  }

  // ------------------------------------------------------------------ movement

  private move(dt: number, i: WidowInput): void {
    const h = i.host, w = W(), id = this.phase.id;
    this.windup = Math.max(0, this.windup - dt * 3);
    this.strike = null;
    if (this.action === 'up') {
      // Breathing on the surface: crown open, turning to keep the host in front.
      this.upFor -= dt;
      this.surfaceTarget = 1;
      this.open = Math.min(1, this.open + dt * 2);
      this.turnTo(Math.atan2(h.x - this.head.x, h.z - this.head.z), dt);
      if (id === 'drown') this.thrash = Math.min(1, this.thrash + dt);
      this.choose(i);
      if (this.action === 'up' && this.upFor <= 0) { this.action = 'swim'; this.actionTime = 0; this.events.push({ type: 'dive' }); }
      return;
    }
    // Swimming: circles the host under the sand, or holds `holdDistance` from it.
    this.surfaceTarget = id === 'drown' ? w.drownRide : 0;
    this.open = Math.max(0, this.open - dt * 2);
    this.thrash = id === 'drown' ? Math.min(1, this.thrash + dt) : Math.max(0, this.thrash - dt);
    const hold = Number(this.phase.holdDistance ?? 0);
    // Drowning she comes straight in to thrash; before that she keeps her distance under the sand.
    const r = id === 'drown' ? w.drownClose : Math.max(hold, w.circleRadius);
    const a = Math.atan2(this.head.z - h.z, this.head.x - h.x) + this.orbit * w.circleLead;
    this.swimTo(h.x + Math.cos(a) * r, h.z + Math.sin(a) * r, dt, i);
    // Breathing.
    const s = this.attacks().surface as { every?: number; duration?: number } | undefined;
    if (s && this.ready('surface')) { this.cd.set('surface', Number(s.every)); this.goUp(Number(s.duration)); return; }
    this.choose(i);
  }

  private swimTo(x: number, z: number, dt: number, i: WidowInput): void {
    const C = i.crater, w = W();
    // Kept inside the crater floor.
    const cx = x - C.x, cz = z - C.z, cd = Math.hypot(cx, cz), lim = C.radius * w.keepInside;
    if (cd > lim) { x = C.x + (cx / cd) * lim; z = C.z + (cz / cd) * lim; }
    this.turnTo(Math.atan2(x - this.head.x, z - this.head.z), dt);
    const d = Math.hypot(x - this.head.x, z - this.head.z);
    const v = Math.min(Number(this.phase.speed ?? 8), d * 2);
    this.head.x += Math.sin(this.yaw) * v * dt;
    this.head.z += Math.cos(this.yaw) * v * dt;
    const hx = this.head.x - C.x, hz = this.head.z - C.z, hd = Math.hypot(hx, hz);
    if (hd > C.radius * w.keepInside) { this.head.x = C.x + (hx / hd) * C.radius * w.keepInside; this.head.z = C.z + (hz / hd) * C.radius * w.keepInside; }
  }

  private turnTo(want: number, dt: number): void {
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const r = Number(this.phase.turnRate ?? 1.2) * dt;
    this.yaw += Math.max(-r, Math.min(r, d));
  }

  private ease(dt: number): void {
    const k = this.surfaceTarget > this.surface ? W().riseRate : W().sinkRate;
    this.surface += Math.max(-k * dt, Math.min(k * dt, this.surfaceTarget - this.surface));
  }

  private goUp(seconds: number): void {
    this.action = 'up'; this.actionTime = 0; this.upFor = seconds; this.surfaceTarget = 1;
    this.events.push({ type: 'surface' });
  }

  private sink(fraction: number): void {
    const qs = (this.t.phases.find((p) => p.id === 'drown')?.attacks as Record<string, Atk> | undefined)?.quicksand ?? {};
    this.quicksand = Math.max(this.quicksand, fraction);
    this.events.push({ type: 'quicksand', fraction: this.quicksand, slow: Number(qs.slowMultiplier ?? 0.4), damagePerSecond: Number(qs.damagePerSecond ?? 6) });
  }

  // ------------------------------------------------------------------ attacks

  private attacks(): Record<string, Atk> { return this.phase.attacks as Record<string, Atk>; }
  private ready(id: string): boolean { return (this.cd.get(id) ?? 0) <= 0 && !!this.attacks()[id]; }

  private resetCooldowns(): void {
    this.cd.clear();
    for (const [k, a] of Object.entries(this.attacks())) {
      if (k === 'surface') this.cd.set(k, Number(a.every ?? 18));
      else if (a.firstDelay !== undefined) this.cd.set(k, Number(a.firstDelay));
      else this.cd.set(k, W().firstAttack);
    }
  }

  private start(id: string, i: WidowInput): void {
    this.action = id; this.actionTime = 0;
    this.aim = { x: i.host.x, z: i.host.z };
    if (id === 'undertow') this.events.push({ type: 'funnel', at: { ...this.aim }, radius: Number(this.attacks().undertow.radius), warning: Number(this.attacks().undertow.windup) });
  }

  private choose(i: WidowInput): void {
    const h = i.host, d = Math.hypot(h.x - this.head.x, h.z - this.head.z), up = this.action === 'up';
    if (this.ready('broodCall')) return this.start('broodCall', i);
    if (this.ready('thrash') && d <= Number(this.attacks().thrash.radius) + W().thrashReach) return this.start('thrash', i);
    const bl = this.attacks().sandBlast;
    if (bl && up && this.ready('sandBlast') && d <= Number(bl.range)) return this.start('sandBlast', i);
    if (!up && this.ready('breach')) return this.start('breach', i);
    if (!up && this.ready('undertow')) return this.start('undertow', i);
  }

  private runAttack(dt: number, i: WidowInput): void {
    const id = this.action, a = this.attacks()[id] ?? {}, h = i.host, w = W();
    const windup = Number(a.windup ?? 0.8);
    const winding = this.actionTime < windup;
    this.windup = winding ? this.actionTime / windup : Math.max(0, 1 - (this.actionTime - windup) * 3);
    const done = (upAfter = 0) => {
      this.cd.set(id, Number(a.cooldown ?? 6));
      this.strike = null;
      if (upAfter > 0) this.goUp(upAfter); else { this.action = 'swim'; this.actionTime = 0; }
    };
    switch (id) {
      case 'undertow':
        // The funnel sinks where the host stood; she rises under it and bites up through it.
        this.swimTo(this.aim.x, this.aim.z, dt, i);
        this.surfaceTarget = 0;
        if (!winding) {
          this.events.push({ type: 'undertow', at: { ...this.aim }, radius: Number(a.radius), damage: Number(a.damage) * this.biteScale() });
          this.head.x = this.aim.x; this.head.z = this.aim.z;
          this.strike = { ...this.aim };
          this.surface = Math.max(this.surface, w.biteRise);
          this.open = 1;
          done();
        }
        return;
      case 'breach':
        // Rushes under the host (a ripple line), then bursts out where it stood and stays up.
        this.aim = { x: this.aim.x + (h.x - this.aim.x) * Math.min(1, dt * w.breachTrack), z: this.aim.z + (h.z - this.aim.z) * Math.min(1, dt * w.breachTrack) };
        this.swimTo(this.aim.x, this.aim.z, dt, i);
        this.surfaceTarget = 0;
        if (!winding) {
          this.head.x = this.aim.x; this.head.z = this.aim.z;
          this.events.push({ type: 'breach', at: { ...this.aim }, radius: Number(a.radius), damage: Number(a.damage) * this.biteScale() });
          this.surface = 1;
          this.strike = { ...this.aim };
          done(w.eruptUp);
        }
        return;
      case 'sandBlast':
        this.surfaceTarget = 1;
        this.open = 1;
        this.turnTo(Math.atan2(h.x - this.head.x, h.z - this.head.z), dt);
        if (!winding) {
          this.events.push({ type: 'blast', from: { ...this.head }, yaw: this.yaw, cone: Number(a.coneDegrees), range: Number(a.range), damage: Number(a.damage), blind: Number(a.blindDuration) });
          done(Math.max(this.upFor, 1));
        }
        return;
      case 'thrash':
        this.surfaceTarget = Math.max(this.surfaceTarget, w.drownRide);
        this.thrash = 1;
        if (!winding) {
          this.events.push({ type: 'thrash', at: { ...this.head }, radius: Number(a.radius), damage: Number(a.damage) });
          done();
        }
        return;
      case 'broodCall': {
        // Rises enough to open the throat, and the brood pours out.
        this.surfaceTarget = Math.max(this.surfaceTarget, w.callRise);
        this.open = Math.min(1, this.open + dt * 2);
        if (!winding) {
          const s = a.spawn as { type: string; count: number };
          this.events.push({ type: 'brood', spawnType: s.type, count: s.count });
          done();
        }
        return;
      }
      default: done();
    }
  }

  private cancel(): void {
    this.action = 'swim'; this.actionTime = 0; this.windup = 0; this.strike = null; this.upFor = 0;
  }

  private rand(): number {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
