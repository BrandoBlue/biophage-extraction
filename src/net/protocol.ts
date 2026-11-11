/**
 * Online & Backend (Hive): the wire protocol for peer-to-peer raids.
 *
 * Topology is a star. The squad leader's browser opens the session; every other host connects to it. The leader runs
 * the creature brains, spawns and nests and sends creature snapshots; each host simulates its own body and tells
 * everyone where it is, what it fired and whom it hit. A message addressed to one host is relayed by the leader.
 * Pure data and helpers only, so it is unit-tested without a browser.
 */

/** Bumped when messages change shape; hosts on different protocol versions refuse to join each other. */
export const PROTOCOL = 1;

/** Invite codes: 5 characters from an alphabet with no look-alikes (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function newCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length) % ALPHABET.length];
  return s;
}

/** Normalises what a player typed or pasted (a bare code or a whole invite link) to a code, or null. */
export function parseCode(input: string): string | null {
  const t = input.trim();
  const fromLink = /[?&#]join=([A-Za-z0-9]+)/.exec(t);
  const raw = (fromLink ? fromLink[1] : t).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== CODE_LENGTH) return null;
  for (const ch of raw) if (!ALPHABET.includes(ch)) return null;
  return raw;
}

/** The leader's peer id on the broker for a code. Guests get `<leader id>-<random>`. */
export const leaderId = (code: string) => `biophage-hive-${code.toLowerCase()}`;

/** An invite link for `base` (the page the leader is playing on). */
export function inviteLink(base: string, code: string): string {
  const u = new URL(base);
  for (const k of ['join', 'seed', 'zone', 'host']) u.searchParams.delete(k);
  u.searchParams.set('join', code);
  u.hash = '';
  return u.toString();
}

export type Squad = 0 | 1;

export interface Member { id: string; name: string; cls: string; squad: Squad }

/** One host's body, sent ~20 times a second. Flags: 1 crouched, 2 sprinting, 4 alive, 8 grounded, 16 extracted. */
export interface HostSnap { x: number; y: number; z: number; yaw: number; pitch: number; vx: number; vz: number; f: number; vis: number; hp: number; /** Footstep noise radius this frame. */ ns: number }

/**
 * One creature in the leader's snapshot: [id, x, z, yaw, vx, vz, state, excite, windup, altitude, visibility,
 * lookX, lookY, lookZ, biomass]. The look target is NaN-free: no target sends lookY = -999.
 */
export type CreatureRow = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

/** Coarse creature states, in the order CreatureRow carries them. */
export const CREATURE_STATES = ['idle', 'alert', 'chase', 'windup', 'lunge', 'recover', 'stagger', 'dead'] as const;
export type CreatureState = (typeof CREATURE_STATES)[number];

export type V3 = [number, number, number];
export type RosterRow = [number, string, number, number, number];

