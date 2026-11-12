/**
 * The Nethermaw in a raid. Joins the renderer-free brain (src/ai/nethermaw.ts), Creature's body
 * (src/creatures/zones/nethermaw.ts) and World's Undermouth (src/world/pit.ts: the arena, its four root columns and
 * the bridge walkways): Biomass, weak points (lobes while they swell, root columns any time), hit tests, and the
 * brain's events turned into what they do to the host. Every number comes from data/bosses.json `nethermaw` and
 * data/ai.json `nethermaw`; the raid applies the results (src/game/raid.ts): host damage, Overload, the pull, the
 * Hollowed, the torn walkways, the false lights and rewards.
 */
import * as THREE from 'three';
import { BOSSES, type Boss } from '../../data';
import { NethermawBrain, type HostView, type NethermawEvent, type NethermawPit } from '../ai';
import { Nethermaw, type NethermawHit } from '../creatures/zones/nethermaw';
import type { ArenaInfo, Walkway } from '../world/structures';
import { segmentSphere } from './projectiles';
import type { HostStrike } from './boss';

/** A root column as something a shot can hit: three spheres up its trunk. */
export interface ColumnHit { tag: 'column'; index: number; world: THREE.Vector3; r: number }
export type MawHit = NethermawHit | ColumnHit;

export interface NethermawFrame {
  strikes: HostStrike[];
  events: NethermawEvent[];
  /** Hollowed to send up out of the mouth: `count` of `type` at (x, z). */
  brood: { type: string; x: number; z: number; count: number }[];
  /** Overload to add this frame (pulses, traps and the whisper). */
  overload: number;
  /** The pull toward the mouth this frame (m/s, XZ), zero for none. */
  pull: { x: number; z: number };
  /** Walkway ids torn loose this frame. */
  cut: string[];
}

/** How far past the first body surface a shot can still reach an exposed weak point. */
const WEAK_DEPTH = 1.5;
/** Column hit spheres: heights up the trunk (m above the floor) and radius. */
const COLUMN_SPHERES = [1.5, 4, 6.5];
const COLUMN_R = 1.3;

export class RaidNethermaw {
  readonly t: Boss;
  readonly brain: NethermawBrain;
  readonly body: Nethermaw;
  readonly id = 'nethermaw';
  readonly pit: NethermawPit;
  biomass: number;
  readonly lobes: number[];
  readonly columns: number[];
  private columnHits: ColumnHit[] = [];

  constructor(readonly arena: ArenaInfo, readonly walkways: Walkway[] = [], scene?: THREE.Object3D, seed = 23) {
    this.t = BOSSES[this.id];
    const mawRadius = arena.pool?.radius ?? 7;
    this.pit = { x: arena.x, z: arena.z, floorY: arena.floorY, mawRadius, radius: arena.radius };
    this.body = new Nethermaw(seed, scene);
    this.body.root.position.set(arena.bossSpawn?.x ?? arena.x, arena.floorY, arena.bossSpawn?.z ?? arena.z);
    this.body.root.updateMatrixWorld(true);
    // Each lobe's bearing round the mouth, as the body grew it.
    const bearings = this.body.weakPoints.map((w) => { const p = w.mesh.position; return Math.atan2(p.z, p.x); });
    this.brain = new NethermawBrain(this.body.root.position.x, this.body.root.position.z, bearings, seed);
    const wp = this.t.weakPoints as { lobes: { count: number; biomassEach: number }; rootColumns: { count: number; biomassEach: number } };
    this.biomass = this.t.biomass;
    this.lobes = bearings.map(() => wp.lobes.biomassEach);
    const cols = arena.pillars.filter((p) => p.id.startsWith('root-column'));
    this.columns = cols.map(() => wp.rootColumns.biomassEach);
    cols.forEach((c, i) => {
      for (const y of COLUMN_SPHERES) this.columnHits.push({ tag: 'column', index: i, world: new THREE.Vector3(c.x, arena.floorY + y, c.z), r: COLUMN_R });
    });
    this.sync();
  }

  get alive(): boolean { return this.brain.state !== 'dead'; }
  get awake(): boolean { return this.brain.state === 'awake'; }
  get fraction(): number { return this.biomass / this.t.biomass; }
  get position(): THREE.Vector3 { return this.body.root.position; }
  get columnsBroken(): number { return this.columns.filter((c) => c <= 0).length; }

  centre(out = new THREE.Vector3()): THREE.Vector3 { return out.copy(this.position).add(new THREE.Vector3(0, 3, 0)); }

  /** True when this sphere takes weak-point damage right now. */
  exposed(s: MawHit): boolean {
    if (s.tag === 'lobe') return this.brain.lobeExposed(s.index) && (this.lobes[s.index] ?? 0) > 0;
    if (s.tag === 'column') return (this.columns[s.index] ?? 0) > 0;
    return false;
  }

  /** What a segment hits: a swollen lobe or a standing root column first (within reach), else the body. */
  hit(a: THREE.Vector3, b: THREE.Vector3): { t: number; sphere: MawHit } | null {
    if (!this.alive) return null;
    const len = a.distanceTo(b) || 1;
    let near: { t: number; sphere: MawHit } | null = null, weak: { t: number; sphere: MawHit } | null = null;
    const spheres: MawHit[] = [...this.body.hitSpheres, ...this.columnHits];
    for (const s of spheres) {
      if (s.r <= 0) continue;
      if (s.tag === 'column' && !this.exposed(s)) continue;
      const t = segmentSphere(a, b, s.world, s.r);
      if (t === null) continue;
      if (this.exposed(s)) { if (!weak || t < weak.t) weak = { t, sphere: s }; }
      else if (!near || t < near.t) near = { t, sphere: s };
    }
    if (weak && (weak.sphere.tag === 'column' || !near || (weak.t - near.t) * len <= WEAK_DEPTH)) return weak;
    return near;
  }

