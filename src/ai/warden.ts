/**
 * The Warden of the Long Seed (the Wreck's reactor-chamber boss; data/bosses.json `warden`, tuning in data/ai.json
 * `warden`, docs/gdd/pve-ai.md). Renderer-free: where the head is on the chamber's surfaces, what it is about to do,
 * and the one-shot events the raid turns into damage. Creature's body follows the head's trail (src/creatures/warden.ts).
 *
 *  tend (100-60%)      crawls the walls and ceiling and re-perches often; spears the host with its root (the tell is
 *                      the head rearing back), births Oculimoth swarms from its seed pods. Its plates soak body fire:
 *                      vent a coolant valve to open the reactor seam beside it.
 *  overheat (60-25%)   drops to the floor, seams glowing open; steam bursts around it, faster spears, brings the
 *                      catwalks down.
 *  meltdown (25-0%)    the reactor goes critical: a 3 s charge, then a pulse that fills the chamber. Only cover saves you.
 * Wakes when ship power is restored (Gameplay's objective) or, until that exists, when a host comes into the chamber
 * (ai.json warden.wake.trigger).
 */
import { AI, BOSSES, bossPhase, type Boss, type BossPhase } from '../../data';
import type { HostView, Vec2, Vec3 } from './types';

interface Atk { windup?: number; cooldown?: number; damage?: number; radius?: number; [k: string]: unknown }

export type WardenSurface = 'floor' | 'wall' | 'ceiling';
export type WardenEvent =
  | { type: 'wake' }
  | { type: 'phase'; id: string }
  /** The root spear lands at `at`; hits a host within `radius` of it. */
  | { type: 'spear'; at: Vec3; radius: number; damage: number }
  | { type: 'swarm'; spawnType: string; count: number }
  | { type: 'steam'; at: Vec3; radius: number; damage: number }
  /** Bring down the catwalk nearest `near` (World's hook). */
  | { type: 'catwalk'; near: Vec2 }
  /** The reactor pulse: everything within `radius` of `from` not behind cover. */
  | { type: 'pulse'; from: Vec3; radius: number; damage: number }
  | { type: 'enrage' };

/** The reactor chamber as a box, plus the reactor core in the middle. */
export interface WardenRoom { x0: number; x1: number; z0: number; z1: number; floorY: number; height: number }

export interface WardenInput {
  host: HostView;
  /** Remaining Biomass / max. */
  fraction: number;
  room: WardenRoom;
  /** Gameplay's ship-power state, for wake.trigger 'power'. */
  powered?: boolean;
}

const W = AI.warden;

export class WardenBrain {
  readonly t: Boss;
  state: 'dormant' | 'awake' | 'dead' = 'dormant';
  phase: BossPhase;
  action = 'move';
  actionTime = 0;
  /** The head, on a surface of the chamber. */
  readonly head: Vec3 = { x: 0, y: 0, z: 0 };
  surface: WardenSurface = 'wall';
  /** Unit surface normal (away from the surface). */
  readonly up: Vec3 = { x: 0, y: 1, z: 0 };
  yaw = 0;
  // Drive outputs.
  windup = 0;
  rear = 0;
  look: Vec3 | null = null;
  strike: Vec3 | null = null;
  /** Seconds each reactor seam stays open after its valve vents (always open from overheat on). */
  readonly seamOpen: number[];
  enraged = false;
  readonly events: WardenEvent[] = [];
  private awakeFor = 0;
  private cd = new Map<string, number>();
  private perch: Vec3 | null = null;
  private perchFor = 0;
  private aim: Vec3 = { x: 0, y: 0, z: 0 };
  private enragePulse = 0;
  private seed: number;

  constructor(x: number, y: number, z: number, seed = 13, readonly id = 'warden') {
    this.t = BOSSES[id];
    if (!this.t) throw new Error(`no boss ${id}`);
    this.phase = this.t.phases[0];
    this.seed = seed >>> 0 || 1;
    Object.assign(this.head, { x, y, z });
    this.seamOpen = new Array((this.t.weakPoints.reactorSeams as { count: number }).count).fill(0);
  }

  get awake(): boolean { return this.state === 'awake'; }
  /** Seam `i` takes weak-point damage now. */
  seamExposed(i: number): boolean { return this.phase.id !== 'tend' || (this.seamOpen[i] ?? 0) > 0; }
  /** Body (plate) hits are soaked in tend. */
  bodyMultiplier(): number { return Number(this.phase.plateMultiplier ?? 1); }

  /** A coolant valve vented next to it: the seam beside that valve cracks open. */
  vent(i: number): void {
    if (i < 0 || i >= this.seamOpen.length || this.state === 'dead') return;
    this.seamOpen[i] = W.seamOpenTime;
  }

  /** Gameplay's power puzzle (or anything else) wakes it explicitly. */
  wake(): void {
    if (this.state !== 'dormant') return;
    this.state = 'awake';
    this.events.push({ type: 'wake' });
    this.cd.set('embryoSwarm', W.swarmFirstDelay);
  }
  hurt(): void { this.wake(); }
  kill(): void { this.state = 'dead'; this.windup = 0; this.strike = null; this.rear = 0; }

