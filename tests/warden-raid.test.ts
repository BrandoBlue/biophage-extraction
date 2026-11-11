import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { AI, BOSSES } from '../data';
import type { HostView } from '../src/ai';
import { RaidWarden, type WardenFrame } from '../src/game/warden';
import { SOLIDS } from '../src/world/zone7';
import type { WardenArena } from '../src/world/wreck';

const B = BOSSES.warden;
const atk = (p: string, a: string) => (B.phases.find((x) => x.id === p)!.attacks as Record<string, Record<string, number>>)[a];

function arena(): WardenArena & { vented: boolean[] } {
  const vented = [false, false, false, false];
  const catwalks = ['ring-east', 'ring-west', 'bridge-north', 'gantry-northeast'].map((id, i) => {
    let down = false;
    return { id, level: (i < 3 ? 1 : 2) as 1 | 2, x0: -90 + i * 4, x1: -86 + i * 4, z0: -3, z1: 3, y: i < 3 ? 6 : 12, get collapsed() { return down; }, collapse() { down = true; } };
  });
  return {
    id: 'reactorChamber', x0: -100, x1: -62, z0: -20, z1: 20, floorY: 0, ceiling: 18,
    core: { x: -81, z: 0, radius: 3 },
    valves: [0, 1, 2, 3].map((i) => ({ id: `valve-${i}`, x: -81 + Math.cos(i * Math.PI / 2) * 6, y: 6, z: Math.sin(i * Math.PI / 2) * 6 })),
    vent(i, on = true) { vented[i] = on; },
    pillars: [{ id: 'shield-pillar-0', x: -71, z: 0, radius: 1.25 }],
    catwalks,
    bossSpawn: { x: -81, y: 15.5, z: 19, surface: 'wall' },
    exits: [{ id: 'galleryDoor', x: -62, z: 0 }],
    vented,
  };
}

const host = (x: number, z: number, o: Partial<HostView> = {}): HostView => ({ x, y: 0, z, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o });

function run(w: RaidWarden, seconds: number, at: (t: number) => HostView, step = 1 / 30): WardenFrame {
  const all: WardenFrame = { strikes: [], events: [], brood: [], fallen: [] };
  for (let t = 0; t < seconds; t += step) {
    const f = w.update(step, at(t));
    all.strikes.push(...f.strikes); all.events.push(...f.events); all.brood.push(...f.brood); all.fallen.push(...f.fallen);
  }
  return all;
}

afterEach(() => SOLIDS.clear());

describe('The Warden of the Long Seed in a raid', () => {
  it('waits on the chamber wall, head against it, and wakes when a host walks in', () => {
    const w = new RaidWarden(arena());
    expect(w.awake).toBe(false);
    expect(w.brain.surface).toBe('wall');
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(w.body.root.quaternion);
    expect(up.z).toBeLessThan(-0.9);
    expect(run(w, 1, () => host(-40, 0)).events).toEqual([]);
    expect(run(w, 0.2, () => host(-75, 0)).events.some((e) => e.type === 'wake')).toBe(true);
  });

  it('its plates soak fire in tend; shooting a valve vents it and cracks the seam beside it for a while', () => {
    const A = arena(), w = new RaidWarden(A);
    run(w, 0.2, () => host(-75, 0));
    w.body.update(1 / 30);
    const plate = w.body.hitSpheres.find((h) => h.tag === 'plate')!;
    expect(w.damage(100, plate).dealt).toBeCloseTo(100 * Number(B.phases[0].plateMultiplier));
    const seam = w.body.hitSpheres.find((h) => h.tag === 'reactorSeam' && h.index === 1)!;
    expect(w.exposed(seam)).toBe(false);
    // A shot through the valve wheel finds it.
    const v = A.valves[1];
    const hit = w.valveHit(new THREE.Vector3(v.x - 10, v.y, v.z), new THREE.Vector3(v.x + 10, v.y, v.z));
    expect(hit?.index).toBe(1);
    w.vent(1);
    expect(A.vented[1]).toBe(true);
    expect(w.exposed(seam)).toBe(true);
    const r = w.damage(100, seam);
    expect(r).toMatchObject({ weak: true });
    expect(r.dealt).toBe(100 * (B.weakPoints.reactorSeams as { multiplier: number }).multiplier);
    run(w, AI.warden.seamOpenTime + 0.5, () => host(-75, 0));
    expect(w.exposed(seam)).toBe(false);
    expect(A.vented[1]).toBe(false);
  });

  it('a seed pod is a weak point that shatters', () => {
    const w = new RaidWarden(arena());
    w.body.update(1 / 30);
    const pod = w.body.hitSpheres.find((h) => h.tag === 'seedPod')!;
    const wp = B.weakPoints.seedPods as { biomassEach: number; multiplier: number };
    expect(w.damage(wp.biomassEach / wp.multiplier + 1, pod)).toMatchObject({ weak: true, popped: `seedPod${pod.index}` });
    expect(w.exposed(pod)).toBe(false);
  });

  it('the reactor pulse is stopped by a shield pillar between the core and the host', () => {
    const A = arena(), w = new RaidWarden(A);
    SOLIDS.add({ cx: -71, cz: 0, hx: 1.1, hz: 1.1, yaw: 0, y0: 0, y1: 18, tag: 'shield-pillar-0' });
    expect(w.pulseReach(-66, 1.2, 0)).toBe(0);
    expect(w.pulseReach(-81, 1.2, 10)).toBe(1);
    // Meltdown: a host in the open is hit by the pulse, one behind the pillar is not.
    run(w, 0.2, () => host(-75, 0));
    w.biomass = B.biomass * 0.2;
    const p = atk('meltdown', 'reactorPulse');
    const open = run(w, p.windup + 1, () => host(-81, 10));
    expect(open.strikes.find((s) => s.source === 'reactor pulse')?.damage).toBe(p.damage);
    const hid = new RaidWarden(A);
    run(hid, 0.2, () => host(-75, 0));
    hid.biomass = B.biomass * 0.2;
    const behind = run(hid, p.windup + 1, () => host(-66, 0));
    expect(behind.events.some((e) => e.type === 'pulse')).toBe(true);
    expect(behind.strikes.some((s) => s.source === 'reactor pulse')).toBe(false);
  });

  it('births its swarm inside the chamber and brings a catwalk down once it overheats', () => {
    const A = arena(), w = new RaidWarden(A);
    const f = run(w, AI.warden.swarmFirstDelay + AI.warden.birthTell + 3, () => host(-81, 8));
    const s = (atk('tend', 'embryoSwarm') as unknown as { spawn: { type: string; count: number } }).spawn;
    expect(f.brood[0]).toMatchObject({ type: s.type, count: s.count });
    expect(f.brood[0].x).toBeGreaterThan(A.x0);
    expect(f.brood[0].x).toBeLessThan(A.x1);
    w.biomass = B.biomass * 0.5;
    const g = run(w, 30, () => host(-81, 8));
    expect(g.fallen.length).toBeGreaterThan(0);
    expect(A.catwalks.some((c) => c.collapsed)).toBe(true);
  });

  it('dies at zero Biomass and stops acting', () => {
    const w = new RaidWarden(arena());
    run(w, 0.2, () => host(-75, 0));
    expect(w.damage(1e6, null).killed).toBe(true);
    expect(w.alive).toBe(false);
    expect(run(w, 3, () => host(-75, 0))).toMatchObject({ strikes: [], events: [], brood: [], fallen: [] });
  });
});
