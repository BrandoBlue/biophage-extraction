/** Biomass (health) and Neural Overload (heat meter). Pure logic, no rendering, unit-tested. */
import type { HostRules } from '../../data';

export class Biomass {
  current: number;
  constructor(readonly max: number) { this.current = max; }
  get dead(): boolean { return this.current <= 0; }
  get fraction(): number { return this.current / this.max; }
  /** Returns the damage actually applied. */
  damage(amount: number): number {
    const applied = Math.min(this.current, Math.max(0, amount));
    this.current -= applied;
    return applied;
  }
  heal(amount: number): number {
    if (this.dead) return 0;
    const applied = Math.min(this.max - this.current, Math.max(0, amount));
    this.current += applied;
    return applied;
  }
}

export type OverloadRules = HostRules['neuralOverload'];

/**
 * Neural Overload is heat (docs/gdd/03-combat.md): sprinting, jumping and abilities fill it, and it decays after a
 * short delay. Reaching max Overloads the host: no sprint or abilities for `overloadedDuration`, then reset to `resetTo`.
 */
export class NeuralOverload {
  value = 0;
  lockedFor = 0;
  private sinceHeat = Infinity;
  constructor(readonly t: OverloadRules, private decayMultiplier = 1) {}

  get fraction(): number { return this.value / this.t.max; }
  get overloaded(): boolean { return this.lockedFor > 0; }

  /** Adds heat. Returns true if this pushed the host into overload. */
  add(heat: number): boolean {
    if (this.overloaded || heat <= 0) return false;
    this.value = Math.min(this.t.max, this.value + heat);
    this.sinceHeat = 0;
    if (this.value >= this.t.max) { this.lockedFor = this.t.overloadedDuration; return true; }
    return false;
  }

  update(dt: number): void {
    if (this.lockedFor > 0) {
      this.lockedFor = Math.max(0, this.lockedFor - dt);
      if (this.lockedFor === 0) { this.value = this.t.resetTo; this.sinceHeat = 0; }
      return;
    }
    this.sinceHeat += dt;
    if (this.sinceHeat >= this.t.decayDelay) this.value = Math.max(0, this.value - this.t.decayPerSecond * this.decayMultiplier * dt);
  }
}
