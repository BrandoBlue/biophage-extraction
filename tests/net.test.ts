import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ABOMINATIONS } from '../data';
import { Abomination } from '../src/game/abominations';
import { LoopbackLink } from '../src/net/link';
import { NetRaid, type NetPeers } from '../src/net/netraid';
import { angleDelta, CODE_LENGTH, Interp, inviteLink, leaderId, newCode, packHost, parseCode, type NetMsg } from '../src/net/protocol';
import { NetSession } from '../src/net/session';
import { EventBus } from '../src/game/events';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) { if (Date.now() > end) throw new Error('timed out'); await wait(10); }
}

describe('online protocol', () => {
  it('makes readable codes and reads them back from codes or invite links', () => {
    let seed = 1;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 50; i++) {
      const c = newCode(rand);
      expect(c).toHaveLength(CODE_LENGTH);
      expect(c).not.toMatch(/[01OIL]/);
      expect(parseCode(c.toLowerCase())).toBe(c);
      expect(parseCode(inviteLink('https://example.org/game/?seed=4&foo=1', c))).toBe(c);
    }
    expect(parseCode('ABCD')).toBeNull();
    expect(parseCode('ABCD0')).toBeNull(); // 0 is not in the alphabet
    const link = inviteLink('https://brandoblue.github.io/biophage-extraction/?seed=9&zone=x&join=OLDOO#frag', 'K7QMZ');
    expect(link).toBe('https://brandoblue.github.io/biophage-extraction/?join=K7QMZ');
    expect(leaderId('K7QMZ')).toBe('biophage-hive-k7qmz');
  });

  it('interpolates snapshots, angles the short way, flags snap, and holds past the newest sample', () => {
    const b = new Interp<{ x: number; yaw: number; f: number }>(['yaw'], ['f']);
    b.push(0, { x: 0, yaw: 3.0, f: 4 });
    b.push(0.1, { x: 10, yaw: -3.0, f: 5 });
    const mid = b.at(0.05)!;
    expect(mid.x).toBeCloseTo(5);
    // 3.0 → -3.0 crosses ±π: the midpoint is near π, not near 0.
    expect(Math.abs(Math.abs(mid.yaw) - Math.PI)).toBeLessThan(0.2);
    expect(b.at(0.04)!.f).toBe(4);
    expect(b.at(0.06)!.f).toBe(5);
    expect(b.at(5)!.x).toBe(10);
    expect(b.at(-1)!.x).toBe(0);
    b.push(0.05, { x: 99, yaw: 0, f: 0 }); // late: dropped
    expect(b.at(0.1)!.x).toBe(10);
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
  });

  it('rounds snapshots so they stay small on the wire', () => {
    const s = packHost({ x: 1.23456, y: 2.34567, z: -3.45678, yaw: 0.123456, pitch: -0.98765, vx: 0.555, vz: 0, f: 5.7, vis: 0.4444, hp: 199.6, ns: 3.333 });
    expect(s).toEqual({ x: 1.23, y: 2.35, z: -3.46, yaw: 0.123, pitch: -0.988, vx: 0.56, vz: 0, f: 5, vis: 0.44, hp: 200, ns: 3.33 });
    expect(JSON.stringify({ t: 'host', s }).length).toBeLessThan(140);
  });
});

describe('same-browser link (BroadcastChannel)', () => {
  it('delivers to one host or to everyone, and sees guests come and go', async () => {
    const code = 'TSTA2';
    const lead = new LoopbackLink(code, true);
    const a = new LoopbackLink(code, false);
    const b = new LoopbackLink(code, false);
    const got: Record<string, NetMsg[]> = { lead: [], a: [], b: [] };
    lead.onMessage = (_f, m) => got.lead.push(m);
    a.onMessage = (_f, m) => got.a.push(m);
    b.onMessage = (_f, m) => got.b.push(m);
    const ups: string[] = [];
    lead.onPeer = (id, up) => ups.push(`${up ? '+' : '-'}${id}`);
    await until(() => ups.length >= 2);
    a.send({ t: 'noise', x: 1, z: 2, r: 3 }, lead.id);
    lead.send({ t: 'out' });
    lead.send({ t: 'down', cause: 'x' }, b.id);
    await until(() => got.lead.length === 1 && got.a.length === 1 && got.b.length === 2);
    expect(got.lead[0]).toEqual({ t: 'noise', x: 1, z: 2, r: 3 });
    expect(got.a[0].t).toBe('out');
    expect(got.b.map((m) => m.t)).toEqual(['out', 'down']);
    b.close();
    await until(() => ups.includes(`-${b.id}`));
    lead.close(); a.close();
  });
});

