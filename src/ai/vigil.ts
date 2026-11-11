/**
 * The Pale Vigil (Glowmire Isle, the Fungal Cave boss; data/bosses.json `paleVigil`, docs/gdd/pve-ai.md). Renderer-free:
 * where it is, how far it hangs, what it is about to do and the one-shot events the raid turns into damage. It never
 * makes a sound until it has you; its only tell is the lure going still. Creature's body reads the outputs
 * (hang, lureGlow, lureStill, dim, windup, rear, strike, look); the raid applies the events.
 *
 *  hang (100-70%)    crawls the ceiling, parks its lure over where you are going; drops on whoever walks under it,
 *                    snatches whoever comes close and lifts them to the roof. Shoot the lure or the spines.
 *  stalk (70-35%)    on the floor, silent and dim: works round behind you, lunges from your blind side, rakes up
 *                    close, then climbs into the dark and comes back from behind. Limbs can be cut off.
 *  unravel (35-0%)   fast and loud: shrieks (spines stand out), brings the ceiling down, chains frenzied lunges.
 */
import { BOSSES, bossPhase, type Boss, type BossPhase } from '../../data';
import { wrapAngle } from './brain';
import type { HostView, Vec2, Vec3 } from './types';

interface Atk { windup?: number; cooldown?: number; [k: string]: unknown }

export type VigilEvent =
  | { type: 'wake' }
  | { type: 'phase'; id: string }
  /** Dropped from the ceiling onto `at`. */
  | { type: 'drop'; at: Vec2; radius: number; damage: number }
  /** Caught the host and is lifting it to the roof. */
  | { type: 'grab'; damage: number; pin: number; pinDamagePerSecond: number; lift: number; freedByDamage: number }
  | { type: 'lunge'; how: 'ambush' | 'frenzy'; damage: number }
  | { type: 'rake'; damage: number }
  /** Climbed into the dark (hidden) / dropped back down behind the host. */
  | { type: 'vanish' }
  | { type: 'reappear'; at: Vec2 }
  | { type: 'shriek'; radius: number; damage: number; overload: number; stagger: number }
  /** Dust falls where a chunk of ceiling will land in `warning` s; then a `chunk` lands there. */
  | { type: 'collapseWarn'; at: Vec2; radius: number; warning: number }
  | { type: 'chunk'; at: Vec2; radius: number; damage: number }
  | { type: 'enrage' };

export interface VigilInput {
  host: HostView;
  /** Remaining Biomass / max. */
  fraction: number;
  lureAlive: boolean;
  limbsIntact: number;
  /** The cave chamber: centre and radius (it never leaves it). */
  arena: { x: number; z: number; radius: number };
}

