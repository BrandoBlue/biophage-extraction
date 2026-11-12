import { describe, expect, it } from 'vitest';
import { ABOMINATIONS, AI, NESTS } from '../data';
import {
  AttackTokens, Awareness, RaidMemory, mindLevels, mindPulse, WaveDirector, WebField, archetypeOf, createBrain, hostVisibility, sightRate,
  type AIEvent, type Brain, type BrainWorld, type HostView,
} from '../src/ai';
import type { Noise } from '../src/game/perception';
import { mulberry32 } from '../src/world/zone7';

const host = (o: Partial<HostView> = {}): HostView => ({
  x: 0, y: 0, z: 0, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o,
});

interface Sim { world: BrainWorld; events: { brain: Brain; e: AIEvent; t: number }[]; t: number }

/** Steps brains against a host for `seconds`. `move` can steer the host each frame. */
function simulate(brains: Brain[], seconds: number, h: HostView, opts: { noises?: Noise[]; move?: (h: HostView, t: number, dt: number) => void; each?: (s: Sim) => void; memory?: RaidMemory; tokens?: AttackTokens } = {}): Sim {
  const tokens = opts.tokens ?? new AttackTokens();
  const allies = brains.map((b) => ({ id: b.id, kind: b.kind, get alive() { return b.mode !== 'dead'; }, position: { x: b.body.x, y: 0, z: b.body.z } }));
  const world: BrainWorld = { host: h, noises: opts.noises ?? [], allies, tokens, playableRadius: 500, memory: opts.memory };
  const sim: Sim = { world, events: [], t: 0 };
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    sim.t += dt;
    tokens.tick(dt);
    opts.move?.(h, sim.t, dt);
    for (let k = 0; k < brains.length; k++) {
      const b = brains[k];
      b.step(dt, world);
      allies[k].position.x = b.body.x; allies[k].position.z = b.body.z;
      for (const e of b.events) sim.events.push({ brain: b, e, t: sim.t });
      b.events.length = 0;
    }
    opts.each?.(sim);
  }
  return sim;
}

const at = (kind: string, id: number, x: number, z: number, seed = id) => createBrain(kind, id, x, z, seed);
const hunting = (b: Brain) => { b.alert({ x: 0, z: 0 }); return b; };

describe('archetypes', () => {
  it('maps every Larva Abomination to a real archetype and real data', () => {
    for (const k of ['needlemaw', 'bilecantor', 'glasswalker', 'oculimoth', 'mournback']) {
      expect(ABOMINATIONS[k], k).toBeDefined();
      expect(AI.archetypes[k], k).toBeDefined();
    }
    expect(new Set(Object.values(AI.archetypes))).toEqual(new Set(['swarm', 'spitter', 'stalker', 'flyer', 'tank', 'mimic', 'grazer', 'weaver', 'burrower', 'herd', 'wader', 'crawler', 'grabber', 'gunner']));
    for (const k of Object.keys(AI.archetypes)) expect(ABOMINATIONS[k], k).toBeDefined();
    expect(archetypeOf('glasswalker')).toBe('stalker');
  });
});

describe('light: host visibility', () => {
  const base = { moving: true, sprinting: false, crouched: false, sinceShot: Infinity, virus: 1 };
  it('crouching hides, sprinting and firing expose', () => {
    const walk = hostVisibility(base);
    expect(hostVisibility({ ...base, crouched: true })).toBeLessThan(hostVisibility({ ...base, moving: false }));
    expect(hostVisibility({ ...base, moving: false })).toBeLessThan(walk);
    expect(hostVisibility({ ...base, sprinting: true })).toBeGreaterThan(walk);
    expect(hostVisibility({ ...base, sinceShot: 0 })).toBeCloseTo(AI.light.muzzleFlash);
    expect(hostVisibility({ ...base, sinceShot: AI.light.flashTime + 0.01 })).toBeCloseTo(walk);
  });
  it('Plague-Stalker glowing footprints make a moving host easier to spot', () => {
    expect(hostVisibility({ ...base, virus: 1.5 })).toBeCloseTo(hostVisibility(base) * 1.5);
    expect(hostVisibility({ ...base, moving: false, virus: 1.5 })).toBeCloseTo(hostVisibility({ ...base, moving: false }));
  });
});

describe('perception', () => {
  const p = ABOMINATIONS.needlemaw.perception;
  it('sight depends on field of view, range and visibility', () => {
    // Creature at origin facing +Z.
    expect(sightRate(p, 0, 0, 0, host({ z: 20 }))).toBeGreaterThan(0);
    expect(sightRate(p, 0, 0, 0, host({ z: -20 }))).toBe(0); // behind it
    expect(sightRate(p, 0, 0, 0, host({ z: -2 }))).toBeGreaterThan(0); // too close to miss
    expect(sightRate(p, 0, 0, 0, host({ z: 25, visibility: 0.6 }))).toBe(0); // crouched past 18 m
    expect(sightRate(p, 0, 0, 0, host({ z: 25, visibility: 1 }))).toBeGreaterThan(0);
    expect(sightRate(p, 0, 0, 0, host({ z: 10 }))).toBeGreaterThan(sightRate(p, 0, 0, 0, host({ z: 25 })));
  });
  it('a gunshot makes a creature suspicious; repeated shots make it hunt; silence calms it', () => {
    const a = new Awareness(p);
    const h = host({ x: 0, z: -20 }); // behind and out of sight
    const shot: Noise = { x: 0, z: -20, radius: 45 };
    for (let i = 0; i < 6; i++) a.update(1 / 60, 0, 0, 0, h, i === 0 ? [shot] : []);
    expect(a.suspicious).toBe(true);
    expect(a.hunting).toBe(false);
    expect(a.lastKnown).toEqual({ x: 0, z: -20 });
    for (let k = 0; k < 3; k++) for (let i = 0; i < 6; i++) a.update(1 / 60, 0, 0, 0, h, i === 0 ? [shot] : []);
    expect(a.hunting).toBe(true);
    for (let i = 0; i < 60 * 30; i++) a.update(1 / 60, 0, 0, 0, h, []);
    expect(a.suspicious).toBe(false);
  });
  it('a hidden or dead host is never noticed', () => {
    const a = new Awareness(p);
    for (let i = 0; i < 120; i++) a.update(1 / 60, 0, 0, 0, host({ z: 3, hidden: true }), [{ x: 0, z: 3, radius: 40 }]);
    expect(a.level).toBe(0);
  });
});

describe('attack tokens', () => {
  it('caps simultaneous attackers and frees slots on release or expiry', () => {
    const t = new AttackTokens({ melee: 2, ranged: 1 }, 3);
    expect(t.request(1, 'melee')).toBe(true);
    expect(t.request(2, 'melee')).toBe(true);
    expect(t.request(3, 'melee')).toBe(false);
    expect(t.request(4, 'ranged')).toBe(true);
    t.release(1);
    expect(t.request(3, 'melee')).toBe(true);
    t.tick(3.1);
    expect(t.count('melee')).toBe(0);
  });
});

