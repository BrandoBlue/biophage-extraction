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

  protected onHurt(): void {
    if (this.panicFor <= 0 || this.stomps <= 0) this.stomps = this.temper.panicStomps;
    this.panicFor = this.temper.calmAfter;
  }

  step(dt: number, w: BrainWorld): void {
    const h = w.host;
    // Underfoot: a host inside its stamp ring startles it into one warning stamp.
    if (this.panicFor <= 0 && this.mode !== 'dead' && h.alive && Math.hypot(h.x - this.body.x, h.z - this.body.z) < this.st.radius * AI.wader.underfoot) {
      this.stomps = 1;
      this.panicFor = AI.wader.startleTime;
      this.alert({ x: h.x, z: h.z });
    }
    const passive = this.panicFor <= 0;
    if (passive) this.forget();
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
      this.setPhase('rear');
    }
  }
}
