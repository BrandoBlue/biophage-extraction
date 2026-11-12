/**
 * The Nethermaw (data/bosses.json `nethermaw`), the thing at the bottom of the Marrow Pit. Renderer-free: it never
 * moves, so it thinks with its breath, its lobes and the pit. It says what it does through `events`;
 * src/game/nethermaw.ts turns them into damage, Overload, the updraft pull, Hollowed and torn walkways, and drives
 * Creature's body.
 *
 * It shows how it thinks:
 * - It listens. Dormant until a host comes down into the deep layer (or shoots it); awake, its breath follows the host.
 * - breathe: the mouth breathes the updraft in and out (the pull only on the inhale). Before each spore pulse the lobe
 *   that faces the host swells and glows: shoot it then. Hurt a swelling lobe hard enough and it flinches and the
 *   pulse is lost. The mouth convulses before it sends Hollowed up. Every broken root column weakens the pulses.
 * - dream: it lies. False extract lights rise round the floor and spring when a host walks into one; the whisper
 *   creeps Overload; roots burst from the walls at the host, with a rumble first so it can be side-stepped.
 * - swallow: it inhales without stopping, pulling everything into the mouth, and tears a walkway loose every few
 *   seconds, the lowest first. High ground is the only answer.
 * Numbers come from bosses.json `nethermaw`; tells and timings it does not give come from ai.json `nethermaw`.
 */
import { AI, BOSSES, bossPhase, type Boss, type BossPhase } from '../../data';
import type { HostView, Vec2 } from './types';

interface Atk { windup?: number; cooldown?: number; damage?: number; radius?: number; [k: string]: unknown }

export type NethermawEvent =
  | { type: 'wake' }
  | { type: 'phase'; id: string }
  | { type: 'enrage' }
  /** Lobe `lobe` starts to swell: the pulse lands in `warning` s. */
  | { type: 'swell'; lobe: number; warning: number }
  /** The swollen lobe was hurt too much and the pulse is lost. */
  | { type: 'flinch'; lobe: number }
  /** A lobe bursts its spores: damage and Overload to hosts within `radius` of the mouth. */
  | { type: 'pulse'; lobe: number; radius: number; damage: number; overload: number }
  /** The mouth convulses: Hollowed come up in `warning` s. */
  | { type: 'stir'; warning: number }
  | { type: 'raise'; spawnType: string; count: number }
  /** False extract glows rise at these points. */
  | { type: 'falseLight'; at: Vec2[] }
  /** A false light springs on a host who walked into it. */
  | { type: 'trap'; at: Vec2; radius: number; damage: number; overload: number }
  /** The wall rumbles where roots will burst: `at` is where they land, at height `y`. */
  | { type: 'rumble'; at: Vec2; y: number; warning: number }
  | { type: 'roots'; at: Vec2; y: number; radius: number; damage: number }
  /** Tear the lowest walkway still standing. */
  | { type: 'collapse' };

/** The arena as the brain sees it: the mouth's centre, the floor height, the mouth's radius and the arena's. */
export interface NethermawPit { x: number; z: number; floorY: number; mawRadius: number; radius: number }

export interface NethermawInput {
  host: HostView;
  /** Remaining Biomass / max. */
  fraction: number;
  pit: NethermawPit;
  /** Root columns broken so far (each takes 20% off its pulses). */
  columnsBroken: number;
}

const N = () => AI.nethermaw;
const TAU = Math.PI * 2;

export class NethermawBrain {
  readonly t: Boss;
  state: 'dormant' | 'awake' | 'dead' = 'dormant';
  phase: BossPhase;
  /** 'idle', or the attack it is winding up. */
  action = 'idle';
  actionTime = 0;
  // Drive outputs.
  /** -1 full exhale .. 1 full inhale. */
  breath = 0;
  readonly swell: number[];
  look: Vec2 | null = null;
  enraged = false;
  /** The updraft's pull toward the mouth right now: speed (m/s) inside `radius` (0 for none). */
  pull = { speed: 0, radius: 0 };
  /** Damage per second to a host inside the mouth (swallow). */
  mouthDps = 0;
  /** Overload per second to hosts within `radius` (the dream's whisper). */
  whisper = { perSecond: 0, radius: 0 };
  /** The false lights standing now. */
  readonly lights: Vec2[] = [];
  /** Lobes burst (by the raid). */
  readonly lobeDead: boolean[];
  readonly events: NethermawEvent[] = [];
  private awakeFor = 0;
  private cd = new Map<string, number>();
  private lobe = -1;
  private lobeHurt = 0;
  private hold: number[];
  private aim: Vec2 & { y: number } = { x: 0, z: 0, y: 0 };
  private breathT = 0;
  private seed: number;