describe('swarm (Needlemaw)', () => {
  it('a pack surrounds the host, never more than the token limit attack at once, and it bites', () => {
    const pack = Array.from({ length: 6 }, (_, i) => hunting(at('needlemaw', i + 1, Math.cos(i) * 20, 15 + Math.sin(i) * 5)));
    let maxAttacking = 0;
    const sim = simulate(pack, 12, host(), {
      each: () => { maxAttacking = Math.max(maxAttacking, pack.filter((b) => ['approach', 'windup', 'lunge'].includes(b.phase)).length); },
    });
    expect(maxAttacking).toBeLessThanOrEqual(AI.tokens.melee);
    expect(sim.events.filter((e) => e.e.type === 'melee').length).toBeGreaterThan(2);
    const ringers = pack.filter((b) => b.phase === 'ring');
    expect(ringers.length).toBeGreaterThan(0);
    for (const b of ringers) expect(Math.hypot(b.body.x, b.body.z)).toBeLessThan(AI.swarm.ringRadius[1] + 4);
    // They spread round the host rather than queueing on one side.
    const angles = pack.map((b) => Math.atan2(b.body.x, b.body.z));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(1.2);
  });
  it('telegraphs each bite with a wind-up the host can see', () => {
    const b = hunting(at('needlemaw', 1, 0, 6));
    let sawWindup = false;
    const sim = simulate([b], 5, host(), { each: () => { if (b.phase === 'windup' && b.windup > 0.5) sawWindup = true; } });
    const first = sim.events.find((e) => e.e.type === 'melee');
    expect(sawWindup).toBe(true);
    expect(first!.t).toBeGreaterThan(ABOMINATIONS.needlemaw.windup);
  });
});

describe('stalker (Glasswalker)', () => {
  it('freezes and nearly vanishes while the host watches it', () => {
    const b = hunting(at('glasswalker', 1, 0, 20)); // host at origin looks +Z, straight at it
    simulate([b], 3, host());
    expect(b.speed).toBeLessThan(0.3);
    expect(b.visibility).toBeLessThan(0.15);
    expect(b.phase).toBe('stalk');
  });
  it('works round to the flank when unwatched, charges, strikes and fades', () => {
    const b = hunting(at('glasswalker', 1, 0, -22)); // behind the host
    const sim = simulate([b], 8, host());
    const types = sim.events.map((e) => e.e.type);
    expect(types).toContain('charge');
    expect(types).toContain('melee');
    expect(['fade', 'stalk']).toContain(b.phase);
  });
  it('a hit reveals it', () => {
    const b = hunting(at('glasswalker', 1, 0, 20));
    simulate([b], 1, host());
    b.hurt();
    simulate([b], 0.5, host());
    expect(b.visibility).toBeGreaterThan(0.9);
  });
});

describe('flyer (Oculimoth)', () => {
  it('a swarm orbits, pecks, and screeches at most once per screech cooldown', () => {
    const swarm = Array.from({ length: 6 }, (_, i) => hunting(at('oculimoth', i + 1, Math.cos(i) * 8, Math.sin(i) * 8)));
    const sim = simulate(swarm, 20, host());
    const screeches = sim.events.filter((e) => e.e.type === 'screech').map((e) => e.t);
    const cd = (ABOMINATIONS.oculimoth.screech as { cooldown: number }).cooldown;
    expect(screeches.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < screeches.length; i++) expect(screeches[i] - screeches[i - 1]).toBeGreaterThanOrEqual(cd - 0.05);
    expect(sim.events.filter((e) => e.e.type === 'melee').length).toBeGreaterThan(2);
    const [lo, hi] = ABOMINATIONS.oculimoth.flightHeight as [number, number];
    for (const b of swarm) expect(b.body.altitude).toBeGreaterThanOrEqual(lo - 1), expect(b.body.altitude).toBeLessThanOrEqual(hi + 1);
  });
});

describe('tank (Mournback)', () => {
  it('lines up, winds up for a full second and charges; a host who sidesteps makes it miss', () => {
    const b = hunting(at('mournback', 1, 0, 18));
    b.body.yaw = Math.PI; // facing the host
    const stand = simulate([b], 4, host());
    expect(stand.events.some((e) => e.e.type === 'charge')).toBe(true);
    expect(stand.events.some((e) => e.e.type === 'melee' && e.e.knockback > 0)).toBe(true);

    const c = hunting(at('mournback', 2, 0, 18));
    c.body.yaw = Math.PI;
    let launched = -1;
    const dodge = simulate([c], 4, host(), {
      move: (h, t, dt) => { if (launched >= 0 && t > launched && t < launched + 0.6) h.x += 9 * dt; },
      each: (s) => { if (launched < 0 && s.events.some((e) => e.e.type === 'charge')) launched = s.t; },
    });
    expect(launched).toBeGreaterThan(ABOMINATIONS.mournback.windup - 0.05);
    expect(dodge.events.some((e) => e.e.type === 'melee')).toBe(false);
  });
  it('turns slowly, so it keeps its armoured front toward a circling host only with lag', () => {
    const b = hunting(at('mournback', 1, 0, 10));
    b.body.yaw = Math.PI;
    simulate([b], 0.5, host({ x: 10, z: 10 }));
    const want = Math.atan2(10 - b.body.x, 10 - b.body.z);
    expect(Math.abs(Math.atan2(Math.sin(want - b.body.yaw), Math.cos(want - b.body.yaw)))).toBeGreaterThan(0.3);
  });
  it('slams when the host is close', () => {
    const b = hunting(at('mournback', 1, 0, 3));
    const sim = simulate([b], 2.5, host());
    expect(sim.events.find((e) => e.e.type === 'slam')).toBeDefined();
  });
});

describe('spitter (Bile Cantor)', () => {
  it('holds its preferred range, hovers and lobs bile ahead of a moving host', () => {
    const b = hunting(at('bilecantor', 1, 0, 8));
    const sim = simulate([b], 10, host({ vx: 5 }), { move: (h, _t, dt) => { h.x += h.vx * dt; } });
    const d = Math.hypot(b.body.x - sim.world.host.x, b.body.z - sim.world.host.z);
    const [near] = ABOMINATIONS.bilecantor.preferredRange as [number, number];
    expect(d).toBeGreaterThan(near - 4);
    expect(b.body.altitude).toBeGreaterThan(1);
    const spit = sim.events.find((e) => e.e.type === 'spit');
    expect(spit).toBeDefined();
    if (spit?.e.type === 'spit') expect(spit.e.target.x).toBeGreaterThan(0); // led toward +X
  });
});

describe('modes', () => {
  it('a wounded calm creature turns on the host; a dead host calms everything', () => {
    const b = at('needlemaw', 1, 0, -15);
    simulate([b], 0.5, host());
    expect(b.mode).toBe('calm');
    b.hurt();
    const s = simulate([b], 0.2, host());
    expect(b.mode).toBe('hunt');
    expect(s.events.some((e) => e.e.type === 'alert')).toBe(true);
    simulate([b], 0.2, host({ alive: false }));
    expect(b.mode).toBe('calm');
  });
  it('loses interest when the host breaks contact, then investigates the last known point', () => {
    const b = hunting(at('needlemaw', 1, 0, 25));
    simulate([b], 1, host({ z: -60, visibility: 0.3, forward: null }));
    simulate([b], ABOMINATIONS.needlemaw.perception.loseInterest + 1, host({ x: 120, z: 120, visibility: 0.3 }));
    expect(b.mode === 'investigate' || b.mode === 'calm').toBe(true);
  });
  it('a calm creature that hears something walks over to look', () => {
    const b = at('needlemaw', 1, 0, 0);
    b.body.yaw = 0;
    const s = simulate([b], 0.3, host({ z: -40 }), { noises: [{ x: 0, z: -15, radius: 40 }] });
    expect(s.events.some((e) => e.e.type === 'notice')).toBe(true);
    expect(['investigate', 'hunt']).toContain(b.mode);
  });
});

