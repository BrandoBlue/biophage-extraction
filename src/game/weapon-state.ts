/** Automatic-fire magazine logic for living weapons. Pure and deterministic; rendering lives elsewhere. */
export interface AutoTuning { fireRate: number; magazine: number; reloadTime: number }

export class AutoWeaponState {
  ammo: number;
  reloading = 0;
  private sinceShot = Infinity;
  constructor(readonly t: AutoTuning) { this.ammo = t.magazine; }

  get isReloading(): boolean { return this.reloading > 0; }
  get interval(): number { return 1 / this.t.fireRate; }

  reload(): boolean {
    if (this.isReloading || this.ammo === this.t.magazine) return false;
    this.reloading = this.t.reloadTime;
    return true;
  }

  /**
   * Advances time with the trigger held or not. Returns rounds fired this step and whether a reload finished.
   * An empty magazine starts the regrow automatically.
   */
  update(dt: number, trigger: boolean): { shots: number; reloaded: boolean; empty: boolean } {
    if (this.reloading > 0) {
      this.reloading = Math.max(0, this.reloading - dt);
      if (this.reloading === 0) { this.ammo = this.t.magazine; this.sinceShot = Infinity; return { shots: 0, reloaded: true, empty: false }; }
      return { shots: 0, reloaded: false, empty: false };
    }
    this.sinceShot += dt;
    let shots = 0;
    if (trigger) {
      while (this.ammo > 0 && this.sinceShot >= this.interval) {
        this.sinceShot = this.sinceShot === Infinity ? 0 : this.sinceShot - this.interval;
        this.ammo--; shots++;
      }
    } else if (this.sinceShot > this.interval) {
      this.sinceShot = Infinity;
    }
    let empty = false;
    if (this.ammo === 0) { empty = true; this.reload(); }
    return { shots, reloaded: false, empty };
  }
}
