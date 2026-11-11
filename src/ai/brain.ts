/**
 * Shared PvE brain. Owns a creature's awareness, movement and facing; the archetype subclasses (behaviours/*) only
 * decide what to do while hunting a host they can track. Output is read by the Abomination each frame and maps 1:1
 * onto Creature.drive (velocity, look, excite, windup, strike, altitude) plus camouflage visibility and one-shot
 * events (melee, spit, screech, slam, charge, notice, alert).
 *
 *   calm ──(suspicious)──▶ investigate ──(awareness 1)──▶ hunt ──(lost for loseInterest)──▶ investigate ──▶ calm
 *     ▲                                                    │ ▲
 *     └──────────── host dead / hidden ◀───────────────────┘ └── stagger (from damage) returns here
 */
import { AI, type Abomination as AbominationData } from '../../data';
import { mulberry32 } from '../world/zone7';
import { Awareness } from './senses';
import type { TokenKind } from './tokens';
import type { AIEvent, BrainWorld, Mode, Vec2, Vec3 } from './types';

export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (a: number, b: number, k: number, dt: number) => b + (a - b) * Math.exp(-k * dt);

/** Seconds a hunter keeps tracking the host's true position after losing sight (scent, footfalls). */
const TRACK_GRACE = 1.5;

export interface Body { x: number; z: number; yaw: number; vx: number; vz: number; altitude: number }

export abstract class Brain {
  readonly body: Body;
  mode: Mode = 'calm';
  /** Archetype sub-state, for debugging, tests and animation hints. */
  phase = 'idle';
  // Drive outputs.
  excite = 0;
  windup = 0;
  look: Vec3 | null = null;
  strike: Vec3 | null = null;
  /** Camouflage: 1 = fully visible. */
  visibility = 1;
  /** One-shot events since the owner last drained them. */
  readonly events: AIEvent[] = [];
  readonly awareness: Awareness;

  protected readonly rand: () => number;
  protected home: Vec2;
  /** Leash: how far it wanders from home while calm; past it, it drifts back (habitats.json `roam`). */
  protected roam = AI.wander.radius;
  /** Calm height for flyers that roost (habitats.json `height`); null: the archetype's own. */
  protected roost: number | null = null;
  /** Lying in wait: in a tank until the host comes within `range` (hatch), or posing as a crate (disguise). */
  private lurk: { how: 'hatch' | 'disguise'; range: number } | null = null;
  protected phaseTime = 0;
  protected cooldown = 0;
  private staggerFor = 0;
  private wanderTo: Vec2 | null = null;
  private pauseFor = 0;
  private investigateFor = 0;
  private searchYaw = 0;
  protected abstract readonly turnRate: number;
  /** Which attack slot this archetype competes for. */
  protected readonly tokenKind: TokenKind = 'melee';

  constructor(readonly id: number, readonly kind: string, readonly data: AbominationData, x: number, z: number, seed: number, readonly radius = 0.8) {
    this.rand = mulberry32(seed);
    this.body = { x, z, yaw: this.rand() * Math.PI * 2, vx: 0, vz: 0, altitude: 0 };
    this.home = { x, z };
    this.awareness = new Awareness(data.perception);
  }

  get engaged(): boolean { return this.mode === 'hunt'; }
  get speed(): number { return Math.hypot(this.body.vx, this.body.vz); }

  // ------------------------------------------------------------------ external hooks

  /**
   * Where this creature lives (Gameplay places it from data/habitats.json): it wanders within `roam` of home and
   * drifts back after a chase. `hatchOnApproach` keeps it in its tank until the host is that close; `disguise` keeps
   * it posing as an object until the host is in striking range; `height` is a flyer's roost height.
   */
  setHome(x: number, z: number, o: { roam?: number; hatchOnApproach?: number; disguise?: string; height?: number } = {}): void {
    this.home = { x, z };
    if (o.roam !== undefined) this.roam = o.roam;
    if (o.height !== undefined) this.roost = o.height;
    if (o.hatchOnApproach) this.lurk = { how: 'hatch', range: o.hatchOnApproach };
    else if (o.disguise) this.lurk = { how: 'disguise', range: this.data.attackRange + 1.5 };
  }

