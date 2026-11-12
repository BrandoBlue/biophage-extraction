/**
 * Host level at a glance: where the current host stands in its level, what the next level brings, and the bar that
 * shows it. XP and level thresholds come from data/progression.json (Gameplay's progression.ts awards them); class
 * signature guns come from weapons.json `unlock`. Shown in the Hive header, on the main menu and in the debrief.
 */
import { CLASSES, PROGRESSION, WEAPONS, levelForXp, type ClassId } from '../../../data';
import { esc } from './kit';

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP where this level began, and where the next one starts (null at the top level). */
  floor: number;
  next: number | null;
  /** 0..1 through the current level (1 at the top level). */
  frac: number;
}

export function levelProgress(xp: number): LevelProgress {
  const L = PROGRESSION.levels;
  const x = Math.max(0, Math.floor(xp));
  const level = levelForXp(x);
  const floor = L[level - 1] ?? 0;
  const next = level < L.length ? L[level] : null;
  return { level, xp: x, floor, next, frac: next === null ? 1 : Math.min(1, Math.max(0, (x - floor) / (next - floor))) };
}

export const MAX_LEVEL = PROGRESSION.levels.length;

export interface LevelUnlock { kind: 'gun' | 'evolution'; id: string; label: string }

/** What a class gains at exactly `level`: Armoury guns (real now) and evolutions (body forms, not yet playable). */
export function unlocksAt(cls: ClassId, level: number): LevelUnlock[] {
  const guns = Object.entries(WEAPONS).filter(([, w]) => w.unlock?.class === cls && w.unlock.level === level)
    .map(([id, w]) => ({ kind: 'gun' as const, id, label: w.label }));
  const evo = (PROGRESSION.evolutions[cls] ?? []).filter((e) => e.level === level).map((e) => ({ kind: 'evolution' as const, id: e.id, label: e.label }));
  return [...guns, ...evo];
}

/** The next level above `level` that brings something, and what it brings. */
export function nextUnlock(cls: ClassId, level: number): { level: number; items: LevelUnlock[] } | null {
  for (let l = level + 1; l <= MAX_LEVEL; l++) {
    const items = unlocksAt(cls, l);
    if (items.length) return { level: l, items };
  }
  return null;
}

/** "Unlocks at level 4: Stinger Choir (Armoury gun) · Neuro-Hound (evolution, coming soon)". */
export function unlockLine(cls: ClassId, level: number): string {
  const n = nextUnlock(cls, level);
  if (!n) return 'Every unlock for this host is open';
  return `Unlocks at level ${n.level}: ${n.items.map((u) => `${u.label} (${u.kind === 'gun' ? 'Armoury gun' : 'evolution, coming soon'})`).join(' · ')}`;
}

export const xpText = (p: LevelProgress): string =>
  p.next === null ? `${p.xp.toLocaleString('en-US')} XP · top level` : `${(p.xp - p.floor).toLocaleString('en-US')} / ${(p.next - p.floor).toLocaleString('en-US')} XP to level ${p.level + 1}`;

/**
 * The level meter: a thin organic vein that fills through the level. `from` (0..1) lets the debrief show the gain
 * as a brighter segment that grows in after the old fill.
 */
export function levelBar(frac: number, from?: number): string {
  const a = from === undefined ? frac : Math.min(from, frac);
  return `<span class="lv-bar" style="--v:${frac.toFixed(4)};--a:${a.toFixed(4)}"><i class="old"></i><i class="gain"></i></span>`;
}

/** A full level block: class, level, bar, XP to next and the next unlock. */
export function levelBlock(cls: ClassId, xp: number): string {
  const p = levelProgress(xp);
  return `<div class="lv-block" data-level="${p.level}">
    <div class="lv-head"><span>${esc(CLASSES[cls].label.replace('The ', ''))}</span><b>Level ${p.level}</b></div>
    ${levelBar(p.frac)}
    <div class="lv-xp">${esc(xpText(p))}</div>
    <div class="lv-next">${esc(unlockLine(cls, p.level))}</div>
  </div>`;
}

/** The short form for tight spots: "Next: Eyestalk Marksman at level 6". */
export function nextShort(cls: ClassId, level: number): string {
  const n = nextUnlock(cls, level);
  if (!n) return 'Every unlock is open';
  const pick = n.items.find((u) => u.kind === 'gun') ?? n.items[0];
  return `Next: ${pick.label}${n.items.length > 1 ? ` and ${n.items.length - 1} more` : ''} at level ${n.level}`;
}

/** The menu's compact level block: class and level, the bar, XP to next and the next unlock in one line. */
export function levelNote(cls: ClassId, xp: number): string {
  const p = levelProgress(xp);
  return `<div class="lv-block compact" data-level="${p.level}" title="${esc(unlockLine(cls, p.level))}">
    <div class="lv-head"><span>${esc(CLASSES[cls].label.replace('The ', ''))}</span><b>Level ${p.level}</b></div>
    ${levelBar(p.frac)}
    <div class="lv-xp">${esc(xpText(p))}</div>
    <div class="lv-next">${esc(nextShort(cls, p.level))}</div>
  </div>`;
}
