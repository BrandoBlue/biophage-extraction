/**
 * Shared PvE brain. Owns a creature's awareness, movement and facing; the archetype subclasses (behaviours/*) only
 * decide what to do while hunting a host they can track. Output is read by the Abomination each frame and maps 1:1
 * onto Creature.drive (velocity, look, excite, windup, strike, altitude) plus camouflage visibility and one-shot
 * events (melee, spit, screech, slam, charge, notice, alert).
 *
 *   calm ──(suspicious)──▶ investigate ──(awareness 1)──▶ hunt ──(lost for loseInterest)──▶ investigate ──▶ calm / ambush
 *     ▲                                                    │ ▲
 *     └──────────── host dead / hidden ◀───────────────────┘ └── stagger (from damage) returns here
 */
import { AI, type Abomination as AbominationData } from '../../data';
import { mulberry32 } from '../world/zone7';
import { Awareness } from './senses';
import type { TokenKind } from './tokens';
import type { AIEvent, BrainWorld, Intent, Mode, Tactic, Vec2, Vec3 } from './types';

export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (a: number, b: number, k: number, dt: number) => b + (a - b) * Math.exp(-k * dt);

/** Seconds a hunter keeps tracking the host's true position after losing sight (scent, footfalls). */
const TRACK_GRACE = 1.5;
/** Tuning that makes hunters frightening: the stare, the fanned-out search, the ambush, the wounded retreat. */
const M = AI.menace;
const T = AI.tactics;
/** Phases where an archetype has committed to an attack: no tactic interrupts these. */
const COMMITTED = /windup|lunge|burst|ripple|charge|stampede|dive|strike|rack|spit|tell|rear/;

