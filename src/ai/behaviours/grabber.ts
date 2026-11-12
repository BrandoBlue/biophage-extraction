/**
 * Grabber (Veilwing): a torn sail of membrane gliding the pit's updrafts. It wants to take you up and let you fall
 * (`mind.wants`). It soars high and wide over the host, and when it commits it goes silent first (`hush`: the body
 * freezes), then spreads its skirt of tentacles over the host (the wind-up), folds and drops. A hit takes the host:
 * it climbs at `grab.liftSpeed` toward the open shaft (`BrainWorld.dropZone`) for `grab.carryTime` s and lets go.
 * Hurting it for `grab.freedByDamage` while it carries frees the host early. A dive that misses climbs away.
 */
import { AI, type Range } from '../../../data';
import { Brain } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

interface Grab { carryTime: number; liftSpeed: number; freedByDamage: number; dropsOverEdge: boolean }

export class GrabberBrain extends Brain {
  protected readonly turnRate = AI.grabber.turnRate;
  protected readonly flees = false;
  private readonly band = (this.data.flightHeight as Range | undefined) ?? [6, 40];
  private readonly grab = (this.data.grab as Grab | undefined) ?? { carryTime: 2.5, liftSpeed: 6, freedByDamage: 60, dropsOverEdge: true };
  private theta = this.rand() * Math.PI * 2;
  private carryFor = 0;
  private carryHurt = 0;
  /** Holding the host: the raid moves the host with it, and the Abomination holds its height above the host. */
  carrying = false;

  protected cruiseAltitude(): number { return this.roost ?? this.band[0] + (this.band[1] - this.band[0]) * 0.5; }
  get frozen(): boolean { return this.phase === 'hush'; }

  protected onHurt(amount = 0): void {
    if (!this.carrying) return;
    this.carryHurt += amount;
    if (this.carryHurt >= this.grab.freedByDamage) this.letGo();
  }

  kill(): void {
    if (this.carrying) this.letGo();
    super.kill();
  }

  private letGo(): void {
    this.carrying = false;
    this.events.push({ type: 'release' });
    this.cooldown = this.data.cooldown;
    this.setPhase('climb');
  }

  protected onInterrupted(): void {
    super.onInterrupted();
    if (this.carrying) this.letGo();
  }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number): void {
    const G = AI.grabber, t = this.data;
    const lift = (y: number, k: number) => { this.body.altitude += (y - this.body.altitude) * Math.min(1, dt * k); };
    this.look = { x: host.x, y: host.y + 1, z: host.z };
    switch (this.phase) {
      case 'hush':
        // Silence above you: it stops dead in the air.
        this.slow(dt, 4);
        this.windup = 0;
        if (this.phaseTime >= G.hushTime) this.setPhase('tell');
        return;
      case 'tell':
        // The skirt spreads over the host as it sinks to drop height.
        this.keepToken(w);
        this.windup = Math.min(1, this.phaseTime / t.windup);
        this.moveToward(host.x, host.z, t.speed * 0.8, 3, dt);
        lift(G.dropFrom, 1.5);
        if (this.phaseTime >= t.windup) { this.strike = { x: host.x, y: host.y + 1, z: host.z }; this.setPhase('drop'); }
        return;
      case 'drop': {
        // Folds and drops, steering onto the host.
        this.keepToken(w);
        this.windup = 1;
        this.moveToward(host.x, host.z, G.dropSpeed, 8, dt);
        this.body.altitude = Math.max(G.grabHeight, this.body.altitude - G.dropSpeed * dt);
        if (dist < t.attackRange && this.body.altitude <= G.grabHeight + 0.6 && w.host.alive) {
          this.carrying = true; this.carryFor = this.grab.carryTime; this.carryHurt = 0;
          this.windup = 0; this.strike = null; this.action = 1;
          this.events.push({ type: 'grab', damage: t.damage });
          this.setPhase('carry');
        } else if (this.phaseTime > G.dropTimeout) { this.windup = 0; this.strike = null; this.cooldown = t.cooldown * 0.5; this.releaseToken(w); this.setPhase('climb'); }
        return;
      }
      case 'carry': {
        // Up and out over the drop; then it lets go.
        this.keepToken(w);
        this.action = 1;
        const z = this.grab.dropsOverEdge ? w.dropZone : undefined;
        if (z) this.moveToward(z.x, z.z, t.speed, 2, dt); else this.slow(dt, 2);
        this.carryFor -= dt;
        if (this.carryFor <= 0 || !w.host.alive) { this.releaseToken(w); this.letGo(); }
        return;
      }
      case 'climb':
        this.action = Math.max(0, this.action - dt * 2);
        lift(this.band[1] * 0.7, 1);
        this.slow(dt, 1);
        if (this.phaseTime >= G.climbTime) this.setPhase('soar');
        return;
    }
    // Soaring wide over the host, silent, waiting for it to stand in the open.
    this.setPhase('soar');
    this.windup = 0;
    this.theta += dt * G.soarRate;
    const r = G.soarRadius;
    this.moveToward(host.x + Math.cos(this.theta) * r, host.z + Math.sin(this.theta) * r, t.speed, 1.5, dt);
    lift(this.band[0] + (this.band[1] - this.band[0]) * 0.5, 0.8);
    if (this.cooldown === 0 && dist < G.commitRange && w.host.alive && this.requestToken(w)) this.setPhase('hush');
  }
}