describe('Brood Heart wave director', () => {
  const nest = NESTS.broodHeart;
  it('sleeps until a host is near, then pulses scripted waves on its interval', () => {
    const d = new WaveDirector(nest, 0, 0, mulberry32(1));
    expect(d.update(10, nest.activationRadius + 1, 0)).toEqual([]);
    expect(d.state).toBe('dormant');
    expect(d.update(0.1, nest.activationRadius - 1, 0)).toEqual([]);
    expect(d.state).toBe('active');
    const first = d.update(nest.firstWaveDelay, 30, 0);
    expect(first.map((s) => s.type)).toEqual(nest.waves[0].flatMap((w) => Array(w.count).fill(w.type)));
    for (const s of first) expect(Math.hypot(s.x, s.z)).toBeCloseTo(AI.nestSpawn.ejectRadius);
    let total = first.length;
    for (let i = 1; i < nest.maxWaves; i++) total += d.update(nest.waveInterval, 30, 0).length;
    expect(d.wave).toBe(nest.maxWaves);
    expect(total).toBe(nest.waves.reduce((n, w) => n + w.reduce((m, s) => m + s.count, 0), 0));
    expect(d.state).toBe('spent');
    expect(d.update(100, 0, 0)).toEqual([]);
  });
  it('never has more than maxAliveFromNest of its brood alive; the overflow trickles out', () => {
    const d = new WaveDirector({ ...nest, maxAliveFromNest: 4 }, 0, 0);
    d.update(0, 0, 0);
    const out = d.update(nest.firstWaveDelay, 0, 3);
    expect(out.length).toBe(1);
    expect(d.pending).toBe(nest.waves[0][0].count - 1);
    expect(d.update(0.1, 0, 2).length).toBe(Math.min(2, d.pending + 2));
  });
  it('stops when destroyed', () => {
    const d = new WaveDirector(nest, 0, 0);
    d.update(nest.firstWaveDelay + 0.1, 0, 0);
    d.destroy();
    expect(d.update(nest.waveInterval, 0, 0)).toEqual([]);
    expect(d.state).toBe('destroyed');
  });
});

describe('performance', () => {
  it('80 hunting brains step a second of frames well inside budget', () => {
    const rand = mulberry32(7);
    const kinds = Object.keys(AI.archetypes);
    const brains = Array.from({ length: 80 }, (_, i) => hunting(at(kinds[i % kinds.length], i + 1, (rand() - 0.5) * 80, (rand() - 0.5) * 80)));
    simulate(brains, 0.5, host()); // warm-up (JIT)
    // Best of three runs: a shared CI runner can stall any single run.
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      simulate(brains, 1, host());
      best = Math.min(best, (performance.now() - t0) / 60);
    }
    expect(best).toBeLessThan(4); // ms per frame for 80 creatures, test overhead included (about 1 ms locally)
  });
});

describe('homes (data/habitats.json): leash, tanks, disguises, roosts', () => {
  const far = () => host({ x: 400, z: 400 });

  it('wanders within its roam leash and drifts home after being pulled away', () => {
    const b = at('needlemaw', 1, 0, 0);
    b.setHome(0, 0, { roam: 6 });
    let worst = 0;
    simulate([b], 40, far(), { each: () => { worst = Math.max(worst, Math.hypot(b.body.x, b.body.z)); } });
    expect(worst).toBeLessThan(6 + 1);
    // Dragged 40 m off (a chase that went cold): it walks back inside the leash.
    b.body.x = 40;
    simulate([b], 30, far());
    expect(Math.hypot(b.body.x, b.body.z)).toBeLessThan(6 + 1);
  });

  it('a Glasswalker in its tank ignores a host at 12 m and bursts out at 8 m', () => {
    const b = at('glasswalker', 2, 0, 0);
    b.setHome(0, 0, { hatchOnApproach: 8 });
    const x0 = b.body.x;
    const wait = simulate([b], 5, host({ x: 12, z: 0, visibility: 2 }));
    expect(b.lurking).toBe(true);
    expect(b.body.x).toBe(x0);
    expect(wait.events.length).toBe(0);
    b.alert({ x: 12, z: 0 }); // a packmate's alert does not open the tank
    expect(simulate([b], 0.5, host({ x: 12, z: 0 })).events.length).toBe(0);
    const out = simulate([b], 0.5, host({ x: 7, z: 0 }));
    expect(out.events.map((s) => s.e)).toContainEqual({ type: 'reveal', how: 'hatch' });
    expect(b.lurking).toBe(false);
    expect(b.mode).toBe('hunt');
  });

  it('a disguised Husk Mimic waits until the host is in striking range, or until it is shot', () => {
    const reach = ABOMINATIONS.huskMimic.attackRange + 1.5;
    const b = at('huskMimic', 3, 0, 0);
    b.setHome(0, 0, { disguise: 'cargoCrate' });
    simulate([b], 3, host({ x: reach + 2, z: 0 }));
    expect(b.lurking).toBe(true);
    const near = simulate([b], 0.3, host({ x: reach - 0.5, z: 0 }));
    expect(near.events.map((s) => s.e)).toContainEqual({ type: 'reveal', how: 'disguise' });
    const shot = at('huskMimic', 4, 0, 0);
    shot.setHome(0, 0, { disguise: 'cargoCrate' });
    shot.hurt();
    expect(shot.events).toContainEqual({ type: 'reveal', how: 'disguise' });
    expect(shot.lurking).toBe(false);
  });

  it('an Oculimoth roosts at its home height', () => {
    const b = at('oculimoth', 5, 0, 0);
    b.setHome(0, 0, { height: 10 });
    simulate([b], 8, far());
    expect(b.body.altitude).toBeGreaterThan(9);
  });
});

