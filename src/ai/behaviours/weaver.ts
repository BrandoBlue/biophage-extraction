/**
 * Weaver (Tithe Weaver): a hovering trap-layer. Calm, it strings web strands between points around its home; a host
 * who blunders through one is rooted and every creature within the web's alert radius hears it. Hunting, it hangs
 * back out of reach, strings a strand across the path the host is running along, and spits from range. It never
 * comes close if it can help it. Strands are renderer-free (src/ai/web.ts); the raid draws and tests them.
 */
import { AI, type Range } from '../../../data';
import { Brain } from '../brain';
import type { TokenKind } from '../tokens';
import type { BrainWorld, Vec3 } from '../types';

interface Web { strandLength: number }

export class WeaverBrain extends Brain {
  protected readonly turnRate = AI.weaver.turnRate;
  protected readonly tokenKind: TokenKind = 'ranged';
  private readonly web = (this.data.web as Web | undefined) ?? { strandLength: 14 };
  private spin = AI.weaver.spinEvery * this.rand();

  protected cruiseAltitude(): number { return AI.weaver.hoverHeight; }

  protected calm(dt: number, w: BrainWorld): void {
    super.calm(dt, w);
    this.spin -= dt;
    if (this.spin <= 0) {
      this.spin = AI.weaver.spinEvery;
      const a = this.rand() * Math.PI * 2, L = this.web.strandLength * (0.6 + this.rand() * 0.4);
      const cx = this.home.x + Math.cos(a + 1.3) * this.roam * 0.6 * this.rand(), cz = this.home.z + Math.sin(a + 1.3) * this.roam * 0.6 * this.rand();
      this.lay(cx - Math.cos(a) * L / 2, cz - Math.sin(a) * L / 2, cx + Math.cos(a) * L / 2, cz + Math.sin(a) * L / 2);
    }
  }

  /** Strings a strand; the raid keeps at most `web.maxStrands` per weaver, dropping its oldest. */
  private lay(x0: number, z0: number, x1: number, z1: number): void {
    this.events.push({ type: 'web', from: { x: x0, z: z0 }, to: { x: x1, z: z1 } });
  }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const A = AI.weaver, t = this.data;
    const [near, far] = (t.preferredRange as Range | undefined) ?? A.keepRange;
    this.look = { x: host.x, y: host.y + 1, z: host.z };
    this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
    this.body.altitude += (A.hoverHeight - this.body.altitude) * Math.min(1, dt * 2);
    this.spin -= dt;
    // A strand across where the host is running, a few metres ahead of it.
    const hv = Math.hypot(w.host.vx, w.host.vz);
    if (this.spin <= 0 && hv > 1) {
      this.spin = A.spinEvery * 0.5;
      const ux = w.host.vx / hv, uz = w.host.vz / hv, ax = host.x + ux * A.cutAhead, az = host.z + uz * A.cutAhead, half = this.web.strandLength / 2;
      this.lay(ax - uz * half, az + ux * half, ax + uz * half, az - ux * half);
    }
    if (this.phase === 'windup') {
      this.windup = Math.min(1, this.phaseTime / t.windup);
      this.slow(dt, 4);
      if (this.phaseTime >= t.windup) {
        this.events.push({ type: 'spit', target: { x: host.x + w.host.vx * 0.4, y: host.y + 0.9, z: host.z + w.host.vz * 0.4 } });
        this.cooldown = t.cooldown;
        this.releaseToken(w);
        this.setPhase('drift');
      }
      return;
    }
    this.windup = Math.max(0, this.windup - dt * 3);
    this.setPhase('drift');
    const mx = dist > far ? dx : dist < near ? -dx * 1.5 : -dz * 0.6, mz = dist > far ? dz : dist < near ? -dz * 1.5 : dx * 0.6;
    const ml = Math.hypot(mx, mz) || 1;
    this.steer((mx / ml) * t.speed, (mz / ml) * t.speed, 2, dt);
    if (dist <= t.attackRange && this.cooldown === 0 && this.requestToken(w)) this.setPhase('windup');
  }
}
