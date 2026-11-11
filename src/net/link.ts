/**
 * Transports for online raids. Both give the same star: the leader at the centre, guests connected to it, the leader
 * relaying anything one guest sends to another (or to everyone).
 *
 * - `PeerLink`: WebRTC data channels between browsers (PeerJS). The free public PeerJS broker only introduces the
 *   browsers; after that, game traffic goes browser to browser. No server of ours, no account, no cost.
 * - `LoopbackLink`: BroadcastChannel between tabs of one browser. Used by the two-player browser test and for trying
 *   online play alone with two windows (`?net=local`).
 */
import Peer, { type DataConnection } from 'peerjs';
import { leaderId, type Envelope, type NetMsg } from './protocol';

export type LinkStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface Link {
  readonly id: string;
  readonly leader: boolean;
  /** The leader's id (guests send to it). */
  readonly leaderId: string;
  /** Send to one host (`to`) or to everyone else (no `to`). */
  send(m: NetMsg, to?: string): void;
  onMessage: (from: string, m: NetMsg) => void;
  /** A guest connected (leader only) or someone dropped. */
  onPeer: (id: string, up: boolean) => void;
  onStatus: (s: LinkStatus, detail?: string) => void;
  readonly status: LinkStatus;
  close(): void;
}

abstract class BaseLink implements Link {
  onMessage: (from: string, m: NetMsg) => void = () => {};
  onPeer: (id: string, up: boolean) => void = () => {};
  onStatus: (s: LinkStatus, detail?: string) => void = () => {};
  status: LinkStatus = 'connecting';
  readonly leaderId: string;
  constructor(readonly id: string, readonly leader: boolean, code: string) { this.leaderId = leaderId(code); }
  protected setStatus(s: LinkStatus, detail?: string): void { this.status = s; this.onStatus(s, detail); }
  abstract send(m: NetMsg, to?: string): void;
  abstract close(): void;
}

const randomSuffix = () => Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------------------------------------------------- loopback

/** Same-browser transport. Every tab sees every post; each keeps only what is for it. */
export class LoopbackLink extends BaseLink {
  private ch: BroadcastChannel;
  private alive = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;

  constructor(code: string, leader: boolean) {
    super(leader ? leaderId(code) : `${leaderId(code)}-${randomSuffix()}`, leader, code);
    this.ch = new BroadcastChannel(`biophage-net-${code}`);
    this.ch.onmessage = (e: MessageEvent<Envelope & { ping?: boolean }>) => this.receive(e.data);
    // Presence: a ping every second; a tab silent for a minute has gone (software-rendered test pages can stall
    // their timers for many seconds while a frame renders, so this is generous; closing a tab says bye at once).
    this.timer = setInterval(() => {
      this.ch.postMessage({ f: this.id, ping: true, m: { t: 'bye' } });
      const now = Date.now();
      for (const [id, at] of this.alive) if (now - at > 60000) { this.alive.delete(id); this.onPeer(id, false); }
    }, 1000);
    queueMicrotask(() => {
      this.setStatus('open');
      if (!leader) this.ch.postMessage({ f: this.id, ping: true, m: { t: 'bye' } });
    });
  }

  private receive(e: Envelope & { ping?: boolean }): void {
    if (!e || e.f === this.id) return;
    // Broadcasts between guests arrive here directly; in the WebRTC star the leader relays them. Same outcome.
    if (e.ping) {
      const known = this.alive.has(e.f);
      this.alive.set(e.f, Date.now());
      if (!known && (this.leader || e.f === this.leaderId)) this.onPeer(e.f, true);
      return;
    }
    if (e.m.t === 'bye') { if (this.alive.delete(e.f)) this.onPeer(e.f, false); return; }
    if (e.to && e.to !== this.id) return;
    this.alive.set(e.f, Date.now());
    this.onMessage(e.f, e.m);
  }

  send(m: NetMsg, to?: string): void { this.ch.postMessage({ f: this.id, to, m } satisfies Envelope); }

  close(): void {
    if (this.status === 'closed') return;
    this.status = 'closed';
    clearInterval(this.timer);
    try { this.ch.postMessage({ f: this.id, m: { t: 'bye' } }); } catch { /* closed */ }
    this.ch.close();
    this.onStatus('closed');
  }
}

