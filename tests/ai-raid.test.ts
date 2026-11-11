import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ABOMINATIONS } from '../data';
import { Abomination, type AbominationContext, type AbominationKind } from '../src/game/abominations';

/** Raid-side wiring: Abominations driven by src/ai brains through AbominationContext. */
function ctxFor(others: Abomination[], log: { melee: number[]; knock: number[]; spit: number; alert: number; screech: number }, player = new THREE.Vector3()): AbominationContext {
  return {
    player, playerVelocity: new THREE.Vector3(), playerAlive: true, playerHidden: false,
    noises: [], others, playableRadius: 150, playerVisibility: 1, playerForward: { x: 0, z: 1 },
    onAlert: () => { log.alert++; },
    onMelee: (_a, d) => { log.melee.push(d); },
    onSpit: () => { log.spit++; },
    onKnockback: (_a, k) => { log.knock.push(k); },
    onScreech: () => { log.screech++; },
  };
}
const newLog = () => ({ melee: [] as number[], knock: [] as number[], spit: 0, alert: 0, screech: 0 });

function run(list: Abomination[], ctx: AbominationContext, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) for (const c of list) c.update(1 / 60, ctx);
}

describe('Abominations run on PvE AI brains', () => {
  it('every Larva kind gets a brain and moves its body from it', () => {
    for (const kind of ['needlemaw', 'bilecantor', 'glasswalker', 'oculimoth', 'mournback'] as AbominationKind[]) {
      const a = new Abomination(kind, ABOMINATIONS[kind], 0, 30, 5);
      const log = newLog();
      a.alert({ x: 0, z: 0 });
      run([a], ctxFor([a], log), 1);
      expect(a.brain.kind).toBe(kind);
      expect(a.position.x).toBeCloseTo(a.brain.body.x, 5);
      expect(a.position.z).toBeCloseTo(a.brain.body.z, 5);
      expect(a.engaged, kind).toBe(true);
    }
  });
  it('a Needlemaw pack bites through onMelee and never stacks more than two attackers', () => {
    const pack = Array.from({ length: 5 }, (_, i) => new Abomination('needlemaw', ABOMINATIONS.needlemaw, Math.cos(i) * 12, Math.sin(i) * 12, 10 + i));
    const log = newLog();
    for (const c of pack) c.alert({ x: 0, z: 0 });
    const ctx = ctxFor(pack, log);
    let worst = 0;
    for (let i = 0; i < 8 * 60; i++) {
      for (const c of pack) c.update(1 / 60, ctx);
      worst = Math.max(worst, pack.filter((c) => ['approach', 'windup', 'lunge'].includes(c.brain.phase)).length);
    }
    expect(log.melee.length).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(2);
  });
  it('a Mournback slam knocks the host back', () => {
    const m = new Abomination('mournback', ABOMINATIONS.mournback, 0, 3, 2);
    const log = newLog();
    m.alert({ x: 0, z: 0 });
    run([m], ctxFor([m], log), 3);
    expect(log.knock.length).toBeGreaterThan(0);
    expect(log.melee.length).toBeGreaterThan(0);
  });
  it('an Oculimoth screech alerts a sleeping Mournback 30 m away', () => {
    const swarm = Array.from({ length: 4 }, (_, i) => new Abomination('oculimoth', ABOMINATIONS.oculimoth, i * 2, 6, 20 + i));
    const sleeper = new Abomination('mournback', ABOMINATIONS.mournback, 0, -30, 3);
    const all = [...swarm, sleeper];
    const log = newLog();
    for (const o of swarm) o.alert({ x: 0, z: 0 });
    run(all, ctxFor(all, log), 10);
    expect(log.screech).toBeGreaterThan(0);
    expect(sleeper.brain.mode).not.toBe('calm');
  });
  it('a Bile Cantor spits through onSpit; dead creatures stop acting', () => {
    const c = new Abomination('bilecantor', ABOMINATIONS.bilecantor, 0, 25, 4);
    const log = newLog();
    c.alert({ x: 0, z: 0 });
    run([c], ctxFor([c], log), 6);
    expect(log.spit).toBeGreaterThan(0);
    c.damage(10_000, null);
    const before = log.spit;
    run([c], ctxFor([c], log), 4);
    expect(log.spit).toBe(before);
    expect(c.state).toBe('dead');
  });
});
