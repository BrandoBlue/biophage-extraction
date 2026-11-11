import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NESTS } from '../data';
import { BroodHeart } from '../src/creatures/broodheart';
import { BroodNest, StandInHeart } from '../src/game/nest';
import { mulberry32 } from '../src/world/zone7';

const t = NESTS.broodHeart;
const make = () => new BroodNest('n', 'broodHeart', 10, 20, new BroodHeart(3), mulberry32(3));

describe('Brood Heart nest entity', () => {
  it('drives the stand-in heart too (the NestBody contract)', () => {
    const n = new BroodNest('s', 'broodHeart', 0, 0, new StandInHeart(t.weakPoints.count), mulberry32(1));
    n.damage(t.weakPoints.biomassEach, 0);
    expect(n.body.weakPoints[0].alive).toBe(false);
  });
  it('sleeps, wakes near a host, and pulses its waves out around the heart', () => {
    const n = make();
    expect(n.update(5, t.activationRadius + 5, 0)).toEqual([]);
    expect(n.state).toBe('dormant');
    n.update(0.1, 10, 0);
    expect(n.state).toBe('active');
    const wave = n.update(t.firstWaveDelay, 10, 0);
    expect(wave.length).toBe(t.waves[0].reduce((a, s) => a + s.count, 0));
    for (const s of wave) expect(Math.hypot(s.x - 10, s.z - 20)).toBeGreaterThan(2);
  });
  it('ventricles take multiplied damage, pop, and the heart dies at zero Biomass', () => {
    const n = make();
    n.damage(10, 0);
    expect(n.biomass).toBe(t.biomass - 10 * t.weakPoints.multiplier);
    expect(n.state).toBe('active'); // damage wakes it
    n.damage(t.weakPoints.biomassEach, 0);
    expect(n.isLiveVentricle(0)).toBe(false);
    expect(n.body.weakPoints[0].alive).toBe(false);
    const before = n.biomass;
    n.damage(10, 0);
    expect(n.biomass).toBe(before - 10);
    expect(n.damage(1e6)).toBe(true);
    expect(n.alive).toBe(false);
    expect(n.damage(10)).toBe(false);
    expect(n.update(t.waveInterval, 0, 0)).toEqual([]);
  });
  it('shots hit live ventricles before the body, and miss when they pass wide', () => {
    const n = make();
    n.body.refresh();
    const v = n.body.weakPoints[1].world;
    const out = v.clone().sub(n.core(new THREE.Vector3())).setY(0).normalize();
    expect(n.hit(v.clone().addScaledVector(out, 20), v.clone().addScaledVector(out, -0.2))?.vent).toBe(1);
    // A ventricle on the far side of the heart is shielded by the body.
    expect(n.hit(v.clone().addScaledVector(out, -20), v.clone().addScaledVector(out, 0.2))?.vent).not.toBe(1);
    const c = n.core(new THREE.Vector3());
    expect(n.hit(c.clone().add(new THREE.Vector3(30, 0, 0)), c.clone().add(new THREE.Vector3(-30, 0, 0)))?.vent).toBeNull();
    expect(n.hit(new THREE.Vector3(-100, 50, -100), new THREE.Vector3(-90, 50, -100))).toBeNull();
  });
});