export type NetMsg =
  /** Guest → leader on connect. */
  | { t: 'hello'; name: string; cls: string; build: string; protocol: number }
  /** Leader → guest: the raid every member must build (world seed, zone) and the leader's creature roster. */
  | { t: 'welcome'; seed: number; zone: string; build: string; protocol: number; started: boolean }
  | { t: 'refuse'; reason: string }
  /** Leader → all: who is in the session. */
  | { t: 'members'; members: Member[] }
  /** Any → leader: change my squad or name. */
  | { t: 'pick'; squad?: Squad; name?: string; cls?: string }
  /** Leader → all: deploy now. The leader's creatures at boot, in order, so guests pair theirs: [id, kind, x, z, seed]. */
  | { t: 'start'; roster: RosterRow[] }
  | { t: 'host'; s: HostSnap }
  /** A projectile someone fired (any owner), to replay as a harmless copy. */
  | { t: 'fire'; k: 'spore' | 'ego' | 'bile'; o: 'player' | 'enemy'; p: V3; v: V3; d: number; g: number; l: number; seek?: [number, number] }
  /** Shooter → victim: you were hit by a host. */
  | { t: 'hit'; dmg: number; zone: 'head' | 'torso' | 'limb'; from: V3 }
  /** Leader → victim: a creature hurt you. */
  | { t: 'hurt'; dmg: number; zone: 'head' | 'torso' | 'limb'; src: string; from: V3 | null }
  /** Leader → victim: a creature shoved you. */
  | { t: 'push'; x: number; z: number; s: number }
  /** Guest → leader: a noise creatures can hear. */
  | { t: 'noise'; x: number; z: number; r: number }
  /** Leader → all: creature snapshot. */
  | { t: 'cs'; c: CreatureRow[] }
  /** Leader → all: a creature appeared (reinforcement, nest brood). */
  | { t: 'spawn'; id: number; kind: string; x: number; z: number; seed: number }
  /** Guest → leader: I damaged creature `id`. Sphere is the index into its hit spheres, -1 for none. */
  | { t: 'cdmg'; id: number; amt: number; weak: boolean; sphere: number; dir: V3 | null; at: V3 }
  /** Leader → all: creature `id` died; `by` gets the kill. */
  | { t: 'dead'; id: number; by: string }
  /** Any → all: a corpse was harvested (it cannot be harvested again). */
  | { t: 'harvested'; id: number }
  /** Any → all: I died. */
  | { t: 'down'; cause: string }
  /** Any → all: I extracted. */
  | { t: 'out' }
  | { t: 'bye' };

/** What travels on the wire: the sender and, for a single recipient, its id. */
export interface Envelope { f: string; to?: string; m: NetMsg }

// ---------------------------------------------------------------- snapshot helpers

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function packHost(s: HostSnap): HostSnap {
  return { x: r2(s.x), y: r2(s.y), z: r2(s.z), yaw: r3(s.yaw), pitch: r3(s.pitch), vx: r2(s.vx), vz: r2(s.vz), f: s.f | 0, vis: r2(s.vis), hp: Math.round(s.hp), ns: r2(s.ns) };
}

export function packCreature(row: CreatureRow): CreatureRow {
  return row.map((v, i) => (i === 0 || i === 6 ? v : i === 3 ? r3(v) : r2(v))) as CreatureRow;
}

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Snapshot interpolation: keeps timed samples and answers "where was it `delay` seconds ago", blending between the
 * two samples around that time (angles the short way round, flags and states snap to the nearer sample). Past the newest sample it holds still rather than
 * guessing, so a stalled peer freezes instead of sliding through walls.
 */
export class Interp<T extends Record<string, number>> {
  private samples: { t: number; v: T }[] = [];
  constructor(private angles: (keyof T)[] = [], private discrete: (keyof T)[] = [], private keep = 1.5) {}

  push(t: number, v: T): void {
    const s = this.samples;
    if (s.length && t <= s[s.length - 1].t) return; // late or duplicate: drop
    s.push({ t, v });
    while (s.length > 2 && s[1].t < t - this.keep) s.shift();
  }

  get latest(): T | null { return this.samples.length ? this.samples[this.samples.length - 1].v : null; }
  get size(): number { return this.samples.length; }

  at(t: number): T | null {
    const s = this.samples;
    if (!s.length) return null;
    if (t <= s[0].t) return s[0].v;
    const last = s[s.length - 1];
    if (t >= last.t) return last.v;
    let i = s.length - 2;
    while (i > 0 && s[i].t > t) i--;
    const a = s[i], b = s[i + 1];
    const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
    const out = { ...a.v } as Record<string, number>;
    for (const key of Object.keys(a.v)) {
      const va = a.v[key], vb = b.v[key];
      if (typeof va !== 'number' || typeof vb !== 'number') continue;
      if (this.discrete.includes(key)) out[key] = k < 0.5 ? va : vb;
      else out[key] = this.angles.includes(key) ? va + angleDelta(va, vb) * k : va + (vb - va) * k;
    }
    return out as T;
  }
}