  /** Still in its tank or disguise (the body should show the tank or the crate). */
  get lurking(): boolean { return this.lurk !== null; }

  private reveal(): void {
    if (!this.lurk) return;
    this.events.push({ type: 'reveal', how: this.lurk.how });
    this.lurk = null;
  }

  /** A packmate, screech, nest pulse or wound told this creature where the host is (null: it knows, it was shot). */
  alert(at: Vec2 | null = null): void {
    if (this.mode === 'dead' || this.lurk) return;
    this.awareness.alert(at);
    this.awareness.sinceSeen = 0;
    this.pendingFix = at === null;
    this.pendingHunt = true;
  }
  private pendingFix = false;
  /** An alert lands as a hunt on the next step even if the meter decays first. */
  private pendingHunt = false;

  stagger(seconds: number): void {
    if (this.mode === 'dead') return;
    this.mode = 'stagger';
    this.staggerFor = seconds;
    this.windup = 0;
    this.strike = null;
    this.onInterrupted();
  }

  /** The creature was wounded: archetypes can react (Glasswalker reveal). Also alerts. */
  hurt(): void { this.reveal(); this.alert(null); this.onHurt(); }

  kill(): void {
    this.mode = 'dead';
    this.windup = 0; this.strike = null; this.look = null; this.excite = 0;
    this.body.vx = 0; this.body.vz = 0;
  }

  /** Push the body (knockback, lunge recoil). */
  impulse(vx: number, vz: number): void { this.body.vx += vx; this.body.vz += vz; }

  // ------------------------------------------------------------------ per frame

  step(dt: number, w: BrainWorld): void {
    if (this.mode === 'dead') return;
    const b = this.body, host = w.host;
    if (this.lurk) {
      // Lying in wait: no senses, no movement, until the host walks into reach.
      if (host.alive && !host.hidden && Math.hypot(host.x - b.x, host.z - b.z) <= this.lurk.range) {
        this.reveal();
        this.alert({ x: host.x, z: host.z });
      } else { b.vx = 0; b.vz = 0; this.excite = 0; return; }
    }
    this.phaseTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.awareness.update(dt, b.x, b.z, b.yaw, host, w.noises);
    if (this.pendingFix && host.alive && !host.hidden) { this.awareness.lastKnown = { x: host.x, z: host.z }; this.pendingFix = false; }

    const lostHost = !host.alive || host.hidden;
    if (lostHost && this.mode !== 'calm' && this.mode !== 'stagger') this.calmDown(w);

    if (this.mode === 'stagger') {
      this.staggerFor -= dt;
      this.slow(dt, 6);
      if (this.staggerFor <= 0) { this.mode = lostHost ? 'calm' : 'hunt'; this.setPhase('recover'); }
    } else if (!lostHost && (this.awareness.hunting || this.pendingHunt) && this.mode !== 'hunt') {
      this.mode = 'hunt';
      this.awareness.level = 1;
      this.events.push({ type: 'alert' });
      this.setPhase('engage');
      this.onEngage(w);
    } else if (this.mode === 'calm' && this.awareness.suspicious && this.awareness.lastKnown) {
      this.mode = 'investigate';
      this.investigateFor = AI.awareness.investigateTime;
      this.events.push({ type: 'notice', at: { ...this.awareness.lastKnown } });
    }

    if (this.mode !== 'stagger') this.pendingHunt = false;
    switch (this.mode) {
      case 'calm': this.calm(dt, w); break;
      case 'investigate': this.investigate(dt, w); break;
      case 'hunt': {
        const fresh = this.awareness.sinceSeen < TRACK_GRACE;
        if (this.awareness.sinceSeen > this.data.perception.loseInterest) {
          this.mode = 'investigate';
          this.investigateFor = AI.awareness.investigateTime;
          this.awareness.level = Math.min(this.awareness.level, 0.99);
          this.releaseToken(w);
          this.onInterrupted();
          break;
        }
        if (fresh) {
          const tgt = { x: host.x, y: host.y, z: host.z };
          this.awareness.lastKnown = { x: host.x, z: host.z };
          const dx = tgt.x - b.x, dz = tgt.z - b.z;
          const dist = Math.hypot(dx, dz) || 1e-6;
          this.hunt(dt, w, tgt, dist, dx / dist, dz / dist);
        } else this.search(dt, w);
        break;
      }
    }
    this.excite = damp(this.excite, this.mode === 'hunt' ? 1 : this.mode === 'investigate' ? 0.45 : 0, 3, dt);
    this.integrate(dt, w);
  }

