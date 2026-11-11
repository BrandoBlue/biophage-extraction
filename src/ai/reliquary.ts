/**
 * The Reliquary (Glowmire Isle boss, docs/gdd/08-zones-and-bosses.md, data/bosses.json). Renderer-free phase logic:
 * dormancy and the zone-wide song, movement, the three phases' attacks with their tells, brood drops and the
 * collapse flood. Every number comes from bosses.json. The raid applies the events (damage, hazards, ring, cover,
 * pin, spawns); Creature's body reads the outputs (velocity, look, windup, rear, vent/birth/slam pulses).
 *
 *  stalk (100-65%)  armoured front, leg stamp, rib sweep, brood drops
 *  bloom (65-30%)   rears and opens (hearts exposed while it vents), spore vent, jumpable hymn ring, cover break
 *  collapse (<30%)  drags itself on its forelimbs: lunge, tendril grab (pin), the light pool floods outward
 */
import { BOSSES, bossPhase, type Boss, type BossPhase } from '../../data';
import { wrapAngle } from './brain';
import type { HostView, Vec2, Vec3 } from './types';

interface Atk { windup?: number; cooldown?: number; [k: string]: unknown }

export type BossEvent =
  | { type: 'wake'; songRadius: number }
  | { type: 'phase'; id: string }
  | { type: 'stamp'; at: Vec2; radius: number; damage: number }
  | { type: 'sweep'; damage: number; arc: number; range: number }
  | { type: 'brood'; spawnType: string; count: number }
  | { type: 'vent'; radius: number; damagePerSecond: number; overloadPerSecond: number; duration: number }
  | { type: 'hymn'; damage: number; speed: number; maxRadius: number; height: number }
  | { type: 'coverBreak'; reach: number }
  | { type: 'drag'; damage: number }
  | { type: 'grab'; damage: number; pin: number; freedByDamage: number }
  | { type: 'enrage' };

export interface BossInput {
  host: HostView;
  /** Remaining Biomass / max. */
  fraction: number;
  broodSacAlive: boolean;
  legsIntact: number;
  /** Arena centre (the bowl) for dormancy and the flood. */
  arena: Vec2;
}

export type BossState = 'dormant' | 'awake' | 'dead';

