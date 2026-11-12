import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BOSSES } from '../data';
import type { HostView } from '../src/ai';
import { RaidWidow, type WidowFrame } from '../src/game/widow';
import type { WidowArena } from '../src/world/structures';

const B = BOSSES.sandwidow;
const atk = (p: string, a: string) => (B.phases.find((x) => x.id === p)!.attacks as Record<string, Record<string, unknown>>)[a];
/** A flat crater floor at y 0 (the terrain) with one debris rock (a solid, top 3 m) at (20, 0). */
const ROCK = { id: 'rock', x: 20, z: 0, radius: 2, top: 3 };
const ground = () => 0;
const standing = (x: number, z: number) => (Math.hypot(x - ROCK.x, z - ROCK.z) <= ROCK.radius ? ROCK.top : 0);
const arena = (): WidowArena => ({ id: 'skyfallCrater', x: 0, z: 0, radius: 52, floorY: 0, pillars: [ROCK], entrances: [], bossSpawn: { x: 0, z: 0 } });
const host = (x: number, z: number, o: Partial<HostView> = {}): HostView => ({ x, y: standing(x, z), z, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o });

function run(w: RaidWidow, seconds: number, at: (t: number) => HostView, step = 1 / 30): WidowFrame {
  const all: WidowFrame = { strikes: [], events: [], brood: [], slow: 1, blind: 0 };
  for (let t = 0; t < seconds; t += step) {
    const f = w.update(step, at(t));
    all.strikes.push(...f.strikes); all.events.push(...f.events); all.brood.push(...f.brood);
    all.slow = Math.min(all.slow, f.slow); all.blind = Math.max(all.blind, f.blind);
  }
  return all;
}

describe('The Sandwidow in a raid', () => {
  it('nothing reaches her under the sand; up to breathe, her throat sacs take weak-point damage', () => {
    const w = new RaidWidow(arena(), ground);
    run(w, 0.5, () => host(10, 0));
    expect(w.awake).toBe(true);
    expect(w.brain.submerged).toBe(true);
    expect(w.damage(100, null).dealt).toBe(0);
    const from = new THREE.Vector3(w.position.x, 3, w.position.z - 30), to = from.clone().add(new THREE.Vector3(0, 0, 60));
    expect(w.hit(from, to)).toBeNull();
    w.brain.breathe(6);
    run(w, 0.5, () => host(10, 0));
    const sac = w.body.hitSpheres.find((h) => h.tag === 'throatSac')!;
    expect(w.exposed(sac)).toBe(true);
    const wp = B.weakPoints.throatSacs as { multiplier: number; biomassEach: number };
    expect(w.damage(100, sac)).toMatchObject({ weak: true, dealt: 100 * wp.multiplier });
    expect(w.damage(wp.biomassEach, sac).popped).toBe(`throatSac${sac.index}`);
  });

  it('her undertow bites a host on the sand, but not one standing on a debris rock', () => {
    const open = new RaidWidow(arena(), ground);
    const u = atk('circle', 'undertow') as { damage: number };
    expect(run(open, 14, () => host(10, 0)).strikes.find((s) => s.source === 'undertow')?.damage).toBe(u.damage);
    const safe = new RaidWidow(arena(), ground);
    const f = run(safe, 14, () => host(ROCK.x, ROCK.z));
    expect(f.events.some((e) => e.type === 'undertow')).toBe(true);
    expect(f.strikes.some((s) => s.source === 'undertow')).toBe(false);
  });

  it('calls Dunewake out of her throat, inside the crater', () => {
    const w = new RaidWidow(arena(), ground);
    const c = atk('circle', 'broodCall') as { firstDelay: number; windup: number; spawn: { type: string; count: number } };
    const f = run(w, c.firstDelay + c.windup + 1, () => host(10, 0));
    expect(f.brood[0]).toMatchObject({ type: c.spawn.type, count: c.spawn.count });
    expect(Math.hypot(f.brood[0].x, f.brood[0].z)).toBeLessThan(52);
  });

  it('a sand blast in its cone hits and blinds', () => {
    const w = new RaidWidow(arena(), ground);
    run(w, 0.2, () => host(10, 0));
    w.biomass = B.biomass * 0.5;
    const f = run(w, 30, () => host(10, 0));
    const bl = atk('erupt', 'sandBlast') as { damage: number; blindDuration: number };
    if (f.events.some((e) => e.type === 'blast')) {
      expect(f.blind).toBe(bl.blindDuration);
      expect(f.strikes.some((s) => s.source === 'sand blast' && s.damage === bl.damage)).toBe(true);
    }
    expect(f.strikes.some((s) => s.source === 'breach')).toBe(true);
  });

  it('drowning, the quicksand slows and grinds a host on the sand; a rock is safe', () => {
    const w = new RaidWidow(arena(), ground);
    run(w, 0.2, () => host(10, 0));
    w.biomass = B.biomass * 0.2;
    const q = atk('drown', 'quicksand') as { slowMultiplier: number };
    const f = run(w, 1, () => host(5, 0));
    expect(f.slow).toBe(q.slowMultiplier);
    expect(f.strikes.some((s) => s.source === 'quicksand')).toBe(true);
    expect(w.quicksandAt(ROCK.x, ROCK.top, ROCK.z)).toBe(false);
  });

  it('dies at zero Biomass and stops acting', () => {
    const w = new RaidWidow(arena(), ground);
    run(w, 0.2, () => host(10, 0));
    w.brain.breathe(6);
    expect(w.damage(1e6, null).killed).toBe(true);
    expect(w.alive).toBe(false);
    expect(run(w, 3, () => host(5, 0))).toMatchObject({ strikes: [], events: [], brood: [], slow: 1 });
  });
});
