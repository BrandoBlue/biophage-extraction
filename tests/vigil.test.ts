import { describe, expect, it } from 'vitest';
import { BOSSES } from '../data';
import type { HostView } from '../src/ai';
import { PaleVigilBrain, type VigilEvent, type VigilInput } from '../src/ai/vigil';

const V = BOSSES.paleVigil;
const phase = (id: string) => V.phases.find((p) => p.id === id)!;
const atk = (p: string, a: string) => (phase(p).attacks as Record<string, Record<string, number>>)[a];
const arena = { x: 0, z: 0, radius: 17 };

const host = (x: number, z: number, o: Partial<HostView> = {}): HostView => ({ x, y: 0, z, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o });

interface Opts { fraction?: number; lureAlive?: boolean; limbsIntact?: number; dt?: number }
/** Runs the Vigil for `seconds` against a host that `at(t)` places; returns every event. */
function run(b: PaleVigilBrain, seconds: number, at: (t: number) => HostView, o: Opts = {}): VigilEvent[] {
  const out: VigilEvent[] = [], dt = o.dt ?? 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    const i: VigilInput = { host: at(t), fraction: o.fraction ?? 1, lureAlive: o.lureAlive ?? true, limbsIntact: o.limbsIntact ?? 4, arena };
    b.step(dt, i);
    out.push(...b.events.splice(0));
  }
  return out;
}
const of = <T extends VigilEvent['type']>(ev: VigilEvent[], type: T) => ev.filter((e): e is Extract<VigilEvent, { type: T }> => e.type === type);