  // ------------------------------------------------------------------ archetype hooks

  /** Hunting a host it can track. `dirX/dirZ` is the unit direction to the host. */
  protected abstract hunt(dt: number, w: BrainWorld, host: Vec3, dist: number, dirX: number, dirZ: number): void;
  protected onEngage(_w: BrainWorld): void { /* optional */ }
  /** Lost the target or got staggered mid-attack: drop wind-ups. */
  protected onInterrupted(): void { this.windup = 0; this.strike = null; }
  protected onHurt(): void { /* optional */ }
  /** Height above ground while calm/investigating (flyers override). */
  protected cruiseAltitude(): number { return 0; }

  // ------------------------------------------------------------------ shared behaviours

  protected calm(dt: number, _w: BrainWorld): void {
    this.look = null;
    this.windup = damp(this.windup, 0, 6, dt);
    this.body.altitude = damp(this.body.altitude, this.cruiseAltitude(), 1.5, dt);
    if (this.pauseFor > 0) { this.pauseFor -= dt; this.slow(dt, 4); return; }
    // Strayed past the leash (after a chase): walk home.
    const fromHome = Math.hypot(this.body.x - this.home.x, this.body.z - this.home.z);
    if (fromHome > this.roam) { this.wanderTo = null; this.moveToward(this.home.x, this.home.z, this.data.speed * AI.wander.speedFactor, 3, dt); return; }
    if (!this.wanderTo) {
      const a = this.rand() * Math.PI * 2, r = this.rand() * this.roam;
      this.wanderTo = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
    }
    const dx = this.wanderTo.x - this.body.x, dz = this.wanderTo.z - this.body.z;
    if (Math.hypot(dx, dz) < 0.8 || this.phaseTime > 12) {
      this.wanderTo = null;
      this.phaseTime = 0;
      const [a, c] = AI.wander.pause;
      this.pauseFor = a + this.rand() * (c - a);
      return;
    }
    this.moveToward(this.wanderTo.x, this.wanderTo.z, this.data.speed * AI.wander.speedFactor, 3, dt);
  }

  protected investigate(dt: number, _w: BrainWorld): void {
    const lk = this.awareness.lastKnown;
    this.investigateFor -= dt;
    this.body.altitude = damp(this.body.altitude, this.cruiseAltitude(), 1.5, dt);
    if (!lk || (this.investigateFor <= 0 && !this.awareness.suspicious)) {
      this.mode = 'calm';
      this.phaseTime = 0;
      return;
    }
    this.look = { x: lk.x, y: 1, z: lk.z };
    const d = Math.hypot(lk.x - this.body.x, lk.z - this.body.z);
    if (d > 1.5) this.moveToward(lk.x, lk.z, this.data.speed * 0.5, 3, dt);
    else this.sweep(dt);
  }

  /** Hunting but the trail is cold: run to the last known point, then sweep the area. */
  protected search(dt: number, w: BrainWorld): void {
    this.releaseToken(w);
    this.windup = damp(this.windup, 0, 6, dt);
    this.strike = null;
    const lk = this.awareness.lastKnown;
    if (!lk) { this.sweep(dt); return; }
    this.look = { x: lk.x, y: 1, z: lk.z };
    const d = Math.hypot(lk.x - this.body.x, lk.z - this.body.z);
    if (d > 2) this.moveToward(lk.x, lk.z, this.data.speed * 0.85, 4, dt);
    else this.sweep(dt);
    this.setPhase('search');
  }

