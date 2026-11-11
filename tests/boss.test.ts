import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BOSSES } from '../data';
import type { HostView } from '../src/ai';
import { RaidBoss, type BossFrame } from '../src/game/boss';
import type { ArenaInfo } from '../src/world/structures';

const R = BOSSES.reliquary;
const phase = (id: string) => R.phases.find((p) => p.id === id)!;
const atk = (p: string, a: string) => (phase(p).attacks as Record<string, Record<string, number>>)[a];

function arena(): ArenaInfo {
  const pillars = [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const p = { id: `p${i}`, x: Math.cos(a) * 9, z: Math.sin(a) * 9, radius: 1.2, broken: false, destroy() { p.broken = true; } };
    return p;
  });
  return {
    id: 'reliquaryBowl', x: 0, z: 0, radius: 30, floorY: 0, entrances: [{ x: -31, z: 0 }, { x: 31, z: 0 }], pillars,
    pool: { x: 0, z: 0, radius: 5.4 }, bossSpawn: { x: 0, z: 10 },
    ledge: { y: 3, innerR: 20, outerR: 23, halfArc: Math.PI / 2, yaw: 0 },
    onLedge: (x, z) => { const r = Math.hypot(x, z); return r >= 20 && r <= 23 && z < 0; },
  };
}

const host = (x: number, z: number, y = 0): HostView => ({ x, y, z, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: null });

/** Runs the boss for `seconds` against a host that `at(t)` places; returns every frame's output merged. */
function run(b: RaidBoss, seconds: number, at: (t: number) => HostView, feet = 0, dt = 1 / 30): BossFrame {
  const all: BossFrame = { strikes: [], brood: [], vents: [], hymns: [], broken: [], events: [] };
  for (let t = 0; t < seconds; t += dt) {
    const f = b.update(dt, at(t), feet);
    for (const k of Object.keys(all) as (keyof BossFrame)[]) (all[k] as unknown[]).push(...(f[k] as unknown[]));
  }
  return all;
}

/** Puts the boss into a phase by draining Biomass directly (no damage side effects). */
function toPhase(b: RaidBoss, id: string): void {
  const p = phase(id);
  b.biomass = b.t.biomass * (p.from - 0.01);
}