describe('The Pale Vigil', () => {
  it('hangs silent until a host comes near; it has no song', () => {
    const b = new PaleVigilBrain(0, 0);
    expect(run(b, 2, () => host(0, V.wakeRadius + 4))).toEqual([]);
    expect(b.awake).toBe(false);
    expect(of(run(b, 0.1, () => host(0, V.wakeRadius - 1)), 'wake').length).toBe(1);
    expect(V.songRadius).toBe(0);
    expect(b.hang).toBeGreaterThan(0.9);
  });

  it('the lure goes dead still, then it drops on whoever stands under it', () => {
    const b = new PaleVigilBrain(0, 0);
    const d = atk('hang', 'drop');
    let still = false;
    const ev: VigilEvent[] = [];
    for (let t = 0; t < 2; t += 1 / 30) {
      ev.push(...run(b, 1 / 30, () => host(0.5, 0.5)));
      if (b.action === 'drop' && b.actionTime < d.windup) still ||= b.lureStill === 1;
    }
    expect(still).toBe(true);
    const drop = of(ev, 'drop')[0];
    expect(drop).toMatchObject({ damage: d.damage, radius: d.radius });
    expect(Math.hypot(drop.at.x - 0.5, drop.at.z - 0.5)).toBeLessThan(d.radius);
    expect(b.hang).toBeLessThan(0.5); // down on the floor after the drop
  });

  it('crawls the ceiling to put its lure where a walking host is heading', () => {
    const b = new PaleVigilBrain(0, 0);
    run(b, 0.1, () => host(0, 8));
    // The host walks +x at 1.5 m/s; the Vigil should get ahead of it.
    run(b, 4, (t) => host(-6 + t * 1.5, 8, { vx: 1.5 }));
    expect(b.body.x).toBeGreaterThan(-6 + 4 * 1.5 - 1);
  });

  it('snatches a host that comes close and lifts it', () => {
    const b = new PaleVigilBrain(0, 0);
    const s = atk('hang', 'snatch');
    // Near but not under the lure, with the drop on cooldown so the snatch is chosen.
    const ev = run(b, 3, () => host(3.6, 0), { lureAlive: true });
    const grab = of(ev, 'grab').concat(of(run(b, 3, () => host(3.6, 0)), 'grab'))[0];
    expect(grab).toMatchObject({ damage: s.damage, pin: s.pin, lift: s.liftHeight, freedByDamage: s.freedByDamage });
  });

  it('losing the lure brings it down to stalk; the lure stops pulling', () => {
    const b = new PaleVigilBrain(0, 0);
    const i: VigilInput = { host: host(0, 6), fraction: 1, lureAlive: true, limbsIntact: 4, arena };
    run(b, 0.1, () => host(0, 6));
    expect(b.lurePull(i)).toBe(atk('hang', 'lureGlow').overloadPerSecond);
    const ev = run(b, 1, () => host(0, 6), { lureAlive: false });
    expect(of(ev, 'phase')[0]).toMatchObject({ id: 'stalk' });
    expect(b.lurePull({ ...i, lureAlive: false })).toBe(0);
    expect(b.limbsSeverable).toBe(true);
  });

  it('in stalk it works round behind the host, lunges only from the blind side, then vanishes and comes back behind', () => {
    const b = new PaleVigilBrain(0, 12);
    // Host faces +Z, toward the Vigil: it must circle round rather than lunge from the front.
    const ev = run(b, 10, () => host(0, 0), { fraction: 0.6 });
    const lunges = of(ev, 'lunge').filter((l) => l.how === 'ambush');
    expect(lunges.length).toBeGreaterThan(0);
    expect(lunges[0].damage).toBe(atk('stalk', 'ambushLunge').damage);
    expect(of(ev, 'vanish').length).toBeGreaterThan(0);
    const back = of(ev, 'reappear')[0];
    expect(back.at.z).toBeLessThan(0); // behind a host looking at +Z
  });

  it('never lunges at a host who keeps turning to face it', () => {
    const b = new PaleVigilBrain(0, 12);
    const ev = run(b, 8, () => {
      const dx = b.body.x, dz = b.body.z, d = Math.hypot(dx, dz) || 1;
      return host(0, 0, { forward: { x: dx / d, z: dz / d } });
    }, { fraction: 0.6 });
    expect(of(ev, 'lunge').length).toBe(0);
  });

  it('with every limb cut off it cannot climb away', () => {
    const b = new PaleVigilBrain(0, 3);
    const ev = run(b, 6, () => host(0, 0, { forward: { x: 0, z: 1 } }), { fraction: 0.6, limbsIntact: 0 });
    expect(of(ev, 'rake').length).toBeGreaterThan(0);
    expect(of(ev, 'vanish')).toEqual([]);
  });

  it('unravelling, it shrieks with its spines out, brings the ceiling down with a warning, and chains lunges', () => {
    const b = new PaleVigilBrain(0, 6);
    const c = atk('unravel', 'ceilingCollapse');
    let spines = false;
    const ev: VigilEvent[] = [];
    for (let t = 0; t < 10; t += 1 / 30) {
      ev.push(...run(b, 1 / 30, () => host(0, 0), { fraction: 0.2 }));
      spines ||= b.spinesExposed && b.hang < 0.5;
    }
    expect(spines).toBe(true);
    expect(of(ev, 'shriek')[0]).toMatchObject({ radius: atk('unravel', 'shriek').radius, stagger: atk('unravel', 'shriek').stagger });
    const warns = of(ev, 'collapseWarn'), chunks = of(ev, 'chunk');
    expect(warns.length).toBeGreaterThanOrEqual(c.count);
    expect(chunks.length).toBeGreaterThanOrEqual(c.count);
    expect(warns[0].warning).toBe(c.warning);
    expect(of(ev, 'lunge').filter((l) => l.how === 'frenzy').length).toBeGreaterThan(1);
    expect(b.bodyMultiplier()).toBe(phase('unravel').bodyDamageMultiplier);
  });

  it('enrages after its timer and keeps the ceiling falling', () => {
    const b = new PaleVigilBrain(0, 0);
    run(b, 0.1, () => host(0, 10));
    const ev = run(b, V.enrage.after + 13, () => host(30, 30, { alive: true }), { fraction: 0.9, dt: 0.25 });
    expect(of(ev, 'enrage').length).toBe(1);
    expect(of(ev, 'collapseWarn').length).toBeGreaterThanOrEqual(2 * atk('unravel', 'ceilingCollapse').count);
  });

  it('dies and stops', () => {
    const b = new PaleVigilBrain(0, 0);
    run(b, 0.1, () => host(0, 5));
    b.kill();
    expect(run(b, 3, () => host(0, 0))).toEqual([]);
  });
});