describe('menace: the stare, the fanned search, the ambush, the wounded retreat', () => {
  const M = AI.menace;
  type Inner = { hostVel: { x: number; z: number }; searchTo: unknown; chased: boolean; investigateFor: number };
  const inner = (b: Brain) => b as unknown as Inner;

  it('a creature that spots the host itself stops and stares before it comes; an alerted one comes at once', () => {
    const b = at('needlemaw', 1, 0, 12);
    b.body.yaw = Math.PI; // facing the host at the origin
    b.awareness.level = 0.98; // a moment from seeing it for what it is
    for (let i = 0; i < 60 && b.mode !== 'hunt'; i++) simulate([b], 1 / 60, host());
    expect(b.mode).toBe('hunt');
    const z0 = b.body.z;
    simulate([b], M.reaction[0] * 0.9, host());
    expect(b.phase).toBe('spot');
    expect(Math.abs(b.body.z - z0)).toBeLessThan(0.3);
    simulate([b], M.reaction[1] + 0.5, host());
    expect(b.phase).not.toBe('spot');
    expect(b.body.z).toBeLessThan(z0 - 1);

    const told = at('needlemaw', 2, 0, 12);
    told.alert({ x: 0, z: 0 });
    simulate([told], 0.05, host());
    expect(told.phase).not.toBe('spot');
  });

  it('a pack that loses the trail heads where the host was running and fans out to search', () => {
    const pack = [1, 2, 3, 4].map((i) => hunting(at('needlemaw', i, -2 + i, 2)));
    const away = host({ x: -300, z: -300, visibility: 0.3, forward: null });
    simulate(pack, 1 / 60, away);
    for (const b of pack) {
      b.awareness.sinceSeen = 2;
      b.awareness.lastKnown = { x: 0, z: 0 };
      inner(b).hostVel = { x: 6, z: 0 };
      inner(b).searchTo = null;
    }
    simulate(pack, 2.5, away);
    for (const b of pack) expect(b.phase).toBe('search');
    const meanX = pack.reduce((a, b) => a + b.body.x, 0) / pack.length;
    expect(meanX).toBeGreaterThan(4);
    let spread = 0;
    for (const a of pack) for (const b of pack) spread = Math.max(spread, Math.hypot(a.body.x - b.body.x, a.body.z - b.body.z));
    expect(spread).toBeGreaterThan(3);
  });

  /** Ends a chase that went cold for `kind` with `seed`; returns the brain once it has decided where to go. */
  const lose = (kind: string, seed: number) => {
    const b = at(kind, seed, 0, 0, seed);
    b.mode = 'investigate';
    b.awareness.lastKnown = { x: 0, z: 0 };
    b.awareness.level = 0;
    inner(b).chased = true;
    inner(b).investigateFor = 0;
    simulate([b], 1 / 60, host({ x: 0, z: -60, visibility: 0.3, forward: null }));
    return b;
  };

  it('after a cold chase a hunter may crouch where it lost you, and springs when you walk back in', () => {
    const ambushers = Array.from({ length: 20 }, (_, i) => lose('needlemaw', i + 1)).filter((b) => b.lurking);
    expect(ambushers.length).toBeGreaterThan(2);
    expect(ambushers.length).toBeLessThan(18);
    const b = ambushers[0];
    expect(b.lurkHow).toBe('ambush');
    simulate([b], 2, host({ x: 0, z: M.ambush.range + 6 }));
    expect(b.lurking).toBe(true);
    expect(Math.hypot(b.body.x, b.body.z)).toBeLessThan(0.01);
    const s = simulate([b], 0.1, host({ x: 0, z: M.ambush.range - 1 }));
    expect(s.events.some((e) => e.e.type === 'reveal' && e.e.how === 'ambush')).toBe(true);
    expect(b.mode).toBe('hunt');
    // An ambush nobody walks into goes cold, and it slinks home.
    const late = ambushers[1];
    simulate([late], M.ambush.time + 1, host({ x: 0, z: -80, visibility: 0.3, forward: null }));
    expect(late.lurking).toBe(false);
    // The Mournback never lies in wait.
    expect(Array.from({ length: 20 }, (_, i) => lose('mournback', i + 1)).some((x) => x.lurking)).toBe(false);
  });

  it('a badly hurt hunter may break off and run, then calls its pack and comes back; the Mournback never runs', () => {
    const runners = Array.from({ length: 12 }, (_, i) => {
      const b = hunting(at('needlemaw', i + 1, 0, 6, i + 1));
      simulate([b], 0.1, host());
      b.wound(M.wounded.fleeBelow - 0.05);
      return b;
    });
    const fled = runners.filter((b) => { simulate([b], 0.1, host()); return b.phase === 'flee'; });
    expect(fled.length).toBeGreaterThan(0);
    const b = fled[0], d0 = Math.hypot(b.body.x, b.body.z);
    let farthest = d0;
    const s = simulate([b], M.wounded.fleeTime + 0.5, host(), { each: () => { farthest = Math.max(farthest, Math.hypot(b.body.x, b.body.z)); } });
    expect(farthest).toBeGreaterThan(d0 + 3);
    expect(s.events.some((e) => e.e.type === 'alert')).toBe(true);
    expect(b.mode).toBe('hunt');
    expect(b.phase).not.toBe('flee');
    const tank = hunting(at('mournback', 9, 0, 10));
    simulate([tank], 0.1, host());
    tank.wound(0.05);
    simulate([tank], 0.5, host());
    expect(tank.phase).not.toBe('flee');
  });

  it('agile hunters juke out of the host\'s aim when it fires; not when it aims elsewhere or stays quiet', () => {
    const shot = [{ x: 0, z: 0, radius: 25 }];
    const dodges = (fwd: { x: number; z: number }, noises: typeof shot) => {
      let n = 0;
      for (let i = 1; i <= 8; i++) {
        const b = hunting(at('needlemaw', i, 0, 12, i));
        simulate([b], 0.05, host({ forward: fwd }));
        n += simulate([b], 2, host({ forward: fwd }), { noises }).events.filter((e) => e.e.type === 'dodge').length;
      }
      return n;
    };
    expect(dodges({ x: 0, z: 1 }, shot)).toBeGreaterThan(2);
    expect(dodges({ x: 1, z: 0 }, shot)).toBe(0);
    expect(dodges({ x: 0, z: 1 }, [])).toBe(0);
    const tank = hunting(at('mournback', 1, 0, 12));
    expect(simulate([tank], 2, host({ forward: { x: 0, z: 1 } }), { noises: shot }).events.some((e) => e.e.type === 'dodge')).toBe(false);
  });

  it('a wounded hunter limps', () => {
    const run = (left: number) => {
      const b = hunting(at('mournback', 5, 0, 60));
      if (left < 1) b.wound(left);
      simulate([b], 2, host());
      return 60 - b.body.z;
    };
    expect(run(M.wounded.limpBelow - 0.01)).toBeLessThan(run(1) * 0.9);
  });
});

