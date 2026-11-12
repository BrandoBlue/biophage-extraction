/** The WEAPONS tab's view over a real Profile (Gameplay's arsenal.ts, mods.ts and progression.ts own the rules). */
import { MODS, WEAPONS, weaponSpec } from '../../../data';
import { STARTER_WEAPON, isWeapon, weaponSlots } from '../../game/arsenal';
import { MOD_SLOT_ORDER, applyMods, canFitMod, isMod, loadoutWeapon } from '../../game/mods';
import type { Profile } from '../../game/profile';
import { armoury, classLevel } from '../../game/progression';
import type { ArsenalView } from './model';

/** Loadout guns, their grafts and specs, what the stash holds, and the Armoury. */
export function arsenalView(p: Profile): ArsenalView {
  const totals = new Map<string, number>();
  for (const it of p.stash) totals.set(it.item, (totals.get(it.item) ?? 0) + it.count);
  const slots = Array.from({ length: 1 + weaponSlots() }, (_, index) => {
    const weapon = loadoutWeapon(p, index);
    const mods = p.weaponMods[index] ?? [];
    const base = weapon ? weaponSpec(weapon) : null;
    return {
      index, weapon, starter: index === 0,
      sockets: weapon ? (WEAPONS[weapon].modSlots ?? []).slice().sort((a, b) => MOD_SLOT_ORDER.indexOf(a) - MOD_SLOT_ORDER.indexOf(b))
        .map((socket) => ({ socket, mod: mods.find((m) => MODS[m]?.slot === socket) ?? null })) : [],
      base, spec: base ? applyMods(base, mods) : null,
    };
  });
  return {
    slots,
    guns: [...totals].filter(([id]) => isWeapon(id) && id !== STARTER_WEAPON).map(([id, count]) => ({ id, count })),
    mods: [...totals].filter(([id]) => isMod(id)).map(([id, count]) => ({ id, count, socket: MODS[id].slot, fits: slots.filter((s) => canFitMod(p, s.index, id) === 'ok').map((s) => s.index) })),
    armoury: armoury(p).map((a) => ({ weapon: a.weapon, cls: a.class, level: a.level, classLevel: classLevel(p, a.class), unlocked: a.unlocked, price: a.price, affordable: p.dna >= a.price })),
  };
}