/** A raid stand-in with just what the session and the creature sync touch. */
function fakeRaid(creatures: Abomination[] = []) {
  const spawned: Abomination[] = [];
  const damage: number[] = [];
  return {
    creatures, spawned, damage, phase: 'briefing' as string, net: null as unknown,
    bus: new EventBus(),
    layout: { spawn: { x: 0, z: 0 }, pods: [{ x: 60, z: 0 }, { x: -90, z: 10 }] },
    spires: [{ point: { x: 10, z: 10 } }],
    player: {
      spawned: null as number[] | null, spawn(x: number, z: number) { this.spawned = [x, z]; },
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, crouched: false, sprinting: false, grounded: true,
      moving: false, sinceFired: 99, footstepScale: 1, footstepNoise: 0,
    },
    biomass: { current: 100 },
    netSpawn(kind: string, x: number, z: number, seed: number) {
      const c = new Abomination(kind as 'needlemaw', ABOMINATIONS[kind as 'needlemaw'], x, z, seed);
      creatures.push(c); spawned.push(c); return c;
    },
    netKilled(c: Abomination) { c.killedRemotely(); },
    netHarvested() {},
    hurt(d: number) { damage.push(d); },
  };
}

function session(raid: ReturnType<typeof fakeRaid>, seed: number, deployed: { n: number }, reloads: unknown[] = []) {
  return new NetSession({
    kind: 'local', raid: raid as never, scene: new THREE.Scene(), seed, zone: 'zone7', build: '0.2.0', name: 'Tester', cls: 'neuroInfiltrator',
    reload: (...a) => reloads.push(a), deploy: () => { deployed.n++; }, changed: () => {},
  });
}

describe('online session', () => {
  it('a guest joins, picks the rival side, and both drop when the leader deploys', async () => {
    const lr = fakeRaid(), gr = fakeRaid();
    const ld = { n: 0 }, gd = { n: 0 };
    const lead = session(lr, 7, ld), guest = session(gr, 7, gd);
    lead.host('TSTB3');
    await until(() => lead.state === 'lobby');
    guest.join('TSTB3');
    await until(() => guest.state === 'lobby' && lead.members.length === 2 && guest.members.length === 2);
    expect(guest.deployGate()).toBe('wait');
    guest.setSquad(1);
    await until(() => lead.members.find((m) => m.id === guest.selfId)?.squad === 1);
    expect(lead.deployGate()).toBe('go');
    await until(() => gd.n === 1);
    expect(lead.state).toBe('raid');
    expect(guest.state).toBe('raid');
    expect(lr.player.spawned).toEqual([0, 0]);
    // The rival squad lands at the far container site.
    expect(gr.player.spawned).toEqual([-90, 10]);
    lead.leave(false); guest.leave(false);
  });

  it('a guest on a different raid seed reloads into the leader\'s raid', async () => {
    const reloads: unknown[] = [];
    const lead = session(fakeRaid(), 11, { n: 0 }), guest = session(fakeRaid(), 12, { n: 0 }, reloads);
    lead.host('TSTC4');
    await until(() => lead.state === 'lobby');
    guest.join('TSTC4');
    await until(() => reloads.length === 1);
    expect(reloads[0]).toEqual(['TSTC4', 11, 'zone7']);
    lead.leave(false); guest.leave(false);
  });

  it('refuses guests on another build', async () => {
    const lead = session(fakeRaid(), 3, { n: 0 });
    const other = new NetSession({ kind: 'local', raid: fakeRaid() as never, scene: new THREE.Scene(), seed: 3, zone: 'zone7', build: '9.9.9', name: 'X', cls: 'goreBehemoth', reload: () => {}, deploy: () => {}, changed: () => {} });
    lead.host('TSTD5');
    await until(() => lead.state === 'lobby');
    other.join('TSTD5');
    await until(() => other.state === 'error');
    expect(other.message).toMatch(/Different game builds/);
    lead.leave(false); other.leave(false);
  });
});

