/**
 * Class progression and the Hive Armoury (data/progression.json, weapons.json `unlock`).
 *
 * - XP is earned per host class from what the raid log records (kills by kind, harvests, nests, bosses), plus an
 *   extraction bonus and a share of the banked haul, or a small consolation on death. Levels come from
 *   progression.json `levels`.
 * - Class signature weapons (weapons.json `unlock: {class, level}`) appear in the Armoury once that class reaches
 *   the level. They can be grown for DNA (armoury.priceFraction x the weapon's item value) as often as you like;
 *   a grown copy is an ordinary stash item, lost if it dies in a raid.
 */
import { CLASSES, LOOT, PROGRESSION, WEAPONS, levelForXp, type ClassId } from '../../data';
import type { RaidLog } from './economy';
import { stashGrid, type Profile } from './profile';

export const classXp = (p: Profile, cls: ClassId = p.host): number => p.classXp[cls] ?? 0;
export const classLevel = (p: Profile, cls: ClassId = p.host): number => levelForXp(classXp(p, cls));

/** XP a raid earned, from its log. `haulDna` is the DNA banked on extraction. */
export function raidXp(log: RaidLog, extracted: boolean, haulDna = 0): number {
  const x = PROGRESSION.xp;
  let xp = 0;
  for (const [kind, n] of log.killed) xp += (x.kill[kind] ?? 0) * n;
  for (const boss of log.bosses) xp += x.kill[boss] ?? 0;
  xp += x.kill.rivalHost ? x.kill.rivalHost * log.rivals : 0;
  for (const n of log.harvested.values()) xp += x.harvest * n;
  xp += x.nestDestroyed * log.nests;
  xp += extracted ? x.extract + Math.floor(haulDna * x.extractPerHaulDna) : x.death;
  return xp;
}

export interface XpAward { class: ClassId; xp: number; from: number; to: number; unlocked: string[] }

/** Adds XP to a class (the current host by default) and reports levels gained and weapons that just unlocked. */
export function awardXp(p: Profile, xp: number, cls: ClassId = p.host): XpAward {
  const from = classLevel(p, cls);
  p.classXp[cls] = classXp(p, cls) + Math.max(0, Math.floor(xp));
  const to = classLevel(p, cls);
  const unlocked = signatureWeapons(cls).filter((id) => { const l = WEAPONS[id].unlock!.level; return l > from && l <= to; });
  return { class: cls, xp: Math.floor(xp), from, to, unlocked };
}

/** Signature weapons of a class, by unlock level. */
export function signatureWeapons(cls: ClassId): string[] {
  return Object.keys(WEAPONS).filter((id) => WEAPONS[id].unlock?.class === cls).sort((a, b) => WEAPONS[a].unlock!.level - WEAPONS[b].unlock!.level);
}

export interface ArmouryEntry { weapon: string; class: ClassId; level: number; unlocked: boolean; price: number }

/** DNA to grow a copy of a signature weapon. */
export function armouryPrice(weapon: string): number {
  const value = LOOT.items[weapon]?.value ?? 0;
  return Math.max(1, Math.round(value * (PROGRESSION.armoury?.priceFraction ?? 0.6)));
}

/** Every class signature weapon with whether this profile has unlocked it. */
export function armoury(p: Profile): ArmouryEntry[] {
  return (Object.keys(CLASSES) as ClassId[]).flatMap((cls) => signatureWeapons(cls).map((weapon) => {
    const level = WEAPONS[weapon].unlock!.level;
    return { weapon, class: cls, level, unlocked: classLevel(p, cls) >= level, price: armouryPrice(weapon) };
  }));
}

export type GrowResult = 'ok' | 'unknown' | 'locked' | 'dna' | 'stashFull';

/** Grows a copy of an unlocked signature weapon into the stash for DNA. */
export function growWeapon(p: Profile, weapon: string): GrowResult {
  const e = armoury(p).find((a) => a.weapon === weapon);
  if (!e) return 'unknown';
  if (!e.unlocked) return 'locked';
  if (p.dna < e.price) return 'dna';
  const g = stashGrid(p);
  if (g.add(weapon, 1) > 0) return 'stashFull';
  p.stash = g.snapshot();
  p.dna -= e.price;
  return 'ok';
}
