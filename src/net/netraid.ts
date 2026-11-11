/**
 * Online raid sync (Hive). Implements the RaidNet seam in src/game/raid.ts for one session.
 *
 * Who decides what:
 * - Each host owns its own body: movement, Biomass, death and extraction are simulated on its own machine and
 *   broadcast ~20 times a second. Everyone else plays that back as a RemoteHost with a short interpolation delay.
 * - Shots are replayed everywhere as harmless copies; the shooter's machine decides whom it hit (PvP and creatures).
 * - The squad leader's machine runs every creature brain, spawn and nest, and is the only one that changes creature
 *   Biomass. Guests forward their damage to it; it answers with snapshots, spawns and deaths (with kill credit).
 * - If the leader drops out, each guest takes over its own creatures and plays on solo.
 */
import * as THREE from 'three';
import type { Raid, NetTarget, RaidNet, ScannerPing } from '../game/raid';
import type { Abomination, AbominationKind, FollowState, HitSphere, State } from '../game/abominations';
import type { Noise } from '../game/perception';
import { segmentSphere, type Projectile } from '../game/projectiles';
import { hostVisibility } from '../ai';
import { ONLINE_TUNING } from './tuning';
import { FLAG, RemoteHost } from './avatar';
import {
  CREATURE_STATES, Interp, packCreature, packHost, type CreatureRow, type HostSnap, type RosterRow, type Member, type NetMsg, type V3,
} from './protocol';

/** What NetRaid needs from the session: who is who, and a way to send. */
export interface NetPeers {
  readonly selfId: string;
  readonly leaderId: string;
  /** True while this machine runs the creatures (the leader, or a guest whose leader has gone). */
  readonly authority: boolean;
  member(id: string): Member | undefined;
  readonly me: Member;
  send(m: NetMsg, to?: string): void;
}

type CSnap = { x: number; z: number; yaw: number; vx: number; vz: number; st: number; ex: number; wu: number; alt: number; vis: number; lx: number; ly: number; lz: number; hp: number };

const v3 = (v: THREE.Vector3): V3 => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
const vec = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
const NO_LOOK = -999;

export class NetRaid implements RaidNet {
  readonly remotes = new Map<string, RemoteHost>();
  private targetsOf = new Map<string, NetTarget>();
  /** Guests: the leader's creature id → this machine's creature. Leader: its own ids. */
  private byLeaderId = new Map<number, Abomination>();
  private leaderIdOf = new WeakMap<Abomination, number>();
  private csnaps = new Map<number, Interp<CSnap>>();
  /** Creatures this machine has at boot, in order (paired with the leader's roster at deploy). */
  private initial: Abomination[];
  /** Leader: creature ids every guest already knows. */
  private known = new Set<number>();
  private pendingNoises: Noise[] = [];
  private sinceHost = 0;
  private sinceCreatures = 0;
  private clock = 0;
  private sentDown = false;
  private sentOut = false;
  /** Bytes and messages out, for the test hook and tuning. */
  readonly stats = { sent: 0, received: 0 };

  constructor(private raid: Raid, private scene: THREE.Scene, private peers: NetPeers) {
    this.initial = raid.creatures.slice();
    raid.bus.on('raidEnd', (e) => {
      if (e.result === 'extracted' && !this.sentOut) { this.sentOut = true; this.sendHost(); this.send({ t: 'out' }); }
      if (e.result !== 'extracted' && !this.sentDown) { this.sentDown = true; this.sendHost(); this.send({ t: 'down', cause: raid.outcome?.cause ?? '' }); }
    });
  }

  get authority(): boolean { return this.peers.authority; }

  /** The leader's roster of boot creatures, sent with `start`: [id, kind, x, z, seed]. */
  roster(): RosterRow[] {
    return this.raid.creatures.map((c) => {
      this.known.add(c.id);
      return [c.id, c.kind, Math.round(c.position.x * 100) / 100, Math.round(c.position.z * 100) / 100, c.seed];
    });
  }

  /** Guests: pair the leader's boot roster with this machine's boot creatures (same seed builds the same raid). */
  adoptRoster(roster: RosterRow[]): void {
    const used = new Set<Abomination>();
    roster.forEach(([id, kind, x, z, seed], i) => {
      let c: Abomination | undefined = this.initial[i];
      if (!c || c.kind !== kind || used.has(c)) c = this.raid.netSpawn(kind as AbominationKind, x, z, seed);
      used.add(c);
      this.pair(id, c);
    });
    // Anything this machine built that the leader does not have would be a ghost: remove it.
    for (const c of this.initial) if (!used.has(c)) { c.killedRemotely(); c.root.visible = false; }
  }

