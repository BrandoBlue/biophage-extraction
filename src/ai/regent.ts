/**
 * The Mire Regent (data/bosses.json `mireRegent`), the thing under the black pool of the Weeping Fen. Renderer-free:
 * it moves its body round the pool and says what it does through `events`; src/game/regent.ts turns them into
 * damage, pins, pulls, moss clouds and Mirebrood, and drives Creature's body.
 *
 * It shows how it thinks:
 * - It watches from below. Dormant until a host wades into the pool (or shoots it); then only its eyes break the
 *   surface and they follow the host everywhere.
 * - lurk: it stalks a wading host from behind, under the water. A host up on a root or island is out of its reach:
 *   it waits beside that island, watching, and calls its brood to flush them off. Every attack has a tell: an arm
 *   breaks the surface and reaches before it grabs (step away), the water bulges before the ripple.
 * - rise: it rears out of the pool on a rhythm, pearls out. It keeps its distance, rears high before a belly slam,
 *   gapes before the tongue (which it saves for hosts on high ground: it pulls them off), swells before the moss.
 * - drown: the pool spills and the islands shrink; it comes in close and thrashes.
 * - Shoot an eye and it flinches under and comes up on the far side of the pool.
 * Numbers come from bosses.json `mireRegent`; tells and movement it does not give come from ai.json `regent`.
 */
import { AI, BOSSES, bossPhase, type Boss, type BossPhase } from '../../data';
import type { HostView, Vec2 } from './types';

interface Atk { windup?: number; cooldown?: number; damage?: number; radius?: number; range?: number; [k: string]: unknown }

export type RegentEvent =
  | { type: 'wake' }
  | { type: 'phase'; id: string }
  | { type: 'enrage' }
  /** Arm `arm` breaks the surface and reaches for `at`: it grabs in `warning` s. */
  | { type: 'reach'; arm: number; at: Vec2; warning: number }
  /** The arm closes on `at`: a host still within `radius` is dragged under and pinned. */
  | { type: 'grab'; arm: number; at: Vec2; radius: number; damage: number; pin: number; damagePerSecond: number; freedByDamage: number }
  /** The water bulges round it: the ripple lands in `warning` s. */
  | { type: 'bulge'; at: Vec2; radius: number; warning: number }
  | { type: 'ripple'; at: Vec2; radius: number; damage: number }
  /** The throat swells: Mirebrood in `warning` s. */
  | { type: 'croak'; warning: number }
  | { type: 'brood'; spawnType: string; count: number }
  /** It rears out of the pool (pearls out) / settles back under. */
  | { type: 'rear' }
  | { type: 'settle' }
  /** It rears high to crash down on `at` in `warning` s. */
  | { type: 'heave'; at: Vec2; radius: number; warning: number }
  | { type: 'slam'; at: Vec2; radius: number; damage: number }
  /** The mouth gapes at the host: the tongue in `warning` s along `yaw`. */
  | { type: 'gape'; yaw: number; warning: number }
  | { type: 'tongue'; from: Vec2; yaw: number; range: number; cone: number; damage: number; pull: boolean }
  /** Moss swells on its back: the cloud in `warning` s. */
  | { type: 'swellMoss'; warning: number }
  | { type: 'moss'; at: Vec2; radius: number; damagePerSecond: number; overloadPerSecond: number; duration: number }
  | { type: 'thrash'; at: Vec2; radius: number; damage: number }
  /** The pool starts to spill: the water rises by `rises` m over `over` s. */
  | { type: 'flood'; rises: number; over: number }
  /** Hurt in the eye: it goes under and comes up somewhere else. */
  | { type: 'dive' }
  | { type: 'surface' };

/** The pool as the brain sees it. */
export interface RegentPoolView { x: number; z: number; radius: number; waterY: number }

export interface RegentInput {
  host: HostView;
  /** Remaining Biomass / max. */
  fraction: number;
  pool: RegentPoolView;
}

