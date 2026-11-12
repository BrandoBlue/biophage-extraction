/**
 * Gunner (the Hollowed): a dead host worked like a glove, still carrying its gun (`usesWeapon`). It wants to use the
 * body like a player would (`mind.wants`), and almost manages: it keeps a fighting range and sidesteps, raises the gun
 * (the wind-up: the barrel comes up and the chest light swings onto you), fires a short burst of `usesWeapon.burst`
 * shots at `usesWeapon.accuracy`, then reloads far too slowly, head hung. Sometimes it forgets the gun altogether and
 * stands looking at its hands. Its head jerks toward any sound. Every pause is a window.
 */
import { AI, type Range } from '../../../data';
import { Brain } from '../brain';
import type { TokenKind } from '../tokens';
import type { BrainWorld, Vec3 } from '../types';

interface Weapon { accuracy: number; burst: Range }

export class GunnerBrain extends Brain {
  protected readonly turnRate = AI.gunner.turnRate;
  protected readonly tokenKind: TokenKind = 'ranged';
  private readonly gun = (this.data.usesWeapon as Weapon | undefined) ?? { accuracy: 0.45, burst: [3, 6] as Range };
  private strafe = this.rand() < 0.5 ? -1 : 1;
  private shotsLeft = 0;
  private shotCd = 0;
  private jerkFor = 0;

  step(dt: number, w: BrainWorld): void {
    // Its head jerks toward sounds, whatever it is doing.
    this.jerkFor = Math.max(0, this.jerkFor - dt);
    const loud = w.noises.find((n) => n.radius >= AI.gunner.jerkNoise && Math.hypot(n.x - this.body.x, n.z - this.body.z) <= n.radius);
    if (loud && this.jerkFor <= 0 && this.mode !== 'dead') { this.jerkFor = AI.gunner.jerkTime; this.look = { x: loud.x, y: 1.4, z: loud.z }; }
    super.step(dt, w);
    this.action = Math.max(0, this.action - dt * 8);
  }

  protected hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): void {
    const G = AI.gunner, t = this.data;
    if (this.jerkFor <= 0) this.look = { x: host.x, y: host.y + 1.4, z: host.z };
    switch (this.phase) {
      case 'aim':
        // The barrel comes up: the tell.
        this.slow(dt, 6);
        this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
        this.windup = Math.min(1, this.phaseTime / t.windup);
        this.strike = { x: host.x, y: host.y + 1.2, z: host.z };
        if (this.phaseTime >= t.windup) {
          const [a, b] = this.gun.burst;
          this.shotsLeft = a + Math.floor(this.rand() * (b - a + 1));
          this.shotCd = 0;
          this.setPhase('burst');
        }
        return;
      case 'burst':
        this.slow(dt, 6);
        this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
        this.windup = 1;
        this.shotCd -= dt;
        if (this.shotCd <= 0 && this.shotsLeft > 0) {
          this.shotsLeft--;
          this.shotCd = G.shotInterval;
          this.action = 1;
          this.events.push({ type: 'shot', target: { x: host.x, y: host.y + 1.2, z: host.z }, damage: t.damage, accuracy: this.gun.accuracy });
        }
        if (this.shotsLeft <= 0) {
          this.windup = 0; this.strike = null;
          this.releaseToken(w);
          this.cooldown = t.cooldown;
          // It reloads far too slowly, and now and then forgets the gun altogether.
          this.setPhase(this.rand() < G.forgetChance ? 'fumble' : 'reload');
        }
        return;
      case 'reload':
        this.slow(dt, 4);
        this.windup = 0;
        if (this.phaseTime >= G.reloadTime) this.setPhase('move');
        return;
      case 'fumble':
        this.slow(dt, 4);
        this.windup = 0;
        this.look = null;
        if (this.phaseTime >= G.forgetTime) this.setPhase('move');
        return;
    }
    // Keep a fighting range and sidestep, the way a host would.
    this.setPhase('move');
    this.windup = 0;
    const [near, far] = G.range;
    let mx = 0, mz = 0;
    if (dist > far) { mx = dx; mz = dz; } else if (dist < near) { mx = -dx; mz = -dz; }
    mx += -dz * G.strafe * this.strafe; mz += dx * G.strafe * this.strafe;
    if (this.rand() < dt * G.strafeFlip) this.strafe *= -1;
    const ml = Math.hypot(mx, mz) || 1;
    this.steer((mx / ml) * t.speed, (mz / ml) * t.speed, 3, dt);
    this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
    if (this.cooldown === 0 && dist <= t.attackRange && this.requestToken(w)) this.setPhase('aim');
  }
}
