/** Extraction channel: stand in the zone for `time` seconds. Leaving resets it (cancelOnLeave). Pure logic. */
export type ExtractChange = 'start' | 'cancel' | 'done' | null;

export class ExtractionPoint {
  elapsed = 0;
  inside = false;
  done = false;
  constructor(readonly x: number, readonly z: number, readonly radius: number, readonly time: number, readonly cancelOnLeave = true) {}

  contains(x: number, z: number): boolean { return Math.hypot(x - this.x, z - this.z) <= this.radius; }
  get progress(): number { return Math.min(1, this.elapsed / this.time); }
  get timeLeft(): number { return Math.max(0, this.time - this.elapsed); }

  update(x: number, z: number, dt: number): ExtractChange {
    if (this.done) return null;
    const now = this.contains(x, z);
    let change: ExtractChange = null;
    if (now && !this.inside) change = 'start';
    if (!now && this.inside) { change = 'cancel'; if (this.cancelOnLeave) this.elapsed = 0; }
    this.inside = now;
    if (now) {
      this.elapsed += dt;
      if (this.elapsed >= this.time) { this.done = true; change = 'done'; }
    }
    return change;
  }
}
