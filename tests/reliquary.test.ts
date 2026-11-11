import { describe, expect, it } from 'vitest';
import { BOSSES } from '../data';
import { ReliquaryBrain, type BossEvent, type HostView } from '../src/ai';

const R = BOSSES.reliquary;
const host = (o: Partial<HostView> = {}): HostView => ({ x: 0, y: 0, z: 0, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: null, ...o });

function run(b: ReliquaryBrain, seconds: number, opts: { fraction?: number | ((t: number) => number); host?: HostView; sac?: boolean; legs?: number } = {}) {
  const events: { e: BossEvent; t: number }[] = [];
  const h = opts.host ?? host();
  for (let i = 0, t = 0; i < seconds * 60; i++, t += 1 / 60) {
    const f = typeof opts.fraction === 'function' ? opts.fraction(t) : opts.fraction ?? 1;
    b.step(1 / 60, { host: h, fraction: f, broodSacAlive: opts.sac ?? true, legsIntact: opts.legs ?? 6, arena: { x: 0, z: 0 } });
    for (const e of b.events) events.push({ e, t });
    b.events.length = 0;
  }
  return events;
}
const types = (ev: { e: BossEvent }[]) => ev.map((x) => x.e.type);

describe('Reliquary data', () => {
  it('every attack that strikes has a wind-up (the tell), and every phase a turn rate and speed', () => {
    for (const p of R.phases) {
      expect(typeof p.turnRate, p.id).toBe('number');
      expect(typeof p.speed, p.id).toBe('number');
      for (const [id, a] of Object.entries(p.attacks as Record<string, Record<string, unknown>>)) {
        if (id === 'lightFlood') continue; // a growing hazard, not a strike
        expect(typeof a.windup, `${p.id}.${id}`).toBe('number');
        expect(a.windup as number, `${p.id}.${id}`).toBeGreaterThan(0.4);
      }
    }
    expect(R.wakeRadius).toBeGreaterThan(0);
  });
});

describe('Reliquary brain', () => {
  it('sleeps until a host enters the bowl, then wakes and sings across the island', () => {
    const b = new ReliquaryBrain(0, 0);
    expect(types(run(b, 2, { host: host({ x: R.wakeRadius + 20 }) }))).toEqual([]);
    expect(b.state).toBe('dormant');
    const ev = run(b, 0.1, { host: host({ x: R.wakeRadius - 2 }) });
    expect(ev[0].e).toEqual({ type: 'wake', songRadius: R.songRadius });
  });
  it('a wound wakes it too', () => {
    const b = new ReliquaryBrain(0, 0);
    b.hurt();
    expect(b.state).toBe('awake');
  });
  it('stalk: stamps where the host stood, sweeps in front, drops brood after its first delay', () => {
    const b = new ReliquaryBrain(0, 0, 0);
    const ev = run(b, 20, { host: host({ z: 6 }) });
    const ty = types(ev);
    expect(ty).toContain('sweep');
    expect(ty).toContain('stamp');
    const brood = ev.find((x) => x.e.type === 'brood')!;
    const first = (R.phases[0].attacks as Record<string, { firstDelay: number; windup: number }>).broodDrop;
    expect(brood.t).toBeGreaterThanOrEqual(first.firstDelay + first.windup - 0.05);
    // Every strike came after its wind-up: nothing lands in the first second.
    expect(ev.filter((x) => ['stamp', 'sweep'].includes(x.e.type)).every((x) => x.t > 0.85)).toBe(true);
  });
  it('a destroyed brood sac stops the drops', () => {
    const b = new ReliquaryBrain(0, 0);
    b.hurt();
    expect(types(run(b, 40, { host: host({ z: 30 }), sac: false }))).not.toContain('brood');
  });
  it('stalk front armour blocks frontal fire; collapse takes extra', () => {
    const b = new ReliquaryBrain(0, 0, 0); // facing +Z
    const p0 = R.phases[0] as unknown as { frontArmourMultiplier: number };
    expect(b.bodyMultiplier(0, 20)).toBe(p0.frontArmourMultiplier);
    expect(b.bodyMultiplier(0, -20)).toBe(1);
    b.hurt();
    run(b, 0.1, { fraction: 0.2 });
    expect(b.phase.id).toBe('collapse');
    expect(b.bodyMultiplier(0, 20)).toBe((R.phases[2] as unknown as { bodyDamageMultiplier: number }).bodyDamageMultiplier);
  });
  it('bloom: rears and vents with the hearts exposed, sings a hymn ring', () => {
    const b = new ReliquaryBrain(0, 0);
    b.hurt();
    let heartsSeen = false;
    const ev: { e: BossEvent; t: number }[] = [];
    for (let i = 0; i < 25 * 60; i++) {
      b.step(1 / 60, { host: host({ z: 9 }), fraction: 0.5, broodSacAlive: true, legsIntact: 6, arena: { x: 0, z: 0 } });
      ev.push(...b.events.map((e) => ({ e, t: i / 60 }))); b.events.length = 0;
      if (b.heartsOpen && b.rear > 0.8) heartsSeen = true;
    }
    expect(types(ev)).toContain('phase');
    expect(types(ev)).toContain('vent');
    expect(types(ev)).toContain('hymn');
    expect(heartsSeen).toBe(true);
  });
  it('collapse: lunges and grabs, the light pool floods outward, and it enrages on time', () => {
    const b = new ReliquaryBrain(0, 0);
    b.hurt();
    const ev = run(b, 30, { host: host({ z: 8 }), fraction: 0.2 });
    expect(types(ev)).toContain('drag');
    expect(types(ev)).toContain('grab');
    const flood = (R.phases[2].attacks as Record<string, { poolGrowsTo: number; overSeconds: number }>).lightFlood;
    expect(b.pool).toBeCloseTo(flood.poolGrowsTo * (30 / flood.overSeconds), 1);
    run(b, R.enrage.after, { host: host({ z: 8 }), fraction: 0.2 });
    expect(b.enraged).toBe(true);
    expect(b.pool).toBe(1);
  });
  it('severed legs slow it', () => {
    const a = new ReliquaryBrain(0, 0, 0), c = new ReliquaryBrain(0, 0, 0);
    a.hurt(); c.hurt();
    run(a, 3, { host: host({ z: 40 }), fraction: 0.5, sac: false });
    run(c, 3, { host: host({ z: 40 }), fraction: 0.5, sac: false, legs: 2 });
    expect(c.body.z).toBeLessThan(a.body.z * 0.6);
  });
});
