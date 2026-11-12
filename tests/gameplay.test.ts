import { describe, expect, it } from 'vitest';
import { ABILITIES, ABOMINATIONS, HOST, weaponSpec } from '../data';
import { AbilitySystem } from '../src/game/abilities';
import { EventBus } from '../src/game/events';
import { ExtractionPoint } from '../src/game/extraction';
import { Carried } from '../src/game/inventory';
import { footstepRadius, hears, sees } from '../src/game/perception';
import { segmentSphere } from '../src/game/projectiles';
import { Biomass, NeuralOverload } from '../src/game/vitals';
import { AutoWeaponState } from '../src/game/weapon-state';
import * as THREE from 'three';

const step = (fn: (dt: number) => void, seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) fn(dt); };

describe('Neural Overload', () => {
  it('Overloads after about 11 s of sprinting from cold', () => {
    const o = new NeuralOverload(HOST.neuralOverload);
    let t = 0;
    while (!o.overloaded && t < 30) { o.add(HOST.neuralOverload.sprintFillPerSecond / 60); o.update(1 / 60); t += 1 / 60; }
    expect(t).toBeGreaterThan(10);
    expect(t).toBeLessThan(12);
  });
  it('locks out for the overloaded duration, then resets to resetTo', () => {
    const o = new NeuralOverload(HOST.neuralOverload);
    expect(o.add(HOST.neuralOverload.max)).toBe(true);
    expect(o.add(10)).toBe(false);
    step((dt) => o.update(dt), HOST.neuralOverload.overloadedDuration - 0.1);
    expect(o.overloaded).toBe(true);
    step((dt) => o.update(dt), 0.2);
    expect(o.overloaded).toBe(false);
    expect(o.value).toBeCloseTo(HOST.neuralOverload.resetTo, 0);
  });
  it('decays only after the decay delay', () => {
    const o = new NeuralOverload(HOST.neuralOverload);
    o.add(50);
    step((dt) => o.update(dt), HOST.neuralOverload.decayDelay * 0.9);
    expect(o.value).toBe(50);
    step((dt) => o.update(dt), 1);
    expect(o.value).toBeLessThan(50);
  });
});

describe('Biomass', () => {
  it('clamps damage and healing and reports death', () => {
    const b = new Biomass(200);
    expect(b.damage(50)).toBe(50);
    expect(b.heal(100)).toBe(50);
    b.damage(500);
    expect(b.dead).toBe(true);
    expect(b.heal(10)).toBe(0);
  });
});

describe('Synapse Burster magazine', () => {
  const spec = weaponSpec('synapseBurster');
  const w = { ...spec, reloadTime: spec.reload.time };
  it('fires at fireRate while held', () => {
    const s = new AutoWeaponState(w);
    let shots = 0;
    step((dt) => { shots += s.update(dt, true).shots; }, 1);
    expect(shots).toBeGreaterThanOrEqual(w.fireRate);
    expect(shots).toBeLessThanOrEqual(w.fireRate + 1);
  });
  it('regrows automatically when empty and refills after reloadTime', () => {
    const s = new AutoWeaponState(w);
    step((dt) => s.update(dt, true), w.magazine / w.fireRate + 0.2);
    expect(s.isReloading).toBe(true);
    let reloaded = false;
    step((dt) => { reloaded ||= s.update(dt, false).reloaded; }, w.reloadTime + 0.1);
    expect(reloaded).toBe(true);
    expect(s.ammo).toBe(w.magazine);
  });
});

describe('extraction', () => {
  it('needs the full channel time and resets on leave', () => {
    const e = new ExtractionPoint(0, 0, 4, 8);
    expect(e.update(0, 0, 0.1)).toBe('start');
    step((dt) => e.update(0, 0, dt), 4);
    expect(e.update(10, 0, 0.1)).toBe('cancel');
    expect(e.progress).toBe(0);
    e.update(0, 0, 0.1);
    let done = false;
    step((dt) => { done ||= e.update(0, 0, dt) === 'done'; }, 8);
    expect(done).toBe(true);
  });
});

describe('carried haul', () => {
  it('stacks, consumes and values items plus kill DNA', () => {
    const c = new Carried();
    c.add('clotGel', 2); c.add('clotGel'); c.dna = 10;
    expect(c.count('clotGel')).toBe(3);
    expect(c.consume('clotGel')).toBe(true);
    expect(c.value).toBe(2 * 15 + 10);
    expect(() => c.add('nope')).toThrow();
  });
});

describe('perception', () => {
  const nm = ABOMINATIONS.needlemaw.perception;
  it('sees inside the cone and range only', () => {
    expect(sees(nm, 0, 0, 0, 0, 10)).toBe(true);
    expect(sees(nm, 0, 0, 0, 0, -10)).toBe(false);
    expect(sees(nm, 0, 0, 0, 0, nm.sight + 1)).toBe(false);
  });
  it('hears noise within the noise radius', () => {
    expect(hears(nm, 0, 0, { x: 5, z: 0, radius: 8 })).toBe(true);
    expect(hears(nm, 0, 0, { x: 12, z: 0, radius: 8 })).toBe(false);
  });
  it('makes crouching quieter and standing still silent', () => {
    const base = { classNoise: 1, walk: 8, sprint: 16 };
    expect(footstepRadius({ ...base, moving: false, sprinting: false, crouched: false })).toBe(0);
    expect(footstepRadius({ ...base, moving: true, sprinting: false, crouched: true })).toBe(4);
    expect(footstepRadius({ ...base, moving: true, sprinting: true, crouched: false })).toBe(16);
  });
});

describe('projectile hits', () => {
  it('finds the entry point of a segment through a sphere', () => {
    const t = segmentSphere(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(5, 0, 0), 1);
    expect(t).toBeCloseTo(0.4);
    expect(segmentSphere(new THREE.Vector3(0, 5, 0), new THREE.Vector3(10, 5, 0), new THREE.Vector3(5, 0, 0), 1)).toBeNull();
  });
});

describe('ability system', () => {
  it('spends Overload, enforces cooldown and refuses while Overloaded', () => {
    const o = new NeuralOverload(HOST.neuralOverload);
    const carried = new Carried();
    const sys = new AbilitySystem(ABILITIES, { overload: o, count: (i) => carried.count(i), consume: (i) => carried.consume(i) });
    let pulses = 0;
    sys.register('neuralPulse', () => pulses++);
    sys.register('clotGel', () => {});
    expect(sys.use('neuralPulse')).toBe('ok');
    expect(o.value).toBe(ABILITIES.neuralPulse.overloadCost);
    expect(sys.use('neuralPulse')).toBe('cooldown');
    expect(sys.use('clotGel')).toBe('empty');
    carried.add('clotGel');
    expect(sys.use('clotGel')).toBe('ok');
    expect(carried.count('clotGel')).toBe(0);
    step((dt) => sys.update(dt), ABILITIES.neuralPulse.cooldown + 0.1);
    o.add(HOST.neuralOverload.max);
    expect(sys.use('neuralPulse')).toBe('overloaded');
    expect(pulses).toBe(1);
  });
});

describe('event bus', () => {
  it('delivers typed events and unsubscribes', () => {
    const bus = new EventBus();
    const got: number[] = [];
    const off = bus.on('noise', (e) => got.push(e.radius));
    bus.emit('noise', { position: { x: 0, y: 0, z: 0 }, radius: 25, source: 'gunfire' });
    off();
    bus.emit('noise', { position: { x: 0, y: 0, z: 0 }, radius: 9, source: 'x' });
    expect(got).toEqual([25]);
  });
});