describe('Host-milestone creatures: Husk Mimic, Lumen Grazer, Tithe Weaver', () => {
  it('maps the new kinds to their own archetypes', () => {
    expect(archetypeOf('huskMimic')).toBe('mimic');
    expect(archetypeOf('lumenGrazer')).toBe('grazer');
    expect(archetypeOf('titheWeaver')).toBe('weaver');
  });

  it('a Husk Mimic walks up like a host with no tell, splits open inside its reveal distance, then lunges', () => {
    const m = hunting(at('huskMimic', 1, 0, 16));
    const reveal = (ABOMINATIONS.huskMimic.disguise as { revealDistance: number }).revealDistance;
    let maxSpeed = 0, windupWhileActing = 0;
    const s = simulate([m], 8, host(), { each: () => {
      if (m.phase === 'act') { maxSpeed = Math.max(maxSpeed, m.speed); windupWhileActing = Math.max(windupWhileActing, m.windup); }
    } });
    expect(maxSpeed).toBeLessThanOrEqual(ABOMINATIONS.huskMimic.speed * AI.mimic.walkFactor + 0.01);
    expect(windupWhileActing).toBe(0);
    const rv = s.events.find((e) => e.e.type === 'reveal');
    expect(rv?.e).toMatchObject({ how: 'disguise' });
    expect(s.events.some((e) => e.e.type === 'melee' && e.t > rv!.t)).toBe(true);
    // It split open no further out than its reveal distance.
    expect(reveal).toBeGreaterThan(ABOMINATIONS.huskMimic.attackRange);
  });

  it('a shot Husk Mimic drops the act at once', () => {
    const m = hunting(at('huskMimic', 2, 0, 25));
    simulate([m], 0.5, host());
    m.hurt();
    const s = simulate([m], 0.1, host());
    expect(s.events.some((e) => e.e.type === 'reveal')).toBe(true);
    expect(m.phase).not.toBe('act');
  });

  it('a Lumen Grazer ignores hosts until hurt, then dives on them and calms after its dives', () => {
    const g = at('lumenGrazer', 3, 0, 20);
    simulate([g], 5, host({ x: 0, z: 18 }), { noises: [{ x: 0, z: 18, radius: 60 }] });
    expect(g.mode).toBe('calm');
    expect(g.body.altitude).toBeGreaterThan(AI.grazer.idleHeight * 0.5);
    g.hurt();
    const dives = (ABOMINATIONS.lumenGrazer.temperament as { panicDives: number }).panicDives;
    const s = simulate([g], 60, host({ x: 0, z: 0 }));
    const slams = s.events.filter((e) => e.e.type === 'slam');
    expect(slams.length).toBe(dives);
    expect(slams[0].e).toMatchObject({ damage: ABOMINATIONS.lumenGrazer.damage, radius: ABOMINATIONS.lumenGrazer.attackRange });
    simulate([g], (ABOMINATIONS.lumenGrazer.temperament as { calmAfter: number }).calmAfter + 2, host({ x: 0, z: 0 }));
    expect(g.mode).toBe('calm');
  });

  it('a Tithe Weaver strings webs round its home, strands across a running host\'s path, and spits from range', () => {
    const w = at('titheWeaver', 4, 0, 0);
    w.setHome(0, 0, { roam: 10 });
    const calm = simulate([w], 30, host({ x: 200, z: 200, visibility: 0.3, forward: null }));
    expect(calm.events.filter((e) => e.e.type === 'web').length).toBeGreaterThan(2);
    const hunt = hunting(at('titheWeaver', 5, 0, 15));
    const s = simulate([hunt], 12, host({ vx: 5 }), { move: (h, _t, dt) => { h.x += 5 * dt; } });
    expect(s.events.some((e) => e.e.type === 'spit')).toBe(true);
    const webs = s.events.filter((e) => e.e.type === 'web');
    expect(webs.length).toBeGreaterThan(0);
  });

  it('web strands root a host that walks through them and break; a dead weaver\'s web can be cleared', () => {
    const f = new WebField();
    f.add(1, { x: -5, z: 3 }, { x: 5, z: 3 }, 15, 6);
    expect(f.tripped({ x: 0, z: 0 }, { x: 0, z: 1 })).toEqual([]);
    expect(f.tripped({ x: 0, z: 2.5 }, { x: 0, z: 3.5 }).length).toBe(1);
    expect(f.strands.length).toBe(0);
    for (let i = 0; i < 8; i++) f.add(2, { x: i, z: 0 }, { x: i, z: 5 }, 15, 6);
    expect(f.strands.length).toBe(6);
    expect(f.clear(2).length).toBe(6);
    const s = f.add(3, { x: 0, z: 0 }, { x: 1, z: 0 }, 15).strand;
    expect(f.damage(s.id, 10)).toBe(false);
    expect(f.damage(s.id, 10)).toBe(true);
  });
});

describe('desert creatures: Dunewake and Bristleback', () => {
  it('a Dunewake swims under the sand out of reach, ripples in, bursts out to bite, then fights on the surface and dives', () => {
    const d = hunting(at('dunewake', 1, 0, 30));
    const B = ABOMINATIONS.dunewake.burrow as { triggerRadius: number; rippleTell: number };
    let swamUnder = false, rippleAt = -1, burstAt = -1, surfacedFor = 0, dived = false;
    const s = simulate([d], 20, host(), { each: (sim) => {
      if (d.phase === 'swim' && d.submerged >= 1) swamUnder = true;
      if (d.phase === 'ripple' && rippleAt < 0) { rippleAt = sim.t; expect(d.submerged).toBeGreaterThan(0.5); }
      if (d.phase === 'burst' && burstAt < 0) burstAt = sim.t;
      if (d.phase === 'surface') surfacedFor += 1 / 60;
      if (surfacedFor > 0 && d.phase === 'swim') dived = true;
    } });
    expect(swamUnder).toBe(true);
    expect(burstAt - rippleAt).toBeCloseTo(B.rippleTell, 1);
    const bite = s.events.find((e) => e.e.type === 'melee');
    expect(bite?.e).toMatchObject({ damage: ABOMINATIONS.dunewake.damage });
    expect(s.events.some((e) => e.e.type === 'reveal' && (e.e as { how: string }).how === 'ambush')).toBe(true);
    expect(surfacedFor).toBeGreaterThan(2);
    expect(dived).toBe(true);
  });

  it('a calm Dunewake idles under the sand', () => {
    const d = at('dunewake', 2, 0, 0);
    simulate([d], 3, host({ x: 300, z: 300, alive: false }));
    expect(d.submerged).toBe(1);
  });

  it('a Bristleback herd grazes past a host, but gunfire nearby raises the alarm and it stampedes', () => {
    const b = at('bristleback', 3, 0, 0);
    simulate([b], 5, host({ x: 0, z: 12 }));
    expect(b.mode).toBe('calm');
    const shot = simulate([b], 0.2, host({ x: 0, z: 18 }), { noises: [{ x: 0, z: 18, radius: 25 }] });
    expect(shot.events.some((e) => e.e.type === 'alarm')).toBe(true);
    const run = simulate([b], 6, host({ x: 0, z: 18 }));
    expect(b.engaged).toBe(true);
    expect(run.events.some((e) => e.e.type === 'charge' || e.e.type === 'volley')).toBe(true);
  });

  it('a hurt Bristleback stampedes through the host and trampling hits; it looses quill volleys between charges', () => {
    const b = at('bristleback', 4, 0, 0);
    b.hurt();
    const st = ABOMINATIONS.bristleback.stampede as { trampleDamage: number };
    const v = ABOMINATIONS.bristleback.quillVolley as { count: number; damage: number };
    const s = simulate([b], 40, host({ x: 0, z: 20 }));
    expect(s.events.some((e) => e.e.type === 'melee' && (e.e as { damage: number }).damage === st.trampleDamage)).toBe(true);
    const volley = s.events.find((e) => e.e.type === 'volley');
    expect(volley?.e).toMatchObject({ count: v.count, damage: v.damage });
  });
});