// ---------------------------------------------------------------------------------------------------------- WebRTC

/** Browser-to-browser transport over WebRTC. The leader takes the code's id on the broker; guests dial it. */
export class PeerLink extends BaseLink {
  private peer!: Peer;
  private conns = new Map<string, DataConnection>();
  private retries = 0;
  private closed = false;

  constructor(code: string, leader: boolean) {
    super(leader ? leaderId(code) : `${leaderId(code)}-${randomSuffix()}`, leader, code);
    this.start();
  }

  private start(): void {
    // Default PeerJS options: its public broker, Google STUN and PeerJS's free TURN relay for strict networks.
    const peer = new Peer(this.id, { debug: 1 });
    this.peer = peer;
    peer.on('open', () => {
      if (this.leader) { this.setStatus('open'); return; }
      this.wire(peer.connect(this.leaderId, { reliable: true, serialization: 'json' }));
    });
    peer.on('connection', (c) => { if (this.leader) this.wire(c); else c.close(); });
    peer.on('disconnected', () => {
      // Lost the broker. Open data channels keep working; reconnect so new guests can still find us.
      if (!peer.destroyed && !this.closed) try { peer.reconnect(); } catch { /* retried on next drop */ }
    });
    peer.on('error', (err: Error & { type?: string }) => {
      const type = err.type ?? 'error';
      // A leader reopening its squad right after a page reload: the broker frees the old id within seconds.
      if (type === 'unavailable-id' && this.leader && this.retries < 6 && !this.closed) {
        this.retries++;
        peer.destroy();
        setTimeout(() => { if (!this.closed) this.start(); }, 2500);
        return;
      }
      const why: Record<string, string> = {
        'unavailable-id': 'That squad code is already in use. Open a new squad.',
        'peer-unavailable': 'No squad is open with that code. Check it, or ask the leader to open the squad again.',
        'network': 'Could not reach the matchmaking broker. Check your connection.',
        'server-error': 'The matchmaking broker is not answering. Try again in a minute.',
        'socket-error': 'Lost the matchmaking broker.',
        'browser-incompatible': 'This browser page cannot open peer-to-peer connections.',
        'webrtc': 'The connection between the two browsers failed (a strict network or firewall can block it).',
      };
      if (type === 'socket-error' && this.status === 'open') return; // broker blip while already playing
      this.setStatus('error', why[type] ?? err.message);
    });
  }

  private wire(c: DataConnection): void {
    const other = c.peer;
    c.on('open', () => {
      this.conns.set(other, c);
      if (!this.leader) this.setStatus('open');
      this.onPeer(other, true);
    });
    c.on('data', (d) => this.receive(other, d as Envelope));
    const drop = () => {
      if (this.conns.get(other) !== c) return;
      this.conns.delete(other);
      this.onPeer(other, false);
      if (!this.leader) this.setStatus('closed', 'The squad leader left.');
    };
    c.on('close', drop);
    c.on('error', drop);
  }

  private receive(from: string, e: Envelope): void {
    if (!e || !e.m) return;
    // Only the leader relays, and it trusts the channel, not the envelope, for who sent it.
    const sender = this.leader ? from : e.f;
    if (this.leader) {
      if (e.to && e.to !== this.id) { this.conns.get(e.to)?.send({ f: sender, to: e.to, m: e.m } satisfies Envelope); return; }
      if (!e.to) for (const [id, c] of this.conns) if (id !== from) c.send({ f: sender, m: e.m } satisfies Envelope);
    }
    this.onMessage(sender, e.m);
  }

  send(m: NetMsg, to?: string): void {
    const env: Envelope = { f: this.id, to, m };
    if (this.leader) {
      if (to) this.conns.get(to)?.send(env);
      else for (const c of this.conns.values()) c.send(env);
    } else this.conns.get(this.leaderId)?.send(env);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.send({ t: 'bye' }); } catch { /* closed */ }
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.peer.destroy();
    this.status = 'closed';
    this.onStatus('closed');
  }
}

export type LinkKind = 'peer' | 'local';

export function openLink(kind: LinkKind, code: string, leader: boolean): Link {
  return kind === 'local' ? new LoopbackLink(code, leader) : new PeerLink(code, leader);
}
