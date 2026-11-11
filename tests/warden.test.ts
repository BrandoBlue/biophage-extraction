import { describe, expect, it } from 'vitest';
import { AI, BOSSES } from '../data';
import type { HostView } from '../src/ai';
import { WardenBrain, type WardenEvent, type WardenInput, type WardenRoom } from '../src/ai/warden';

const B = BOSSES.warden;
const atk = (p: string, a: string) => (B.phases.find((x) => x.id === p)!.attacks as Record<string, Record<string, number>>)[a];
const room: WardenRoom = { x0: -100, x1: -62, z0: -20, z1: 20, floorY: 0, height: 14 };
const host = (x: number, z: number, o: Partial<HostView> = {}): HostView => ({ x, y: 0, z, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o });

function run(b: WardenBrain, seconds: number, at: (t: number) => HostView, fraction = 1, dt = 1 / 30): WardenEvent[] {
  const out: WardenEvent[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const i: WardenInput = { host: at(t), fraction, room };
    b.step(dt, i);
    out.push(...b.events.splice(0));
  }
  return out;
}
const of = <T extends WardenEvent['type']>(ev: WardenEvent[], type: T) => ev.filter((e): e is Extract<WardenEvent, { type: T }> => e.type === type);
const fresh = () => new WardenBrain(-81, 14, 0);

describe('The Warden of the Long Seed', () => {
  it('lies dormant until a host enters the reactor chamber (until ship power exists)', () => {
    const b = fresh();
    expect(run(b, 2, () => host(-40, 0))).toEqual([]);
    expect(b.awake).toBe(false);
    expect(of(run(b, 0.1, () => host(-70, 0)), 'wake').length).toBe(1);
    expect(AI.warden.wake.trigger).toBe('approach');
  });

  it('in tend it clings to the walls and ceiling and keeps re-perching', () => {
    const b = fresh();
    const seen = new Set<string>(), spots: string[] = [];
    run(b, 40, (t) => {
      if (b.awake) { seen.add(b.surface); spots.push(`${Math.round(b.head.x)},${Math.round(b.head.y)},${Math.round(b.head.z)}`); }
      return host(-81 + Math.sin(t * 0.3) * 8, Math.cos(t * 0.2) * 8);
    });
    expect(seen.has('floor')).toBe(false);
    expect(seen.size).toBeGreaterThan(0);
    expect(new Set(spots).size).toBeGreaterThan(20);
  });

  it('the root spear lands where the host was heading: standing still is hit, sidestepping dodges it', () => {
    const b = fresh();
    const ev = run(b, 12, () => host(-81, 3));
    const spear = of(ev, 'spear')[0];
    expect(spear.damage).toBe(atk('tend', 'rootSpear').damage);
    expect(Math.hypot(spear.at.x + 81, spear.at.z - 3)).toBeLessThan(AI.warden.spearRadius);
    // A host who keeps moving sideways is somewhere else by the time it lands.
    const c = fresh();
    let hx = -81;
    const dodge = run(c, 12, (t) => { hx = -81 + Math.sin(t * 2.2) * 6; return host(hx, 3, { vx: Math.cos(t * 2.2) * 13 }); });
    const missed = of(dodge, 'spear').filter((s) => Math.abs(s.at.x - hx) > AI.warden.spearRadius);
    expect(missed.length).toBeGreaterThan(0);
  });

  it('births an Oculimoth swarm from its pods', () => {
    const b = fresh();
    const s = atk('tend', 'embryoSwarm') as unknown as { spawn: { type: string; count: number } };
    const sw = of(run(b, AI.warden.swarmFirstDelay + AI.warden.birthTell + 3, () => host(-81, 3)), 'swarm');
    expect(sw[0]).toMatchObject({ spawnType: s.spawn.type, count: s.spawn.count });
  });

  it('plates soak body fire in tend; venting a valve opens its seam for a while; from overheat seams stay open', () => {
    const b = fresh();
    expect(b.bodyMultiplier()).toBe(B.phases[0].plateMultiplier);
    expect(b.seamExposed(2)).toBe(false);
    b.vent(2);
    expect(b.seamExposed(2)).toBe(true);
    expect(b.seamExposed(1)).toBe(false);
    run(b, AI.warden.seamOpenTime + 0.5, () => host(-81, 3));
    expect(b.seamExposed(2)).toBe(false);
    run(b, 0.5, () => host(-81, 3), 0.5);
    expect(b.phase.id).toBe('overheat');
    expect(b.seamExposed(0)).toBe(true);
    expect(b.bodyMultiplier()).toBe(1);
  });

  it('overheating, it comes down to the floor, vents steam and brings the catwalks down', () => {
    const b = fresh();
    run(b, 0.2, () => host(-81, 3));
    const ev = run(b, 30, () => host(-81, 3), 0.5);
    expect(b.surface).toBe('floor');
    expect(of(ev, 'steam')[0]).toMatchObject({ radius: atk('overheat', 'steamBurst').radius, damage: atk('overheat', 'steamBurst').damage });
    expect(of(ev, 'catwalk').length).toBeGreaterThan(0);
    expect(of(ev, 'spear').some((s) => s.damage === atk('overheat', 'rootSpear').damage)).toBe(true);
  });

  it('in meltdown the reactor charges for its full wind-up, then pulses', () => {
    const b = fresh();
    run(b, 0.2, () => host(-81, 3));
    const p = atk('meltdown', 'reactorPulse');
    let charged = 0;
    const ev: WardenEvent[] = [];
    for (let t = 0; t < p.windup + 1; t += 1 / 30) {
      ev.push(...run(b, 1 / 30, () => host(-81, 3), 0.2));
      if (b.action === 'reactorPulse') charged = Math.max(charged, b.windup);
      if (of(ev, 'pulse').length) break;
    }
    expect(charged).toBeGreaterThan(0.9);
    expect(of(ev, 'pulse')[0]).toMatchObject({ radius: p.radius, damage: p.damage });
  });

  it('enraged, the reactor pulses every few seconds whatever the phase', () => {
    const b = fresh();
    run(b, 0.2, () => host(-81, 3));
    const ev = run(b, B.enrage.after + 3 * AI.warden.enragePulseEvery + 5, () => host(-81, 3), 0.9, 0.25);
    expect(of(ev, 'enrage').length).toBe(1);
    expect(of(ev, 'pulse').length).toBeGreaterThanOrEqual(3);
  });

  it('dies and stops', () => {
    const b = fresh();
    run(b, 0.2, () => host(-81, 3));
    b.kill();
    expect(run(b, 5, () => host(-81, 3))).toEqual([]);
  });
});