  /** `bearings`: each lobe's angle round the mouth (radians from +x toward +z), as the body lays them out. */
  constructor(readonly x: number, readonly z: number, readonly bearings: number[] = [0, 1, 2, 3, 4].map((i) => (i / 5) * TAU + 0.3), seed = 23, readonly id = 'nethermaw') {
    this.t = BOSSES[id];
    if (!this.t) throw new Error(`no boss ${id}`);
    this.phase = this.t.phases[0];
    this.seed = seed >>> 0 || 1;
    this.swell = bearings.map(() => 0);
    this.hold = bearings.map(() => 0);
    this.lobeDead = bearings.map(() => false);
    this.breathT = this.rand() * 3;
  }

  get awake(): boolean { return this.state === 'awake'; }
  /** True when lobe i takes weak-point damage (swollen, as the brief says). */
  lobeExposed(i: number): boolean { return !this.lobeDead[i] && this.swell[i] > 0.3; }
  bodyMultiplier(): number { return Number(this.phase.bodyDamageMultiplier ?? 1); }
  /** The pulse after broken root columns. */
  pulseScale(broken: number): number {
    return Math.max(0, 1 - broken * N().columnPulseCut);
  }

  wake(): void {
    if (this.state !== 'dormant') return;
    this.state = 'awake';
    this.events.push({ type: 'wake' });
    this.resetCooldowns();
  }
  kill(): void {
    this.state = 'dead';
    this.action = 'idle';
    this.swell.fill(0);
    this.pull = { speed: 0, radius: 0 };
    this.mouthDps = 0;
    this.whisper = { perSecond: 0, radius: 0 };
    this.lights.length = 0;
  }
  /** Damage reached it: wakes it, and a swelling lobe hurt hard enough flinches and loses its pulse. */
  hurt(amount = 0, lobe = -1): void {
    this.wake();
    if (lobe >= 0 && lobe === this.lobe && this.action === 'sporePulse') {
      this.lobeHurt += amount;
      if (this.lobeHurt >= N().flinchDamage) {
        this.events.push({ type: 'flinch', lobe });
        this.cd.set('sporePulse', Number(this.attacks().sporePulse?.cooldown ?? 12) * 0.5);
        this.hold[lobe] = 0;
        this.lobe = -1;
        this.action = 'idle';
      }
    }
  }
  burstLobe(i: number): void { this.lobeDead[i] = true; this.swell[i] = 0; if (this.lobe === i && this.action === 'sporePulse') { this.lobe = -1; this.action = 'idle'; } }

