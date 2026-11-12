/**
 * Wader (Mistwader): a four-storey giant that combs the fen for food and ignores hosts, their footsteps and their
 * gunfire. Hurt it, or walk under its feet, and it panics: it wades after whoever did it, rears back through a long,
 * readable wind-up and stamps, a crushing ring of water around its forefeet. After `temperament.panicStomps` stamps,
 * or `temperament.calmAfter` s without being hurt, it calms and wades off to comb the water again. A host that only
 * strays underfoot gets one warning stamp.
 */
import { AI } from '../../../data';
import { Brain } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

interface Stomp { radius: number; damage: number; knockback: number }
interface Temper { panicStomps: number; calmAfter: number }

export class WaderBrain extends Brain {
  protected readonly turnRate = AI.wader.turnRate;
  protected readonly flees = false;
  private readonly st = (this.data.stomp as Stomp | undefined) ?? { radius: this.data.attackRange, damage: this.data.damage, knockback: 10 };
  private readonly temper = (this.data.temperament as Temper | undefined) ?? { panicStomps: 3, calmAfter: 40 };
  /** Seconds of panic left, and stamps left in it. */
  panicFor = 0;
  stomps = 0;

  get panicking(): boolean { return this.panicFor > 0; }

  /** Seconds left wading away from a host it heard (learned: it was shot at once this raid). */
  private shyFor = 0;
  private shyFrom: { x: number; z: number } | null = null;

  protected onHurt(): void {
    this.memory?.note(this.kind, 'shot');
    if (this.panicFor <= 0 || this.stomps <= 0) this.stomps = this.temper.panicStomps;
    this.panicFor = this.temper.calmAfter;
  }

  step(dt: number, w: BrainWorld): void {
    this.memory = w.memory ?? null;
    const h = w.host;
    // Underfoot: a host inside its stamp ring startles it into one warning stamp.
    if (this.panicFor <= 0 && this.mode !== 'dead' && h.alive && Math.hypot(h.x - this.body.x, h.z - this.body.z) < this.st.radius * AI.wader.underfoot) {
      this.stomps = 1;
      this.panicFor = AI.wader.startleTime;
      this.alert({ x: h.x, z: h.z });
    }
    const passive = this.panicFor <= 0;
    if (passive) this.forget();
    // Shot at once this raid: whenever it hears a host it wades away, dragging the mist with it.
    if (passive && (this.memory?.count(this.kind, 'shot') ?? 0) > 0) {
      const heard = w.noises.find((n) => Math.hypot(n.x - this.body.x, n.z - this.body.z) <= n.radius + this.data.perception.hearing * 0.5);
      if (heard) { this.shyFrom = { x: heard.x, z: heard.z }; this.shyFor = AI.learning.shyDistance / Math.max(0.1, this.data.speed); }
    }
    if (passive && this.shyFor > 0 && this.shyFrom) {
      this.shyFor -= dt;
      const ax = this.body.x - this.shyFrom.x, az = this.body.z - this.shyFrom.z, al = Math.hypot(ax, az) || 1;
      super.step(dt, { ...w, noises: [] });
      this.forget();
      this.steer((ax / al) * this.data.speed, (az / al) * this.data.speed, 8, dt);
      this.setPhase('shy');
      return;
    }
    this.panicFor = Math.max(0, this.panicFor - dt);
    if (this.panicFor > 0 && this.mode === 'calm') this.alert(null);
    super.step(dt, passive ? { ...w, noises: [] } : w);
    if (passive) this.forget();
    this.action = Math.max(0, this.action - dt / AI.wader.stompShow);
  }

  private forget(): void {
    this.awareness.level = 0; this.awareness.lastKnown = null;
    if (this.mode === 'hunt' || this.mode === 'investigate') { this.mode = 'calm'; this.setPhase('idle'); this.windup = 0; this.strike = null; }
  }

  protected hunt(dt: number, _w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const t = this.data;
    this.look = { x: host.x, y: host.y, z: host.z };
    if (this.phase === 'rear') {
      // The tell: it rears back, head high, and comes down where the host stood when it began.
      this.windup = Math.min(1, this.phaseTime / t.windup);
      this.slow(dt, 2);
      this.face(this.yawTo(host.x, host.z), this.turnRate * 0.5, dt);
      if (this.phaseTime >= t.windup) {
        this.events.push({ type: 'slam', radius: this.st.radius, damage: this.st.damage, knockback: this.st.knockback });
        this.action = 1;
        this.stomps--;
        this.windup = 0; this.strike = null; this.cooldown = t.cooldown;
        this.setPhase('recover');
      }
      return;
    }
    if (this.phase === 'recover' && this.phaseTime < AI.wader.recoverTime) { this.slow(dt, 2); return; }
    if (this.stomps <= 0) {
      // Spent: it wades away from the host and settles once the panic wears off.
      this.windup = 0;
      this.steer(-dx * t.speed, -dz * t.speed, 0.6, dt);
      this.setPhase('settle');
      return;
    }
    this.setPhase('wade');
    this.moveToward(host.x, host.z, t.speed, 0.8, dt);
    if (this.cooldown === 0 && dist <= t.attackRange) {
      this.strike = { x: host.x, y: host.y, z: host.z };
      // The fen's hunters gather round its feet.
      this.rally({ x: this.body.x, z: this.body.z });
      this.setPhase('rear');
    }
  }
}