  step(dt: number, i: WardenInput): void {
    if (this.state === 'dead') return;
    const h = i.host;
    for (let k = 0; k < this.seamOpen.length; k++) this.seamOpen[k] = Math.max(0, this.seamOpen[k] - dt);
    if (this.state === 'dormant') {
      const inRoom = h.alive && !h.hidden && h.x >= i.room.x0 && h.x <= i.room.x1 && h.z >= i.room.z0 && h.z <= i.room.z1;
      const near = h.alive && !h.hidden && Math.hypot(h.x - this.head.x, h.z - this.head.z) <= W.wake.radius;
      if ((W.wake.trigger === 'power' && i.powered) || (W.wake.trigger === 'approach' && (inRoom || near))) this.wake();
      else { this.snap(i.room); return; }
    }
    this.awakeFor += dt;
    this.actionTime += dt;
    for (const [k, v] of this.cd) this.cd.set(k, v - dt);

    const next = bossPhase(this.id, i.fraction);
    if (next.id !== this.phase.id) {
      this.phase = next;
      this.events.push({ type: 'phase', id: next.id });
      this.cancel();
      this.cd.clear();
      this.perch = null;
    }
    if (!this.enraged && this.awakeFor >= this.t.enrage.after) { this.enraged = true; this.enragePulse = 0; this.events.push({ type: 'enrage' }); }

    if (!h.alive || h.hidden) { this.cancel(); this.look = null; return; }
    this.look = { x: h.x, y: h.y + 1.5, z: h.z };
    if (this.enraged) this.enragePulse -= dt;
    if (this.enraged && this.action === 'move') {
      if (this.enragePulse <= 0) { this.enragePulse = W.enragePulseEvery; return this.start('reactorPulse', h); }
    }
    if (this.action !== 'move') { this.runAttack(dt, i); this.snap(i.room); return; }
    this.windup = Math.max(0, this.windup - dt * 3);
    this.rear = Math.max(0, this.rear - dt * 2);
    this.strike = null;
    this.move(dt, i);
    this.snap(i.room);
    this.choose(i);
  }

  // ------------------------------------------------------------------ movement

  /** Tend: re-perches on the walls and ceiling round the host. Later phases: on the floor, closing in. */
  private move(dt: number, i: WardenInput): void {
    const h = i.host, r = i.room, top = r.floorY + r.height;
    let goal: Vec3, speed: number;
    if (this.phase.id === 'tend') {
      this.perchFor -= dt;
      if (!this.perch || this.perchFor <= 0) {
        const [a, b] = W.perchTime;
        this.perchFor = a + this.rand() * (b - a);
        // Over the host on the ceiling, or high on the wall nearest it, never the same twice.
        const ang = this.rand() * Math.PI * 2, off = 4 + this.rand() * 6;
        if (this.rand() < 0.5) this.perch = { x: h.x + Math.cos(ang) * off, y: top, z: h.z + Math.sin(ang) * off };
        else {
          const walls: Vec3[] = [{ x: r.x0, y: 0, z: h.z }, { x: r.x1, y: 0, z: h.z }, { x: h.x, y: 0, z: r.z0 }, { x: h.x, y: 0, z: r.z1 }];
          walls.sort((p, q) => Math.hypot(p.x - h.x, p.z - h.z) - Math.hypot(q.x - h.x, q.z - h.z));
          const w = walls[this.rand() < 0.7 ? 0 : 1];
          this.perch = { x: w.x + (w.x === h.x ? Math.cos(ang) * off : 0), y: r.floorY + r.height * (0.45 + this.rand() * 0.4), z: w.z + (w.z === h.z ? Math.sin(ang) * off : 0) };
        }
      }
      goal = this.perch;
      speed = W.crawlSpeed;
    } else {
      const dx = this.head.x - h.x, dz = this.head.z - h.z, d = Math.hypot(dx, dz) || 1;
      goal = { x: h.x + (dx / d) * W.holdDistance, y: r.floorY, z: h.z + (dz / d) * W.holdDistance };
      speed = W.floorSpeed;
    }
    const gx = goal.x - this.head.x, gy = goal.y - this.head.y, gz = goal.z - this.head.z, gd = Math.hypot(gx, gy, gz);
    if (gd > 0.3) {
      const s = Math.min(gd, speed * dt);
      this.head.x += (gx / gd) * s; this.head.y += (gy / gd) * s; this.head.z += (gz / gd) * s;
      if (Math.hypot(gx, gz) > 0.2) this.yaw = Math.atan2(gx, gz);
    }
  }

