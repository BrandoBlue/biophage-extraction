/**
 * Spitter (Bile Cantor): artillery. Hovers at its preferred range, drifting sideways so you cannot simply stand and
 * trade; backs off if you close in. Its song pustules swell through a long wind-up, then it lobs bile where you are
 * going (leadTarget). Two spitters at most fire in the same window so the sky never fills with bile. As it winds up
 * it sings its allies (ai.json teamwork.calls: Needlemaws) onto where it is aiming.
 */
import { AI, type Range } from '../../../data';
import { Brain } from '../brain';
import type { TokenKind } from '../tokens';
import type { BrainWorld, Vec3 } from '../types';

export class SpitterBrain extends Brain {
  protected readonly turnRate = AI.spitter.turnRate;
  protected readonly tokenKind: TokenKind = 'ranged';
  private strafe = this.rand() < 0.5 ? -1 : 1;
  private bob = this.rand() * 10;
  private readonly hover = (this.data.hoverHeight as Range | undefined) ?? [3, 6];

  protected cruiseAltitude(): number { return (this.hover[0] + this.hover[1]) / 2; }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const P = AI.spitter, t = this.data;
    const [near, far] = (t.preferredRange as Range | undefined) ?? [18, 35];
    this.bob += dt;
    this.body.altitude = this.cruiseAltitude() + Math.sin(this.bob * 0.9) * P.hoverBob * (this.hover[1] - this.hover[0]) * 0.5;
    this.look = { x: host.x, y: host.y + 1, z: host.z };
    this.face(this.yawTo(host.x, host.z), this.turnRate, dt);

    if (this.phase === 'windup') {
      this.windup = Math.min(1, this.phaseTime / t.windup);
      this.slow(dt, 3);
      if (this.phaseTime >= t.windup) {
        const proj = (t.projectile as { speed: number; leadTarget: number } | undefined) ?? { speed: 22, leadTarget: 0.5 };
        const T = Math.max(0.4, dist / (proj.speed * 0.8));
        const target = { x: host.x + w.host.vx * T * proj.leadTarget, y: host.y + 0.9, z: host.z + w.host.vz * T * proj.leadTarget };
        this.events.push({ type: 'spit', target });
        this.cooldown = t.cooldown;
        this.releaseToken(w);
        this.setPhase('recover');
      }
      return;
    }
    this.windup = Math.max(0, this.windup - dt * 3);
    if (this.phase === 'recover' && this.phaseTime < P.recoverTime) { this.slow(dt, 2); return; }
    this.setPhase('range');

    let mx = 0, mz = 0;
    if (dist > far) { mx = dx; mz = dz; } else if (dist < near) { mx = -dx; mz = -dz; }
    const back = dist < P.retreatBelow ? 1.6 : 1;
    mx = mx * back - dz * P.strafeAmount * this.strafe;
    mz = mz * back + dx * P.strafeAmount * this.strafe;
    if (this.rand() < dt * P.strafeFlipChance) this.strafe *= -1;
    const ml = Math.hypot(mx, mz) || 1;
    this.steer((mx / ml) * t.speed * Math.min(back, 1.4), (mz / ml) * t.speed * Math.min(back, 1.4), 2, dt);

    if (dist < t.attackRange && this.cooldown === 0 && this.requestToken(w)) {
      // Its choir rises as it charges, and sings the Needlemaws onto where it is aiming.
      this.rally(host);
      this.setPhase('windup');
    }
  }
}
