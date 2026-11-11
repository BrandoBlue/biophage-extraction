import { describe, expect, it } from 'vitest';
import { LOOT, PROGRESSION, WEAPONS } from '../data';
import { RaidLog } from '../src/game/economy';
import { armoury, armouryPrice, awardXp, classLevel, growWeapon, raidXp, signatureWeapons } from '../src/game/progression';
import { loadProfile, memoryStorage, newProfile, saveProfile, stashGrid } from '../src/game/profile';

describe('class XP', () => {
  it('scores a raid from its log', () => {
    const log = new RaidLog();
    log.kill('needlemaw'); log.kill('needlemaw'); log.harvest('needlemawGland'); log.destroyNest(); log.killBoss('reliquary');
    const x = PROGRESSION.xp;
    const base = 2 * x.kill.needlemaw + x.harvest + x.nestDestroyed + (x.kill.reliquary ?? 0);
    expect(raidXp(log, true, 400)).toBe(base + x.extract + Math.floor(400 * x.extractPerHaulDna));
    expect(raidXp(log, false)).toBe(base + x.death);
  });

  it('levels the current class, reports unlocks, and survives a save', () => {
    const p = newProfile();
    expect(classLevel(p)).toBe(1);
    const first = signatureWeapons(p.host)[0];
    const need = PROGRESSION.levels[WEAPONS[first].unlock!.level - 1];
    const a = awardXp(p, need);
    expect(a.to).toBe(WEAPONS[first].unlock!.level);
    expect(a.unlocked).toContain(first);
    const kv = memoryStorage(); saveProfile(kv, p);
    expect(classLevel(loadProfile(kv).profile)).toBe(a.to);
  });
});

describe('Hive Armoury', () => {
  it('lists every signature weapon, grows unlocked ones for DNA and refuses locked ones', () => {
    const p = newProfile();
    const list = armoury(p);
    expect(list.length).toBe(Object.values(WEAPONS).filter((w) => w.unlock).length);
    const [w] = signatureWeapons(p.host);
    expect(armouryPrice(w)).toBe(Math.round(LOOT.items[w].value * PROGRESSION.armoury!.priceFraction));
    expect(growWeapon(p, w)).toBe('locked');
    awardXp(p, PROGRESSION.levels[WEAPONS[w].unlock!.level - 1]);
    p.dna = 0;
    expect(growWeapon(p, w)).toBe('dna');
    p.dna = armouryPrice(w) * 2;
    expect(growWeapon(p, w)).toBe('ok');
    expect(growWeapon(p, w)).toBe('ok');
    expect(stashGrid(p).count(w)).toBe(2);
    expect(p.dna).toBe(0);
    expect(growWeapon(p, 'nope')).toBe('unknown');
  });
});
