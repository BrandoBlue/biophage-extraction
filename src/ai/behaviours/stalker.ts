/**
 * Stalker (Glasswalker): an ambusher you can feel but rarely see. It circles out to your flank and creeps in while
 * you look elsewhere; when your view swings onto it, it freezes and nearly vanishes (8% visible). Inside 25 m it
 * commits: a sprint at 11 m/s, the chest lens flaring through a half-second wind-up, a mantis strike, then it fades
 * back out to stalk again. Hits and Psych-Wave Pulse reveal it (the Abomination handles the pulse).
 */
import { AI } from '../../../data';
import { Brain, wrapAngle } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

interface Camo { visibilityIdle: number; visibilityMoving: number; revealOnHit: number }

export class StalkerBrain extends Brain {
  protected readonly turnRate = AI.stalker.turnRate;
  private side = this.rand() < 0.5 ? -1 : 1;
  private revealFor = 0;
  private struck = false;
  /** True while the host is looking straight at it. */
  watched = false;
  private readonly camo = (this.data.camouflage as Camo | undefined) ?? { visibilityIdle: 0.08, visibilityMoving: 0.35, revealOnHit: 3 };

  step(dt: number, w: BrainWorld): void {
    super.step(dt, w);
    this.revealFor = Math.max(0, this.revealFor - dt);
    const moving = this.speed > 0.3;
    let v = moving ? this.camo.visibilityMoving : this.camo.visibilityIdle;
    if (this.phase === 'windup' || this.phase === 'strike') v = Math.max(v, 0.6); // the lens flare gives it away
    if (this.revealFor > 0 || this.mode === 'dead') v = 1;
    this.visibility += (v - this.visibility) * Math.min(1, dt * 6);
  }

  protected onHurt(): void { this.revealFor = this.camo.revealOnHit; }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const S = AI.stalker, t = this.data;
    const hf = w.host.forward;
    // Angle between where the host looks and where we are.
    this.watched = !!hf && Math.abs(wrapAngle(Math.atan2(-dx, -dz) - Math.atan2(hf.x, hf.z))) < (S.freezeWhenWatched * Math.PI) / 180;
    this.look = { x: host.x, y: host.y + 1.4, z: host.z };

    switch (this.phase) {
      case 'charge': {
        this.keepToken(w);
        this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
        const cs = Number(t.chargeSpeed ?? t.speed * 3);
        this.steer(dx * cs, dz * cs, 6, dt);
        if (dist < t.attackRange * 1.3) { this.struck = false; this.setPhase('windup'); }
        else if (this.phaseTime > S.chargeTime) this.fade(w);
        return;
      }
      case 'windup':
        this.keepToken(w);
        this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
        this.steer(dx * t.speed, dz * t.speed, 4, dt); // keeps crowding you while it coils
        this.windup = Math.min(1, this.phaseTime / t.windup);
        this.strike = { x: host.x, y: host.y + 1.2, z: host.z };
        if (this.phaseTime >= t.windup) this.setPhase('strike');
        return;
      case 'strike':
        this.windup = Math.max(0, 1 - this.phaseTime / S.strikeRecover);
        this.slow(dt, 6);
        if (!this.struck) {
          this.struck = true;
          if (dist < t.attackRange * 1.4) this.events.push({ type: 'melee', damage: t.damage, knockback: 0 });
        }
        if (this.phaseTime >= S.strikeRecover) { this.cooldown = t.cooldown; this.fade(w); }
        return;
      case 'fade':
        this.windup = 0; this.strike = null;
        if (dist < S.fadeDistance && this.phaseTime < S.fadeTime) {
          // Peel away sideways and back, out of the light.
          const ax = -dx + -dz * this.side * 0.8, az = -dz + dx * this.side * 0.8, al = Math.hypot(ax, az) || 1;
          this.face(Math.atan2(ax, az), this.turnRate, dt);
          this.steer((ax / al) * Number(t.chargeSpeed ?? 8) * 0.6, (az / al) * Number(t.chargeSpeed ?? 8) * 0.6, 4, dt);
          return;
        }
        this.side = this.rand() < 0.5 ? -1 : 1;
        this.setPhase('stalk');
        return;
    }

    // Stalk: work round to the host's flank, freeze when watched, commit when close and holding a token.
    this.setPhase('stalk');
    this.windup = 0;
    if (this.watched && dist > t.attackRange * 3) { this.slow(dt, 8); this.face(this.yawTo(host.x, host.z), 1, dt); return; }
    if (dist <= S.stalkRange && this.cooldown === 0 && (!this.watched || dist < 8) && this.requestToken(w)) {
      this.events.push({ type: 'charge' });
      this.setPhase('charge');
      return;
    }
    const base = hf ? Math.atan2(-hf.x, -hf.z) : Math.atan2(-dx, -dz);
    const flank = wrapAngle(base + this.side * (Math.PI - (S.flankAngle * Math.PI) / 180));
    const r = Math.max(S.stalkRange * 0.85, dist - 6);
    const tx = host.x + Math.sin(flank) * r, tz = host.z + Math.cos(flank) * r;
    this.moveToward(tx, tz, t.speed * S.stalkSpeedFactor, 3, dt);
  }

  private fade(w: BrainWorld): void {
    this.releaseToken(w);
    this.strike = null;
    this.windup = 0;
    this.setPhase('fade');
  }

  protected onInterrupted(): void {
    super.onInterrupted();
    if (this.phase === 'charge' || this.phase === 'windup' || this.phase === 'strike') this.setPhase('fade');
  }
}
