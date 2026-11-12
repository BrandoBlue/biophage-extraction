/**
 * Herd (Bristleback): armoured grazers that ignore hosts until one shoots near the herd or hurts one of them. Then the
 * alarm runs through the herd (every Bristleback within `stampede.herdAlertRadius`) and they stampede together, a
 * heavy charge through where the host stands that tramples whatever it meets. Between charges the adults rack their
 * quills (`quillVolley.windup`, the tell) and loose a fan of them at the host. The front plating is the Abomination's
 * `frontArmour`. Once the herd loses the host it settles back to grazing.
 */
import { AI } from '../../../data';
import { Brain } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

interface Stampede { herdAlertRadius: number; duration: number; trampleDamage: number }
interface Volley { count: number; damage: number; range: number; cooldown: number; windup: number }

export class HerdBrain extends Brain {
  protected readonly turnRate = AI.herd.turnRate;
  protected readonly flees = false;
  private readonly st = (this.data.stampede as Stampede | undefined) ?? { herdAlertRadius: 40, duration: 6, trampleDamage: 35 };
  private readonly vo = this.data.quillVolley as Volley | undefined;
  private readonly temper = (this.data.temperament as { passiveUntilDamaged?: boolean; alarmedByGunfireWithin?: number } | undefined) ?? {};
  /** Alarmed: it hunts. Not alarmed, it grazes whatever it sees. */
  alarmed = false;
  private volleyCd = 0;
  private trampled = false;
  private heading = { x: 0, z: 1 };
  private called = false;

  /** Another of the herd raised the alarm. */
  alert(at: { x: number; z: number } | null = null): void { this.alarmed = true; super.alert(at); }

  protected onHurt(): void { this.raise(); }

  private raise(): void {
    if (!this.called) this.events.push({ type: 'alarm', radius: this.st.herdAlertRadius });
    this.called = true;
    this.alarmed = true;
  }

  step(dt: number, w: BrainWorld): void {
    this.volleyCd = Math.max(0, this.volleyCd - dt);
    if (!this.alarmed && this.temper.passiveUntilDamaged !== false) {
      // Gunfire close to the herd sets it off; footsteps and the sight of a host do not.
      const near = this.temper.alarmedByGunfireWithin ?? 25;
      const shot = w.noises.some((n) => n.radius >= AI.herd.gunfireNoise && Math.hypot(n.x - this.body.x, n.z - this.body.z) <= near);
      if (shot) { this.raise(); this.alert({ x: w.host.x, z: w.host.z }); }
      else {
        this.awareness.level = 0; this.awareness.lastKnown = null;
        if (this.mode === 'hunt' || this.mode === 'investigate') { this.mode = 'calm'; this.setPhase('idle'); }
        super.step(dt, { ...w, noises: [] });
        if ((this.mode as string) === 'hunt' || (this.mode as string) === 'investigate') { this.mode = 'calm'; this.setPhase('idle'); }
        this.awareness.level = 0;
        this.action = Math.max(0, this.action - dt * 2);
        return;
      }
    }
    super.step(dt, w);
    this.action = Math.max(0, this.action - dt * 2);
    // Lost the host: the herd settles.
    if (this.mode === 'calm') { this.alarmed = false; this.called = false; }
  }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const t = this.data, H = AI.herd;
    const charge = Number(t.chargeSpeed ?? t.speed * 4);
    this.look = { x: host.x, y: host.y + 1, z: host.z };
    switch (this.phase) {
      case 'stampede': {
        // Commits to a heading through the host and barely turns: sidestep it.
        const cur = Math.atan2(this.heading.x, this.heading.z), want = this.yawTo(host.x, host.z);
        let da = want - cur; da = Math.atan2(Math.sin(da), Math.cos(da));
        const a = cur + Math.max(-H.stampedeTurn * dt, Math.min(H.stampedeTurn * dt, da));
        this.heading = { x: Math.sin(a), z: Math.cos(a) };
        this.steer(this.heading.x * charge, this.heading.z * charge, 4, dt);
        this.face(a, this.turnRate * 3, dt);
        this.excite = 1;
        if (!this.trampled && dist < t.attackRange) { this.trampled = true; this.events.push({ type: 'melee', damage: this.st.trampleDamage, knockback: H.trampleKnockback }); }
        if (this.phaseTime >= this.st.duration) { this.cooldown = t.cooldown; this.setPhase('wheel'); }
        return;
      }
      case 'wheel':
        // Winded after the run: slows, turns back toward the host.
        this.slow(dt, 2);
        this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
        if (this.phaseTime >= H.wheelTime) this.setPhase('graze');
        return;
      case 'rack': {
        const v = this.vo!;
        this.slow(dt, 6);
        this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
        this.windup = Math.min(1, this.phaseTime / v.windup);
        if (this.phaseTime >= v.windup) {
          this.events.push({ type: 'volley', target: { x: host.x + w.host.vx * H.volleyLead, y: host.y + 1, z: host.z + w.host.vz * H.volleyLead }, count: v.count, damage: v.damage, spread: H.volleySpread });
          this.action = 1;
          this.windup = 0;
          this.volleyCd = v.cooldown;
          this.setPhase('graze');
        }
        return;
      }
    }
    // Between charges: keeps its armoured front to the host and shuffles to charge distance.
    this.setPhase('graze');
    this.windup = Math.max(0, this.windup - dt * 2);
    this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
    const [near, far] = H.chargeRange;
    if (dist < near) this.moveToward(this.body.x - dx * 4, this.body.z - dz * 4, t.speed, 2, dt);
    else if (dist > far) this.moveToward(host.x, host.z, t.speed * 1.5, 2, dt);
    else this.slow(dt, 2);
    if (this.vo && this.volleyCd === 0 && dist <= this.vo.range && dist >= H.volleyMin) { this.setPhase('rack'); return; }
    if (this.cooldown === 0 && dist >= near && dist <= far) {
      this.heading = { x: dx, z: dz };
      this.trampled = false;
      this.events.push({ type: 'charge' });
      this.setPhase('stampede');
    }
  }
}