const R = () => AI.regent;
const TAU = Math.PI * 2;

export class RegentBrain {
  readonly t: Boss;
  state: 'dormant' | 'awake' | 'dead' = 'dormant';
  phase: BossPhase;
  /** 'stalk', 'wait' (host out of reach), 'dive', or the attack it is winding up. */
  action = 'stalk';
  actionTime = 0;
  readonly pos: Vec2 = { x: 0, z: 0 };
  yaw = 0;
  // Drive outputs.
  rise = 0;
  open = 0;
  tongue = 0;
  thrash = 0;
  readonly reach: [Vec2 | null, Vec2 | null] = [null, null];
  look: Vec2 | null = null;
  enraged = false;
  /** How far the water has risen (m): the drown phase's flood, all of it once enraged. */
  flood = 0;
  readonly events: RegentEvent[] = [];
  private awakeFor = 0;
  private cd = new Map<string, number>();
  private aim: Vec2 = { x: 0, z: 0 };
  private arm = 0;
  private rearT = 0;
  private diveT = 0;
  private floodTo = 0;
  private floodRate = 0;
  private seed: number;

  constructor(x: number, z: number, seed = 29, readonly id = 'mireRegent') {
    this.t = BOSSES[id];
    if (!this.t) throw new Error(`no boss ${id}`);
    this.phase = this.t.phases[0];
    this.seed = seed >>> 0 || 1;
    this.pos.x = x; this.pos.z = z;
    this.yaw = this.rand() * TAU;
  }

  get awake(): boolean { return this.state === 'awake'; }
  get diving(): boolean { return this.diveT > 0; }
  /** Its eyes are above the water (and so can be shot) unless it is diving. */
  get eyesUp(): boolean { return this.state !== 'dead' && !this.diving; }
  bodyMultiplier(): number { return Number(this.phase.bodyDamageMultiplier ?? 1); }
  /** A host this far above the water is on a root or island (the flood raises the water). */
  wading(h: HostView, pool: RegentPoolView): boolean { return h.y - (pool.waterY + this.flood) < R().wadeHeight; }

  wake(): void {
    if (this.state !== 'dormant') return;
    this.state = 'awake';
    this.events.push({ type: 'wake' });
    this.resetCooldowns();
  }
  hurt(): void { this.wake(); }
  kill(): void { this.state = 'dead'; this.cancel(); this.rise = 0; this.thrash = 0; this.open = 0; }
  /** Shot in the eye: it goes under now and comes up on the far side. */
  dive(): void {
    if (this.state !== 'awake' || this.diving) return;
    this.cancel();
    this.action = 'dive'; this.actionTime = 0;
    this.diveT = R().diveFor;
    this.events.push({ type: 'dive' });
  }

