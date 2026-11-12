import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AI, BOSSES } from '../data';
import type { HostView } from '../src/ai';
import { NethermawBrain, type NethermawEvent, type NethermawPit } from '../src/ai/nethermaw';
import { RaidNethermaw, type NethermawFrame } from '../src/game/nethermaw';
import type { ArenaInfo, Walkway } from '../src/world/structures';

const B = BOSSES.nethermaw;
const atk = (p: string, a: string) => (B.phases.find((x) => x.id === p)!.attacks as Record<string, Record<string, unknown>>)[a];
const pit: NethermawPit = { x: 0, z: 0, floorY: -215, mawRadius: 7, radius: 25 };
const host = (x: number, z: number, o: Partial<HostView> = {}): HostView => ({ x, y: -215, z, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o });
const of = <T extends NethermawEvent['type']>(ev: NethermawEvent[], type: T) => ev.filter((e): e is Extract<NethermawEvent, { type: T }> => e.type === type);

function run(b: NethermawBrain, seconds: number, at: (t: number) => HostView, fraction = 1, broken = 0, each?: () => void, dt = 1 / 30): NethermawEvent[] {
  const out: NethermawEvent[] = [];
  for (let t = 0; t < seconds; t += dt) {
    b.step(dt, { host: at(t), fraction, pit, columnsBroken: broken });
    out.push(...b.events.splice(0));
    each?.();
  }
  return out;
}

describe('The Nethermaw', () => {
  it('sleeps until a host comes down into the deep layer near it', () => {
    const b = new NethermawBrain(0, 0);
    expect(run(b, 2, () => host(20, 0, { y: -100 }))).toEqual([]);
    expect(run(b, 2, () => host(100, 0))).toEqual([]);
    expect(of(run(b, 0.2, () => host(20, 0)), 'wake').length).toBe(1);
  });

  it('the lobe facing the host swells (the tell) before its spore pulse, and is shootable while it does', () => {
    const b = new NethermawBrain(0, 0);
    const sp = atk('breathe', 'sporePulse') as { damage: number; overload: number; radius: number; windup: number };
    let exposedDuring = false;
    const ev = run(b, 10, () => host(0, 20), 1, 0, () => { if (b.action === 'sporePulse' && b.swell.some((_, i) => b.lobeExposed(i))) exposedDuring = true; });
    const swell = of(ev, 'swell')[0], pulse = of(ev, 'pulse')[0];
    expect(swell).toMatchObject({ warning: sp.windup });
    expect(pulse).toMatchObject({ lobe: swell.lobe, damage: sp.damage, overload: sp.overload, radius: sp.radius });
    expect(exposedDuring).toBe(true);
    // It is the lobe on the host's side.
    const off = Math.abs(Math.atan2(Math.sin(b.bearings[swell.lobe] - Math.PI / 2), Math.cos(b.bearings[swell.lobe] - Math.PI / 2)));
    expect(off).toBeLessThanOrEqual(Math.PI / 5 + 1e-6);
  });

  it('each broken root column takes 20% off its pulses', () => {
    const b = new NethermawBrain(0, 0);
    const sp = atk('breathe', 'sporePulse') as { damage: number };
    const pulse = of(run(b, 10, () => host(0, 20), 1, 2), 'pulse')[0];
    expect(pulse.damage).toBeCloseTo(sp.damage * (1 - 2 * AI.nethermaw.columnPulseCut));
  });

  it('a swelling lobe shot hard enough flinches and the pulse is lost', () => {
    const b = new NethermawBrain(0, 0);
    let flinched = false;
    const ev = run(b, 10, () => host(0, 20), 1, 0, () => {
      if (!flinched && b.action === 'sporePulse') {
        const lobe = b.swell.findIndex((_, i) => b.lobeExposed(i));
        if (lobe >= 0) { b.hurt(AI.nethermaw.flinchDamage, lobe); flinched = true; }
      }
    }).filter((e) => e.type === 'flinch' || e.type === 'pulse');
    expect(ev[0]?.type).toBe('flinch');
  });

  it('breathing, the updraft pulls only on the inhale; swallowing, it never lets go and the mouth burns', () => {
    const b = new NethermawBrain(0, 0);
    let pulling = 0, still = 0;
    run(b, AI.nethermaw.breathCycle * 2, () => host(0, 20), 1, 0, () => { if (b.pull.speed > 0) pulling++; else still++; });
    expect(pulling).toBeGreaterThan(30);
    expect(still).toBeGreaterThan(30);
    const inh = atk('swallow', 'inhale') as { pullSpeed: number; radius: number; damagePerSecondInMouth: number };
    let min = Infinity;
    run(b, AI.nethermaw.breathCycle, () => host(0, 20), 0.2, 0, () => { min = Math.min(min, b.pull.speed); });
    expect(min).toBe(inh.pullSpeed);
    expect(b.mouthDps).toBe(inh.damagePerSecondInMouth);
  });

  it('dreaming, it raises false extract lights that spring on a host who walks into one', () => {
    const b = new NethermawBrain(0, 0);
    run(b, 0.5, () => host(0, 20));
    const ev = run(b, 0.5, () => host(0, 20), 0.5);
    const lights = of(ev, 'falseLight')[0];
    expect(lights.at.length).toBe(Number(atk('dream', 'falseLight').fakeExtractGlows));
    const l = lights.at[0];
    const trap = of(run(b, 0.3, () => host(l.x, l.z), 0.5), 'trap');
    expect(trap.length).toBe(1);
    expect(b.lights.length).toBe(lights.at.length - 1);
  });

  it('wall roots rumble where the host stands first, then burst there', () => {
    const b = new NethermawBrain(0, 0);
    run(b, 0.5, () => host(0, 20));
    const wr = atk('dream', 'wallRoots') as { damage: number; windup: number };
    const ev = run(b, 12, () => host(0, 20, { y: -200 }), 0.5);
    const rumble = of(ev, 'rumble')[0], roots = of(ev, 'roots')[0];
    expect(rumble).toMatchObject({ at: { x: 0, z: 20 }, y: -200, warning: wr.windup });
    expect(roots).toMatchObject({ at: rumble.at, damage: wr.damage });
  });
});

