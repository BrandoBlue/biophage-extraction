import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AI, BOSSES } from '../data';
import type { HostView } from '../src/ai';
import { RegentBrain, type RegentEvent, type RegentPoolView } from '../src/ai/regent';
import { RaidRegent, type RegentFrame, type RegentPool } from '../src/game/regent';

const B = BOSSES.mireRegent;
const atk = (p: string, a: string) => (B.phases.find((x) => x.id === p)!.attacks as Record<string, Record<string, unknown>>)[a];
const pool: RegentPoolView = { x: 0, z: 0, radius: 27, waterY: 0 };
/** Wading: feet under the water. On an island: well above it. */
const host = (x: number, z: number, o: Partial<HostView> = {}): HostView => ({ x, y: -0.4, z, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o });
const island = (x: number, z: number, o: Partial<HostView> = {}) => host(x, z, { y: 1.5, ...o });
const of = <T extends RegentEvent['type']>(ev: RegentEvent[], type: T) => ev.filter((e): e is Extract<RegentEvent, { type: T }> => e.type === type);

function run(b: RegentBrain, seconds: number, at: (t: number) => HostView, fraction = 1, each?: () => void, dt = 1 / 30): RegentEvent[] {
  const out: RegentEvent[] = [];
  for (let t = 0; t < seconds; t += dt) {
    b.step(dt, { host: at(t), fraction, pool });
    out.push(...b.events.splice(0));
    each?.();
  }
  return out;
}

describe('The Mire Regent', () => {
  it('sleeps until a host wades into the pool near it; standing on an island does not wake it', () => {
    const b = new RegentBrain(0, 0);
    expect(run(b, 2, () => island(10, 0))).toEqual([]);
    expect(run(b, 2, () => host(60, 0))).toEqual([]);
    expect(of(run(b, 0.2, () => host(10, 0)), 'wake').length).toBe(1);
  });

  it('stalks a wading host from behind, where it is not looking', () => {
    const b = new RegentBrain(0, -15);
    // The host looks north (+z): the Regent should end up south of it, behind.
    run(b, 12, () => host(0, 5, { forward: { x: 0, z: 1 } }), 1);
    expect(b.pos.z).toBeLessThan(5);
  });

  it('every grab is told first: an arm reaches where the host stands, then closes there', () => {
    const b = new RegentBrain(0, 0);
    const du = atk('lurk', 'dragUnder') as { windup: number; damage: number; pin: number };
    const ev = run(b, 15, () => host(6, 0));
    const reach = of(ev, 'reach')[0], grab = of(ev, 'grab')[0];
    expect(reach.warning).toBe(du.windup);
    expect(grab).toMatchObject({ at: reach.at, arm: reach.arm, damage: du.damage, pin: du.pin });
  });

  it('a host up on an island is out of its reach: it waits beside it and calls the brood instead', () => {
    const b = new RegentBrain(0, 0);
    run(b, 0.2, () => host(8, 0));
    const ev = run(b, 20, () => island(8, 0));
    expect(of(ev, 'grab').length + of(ev, 'ripple').length).toBe(0);
    expect(of(ev, 'brood')[0]).toMatchObject({ spawnType: 'mirebrood', count: 8 });
    expect(b.action === 'wait' || b.action === 'callBrood').toBe(true);
  });

  it('rising, it rears out of the pool on a rhythm and saves the tongue for hosts on high ground', () => {
    const b = new RegentBrain(0, 0);
    run(b, 0.2, () => host(8, 0));
    let reared = 0;
    const ev = run(b, 20, () => island(14, 0), 0.5, () => { if (b.rise > 0.6) reared++; });
    expect(of(ev, 'rear').length).toBeGreaterThan(0);
    expect(reared).toBeGreaterThan(30);
    const gape = of(ev, 'gape')[0], tongue = of(ev, 'tongue')[0];
    expect(gape.warning).toBe(Number(atk('rise', 'tongue').windup));
    expect(tongue).toMatchObject({ damage: Number(atk('rise', 'tongue').damage), pull: true });
  });

  it('shot in the eye it dives and comes up on the far side of the pool', () => {
    const b = new RegentBrain(5, 0);
    run(b, 0.2, () => host(10, 0));
    b.dive();
    expect(b.eyesUp).toBe(false);
    const ev = run(b, AI.regent.diveFor + 0.2, () => host(10, 0));
    expect(of(ev, 'surface').length).toBe(1);
    expect(b.pos.x).toBeLessThan(0);
  });

  it('drowning, the pool spills', () => {
    const b = new RegentBrain(0, 0);
    run(b, 0.2, () => host(8, 0));
    const fl = atk('drown', 'flood') as { waterRises: number; overSeconds: number };
    const ev = run(b, 30, () => island(8, 0, { y: 3 }), 0.2);
    expect(of(ev, 'flood')[0]).toMatchObject({ rises: fl.waterRises, over: fl.overSeconds });
    expect(b.flood).toBeGreaterThan(0.5);
    expect(b.flood).toBeLessThanOrEqual(fl.waterRises);
  });
});