  step(dt: number, i: RegentInput): void {
    if (this.state === 'dead') return;
    const h = i.host, P = i.pool, r = R();
    const inPool = Math.hypot(h.x - P.x, h.z - P.z) <= P.radius;
    if (this.state === 'dormant') {
      const near = Math.hypot(h.x - this.pos.x, h.z - this.pos.z) <= r.wakeRadius;
      if (h.alive && !h.hidden && inPool && near && this.wading(h, P)) this.wake();
      else { this.ease(dt, 0); return; }
    }
    this.awakeFor += dt;
    this.actionTime += dt;
    for (const [k, v] of this.cd) this.cd.set(k, v - dt);
    // The flood.
    if (this.flood < this.floodTo) this.flood = Math.min(this.floodTo, this.flood + this.floodRate * dt);

    const next = bossPhase(this.id, i.fraction);
    if (next.id !== this.phase.id) {
      this.phase = next;
      this.events.push({ type: 'phase', id: next.id });
      if (this.action !== 'dive') this.cancel();
      this.resetCooldowns();
      const fl = this.attacks().flood;
      if (fl) this.spill(Number(fl.waterRises), Number(fl.overSeconds));
    }
    if (!this.enraged && this.awakeFor >= this.t.enrage.after) {
      this.enraged = true;
      this.events.push({ type: 'enrage' });
      // The islands go under: the whole flood, fast.
      const fl = this.atk('flood');
      this.spill(Number(fl.waterRises ?? 1.5) * 1.5, 10);
    }

    const present = h.alive && !h.hidden;
    this.look = present ? { x: h.x, z: h.z } : null;
    if (this.diving) {
      this.diveT -= dt;
      // Under, it swims to the far side of the pool from the host.
      const a = Math.atan2(this.pos.z - (present ? h.z : P.z), this.pos.x - (present ? h.x : P.x));
      this.swimTo(P.x + Math.cos(a) * P.radius, P.z + Math.sin(a) * P.radius, dt, i, 1.6);
      this.ease(dt, 0);
      if (this.diveT <= 0) { this.action = 'stalk'; this.actionTime = 0; this.events.push({ type: 'surface' }); }
      return;
    }
    if (!present) { this.cancel(); this.swimTo(P.x, P.z, dt, i); this.ease(dt, 0); return; }

    if (this.action !== 'stalk' && this.action !== 'wait') this.runAttack(dt, i);
    else this.move(dt, i);
    this.ease(dt, this.riseTarget());
  }

  // ------------------------------------------------------------------ movement

  private riseTarget(): number {
    const id = this.phase.id;
    if (this.action === 'bellySlam') return 1;
    if (this.action === 'tongue' || this.action === 'mossCloud') return Math.max(0.75, this.rearT > 0 ? 1 : 0);
    if (id === 'rise') return this.rearT > 0 ? 1 : 0.15;
    if (id === 'drown') return 0.55;
    return 0;
  }

  private move(dt: number, i: RegentInput): void {
    const h = i.host, P = i.pool, r = R(), id = this.phase.id;
    const wading = this.wading(h, P);
    const d = Math.hypot(h.x - this.pos.x, h.z - this.pos.z);
    this.thrash = id === 'drown' ? Math.min(1, this.thrash + dt) : Math.max(0, this.thrash - dt);
    // The rise phase rears on a rhythm.
    if (id === 'rise') {
      const was = this.rearT > 0;
      this.rearT -= dt;
      if (this.rearT < -r.rearEvery + r.rearFor) this.rearT = r.rearFor;
      const now = this.rearT > 0;
      if (now && !was) this.events.push({ type: 'rear' });
      if (!now && was) this.events.push({ type: 'settle' });
    }
    let tx: number, tz: number;
    if (id === 'lurk' && wading) {
      // Stalking: it comes up behind the host, where it is not looking.
      this.action = 'stalk';
      const f = h.forward && Math.hypot(h.forward.x, h.forward.z) > 0.1 ? h.forward : { x: (this.pos.x - h.x) / (d || 1), z: (this.pos.z - h.z) / (d || 1) };
      const fl = Math.hypot(f.x, f.z) || 1;
      tx = h.x - (f.x / fl) * r.stalkDistance; tz = h.z - (f.z / fl) * r.stalkDistance;
    } else if (!wading && id === 'lurk') {
      // Out of reach on a root or island: it waits in the water beside it, watching.
      this.action = 'wait';
      const a = Math.atan2(this.pos.z - h.z, this.pos.x - h.x);
      tx = h.x + Math.cos(a) * r.stalkDistance; tz = h.z + Math.sin(a) * r.stalkDistance;
    } else {
      this.action = 'stalk';
      const hold = Number(this.phase.holdDistance ?? 0) || r.stalkDistance * 0.6;
      const a = Math.atan2(this.pos.z - h.z, this.pos.x - h.x) + 0.25;
      tx = h.x + Math.cos(a) * hold; tz = h.z + Math.sin(a) * hold;
    }
    this.swimTo(tx, tz, dt, i);
    // Face the host when close (the eyes and mouth lead).
    if (d < 25) this.turnTo(Math.atan2(h.x - this.pos.x, h.z - this.pos.z), dt);
    this.open = Math.max(0, this.open - dt * 2);
    this.choose(i, wading, d);
  }