export class PaleVigilBrain {
  readonly t: Boss;
  state: 'dormant' | 'awake' | 'dead' = 'dormant';
  phase: BossPhase;
  /** 'move' or an attack id ('drop', 'snatch', 'ambushLunge', 'limbRake', 'vanish', 'shriek', 'ceilingCollapse', 'frenzyLunge'). */
  action = 'move';
  actionTime = 0;
  readonly body = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0 };
  // Drive outputs.
  /** 1 = hanging from the ceiling, 0 = on the floor. */
  hang = 1;
  /** 0..1 lure light (0 once the lure is gone). */
  lureGlow = 1;
  /** 1 while the lure hangs dead still: the drop tell. */
  lureStill = 0;
  /** 0..1 how far it has melted into the dark (hidden while climbing away). */
  dim = 0;
  /** 0..1 chest slit open, spines out (shriek). */
  rear = 0;
  windup = 0;
  look: Vec3 | null = null;
  strike: Vec3 | null = null;
  /** Hidden in the roof between stalk attacks: cannot be hit, does not attack. */
  hidden = false;
  enraged = false;
  readonly events: VigilEvent[] = [];
  private awakeFor = 0;
  private cd = new Map<string, number>();
  private hitDone = false;
  private chain = 0;
  private enrageFall = 0;
  private chunks: { at: Vec2; t: number; radius: number; damage: number }[] = [];
  private seed: number;

  constructor(x: number, z: number, seed = 11, readonly id = 'paleVigil') {
    this.t = BOSSES[id];
    if (!this.t) throw new Error(`no boss ${id}`);
    this.phase = this.t.phases[0];
    this.seed = seed >>> 0 || 1;
    Object.assign(this.body, { x, z });
  }

  get awake(): boolean { return this.state === 'awake'; }
  /** Spines take weak-point damage while it hangs or rears to shriek. */
  get spinesExposed(): boolean { return !this.hidden && (this.hang > 0.5 || (this.action === 'shriek' && this.rear > 0.5)); }
  /** Limbs can be cut off once it has come down (stalk on). */
  get limbsSeverable(): boolean { return this.phase.id !== 'hang'; }
  /** Overload per second the lure pours into a host looking at it within range (the raid checks line of sight). */
  lurePull(i: VigilInput): number {
    const lg = (this.t.phases[0].attacks as Record<string, Atk>).lureGlow;
    if (!lg || !i.lureAlive || this.state === 'dead' || this.hang < 0.5) return 0;
    return Math.hypot(i.host.x - this.body.x, i.host.z - this.body.z) <= this.num(lg.range, 'lureGlow.range') ? this.num(lg.overloadPerSecond, 'lureGlow.overloadPerSecond') : 0;
  }
  bodyMultiplier(): number { return Number(this.phase.bodyDamageMultiplier ?? 1); }

  hurt(): void { if (this.state === 'dormant') this.wake(); }
  kill(): void { this.state = 'dead'; this.windup = 0; this.strike = null; this.lureGlow = 0; this.body.vx = this.body.vz = 0; this.chunks.length = 0; }

  step(dt: number, i: VigilInput): void {
    if (this.state === 'dead') return;
    const h = i.host, b = this.body;
    this.lureGlow += ((i.lureAlive ? 1 - this.lureStill * 0.4 : 0) - this.lureGlow) * Math.min(1, dt * 4);
    if (this.state === 'dormant') {
      if (h.alive && !h.hidden && Math.hypot(h.x - b.x, h.z - b.z) <= this.t.wakeRadius) this.wake();
      else return;
    }
    this.awakeFor += dt;
    this.actionTime += dt;
    for (const [k, v] of this.cd) this.cd.set(k, v - dt);
    this.fallChunks(dt);

    // Phase from Biomass; losing the lure while hanging brings it down to stalk.
    let next = bossPhase(this.id, i.fraction);
    if (next.id === 'hang' && !i.lureAlive) next = this.t.phases[1];
    if (next.id !== this.phase.id) {
      this.phase = next;
      this.events.push({ type: 'phase', id: next.id });
      this.cancel();
      this.cd.clear();
    }
    if (!this.enraged && this.awakeFor >= this.t.enrage.after) { this.enraged = true; this.enrageFall = 0; this.events.push({ type: 'enrage' }); }
    if (this.enraged) {
      this.enrageFall -= dt;
      if (this.enrageFall <= 0) { this.enrageFall = 6; this.bringCeilingDown(i); }
    }

    const wantHang = this.phase.id === 'hang' && this.action !== 'drop' ? 1 : this.hidden || this.action === 'vanish' ? 1 : 0;
    this.hang += (wantHang - this.hang) * Math.min(1, dt * (this.action === 'drop' ? 12 : 2.5));
    this.rear += ((this.action === 'shriek' ? 1 : this.phase.id === 'unravel' ? 0.3 : 0) - this.rear) * Math.min(1, dt * 4);
    this.dim += ((this.hidden ? 1 : this.phase.id === 'stalk' ? 0.6 : 0) - this.dim) * Math.min(1, dt * 2);
    if (this.action !== 'drop') this.lureStill = Math.max(0, this.lureStill - dt * 4);

    if (!h.alive || h.hidden) { this.cancel(); this.slow(dt); return; }
    const dx = h.x - b.x, dz = h.z - b.z, dist = Math.hypot(dx, dz) || 1e-6;
    this.look = this.hidden ? null : { x: h.x, y: h.y + 1.5, z: h.z };
    if (this.action !== 'move') { this.runAttack(dt, i, dist, dx / dist, dz / dist); this.keepIn(i); return; }

    this.windup = Math.max(0, this.windup - dt * 3);
    this.strike = null;
    const turn = this.num(this.phase.turnRate, 'turnRate');
    switch (this.phase.id) {
      case 'hang': {
        // Crawls the roof to park its lure over where the host is going, not where it is.
        const lead = 1.5, px = h.x + h.vx * lead, pz = h.z + h.vz * lead;
        this.moveTo(px, pz, this.num(this.phase.ceilingSpeed, 'ceilingSpeed'), turn, dt);
        break;
      }
      case 'stalk': {
        // Works round to the host's blind side, staying just outside its view.
        const back = this.behind(h, this.num(this.phase.holdDistance, 'holdDistance') + 2);
        const speed = this.num(this.phase.speed, 'speed') * this.limbFactor(i.limbsIntact);
        const inView = this.inHostView(h);
        // In view: swing wide round the host rather than walking straight at it.
        const side = wrapAngle(Math.atan2(b.x - h.x, b.z - h.z) - this.hostYaw(h)) > 0 ? 1 : -1;
        const sx = inView ? h.x + Math.sin(this.hostYaw(h) + side * 2) * 8 : back.x;
        const sz = inView ? h.z + Math.cos(this.hostYaw(h) + side * 2) * 8 : back.z;
        this.moveTo(sx, sz, speed, turn, dt);
        this.face(Math.atan2(dx, dz), turn * 0.5, dt);
        break;
      }
      case 'unravel':
        this.moveTo(h.x, h.z, this.num(this.phase.speed, 'speed') * this.limbFactor(i.limbsIntact), turn, dt);
        break;
    }
    this.keepIn(i);
    this.choose(i, dist);
  }

  private wake(): void { this.state = 'awake'; this.events.push({ type: 'wake' }); }

  private attacks(): Record<string, Atk> { return this.phase.attacks as Record<string, Atk>; }
  private ready(id: string): boolean { return (this.cd.get(id) ?? 0) <= 0 && !!this.attacks()[id]; }

  private choose(i: VigilInput, dist: number): void {
    const A = this.attacks(), h = i.host;
    const start = (id: string) => { this.action = id; this.actionTime = 0; this.hitDone = false; };
    switch (this.phase.id) {
      case 'hang':
        if (i.lureAlive && this.ready('drop') && dist <= this.num(A.drop.triggerUnderLure, 'drop.triggerUnderLure')) return start('drop');
        if (this.ready('snatch') && dist <= this.num(A.snatch.range, 'snatch.range')) return start('snatch');
        return;
      case 'stalk': {
        if (this.ready('ambushLunge') && dist <= this.num(A.ambushLunge.range, 'ambushLunge.range') && this.fromBehind(h, this.num(A.ambushLunge.fromBehindArc, 'fromBehindArc'))) return start('ambushLunge');
        if (this.ready('limbRake') && dist <= this.num(A.limbRake.range, 'limbRake.range')) return start('limbRake');
        return;
      }
      case 'unravel':
        if (this.ready('ceilingCollapse')) return start('ceilingCollapse');
        if (this.ready('shriek') && dist <= this.num(A.shriek.radius, 'shriek.radius')) return start('shriek');
        if (this.ready('frenzyLunge') && dist <= this.num(A.frenzyLunge.range, 'frenzyLunge.range')) { this.chain = this.num(A.frenzyLunge.chain, 'chain'); return start('frenzyLunge'); }
        return;
    }
  }

  private runAttack(dt: number, i: VigilInput, dist: number, dx: number, dz: number): void {
    const id = this.action, h = i.host, a = this.attacks()[id] ?? {};
    if (id === 'vanish') return this.vanish(dt, i);
    if (id === 'ceilingCollapse') {
      // No wind-up of its own: the dust that falls first is the warning.
      this.bringCeilingDown(i);
      this.cd.set(id, this.num(a.cooldown, 'ceilingCollapse.cooldown'));
      this.cancel();
      return;
    }
    const windup = this.num(a.windup, `${id}.windup`);
    const winding = this.actionTime < windup;
    this.windup = winding ? this.actionTime / windup : Math.max(0, 1 - (this.actionTime - windup) * 2);
    const done = () => { this.cd.set(id, this.num(a.cooldown, `${id}.cooldown`)); this.cancel(); };
    switch (id) {
      case 'drop':
        // The lure goes dead still: the one tell. Then it falls.
        this.slow(dt);
        this.lureStill = winding ? 1 : 0;
        if (!winding && !this.hitDone) {
          this.hitDone = true;
          this.events.push({ type: 'drop', at: { x: this.body.x, z: this.body.z }, radius: this.num(a.radius, 'radius'), damage: this.num(a.damage, 'damage') });
        }
        // Crouches where it landed for a moment (the window to hit it), then climbs back.
        if (this.actionTime >= windup + 1.5) done();
        return;
      case 'snatch':
        this.slow(dt);
        this.face(Math.atan2(dx, dz), 3, dt);
        this.strike = { x: h.x, y: h.y + 1, z: h.z };
        if (!winding) {
          if (dist <= this.num(a.range, 'range')) {
            this.events.push({ type: 'grab', damage: this.num(a.damage, 'damage'), pin: this.num(a.pin, 'pin'), pinDamagePerSecond: this.num(a.pinDamagePerSecond, 'pinDamagePerSecond'), lift: this.num(a.liftHeight, 'liftHeight'), freedByDamage: this.num(a.freedByDamage, 'freedByDamage') });
          }
          done();
        }
        return;
      case 'ambushLunge': case 'frenzyLunge': {
        const lungeFor = 0.3;
        if (winding) { this.slow(dt); this.face(Math.atan2(dx, dz), 8, dt); this.strike = { x: h.x, y: h.y + 1, z: h.z }; return; }
        const v = Math.max(16, (this.num(a.range, 'range') + 1) / lungeFor);
        this.steer(dx * v, dz * v, 14, dt);
        this.integrate(dt);
        if (!this.hitDone && dist <= 2.2) {
          this.hitDone = true;
          this.events.push({ type: 'lunge', how: id === 'ambushLunge' ? 'ambush' : 'frenzy', damage: this.num(a.damage, 'damage') });
        }
        if (this.actionTime >= windup + lungeFor) {
          if (id === 'frenzyLunge' && --this.chain > 0) { this.actionTime = windup * 0.5; this.hitDone = false; return; }
          done();
          if (id === 'ambushLunge') this.startVanish(i);
        }
        return;
      }
      case 'limbRake':
        this.slow(dt);
        this.face(Math.atan2(dx, dz), 4, dt);
        this.strike = { x: h.x, y: h.y + 1, z: h.z };
        if (!winding) {
          if (dist <= this.num(a.range, 'range') + 0.5) this.events.push({ type: 'rake', damage: this.num(a.damage, 'damage') });
          done();
          this.startVanish(i);
        }
        return;
      case 'shriek':
        this.slow(dt);
        this.face(Math.atan2(dx, dz), 3, dt);
        if (!winding) {
          this.events.push({ type: 'shriek', radius: this.num(a.radius, 'radius'), damage: this.num(a.damage, 'damage'), overload: this.num(a.overload, 'overload'), stagger: this.num(a.stagger, 'stagger') });
          done();
        }
        return;
      default:
        this.cancel();
    }
  }

  /** After a stalk attack it climbs into the dark, stays hidden, then drops back down behind the host. */
  private startVanish(i: VigilInput): void {
    const v = this.attacks().vanish;
    if (!v || this.phase.id !== 'stalk' || i.limbsIntact <= 0) return;
    this.action = 'vanish'; this.actionTime = 0; this.hitDone = false;
  }

  private vanish(dt: number, i: VigilInput): void {
    const v = this.attacks().vanish ?? {}, h = i.host;
    const climb = this.num(v.climbTime, 'vanish.climbTime'), hidden = this.num(v.hiddenFor, 'vanish.hiddenFor');
    this.windup = 0; this.strike = null;
    if (this.actionTime < climb) { this.slow(dt); return; }
    if (!this.hitDone) { this.hitDone = true; this.hidden = true; this.events.push({ type: 'vanish' }); }
    // Hidden: moves through the roof to a spot behind the host.
    const back = this.behind(h, 6);
    this.moveTo(back.x, back.z, 6, 6, dt);
    if (this.actionTime >= climb + hidden) {
      this.hidden = false;
      Object.assign(this.body, { x: back.x, z: back.z, vx: 0, vz: 0, yaw: Math.atan2(h.x - back.x, h.z - back.z) });
      this.keepIn(i);
      this.events.push({ type: 'reappear', at: { x: this.body.x, z: this.body.z } });
      this.cancel();
    }
  }

  /** Warns, then drops `count` chunks: one on the host, the rest scattered round it. */
  private bringCeilingDown(i: VigilInput): void {
    const c = (this.t.phases.find((p) => p.id === 'unravel')!.attacks as Record<string, Atk>).ceilingCollapse;
    const n = this.num(c.count, 'count'), radius = this.num(c.radius, 'radius'), warning = this.num(c.warning, 'warning'), damage = this.num(c.damage, 'damage');
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2, r = k === 0 ? 0 : 3 + this.rand() * 5;
      const at = { x: i.host.x + Math.cos(a) * r, z: i.host.z + Math.sin(a) * r };
      this.chunks.push({ at, t: warning, radius, damage });
      this.events.push({ type: 'collapseWarn', at, radius, warning });
    }
  }

  private fallChunks(dt: number): void {
    for (const c of this.chunks) {
      c.t -= dt;
      if (c.t <= 0) this.events.push({ type: 'chunk', at: c.at, radius: c.radius, damage: c.damage });
    }
    this.chunks = this.chunks.filter((c) => c.t > 0);
  }

  // ------------------------------------------------------------------ geometry

  private hostYaw(h: HostView): number {
    if (h.forward) return Math.atan2(h.forward.x, h.forward.z);
    if (Math.hypot(h.vx, h.vz) > 0.5) return Math.atan2(h.vx, h.vz);
    return Math.atan2(this.body.x - h.x, this.body.z - h.z); // unknown: assume it faces us
  }
  private behind(h: HostView, d: number): Vec2 {
    const y = this.hostYaw(h);
    return { x: h.x - Math.sin(y) * d, z: h.z - Math.cos(y) * d };
  }
  /** Is the Vigil within the host's `arc`-degree blind cone behind it? */
  private fromBehind(h: HostView, arc: number): boolean {
    const a = Math.abs(wrapAngle(Math.atan2(this.body.x - h.x, this.body.z - h.z) - this.hostYaw(h) - Math.PI));
    return a <= (arc * Math.PI) / 360;
  }
  private inHostView(h: HostView): boolean { return !this.fromBehind(h, 200); }

  private limbFactor(intact: number): number {
    const l = this.t.weakPoints.limbs as { count: number; slowPerSevered: number };
    return Math.max(0.1, 1 - l.slowPerSevered * Math.max(0, l.count - intact));
  }

  private keepIn(i: VigilInput): void {
    const a = i.arena, r = a.radius * 0.9, dx = this.body.x - a.x, dz = this.body.z - a.z, d = Math.hypot(dx, dz);
    if (d > r) { this.body.x = a.x + (dx / d) * r; this.body.z = a.z + (dz / d) * r; }
  }

  private num(v: unknown, name: string): number {
    if (typeof v !== 'number') throw new Error(`bosses.json ${this.id}.${this.phase.id}: missing ${name}`);
    return v;
  }
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private cancel(): void { this.action = 'move'; this.actionTime = 0; this.strike = null; this.lureStill = 0; }
  private moveTo(x: number, z: number, speed: number, turn: number, dt: number): void {
    const dx = x - this.body.x, dz = z - this.body.z, d = Math.hypot(dx, dz);
    this.face(Math.atan2(dx, dz), turn, dt);
    const sp = d > 0.4 ? Math.min(speed, d * 3) : 0;
    this.steer((dx / (d || 1)) * sp, (dz / (d || 1)) * sp, 4, dt);
    this.integrate(dt);
  }
  private face(yaw: number, rate: number, dt: number): number {
    const d = wrapAngle(yaw - this.body.yaw), s = Math.max(-rate * dt, Math.min(rate * dt, d));
    this.body.yaw = wrapAngle(this.body.yaw + s);
    return d - s;
  }
  private steer(vx: number, vz: number, k: number, dt: number): void {
    const f = Math.exp(-k * dt);
    this.body.vx = vx + (this.body.vx - vx) * f;
    this.body.vz = vz + (this.body.vz - vz) * f;
  }
  private slow(dt: number): void { this.steer(0, 0, 4, dt); this.integrate(dt); }
  private integrate(dt: number): void { this.body.x += this.body.vx * dt; this.body.z += this.body.vz * dt; }
}
