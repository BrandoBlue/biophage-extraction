/**
 * Crawler (Cablecrawler): a stalker of the pit walls and the undersides of walkways. Its goal is to drop its prey into
 * the pit (`mind.wants`). While the host is out on a walkway it does not come for the host at all: it scuttles to the
 * deck the host will need to get back (behind the host's direction of travel, not the one underfoot) and shears
 * through it. You hear it chewing before the deck goes (`action` rises through `cutWalkway.time`: the tell). Hurt it
 * for `cutWalkway.interruptDamage` while it chews and it lets go. Off the walkways it hunts like a stalker.
 */
import { AI } from '../../../data';
import type { BrainWorld, Vec3, WalkwayView } from '../types';
import { StalkerBrain } from './stalker';

interface Cut { time: number; interruptDamage: number; cooldown: number }

/** True when (x, y, z) stands on walkway `w` (its deck rectangle, within a step of its height). */
export function onWalkway(w: WalkwayView, x: number, y: number, z: number): boolean {
  if (w.isCut || Math.abs(y - w.y) > AI.crawler.deckHeight) return false;
  const dx = x - w.x, dz = z - w.z, s = Math.sin(w.yaw), c = Math.cos(w.yaw);
  const along = dx * s + dz * c, across = dx * c - dz * s;
  return Math.abs(along) <= w.halfLength + 0.4 && Math.abs(across) <= w.halfWidth + 0.6;
}

export class CrawlerBrain extends StalkerBrain {
  private readonly cutData = (this.data.cutWalkway as Cut | undefined) ?? { time: 2.5, interruptDamage: 30, cooldown: 20 };
  private cutCd = 0;
  /** The deck it is going for, and the damage it has taken while chewing. */
  target: WalkwayView | null = null;
  private chewHurt = 0;

  step(dt: number, w: BrainWorld): void {
    this.cutCd = Math.max(0, this.cutCd - dt);
    super.step(dt, w);
    if (this.phase !== 'chew') this.action = Math.max(0, this.action - dt * 2);
  }

  protected onHurt(amount = 0): void {
    super.onHurt();
    if (this.phase !== 'chew') return;
    this.chewHurt += amount;
    if (this.chewHurt >= this.cutData.interruptDamage) { this.target = null; this.action = 0; this.setPhase('fade'); }
  }

  /** The deck the host needs to get back: behind its travel, near enough to matter, not the one it stands on. */
  private pick(w: BrainWorld, host: Vec3): WalkwayView | null {
    const ws = w.walkways;
    if (!ws || !ws.some((k) => onWalkway(k, host.x, host.y, host.z))) return null;
    const C = AI.crawler, h = w.host, sp = Math.hypot(h.vx, h.vz);
    let best: WalkwayView | null = null, score = -Infinity;
    for (const k of ws) {
      if (k.isCut || onWalkway(k, host.x, host.y, host.z)) continue;
      const dx = k.x - host.x, dz = k.z - host.z, d = Math.hypot(dx, dz);
      if (d < C.minBehind || d > C.cutReach || Math.abs(k.y - host.y) > C.deckHeight * 2) continue;
      // Behind the host's travel scores highest; standing still, the nearest deck cuts it off.
      const behind = sp > 0.5 ? -(dx * h.vx + dz * h.vz) / (sp * d) : 0;
      const s = behind * 10 - d * 0.3;
      if (s > score) { score = s; best = k; }
    }
    return best;
  }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const C = AI.crawler, t = this.data;
    if (this.phase === 'chew' && this.target) {
      // Chewing through the lashings: the tell is the sound and the scissoring shears.
      const k = this.target;
      this.slow(dt, 8);
      this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
      this.look = { x: host.x, y: host.y + 1, z: host.z };
      this.action = Math.min(1, this.phaseTime / this.cutData.time);
      this.windup = 0.3 + 0.4 * this.action;
      if (k.isCut) { this.target = null; this.setPhase('stalk'); return; }
      if (this.phaseTime >= this.cutData.time) {
        this.events.push({ type: 'cut', id: k.id });
        this.cutCd = this.cutData.cooldown;
        this.target = null; this.windup = 0;
        this.setPhase('stalk');
      }
      return;
    }
    if (this.cutCd === 0 && !this.target) this.target = this.pick(w, host);
    if (this.target && this.target.isCut) this.target = null;
    if (this.target && this.phase !== 'charge' && this.phase !== 'windup' && this.phase !== 'strike') {
      // Climbing along the underside to the deck it wants.
      const k = this.target, d = Math.hypot(k.x - this.body.x, k.z - this.body.z);
      this.look = { x: host.x, y: host.y + 1, z: host.z };
      this.windup = 0;
      this.setPhase('climb');
      if (d > C.reach) { this.moveToward(k.x, k.z, t.speed * C.approach, 4, dt); return; }
      this.chewHurt = 0;
      this.setPhase('chew');
      return;
    }
    super.hunt(dt, w, host, dist, dx, dz);
  }
}