  private swimTo(x: number, z: number, dt: number, i: RegentInput, boost = 1): void {
    const P = i.pool, lim = P.radius * R().keepInside;
    const cx = x - P.x, cz = z - P.z, cd = Math.hypot(cx, cz);
    if (cd > lim) { x = P.x + (cx / cd) * lim; z = P.z + (cz / cd) * lim; }
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const v = Math.min(Number(this.phase.speed ?? 3) * boost, d * 2) * dt;
    this.pos.x += (dx / d) * v; this.pos.z += (dz / d) * v;
    if (this.action === 'dive' || d > 3) this.turnTo(Math.atan2(dx, dz), dt);
  }

  private turnTo(want: number, dt: number): void {
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const r = Number(this.phase.turnRate ?? 1) * dt;
    this.yaw += Math.max(-r, Math.min(r, d));
  }

  private ease(dt: number, target: number): void {
    const k = R().riseRate * dt;
    this.rise += Math.max(-k * 1.5, Math.min(k, target - this.rise));
    this.tongue = Math.max(0, this.tongue - dt * 3);
  }

  private spill(rises: number, over: number): void {
    this.floodTo = Math.max(this.floodTo, rises);
    this.floodRate = (this.floodTo - this.flood) / Math.max(1, over);
    this.events.push({ type: 'flood', rises: this.floodTo, over });
  }

  // ------------------------------------------------------------------ attacks

  private attacks(): Record<string, Atk> { return this.phase.attacks as Record<string, Atk>; }
  private atk(name: string): Atk {
    for (const p of this.t.phases) { const a = (p.attacks as Record<string, Atk>)[name]; if (a) return a; }
    return {};
  }
  private ready(id: string): boolean { return (this.cd.get(id) ?? 0) <= 0 && !!this.attacks()[id]; }

  private resetCooldowns(): void {
    this.cd.clear();
    for (const [k, a] of Object.entries(this.attacks())) this.cd.set(k, a.firstDelay !== undefined ? Number(a.firstDelay) : R().firstAttack);
  }

  private choose(i: RegentInput, wading: boolean, d: number): void {
    const A = this.attacks(), h = i.host, r = R();
    const start = (id: string) => { this.action = id; this.actionTime = 0; this.aim = { x: h.x, z: h.z }; };
    if (this.ready('callBrood')) {
      start('callBrood');
      this.events.push({ type: 'croak', warning: Number(A.callBrood.windup ?? 1) });
      return;
    }
    if (wading && this.ready('dragUnder') && d <= Number(A.dragUnder.range) + r.armReach) {
      start('dragUnder');
      // The arm on the host's side reaches.
      const side = Math.sin(this.yaw) * (h.z - this.pos.z) - Math.cos(this.yaw) * (h.x - this.pos.x);
      this.arm = side > 0 ? 0 : 1;
      this.reach[this.arm] = { ...this.aim };
      this.events.push({ type: 'reach', arm: this.arm, at: { ...this.aim }, warning: Number(A.dragUnder.windup ?? 0.6) });
      return;
    }
    if (wading && this.ready('ripple') && d <= Number(A.ripple.radius) + 2) {
      start('ripple');
      this.events.push({ type: 'bulge', at: { ...this.pos }, radius: Number(A.ripple.radius), warning: Number(A.ripple.windup ?? 0.8) });
      return;
    }
    // A host on high ground gets the tongue: it pulls them down into the water.
    const tg = A.tongue;
    if (tg && this.ready('tongue') && d <= Number(tg.range) && (!wading || d > Number(A.bellySlam?.radius ?? 8) + r.lungeDistance)) {
      start('tongue');
      this.events.push({ type: 'gape', yaw: Math.atan2(h.x - this.pos.x, h.z - this.pos.z), warning: Number(tg.windup ?? 0.7) });
      return;
    }
    const bs = A.bellySlam;
    if (bs && this.ready('bellySlam') && wading && d <= Number(bs.radius) + r.lungeDistance) {
      start('bellySlam');
      this.events.push({ type: 'heave', at: { ...this.aim }, radius: Number(bs.radius), warning: Number(bs.windup ?? 1.2) });
      return;
    }
    const mc = A.mossCloud;
    if (mc && this.ready('mossCloud') && d <= Number(mc.radius)) {
      start('mossCloud');
      this.events.push({ type: 'swellMoss', warning: Number(mc.windup ?? 1) });
      return;
    }
    const th = A.thrash;
    if (th && this.ready('thrash') && wading && d <= Number(th.radius) + 2) {
      start('thrash');
      return;
    }
  }