describe('The Reliquary in a raid', () => {
  it('sleeps until a host comes into the bowl, then wakes and stands inside it', () => {
    const b = new RaidBoss(arena());
    expect(run(b, 2, () => host(0, -R.wakeRadius - 20)).events).toEqual([]);
    expect(b.awake).toBe(false);
    const f = run(b, 0.2, () => host(0, -5));
    expect(f.events[0]).toMatchObject({ type: 'wake', songRadius: R.songRadius });
    // Chasing a host out on the rim never carries it through the walls.
    run(b, 30, () => host(0, -40));
    expect(Math.hypot(b.position.x, b.position.z)).toBeLessThan(30 * 0.8);
  });

  it('the bone shell soaks frontal fire in stalk; flanks take full damage', () => {
    const b = new RaidBoss(arena());
    const yaw = b.brain.body.yaw, c = b.position;
    const front = { x: c.x + Math.sin(yaw) * 10, z: c.z + Math.cos(yaw) * 10 };
    const back = { x: c.x - Math.sin(yaw) * 10, z: c.z - Math.cos(yaw) * 10 };
    expect(b.damage(100, null, front.x, front.z).dealt).toBeCloseTo(100 * Number(phase('stalk').frontArmourMultiplier));
    expect(b.damage(100, null, back.x, back.z).dealt).toBe(100);
    expect(b.awake).toBe(true); // wounds wake it
  });

  it('hearts only take weak-point damage when the cage is open; a burst heart pops on the body', () => {
    const b = new RaidBoss(arena());
    const heart = b.body.hitSpheres.find((s) => s.tag === 'heart')!;
    expect(b.exposed(heart)).toBe(false);
    toPhase(b, 'collapse');
    run(b, 0.1, () => host(0, -5));
    expect(b.exposed(heart)).toBe(true);
    const hp = R.weakPoints.hearts as { biomassEach: number; multiplier: number };
    const r = b.damage(hp.biomassEach / hp.multiplier + 1, heart, 0, -5);
    expect(r.weak).toBe(true);
    expect(r.popped).toBe('heart0');
    expect(b.body.weakPoints[0].alive).toBe(false);
    expect(b.exposed(heart)).toBe(false);
  });

  it('shots find an exposed weak point near the surface, and the body otherwise', () => {
    const b = new RaidBoss(arena());
    b.body.refresh();
    const sac = b.body.hitSpheres.find((s) => s.tag === 'broodSac')!;
    const from = sac.world.clone().add(new THREE.Vector3(0, -0.5, 25));
    const hit = b.hit(from, sac.world.clone().add(new THREE.Vector3(0, -0.5, -25)));
    expect(hit?.sphere.tag).toBe('broodSac');
    const c = b.centre(new THREE.Vector3());
    const top = b.hit(c.clone().add(new THREE.Vector3(0, 30, 0)), c.clone());
    expect(top && ['shell', 'body'].includes(top.sphere.tag)).toBe(true);
    expect(b.hit(new THREE.Vector3(100, 50, 100), new THREE.Vector3(110, 50, 100))).toBeNull();
  });

  it('drops a brood from the sac; bursting the sac stops the drops', () => {
    const b = new RaidBoss(arena());
    const first = atk('stalk', 'broodDrop').firstDelay + atk('stalk', 'broodDrop').windup + 0.5;
    const f = run(b, first, () => host(0, -2));
    expect(f.brood.length).toBe((phase('stalk').attacks as { broodDrop: { spawn: { count: number } } }).broodDrop.spawn.count);
    const sac = b.body.hitSpheres.find((s) => s.tag === 'broodSac')!;
    const r = b.damage(b.sac, sac, 0, 0);
    expect(r).toMatchObject({ weak: true, popped: 'broodSac' });
    b.biomass = b.t.biomass; // keep it in stalk
    expect(b.sac).toBe(0);
    expect(run(b, atk('stalk', 'broodDrop').cooldown + 2, () => host(0, -2)).brood).toEqual([]);
  });

  it('legs can be severed from bloom on, and each one counts', () => {
    const b = new RaidBoss(arena());
    const leg = b.body.hitSpheres.find((s) => s.tag === 'leg' && s.index === 2)!;
    expect(b.exposed(leg)).toBe(false);
    toPhase(b, 'bloom');
    run(b, 0.1, () => host(0, -5));
    expect(b.exposed(leg)).toBe(true);
    expect(b.damage((R.weakPoints.legs as { biomassEach: number }).biomassEach, leg, 0, 0).popped).toBe('leg2');
    expect(b.legsIntact).toBe(5);
  });

  it('a leg stamp hits a host who stays on the marked spot, and misses one who steps off', () => {
    const stay = new RaidBoss(arena());
    const f = run(stay, 4, () => host(0, 3));
    expect(f.strikes.some((s) => s.source === 'stamp' && s.damage === atk('stalk', 'legStamp').damage)).toBe(true);
    const dodge = new RaidBoss(arena());
    // Wake it on the spot, then step well clear during the 0.9 s tell.
    const g = run(dodge, 4, (t) => (t < 0.3 ? host(0, 3) : host(12, 3)));
    expect(g.strikes.some((s) => s.source === 'stamp')).toBe(false);
  });

  it('the hymn ring hits a host on the floor, and a jump clears it', () => {
    const go = (feet: number) => {
      const b = new RaidBoss(arena());
      toPhase(b, 'bloom');
      return run(b, 6, () => host(0, -12), feet).strikes.filter((s) => s.source === 'hymn');
    };
    const grounded = go(0);
    expect(grounded.length).toBe(1);
    expect(grounded[0].damage).toBe((atk('bloom', 'hymn') as unknown as { ring: { damage: number } }).ring.damage);
    expect(go(1.2).length).toBe(0);
  });

  it('breaks the cover a host hides behind', () => {
    const b = new RaidBoss(arena());
    toPhase(b, 'bloom');
    const f = run(b, 25, () => host(0, -2));
    expect(f.broken.length).toBeGreaterThan(0);
    for (const id of f.broken) expect(b.arena.pillars.find((p) => p.id === id)!.broken).toBe(true);
  });

  it('the tendril grab pins the host until it times out or the boss takes enough damage', () => {
    const b = new RaidBoss(arena());
    toPhase(b, 'collapse');
    const f = run(b, 8, () => host(0, 10 - 8));
    const grab = f.strikes.find((s) => s.source === 'grab');
    expect(grab?.pin).toBe(atk('collapse', 'tendrilGrab').pin);
    b.pinned = 2;
    (b as unknown as { pinBreak: number }).pinBreak = atk('collapse', 'tendrilGrab').freedByDamage;
    b.damage(atk('collapse', 'tendrilGrab').freedByDamage, null, 0, 0);
    expect(b.pinned).toBe(0);
  });

  it('the collapse flood burns the bowl floor but spares the ledge', () => {
    const b = new RaidBoss(arena());
    toPhase(b, 'collapse');
    const over = atk('collapse', 'lightFlood').overSeconds;
    run(b, over, () => host(0, -21, 3), 3);
    expect(b.poolRadius).toBeCloseTo(30 * atk('collapse', 'lightFlood').poolGrowsTo, 0);
    const floor = run(b, 1, () => host(0, -6)).strikes.filter((s) => s.source === 'light pool');
    expect(floor.reduce((a, s) => a + s.damage, 0)).toBeCloseTo(atk('collapse', 'lightFlood').damagePerSecond, 0);
    expect(run(b, 1, () => host(0, -21, 3), 3).strikes.filter((s) => s.source === 'light pool')).toEqual([]);
  });

  it('dies at zero Biomass and stops acting', () => {
    const b = new RaidBoss(arena());
    expect(b.damage(1e6, null, 0, -10).killed).toBe(true);
    expect(b.alive).toBe(false);
    expect(b.damage(10, null, 0, 0).dealt).toBe(0);
    expect(run(b, 5, () => host(0, -3))).toMatchObject({ strikes: [], brood: [], events: [] });
  });
});
