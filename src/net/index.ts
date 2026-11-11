/**
 * Online & Backend entry point: one call from main.ts wires the Hive-Mind panel, the session and the raid seam.
 *
 * Where online play works: any normal web page (the GitHub Pages build, `npm run dev`, a downloaded release file).
 * The claude.ai play link runs in a sandbox that blocks WebRTC and outside connections, so there the panel points
 * to the online build instead. `?net=local` swaps WebRTC for a same-browser channel (tests, two windows on one PC).
 * `?join=CODE` joins a squad on load: that is what an invite link is.
 */
import type * as THREE from 'three';
import type { Raid } from '../game/raid';
import { HiveMindPanel, savedName } from './lobby';
import { parseCode } from './protocol';
import { NetSession, SQUAD_KEY } from './session';

/** The free public home of the online build (GitHub Pages of the public repo). */
export const ONLINE_HOME = 'https://brandoblue.github.io/biophage-extraction/';

export interface OnlineOptions {
  raid: Raid; scene: THREE.Scene; seed: number; zone: string; build: string; cls: () => string;
  deploy(): void;
  say(text: string): void;
  menuVisible(): boolean;
}

/** Why this page cannot play online, or null if it can. */
export function onlineBlocked(): string | null {
  if (typeof RTCPeerConnection === 'undefined') return 'This browser cannot open peer-to-peer connections. Online squads need a current Chrome, Edge, Firefox or Safari.';
  const h = location.hostname;
  if (/(^|\.)claude\.(ai|com)$|claudeusercontent\.com$/.test(h)) return 'The Claude play link runs in a sandbox that blocks connections between players. Online squads play on the open web build.';
  return null;
}

export class Online {
  readonly session: NetSession;
  readonly panel: HiveMindPanel | null;

  constructor(o: OnlineOptions) {
    const q = new URLSearchParams(location.search);
    const local = q.get('net') === 'local';
    this.session = new NetSession({
      kind: local ? 'local' : 'peer', raid: o.raid, scene: o.scene, seed: o.seed, zone: o.zone, build: o.build,
      name: savedName(), cls: o.cls(),
      reload: (code, seed, zone) => {
        const u = new URL(location.href);
        u.searchParams.set('join', code); u.searchParams.set('seed', String(seed)); u.searchParams.set('zone', zone);
        location.replace(u.toString());
      },
      deploy: () => o.deploy(),
      changed: () => this.panel?.update(),
    });
    this.panel = typeof document === 'undefined' ? null : new HiveMindPanel(this.session, { blockedReason: local ? null : onlineBlocked(), onlineHome: ONLINE_HOME, say: o.say });
    this.menuVisible = o.menuVisible;
    this.cls = o.cls;
    const join = parseCode(q.get('join') ?? '');
    let led: string | null = null;
    try { led = parseCode(sessionStorage.getItem(SQUAD_KEY) ?? ''); } catch { /* storage blocked */ }
    if (local || !onlineBlocked()) {
      if (join) this.session.join(join);
      else if (led) this.session.host(led);
    }
  }

  private menuVisible: () => boolean;
  private cls: () => string;
  private lastCls = '';

  /** Hive Deploy button: 'solo' plays as before, 'wait' holds a guest in the Hive, 'go' deploys online. */
  deployGate(): 'solo' | 'wait' | 'go' { return this.session.deployGate(); }

  tick(dt: number): void {
    const s = this.session;
    s.tick(dt);
    if (this.panel) {
      this.panel.visible = this.menuVisible();
      this.panel.update();
    }
    // Picking another host in the Hive shows on the squad list.
    const cls = this.cls();
    if (cls !== this.lastCls) { this.lastCls = cls; if (s.state === 'lobby') s.setClass(cls); }
  }

  /** window.__biophage.net: drives online play from tests/online.mjs. */
  get test() {
    const s = this.session;
    return {
      state: s.state, code: s.code, message: s.message, leader: s.leader, selfId: s.selfId,
      members: s.members, raid: s.net?.testState() ?? null,
      host: (code?: string) => s.host(code),
      join: (code: string) => s.join(code),
      side: (squad: 0 | 1) => s.setSquad(squad),
      leave: () => s.leave(),
    };
  }
}
