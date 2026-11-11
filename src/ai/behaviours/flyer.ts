/**
 * Flyer (Oculimoth): a scout swarm. Each eye orbits the host on its own ring and height, peeling off one at a time
 * (shared dive cooldown) to peck at your face. The real threat is the screech: every few seconds one that can see you
 * hangs still, its iris blows wide (wind-up), and it shrieks, waking everything within 35 m. Shoot the screamer.
 */
import { AI, type Range } from '../../../data';
import { Brain } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

const FACE = AI.flyer.faceHeight;

export class FlyerBrain extends Brain {
  protected readonly turnRate = AI.flyer.turnRate;
  private theta = this.rand() * Math.PI * 2;
  private orbitDir = this.rand() < 0.5 ? -1 : 1;
  private ring = AI.flyer.orbitRadius[0] + this.rand() * (AI.flyer.orbitRadius[1] - AI.flyer.orbitRadius[0]);
  private cruise = AI.flyer.calmHeight[0] + this.rand() * (AI.flyer.calmHeight[1] - AI.flyer.calmHeight[0]);
  private screechCd = 2 + this.rand() * 4;
  private pecked = false;
  private readonly band = (this.data.flightHeight as Range | undefined) ?? [2, 10];

  protected cruiseAltitude(): number { return this.roost ?? this.cruise; }

  step(dt: number, w: BrainWorld): void {
    this.screechCd = Math.max(0, this.screechCd - dt);
    super.step(dt, w);
  }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const F = AI.flyer, t = this.data;
    const scr = (t.screech as { radius: number; cooldown: number } | undefined) ?? { radius: 35, cooldown: 8 };
    this.look = { x: host.x, y: host.y + FACE, z: host.z };
    this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
    const lift = (target: number, k: number) => { this.body.altitude += (target - this.body.altitude) * Math.min(1, dt * k); };

    switch (this.phase) {
      case 'screech':
        this.slow(dt, 6);
        lift(Math.max(this.band[0] + 2, this.body.altitude), 2);
        this.windup = Math.min(1, this.phaseTime / F.screechTell);
        if (this.phaseTime >= F.screechTell) {
          this.events.push({ type: 'screech', radius: scr.radius });
          this.screechCd = scr.cooldown;
          this.windup = 0;
          this.setPhase('orbit');
        }
        return;
      case 'tell':
        this.slow(dt, 8);
        this.windup = Math.min(1, this.phaseTime / t.windup);
        if (this.phaseTime >= t.windup) { this.pecked = false; this.setPhase('dive'); }
        return;
      case 'dive': {
        const tx = host.x - this.body.x, tz = host.z - this.body.z, tl = Math.hypot(tx, tz) || 1;
        this.steer((tx / tl) * F.diveSpeed, (tz / tl) * F.diveSpeed, 12, dt);
        lift(FACE, 8);
        this.strike = this.look;
        const d3 = Math.hypot(dist, this.body.altitude - FACE);
        if (!this.pecked && d3 < t.attackRange + 0.4) { this.pecked = true; this.events.push({ type: 'melee', damage: t.damage, knockback: 0 }); }
        if (this.pecked || this.phaseTime >= F.diveTime) { this.windup = 0; this.strike = null; this.cooldown = t.cooldown; this.setPhase('climb'); }
        return;
      }
      case 'climb':
        this.steer(-dx * t.speed * 0.8, -dz * t.speed * 0.8, 5, dt);
        lift(this.band[1] * 0.7, 3);
        if (this.phaseTime >= F.climbTime) this.setPhase('orbit');
        return;
    }

    this.setPhase('orbit');
    this.windup = Math.max(0, this.windup - dt * 4);
    this.theta += (dt * F.orbitSpeed * this.orbitDir) / Math.max(2, this.ring);
    const px = host.x + Math.sin(this.theta) * this.ring, pz = host.z + Math.cos(this.theta) * this.ring;
    const ox = px - this.body.x, oz = pz - this.body.z, ol = Math.hypot(ox, oz) || 1;
    const sp = Math.min(t.speed, ol * 3);
    this.steer((ox / ol) * sp, (oz / ol) * sp, 4, dt);
    const mid = (this.band[0] + this.band[1]) / 2, amp = (this.band[1] - this.band[0]) / 2;
    lift(mid + Math.sin(this.theta * 1.7 + this.id) * amp * 0.8, 2);

    const spotted = this.awareness.sinceSeen < 0.3;
    if (spotted && this.screechCd === 0 && w.tokens.sharedReady('screech', scr.cooldown)) {
      w.tokens.useShared('screech');
      this.setPhase('screech');
      return;
    }
    if (this.cooldown === 0 && dist < this.ring + 4 && w.tokens.sharedReady('dive', AI.flyer.diveGap)) {
      w.tokens.useShared('dive');
      this.setPhase('tell');
    }
  }

  protected onInterrupted(): void {
    super.onInterrupted();
    if (this.phase !== 'orbit') this.setPhase('climb');
  }
}