describe('creature sync', () => {
  const peers = (authority: boolean, sent: NetMsg[]): NetPeers => ({
    selfId: authority ? 'L' : 'G', leaderId: 'L', authority, me: { id: authority ? 'L' : 'G', name: 'x', cls: 'neuroInfiltrator', squad: 0 },
    member: () => undefined, send: (m) => { sent.push(m); },
  });

  it('pairs boot creatures, spawns the leader\'s newcomers, follows snapshots and plays the leader\'s kills', () => {
    const mk = (seed: number, x: number) => new Abomination('needlemaw', ABOMINATIONS.needlemaw, x, 20, seed);
    const leadRaid = fakeRaid([mk(1, 0), mk(2, 4)]);
    const guestRaid = fakeRaid([mk(1, 0), mk(2, 4)]);
    const toGuest: NetMsg[] = [], toLead: NetMsg[] = [];
    const L = new NetRaid(leadRaid as never, new THREE.Scene(), peers(true, toGuest));
    const G = new NetRaid(guestRaid as never, new THREE.Scene(), peers(false, toLead));
    G.adoptRoster(L.roster());
    expect(guestRaid.spawned).toHaveLength(0);
    // A reinforcement on the leader reaches the guest as a spawn before any snapshot names it.
    leadRaid.creatures.push(mk(3, 30));
    leadRaid.phase = 'raid'; guestRaid.phase = 'raid';
    leadRaid.creatures[0].brain.body.x = 5;
    L.tick(0.2);
    const spawn = toGuest.find((m) => m.t === 'spawn');
    const cs = toGuest.find((m) => m.t === 'cs');
    expect(spawn).toBeTruthy();
    expect(cs).toBeTruthy();
    for (const m of toGuest) G.handle('L', m);
    expect(guestRaid.spawned).toHaveLength(1);
    expect(guestRaid.spawned[0].seed).toBe(leadRaid.creatures[2].seed);
    for (let i = 0; i < 10; i++) { G.tick(0.05); G.follow(0.05); }
    expect(guestRaid.creatures[0].position.x).toBeCloseTo(5, 1);
    // The leader's kill reaches the guest; credit only to the host named.
    G.handle('L', { t: 'dead', id: leadRaid.creatures[1].id, by: 'G' });
    expect(guestRaid.creatures[1].alive).toBe(false);
    // Guest damage goes to the leader under the leader's id.
    G.damageCreature(guestRaid.creatures[0], 12, true, null, new THREE.Vector3());
    const d = toLead.find((m) => m.t === 'cdmg');
    expect(d && d.t === 'cdmg' && d.id).toBe(leadRaid.creatures[0].id);
  });

  it('Abomination.follow poses the body from a snapshot without running its brain', () => {
    const a = new Abomination('needlemaw', ABOMINATIONS.needlemaw, 0, 0, 9);
    a.follow(1 / 60, { x: 3, z: -4, yaw: 1, vx: 2, vz: 0, altitude: 0, excite: 1, windup: 0.5, visibility: 1, look: { x: 0, y: 1, z: 0 }, biomass: 20, state: 'chase' });
    expect(a.position.x).toBe(3);
    expect(a.position.z).toBe(-4);
    expect(a.state).toBe('chase');
    expect(a.biomass).toBe(20);
    expect(a.brain.events).toHaveLength(0);
    a.killedRemotely();
    expect(a.alive).toBe(false);
  });
});