  step(dt: number, i: NethermawInput): void {
    if (this.state === 'dead') return;
    const h = i.host, P = i.pit, n = N();
    const d = Math.hypot(h.x - this.x, h.z - this.z);
    if (this.state === 'dormant') {
      const deep = h.alive && !h.hidden && d <= this.t.wakeRadius && h.y - P.floorY <= n.wakeAbove;
      if (deep) this.wake();
      else { this.breathe(dt, 0.4); this.ease(dt); return; }
    }
    this.awakeFor += dt;
    this.actionTime += dt;
    for (const [k, v] of this.cd) this.cd.set(k, v - dt);

    const next = bossPhase(this.id, i.fraction);
    if (next.id !== this.phase.id) {
      this.phase = next;
      this.events.push({ type: 'phase', id: next.id });
      this.action = 'idle'; this.lobe = -1;
      this.lights.length = 0;
      this.resetCooldowns();
      if (this.attacks().falseLight) this.raiseLights(i);
    }
    if (!this.enraged && this.awakeFor >= this.t.enrage.after) {
      // Enraged: the inhale holds at full and the bottom walkways go.
      this.enraged = true;
      this.events.push({ type: 'enrage' }, { type: 'collapse' }, { type: 'collapse' });
    }

    const present = h.alive && !h.hidden;
    this.look = present ? { x: h.x, z: h.z } : null;
    const id = this.phase.id, A = this.attacks();

    // Breath and the pull.
    const swallowing = !!A.inhale || this.enraged;
    this.breathe(dt, swallowing ? 1.6 : 1);
    if (swallowing) {
      const inh = this.atk('inhale');
      // Swallowing it never lets the breath out: the pull holds at full while it breathes harder.
      this.breath = Math.max(this.breath, 0.6);
      this.pull = { speed: Number(inh.pullSpeed ?? 0), radius: Number(inh.radius ?? 0) };
      this.mouthDps = Number(inh.damagePerSecondInMouth ?? 0);
    } else if (A.updraftPull && this.breath > n.inhaleFrom) {
      this.pull = { speed: Number(A.updraftPull.pullSpeed) * (this.breath - n.inhaleFrom) / (1 - n.inhaleFrom), radius: Number(A.updraftPull.radius) };
      this.mouthDps = 0;
    } else { this.pull = { speed: 0, radius: 0 }; this.mouthDps = 0; }
    const wh = A.whisper;
    this.whisper = wh ? { perSecond: Number(wh.overloadPerSecond), radius: Number(wh.radius) } : { perSecond: 0, radius: 0 };

    // False lights spring on a host who trusts them.
    if (present && this.lights.length) {
      for (let k = this.lights.length - 1; k >= 0; k--) {
        const l = this.lights[k];
        if (Math.hypot(h.x - l.x, h.z - l.z) > n.falseLightTrigger) continue;
        const sp = this.atk('sporePulse');
        this.events.push({ type: 'trap', at: { ...l }, radius: n.falseLightBlast, damage: Number(sp.damage ?? 20), overload: Number(sp.overload ?? 15) });
        this.lights.splice(k, 1);
      }
    }

    if (this.action !== 'idle') this.runAttack(dt, i);
    else if (present) this.choose(i, d, id);
    this.ease(dt);
  }

  // ------------------------------------------------------------------ attacks

  private attacks(): Record<string, Atk> { return this.phase.attacks as Record<string, Atk>; }
  private ready(id: string): boolean { return (this.cd.get(id) ?? 0) <= 0 && !!this.attacks()[id]; }
  /** An attack's numbers from whichever phase has it (the spore pulse arms the false lights; enraged, it inhales). */
  private atk(name: string): Atk {
    for (const p of this.t.phases) { const a = (p.attacks as Record<string, Atk>)[name]; if (a) return a; }
    return {};
  }

  private resetCooldowns(): void {
    this.cd.clear();
    for (const [k, a] of Object.entries(this.attacks())) {
      if (k === 'collapseWalkways') this.cd.set(k, Number(a.every ?? 10));
      else if (a.firstDelay !== undefined) this.cd.set(k, Number(a.firstDelay));
      else this.cd.set(k, N().firstAttack);
    }
  }

  private choose(i: NethermawInput, d: number, id: string): void {
    const A = this.attacks(), h = i.host;
    if (this.ready('collapseWalkways')) { this.cd.set('collapseWalkways', Number(A.collapseWalkways.every ?? 10)); this.events.push({ type: 'collapse' }); }
    if (this.ready('spawnHollowed')) {
      this.start('spawnHollowed');
      this.events.push({ type: 'stir', warning: Number(A.spawnHollowed.windup ?? 2) });
      return;
    }
    const sp = A.sporePulse;
    if (sp && this.ready('sporePulse') && d <= Number(sp.radius)) {
      const lobe = this.facingLobe(h);
      if (lobe >= 0) {
        this.start('sporePulse');
        this.lobe = lobe; this.lobeHurt = 0;
        this.events.push({ type: 'swell', lobe, warning: Number(sp.windup ?? 1.5) });
        return;
      }
    }
    const wr = A.wallRoots;
    if (wr && this.ready('wallRoots') && d <= Number(wr.range) && d >= N().rootMinRange) {
      this.start('wallRoots');
      this.aim = { x: h.x, z: h.z, y: h.y };
      this.events.push({ type: 'rumble', at: { x: h.x, z: h.z }, y: h.y, warning: Number(wr.windup ?? 0.9) });
      return;
    }
    if (this.lights.length === 0 && this.ready('falseLight')) this.raiseLights(i);
  }