describe('swamp creatures: Fenstalker and Mistwader', () => {
  it('a Fenstalker lies under the water, creeps in, and bursts out to bite only inside its ambush range', () => {
    const f = hunting(at('fenstalker', 1, 0, 25));
    const S = ABOMINATIONS.fenstalker.submerge as { ambushRange: number; ripplesTell: number };
    let rippleAt = -1, burstAt = -1, rippleDist = 0, maxSpeed = 0;
    const s = simulate([f], 20, host(), { each: (sim) => {
      if (f.phase === 'swim' && f.submerged >= 1) maxSpeed = Math.max(maxSpeed, f.speed);
      if (f.phase === 'ripple' && rippleAt < 0) { rippleAt = sim.t; rippleDist = Math.hypot(f.body.x, f.body.z); }
      if (f.phase === 'burst' && burstAt < 0) burstAt = sim.t;
    } });
    expect(maxSpeed).toBeLessThanOrEqual(ABOMINATIONS.fenstalker.speed * AI.burrower.lurkCreep + 0.01);
    expect(rippleDist).toBeLessThanOrEqual(S.ambushRange + 0.5);
    expect(burstAt - rippleAt).toBeCloseTo(S.ripplesTell, 1);
    expect(s.events.find((e) => e.e.type === 'melee')?.e).toMatchObject({ damage: ABOMINATIONS.fenstalker.damage });
  });

  it('a Mistwader ignores hosts and gunfire, but hurt it and it wades in, rears and stamps, then calms', () => {
    const m = at('mistwader', 2, 0, 0);
    const st = ABOMINATIONS.mistwader.stomp as { radius: number; damage: number; knockback: number };
    const calm = simulate([m], 5, host({ x: 0, z: 14 }), { noises: [{ x: 0, z: 14, radius: 40 }] });
    expect(m.mode).toBe('calm');
    expect(calm.events.some((e) => e.e.type === 'slam')).toBe(false);
    m.hurt();
    let reared = 0;
    const s = simulate([m], 40, host({ x: 0, z: 10 }), { each: () => { if (m.phase === 'rear') reared = Math.max(reared, m.windup); } });
    const stamps = s.events.filter((e) => e.e.type === 'slam');
    expect(reared).toBeGreaterThan(0.95);
    expect(stamps[0].e).toMatchObject({ radius: st.radius, damage: st.damage, knockback: st.knockback });
    expect(stamps.length).toBe((ABOMINATIONS.mistwader.temperament as { panicStomps: number }).panicStomps);
  });

  it('a host underfoot gets one warning stamp', () => {
    const m = at('mistwader', 3, 0, 0);
    const s = simulate([m], 6, host({ x: 0, z: 1.5 }));
    expect(s.events.filter((e) => e.e.type === 'slam').length).toBe(1);
  });
});

describe('thinking: readable tactics over every hunt (ai.json tactics)', () => {
  const T = AI.tactics;
  const tact = (s: Sim, what: string) => s.events.filter((e) => e.e.type === 'tactic' && (e.e as { what: string }).what === what);

  it('a pack hunter that finds the host itself shows itself, backs off toward its pack, then springs them all at once', () => {
    const bait = at('needlemaw', 1, 0, 14, 1), p1 = at('needlemaw', 2, 0, 38, 2), p2 = at('needlemaw', 3, 2, 38, 3);
    bait.body.yaw = Math.PI; p1.body.yaw = 0; p2.body.yaw = 0;
    const h = host({ forward: { x: 0, z: -1 } });
    let lureAt = -1, startZ = 0, furthest = 0, sprung = -1;
    const s = simulate([bait, p1, p2], 14, h, { each: (sim) => {
      for (const e of sim.events) if (e.e.type === 'alarm' && sprung < 0) { sprung = e.t; for (const o of [bait, p1, p2]) if (o !== e.brain) o.alert({ x: 0, z: 0 }); }
      if (lureAt < 0 && tact(sim, 'lure').length) { const l = tact(sim, 'lure')[0].brain; lureAt = sim.t; startZ = l.body.z; }
      const l = tact(sim, 'lure')[0]?.brain;
      if (l && l.intent === 'lure') furthest = Math.max(furthest, l.body.z - startZ);
    } });
    expect(tact(s, 'lure').length).toBe(1);
    const lurer = tact(s, 'lure')[0].brain;
    expect(lurer).toBe(bait);
    // It did not call the pack the moment it saw the host.
    expect(s.events.some((e) => e.brain === lurer && e.e.type === 'alert' && e.t < lureAt + T.lure.show)).toBe(false);
    expect(furthest).toBeGreaterThan(1);
    expect(tact(s, 'spring').length).toBeGreaterThan(0);
    expect(sprung).toBeGreaterThan(lureAt + T.lure.show);
    for (const b of [bait, p1, p2]) expect(b.engaged).toBe(true);
  });

  it('when a packmate dies close by, the others falter and back off; lose most of the pack and the rest run', () => {
    const pack = [0, 1, 2, 3].map((i) => hunting(at('needlemaw', 10 + i, -6 + i * 4, 8, 10 + i)));
    simulate(pack, 1.5, host());
    pack[0].kill();
    let faltered = 0;
    const s = simulate(pack, 0.6, host(), { each: () => { for (const b of pack.slice(1)) if (b.intent === 'falter') faltered++; } });
    expect(tact(s, 'falter').length + tact(s, 'rout').length).toBeGreaterThan(0);
    expect(faltered).toBeGreaterThan(0);
    pack[1].kill(); pack[2].kill();
    const r = simulate(pack, 0.6, host());
    expect(tact(r, 'rout').map((e) => e.brain)).toContain(pack[3]);
  });

  it('a hunter held in the host\'s sights breaks sideways out of the line', () => {
    const c = hunting(at('bilecantor', 20, 0, 20, 20));
    const h = host({ forward: { x: 0, z: 1 }, aiming: true });
    let maxSide = 0;
    const s = simulate([c], 3, h, { each: () => { if (c.intent === 'evade') maxSide = Math.max(maxSide, Math.abs(c.body.x)); } });
    expect(tact(s, 'evade').length).toBeGreaterThan(0);
    expect(maxSide).toBeGreaterThan(0.5);
  });

  it('a reload is a window: the pack calls it and more of them commit at once', () => {
    const pack = [0, 1, 2, 3, 4].map((i) => hunting(at('needlemaw', 30 + i, Math.cos(i) * 7, Math.sin(i) * 7, 30 + i)));
    const h = host({ forward: null });
    let calm = 0, pressed = 0;
    simulate(pack, 3, h, { each: (sim) => { calm = Math.max(calm, sim.world.tokens.count('melee')); } });
    h.reloading = true;
    const s = simulate(pack, 2, h, { each: (sim) => { pressed = Math.max(pressed, sim.world.tokens.count('melee')); } });
    expect(tact(s, 'press').length).toBe(1);
    expect(calm).toBeLessThanOrEqual(AI.tokens.melee);
    expect(pressed).toBeGreaterThan(AI.tokens.melee);
  });

  it('shows what it is thinking: stares when it first sees the host, then hunts', () => {
    const c = at('glasswalker', 40, 0, 10, 40);
    c.body.yaw = Math.PI;
    let stared = false;
    simulate([c], 4, host(), { each: () => { if (c.intent === 'stare') stared = true; } });
    expect(stared).toBe(true);
    expect(['hunt', 'stalk', 'attack', 'press', 'evade']).toContain(c.intent);
  });
});

