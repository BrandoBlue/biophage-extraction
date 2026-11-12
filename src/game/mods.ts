/**
 * Weapon mods (data/mods.json): living grafts that bud onto a gun's sockets (barrel, sight, under, chamber).
 *
 * - `applyMods(spec, ids)` turns a resolved WeaponSpec into the modded one: effects.mult multiplies a field by
 *   dotted path, effects.set replaces it, effects.special is collected into `spec.specials` for the raid to run
 *   (acid, seek, leech, splinter, weakPointGlow). `noise.gunfire` scales the host's gunfire noise.
 * - Grafts live on the loadout in the Hive: `profile.weaponMods[0]` is the starter's, `[1 + i]` weapon slot i's.
 *   Fitting takes the mod out of the stash (a graft already in that socket goes back). Mods on an equipped gun
 *   ride into the raid with it and are lost with it on death; the starter is innate, so its grafts stay.
 *   Unequipping a gun in the Hive pulls its grafts back into the stash.
 */
import { MODS, WEAPONS, modFits, type ModDef, type ModSlot, type WeaponDef, type WeaponSpec } from '../../data';
import { STARTER_WEAPON, weaponSlots } from './arsenal';
import { stashGrid, type Profile } from './profile';

export const MOD_SLOT_ORDER: ModSlot[] = ['barrel', 'sight', 'under', 'chamber'];

export const isMod = (id: string): boolean => !!MODS[id];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Walks a dotted path; returns the parent object and the last key, or null when a step is missing. */
function at(obj: Record<string, unknown>, path: string, create: boolean): [Record<string, unknown>, string] | null {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] === null || o[k] === undefined) {
      if (!create) return null;
      // A sight graft on a gun with no ADS gives it one (Stalk Eye turns a rifle into a scoped gun).
      o[k] = k === 'ads' ? { zoom: 1, time: 0.25, scope: false } : {};
    }
    if (typeof o[k] !== 'object') return null;
    o = o[k] as Record<string, unknown>;
  }
  return [o, keys[keys.length - 1]];
}

/** The weapon spec with these grafts applied, in socket order. Unknown ids are ignored. */
export function applyMods(spec: WeaponSpec, ids: readonly string[]): WeaponSpec {
  const out = clone(spec) as WeaponSpec & Record<string, unknown>;
  out.mods = [];
  out.specials = [...spec.specials];
  for (const id of ids) {
    const m = MODS[id];
    if (!m) continue;
    out.mods.push(id);
    for (const [path, k] of Object.entries(m.effects.mult ?? {})) {
      const r = at(out, path, false);
      if (r && typeof r[0][r[1]] === 'number') r[0][r[1]] = (r[0][r[1]] as number) * k;
    }
    for (const [path, v] of Object.entries(m.effects.set ?? {})) {
      const r = at(out, path, true);
      if (r) r[0][r[1]] = v;
    }
    if (m.effects.special) out.specials.push({ ...m.effects.special });
  }
  out.magazine = Math.max(1, Math.round(out.magazine));
  return out;
}

/** A special by id on a (modded) spec. */
export function special<T = Record<string, number>>(spec: WeaponSpec, id: string): (T & { id: string }) | undefined {
  return spec.specials.find((s) => s.id === id) as (T & { id: string }) | undefined;
}

/** The loadout gun at `slot` (0 = the starter, 1.. = weapon slots), or null. */
export function loadoutWeapon(p: Profile, slot: number): string | null {
  return slot === 0 ? STARTER_WEAPON : (p.weaponSlots[slot - 1] ?? null);
}

/** Clean graft lists: one per loadout slot (starter + weaponSlots()), only known mods that fit, one per socket. */
export function normaliseWeaponMods(raw: unknown, slots: (string | null)[]): string[][] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 1 + weaponSlots() }, (_, i) => {
    const gun = i === 0 ? STARTER_WEAPON : slots[i - 1];
    if (!gun) return [];
    const list = Array.isArray(arr[i]) ? (arr[i] as unknown[]) : [];
    const seen = new Set<ModSlot>();
    return list.filter((id): id is string => {
      if (typeof id !== 'string' || !MODS[id] || !modFits(MODS[id], WEAPONS[gun] as WeaponDef) || seen.has(MODS[id].slot)) return false;
      seen.add(MODS[id].slot);
      return true;
    });
  });
}

export type FitResult = 'ok' | 'noWeapon' | 'noMod' | 'doesNotFit' | 'notInStash' | 'stashFull';

/** Whether `mod` can be grafted onto the loadout gun at `slot` right now. */
export function canFitMod(p: Profile, slot: number, mod: string): FitResult {
  const gun = loadoutWeapon(p, slot);
  if (!gun) return 'noWeapon';
  const m: ModDef | undefined = MODS[mod];
  if (!m) return 'noMod';
  if (!modFits(m, WEAPONS[gun] as WeaponDef)) return 'doesNotFit';
  if (stashGrid(p).count(mod) < 1) return 'notInStash';
  return 'ok';
}

/** Grafts `mod` from the stash onto the gun at `slot`; a graft already in that socket goes back to the stash. */
export function fitMod(p: Profile, slot: number, mod: string): FitResult {
  const r = canFitMod(p, slot, mod);
  if (r !== 'ok') return r;
  const g = stashGrid(p);
  g.remove(mod, 1);
  const list = p.weaponMods[slot];
  const old = list.findIndex((id) => MODS[id]?.slot === MODS[mod].slot);
  if (old >= 0 && g.add(list[old], 1) > 0) return 'stashFull';
  p.stash = g.snapshot();
  if (old >= 0) list.splice(old, 1);
  list.push(mod);
  list.sort((a, b) => MOD_SLOT_ORDER.indexOf(MODS[a].slot) - MOD_SLOT_ORDER.indexOf(MODS[b].slot));
  return 'ok';
}

/** Pulls the graft in `socket` off the gun at `slot` back into the stash. False if empty or the stash is full. */
export function removeMod(p: Profile, slot: number, socket: ModSlot): boolean {
  const list = p.weaponMods[slot] ?? [];
  const i = list.findIndex((id) => MODS[id]?.slot === socket);
  if (i < 0) return false;
  const g = stashGrid(p);
  if (g.add(list[i], 1) > 0) return false;
  p.stash = g.snapshot();
  list.splice(i, 1);
  return true;
}

/** Pulls every graft off the gun at `slot` into the stash (used when a gun is unequipped). False if any won't fit. */
export function stripMods(p: Profile, slot: number): boolean {
  const g = stashGrid(p);
  for (const id of p.weaponMods[slot] ?? []) if (g.add(id, 1) > 0) return false;
  p.stash = g.snapshot();
  p.weaponMods[slot] = [];
  return true;
}
