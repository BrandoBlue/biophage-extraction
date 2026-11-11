/**
 * Nest wave director (Brood Heart). Pure timing and head-count logic; the raid owns the nest's body, damage and
 * Brood Cache, and spawns what this returns. Dormant until a host comes within `activationRadius`; then a wave
 * every `waveInterval` (first after `firstWaveDelay`), never more than `maxAliveFromNest` of its spawn alive at once.
 * A wave that does not fit waits in the queue and trickles out as its brood dies. Destroying the heart stops it.
 */
import { AI, type Nest, type SpawnSpec } from '../../data';

export type NestState = 'dormant' | 'active' | 'spent' | 'destroyed';

export interface NestSpawn { type: string; x: number; z: number; vx: number; vz: number; wave: number }

export class WaveDirector {
  state: NestState = 'dormant';
  /** Waves released so far. */
  wave = 0;
  private timer = 0;
  private queue: { type: string; wave: number }[] = [];

  constructor(readonly nest: Nest, readonly x: number, readonly z: number, private rand: () => number = Math.random) {}

  /** Seconds until the next wave, or null if none is coming. */
  get nextWaveIn(): number | null { return this.state === 'active' && this.wave < this.nest.maxWaves ? Math.max(0, this.timer) : null; }
  get pending(): number { return this.queue.length; }

  /**
   * @param hostDistance distance from the nest to the nearest living host (Infinity if none)
   * @param alive how many creatures this nest spawned are still alive
   * @returns creatures to spawn this frame, with eject positions and velocities
   */
  update(dt: number, hostDistance: number, alive: number): NestSpawn[] {
    if (this.state === 'destroyed' || this.state === 'spent') return [];
    if (this.state === 'dormant') {
      if (hostDistance > this.nest.activationRadius) return [];
      this.state = 'active';
      this.timer = this.nest.firstWaveDelay;
    }
    this.timer -= dt;
    if (this.timer <= 0 && this.wave < this.nest.maxWaves) {
      const specs: SpawnSpec[] = this.nest.waves[Math.min(this.wave, this.nest.waves.length - 1)] ?? [];
      this.wave++;
      for (const s of specs) for (let i = 0; i < s.count; i++) this.queue.push({ type: s.type, wave: this.wave });
      this.timer += this.nest.waveInterval;
    }
    const room = Math.max(0, this.nest.maxAliveFromNest - alive);
    const out = this.queue.splice(0, room).map((q, i, all) => this.eject(q.type, q.wave, i, all.length));
    if (this.wave >= this.nest.maxWaves && this.queue.length === 0) this.state = 'spent';
    return out;
  }

  destroy(): void { this.state = 'destroyed'; this.queue.length = 0; }

  private eject(type: string, wave: number, i: number, n: number): NestSpawn {
    const N = AI.nestSpawn;
    const a = (i / Math.max(1, n)) * Math.PI * 2 + this.rand() * 0.8;
    const sx = Math.sin(a), sz = Math.cos(a);
    return { type, wave, x: this.x + sx * N.ejectRadius, z: this.z + sz * N.ejectRadius, vx: sx * N.ejectSpeed, vz: sz * N.ejectSpeed };
  }
}