export class ReliquaryBrain {
  readonly t: Boss;
  state: BossState = 'dormant';
  phase: BossPhase;
  /** Current action: 'move' or an attack id. */
  action = 'move';
  actionTime = 0;
  readonly body = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0 };
  // Drive outputs.
  windup = 0;
  /** 0..1 how far the ribcage is open (bloom vents, collapse). */
  rear = 0;
  look: Vec3 | null = null;
  /** World point a stamp or lunge is aimed at while winding up. */
  strike: Vec3 | null = null;
  /** Light pool radius as a fraction of the arena (collapse flood; 1 when enraged). */
  pool = 0;
  enraged = false;
  readonly events: BossEvent[] = [];
  private awakeFor = 0;
  private collapseFor = 0;
  private heartsFor = 0;
  private cd = new Map<string, number>();
  private target: Vec2 = { x: 0, z: 0 };
  private hitDone = false;

  constructor(x: number, z: number, yaw = 0, readonly id = 'reliquary') {
    this.t = BOSSES[id];
    if (!this.t) throw new Error(`no boss ${id}`);
    this.phase = this.t.phases[0];
    Object.assign(this.body, { x, z, yaw });
  }

  get awake(): boolean { return this.state === 'awake'; }
  /** Hearts take damage (exposed while venting in bloom, always in collapse). */
  get heartsOpen(): boolean { return this.phase.id === 'collapse' || this.heartsFor > 0 || (this.action === 'rearAndVent' && this.windup > 0.6); }
  private attacks(): Record<string, Atk> { return this.phase.attacks as Record<string, Atk>; }
  private num(v: unknown, name: string): number {
    if (typeof v !== 'number') throw new Error(`bosses.json ${this.id}.${this.phase.id}: missing ${name}`);
    return v;
  }

  /**
   * Damage multiplier for a non-weak-point hit coming from (fromX, fromZ): the stalk-phase bone shell blocks the
   * front arc; the collapsed body takes extra.
   */
  bodyMultiplier(fromX: number, fromZ: number): number {
    const p = this.phase as BossPhase & { frontArmourMultiplier?: number; frontArmourArc?: number; bodyDamageMultiplier?: number };
    if (p.bodyDamageMultiplier) return p.bodyDamageMultiplier;
    if (p.frontArmourMultiplier !== undefined) {
      const a = Math.abs(wrapAngle(Math.atan2(fromX - this.body.x, fromZ - this.body.z) - this.body.yaw));
      if (a <= ((p.frontArmourArc ?? 120) * Math.PI) / 360) return p.frontArmourMultiplier;
    }
    return 1;
  }

  /** A wound wakes it. */
  hurt(): void { if (this.state === 'dormant') this.wake(); }
  kill(): void { this.state = 'dead'; this.windup = 0; this.strike = null; this.body.vx = this.body.vz = 0; }

  step(dt: number, i: BossInput): void {
    if (this.state === 'dead') return;
    const h = i.host, b = this.body;
    if (this.state === 'dormant') {
      if (h.alive && !h.hidden && Math.hypot(h.x - i.arena.x, h.z - i.arena.z) <= this.t.wakeRadius) this.wake();
      else return;
    }
    this.awakeFor += dt;
    this.actionTime += dt;
    this.heartsFor = Math.max(0, this.heartsFor - dt);
    for (const [k, v] of this.cd) this.cd.set(k, v - dt);

    // Phase from Biomass.
    const next = bossPhase(this.id, i.fraction);
    if (next.id !== this.phase.id) {
      this.phase = next;
      this.events.push({ type: 'phase', id: next.id });
      this.cancel();
      this.primeCooldowns();
    }
    // Collapse flood and enrage.
    if (this.phase.id === 'collapse') {
      this.collapseFor += dt;
      const f = this.attacks().lightFlood;
      if (f) this.pool = Math.max(this.pool, Math.min(1, this.collapseFor / this.num(f.overSeconds, 'lightFlood.overSeconds')) * this.num(f.poolGrowsTo, 'lightFlood.poolGrowsTo'));
    }
    if (!this.enraged && this.awakeFor >= this.t.enrage.after) { this.enraged = true; this.pool = 1; this.events.push({ type: 'enrage' }); }

    // Rear: open while venting/exposed, fully in collapse, closed otherwise.
    const wantRear = this.phase.id === 'collapse' ? 1 : this.heartsOpen ? 1 : this.action === 'rearAndVent' ? this.windup : 0;
    this.rear += (wantRear - this.rear) * Math.min(1, dt * 3);

    if (!h.alive || h.hidden) { this.cancel(); this.slow(dt); return; }
    const dx = h.x - b.x, dz = h.z - b.z, dist = Math.hypot(dx, dz) || 1e-6;
    this.look = { x: h.x, y: h.y + 1.5, z: h.z };
    const turn = this.num(this.phase.turnRate, 'turnRate');
    const speed = this.num(this.phase.speed, 'speed') * this.legFactor(i.legsIntact);

    if (this.action !== 'move') { this.runAttack(dt, i, dist, dx / dist, dz / dist, turn, speed); return; }

    this.windup = Math.max(0, this.windup - dt * 3);
    this.strike = null;
    const off = this.face(Math.atan2(dx, dz), turn, dt);
    // Close to fighting distance, plodding forward when roughly facing the host.
    const keep = this.num(this.phase.holdDistance, 'holdDistance');
    const ahead = Math.max(0, Math.cos(off));
    const sp = dist > keep ? speed * ahead : 0;
    this.steer(Math.sin(b.yaw) * sp, Math.cos(b.yaw) * sp, 2, dt);
    this.integrate(dt);
    this.choose(i, dist, Math.abs(off));
  }

  private wake(): void {
    this.state = 'awake';
    this.events.push({ type: 'wake', songRadius: this.t.songRadius });
    this.primeCooldowns();
  }

  /** Each phase starts with its brood drop on `firstDelay` and the other attacks ready. */
  private primeCooldowns(): void {
    this.cd.clear();
    const bd = this.attacks().broodDrop;
    if (bd) this.cd.set('broodDrop', this.num(bd.firstDelay, 'broodDrop.firstDelay'));
  }

  private ready(id: string): boolean { return (this.cd.get(id) ?? 0) <= 0 && !!this.attacks()[id]; }

  /** Picks the next attack, most urgent first. */
  private choose(i: BossInput, dist: number, offAngle: number): void {
    const A = this.attacks(), size = this.t.size.length / 2;
    const start = (id: string) => { this.action = id; this.actionTime = 0; this.hitDone = false; this.target = { x: i.host.x, z: i.host.z }; };
    if (this.ready('broodDrop') && i.broodSacAlive) return start('broodDrop');
    switch (this.phase.id) {
      case 'stalk': {
        const st = A.legStamp, sw = A.ribSweep;
        if (sw && this.ready('ribSweep') && dist <= this.num(sw.range, 'ribSweep.range') && offAngle <= (this.num(sw.arc, 'ribSweep.arc') * Math.PI) / 360) return start('ribSweep');
        if (st && this.ready('legStamp') && dist <= size + this.num(st.radius, 'legStamp.radius')) return start('legStamp');
        return;
      }
      case 'bloom': {
        const rv = A.rearAndVent;
        if (rv && this.ready('rearAndVent') && dist <= this.num(rv.triggerRange, 'rearAndVent.triggerRange')) return start('rearAndVent');
        const hy = A.hymn;
        if (hy && this.ready('hymn') && dist <= this.num((hy.ring as Atk).maxRadius, 'hymn.ring.maxRadius')) return start('hymn');
        const cb = A.coverBreak;
        if (cb && this.ready('coverBreak') && dist <= this.num(cb.reach, 'coverBreak.reach')) return start('coverBreak');
        return;
      }
      case 'collapse': {
        const fd = A.forelimbDrag, tg = A.tendrilGrab;
        if (tg && this.ready('tendrilGrab') && dist <= this.num(tg.range, 'tendrilGrab.range') && dist > 4) return start('tendrilGrab');
        if (fd && this.ready('forelimbDrag')) {
          const reach = this.num(fd.range, 'forelimbDrag.range') + this.num(this.phase.speed, 'speed') * this.num(fd.lungeSpeedMultiplier, 'lungeSpeedMultiplier') * this.num(fd.lungeTime, 'lungeTime');
          if (dist <= reach) return start('forelimbDrag');
        }
        return;
      }
    }
  }

  private runAttack(dt: number, i: BossInput, dist: number, dx: number, dz: number, turn: number, speed: number): void {
    const id = this.action, a = this.attacks()[id] ?? {};
    const windup = this.num(a.windup, `${id}.windup`);
    const done = (cooldown = this.num(a.cooldown, `${id}.cooldown`)) => {
      this.cd.set(id, cooldown);
      this.cancel();
    };
    const winding = this.actionTime < windup;
    this.windup = winding ? this.actionTime / windup : Math.max(0, 1 - (this.actionTime - windup) * 2);

    switch (id) {
      case 'legStamp':
        this.slow(dt);
        this.face(Math.atan2(this.target.x - this.body.x, this.target.z - this.body.z), turn, dt);
        this.strike = { x: this.target.x, y: 0, z: this.target.z };
        if (!winding) { this.events.push({ type: 'stamp', at: { ...this.target }, radius: this.num(a.radius, 'radius'), damage: this.num(a.damage, 'damage') }); done(); }
        return;
      case 'ribSweep':
        this.slow(dt);
        this.face(Math.atan2(dx, dz), turn * 0.5, dt);
        if (!winding) { this.events.push({ type: 'sweep', damage: this.num(a.damage, 'damage'), arc: this.num(a.arc, 'arc'), range: this.num(a.range, 'range') }); done(); }
        return;
      case 'broodDrop':
        this.slow(dt);
        if (!winding) {
          const s = a.spawn as { type: string; count: number };
          if (i.broodSacAlive) this.events.push({ type: 'brood', spawnType: s.type, count: s.count });
          done();
        }
        return;
      case 'rearAndVent':
        this.slow(dt);
        if (!winding && !this.hitDone) {
          this.hitDone = true;
          const c = a.sporeCloud as Atk;
          this.events.push({ type: 'vent', radius: this.num(c.radius, 'radius'), damagePerSecond: this.num(c.damagePerSecond, 'dps'), overloadPerSecond: this.num(c.overloadPerSecond, 'ops'), duration: this.num(c.duration, 'duration') });
          this.heartsFor = this.num(a.heartsExposed, 'heartsExposed');
          this.cd.set(id, this.num(a.cooldown, 'cooldown'));
        }
        // Holds the rear while the hearts are exposed: the window to burst them.
        if (this.hitDone && this.heartsFor <= 0) this.cancel();
        return;
      case 'hymn': {
        this.slow(dt);
        if (!winding) {
          const r = a.ring as Atk;
          this.events.push({ type: 'hymn', damage: this.num(r.damage, 'damage'), speed: this.num(r.speed, 'speed'), maxRadius: this.num(r.maxRadius, 'maxRadius'), height: this.num(r.height, 'height') });
          done();
        }
        return;
      }
      case 'coverBreak':
        this.face(Math.atan2(dx, dz), turn, dt);
        this.slow(dt);
        if (!winding) { this.events.push({ type: 'coverBreak', reach: this.num(a.reach, 'reach') }); done(); }
        return;
      case 'forelimbDrag': {
        const lunge = this.num(a.lungeTime, 'lungeTime');
        if (winding) { this.slow(dt); this.face(Math.atan2(dx, dz), turn, dt); this.strike = { x: i.host.x, y: i.host.y + 1, z: i.host.z }; return; }
        const v = speed * this.num(a.lungeSpeedMultiplier, 'lungeSpeedMultiplier');
        this.steer(Math.sin(this.body.yaw) * v, Math.cos(this.body.yaw) * v, 8, dt);
        this.integrate(dt);
        const fx = Math.sin(this.body.yaw), fz = Math.cos(this.body.yaw);
        if (!this.hitDone && dist <= this.num(a.range, 'range') && fx * dx + fz * dz > 0.3) {
          this.hitDone = true;
          this.events.push({ type: 'drag', damage: this.num(a.damage, 'damage') });
        }
        if (this.actionTime >= windup + lunge) done();
        return;
      }
      case 'tendrilGrab':
        this.slow(dt);
        this.face(Math.atan2(dx, dz), turn, dt);
        this.strike = { x: i.host.x, y: i.host.y + 1, z: i.host.z };
        if (!winding) {
          if (dist <= this.num(a.range, 'range')) this.events.push({ type: 'grab', damage: this.num(a.damage, 'damage'), pin: this.num(a.pin, 'pin'), freedByDamage: this.num(a.freedByDamage, 'freedByDamage') });
          done();
        }
        return;
      default:
        this.cancel();
    }
  }

  /** Each severed leg slows it (from phase 2) by `legs.slowPerSevered`. */
  private legFactor(intact: number): number {
    const legs = this.t.weakPoints.legs as { count: number; slowPerSevered: number } | undefined;
    if (!legs) return 1;
    return Math.max(0.1, 1 - legs.slowPerSevered * Math.max(0, legs.count - intact));
  }

  private cancel(): void { this.action = 'move'; this.actionTime = 0; this.strike = null; }
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
