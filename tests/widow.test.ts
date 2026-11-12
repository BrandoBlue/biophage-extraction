import { describe, expect, it } from 'vitest';
import { AI, BOSSES } from '../data';
import type { HostView } from '../src/ai';
import { WidowBrain, type WidowCrater, type WidowEvent } from '../src/ai/widow';

const B = BOSSES.sandwidow;
const atk = (p: string, a: string) => (B.phases.find((x) => x.id === p)!.attacks as Record<string, Record<string, unknown>>)[a];
const crater: WidowCrater = { x: 0, z: 0, radius: 52, floorY: 0 };
const host = (x: number, z: number, o: Partial<HostView> = {}): HostView => ({ x, y: 0, z, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o });

function run(b: WidowBrain, seconds: number, at: (t: number) => HostView, fraction = 1, dt = 1 / 30, each?: () => void): WidowEvent[] {
  const out: WidowEvent[] = [];
  for (let t = 0; t < seconds; t += dt) {
    b.step(dt, { host: at(t), fraction, crater });
    out.push(...b.events.splice(0));
    each?.();
  }
  return out;
}
const of = <T extends WidowEvent['type']>(ev: WidowEvent[], type: T) => ev.filter((e): e is Extract<WidowEvent, { type: T }> => e.type === type);
const fresh = () => new WidowBrain(0, 0);

describe('The Sandwidow', () => {
  it('lies under the crater until a host steps onto its floor', () => {
    const b = fresh();
    expect(run(b, 2, () => host(80, 0))).toEqual([]);
    expect(b.awake).toBe(false);
    expect(of(run(b, 0.2, () => host(20, 0)), 'wake').length).toBe(1);
  });

  it('circles under the sand out of reach, and breaches to breathe on a schedule with her sacs exposed', () => {
    const b = fresh();
    let under = 0, exposed = 0;
    const s = atk('circle', 'surface') as { every: number; duration: number };
    const ev = run(b, s.every + s.duration + 2, () => host(10, 0), 1, 1 / 30, () => { if (b.submerged) under++; if (b.sacsExposed) exposed++; });
    expect(under).toBeGreaterThan(30 * 5);
    expect(of(ev, 'surface').length).toBeGreaterThan(0);
    expect(exposed).toBeGreaterThan(30);
    expect(of(ev, 'dive').length).toBeGreaterThan(0);
  });

  it('the undertow warns with a funnel where the host stood, then bites up through it', () => {
    const b = fresh();
    const u = atk('circle', 'undertow') as { damage: number; radius: number; windup: number };
    const ev = run(b, 14, () => host(10, 0));
    const f = of(ev, 'funnel')[0], bite = of(ev, 'undertow')[0];
    expect(f).toMatchObject({ radius: u.radius, warning: u.windup });
    expect(bite).toMatchObject({ damage: u.damage, radius: u.radius, at: f.at });
  });

  it('calls Dunewake from her throat after the first delay', () => {
    const b = fresh();
    const c = atk('circle', 'broodCall') as { firstDelay: number; windup: number; spawn: { type: string; count: number } };
    const ev = run(b, c.firstDelay + c.windup + 1, () => host(10, 0));
    expect(of(ev, 'brood')[0]).toMatchObject({ spawnType: c.spawn.type, count: c.spawn.count });
  });

  it('erupting, she bursts out under the host, stays up, and sand-blasts; severed petals blunt her bite', () => {
    const b = fresh();
    run(b, 0.2, () => host(10, 0));
    const br = atk('erupt', 'breach') as { damage: number; radius: number };
    const ev = run(b, 25, () => host(10, 0), 0.5);
    const hit = of(ev, 'breach')[0];
    expect(hit.damage).toBe(br.damage);
    expect(Math.hypot(hit.at.x - 10, hit.at.z)).toBeLessThan(br.radius);
    expect(of(ev, 'blast')[0]).toMatchObject({ damage: atk('erupt', 'sandBlast').damage, blind: atk('erupt', 'sandBlast').blindDuration });
    expect(b.petalsSeverable || of(ev, 'dive').length > 0).toBe(true);
    b.severPetal(); b.severPetal();
    expect(b.biteScale()).toBeCloseTo(1 - 2 * AI.widow.petalBite);
  });

  it('drowning, the floor turns to quicksand and she thrashes; enraged, the whole floor sucks', () => {
    const b = fresh();
    run(b, 0.2, () => host(10, 0));
    const ev = run(b, 10, () => host(6, 0), 0.2);
    const q = atk('drown', 'quicksand') as { floorFraction: number; slowMultiplier: number };
    expect(of(ev, 'quicksand')[0]).toMatchObject({ fraction: q.floorFraction, slow: q.slowMultiplier });
    expect(of(ev, 'thrash')[0]?.damage).toBe(atk('drown', 'thrash').damage);
    expect(b.bodyMultiplier()).toBe(Number(B.phases[2].bodyDamageMultiplier));
    const e = run(b, B.enrage.after, () => host(6, 0), 0.2, 0.5);
    expect(of(e, 'enrage').length).toBe(1);
    expect(b.quicksand).toBe(1);
  });

  it('dies and stops', () => {
    const b = fresh();
    run(b, 0.2, () => host(10, 0));
    b.kill();
    expect(run(b, 5, () => host(10, 0))).toEqual([]);
    expect(b.quicksand).toBe(0);
  });
});
