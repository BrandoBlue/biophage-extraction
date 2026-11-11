/**
 * An online session: the lobby before the raid and the link during it.
 *
 * Flow. The leader opens a squad and gets a five-letter code and an invite link. A guest opens the link (or types the
 * code); the leader answers with the raid every member must build (world seed and zone). If the guest's page built a
 * different raid it reloads into the right one and rejoins by itself. When the leader presses Deploy, everyone drops
 * together: squadmates side by side, a rival squad far across the map.
 */
import type * as THREE from 'three';
import { groundHeight } from '../world/zone7';
import type { Raid } from '../game/raid';
import { openLink, type Link, type LinkKind } from './link';
import { NetRaid, type NetPeers } from './netraid';
import { newCode, PROTOCOL, type Member, type NetMsg, type Squad } from './protocol';
import { ONLINE_TUNING } from './tuning';

/** sessionStorage key: the squad code this tab leads. */
export const SQUAD_KEY = 'biophage.squad';

export type SessionState = 'off' | 'opening' | 'lobby' | 'raid' | 'solo' | 'error';

export interface SessionOptions {
  kind: LinkKind;
  raid: Raid;
  scene: THREE.Scene;
  /** The raid this page built at boot. */
  seed: number; zone: string;
  build: string;
  name: string; cls: string;
  /** Rebuild the page for the leader's raid and rejoin. */
  reload(code: string, seed: number, zone: string): void;
  /** Deploy now (the leader pressed Deploy). */
  deploy(): void;
  changed(): void;
}

export class NetSession implements NetPeers {
  state: SessionState = 'off';
  code: string | null = null;
  message = '';
  members: Member[] = [];
  link: Link | null = null;
  net: NetRaid | null = null;
  private started = false;
  private leaderGone = false;
  private meLocal: Member;

  constructor(private o: SessionOptions) {
    this.meLocal = { id: '', name: o.name, cls: o.cls, squad: 0 };
  }

  get selfId(): string { return this.link?.id ?? ''; }
  get leaderId(): string { return this.link?.leaderId ?? ''; }
  get leader(): boolean { return !!this.link?.leader; }
  get authority(): boolean { return this.leader || this.leaderGone; }
  get online(): boolean { return this.state === 'lobby' || this.state === 'raid' || this.state === 'opening'; }
  get me(): Member { return this.members.find((m) => m.id === this.selfId) ?? this.meLocal; }
  member(id: string): Member | undefined { return this.members.find((m) => m.id === id); }
  send(m: NetMsg, to?: string): void { if (!this.leaderGone) this.link?.send(m, to); }

  /** Opens a new squad with a fresh code (or `code`, for tests). */
  host(code = newCode()): void { this.connect(code, true); }
  join(code: string): void { this.connect(code, false); }

  private connect(code: string, leader: boolean): void {
    this.leave(false);
    this.code = code;
    this.state = 'opening';
    this.message = leader ? 'Opening a squad…' : `Joining squad ${code}…`;
    this.leaderGone = false;
    // A leader's squad outlives page reloads (back to the Hive after a raid): Online reopens the same code.
    try { if (leader) sessionStorage.setItem(SQUAD_KEY, code); else sessionStorage.removeItem(SQUAD_KEY); } catch { /* storage blocked */ }
    const link = openLink(this.o.kind, code, leader);
    this.link = link;
    this.meLocal = { ...this.meLocal, id: link.id };
    this.net = new NetRaid(this.o.raid, this.o.scene, this);
    link.onStatus = (s, detail) => {
      if (this.link !== link) return;
      if (s === 'open') {
        if (leader) { this.members = [this.meLocal]; this.state = 'lobby'; this.message = ''; }
        else link.send({ t: 'hello', name: this.meLocal.name, cls: this.meLocal.cls, build: this.o.build, protocol: PROTOCOL }, link.leaderId);
      } else if (s === 'error') this.fail(detail ?? 'Connection failed.');
      else if (s === 'closed' && !leader) this.leaderLeft();
      this.o.changed();
    };
    link.onPeer = (id, up) => { if (this.link === link && !up) this.peerLeft(id); };
    link.onMessage = (from, m) => { if (this.link === link) this.receive(from, m); };
    this.o.changed();
  }

  private fail(why: string): void {
    if (this.state === 'raid') { this.leaderLeft(why); return; }
    this.state = 'error';
    this.message = why;
    const link = this.link;
    this.link = null;
    link?.close();
  }

  /** Leaves the session. In a raid the raid carries on solo. */
  leave(notify = true): void {
    if (notify) {
      // Leaving on purpose: forget the squad, and drop the invite from the address so a reload stays solo.
      try { sessionStorage.removeItem(SQUAD_KEY); } catch { /* storage blocked */ }
      try { const u = new URL(location.href); u.searchParams.delete('join'); history.replaceState(history.state, '', u.toString()); } catch { /* not a browser */ }
    }
    const link = this.link;
    this.link = null;
    if (link) link.close();
    if (this.state === 'raid') { this.leaderGone = true; this.state = 'solo'; }
    else { this.state = 'off'; this.members = []; this.net?.dispose(); this.net = null; this.o.raid.net = null; }
    this.code = null;
    if (notify) this.o.changed();
  }

  setSquad(squad: Squad): void { this.pick({ squad }); }
  setName(name: string): void { this.meLocal.name = name; this.pick({ name }); }
  setClass(cls: string): void { this.meLocal.cls = cls; this.pick({ cls }); }

  private pick(p: { squad?: Squad; name?: string; cls?: string }): void {
    if (!this.link || this.state !== 'lobby') return;
    if (this.leader) this.applyPick(this.selfId, p);
    else this.send({ t: 'pick', ...p }, this.leaderId);
  }

