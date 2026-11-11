/**
 * Tank (Mournback): a slow siege animal that always tries to keep its bone shield toward you (front armour takes
 * 15%). It turns slowly, so circling it works, and its dorsal vents are the weak point. At range, once lined up, it
 * paws and lowers its horns for a full second, then charges in a near-straight line: sidestep and it thunders past,
 * then stands winded with its back exposed. Get close and it rears for a ground slam that throws you.
 */
import { AI } from '../../../data';
import { Brain } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

interface Slam { radius: number; damage: number; knockback: number }

export class TankBrain extends Brain {
  protected readonly turnRate = AI.tank.turnRate;
  protected readonly flees = false;
  private travelled = 0;
  private gored = false;
  private readonly slam = (this.data.slam as Slam | undefined) ?? { radius: 5, damage: 30, knockback: 8 };

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const T = AI.tank, t = this.data;
    const deg = Math.PI / 180;
    this.look = { x: host.x, y: host.y + 1, z: host.z };

    switch (this.phase) {
      case 'chargeWindup': {
        // Still tracks you while it paws the ground: the commit happens at launch.
        this.keepToken(w);
        this.slow(dt, 6);
        this.face(this.yawTo(host.x, host.z), T.turnRate, dt);
        this.windup = Math.min(1, this.phaseTime / t.windup);
        this.strike = { x: host.x, y: host.y + 1, z: host.z };
        if (this.phaseTime >= t.windup) {
          this.travelled = 0;
          this.gored = false;
          this.events.push({ type: 'charge' });
          this.setPhase('charge');
        }
        return;
      }
      case 'charge': {
        const cs = Number(t.chargeSpeed ?? t.speed * 3);
        this.keepToken(w);
        this.face(this.yawTo(host.x, host.z), T.chargeTurnRate, dt);
        const fx = Math.sin(this.body.yaw), fz = Math.cos(this.body.yaw);
        this.steer(fx * cs, fz * cs, 5, dt);
        this.travelled += this.speed * dt;
        this.windup = Math.max(0.3, 1 - this.phaseTime);
        // Horns hit what is ahead of the shield and inside its width: a sidestep gets you out of the line.
        const along = (fx * dx + fz * dz) * dist, lateral = Math.abs(fx * dz - fz * dx) * dist;
        if (!this.gored && along > 0 && along < t.attackRange && lateral < this.radius + T.hornReach) {
          this.gored = true;
          this.events.push({ type: 'melee', damage: t.damage, knockback: T.chargeKnockback });
        }
        // Stop once it has run its course or thundered past you.
        const past = fx * dx + fz * dz < -0.2 && dist > t.attackRange * 1.5;
        if (this.travelled >= T.chargeDistance || past || this.gored && this.phaseTime > 0.4) this.winded(w);
        return;
      }
      case 'slamWindup':
        this.slow(dt, 8);
        this.face(this.yawTo(host.x, host.z), T.turnRate * 0.5, dt);
        this.windup = Math.min(1, this.phaseTime / T.slamWindup);
        this.strike = { x: this.body.x, y: 0, z: this.body.z };
        if (this.phaseTime >= T.slamWindup) {
          this.events.push({ type: 'slam', radius: this.slam.radius, damage: this.slam.damage, knockback: this.slam.knockback });
          this.winded(w);
        }
        return;
      case 'winded':
        this.slow(dt, 2.5);
        this.windup = 0;
        this.strike = null;
        if (this.phaseTime >= T.recoverTime) this.setPhase('approach');
        return;
    }

    this.setPhase('approach');
    this.windup = 0;
    const off = this.face(this.yawTo(host.x, host.z), T.turnRate, dt);
    const aligned = Math.abs(off) < T.chargeAimCone * deg;
    if (this.cooldown === 0 && dist <= T.slamTrigger) { this.setPhase('slamWindup'); return; }
    const [cmin, cmax] = T.chargeRange;
    if (this.cooldown === 0 && aligned && dist >= cmin && dist <= cmax && this.requestToken(w)) { this.setPhase('chargeWindup'); return; }
    // Plod forward when roughly facing you; otherwise swing round on the spot.
    const ahead = Math.max(0, Math.cos(off));
    const fx = Math.sin(this.body.yaw), fz = Math.cos(this.body.yaw);
    const sp = dist > T.slamTrigger * 0.8 ? t.speed * T.approachFactor * ahead * ahead : 0;
    this.steer(fx * sp, fz * sp, 2, dt);
  }

  private winded(w: BrainWorld): void {
    this.cooldown = this.data.cooldown;
    this.releaseToken(w);
    this.windup = 0;
    this.strike = null;
    this.setPhase('winded');
  }

  protected onInterrupted(): void {
    super.onInterrupted();
    if (this.phase !== 'approach') this.setPhase('winded');
  }
}
