import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BOSSES } from '../data';
import type { HostView } from '../src/ai';
import { RaidVigil, type VigilFrame } from '../src/game/vigil';
import type { CaveLair } from '../src/world/cave';

const V = BOSSES.paleVigil;
const atk = (p: string, a: string) => (V.phases.find((x) => x.id === p)!.attacks as Record<string, Record<string, number>>)[a];

function lair(): CaveLair {
  const mouth = (id: string, x: number, z: number) => {
    const m = { id, x, z, out: { x: Math.sign(x), z: 0 }, sealed: false, seal() { m.sealed = true; }, unseal() { m.sealed = false; } };
    return m;
  };
  return {
    id: 'fungalCaves', x: 0, z: 0, floorY: 0, radius: 17, height: 16,
    entrances: [mouth('mouth', 18, 0), mouth('northTunnel', -18, 0)] as unknown as CaveLair['entrances'],
    ceilingAt: () => 16,
    ceiling: { anchors: [], links: [] },
    cover: [], glowPatches: [], collapsePoints: [],
    bossSpawn: { x: 0, y: 15, z: 0 }, escorts: [], exit: { x: 22, z: 0 },
  };
}

const host = (x: number, z: number, o: Partial<HostView> = {}): HostView => ({ x, y: 0, z, vx: 0, vz: 0, alive: true, hidden: false, visibility: 1, forward: { x: 0, z: 1 }, ...o });

function run(v: RaidVigil, seconds: number, at: (t: number) => HostView): VigilFrame {
  const all: VigilFrame = { strikes: [], overload: 0, events: [] };
  for (let t = 0; t < seconds; t += 1 / 30) {
    const f = v.update(1 / 30, at(t));
    all.strikes.push(...f.strikes); all.events.push(...f.events); all.overload += f.overload;
  }
  return all;
}

describe('The Pale Vigil in a raid', () => {
  it('hangs upside down under the roof with its lure low enough to reach', () => {
    const v = new RaidVigil(lair());
    expect(v.position.y).toBeGreaterThan(8);
    expect(v.position.y).toBeLessThanOrEqual(16);
    expect(Math.abs(Math.abs(v.body.root.rotation.z) - Math.PI)).toBeLessThan(1e-6);
    v.body.update(1 / 30);
    const lure = v.body.hitSpheres.find((h) => h.tag === 'lure')!;
    expect(lure.world.y).toBeLessThan(4);
  });

  it('drops on a host who stands under the lure and lands on the floor', () => {
    const v = new RaidVigil(lair());
    const f = run(v, 1.3, () => host(0.5, 0.5));
    expect(f.strikes.some((s) => s.source === 'drop' && s.damage === atk('hang', 'drop').damage)).toBe(true);
    expect(v.position.y).toBeLessThan(3);
    expect(v.body.root.rotation.z).toBe(0);
  });

  it('the lure pulls Overload only while the host looks at it', () => {
    const look = new RaidVigil(lair());
    expect(run(look, 1, () => host(0, -8, { forward: { x: 0, z: 1 } })).overload).toBeGreaterThan(atk('hang', 'lureGlow').overloadPerSecond * 0.5);
    const away = new RaidVigil(lair());
    expect(run(away, 1, () => host(0, -8, { forward: { x: 0, z: -1 } })).overload).toBe(0);
  });

  it('shooting the lure off brings it down to stalk; spines only count while it hangs; limbs from stalk', () => {
    const v = new RaidVigil(lair());
    run(v, 0.1, () => host(0, -9));
    v.body.update(1 / 30);
    const lure = v.body.hitSpheres.find((h) => h.tag === 'lure')!;
    const leg = v.body.hitSpheres.find((h) => h.tag === 'limb')!;
    expect(v.exposed(leg)).toBe(false);
    const wp = V.weakPoints.lure as { biomass: number; multiplier: number };
    const r = v.damage(wp.biomass / wp.multiplier + 1, lure);
    expect(r).toMatchObject({ weak: true, popped: 'lure' });
    const f = run(v, 2, () => host(0, -9));
    expect(f.events.some((e) => e.type === 'phase' && e.id === 'stalk')).toBe(true);
    expect(v.exposed(leg)).toBe(true);
    expect(v.damage((V.weakPoints.limbs as { biomassEach: number }).biomassEach, leg).popped).toBe(`limb${leg.index}`);
    expect(v.limbsIntact).toBe(3);
  });

  it('a shot finds the lure; nothing can be hit while it hides in the roof', () => {
    const v = new RaidVigil(lair());
    v.body.update(1 / 30);
    const lure = v.body.hitSpheres.find((h) => h.tag === 'lure')!;
    const hit = v.hit(lure.world.clone().add(new THREE.Vector3(0, 0, -20)), lure.world.clone().add(new THREE.Vector3(0, 0, 20)));
    expect(hit?.sphere.tag).toBe('lure');
    v.brain.hidden = true;
    expect(v.hit(lure.world.clone().add(new THREE.Vector3(0, 0, -20)), lure.world.clone().add(new THREE.Vector3(0, 0, 20)))).toBeNull();
  });

  it('a snatch holds the host and feeds until it lets go or takes enough damage', () => {
    const v = new RaidVigil(lair());
    const s = atk('hang', 'snatch');
    const f = run(v, 4, () => host(3.6, 0));
    expect(f.strikes.find((x) => x.source === 'snatch')?.pin).toBe(s.pin);
    v.pinned = 2;
    (v as unknown as { pinBreak: number; pinDps: number }).pinBreak = s.freedByDamage;
    (v as unknown as { pinDps: number }).pinDps = s.pinDamagePerSecond;
    const held = run(v, 0.5, () => host(3.6, 0)).strikes.filter((x) => x.source === 'grip');
    expect(held.reduce((a, x) => a + x.damage, 0)).toBeCloseTo(s.pinDamagePerSecond * 0.5, 0);
    v.damage(s.freedByDamage + 1, null);
    expect(v.pinned).toBe(0);
  });

  it('dies at zero Biomass and stops acting', () => {
    const v = new RaidVigil(lair());
    expect(v.damage(1e6, null).killed).toBe(true);
    expect(v.alive).toBe(false);
    expect(run(v, 3, () => host(0, 0))).toMatchObject({ strikes: [], events: [], overload: 0 });
  });
});
