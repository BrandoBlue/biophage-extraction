/**
 * Burrower (Dunewake): swims under the sand where nothing can hit it, feeling for footsteps. Hunting, it closes on
 * the host at `burrowSpeed`; inside `burrow.triggerRadius` a line of ripples races in for `rippleTell` s (the only
 * tell), then it bursts out in a lunge. It fights on the surface, where it can be shot, for `resurfaceAfter` s and
 * dives again. Calm, it idles just under the sand. Sprinting hosts are felt from further away, crouching ones barely.
 * Lurkers (the Fenstalker, data `submerge` instead of `burrow`) lie under the water with only their eyes up: they creep
 * in at `lurkCreep` x their speed rather than racing, and burst out inside `submerge.ambushRange` after `ripplesTell`.
 */
import { AI, type Range } from '../../../data';
import { Brain } from '../brain';
import type { BrainWorld, Vec3 } from '../types';

interface BurrowData { triggerRadius: number; rippleTell: number; resurfaceAfter: Range }
interface SubmergeData { ambushRange: number; ripplesTell: number }

function burrowData(t: Record<string, unknown>): BurrowData {
  if (t.burrow) return t.burrow as BurrowData;
  const s = t.submerge as SubmergeData | undefined;
  if (s) return { triggerRadius: s.ambushRange, rippleTell: s.ripplesTell, resurfaceAfter: AI.burrower.lurkSurface };
  return { triggerRadius: 9, rippleTell: 0.8, resurfaceAfter: [3, 6] };
}

export class BurrowerBrain extends Brain {
  protected readonly turnRate = AI.burrower.turnRate;
  protected readonly flees = false;
  private readonly b = burrowData(this.data as unknown as Record<string, unknown>);
  /** Lies in wait under water and creeps in, rather than racing under the sand. */
  readonly lurker = !this.data.burrow && !!this.data.submerge;
  private up = 0;
  private bit = false;

  step(dt: number, w: BrainWorld): void {
    super.step(dt, w);
    // Calm, investigating or searching: under the sand.
    const under = this.mode !== 'hunt' && this.mode !== 'stagger' && this.mode !== 'dead';
    if (under) { this.ease(1, dt); this.action = 0; }
    if (this.mode === 'dead') this.submerged = 0;
  }

  protected onHurt(): void {
    // Hurt on the surface: it dives sooner.
    if (this.phase === 'surface') this.up = Math.min(this.up, 0.6);
  }

  private ease(to: number, dt: number): void {
    const k = to > this.submerged ? AI.burrower.diveRate : AI.burrower.surfaceRate;
    this.submerged = to > this.submerged ? Math.min(to, this.submerged + k * dt) : Math.max(to, this.submerged - k * dt);
  }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const t = this.data, B = AI.burrower;
    const burrowSpeed = Number(t.burrowSpeed ?? t.speed * 2.5);
    this.look = { x: host.x, y: host.y + 0.4, z: host.z };
    switch (this.phase) {
      case 'ripple':
        // The tell: a fast line of ripples straight at the host. Still under, still untouchable.
        this.ease(1, dt);
        this.action = Math.min(1, this.phaseTime / this.b.rippleTell);
        this.moveToward(host.x, host.z, burrowSpeed * B.rippleFactor, 6, dt);
        if (this.phaseTime >= this.b.rippleTell) this.burst(w, host);
        return;
      case 'burst':
        this.ease(0, dt);
        this.windup = Math.max(0, 1 - this.phaseTime / B.lungeTime);
        if (!this.bit && dist < t.attackRange) { this.bit = true; this.events.push({ type: 'melee', damage: t.damage, knockback: B.knockback }); }
        if (this.phaseTime >= B.lungeTime) {
          this.strike = null; this.cooldown = t.cooldown;
          const [a, b] = this.b.resurfaceAfter;
          this.up = a + this.rand() * (b - a);
          this.setPhase('surface');
        }
        return;
      case 'surface':
        // On top of the sand: snaps at whoever is close, and can be shot.
        this.ease(0, dt);
        this.action = 0;
        this.up -= dt;
        if (this.up <= 0) { this.windup = 0; this.setPhase('dive'); return; }
        if (this.cooldown === 0 && dist <= t.attackRange) {
          this.windup = Math.min(1, this.windup + dt / t.windup);
          this.slow(dt, 8);
          this.face(this.yawTo(host.x, host.z), this.turnRate * 2, dt);
          if (this.windup >= 1) { this.events.push({ type: 'melee', damage: t.damage, knockback: B.knockback * 0.5 }); this.windup = 0; this.cooldown = t.cooldown; }
        } else {
          this.windup = Math.max(0, this.windup - dt * 3);
          this.moveToward(host.x, host.z, t.speed, 4, dt);
        }
        return;
      case 'dive':
        this.slow(dt, 3);
        this.ease(1, dt);
        if (this.submerged >= 1) this.setPhase('swim');
        return;
    }
    // Swimming under the sand: fast and invisible, straight at the footsteps.
    this.setPhase('swim');
    this.ease(1, dt);
    this.windup = 0;
    this.action = 0;
    if (this.submerged < 0.95) { this.slow(dt, 3); return; }
    // Circle in from the side rather than a straight line, so the ripple comes from somewhere new.
    const side = this.lurker ? 0 : (this.id % 2 ? 1 : -1) * Math.min(1, dist / 20) * B.swimCurl;
    this.moveToward(host.x - dz * side * dist * 0.3, host.z + dx * side * dist * 0.3, this.lurker ? t.speed * B.lurkCreep : burrowSpeed, 3, dt);
    if (dist <= this.b.triggerRadius && this.cooldown === 0 && this.requestToken(w)) this.setPhase('ripple');
  }

  private burst(w: BrainWorld, host: Vec3): void {
    const v = Number(this.data.lungeSpeed ?? this.data.speed * 3);
    const tx = host.x + w.host.vx * 0.2 - this.body.x, tz = host.z + w.host.vz * 0.2 - this.body.z, tl = Math.hypot(tx, tz) || 1;
    this.body.vx = (tx / tl) * v; this.body.vz = (tz / tl) * v;
    this.strike = { x: host.x, y: host.y + 0.8, z: host.z };
    this.bit = false;
    this.action = 0;
    this.releaseToken(w);
    this.events.push({ type: 'reveal', how: 'ambush' });
    this.setPhase('burst');
  }
}