  private pair(id: number, c: Abomination): void { this.byLeaderId.set(id, c); this.leaderIdOf.set(c, id); }
  private idOf(c: Abomination): number { return this.authority ? c.id : (this.leaderIdOf.get(c) ?? -1); }
  private creature(id: number): Abomination | undefined {
    return this.authority && !this.byLeaderId.size ? this.raid.creatures.find((c) => c.id === id) : (this.byLeaderId.get(id) ?? this.raid.creatures.find((c) => c.id === id && !this.leaderIdOf.has(c)));
  }

  private send(m: NetMsg, to?: string): void { this.stats.sent++; this.peers.send(m, to); }

  // ---------------------------------------------------------------------------------------------- per frame

  /** Called once per frame after raid.update: send our state, animate other hosts. */
  tick(dt: number): void {
    this.clock += dt;
    const T = ONLINE_TUNING;
    this.sinceHost += dt;
    if (this.sinceHost >= 1 / T.hostRate && this.raid.phase !== 'briefing') { this.sinceHost = 0; this.sendHost(); }
    if (this.authority) {
      this.sinceCreatures += dt;
      if (this.sinceCreatures >= 1 / T.creatureRate && this.raid.phase !== 'briefing') { this.sinceCreatures = 0; this.sendCreatures(); }
    }
    for (const r of this.remotes.values()) r.update(this.clock, dt);
  }

  private sendHost(): void {
    const p = this.raid.player, r = this.raid;
    const live = r.phase === 'raid';
    const f = (p.crouched ? FLAG.crouched : 0) | (p.sprinting ? FLAG.sprinting : 0) | (r.phase !== 'lost' ? FLAG.alive : 0) | (p.grounded ? FLAG.grounded : 0) | (r.phase === 'extracted' ? FLAG.extracted : 0);
    const vis = hostVisibility({ moving: p.moving, sprinting: p.sprinting, crouched: p.crouched, sinceShot: p.sinceFired, virus: p.footstepScale });
    const s: HostSnap = { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch, vx: p.velocity.x, vz: p.velocity.z, f, vis, hp: r.biomass.current, ns: live ? p.footstepNoise : 0 };
    this.send({ t: 'host', s: packHost(s) });
  }

  private sendCreatures(): void {
    // New creatures first (reinforcements, nest brood), on the reliable path, so snapshots never name a stranger.
    for (const c of this.raid.creatures) {
      if (this.known.has(c.id)) continue;
      this.known.add(c.id);
      this.send({ t: 'spawn', id: c.id, kind: c.kind, x: c.position.x, z: c.position.z, seed: c.seed });
    }
    const rows: CreatureRow[] = [];
    for (const c of this.raid.creatures) {
      if (!c.alive) continue;
      const b = c.brain, lk = b.look;
      rows.push(packCreature([c.id, b.body.x, b.body.z, b.body.yaw, b.body.vx, b.body.vz, CREATURE_STATES.indexOf(c.state), b.excite, b.windup, b.body.altitude, b.visibility,
        lk ? lk.x : 0, lk ? lk.y : NO_LOOK, lk ? lk.z : 0, c.biomass]));
    }
    this.send({ t: 'cs', c: rows });
  }

  // ---------------------------------------------------------------------------------------------- RaidNet

  follow(dt: number): void {
    const now = this.clock - ONLINE_TUNING.interpDelay;
    for (const c of this.raid.creatures) {
      const id = this.leaderIdOf.get(c);
      const s = id === undefined ? null : this.csnaps.get(id)?.at(now);
      c.follow(dt, s ? toFollow(s) : idleFollow(c));
    }
  }

  targets(): NetTarget[] {
    const out: NetTarget[] = [];
    for (const r of this.remotes.values()) {
      if (!r.alive || !r.present) continue;
      let t = this.targetsOf.get(r.id);
      if (!t) {
        const id = r.id;
        t = {
          id, position: r.position, velocity: r.velocity, visibility: 1, forward: r.forward,
          hurt: (dmg, source, from) => this.send({ t: 'hurt', dmg, zone: 'torso', src: source, from: v3(from) }, id),
          push: (dx, dz, s) => this.send({ t: 'push', x: dx, z: dz, s }, id),
        };
        this.targetsOf.set(id, t);
      }
      t.visibility = r.visibility;
      out.push(t);
    }
    return out;
  }