  private start(id: string): void { this.action = id; this.actionTime = 0; }

  private runAttack(dt: number, i: NethermawInput): void {
    const id = this.action, a = this.attacks()[id] ?? {};
    const windup = Number(a.windup ?? 1);
    const done = () => { this.cd.set(id, Number(a.cooldown ?? 8)); this.action = 'idle'; this.actionTime = 0; };
    switch (id) {
      case 'sporePulse': {
        const l = this.lobe;
        if (l < 0 || this.lobeDead[l]) { done(); return; }
        // The lobe swells and its light rises through the whole wind-up: the tell.
        this.hold[l] = Math.max(this.hold[l], Math.min(1, this.actionTime / windup));
        if (this.actionTime >= windup) {
          const k = this.pulseScale(i.columnsBroken);
          this.events.push({ type: 'pulse', lobe: l, radius: Number(a.radius), damage: Number(a.damage) * k, overload: Number(a.overload ?? 0) * k });
          this.hold[l] = 1 + N().swellHold;
          this.lobe = -1;
          done();
        }
        return;
      }
      case 'spawnHollowed':
        if (this.actionTime >= windup) {
          const s = a.spawn as { type: string; count: number };
          this.events.push({ type: 'raise', spawnType: s.type, count: s.count });
          done();
        }
        return;
      case 'wallRoots':
        if (this.actionTime >= windup) {
          this.events.push({ type: 'roots', at: { x: this.aim.x, z: this.aim.z }, y: this.aim.y, radius: N().rootRadius, damage: Number(a.damage) });
          done();
        }
        return;
      default: done();
    }
  }

  /** The living lobe whose bearing is closest to the host's. */
  private facingLobe(h: HostView): number {
    const b = Math.atan2(h.z - this.z, h.x - this.x);
    let best = -1, bd = Infinity;
    for (const [k, a] of this.bearings.entries()) {
      if (this.lobeDead[k]) continue;
      const off = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
      if (off < bd) { bd = off; best = k; }
    }
    return best;
  }

  private raiseLights(i: NethermawInput): void {
    const fl = this.attacks().falseLight;
    if (!fl) return;
    const count = Number(fl.fakeExtractGlows ?? 3), r = Math.min(N().falseLightRadius, i.pit.radius * 0.8);
    // Spread round the floor, one of them always between the host and the mouth's far side: where a host would go.
    const base = Math.atan2(i.host.z - this.z, i.host.x - this.x) + Math.PI * 0.5;
    this.lights.length = 0;
    for (let k = 0; k < count; k++) {
      const a = base + (k / count) * TAU + (this.rand() - 0.5) * 0.5;
      this.lights.push({ x: this.x + Math.cos(a) * r, z: this.z + Math.sin(a) * r });
    }
    this.cd.set('falseLight', N().falseLightEvery);
    this.events.push({ type: 'falseLight', at: this.lights.map((l) => ({ ...l })) });
  }

  /** The breath cycle: a long inhale and a quicker exhale, `rate` times normal speed. */
  private breathe(dt: number, rate: number): void {
    this.breathT += (dt * rate * TAU) / N().breathCycle;
    const s = Math.sin(this.breathT);
    this.breath = Math.sign(s) * Math.pow(Math.abs(s), 0.7);
  }

  private ease(dt: number): void {
    for (let k = 0; k < this.swell.length; k++) {
      this.hold[k] = Math.max(0, this.hold[k] - (this.action === 'sporePulse' && this.lobe === k ? 0 : dt));
      const want = this.lobeDead[k] ? 0 : Math.min(1, this.hold[k]);
      this.swell[k] += (want - this.swell[k]) * Math.min(1, dt * 6);
    }
  }

  private rand(): number {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