// ------------------------------------------------------------------ in a raid

function arena(): { a: ArenaInfo; broken: string[] } {
  const broken: string[] = [];
  const pillars = [0, 1, 2, 3].map((i) => {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4, id = `root-column-${i}`;
    return { id, x: Math.cos(ang) * 17, z: Math.sin(ang) * 17, radius: 1.2, get broken() { return broken.includes(id); }, destroy() { broken.push(id); } };
  });
  const a: ArenaInfo = {
    id: 'undermouth', x: 0, z: 0, radius: 25, floorY: -215, entrances: [], pillars, pool: { x: 0, z: 0, radius: 7 }, bossSpawn: { x: 0, z: 0 },
    ledge: { y: -205, innerR: 20, outerR: 26, halfArc: 0.2, yaw: 0 }, onLedge: () => false,
  };
  return { a, broken };
}
const walkways = (): Walkway[] => [3, 1, 2].map((y, i) => {
  let cut = false;
  return { id: `w${i}`, x: 0, y: -215 + y * 10, z: 0, halfLength: 1, halfWidth: 1, yaw: 0, get isCut() { return cut; }, cut() { cut = true; } };
});

function frames(m: RaidNethermaw, seconds: number, at: (t: number) => HostView, step = 1 / 30): NethermawFrame {
  const all: NethermawFrame = { strikes: [], events: [], brood: [], overload: 0, pull: { x: 0, z: 0 }, cut: [] };
  for (let t = 0; t < seconds; t += step) {
    const f = m.update(step, at(t));
    all.strikes.push(...f.strikes); all.events.push(...f.events); all.brood.push(...f.brood); all.cut.push(...f.cut);
    all.overload += f.overload;
    if (Math.hypot(f.pull.x, f.pull.z) > Math.hypot(all.pull.x, all.pull.z)) all.pull = f.pull;
  }
  return all;
}

describe('The Nethermaw in a raid', () => {
  it('lobes take weak-point damage only while they swell', () => {
    const { a } = arena();
    const m = new RaidNethermaw(a, []);
    const lobe = m.body.hitSpheres.find((h) => h.tag === 'lobe')!;
    expect(m.exposed(lobe)).toBe(false);
    expect(m.damage(100, lobe).weak).toBe(false);
    frames(m, 0.2, () => host(0, 20));
    m.brain.swell[lobe.index] = 1;
    const wp = B.weakPoints.lobes as { multiplier: number };
    const r = m.damage(100, lobe);
    expect(r.weak).toBe(true);
    expect(r.dealt).toBe(100 * wp.multiplier);
  });

  it('a pulse hurts and overloads hosts in reach, pulls toward the mouth on the inhale', () => {
    const { a } = arena();
    const m = new RaidNethermaw(a, []);
    const f = frames(m, 12, () => host(0, 20));
    const sp = atk('breathe', 'sporePulse') as { damage: number; overload: number };
    expect(f.strikes.find((s) => s.source === 'spore pulse')?.damage).toBe(sp.damage);
    expect(f.overload).toBeGreaterThanOrEqual(sp.overload);
    // Pulled toward the mouth: the host is at +z, so the pull points to -z.
    expect(f.pull.z).toBeLessThan(0);
  });

  it('shooting a root column down breaks World\'s column and weakens the pulses', () => {
    const { a, broken } = arena();
    const m = new RaidNethermaw(a, []);
    const col = { tag: 'column' as const, index: 1, world: new THREE.Vector3(), r: 1 };
    const each = (B.weakPoints.rootColumns as { biomassEach: number }).biomassEach;
    const r = m.damage(each, col);
    expect(r.popped).toBe('root-column-1');
    expect(broken).toEqual(['root-column-1']);
    expect(m.columnsBroken).toBe(1);
    expect(m.damage(50, col).dealt).toBe(0);
  });

  it('swallowing, it tears the walkways loose from the lowest up', () => {
    const { a } = arena();
    const w = walkways();
    const m = new RaidNethermaw(a, w);
    frames(m, 0.2, () => host(0, 30));
    m.biomass = B.biomass * 0.2;
    const every = Number(atk('swallow', 'collapseWalkways').every);
    const f = frames(m, every + 0.5, () => host(0, 30, { y: -190 }));
    expect(f.cut.slice(0, 2)).toEqual(['w1', 'w2']);
  });

  it('dies, and nothing more comes from it', () => {
    const { a } = arena();
    const m = new RaidNethermaw(a, []);
    frames(m, 0.2, () => host(0, 20));
    expect(m.damage(1e6, null).killed).toBe(true);
    expect(m.alive).toBe(false);
    const f = frames(m, 5, () => host(0, 20));
    expect(f.strikes.length + f.events.length).toBe(0);
  });
});