  /** Applies a hit (`sphere` null: splash on the body). */
  damage(amount: number, sphere: MawHit | null): { dealt: number; killed: boolean; weak: boolean; popped: string | null } {
    if (!this.alive || amount <= 0) return { dealt: 0, killed: false, weak: false, popped: null };
    const wp = this.t.weakPoints as { lobes: { multiplier: number } };
    let dealt = amount * this.brain.bodyMultiplier(), weak = false, popped: string | null = null;
    if (sphere?.tag === 'column') {
      // A root column is the pit's, not the body's: breaking it weakens the pulses and costs the Nethermaw its share.
      if (this.columns[sphere.index] <= 0) return { dealt: 0, killed: false, weak: false, popped: null };
      dealt = Math.min(amount, this.columns[sphere.index]);
      this.columns[sphere.index] -= dealt;
      weak = true;
      if (this.columns[sphere.index] <= 0) {
        const id = this.arena.pillars.filter((p) => p.id.startsWith('root-column'))[sphere.index]?.id;
        if (id) this.arena.pillars.find((p) => p.id === id)?.destroy();
        popped = id ?? `root-column-${sphere.index}`;
      }
    } else if (sphere && this.exposed(sphere)) {
      weak = true;
      dealt = amount * wp.lobes.multiplier;
      this.lobes[sphere.index] = Math.max(0, this.lobes[sphere.index] - dealt);
      if (this.lobes[sphere.index] === 0) { this.body.popWeakPoint(sphere.index); this.brain.burstLobe(sphere.index); popped = `lobe${sphere.index}`; }
    }
    this.biomass = Math.max(0, this.biomass - dealt);
    this.brain.hurt(dealt, sphere?.tag === 'lobe' ? sphere.index : -1);
    this.body.hurt(1 - this.fraction);
    if (this.biomass > 0) return { dealt, killed: false, weak, popped };
    this.brain.kill();
    this.body.destroy();
    return { dealt, killed: true, weak, popped };
  }

  update(dt: number, host: HostView): NethermawFrame {
    const out: NethermawFrame = { strikes: [], events: [], brood: [], overload: 0, pull: { x: 0, z: 0 }, cut: [] };
    if (this.alive) {
      const b = this.brain, P = this.pit;
      b.step(dt, { host, fraction: this.fraction, pit: P, columnsBroken: this.columnsBroken });
      this.sync();
      const mouth = new THREE.Vector3(P.x, P.floorY, P.z);
      const dx = host.x - P.x, dz = host.z - P.z, d = Math.hypot(dx, dz);
      for (const e of b.events) {
        out.events.push(e);
        switch (e.type) {
          case 'stir': this.body.raise(); break;
          case 'pulse':
            this.body.pulse(e.lobe);
            if (host.alive && d <= e.radius) { out.strikes.push({ damage: e.damage, source: 'spore pulse', from: mouth.clone(), knock: 4 }); out.overload += e.overload; }
            break;
          case 'trap':
            if (host.alive && Math.hypot(host.x - e.at.x, host.z - e.at.z) <= e.radius) { out.strikes.push({ damage: e.damage, source: 'false light', from: new THREE.Vector3(e.at.x, P.floorY, e.at.z), knock: 5 }); out.overload += e.overload; }
            break;
          case 'falseLight': this.body.dreamLight(); break;
          case 'roots':
            if (host.alive && Math.hypot(host.x - e.at.x, host.z - e.at.z) <= e.radius && Math.abs(host.y - e.y) < 3) {
              // From the nearest wall: outward from the mouth.
              const wall = new THREE.Vector3(e.at.x + (dx / (d || 1)) * 4, e.y, e.at.z + (dz / (d || 1)) * 4);
              out.strikes.push({ damage: e.damage, source: 'wall roots', from: wall, knock: 7 });
            }
            break;
          case 'raise': {
            const p = this.body.risePoint.getWorldPosition(new THREE.Vector3());
            out.brood.push({ type: e.spawnType, count: e.count, x: p.x, z: p.z });
            break;
          }
          case 'collapse': {
            const w = this.walkways.filter((x) => !x.isCut).sort((a, c) => a.y - c.y);
            // Two planks at a time, so a tear is something you see go.
            for (const x of w.slice(0, 2)) { x.cut(); out.cut.push(x.id); }
            break;
          }
          default: break;
        }
      }
      b.events.length = 0;
      if (host.alive) {
        // The updraft pull and the swallow: toward the mouth, harder the closer you are.
        if (b.pull.speed > 0 && d <= b.pull.radius && d > 0.3) {
          const k = b.pull.speed * (0.4 + 0.6 * (1 - d / b.pull.radius));
          out.pull = { x: (-dx / d) * k, z: (-dz / d) * k };
        }
        if (b.mouthDps > 0 && d <= P.mawRadius && host.y - P.floorY < 3) out.strikes.push({ damage: b.mouthDps * dt, source: 'the mouth', from: null });
        if (b.whisper.perSecond > 0 && d <= b.whisper.radius) out.overload += b.whisper.perSecond * dt;
      }
    }
    this.body.update(dt);
    return out;
  }

  /** Copies the brain onto Creature's body. */
  private sync(): void {
    const b = this.brain, d = this.body.drive;
    d.breath = b.breath;
    for (let i = 0; i < d.swell.length; i++) d.swell[i] = b.swell[i] ?? 0;
    d.phase = b.phase.id as typeof d.phase;
    d.look = b.look ? (d.look ?? new THREE.Vector3()).set(b.look.x, this.pit.floorY + 1.5, b.look.z) : null;
  }
}