  private runAttack(dt: number, i: RegentInput): void {
    const id = this.action, a = this.attacks()[id] ?? {}, h = i.host, r = R();
    const windup = Number(a.windup ?? 0.8);
    const winding = this.actionTime < windup;
    const done = () => { this.cd.set(id, Number(a.cooldown ?? 6)); this.action = 'stalk'; this.actionTime = 0; };
    switch (id) {
      case 'dragUnder':
        if (!winding) {
          this.events.push({ type: 'grab', arm: this.arm, at: { ...this.aim }, radius: r.grabRadius, damage: Number(a.damage), pin: Number(a.pin), damagePerSecond: Number(a.damagePerSecond ?? 0), freedByDamage: Number(a.freedByDamage ?? 100) });
          this.reach[this.arm] = null;
          done();
        }
        return;
      case 'ripple':
        if (!winding) { this.events.push({ type: 'ripple', at: { ...this.pos }, radius: Number(a.radius), damage: Number(a.damage) }); done(); }
        return;
      case 'callBrood':
        this.open = Math.min(1, this.open + dt * 2);
        if (!winding) {
          const s = a.spawn as { type: string; count: number };
          this.events.push({ type: 'brood', spawnType: s.type, count: s.count });
          done();
        }
        return;
      case 'bellySlam':
        // Rears high and lunges at where the host stood.
        this.turnTo(Math.atan2(this.aim.x - this.pos.x, this.aim.z - this.pos.z), dt);
        if (winding) this.swimTo(this.aim.x, this.aim.z, dt, i, r.lungeDistance / Math.max(0.3, windup) / Number(this.phase.speed ?? 4));
        else {
          const f = { x: this.pos.x + Math.sin(this.yaw) * 3, z: this.pos.z + Math.cos(this.yaw) * 3 };
          this.events.push({ type: 'slam', at: f, radius: Number(a.radius), damage: Number(a.damage) });
          done();
        }
        return;
      case 'tongue':
        this.turnTo(Math.atan2(h.x - this.pos.x, h.z - this.pos.z), dt * 1.5);
        this.open = Math.min(1, this.open + dt * 3);
        if (!winding) {
          this.tongue = 1;
          this.events.push({ type: 'tongue', from: { ...this.pos }, yaw: this.yaw, range: Number(a.range), cone: r.tongueCone, damage: Number(a.damage), pull: !!a.pull });
          done();
        }
        return;
      case 'mossCloud':
        if (!winding) {
          this.events.push({ type: 'moss', at: { ...this.pos }, radius: Number(a.radius), damagePerSecond: Number(a.damagePerSecond), overloadPerSecond: Number(a.overloadPerSecond ?? 0), duration: Number(a.duration) });
          done();
        }
        return;
      case 'thrash':
        this.thrash = 1;
        if (!winding) { this.events.push({ type: 'thrash', at: { ...this.pos }, radius: Number(a.radius), damage: Number(a.damage) }); done(); }
        return;
      default: done();
    }
  }

  private cancel(): void {
    this.action = 'stalk'; this.actionTime = 0; this.reach[0] = this.reach[1] = null; this.tongue = 0;
  }

  private rand(): number {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
