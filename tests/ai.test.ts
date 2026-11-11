import { describe, expect, it } from 'vitest';
import { ABOMINATIONS, AI, NESTS } from '../data';
import {
  AttackTokens, Awareness, WaveDirector, archetypeOf, createBrain, hostVisibility, sightRate,
  type AIEvent, type Brain, type BrainWorld, type HostView,
} from '../src/ai';
import type { Noise } from '../src/game/perception';
import { mulberry32 } from '../src/world/zone7';

const host = (o: Partial<HostView> = {}): HostView => ({
  x: 0, y: 0, z: 0, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o,
});

interface Sim { world: BrainWorld; events: { brain: Brain; e: AIEvent; t: number }[]; t: number }

/** Steps brains against a host for `seconds`. `move` can steer the host each frame. */
function simulate(brains: Brain[], seconds: number, h: HostView, opts: { noises?: Noise[]; move?: (h: HostView, t: number, dt: number) => void; each?: (s: Sim) => void } = {}): Sim {
  const tokens = new AttackTokens();
  const allies = brains.map((b) => ({ id: b.id, kind: b.kind, get alive() { return b.mode !== 'dead'; }, position: { x: b.body.x, y: 0, z: b.body.z } }));
  const world: BrainWorld = { host: h, noises: opts.noises ?? [], allies, tokens, playableRadius: 500 };
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
    expect(new Set(Object.values(AI.archetypes))).toEqual(new Set(['swarm', 'spitter', 'stalker', 'flyer', 'tank']));
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