  private applyPick(id: string, p: { squad?: Squad; name?: string; cls?: string }): void {
    const m = this.member(id);
    if (!m) return;
    if (p.squad === 0 || p.squad === 1) m.squad = p.squad;
    if (typeof p.name === 'string' && p.name.trim()) m.name = p.name.trim().slice(0, 18);
    if (typeof p.cls === 'string') m.cls = p.cls;
    this.send({ t: 'members', members: this.members });
    this.net?.refreshMembers();
    this.o.changed();
  }

  /** Deploy gate for the Hive's Deploy button: 'solo' (not online), 'wait' (a guest), 'go' (deploy now). */
  deployGate(): 'solo' | 'wait' | 'go' {
    if (this.state !== 'lobby' || !this.link) return 'solo';
    if (this.started) return 'go';
    if (!this.leader) return 'wait';
    this.started = true;
    this.send({ t: 'start', roster: this.net!.roster() });
    this.beginRaid();
    return 'go';
  }

  /** Puts this host at its squad's landing spot and switches the raid to online play. */
  private beginRaid(): void {
    const raid = this.o.raid;
    this.state = 'raid';
    raid.net = this.net;
    const me = this.me;
    const squad = this.members.filter((m) => m.squad === me.squad);
    const k = Math.max(0, squad.findIndex((m) => m.id === me.id));
    const base = landingSpot(raid, me.squad);
    const a = (k / Math.max(1, squad.length)) * Math.PI * 2;
    const r = k === 0 ? 0 : ONLINE_TUNING.squadSpread;
    const x = base.x + Math.cos(a) * r, z = base.z + Math.sin(a) * r;
    const ex = raid.spires[0]?.point.x ?? 0, ez = raid.spires[0]?.point.z ?? 0;
    raid.player.spawn(x, z, Math.atan2(-(ex - x), -(ez - z)));
    this.o.changed();
  }

  private receive(from: string, m: NetMsg): void {
    const o = this.o;
    switch (m.t) {
      case 'hello': {
        if (!this.leader) return;
        const refuse = (reason: string) => this.link?.send({ t: 'refuse', reason }, from);
        if (m.protocol !== PROTOCOL || m.build !== o.build) return refuse(`Different game builds (theirs v${o.build}, yours v${m.build}). Both refresh the page.`);
        if (this.started) return refuse('That squad has already deployed. Ask the leader to open a new squad after the raid.');
        if (this.members.length >= ONLINE_TUNING.maxHosts && !this.member(from)) return refuse(`That squad is full (${ONLINE_TUNING.maxHosts} hosts).`);
        if (!this.member(from)) this.members.push({ id: from, name: String(m.name).slice(0, 18) || 'Host', cls: m.cls, squad: 0 });
        this.link?.send({ t: 'welcome', seed: o.seed, zone: o.zone, build: o.build, protocol: PROTOCOL, started: this.started }, from);
        this.send({ t: 'members', members: this.members });
        this.net?.refreshMembers();
        o.changed();
        return;
      }
      case 'welcome':
        if (m.seed !== o.seed || m.zone !== o.zone) { this.message = 'Building the squad leader\'s raid…'; o.changed(); o.reload(this.code!, m.seed, m.zone); return; }
        this.state = 'lobby';
        this.message = '';
        o.changed();
        return;
      case 'refuse': this.fail(m.reason); o.changed(); return;
      case 'members': if (from === this.leaderId) { this.members = m.members; this.net?.refreshMembers(); o.changed(); } return;
      case 'pick': if (this.leader) this.applyPick(from, m); return;
      case 'start':
        if (from !== this.leaderId || this.started) return;
        this.started = true;
        this.net!.adoptRoster(m.roster);
        this.beginRaid();
        o.deploy();
        return;
      case 'bye': this.peerLeft(from); return;
      default: this.net?.handle(from, m);
    }
  }

  private peerLeft(id: string): void {
    if (id === this.leaderId && !this.leader) { this.leaderLeft(); return; }
    if (!this.member(id)) return;
    if (this.leader) {
      this.members = this.members.filter((m) => m.id !== id);
      this.send({ t: 'members', members: this.members });
    }
    this.net?.dropped(id);
    this.o.changed();
  }

  /** The leader went away: in a raid, this host takes over its creatures and plays on solo. */
  private leaderLeft(why = 'The squad leader left.'): void {
    if (this.state === 'raid') {
      this.leaderGone = true;
      this.state = 'solo';
      this.message = `${why} Your raid carries on solo.`;
      for (const id of [...(this.net?.remotes.keys() ?? [])]) this.net?.dropped(id);
    } else if (this.state !== 'off') {
      this.state = 'error';
      this.message = why;
      const link = this.link;
      this.link = null;
      link?.close();
    }
    this.o.changed();
  }

  tick(dt: number): void { if (this.state === 'raid' || this.state === 'solo') this.net?.tick(dt); }
}

/**
 * Where a squad lands: squad 0 at the map's drop point, a rival squad at the container site farthest from it
 * (at least the spawn separation away when the map allows).
 */
export function landingSpot(raid: Raid, squad: Squad): { x: number; z: number } {
  const s = raid.layout.spawn;
  if (squad === 0) return { x: s.x, z: s.z };
  let best = { x: -s.x, z: -s.z }, bd = -1;
  for (const p of raid.layout.pods) {
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    if (d > bd && Number.isFinite(groundHeight(p.x, p.z))) { bd = d; best = { x: p.x, z: p.z }; }
  }
  return best;
}