describe('learning within a raid (ai.json learning)', () => {
  const L = AI.learning;
  const adapted = (s: Sim) => s.events.some((e) => e.e.type === 'tactic' && (e.e as { what: string }).what === 'adapt');

  it('the pack notices a host digging into one spot, and once learned, waits outside instead of coming in', () => {
    const fresh = new RaidMemory();
    const pack = [0, 1, 2, 3].map((i) => hunting(at('needlemaw', 50 + i, Math.cos(i * 1.6) * 8, Math.sin(i * 1.6) * 8, 50 + i)));
    simulate(pack, L.campTime + 1, host({ forward: null }), { memory: fresh });
    expect(fresh.count('needlemaw', 'camp')).toBe(1);

    const mem = new RaidMemory();
    for (let i = 0; i < L.after; i++) mem.note('needlemaw', 'camp');
    const wary = [0, 1, 2, 3].map((i) => hunting(at('needlemaw', 60 + i, Math.cos(i * 1.6) * 8, Math.sin(i * 1.6) * 8, 60 + i)));
    const h = host({ forward: null });
    simulate(wary, L.campTime + 0.5, h, { memory: mem });
    let closest = Infinity;
    const s = simulate(wary, 6, h, { memory: mem, each: (sim) => { if (sim.t > 1.5) for (const b of wary) closest = Math.min(closest, Math.hypot(b.body.x, b.body.z)); } });
    expect(s.events.some((e) => e.e.type === 'melee')).toBe(false);
    expect(closest).toBeGreaterThan(AI.swarm.ringRadius[0]);
    // The host leaves the corner: they come.
    const out = simulate(wary, 8, h, { memory: mem, move: (hh, t) => { hh.x = t * 3; } });
    expect(out.events.some((e) => e.e.type === 'melee')).toBe(true);
  });

  it('kill the lunger twice and the pack starts faking the coil before the real lunge', () => {
    const mem = new RaidMemory();
    for (let k = 0; k < L.after; k++) {
      const n = hunting(at('needlemaw', 70 + k, 0, 6, 70 + k));
      simulate([n], 6, host({ forward: null }), { memory: mem, each: () => { if (n.phase === 'windup' && n.mode !== 'dead') n.kill(); } });
    }
    expect(mem.learned('needlemaw', 'lungerKilled')).toBe(true);
    const p = hunting(at('needlemaw', 80, 0, 6, 80));
    const phases: string[] = [];
    const s = simulate([p], 12, host({ forward: null }), { memory: mem, each: () => { if (phases[phases.length - 1] !== p.phase) phases.push(p.phase); } });
    const firstReal = phases.indexOf('windup');
    expect(phases.indexOf('fakeout')).toBeGreaterThanOrEqual(0);
    expect(phases.indexOf('fakeout')).toBeLessThan(firstReal < 0 ? Infinity : firstReal);
    expect(adapted(s)).toBe(true);
  });

  it('a Mournback learns which way the host sidesteps its charge and aims that side next time', () => {
    const mem = new RaidMemory();
    // Dodge: the host steps off the line as it charges.
    const m = hunting(at('mournback', 90, 0, 18, 90));
    m.body.yaw = Math.PI;
    const h = host({ forward: null });
    simulate([m], 8, h, { memory: mem, move: (hh) => { if (m.phase === 'charge') hh.x = Math.min(4, hh.x + 0.2); } });
    expect(mem.count('mournback', 'dodge+') + mem.count('mournback', 'dodge-')).toBeGreaterThan(0);
    // Learned: the next wind-up lines up beside the host, on the side it dodges to.
    const side = mem.count('mournback', 'dodge+') > 0 ? 'dodge+' : 'dodge-';
    for (let i = 0; i < L.after; i++) mem.note('mournback', side);
    const m2 = hunting(at('mournback', 91, 0, 18, 91));
    m2.body.yaw = Math.PI;
    let off = 0;
    const s = simulate([m2], 6, host({ forward: null }), { memory: mem, each: () => { if (m2.phase === 'chargeWindup' && m2.strike) off = Math.max(off, Math.abs(m2.strike.x)); } });
    expect(off).toBeGreaterThan(L.cutAhead * 0.8);
    expect(adapted(s)).toBe(true);
  });
});

describe('body language: the brain\'s thinking on Creature\'s drive.mind', () => {
  it('stares with a cocked head, braces before committing, recoils when a packmate falls, sleepy-eyed Oculimoth', () => {
    const v = (o: Partial<Parameters<typeof mindLevels>[0]>) => mindLevels({ kind: 'needlemaw', intent: 'hunt', windup: 0, phase: 'ring', frozen: false, ...o });
    expect(v({ intent: 'stare' })).toMatchObject({ tilt: expect.any(Number), still: expect.any(Number) });
    expect(v({ intent: 'stare' }).tilt).toBeGreaterThan(0.5);
    expect(v({ intent: 'attack', windup: 0.8 }).brace).toBeGreaterThan(0.9);
    expect(v({ intent: 'falter' }).recoil).toBeGreaterThan(0.5);
    expect(v({ kind: 'oculimoth', intent: 'idle' }).eyes).toBeLessThan(0.5);
    expect(v({ kind: 'oculimoth', intent: 'hunt' }).eyes).toBe(1);
    expect(v({ kind: 'glasswalker', frozen: true }).still).toBe(1);
    expect(mindPulse({ type: 'tactic', what: 'press' })).toBe('call');
    expect(mindPulse({ type: 'tactic', what: 'lure' })).toBe('glint');
    expect(mindPulse({ type: 'alert' })).toBe('call');
  });

  it('a stalker in the host\'s gaze reads as frozen', () => {
    const g = hunting(at('glasswalker', 99, 0, 14, 99));
    simulate([g], 2, host({ forward: { x: 0, z: 1 } }));
    expect(g.frozen).toBe(true);
    expect(mindLevels(g).still).toBe(1);
  });
});

