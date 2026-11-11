import { describe, expect, it } from 'vitest';
import { VIRUSES, VIRUS_RULES } from '../data';
import { Injection, SporeInfection, sporeRules, virusForItem, virusModifiers } from '../src/game/virus';
import { Biomass, NeuralOverload } from '../src/game/vitals';
import { HOST } from '../data';

describe('viruses', () => {
  it('maps every virus item back to its virus', () => {
    for (const [id, v] of Object.entries(VIRUSES)) expect(virusForItem(v.item)).toBe(id);
    expect(virusForItem('clotGel')).toBeNull();
  });

  it('reads gains and costs as multipliers', () => {
    expect(virusModifiers(null)).toEqual({ overloadDecay: 1, sprint: 1, biomassMax: 1, footstep: 1 });
    const a = virusModifiers('adrenalineVirus');
    expect(a.overloadDecay).toBe((VIRUSES.adrenalineVirus.effect as { overloadDecayMultiplier: number }).overloadDecayMultiplier);
    expect(a.biomassMax).toBeLessThan(1);
    expect(virusModifiers('plagueStalkerStrain').footstep).toBeGreaterThan(1);
  });

  it('injects over the channel time, cancels cleanly, and a second virus replaces the first', () => {
    const inj = new Injection();
    expect(inj.start('adrenalineVirus')).toBe(true);
    expect(inj.start('splicedParasites')).toBe(false); // one channel at a time
    expect(inj.update(VIRUS_RULES.injectTime / 2)).toBeNull();
    expect(inj.progress).toBeCloseTo(0.5);
    expect(inj.cancel()).toBe('adrenalineVirus');
    expect(inj.active).toBeNull();
    inj.start('adrenalineVirus');
    expect(inj.update(VIRUS_RULES.injectTime + 0.01)).toBe('adrenalineVirus');
    inj.start('splicedParasites');
    inj.update(VIRUS_RULES.injectTime + 0.01);
    expect(inj.active).toBe('splicedParasites');
  });

  it('spore stacks cap, tick damage for their duration, then expire', () => {
    const r = sporeRules();
    const s = new SporeInfection();
    for (let i = 0; i < r.maxStacks + 2; i++) s.infect(7);
    expect(s.stacksOf(7)).toBe(r.maxStacks);
    let total = 0;
    for (let t = 0; t < r.duration + 1; t += 0.1) total += s.update(0.1).get(7) ?? 0;
    expect(total).toBeCloseTo(r.maxStacks * r.damagePerSecond * r.duration, 0);
    expect(s.stacksOf(7)).toBe(0);
  });

  it('Biomass max scales down without healing, and Overload decays faster with a boost', () => {
    const b = new Biomass(200);
    b.scaleMax(0.85);
    expect(b.max).toBe(170);
    expect(b.current).toBe(170);
    b.damage(50);
    b.scaleMax(1);
    expect(b.current).toBe(120);
    const slow = new NeuralOverload(HOST.neuralOverload), fast = new NeuralOverload(HOST.neuralOverload);
    fast.decayBoost = 2;
    slow.add(50); fast.add(50);
    for (let i = 0; i < 40; i++) { slow.update(0.1); fast.update(0.1); }
    expect(fast.value).toBeLessThan(slow.value);
  });
});
