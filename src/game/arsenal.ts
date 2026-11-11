/**
 * Weapon loadout (pure logic over the Profile). Weapons are stash items whose id is a weapons.json id
 * (loot.json kind 'weapon'). The host always carries its innate starter weapon; up to `weaponSlots()` more are
 * equipped from the stash in the Hive, carried into the raid, and lost on death like the cavities. Weapons picked
 * up in a raid ride home in the cavities as items.
 */
import { PROFILE, WEAPONS } from '../../data';
import { stashGrid, type Profile } from './profile';

/** The weapon every host starts with and never loses. */
export const STARTER_WEAPON = 'synapseBurster';

/** How many weapons can be equipped besides the starter (profile.json `weaponSlots`, default 2). */
export const weaponSlots = (): number => Number((PROFILE as { weaponSlots?: number }).weaponSlots ?? 2);

export const isWeapon = (id: string): boolean => !!WEAPONS[id];

/** Clean slots: weapons.json ids or null, exactly weaponSlots() long, never the starter. */
export function normaliseSlots(raw: unknown): (string | null)[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: weaponSlots() }, (_, i) => (typeof arr[i] === 'string' && isWeapon(arr[i]) && arr[i] !== STARTER_WEAPON ? arr[i] : null));
}

/** The raid's weapons in slot order: the starter first, then whatever is equipped. */
export const raidWeapons = (p: Profile): string[] => [STARTER_WEAPON, ...p.weaponSlots.filter((w): w is string => !!w)];

/**
 * Equips a weapon from the stash into `slot`. Whatever was in the slot goes back to the stash. Returns false,
 * changing nothing, if the stash lacks that weapon, the slot is out of range, or the old weapon cannot fit back.
 */
export function equipWeapon(p: Profile, slot: number, weapon: string): boolean {
  if (slot < 0 || slot >= weaponSlots() || !isWeapon(weapon) || weapon === STARTER_WEAPON) return false;
  const g = stashGrid(p);
  const e = g.entries.find((x) => x.item === weapon);
  if (!e) return false;
  const old = p.weaponSlots[slot];
  e.count -= 1;
  if (e.count <= 0) g.take(e);
  if (old && g.add(old, 1) > 0) return false; // no room for the old one: nothing changes (g is a copy)
  p.stash = g.snapshot();
  p.weaponSlots[slot] = weapon;
  return true;
}

/** Puts the weapon in `slot` back into the stash. False if the slot is empty or the stash is full. */
export function unequipWeapon(p: Profile, slot: number): boolean {
  const old = p.weaponSlots[slot];
  if (!old) return false;
  const g = stashGrid(p);
  if (g.add(old, 1) > 0) return false;
  p.stash = g.snapshot();
  p.weaponSlots[slot] = null;
  return true;
}