// ------------------------------------------------------------------ in a raid

const regentPool = (): RegentPool => ({ x: 0, z: 0, radius: 27, floorY: -3, waterY: 0, entrances: [], arches: [] });

function frames(g: RaidRegent, seconds: number, at: (t: number) => HostView, step = 1 / 30): RegentFrame {
  const all: RegentFrame = { strikes: [], events: [], brood: [], clouds: [], drain: 0 };
  for (let t = 0; t < seconds; t += step) {
    const f = g.update(step, at(t));
    all.strikes.push(...f.strikes); all.events.push(...f.events); all.brood.push(...f.brood); all.clouds.push(...f.clouds);
    all.drain += f.drain;
  }
  return all;
}

describe('The Mire Regent in a raid', () => {
  it('lurking, only its eyes can be shot; reared, its pearls take weak-point damage', () => {
    const g = new RaidRegent(regentPool());
    frames(g, 1, () => host(10, 0));
    const from = new THREE.Vector3(g.position.x - 30, -1.5, g.position.z), to = from.clone().add(new THREE.Vector3(60, 0, 0));
    expect(g.hit(from, to)).toBeNull();
    const eye = g.body.hitSpheres.find((h) => h.tag === 'eye')!;
    expect(g.exposed(eye)).toBe(true);
    const pearl = g.body.hitSpheres.find((h) => h.tag === 'pearl')!;
    expect(g.exposed(pearl)).toBe(false);
    // The rise phase: it rears on a rhythm.
    g.biomass = B.biomass * 0.5;
    let reared = false;
    for (let t = 0; t < 15 && !reared; t += 1 / 30) { g.update(1 / 30, island(16, 0)); reared = g.body.risen > 0.5; }
    expect(reared).toBe(true);
    expect(g.exposed(pearl)).toBe(true);
    const wp = B.weakPoints.pearls as { multiplier: number };
    expect(g.damage(100, pearl).dealt).toBe(100 * wp.multiplier);
  });

  it('an eye hit counts double and sends it under', () => {
    const g = new RaidRegent(regentPool());
    frames(g, 0.5, () => host(10, 0));
    const eye = g.body.hitSpheres.find((h) => h.tag === 'eye')!;
    const r = g.damage(50, eye);
    expect(r.weak).toBe(true);
    expect(r.dealt).toBe(50 * (B.weakPoints.eyes as { multiplier: number }).multiplier);
    expect(g.brain.diving).toBe(true);
    expect(g.exposed(eye)).toBe(false);
  });

  it('a grabbed host is held under until the arm is shot off', () => {
    const g = new RaidRegent(regentPool());
    let grabbed = false;
    for (let t = 0; t < 15 && !grabbed; t += 1 / 30) grabbed = g.update(1 / 30, host(6, 0)).strikes.some((s) => s.source === 'dragged under');
    expect(grabbed).toBe(true);
    expect(g.pinned).toBeGreaterThan(0);
    const f = frames(g, 0.5, () => host(6, 0));
    expect(f.strikes.some((s) => s.source === 'held under')).toBe(true);
    const arm = g.body.hitSpheres.find((h) => h.tag === 'arm' && h.index === (g as unknown as { pinArm: number }).pinArm)!;
    const r = g.damage(Number(atk('lurk', 'dragUnder').freedByDamage), arm);
    expect(r.freed).toBe(true);
    expect(g.pinned).toBe(0);
  });

  it('the tongue pulls a host off high ground toward the mouth', () => {
    const g = new RaidRegent(regentPool());
    frames(g, 0.2, () => host(8, 0));
    g.biomass = B.biomass * 0.5;
    const f = frames(g, 20, () => island(14, 0));
    const lick = f.strikes.find((s) => s.source === 'tongue');
    expect(lick).toBeTruthy();
    // Knocked from a point past the host: toward the Regent.
    expect(lick!.from!.x).toBeGreaterThan(14);
  });

  it('dies, rolls over and stops', () => {
    const g = new RaidRegent(regentPool());
    frames(g, 0.2, () => host(10, 0));
    expect(g.damage(1e6, null).killed).toBe(true);
    const f = frames(g, 3, () => host(10, 0));
    expect(f.strikes.length + f.events.length).toBe(0);
  });
});
