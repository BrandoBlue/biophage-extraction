/**
 * Grazer (Lumen Grazer): a huge, gentle thing that drifts high over the island, grazing on light. It ignores hosts
 * entirely until one hurts it. Then it panics: it climbs, hangs over the one who shot it while its lantern glands
 * flare (a long, readable tell), and dives on them, a crushing slam where it lands. After `panicDives` dives, or
 * `calmAfter` seconds without being hurt, it calms and drifts away again.
 */
import { AI, type Range } from '../../../data';
import { Brain } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

export class GrazerBrain extends Brain {
  protected readonly turnRate = AI.grazer.turnRate;
  protected readonly flees = false;
  private readonly band = (this.data.flightHeight as Range | undefined) ?? [25, 60];
  private readonly temper = (this.data.temperament as { panicDives: number; calmAfter: number } | undefined) ?? { panicDives: 3, calmAfter: 30 };
  /** Seconds of panic left, and dives left in it. */
  panicFor = 0;
  private dives = 0;
  private slammed = false;

  protected cruiseAltitude(): number { return this.roost ?? AI.grazer.idleHeight; }
  get panicking(): boolean { return this.panicFor > 0; }

  private markHurt = false;

  protected onHurt(): void {
    this.markHurt = true;
    if (this.panicFor <= 0) this.dives = this.temper.panicDives;
    this.panicFor = this.temper.calmAfter;
  }

  step(dt: number, w: BrainWorld): void {
    // Passive until hurt: it never notices hosts or noise on its own.
    const passive = this.panicFor <= 0;
    if (passive) this.forget();
    this.panicFor = Math.max(0, this.panicFor - dt);
    if (this.panicFor > 0 && this.mode === 'calm') this.alert(null);
    super.step(dt, passive ? { ...w, noises: [] } : w);
    if (passive && this.panicFor <= 0) this.forget();
    // Learning: the herd remembers where a host hurt one of them, and keeps away from there for the rest of the raid.
    if (this.markHurt && w.host.alive) { this.markHurt = false; this.memory?.mark(this.kind, 'hurt', w.host); }
    if (passive) {
      for (const s of this.memory?.spots(this.kind, 'hurt') ?? []) {
        const ax = this.body.x - s.x, az = this.body.z - s.z, d = Math.hypot(ax, az);
        if (d < AI.learning.avoidRadius && d > 1e-3) { this.steer((ax / d) * this.data.speed, (az / d) * this.data.speed, 3, dt); this.setPhase('avoid'); break; }
      }
    }
  }

  private forget(): void {
    this.awareness.level = 0; this.awareness.lastKnown = null;
    if (this.mode === 'hunt' || this.mode === 'investigate') { this.mode = 'calm'; this.setPhase('idle'); }
  }

  protected hunt(dt: number, _w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const G = AI.grazer, t = this.data;
    const lift = (y: number, k: number) => { this.body.altitude += (y - this.body.altitude) * Math.min(1, dt * k); };
    this.look = { x: host.x, y: host.y, z: host.z };
    if (this.dives <= 0 && this.phase !== 'dive' && this.phase !== 'climb') {
      // Spent: drift up and away until the panic wears off.
      this.windup = Math.max(0, this.windup - dt);
      lift(this.band[1] * 0.8, 0.6);
      this.steer(-dx * t.speed, -dz * t.speed, 1, dt);
      this.setPhase('flee');
      return;
    }
    switch (this.phase) {
      case 'tell':
        // Hangs over the host while the glands flare: the cue to run.
        this.windup = Math.min(1, this.phaseTime / t.windup);
        this.moveToward(host.x, host.z, t.speed * 0.6, 2, dt);
        lift(G.diveFrom, 1.5);
        if (this.phaseTime >= t.windup) { this.slammed = false; this.strike = { x: host.x, y: host.y, z: host.z }; this.setPhase('dive'); }
        return;
      case 'dive': {
        const s = this.strike ?? host;
        const tx = s.x - this.body.x, tz = s.z - this.body.z, tl = Math.hypot(tx, tz) || 1;
        this.steer((tx / tl) * Math.min(G.diveSpeed, tl * 4), (tz / tl) * Math.min(G.diveSpeed, tl * 4), 6, dt);
        this.body.altitude = Math.max(G.slamHeight, this.body.altitude - G.diveSpeed * dt);
        if (!this.slammed && this.body.altitude <= G.slamHeight + 0.01) {
          this.slammed = true;
          this.dives--;
          this.events.push({ type: 'slam', radius: t.attackRange, damage: t.damage, knockback: G.knockback });
          this.windup = 0; this.strike = null; this.cooldown = t.cooldown;
          this.setPhase('climb');
        }
        if (this.phaseTime > G.diveTimeout) this.setPhase('climb');
        return;
      }
      case 'climb':
        lift(this.band[0] + 10, 1.2);
        this.slow(dt, 1);
        if (this.phaseTime >= G.climbTime) this.setPhase('circle');
        return;
    }
    this.setPhase('circle');
    lift((this.band[0] + this.band[1]) / 2, 0.8);
    this.moveToward(host.x, host.z, t.speed, 1.5, dt);
    if (this.cooldown === 0 && dist < G.tellRange) this.setPhase('tell');
  }
}