  private sweep(dt: number): void {
    this.slow(dt, 4);
    this.searchYaw += dt * 1.4;
    this.face(this.body.yaw + Math.sin(this.searchYaw) * 1.2, 1.5, dt);
  }

  private calmDown(w: BrainWorld): void {
    this.mode = 'calm';
    this.awareness.level = 0;
    this.releaseToken(w);
    this.onInterrupted();
    this.look = null;
  }

  // ------------------------------------------------------------------ helpers

  protected setPhase(p: string): void { if (this.phase !== p) { this.phase = p; this.phaseTime = 0; } }

  protected requestToken(w: BrainWorld): boolean { return w.tokens.request(this.id, this.tokenKind); }
  protected releaseToken(w: BrainWorld): void { w.tokens.release(this.id); }
  /** Keep a held token alive while committed to an attack. */
  protected keepToken(w: BrainWorld): void { if (w.tokens.holds(this.id)) w.tokens.request(this.id, this.tokenKind); }

  /** Turn toward a yaw at `rate` rad/s. Returns the remaining angle (radians, signed). */
  protected face(yaw: number, rate: number, dt: number): number {
    const d = wrapAngle(yaw - this.body.yaw);
    const step = Math.max(-rate * dt, Math.min(rate * dt, d));
    this.body.yaw = wrapAngle(this.body.yaw + step);
    return d - step;
  }
  protected yawTo(x: number, z: number): number { return Math.atan2(x - this.body.x, z - this.body.z); }

  /** Steer velocity toward (vx, vz) with exponential response `k`. */
  protected steer(vx: number, vz: number, k: number, dt: number): void {
    this.body.vx = damp(this.body.vx, vx, k, dt);
    this.body.vz = damp(this.body.vz, vz, k, dt);
  }
  protected slow(dt: number, k: number): void { this.steer(0, 0, k, dt); }

  /** Face and walk toward a point (walkers move where they face). */
  protected moveToward(x: number, z: number, speed: number, k: number, dt: number): void {
    this.face(this.yawTo(x, z), this.turnRate, dt);
    const dx = x - this.body.x, dz = z - this.body.z;
    const d = Math.hypot(dx, dz) || 1;
    // Slow on sharp turns so heavy bodies swing round instead of sliding sideways.
    const ahead = Math.max(0.25, Math.cos(wrapAngle(Math.atan2(dx, dz) - this.body.yaw)));
    this.steer((dx / d) * speed * ahead, (dz / d) * speed * ahead, k, dt);
  }

  private integrate(dt: number, w: BrainWorld): void {
    const b = this.body;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    // Separation: creatures of a kind do not stack (other kinds may brush past; a Mournback shoulders everything).
    for (const o of w.allies) {
      if (o.id === this.id || !o.alive) continue;
      const dx = b.x - o.position.x, dz = b.z - o.position.z;
      const d2 = dx * dx + dz * dz;
      const min = o.kind === this.kind ? this.radius * 2 * AI.separation : this.radius * AI.separation;
      if (d2 > 1e-6 && d2 < min * min) {
        const d = Math.sqrt(d2), push = (min - d) * 0.5;
        b.x += (dx / d) * push; b.z += (dz / d) * push;
      }
    }
    // Ground creatures cannot stand inside the host.
    if (this.cruiseAltitude() === 0 && w.host.alive) {
      const dx = b.x - w.host.x, dz = b.z - w.host.z, d = Math.hypot(dx, dz), min = this.radius + 0.4;
      if (d > 1e-3 && d < min) { b.x += (dx / d) * (min - d); b.z += (dz / d) * (min - d); }
    }
    const r = Math.hypot(b.x, b.z), edge = w.playableRadius * 0.98;
    if (r > edge) { b.x *= edge / r; b.z *= edge / r; }
  }
}
