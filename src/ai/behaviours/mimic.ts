/**
 * Mimic (Husk Mimic): wears the shape of a rival host. Until it is close it acts like one: it walks up at a host's
 * pace, straight and unhurried, never circling, never winding up. Inside its reveal distance (or the moment it is
 * shot) the disguise splits: a short shriek-and-rear tell, then a lunge, and from then on it hunts like the animal it
 * is, closing at full speed and lunging whenever it is in reach.
 */
import { AI } from '../../../data';
import { Brain } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

export class MimicBrain extends Brain {
  protected readonly turnRate = AI.mimic.turnRate;
  protected readonly flees = false;
  /** Still wearing the host's shape. */
  masked = true;
  private lungeHit = false;

  protected onHurt(): void { if (this.masked) this.drop(); }

  private drop(): void {
    this.masked = false;
    this.unmask('disguise');
    this.setPhase('unmask');
  }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const M = AI.mimic, t = this.data;
    const reveal = Number((t.disguise as { revealDistance?: number } | undefined)?.revealDistance ?? 8);
    this.look = { x: host.x, y: host.y + 1.6, z: host.z };
    if (this.masked) {
      // Acting: walks up like a host would, no tells at all.
      this.windup = 0;
      this.moveToward(host.x - dx * 1.5, host.z - dz * 1.5, t.speed * M.walkFactor, 3, dt);
      this.setPhase('act');
      if (dist <= reveal) this.drop();
      return;
    }
    switch (this.phase) {
      case 'unmask':
        // The disguise splits: it rears and shrieks (drive.windup / screech), then comes.
        this.slow(dt, 8);
        this.face(this.yawTo(host.x, host.z), this.turnRate * 2, dt);
        this.windup = Math.min(1, this.phaseTime / M.unmaskTell);
        if (this.phaseTime >= M.unmaskTell) { this.events.push({ type: 'screech', radius: 0 }); this.startLunge(w, host, dist); }
        return;
      case 'windup':
        this.keepToken(w);
        this.slow(dt, 10);
        this.face(this.yawTo(host.x, host.z), this.turnRate * 2, dt);
        this.windup = Math.min(1, this.phaseTime / t.windup);
        this.strike = this.look;
        if (this.phaseTime >= t.windup) this.startLunge(w, host, dist);
        return;
      case 'lunge':
        this.keepToken(w);
        this.windup = Math.max(0, 1 - this.phaseTime / M.lungeTime);
        if (!this.lungeHit && dist < t.attackRange) { this.lungeHit = true; this.events.push({ type: 'melee', damage: t.damage, knockback: M.knockback }); }
        if (this.phaseTime >= M.lungeTime) { this.cooldown = t.cooldown; this.releaseToken(w); this.strike = null; this.setPhase('recover'); }
        return;
      case 'recover':
        this.windup = 0;
        this.slow(dt, 6);
        if (this.phaseTime >= M.recoverTime) this.setPhase('chase');
        return;
    }
    this.setPhase('chase');
    this.windup = Math.max(0, this.windup - dt * 3);
    this.moveToward(host.x, host.z, t.speed, 5, dt);
    if (dist <= t.attackRange + 1.5 && this.cooldown === 0 && this.requestToken(w)) this.setPhase('windup');
  }

  private startLunge(w: BrainWorld, host: Vec3, dist: number): void {
    const v = Number(this.data.lungeSpeed ?? this.data.speed * 2);
    const lead = Math.min(0.25, dist / v);
    const tx = host.x + w.host.vx * lead - this.body.x, tz = host.z + w.host.vz * lead - this.body.z, tl = Math.hypot(tx, tz) || 1;
    this.body.vx = (tx / tl) * v; this.body.vz = (tz / tl) * v;
    this.lungeHit = false;
    this.setPhase('lunge');
  }
}