  heard(into: Noise[]): void {
    if (!this.authority) return;
    for (const n of this.pendingNoises) into.push(n);
    this.pendingNoises.length = 0;
    for (const r of this.remotes.values()) {
      if (!r.alive || !r.present) continue;
      const ns = r.footsteps;
      if (ns > 0) into.push({ x: r.position.x, z: r.position.z, radius: ns });
    }
  }

  noise(x: number, z: number, radius: number): void {
    if (this.authority || this.raid.phase !== 'raid') return;
    this.send({ t: 'noise', x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, r: Math.round(radius * 10) / 10 }, this.peers.leaderId);
  }

  hitHost(a: THREE.Vector3, b: THREE.Vector3): { t: number; id: string; zone: 'head' | 'torso' | 'limb' } | null {
    let best: { t: number; id: string; zone: 'head' | 'torso' | 'limb' } | null = null;
    for (const r of this.remotes.values()) {
      if (this.friendlyFire(r) <= 0) continue;
      const h = r.hit(a, b, segmentSphere);
      if (h && (!best || h.t < best.t)) best = { t: h.t, id: r.id, zone: h.zone };
    }
    return best;
  }

  /** Damage multiplier against host `r`: full for rivals, the friendly-fire share for squadmates. */
  private friendlyFire(r: RemoteHost): number { return r.squad === this.peers.me.squad ? ONLINE_TUNING.friendlyFire : 1; }

  hitOther(id: string, damage: number, zone: 'head' | 'torso' | 'limb', from: THREE.Vector3): void {
    const r = this.remotes.get(id);
    const dmg = damage * (r ? this.friendlyFire(r) : 1);
    if (dmg > 0) this.send({ t: 'hit', dmg: Math.round(dmg * 10) / 10, zone, from: v3(from) }, id);
  }

  damageCreature(c: Abomination, amount: number, weak: boolean, dir: THREE.Vector3 | null, at: THREE.Vector3, sphere?: HitSphere): void {
    const id = this.leaderIdOf.get(c);
    if (id === undefined) return;
    this.send({ t: 'cdmg', id, amt: Math.round(amount * 10) / 10, weak, sphere: sphere ? c.hitSpheres.indexOf(sphere) : -1, dir: dir ? v3(dir) : null, at: v3(at) }, this.peers.leaderId);
  }

  killed(c: Abomination, by: string | null): void { this.send({ t: 'dead', id: c.id, by: by ?? this.peers.selfId }); }

  harvested(c: Abomination): void { const id = this.idOf(c); if (id >= 0) this.send({ t: 'harvested', id }); }

  fired(p: Projectile): void {
    this.send({ t: 'fire', k: p.kind, o: p.owner, p: v3(p.pos), v: v3(p.vel), d: p.damage, g: p.gravity, l: p.life, seek: p.seek ? [p.seek.radius, p.seek.turnRate] : undefined });
  }