export type LurkHow = 'hatch' | 'disguise' | 'ambush';

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
  /** 0..1 how far under the sand or water it is (burrowers, swimmers); above 0.5 it cannot be hit. */
  submerged = 0;
  /** 0..1 the species action the new-zone bodies play (quill volley, shear cut, grab...). */
  action = 0;
  /** What it is thinking right now (stare, stalk, lure, evade, press, falter...): the readable intent. */
  intent: Intent = 'idle';
  /** One-shot events since the owner last drained them. */
  readonly events: AIEvent[] = [];
  readonly awareness: Awareness;

  protected readonly rand: () => number;
  protected home: Vec2;
  /** Leash: how far it wanders from home while calm; past it, it drifts back (habitats.json `roam`). */
  protected roam = AI.wander.radius;
  /** Calm height for flyers that roost (habitats.json `height`); null: the archetype's own. */
  protected roost: number | null = null;
  /**
   * Lying in wait: in a tank until the host comes within `range` (hatch), posing as a crate (disguise), or crouched
   * motionless where it lost the host's trail (ambush, gives up after `time` s).
   */
  private lurk: { how: LurkHow; range: number; time: number } | null = null;
  /** Saw the host itself: holds still and stares for this long before it comes (ai.json menace.reaction). */
  private spotFor = 0;
  /** The host's velocity the last time it was tracked, so a cold search heads where it was going. */
  private hostVel: Vec2 = { x: 0, z: 0 };
  /** Cold-trail search: the point this searcher is checking, and how many it has checked. */
  private searchTo: Vec2 | null = null;
  private searchPts = 0;
  private sweepFor = 0;
  /** Chased the host this encounter (an ambush is only laid after a real chase). */
  private chased = false;
  /** Biomass left, 0..1 (from the Abomination). Below menace.wounded.limpBelow it limps. */
  private woundLeft = 1;
  private fleeFor = 0;
  private fled = false;
  /** Archetypes that crouch in wait where they lost the host (swarm, stalker). */
  protected readonly ambusher: boolean = false;
  /** Archetypes that break off to run when badly hurt (not the tank). */
  protected readonly flees: boolean = true;
  /** Agile archetypes that juke sideways when the host aims at them and fires (swarm, flyer). */
  protected readonly dodges: boolean = false;
  private dodgeCd = 0;
  // Tactics (ai.json tactics): readable decisions layered over every archetype's hunt.
  private aimedFor = 0;
  private evadeFor = 0;
  private evadeCd = 0;
  private evadeSide = 1;
  private lureFor = 0;
  private lureShow = 0;
  private falterFor = 0;
  /** Packmates of its kind it could count at the start of this hunt, and how many are alive now. */
  private packStart = -1;
  private readonly pack = new Set<number>();
  private packLost = 0;
  private routed = false;
  private wasReloading = false;
  private pressing = false;
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
    if (o.hatchOnApproach) this.lurk = { how: 'hatch', range: o.hatchOnApproach, time: Infinity };
    else if (o.disguise) this.lurk = { how: 'disguise', range: this.data.attackRange + 1.5, time: Infinity };
  }

  /** Still in its tank, disguise or ambush (the body should show the tank or the crate, or crouch). */
  get lurking(): boolean { return this.lurk !== null; }
  /** How it is lying in wait, if it is. */
  get lurkHow(): LurkHow | null { return this.lurk?.how ?? null; }
  /** Wounded enough to limp, or running to recover. */
  get wounded(): boolean { return this.woundLeft < M.wounded.limpBelow; }

  /** A disguise or trap the archetype runs itself just dropped (the Husk Mimic). */
  protected unmask(how: LurkHow): void { this.events.push({ type: 'reveal', how }); }

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
    // Called by the pack: no more staring, it comes.
    if (this.mode === 'hunt' && this.spotFor > 0) this.spotFor = Math.min(this.spotFor, 0.05);
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
  hurt(): void { this.reveal(); this.spotFor = 0; this.alert(null); this.onHurt(); }

  /** Biomass left as a fraction (0..1). Badly hurt, it may break off and run, then return with its pack. */
  wound(left: number): void {
    this.woundLeft = Math.max(0, Math.min(1, left));
    if (this.flees && !this.fled && this.mode !== 'dead' && this.woundLeft > 0 && this.woundLeft < M.wounded.fleeBelow) {
      this.fled = true;
      if (this.rand() < M.wounded.fleeChance) this.fleeFor = M.wounded.fleeTime;
    }
  }

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
      this.lurk.time -= dt;
      if (host.alive && !host.hidden && Math.hypot(host.x - b.x, host.z - b.z) <= this.lurk.range) {
        this.reveal();
        this.alert({ x: host.x, z: host.z });
      } else if (this.lurk.time <= 0) {
        this.lurk = null; // the ambush went cold: slink home
        this.mode = 'calm'; this.phaseTime = 0;
      } else { b.vx = 0; b.vz = 0; this.excite = 0; this.look = null; this.windup = 0; return; }
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
      // It found the host itself (not told by a packmate or a wound): it stops dead and stares before it comes.
      const [r0, r1] = M.reaction;
      this.spotFor = this.pendingHunt ? 0 : r0 + this.rand() * (r1 - r0);
      const foundIt = !this.pendingHunt;
      this.mode = 'hunt';
      this.chased = true;
      this.awareness.level = 1;
      // A pack hunter that found the host itself may lure it back to the others instead of calling them in.
      const lureKey = `lure:${this.kind}`;
      if (foundIt && this.uses('lure') && !w.tokens.sharedReady(lureKey, T.lure.time)) {
        // A packmate is already luring this host: it holds still and watches, waiting for the pack to be sprung.
        this.spotFor = T.lure.time;
      } else if (foundIt && this.uses('lure') && this.packCount(w, T.lure.radius) >= T.lure.packMin && this.rand() < T.lure.chance) {
        w.tokens.useShared(lureKey);
        this.lureFor = T.lure.time; this.lureShow = T.lure.show;
        this.tactic('lure');
      } else this.events.push({ type: 'alert' });
      this.setPhase(this.spotFor > 0 ? 'spot' : 'engage');
      if (this.spotFor <= 0) this.onEngage(w);
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
        if (this.fleeFor > 0) { this.flee(dt, w); break; }
        if (this.spotFor > 0) {
          this.spotFor -= dt;
          this.slow(dt, 8);
          this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
          this.look = { x: host.x, y: host.y + 1.5, z: host.z };
          this.windup = 0;
          if (this.spotFor <= 0) { this.setPhase('engage'); this.onEngage(w); }
          break;
        }
        if (fresh) {
          const tgt = { x: host.x, y: host.y, z: host.z };
          this.awareness.lastKnown = { x: host.x, z: host.z };
          this.hostVel = { x: host.vx, z: host.vz };
          this.searchTo = null; this.searchPts = 0;
          const dx = tgt.x - b.x, dz = tgt.z - b.z;
          const dist = Math.hypot(dx, dz) || 1e-6;
          if (!this.tactics(dt, w, tgt, dist, dx / dist, dz / dist)) {
            this.hunt(dt, w, tgt, dist, dx / dist, dz / dist);
            this.dodge(dt, w, dist);
          }
        } else this.search(dt, w);
        break;
      }
    }
    this.excite = damp(this.excite, this.mode === 'hunt' ? 1 : this.mode === 'investigate' ? 0.45 : 0, 3, dt);
    this.intent = this.readIntent();
    this.integrate(dt, w);
  }

  // ------------------------------------------------------------------ tactics: readable thinking

  private uses(t: keyof typeof T.uses): boolean { return T.uses[t].includes(AI.archetypes[this.kind] ?? 'swarm'); }

  /** Living creatures of its own kind within `r` m (not itself). */
  private packCount(w: BrainWorld, r: number): number {
    let n = 0;
    for (const a of w.allies) if (a.id !== this.id && a.kind === this.kind && a.alive && Math.hypot(a.position.x - this.body.x, a.position.z - this.body.z) <= r) n++;
    return n;
  }

  private tactic(what: Tactic): void { this.events.push({ type: 'tactic', what }); }

  /** Mid-attack: wind-up, lunge, burst... nothing breaks that, so committed attacks stay punishable. */
  protected get committed(): boolean {
    if (COMMITTED.test(this.phase)) return true;
    // A swarm's feint in the ring is a fake-out, not a commitment.
    return this.phase !== 'ring' && (this.windup > 0.05 || this.strike !== null);
  }

  /**
   * Decisions any hunter can make over its archetype's own hunt, each with a tell: luring the host back to its pack,
   * faltering when a packmate falls, breaking out of a held aim, pressing in while the host reloads. Returns true when
   * a tactic moved the body this frame (the archetype's hunt is skipped).
   */
  private tactics(dt: number, w: BrainWorld, host: Vec3, dist: number, dx: number, dz: number): boolean {
    const h = w.host, t = this.data;
    this.evadeCd = Math.max(0, this.evadeCd - dt);
    // Packmates falling.
    if (this.uses('falter')) {
      // Track the packmates close by; one that dies (not one that wanders off) is a loss it sees.
      let fell = 0;
      for (const id of this.pack) {
        let a: (typeof w.allies)[number] | undefined;
        for (const o of w.allies) if (o.id === id) { a = o; break; }
        if (!a || !a.alive) { this.pack.delete(id); fell++; }
      }
      for (const a of w.allies) if (a.id !== this.id && a.kind === this.kind && a.alive && Math.hypot(a.position.x - this.body.x, a.position.z - this.body.z) <= T.falter.radius) this.pack.add(a.id);
      this.packLost += fell;
      this.packStart = Math.max(this.packStart, this.pack.size + this.packLost);
      if (fell > 0 && !this.committed) {
        if (!this.routed && this.packStart >= 2 && this.packLost >= this.packStart * T.falter.rout) {
          this.routed = true; this.fleeFor = M.wounded.fleeTime * 1.5; this.lureFor = 0;
          this.tactic('rout');
        } else { this.falterFor = T.falter.time; this.lureFor = 0; this.tactic('falter'); }
        this.releaseToken(w);
      }
    }
    // The reload: a window, and they know it.
    const reloading = !!h.reloading && dist <= T.reload.range && this.uses('press');
    if (reloading && !this.wasReloading) {
      this.cooldown = 0; this.falterFor = 0; this.evadeFor = 0; this.aimedFor = 0;
      if (this.lureFor > 0) { this.lureFor = 0; this.spring(w); }
      if (w.tokens.sharedReady('press', T.reload.callCooldown)) { w.tokens.useShared('press'); this.tactic('press'); }
    }
    this.wasReloading = reloading;
    this.pressing = reloading;
    if (this.fleeFor > 0) return false;
    // Luring: stand in plain view, then back away toward the pack, watching the host, and spring it.
    if (this.lureFor > 0) {
      this.lureFor -= dt;
      this.look = { x: host.x, y: host.y + 1.5, z: host.z };
      this.windup = 0;
      this.setPhase('lure');
      this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
      let cx = 0, cz = 0, n = 0;
      for (const a of w.allies) if (a.id !== this.id && a.kind === this.kind && a.alive && Math.hypot(a.position.x - this.body.x, a.position.z - this.body.z) <= T.lure.radius) { cx += a.position.x; cz += a.position.z; n++; }
      if (n === 0) { this.lureFor = 0; this.spring(w); return false; }
      cx /= n; cz /= n;
      if (this.lureShow > 0) { this.lureShow -= dt; this.slow(dt, 6); }
      else {
        const tx = cx - this.body.x, tz = cz - this.body.z, tl = Math.hypot(tx, tz);
        const sp = t.speed * T.lure.backoff;
        if (tl > 1.5) this.steer((tx / tl) * sp, (tz / tl) * sp, 4, dt); else this.slow(dt, 4);
      }
      if (this.lureFor <= 0 || Math.hypot(h.x - cx, h.z - cz) <= T.lure.spring || dist < t.attackRange * 1.5) { this.lureFor = 0; this.spring(w); }
      return true;
    }
    // A packmate just fell: it stops, watches the host and edges back.
    if (this.falterFor > 0) {
      this.falterFor -= dt;
      this.windup = 0; this.strike = null;
      this.setPhase('falter');
      this.look = { x: host.x, y: host.y + 1.2, z: host.z };
      this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
      this.steer(-dx * t.speed * T.falter.backoff, -dz * t.speed * T.falter.backoff, 4, dt);
      if (this.falterFor <= 0) this.setPhase('engage');
      return true;
    }
    // Held in the host's sights: it breaks sideways out of the line rather than walking into it.
    const f = h.forward;
    if (this.uses('evade') && f && !this.pressing && !this.committed && dist <= T.aim.range) {
      const cos = (-dx * f.x + -dz * f.z);
      const inside = cos >= Math.cos((T.aim.cone * Math.PI) / 360);
      this.aimedFor = inside ? this.aimedFor + dt * (h.aiming ? T.aim.adsFactor : 1) : Math.max(0, this.aimedFor - dt * 2);
      if (this.aimedFor >= T.aim.hold && this.evadeCd <= 0 && this.evadeFor <= 0) {
        // Out of the cone on whichever side it is already nearer.
        this.evadeSide = (f.x * -dz - f.z * -dx) >= 0 ? -1 : 1;
        this.evadeFor = T.aim.time; this.evadeCd = T.aim.cooldown; this.aimedFor = 0;
        this.releaseToken(w);
        this.tactic('evade');
      }
    } else this.aimedFor = 0;
    if (this.evadeFor > 0) {
      this.evadeFor -= dt;
      const sp = t.speed * T.aim.speed, s = this.evadeSide;
      this.steer(-dz * s * sp, dx * s * sp, 8, dt);
      this.face(this.yawTo(host.x, host.z), this.turnRate, dt);
      this.look = { x: host.x, y: host.y + 1.2, z: host.z };
      this.windup = 0;
      this.setPhase('evade');
      if (this.evadeFor <= 0) this.setPhase('engage');
      return true;
    }
    return false;
  }

  /** The lure is sprung: the whole pack comes at once. */
  private spring(w: BrainWorld): void {
    this.tactic('spring');
    this.events.push({ type: 'alert' });
    this.events.push({ type: 'alarm', radius: T.lure.radius });
    this.setPhase('engage');
    this.onEngage(w);
  }

  private readIntent(): Intent {
    switch (this.mode) {
      case 'dead': return 'dead';
      case 'calm': return 'idle';
      case 'investigate': return 'wary';
      case 'stagger': return 'reel';
    }
    if (this.fleeFor > 0 || this.phase === 'flee') return 'flee';
    if (this.spotFor > 0) return 'stare';
    if (this.lureFor > 0) return 'lure';
    if (this.falterFor > 0) return 'falter';
    if (this.evadeFor > 0) return 'evade';
    if (this.phase === 'search') return 'search';
    if (this.committed) return 'attack';
    if (this.pressing) return 'press';
    if (/stalk|ring|circle|swim|orbit|kite|wheel|hover/.test(this.phase)) return 'stalk';
    return 'hunt';
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
      // After a real chase, a hunter may not go home at all: it crouches where the trail died and waits.
      if (this.chased && this.ambusher && this.rand() < M.ambush.chance) {
        this.lurk = { how: 'ambush', range: M.ambush.range, time: M.ambush.time };
      }
      this.chased = false;
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
    // Head where the host was going, not where it was; each searcher checks its own spot so a pack fans out.
    if (!this.searchTo) {
      const S = M.search;
      const sp = Math.hypot(this.hostVel.x, this.hostVel.z);
      const lead = Math.min(S.maxPredict, sp * S.predictTime) / (sp || 1);
      const a = this.id * 2.39996 + this.searchPts * 1.7 + this.rand() * 0.6;
      const r = this.searchPts === 0 && this.id % 3 === 0 ? 0 : S.spread * (0.5 + this.rand() * 0.5);
      this.searchTo = { x: lk.x + this.hostVel.x * lead + Math.cos(a) * r, z: lk.z + this.hostVel.z * lead + Math.sin(a) * r };
      this.sweepFor = S.sweepTime;
    }
    const t = this.searchTo;
    this.look = { x: t.x, y: 1, z: t.z };
    const d = Math.hypot(t.x - this.body.x, t.z - this.body.z);
    if (d > 2) this.moveToward(t.x, t.z, this.data.speed * 0.85, 4, dt);
    else {
      this.sweep(dt);
      this.sweepFor -= dt;
      if (this.sweepFor <= 0) { this.searchPts++; this.searchTo = null; this.hostVel = { x: 0, z: 0 }; }
    }
    this.setPhase('search');
  }

  /**
   * Under fire: if the host is aiming at it (inside menace.dodge.aimCone) and a shot just went off at the host, an
   * agile hunter may juke sideways. Never while winding up or lunging, so committed attacks stay punishable.
   */
  private dodge(dt: number, w: BrainWorld, dist: number): void {
    this.dodgeCd -= dt;
    const D = M.dodge, h = w.host, f = h.forward;
    if (!this.dodges || this.dodgeCd > 0 || !f || this.windup > 0.05 || this.strike || dist > D.range) return;
    const shot = w.noises.some((n) => Math.hypot(n.x - h.x, n.z - h.z) < 1.5 && n.radius >= D.minNoise);
    if (!shot) return;
    const tx = (this.body.x - h.x) / (dist || 1), tz = (this.body.z - h.z) / (dist || 1);
    if (f.x * tx + f.z * tz < Math.cos((D.aimCone * Math.PI) / 360)) return;
    this.dodgeCd = D.cooldown;
    if (this.rand() >= D.chance) return;
    const side = this.rand() < 0.5 ? -1 : 1;
    this.impulse(-tz * side * D.speed, tx * side * D.speed);
    this.setPhase(this.phase); // keep the archetype's sub-state
    this.events.push({ type: 'dodge' });
  }

  /** Badly hurt: breaks off and runs from the host, then turns and calls its pack before coming back. */
  private flee(dt: number, w: BrainWorld): void {
    this.fleeFor -= dt;
    this.releaseToken(w);
    this.onInterrupted();
    this.look = null;
    const h = w.host, dx = this.body.x - h.x, dz = this.body.z - h.z, d = Math.hypot(dx, dz) || 1;
    this.moveToward(this.body.x + (dx / d) * 10, this.body.z + (dz / d) * 10, this.data.speed, 6, dt);
    this.setPhase('flee');
    if (this.fleeFor <= 0) { this.events.push({ type: 'alert' }); this.setPhase('engage'); }
  }

  private sweep(dt: number): void {
    this.slow(dt, 4);
    this.searchYaw += dt * 1.4;
    this.face(this.body.yaw + Math.sin(this.searchYaw) * 1.2, 1.5, dt);
  }

  private calmDown(w: BrainWorld): void {
    this.mode = 'calm';
    this.chased = false; this.spotFor = 0; this.fleeFor = 0; this.searchTo = null;
    this.lureFor = 0; this.falterFor = 0; this.evadeFor = 0; this.packStart = -1; this.pack.clear(); this.packLost = 0; this.routed = false; this.pressing = false;
    this.awareness.level = 0;
    this.releaseToken(w);
    this.onInterrupted();
    this.look = null;
  }

  // ------------------------------------------------------------------ helpers

  protected setPhase(p: string): void { if (this.phase !== p) { this.phase = p; this.phaseTime = 0; } }

  protected requestToken(w: BrainWorld): boolean { return w.tokens.request(this.id, this.tokenKind, this.pressing ? T.reload.extraTokens : 0); }
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
    const gait = this.woundLeft < M.wounded.limpBelow ? M.wounded.limpFactor : 1;
    b.x += b.vx * dt * gait;
    b.z += b.vz * dt * gait;
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
