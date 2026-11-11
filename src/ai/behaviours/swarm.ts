/**
 * Swarm (Needlemaw): a pack that surrounds you. Each member owns a flank slot biased toward your back. Two at a time
 * (attack tokens) weave in, coil and lunge; the rest circle at 5 to 7 m, skittering and faking short darts so the
 * whole ring feels alive. Kill the one coiling (its throat sac swells) and the next steps up.
 */
import { AI } from '../../../data';
import { Brain, wrapAngle } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

export class SwarmBrain extends Brain {
  protected readonly turnRate = AI.swarm.turnRate;
  protected readonly dodges = true;
  protected readonly ambusher = true;
  private slot = (this.rand() * 2 - 1) * Math.PI * AI.swarm.flankBias;
  private ring = AI.swarm.ringRadius[0] + this.rand() * (AI.swarm.ringRadius[1] - AI.swarm.ringRadius[0]);
  private orbitDir = this.rand() < 0.5 ? -1 : 1;
  private lungeHit = false;
  private feintFor = 0;

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const S = AI.swarm, t = this.data;
    this.look = { x: host.x, y: host.y + 1.2, z: host.z };
    switch (this.phase) {
      case 'windup': {
        this.keepToken(w);
        this.slow(dt, 10);
        this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
        this.windup = Math.min(1, this.phaseTime / t.windup);
        this.strike = this.look;
        if (this.phaseTime >= t.windup) {
          const lunge = Number(t.lungeSpeed ?? t.speed * 2);
          // Lead the host a little: the lunge goes where you are going.
          const lead = Math.min(0.25, dist / lunge);
          const tx = host.x + w.host.vx * lead - this.body.x, tz = host.z + w.host.vz * lead - this.body.z;
          const tl = Math.hypot(tx, tz) || 1;
          this.body.vx = (tx / tl) * lunge; this.body.vz = (tz / tl) * lunge;
          this.lungeHit = false;
          this.setPhase('lunge');
        }
        return;
      }
      case 'lunge':
        this.keepToken(w);
        this.windup = Math.max(0, 1 - this.phaseTime / S.lungeTime);
        if (!this.lungeHit && dist < t.attackRange * 0.75) {
          this.lungeHit = true;
          this.events.push({ type: 'melee', damage: t.damage, knockback: 0 });
        }
        if (this.phaseTime >= S.lungeTime) {
          this.cooldown = t.cooldown;
          this.releaseToken(w);
          this.strike = null;
          this.setPhase('recover');
        }
        return;
      case 'recover':
        this.windup = 0;
        // Skitter back out to the ring after a bite.
        this.steer(-dx * t.speed * 0.7, -dz * t.speed * 0.7, 6, dt);
        this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
        if (this.phaseTime >= S.recoverTime) this.setPhase('ring');
        return;
    }

    // Attacker: weave straight in.
    // (A token that expired mid-approach goes back to the pool: this one rejoins the ring.)
    const attacking = this.phase === 'approach'
      ? w.tokens.holds(this.id) && this.phaseTime < AI.tokens.holdTime
      : this.cooldown === 0 && this.requestToken(w);
    if (this.phase === 'approach' && !attacking) { this.releaseToken(w); this.cooldown = t.cooldown * 0.5; }
    if (attacking) this.keepToken(w);
    if (attacking) {
      this.setPhase('approach');
      const weave = Math.sin(this.phaseTime * S.weaveFrequency + this.id) * S.weaveAmount * Math.min(1, dist / 8);
      const ax = dx - dz * weave, az = dz + dx * weave, al = Math.hypot(ax, az) || 1;
      this.face(Math.atan2(ax, az), this.turnRate, dt);
      this.steer((ax / al) * t.speed, (az / al) * t.speed, 7, dt);
      if (dist < t.attackRange * 1.8) this.setPhase('windup');
      return;
    }

    // Ring: hold a flank slot (behind the host's view when we know it), circle, feint.
    this.setPhase('ring');
    this.windup = Math.max(0, this.windup - dt * 4);
    const hf = w.host.forward;
    const base = hf ? Math.atan2(-hf.x, -hf.z) : Math.atan2(-dx, -dz);
    const slotYaw = wrapAngle(base + this.slot + Math.sin(this.phaseTime * 0.6 + this.id) * 0.35 * this.orbitDir);
    const px = host.x + Math.sin(slotYaw) * this.ring, pz = host.z + Math.cos(slotYaw) * this.ring;
    if (this.feintFor > 0) {
      // Dart in a couple of metres with a flicker of wind-up, then peel off.
      this.feintFor -= dt;
      this.windup = 0.5;
      this.steer(dx * t.speed * 1.2, dz * t.speed * 1.2, 9, dt);
    } else {
      const ox = px - this.body.x, oz = pz - this.body.z, ol = Math.hypot(ox, oz);
      const sp = Math.min(t.speed, ol * 2.5);
      this.steer(ol > 0.01 ? (ox / ol) * sp : 0, ol > 0.01 ? (oz / ol) * sp : 0, 5, dt);
      if (this.rand() < dt * S.feintChance && dist < this.ring + 1.5) this.feintFor = 0.3;
    }
    this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
  }

  protected onInterrupted(): void {
    super.onInterrupted();
    if (this.phase === 'windup' || this.phase === 'lunge') this.setPhase('recover');
  }
}