describe('species working together and more learning (ai.json teamwork, learning)', () => {
  const L = AI.learning;
  it('a Bile Cantor winding up sings the Needlemaws onto the host; an Oculimoth screech calls the hunters', () => {
    const c = hunting(at('bilecantor', 1, 0, 25, 1));
    const s = simulate([c], 6, host());
    const r = s.events.find((e) => e.e.type === 'rally')?.e as { kinds: string[]; radius: number } | undefined;
    expect(r?.kinds).toEqual(AI.teamwork.calls.bilecantor.kinds);
    const o = hunting(at('oculimoth', 2, 0, 20, 2));
    const so = simulate([o], 8, host());
    if (so.events.some((e) => e.e.type === 'screech')) expect(so.events.some((e) => e.e.type === 'rally')).toBe(true);
  });

  it('a Glasswalker the host keeps checking on stops closing in and waits for a noise to cover it', () => {
    const mem = new RaidMemory();
    for (let i = 0; i < L.after; i++) mem.note('glasswalker', 'checked');
    const g = hunting(at('glasswalker', 3, 0, 22, 3));
    const h = host({ forward: { x: 1, z: 0 } });
    const quiet = simulate([g], 6, h, { memory: mem });
    expect(quiet.events.some((e) => e.e.type === 'charge')).toBe(false);
    expect(quiet.events.some((e) => e.e.type === 'tactic' && (e.e as { what: string }).what === 'adapt')).toBe(true);
    const loud = simulate([g], 3, h, { memory: mem, noises: [{ x: 0, z: 0, radius: 30 }] });
    expect(loud.events.some((e) => e.e.type === 'charge')).toBe(true);
  });

  it('a Mistwader shot at once wades away whenever it hears a host', () => {
    const mem = new RaidMemory();
    mem.note('mistwader', 'shot');
    const m = at('mistwader', 4, 0, 10, 4);
    simulate([m], 4, host({ x: 0, z: 0 }), { memory: mem, noises: [{ x: 0, z: 0, radius: 12 }] });
    expect(m.mode).toBe('calm');
    expect(m.body.z).toBeGreaterThan(12);
  });

  it('a Lumen Grazer herd keeps away from where a host hurt one of them', () => {
    const mem = new RaidMemory();
    mem.mark('lumenGrazer', 'hurt', { x: 0, z: 0 });
    const g = at('lumenGrazer', 5, 5, 0, 5);
    simulate([g], 10, host({ x: 300, z: 300, alive: false }), { memory: mem });
    expect(Math.hypot(g.body.x, g.body.z)).toBeGreaterThan(10);
  });

  it('a Bristleback herd shot at once stampedes at the first sight of a host', () => {
    const mem = new RaidMemory();
    const b = at('bristleback', 6, 0, 0, 6);
    simulate([b], 0.2, host({ x: 0, z: 18 }), { memory: mem, noises: [{ x: 0, z: 18, radius: 25 }] });
    expect(mem.count('bristleback', 'shot')).toBe(1);
    const b2 = at('bristleback', 7, 0, 0, 7);
    simulate([b2], 0.5, host({ x: 0, z: 15 }), { memory: mem });
    expect(b2.engaged).toBe(true);
  });
});

describe('learning switch', () => {
  it('learning is off for now (Brandon, 2026-11-12): raids get no memory', () => {
    expect(AI.learning.enabled).toBe(false);
  });
});

describe('Marrow Pit creatures: Cablecrawler, Veilwing, the Hollowed', () => {
  /** Four decks of a bridge running north along x = 0 at y 0, each 4 m long. */
  const bridge = () => [0, 1, 2, 3].map((i) => {
    let isCut = false;
    return { id: `b${i}`, x: 0, y: 0, z: i * 4, halfLength: 2, halfWidth: 1.2, yaw: 0, get isCut() { return isCut; }, cut() { isCut = true; } };
  });

  it('a Cablecrawler goes for the deck behind the host, chews (the tell), and cuts it; hurting it enough stops the chew', () => {
    const ws = bridge();
    const c = hunting(at('cablecrawler', 1, 6, 0, 1));
    const h = host({ x: 0, z: 12, vz: 2 });
    let chewed = 0;
    const tokens = new AttackTokens();
    const s = simulate([c], 8, h, { tokens, each: (sim) => { sim.world.walkways = ws; if (c.phase === 'chew') chewed = Math.max(chewed, c.action); } });
    const cut = s.events.find((e) => e.e.type === 'cut')?.e as { id: string } | undefined;
    expect(cut).toBeDefined();
    // Behind the host (the way back), never the deck underfoot (b3).
    expect(['b0', 'b1', 'b2']).toContain(cut!.id);
    expect(chewed).toBeGreaterThan(0.9);
    const ws2 = bridge();
    const c2 = hunting(at('cablecrawler', 2, 6, 0, 2));
    const cd = ABOMINATIONS.cablecrawler.cutWalkway as { interruptDamage: number };
    const s2 = simulate([c2], 8, host({ x: 0, z: 12, vz: 2 }), { each: (sim) => { sim.world.walkways = ws2; if (c2.phase === 'chew' && c2.action > 0.3) c2.hurt(cd.interruptDamage); } });
    expect(s2.events.some((e) => e.e.type === 'cut')).toBe(false);
  });

  it('a Veilwing goes silent, spreads over the host, drops, grabs, carries toward the shaft and lets go', () => {
    const v = hunting(at('veilwing', 3, 10, 10, 3));
    const phases: string[] = [];
    let carriedTo = Infinity;
    const s = simulate([v], 25, host(), { each: (sim) => {
      sim.world.dropZone = { x: 40, z: 0 };
      if (phases[phases.length - 1] !== v.phase) phases.push(v.phase);
      if (v.phase === 'carry') carriedTo = Math.min(carriedTo, Math.hypot(v.body.x - 40, v.body.z));
    } });
    const order = ['hush', 'tell', 'drop', 'carry'].map((p) => phases.indexOf(p));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(s.events.find((e) => e.e.type === 'grab')?.e).toMatchObject({ damage: ABOMINATIONS.veilwing.damage });
    expect(s.events.some((e) => e.e.type === 'release')).toBe(true);
    expect(carriedTo).toBeLessThan(40);
  });

  it('a Veilwing hurt enough while carrying lets go early', () => {
    const v = hunting(at('veilwing', 4, 10, 10, 4));
    const g = ABOMINATIONS.veilwing.grab as { freedByDamage: number; carryTime: number };
    let freedAt = -1, grabbedAt = -1;
    simulate([v], 25, host(), { each: (sim) => {
      for (const e of sim.events) { if (e.e.type === 'grab' && grabbedAt < 0) { grabbedAt = e.t; v.hurt(g.freedByDamage); } if (e.e.type === 'release' && freedAt < 0) freedAt = e.t; }
    } });
    expect(grabbedAt).toBeGreaterThan(0);
    expect(freedAt - grabbedAt).toBeLessThan(g.carryTime * 0.5);
  });

  it('the Hollowed raises its gun, fires a short burst, then reloads far too slowly', () => {
    const g = hunting(at('hollowed', 5, 0, 20, 5));
    const W = ABOMINATIONS.hollowed.usesWeapon as { burst: [number, number]; accuracy: number };
    let aimed = 0;
    const s = simulate([g], 8, host(), { each: () => { if (g.phase === 'aim') aimed = Math.max(aimed, g.windup); } });
    const shots = s.events.filter((e) => e.e.type === 'shot');
    expect(aimed).toBeGreaterThan(0.9);
    expect(shots.length).toBeGreaterThanOrEqual(W.burst[0]);
    expect(shots[0].e).toMatchObject({ damage: ABOMINATIONS.hollowed.damage, accuracy: W.accuracy });
    // The first burst comes as one group, then a long pause.
    const first = shots.filter((e) => e.t - shots[0].t < 1.5);
    expect(first.length).toBeLessThanOrEqual(W.burst[1]);
    const next = shots.find((e) => e.t - shots[0].t >= 1.5);
    if (next) expect(next.t - first[first.length - 1].t).toBeGreaterThan(AI.gunner.reloadTime * 0.9);
  });
});