  /** Puts the head back on the nearest surface of the chamber and sets `surface` and `up`. */
  private snap(r: WardenRoom): void {
    const p = this.head, top = r.floorY + r.height, m = 0.01;
    p.x = Math.min(r.x1 - m, Math.max(r.x0 + m, p.x));
    p.z = Math.min(r.z1 - m, Math.max(r.z0 + m, p.z));
    p.y = Math.min(top, Math.max(r.floorY, p.y));
    const d = [p.y - r.floorY, top - p.y, p.x - r.x0, r.x1 - p.x, p.z - r.z0, r.z1 - p.z];
    // Out of the tend phase it stays on the floor.
    const k = this.phase.id === 'tend' ? d.indexOf(Math.min(...d)) : 0;
    const n: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    [this.up.x, this.up.y, this.up.z] = n[k];
    if (k === 0) p.y = r.floorY; else if (k === 1) p.y = top;
    else if (k === 2) p.x = r.x0; else if (k === 3) p.x = r.x1; else if (k === 4) p.z = r.z0; else p.z = r.z1;
    this.surface = k === 0 ? 'floor' : k === 1 ? 'ceiling' : 'wall';
  }

  // ------------------------------------------------------------------ attacks

  private attacks(): Record<string, Atk> { return this.phase.attacks as Record<string, Atk>; }
  private ready(id: string): boolean { return (this.cd.get(id) ?? 0) <= 0 && !!this.attacks()[id]; }
  private start(id: string, h: HostView): void {
    this.action = id; this.actionTime = 0;
    this.aim = { x: h.x + h.vx * W.spearLead, y: h.y, z: h.z + h.vz * W.spearLead };
  }

  private choose(i: WardenInput): void {
    const h = i.host, d3 = Math.hypot(h.x - this.head.x, h.y + 1 - this.head.y, h.z - this.head.z);
    if (this.ready('reactorPulse')) return this.start('reactorPulse', h);
    if (this.ready('embryoSwarm')) return this.start('embryoSwarm', h);
    if (this.ready('catwalkCollapse')) return this.start('catwalkCollapse', h);
    const st = this.attacks().steamBurst;
    if (st && this.ready('steamBurst') && Math.hypot(h.x - this.head.x, h.z - this.head.z) <= this.num(st.radius, 'steamBurst.radius') + this.t.size.length * 0.15) return this.start('steamBurst', h);
    if (this.ready('rootSpear') && d3 <= W.spearRange) return this.start('rootSpear', h);
  }

  private runAttack(dt: number, i: WardenInput): void {
    const id = this.action, a = this.attacks()[id] ?? {}, h = i.host;
    this.yaw = Math.atan2(h.x - this.head.x, h.z - this.head.z);
    if (id === 'reactorPulse') {
      // The reactor charges for its whole wind-up (the drive's windup and rear swell), then the pulse fills the room.
      const p = (this.t.phases.find((x) => x.id === 'meltdown')!.attacks as Record<string, Atk>).reactorPulse;
      const w = this.num(p.windup, 'reactorPulse.windup');
      this.windup = Math.min(1, this.actionTime / w);
      this.rear = this.windup;
      if (this.actionTime >= w) {
        this.events.push({ type: 'pulse', from: { ...this.head }, radius: this.num(p.radius, 'reactorPulse.radius'), damage: this.num(p.damage, 'reactorPulse.damage') });
        this.cd.set(id, this.enraged ? W.enragePulseEvery : this.num(p.cooldown, 'reactorPulse.cooldown'));
        this.cancel();
      }
      return;
    }
    const windup = id === 'steamBurst' ? W.steamTell : id === 'embryoSwarm' || id === 'catwalkCollapse' ? W.birthTell : this.num(a.windup, `${id}.windup`);
    const winding = this.actionTime < windup;
    this.windup = winding ? this.actionTime / windup : Math.max(0, 1 - (this.actionTime - windup) * 3);
    const done = () => { this.cd.set(id, this.num(a.cooldown, `${id}.cooldown`)); this.cancel(); };
    switch (id) {
      case 'rootSpear':
        // The head rears back while it aims at where the host was going; move and it misses.
        this.rear = this.windup;
        this.strike = { ...this.aim };
        if (!winding) { this.events.push({ type: 'spear', at: { ...this.aim }, radius: W.spearRadius, damage: this.num(a.damage, 'rootSpear.damage') }); done(); }
        return;
      case 'embryoSwarm':
        if (!winding) { const s = a.spawn as { type: string; count: number }; this.events.push({ type: 'swarm', spawnType: s.type, count: s.count }); done(); }
        return;
      case 'steamBurst':
        if (!winding) { this.events.push({ type: 'steam', at: { ...this.head }, radius: this.num(a.radius, 'steamBurst.radius'), damage: this.num(a.damage, 'steamBurst.damage') }); done(); }
        return;
      case 'catwalkCollapse':
        if (!winding) { this.events.push({ type: 'catwalk', near: { x: h.x, z: h.z } }); done(); }
        return;
      default:
        this.cancel();
    }
  }

  private cancel(): void { this.action = 'move'; this.actionTime = 0; this.strike = null; }
  private num(v: unknown, name: string): number {
    if (typeof v !== 'number') throw new Error(`bosses.json ${this.id}.${this.phase.id}: missing ${name}`);
    return v;
  }
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