  pings(): ScannerPing[] {
    const out: ScannerPing[] = [];
    for (const r of this.remotes.values()) {
      if (!r.present || !r.alive || r.squad !== this.peers.me.squad) continue;
      out.push({ x: r.position.x, z: r.position.z, kind: 'squad', revealed: true });
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- incoming

  /** Another host joined the raid (or its first snapshot arrived). */
  private remote(id: string): RemoteHost | null {
    let r = this.remotes.get(id);
    if (r) return r;
    const m = this.peers.member(id);
    if (!m) return null;
    r = new RemoteHost(id, m.name, m.cls, m.squad, m.squad === this.peers.me.squad);
    this.remotes.set(id, r);
    this.scene.add(r.root);
    return r;
  }

  /** Session membership changed: refresh names, bodies and squads. */
  refreshMembers(): void {
    for (const [id, r] of this.remotes) {
      const m = this.peers.member(id);
      if (!m) continue;
      r.setBody(m.cls);
      if (m.name !== r.name || m.squad !== r.squad) { r.squad = m.squad; r.retag(m.name, m.squad === this.peers.me.squad); }
    }
  }

  /** A host left the session: its body stays where it was if it died; otherwise it vanishes. */
  dropped(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    if (r.alive) { r.dispose(); this.remotes.delete(id); this.targetsOf.delete(id); }
  }

  handle(from: string, m: NetMsg): void {
    this.stats.received++;
    const raid = this.raid;
    switch (m.t) {
      case 'host': this.remote(from)?.push(this.clock, m.s); break;
      case 'fire': {
        const seek = m.seek ? { radius: m.seek[0], turnRate: m.seek[1] } : undefined;
        raid.projectiles.fire(m.k, m.o, vec(m.p), vec(m.v), { damage: m.d, gravity: m.g, life: m.l, seek, remote: true });
        break;
      }
      case 'hit': {
        const name = this.peers.member(from)?.name ?? 'a rival host';
        raid.hurt(m.dmg, m.zone, name, vec(m.from));
        break;
      }
      case 'hurt': raid.hurt(m.dmg, m.zone, m.src, m.from ? vec(m.from) : null); break;
      case 'push': raid.knockback(m.x, m.z, m.s); break;
      case 'noise': if (this.authority) this.pendingNoises.push({ x: m.x, z: m.z, radius: m.r }); break;
      case 'cs': {
        if (this.authority) break;
        const t = this.clock;
        for (const row of m.c) {
          const [id, x, z, yaw, vx, vz, st, ex, wu, alt, vis, lx, ly, lz, hp] = row;
          let buf = this.csnaps.get(id);
          if (!buf) { buf = new Interp<CSnap>(['yaw'], ['st']); this.csnaps.set(id, buf); }
          buf.push(t, { x, z, yaw, vx, vz, st, ex, wu, alt, vis, lx, ly, lz, hp });
        }
        break;
      }
      case 'spawn': {
        if (this.authority || this.byLeaderId.has(m.id)) break;
        this.pair(m.id, raid.netSpawn(m.kind as AbominationKind, m.x, m.z, m.seed));
        break;
      }
      case 'cdmg': {
        if (!this.authority) break;
        const c = this.creature(m.id);
        if (!c) break;
        raid.netDamageCreature(c, m.amt, m.weak, m.dir ? vec(m.dir) : null, vec(m.at), m.sphere >= 0 ? c.hitSpheres[m.sphere] : undefined, from);
        break;
      }
      case 'dead': {
        if (this.authority) break;
        const c = this.byLeaderId.get(m.id);
        if (c) raid.netKilled(c, m.by === this.peers.selfId);
        break;
      }
      case 'harvested': {
        const c = this.authority ? this.raid.creatures.find((x) => x.id === m.id) : this.byLeaderId.get(m.id);
        if (c) raid.netHarvested(c);
        break;
      }
      case 'down': { const r = this.remotes.get(from); if (r) r.flags &= ~FLAG.alive; break; }
      case 'out': { const r = this.remotes.get(from); if (r) { r.flags |= FLAG.extracted; r.root.visible = false; } break; }
      default: break;
    }
  }

  /** For tests and the debug overlay. */
  testState(): Record<string, unknown> {
    return {
      authority: this.authority, sent: this.stats.sent, received: this.stats.received, paired: this.byLeaderId.size,
      remotes: [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, squad: r.squad, alive: r.alive, present: r.present, biomass: r.biomass, position: r.position.toArray() })),
    };
  }

  dispose(): void { for (const r of this.remotes.values()) r.dispose(); this.remotes.clear(); }
}

function toFollow(s: CSnap): FollowState {
  return {
    x: s.x, z: s.z, yaw: s.yaw, vx: s.vx, vz: s.vz, altitude: s.alt, excite: s.ex, windup: s.wu, visibility: s.vis,
    look: s.ly === NO_LOOK ? null : { x: s.lx, y: s.ly, z: s.lz }, biomass: s.hp, state: (CREATURE_STATES[s.st] ?? 'idle') as State,
  };
}

/** A creature with no snapshot yet holds its pose. */
function idleFollow(c: Abomination): FollowState {
  const b = c.brain.body;
  return { x: b.x, z: b.z, yaw: b.yaw, vx: 0, vz: 0, altitude: b.altitude, excite: 0.2, windup: 0, visibility: c.brain.visibility, look: null, biomass: c.biomass, state: c.alive ? 'idle' : 'dead' };
}
