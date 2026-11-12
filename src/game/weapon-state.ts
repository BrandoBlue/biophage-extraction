/**
 * Magazine, trigger and reload logic for living weapons. Pure and deterministic; rendering lives elsewhere.
 *
 * Fire modes (weapons.json `fireMode`): auto fires while held; semi fires once per press; burst fires
 * `burstCount` rounds per press at `fireRate`; charge fires once on release after holding `chargeTime`
 * (released early, nothing fires).
 * Reload styles (`reload.style`): magazine swaps the whole load after `time` (+ `emptyExtra` when empty);
 * perShell feeds one round every `perShellTime` and firing interrupts it; regrow refills in place after `time`.
 */
import type { FireMode, ReloadStyle } from '../../data';

export interface AutoTuning {
  fireRate: number; magazine: number; reloadTime: number;
  fireMode?: FireMode; burstCount?: number; chargeTime?: number;
  reloadStyle?: ReloadStyle; perShellTime?: number; emptyExtra?: number;
  /** Seconds between rounds of one burst (default: 1 / fireRate). */
  burstDelay?: number;
  /** charge: the least charge (0..1) that still fires on release; the shot's power is the charge reached. */
  minCharge?: number;
}

/** Where a fed weapon's rounds come from (feed items in the cavities and pouch). Regrow weapons need none. */
export interface AmmoFeed { available(): number; take(n: number): number }

export interface StepResult {
  shots: number;
  reloaded: boolean;
  empty: boolean;
  /** perShell: rounds fed this step (for the view's shell-in motion). */
  shellsIn: number;
  /** charge: 0..1 while the trigger is held; on the step that fires, the charge it fired with. */
  charge: number;
}

export class AutoWeaponState {
  ammo: number;
  /** Seconds of reload left (magazine/regrow), or of the current shell (perShell). */
  reloading = 0;
  /** Full duration of the reload in progress, for progress bars and views. */
  reloadTotal = 0;
  charge = 0;
  private sinceShot = Infinity;
  private wasHeld = false;
  private burstLeft = 0;
  private sinceBurst = 0;
  private readonly mode: FireMode;
  private readonly style: ReloadStyle;

  constructor(readonly t: AutoTuning, readonly feed: AmmoFeed | null = null) {
    this.ammo = t.magazine;
    this.mode = t.fireMode ?? 'auto';
    this.style = t.reloadStyle ?? 'regrow';
  }

  get isReloading(): boolean { return this.reloading > 0; }
  get interval(): number { return 1 / this.t.fireRate; }
  get reloadStyle(): ReloadStyle { return this.style; }
  /** 0..1 progress of the reload in progress (perShell: of the whole refill). */
  get reloadProgress(): number {
    if (!this.isReloading) return 0;
    if (this.style === 'perShell') return Math.min(1, (this.ammo + 1 - this.reloading / this.shellTime) / this.t.magazine);
    return 1 - this.reloading / (this.reloadTotal || 1);
  }
  private get shellTime(): number { return this.t.perShellTime ?? this.t.reloadTime / Math.max(1, this.t.magazine); }

  /** Rounds left to reload from (Infinity for regrow or unfed weapons). */
  get reserve(): number { return this.feed && this.style !== 'regrow' ? this.feed.available() : Infinity; }

  reload(): boolean {
    if (this.isReloading || this.ammo === this.t.magazine || this.reserve <= 0) return false;
    this.burstLeft = 0; this.charge = 0;
    if (this.style === 'perShell') this.reloading = this.reloadTotal = this.shellTime;
    else this.reloading = this.reloadTotal = this.t.reloadTime + (this.ammo === 0 ? this.t.emptyExtra ?? 0 : 0);
    return true;
  }

  /** Stops a reload in progress (weapon swap). perShell keeps the rounds already fed. */
  cancelReload(): void { this.reloading = 0; this.reloadTotal = 0; }

  /** Advances time with the trigger held or not. An empty magazine starts the reload automatically. */
  update(dt: number, trigger: boolean): StepResult {
    const out: StepResult = { shots: 0, reloaded: false, empty: false, shellsIn: 0, charge: 0 };
    const pressed = trigger && !this.wasHeld, released = !trigger && this.wasHeld;
    this.wasHeld = trigger;
    if (this.reloading > 0) {
      // A perShell reload is interrupted by pulling the trigger with a round in the tube.
      if (this.style === 'perShell' && pressed && this.ammo > 0) this.cancelReload();
      else {
        this.reloading = Math.max(0, this.reloading - dt);
        if (this.reloading > 0) return out;
        if (this.style === 'perShell') {
          const got = this.feed ? this.feed.take(1) : 1;
          this.ammo += got; out.shellsIn = got;
          if (got > 0 && this.ammo < this.t.magazine && this.reserve > 0) { this.reloading = this.reloadTotal = this.shellTime; return out; }
        } else if (this.style === 'magazine' && this.feed) this.ammo += this.feed.take(this.t.magazine - this.ammo);
        else this.ammo = this.t.magazine;
        this.reloadTotal = 0;
        this.sinceShot = Infinity;
        out.reloaded = true;
        return out;
      }
    }
    this.sinceShot += dt;
    const ready = () => this.ammo > 0 && this.sinceShot >= this.interval;
    const shoot = () => { this.sinceShot = this.sinceShot === Infinity ? 0 : Math.min(this.sinceShot - this.interval, this.interval); this.ammo--; out.shots++; };
    switch (this.mode) {
      case 'auto':
        if (trigger) while (ready()) { this.sinceShot = this.sinceShot === Infinity ? 0 : this.sinceShot - this.interval; this.ammo--; out.shots++; }
        else if (this.sinceShot > this.interval) this.sinceShot = Infinity;
        break;
      case 'semi':
        if (pressed && ready()) shoot();
        break;
      case 'burst': {
        // Bursts start no faster than fireRate; rounds inside a burst are burstDelay apart.
        const gap = this.t.burstDelay ?? this.interval;
        if (pressed && this.burstLeft === 0 && ready()) { this.burstLeft = this.t.burstCount ?? 3; this.sinceBurst = gap; }
        if (this.burstLeft > 0) {
          this.sinceBurst += this.burstLeft === (this.t.burstCount ?? 3) ? 0 : dt;
          while (this.burstLeft > 0 && this.ammo > 0 && this.sinceBurst >= gap) {
            this.sinceBurst -= gap; this.ammo--; out.shots++; this.burstLeft--;
            if (this.burstLeft === 0) this.sinceShot = 0;
          }
        }
        if (this.ammo === 0) this.burstLeft = 0;
        break;
      }
      case 'charge':
        if (trigger && this.ammo > 0 && this.sinceShot >= this.interval) this.charge = Math.min(1, this.charge + dt / Math.max(0.01, this.t.chargeTime ?? 1));
        out.charge = this.charge;
        if (released) { if (this.charge >= (this.t.minCharge ?? 1) && ready()) shoot(); this.charge = 0; }
        break;
    }
    if (this.ammo === 0) { out.empty = true; this.reload(); }
    return out;
  }
}
