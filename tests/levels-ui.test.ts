// Host level at a glance (src/ui/hive/levels.ts): progress through a level, the next unlock, plain words.
import { describe, expect, it } from 'vitest';
import { PROGRESSION, WEAPONS } from '../data';
import { levelProgress, MAX_LEVEL, nextShort, nextUnlock, unlockLine, unlocksAt, xpText } from '../src/ui/hive/levels';

const L = PROGRESSION.levels;

describe('host level progress', () => {
  it('starts at level 1 with an empty bar', () => {
    const p = levelProgress(0);
    expect(p).toMatchObject({ level: 1, floor: 0, next: L[1], frac: 0 });
    expect(xpText(p)).toBe(`0 / ${L[1].toLocaleString('en-US')} XP to level 2`);
  });

  it('fills through a level and resets at the next threshold', () => {
    const mid = Math.round((L[2] + L[3]) / 2);
    const p = levelProgress(mid);
    expect(p.level).toBe(3);
    expect(p.frac).toBeCloseTo((mid - L[2]) / (L[3] - L[2]), 5);
    expect(levelProgress(L[3]).level).toBe(4);
    expect(levelProgress(L[3]).frac).toBe(0);
  });

  it('tops out with a full bar', () => {
    const p = levelProgress(L[L.length - 1] + 5000);
    expect(p.level).toBe(MAX_LEVEL);
    expect(p.next).toBeNull();
    expect(p.frac).toBe(1);
    expect(xpText(p)).toContain('top level');
  });
});

describe('what the next level brings', () => {
  it('lists class signature guns and evolutions at their level', () => {
    const [id, w] = Object.entries(WEAPONS).find(([, x]) => x.unlock)!;
    const at = unlocksAt(w.unlock!.class, w.unlock!.level);
    expect(at.some((u) => u.kind === 'gun' && u.id === id)).toBe(true);
    const evo = PROGRESSION.evolutions.neuroInfiltrator[0];
    expect(unlocksAt('neuroInfiltrator', evo.level).some((u) => u.kind === 'evolution' && u.label === evo.label)).toBe(true);
  });

  it('skips empty levels and says it in plain words', () => {
    const n = nextUnlock('neuroInfiltrator', 1)!;
    expect(n.level).toBeGreaterThan(1);
    expect(unlockLine('neuroInfiltrator', 1)).toMatch(/^Unlocks at level \d+: /);
    expect(nextShort('neuroInfiltrator', 1)).toMatch(/^Next: .+ at level \d+$/);
    expect(unlockLine('neuroInfiltrator', MAX_LEVEL)).toBe('Every unlock for this host is open');
  });

  it('never names a milestone', () => {
    for (let l = 1; l <= MAX_LEVEL; l++) expect(unlockLine('goreBehemoth', l)).not.toMatch(/\b(Spore|Larva|Host|Apex)\b/);
  });
});
