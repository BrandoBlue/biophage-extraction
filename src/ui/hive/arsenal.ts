/**
 * WEAPONS (Gameplay #68): what the host carries into the raid. Left, the loadout: the innate starter and the weapon
 * slots, each with its numbers and graft sockets. Middle, the guns and grafts sitting in the stash, ready to equip or
 * graft. Right, the class Armoury: signature guns that grow for DNA once the class reaches their level.
 * Pure view over ArsenalView + HiveActions; Gameplay's arsenal.ts, mods.ts and progression.ts own the rules.
 */
import { CLASSES, MODS, type ClassId, type WeaponSpec } from '../../../data';
import { glyph } from '../icons';
import { label } from '../items';
import { cta, esc, h, keyHints, panel } from './kit';
import type { ArsenalView, HiveActions, LoadoutSlotView, ProfileView } from './model';
import { tile } from './screens';

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
export const slotName = (i: number) => (i === 0 ? 'Innate' : `Slot ${ROMAN[i] ?? i}`);
const words = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Sustained damage per second at a full magazine (bursts and charge-up included, reload excluded). */
export function specDps(w: WeaponSpec): number {
  const perShot = w.damage * w.pellets + (w.projectile.splash?.damage ?? 0);
  if (w.fireMode === 'burst') return (perShot * w.burstCount) / (w.burstCount / w.fireRate + w.burstDelay);
  if (w.fireMode === 'charge') return perShot / (w.chargeTime + 1 / w.fireRate);
  return perShot * w.fireRate;
}

/** The numbers a player compares, with the graft change against the bare gun (`better` says which way is good). */
export function statLines(spec: WeaponSpec, base: WeaponSpec = spec): { key: string; label: string; value: string; delta: number; better: boolean }[] {
  const rel = (a: number, b: number) => (b ? a / b - 1 : 0);
  const zoom = (s: WeaponSpec) => s.ads?.zoom ?? 1;
  const reload = (s: WeaponSpec) => (s.reload.style === 'perShell' ? s.reload.perShellTime * s.magazine : s.reload.time);
  return [
    { key: 'damage', label: 'Damage', value: `${Math.round(spec.damage)}${spec.pellets > 1 ? `×${spec.pellets}` : ''}`, delta: rel(spec.damage * spec.pellets, base.damage * base.pellets), better: true },
    { key: 'dps', label: 'Per second', value: `${Math.round(specDps(spec))}`, delta: rel(specDps(spec), specDps(base)), better: true },
    { key: 'rate', label: 'Rate', value: `${(spec.fireRate * 60).toFixed(0)}/min`, delta: rel(spec.fireRate, base.fireRate), better: true },
    { key: 'magazine', label: 'Magazine', value: spec.ammo === null && spec.reload.style === 'regrow' ? `${spec.magazine} · regrows` : `${spec.magazine}`, delta: rel(spec.magazine, base.magazine), better: true },
    { key: 'reload', label: spec.reload.style === 'perShell' ? 'Reload, full' : spec.reload.style === 'regrow' ? 'Regrow' : 'Reload', value: `${reload(spec).toFixed(1)} s`, delta: rel(reload(spec), reload(base)), better: false },
    { key: 'spread', label: 'Spread', value: `${spec.spread.hip.toFixed(1)}°`, delta: rel(spec.spread.hip, base.spread.hip), better: false },
    { key: 'range', label: 'Range', value: `${Math.round(spec.range.falloffEnd)} m`, delta: rel(spec.range.falloffEnd, base.range.falloffEnd), better: true },
    { key: 'zoom', label: spec.ads?.scope ? 'Scope' : 'Zoom', value: spec.ads ? `${zoom(spec).toFixed(1)}×` : 'none', delta: rel(zoom(spec), zoom(base)), better: true },
  ];
}

const deltaTag = (d: number, better: boolean) => {
  if (Math.abs(d) < 0.005) return '';
  const good = (d > 0) === better;
  return `<em class="${good ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}%</em>`;
};

const FEED: Record<string, string> = { magazine: 'Magazine', perShell: 'Shell by shell', regrow: 'Regrows itself' };

function slotCard(s: LoadoutSlotView, cb: { unequip(i: number): void; removeMod(i: number, socket: string): void }): HTMLElement {
  const c = h('article', `ar-slot${s.weapon ? '' : ' empty'}${s.starter ? ' starter' : ''}`);
  c.dataset.slot = String(s.index);
  if (!s.weapon || !s.spec) {
    c.innerHTML = `<header><span class="nm">${slotName(s.index)}</span></header><p class="hollow">Empty. Equip a gun from your stash and it rides into the raid here. Lose the raid and you lose the gun.</p>`;
    return c;
  }
  const w = s.spec;
  c.innerHTML = `<header><span class="nm">${slotName(s.index)}</span>${s.starter ? '<small>Never lost</small>' : '<small class="risk">Lost if the host dies</small>'}</header>
    <div class="who">${tile(s.weapon, 1)}<div><h3>${esc(w.label)}</h3><p>${esc(words(w.class))} · ${esc(w.rarity)} · ${esc(w.fireMode)} · ${esc(FEED[w.reload.style] ?? w.reload.style)}${w.ammo ? ` · feeds on ${esc(label(w.ammo))}` : ''}</p></div></div>
    <dl class="stats">${statLines(w, s.base ?? w).map((l) => `<div data-stat="${l.key}"><dt>${esc(l.label)}</dt><dd>${esc(l.value)}${deltaTag(l.delta, l.better)}</dd></div>`).join('')}</dl>
    <div class="sockets">${s.sockets.map((k) => `<button class="sock${k.mod ? ' full' : ''}" data-socket="${k.socket}" ${k.mod ? `title="Pull ${esc(label(k.mod))} back into the stash"` : 'disabled'}><span>${esc(words(k.socket))}</span><b>${k.mod ? esc(MODS[k.mod]?.label ?? label(k.mod)) : 'empty'}</b></button>`).join('') || '<i class="none">No graft sockets</i>'}</div>`;
  c.querySelectorAll<HTMLButtonElement>('.sock.full').forEach((b) => b.addEventListener('click', () => cb.removeMod(s.index, b.dataset.socket!)));
  if (!s.starter) {
    const un = h<HTMLButtonElement>('button', 'hv-btn unequip', `${glyph('stash')}Back to stash`);
    un.addEventListener('click', () => cb.unequip(s.index));
    c.append(un);
  }
  return c;
}

const GROW_WHY: Record<string, string> = { dna: 'NOT ENOUGH DNA', stashFull: 'NO ROOM IN THE STASH', locked: 'NOT UNLOCKED YET', unknown: 'UNKNOWN WEAPON' };
const FIT_WHY: Record<string, string> = { doesNotFit: 'IT DOES NOT FIT THAT GUN', notInStash: 'NOT IN THE STASH', noWeapon: 'NO GUN IN THAT SLOT', stashFull: 'NO ROOM FOR THE OLD GRAFT', noMod: 'UNKNOWN GRAFT' };

export function arsenalScreen(p: ProfileView, cb: { actions: HiveActions; changed(): void; notice(msg: string, tone?: string): void; next(): void }): HTMLElement {
  const el = h('div', 'scr scr-arms');
  const v: ArsenalView = cb.actions.arsenal?.() ?? { slots: [], guns: [], mods: [], armoury: [] };
  const a = cb.actions;
  const slotsOpen = v.slots.filter((s) => !s.starter);

  // Loadout.
  const load = panel('ar-load', 'Loadout', 'What the host carries in. Number keys switch guns in the raid.');
  const list = h('div', 'ar-slots');
  for (const s of v.slots) list.append(slotCard(s, {
    unequip: (i) => { if (a.unequipWeapon?.(i)) { cb.notice('BACK TO THE STASH', 'lime'); cb.changed(); } else cb.notice('NO ROOM IN THE STASH', 'danger'); },
    removeMod: (i, k) => { if (a.removeMod?.(i, k)) { cb.notice('GRAFT PULLED', 'lime'); cb.changed(); } else cb.notice('NO ROOM IN THE STASH', 'danger'); },
  }));
  load.append(list);

  // Stash: guns to equip, grafts to fit.
  const stash = panel('ar-stash', 'In your stash', 'Bought, found or grown');
  const empty = slotsOpen.find((s) => !s.weapon)?.index;
  stash.insertAdjacentHTML('beforeend', `<h3>GUNS</h3>`);
  const guns = h('ul', 'ar-list guns');
  for (const g of v.guns) {
    const li = h('li', '', `${tile(g.id, g.count)}<div class="txt"><b>${esc(label(g.id))}</b><span>${empty !== undefined ? `Equips to ${slotName(empty)}` : 'Swaps with the gun in a slot'}</span></div><div class="acts"></div>`);
    li.dataset.gun = g.id;
    for (const s of slotsOpen) {
      const b = h<HTMLButtonElement>('button', `hv-btn mini${s.index === (empty ?? slotsOpen[0]?.index) ? ' ready' : ''}`, ROMAN[s.index]);
      b.title = s.weapon ? `Swap with ${label(s.weapon)}` : `Equip to ${slotName(s.index).toLowerCase()}`;
      b.dataset.equip = String(s.index);
      b.addEventListener('click', () => { if (a.equipWeapon?.(s.index, g.id)) { cb.notice(`${label(g.id).toUpperCase()} EQUIPPED`, 'lime'); cb.changed(); } else cb.notice('NO ROOM IN THE STASH FOR THE OLD GUN', 'danger'); });
      li.querySelector('.acts')!.append(b);
    }
    guns.append(li);
  }
  if (!v.guns.length) guns.innerHTML = '<li class="none">No spare guns. Buy one from a vendor, grow one in the Armoury, or bring one home from a raid.</li>';
  stash.append(guns);
  stash.insertAdjacentHTML('beforeend', `<h3>GRAFTS</h3>`);
  const mods = h('ul', 'ar-list mods');
  for (const m of v.mods) {
    const li = h('li', '', `${tile(m.id, m.count)}<div class="txt"><b>${esc(MODS[m.id]?.label ?? label(m.id))}</b><span>${esc(words(m.socket))} socket${m.fits.length ? '' : ' · fits none of your guns'}</span></div><div class="acts"></div>`);
    li.dataset.mod = m.id;
    for (const i of m.fits) {
      const b = h<HTMLButtonElement>('button', 'hv-btn mini', i === 0 ? 'Innate' : ROMAN[i]);
      b.title = `Graft onto ${v.slots[i]?.weapon ? label(v.slots[i].weapon!) : slotName(i)}`;
      b.dataset.graft = String(i);
      b.addEventListener('click', () => { const r = a.fitMod?.(i, m.id) ?? 'noMod'; if (r === 'ok') { cb.notice('THE GRAFT TAKES', 'lime'); cb.changed(); } else cb.notice(FIT_WHY[r] ?? 'IT WILL NOT TAKE', 'danger'); });
      li.querySelector('.acts')!.append(b);
    }
    mods.append(li);
  }
  if (!v.mods.length) mods.innerHTML = '<li class="none">No grafts yet. Vendors and deep caches carry them.</li>';
  stash.append(mods);

  // Armoury.
  const arm = panel('ar-armoury', 'Armoury', 'Signature guns grow here as each host levels');
  const byClass = new Map<string, ArsenalView['armoury']>();
  for (const e of v.armoury) byClass.set(e.cls, [...(byClass.get(e.cls) ?? []), e]);
  for (const [cls, entries] of byClass) {
    const lvl = entries[0]?.classLevel ?? 0;
    arm.insertAdjacentHTML('beforeend', `<h3>${esc((CLASSES[cls as ClassId]?.label ?? cls).replace(/^The /, '').toUpperCase())}<small>level ${lvl}</small></h3>`);
    const ul = h('ul', 'ar-list arm');
    for (const e of entries) {
      const li = h('li', e.unlocked ? 'open' : 'locked', `${tile(e.weapon, 1)}<div class="txt"><b>${esc(label(e.weapon))}</b><span>${e.unlocked ? `${e.price.toLocaleString('en-US')} DNA a copy` : `Unlocks at level ${e.level}`}</span></div>`);
      li.dataset.armoury = e.weapon;
      const b = h<HTMLButtonElement>('button', `hv-btn mini${e.unlocked && e.affordable ? ' ready' : ''}`, e.unlocked ? `${glyph('plus')}Grow` : glyph('lock'));
      b.disabled = !e.unlocked || !e.affordable;
      if (e.unlocked && !e.affordable) b.title = 'Not enough DNA';
      b.addEventListener('click', () => { const r = a.growWeapon?.(e.weapon) ?? 'unknown'; if (r === 'ok') { cb.notice(`${label(e.weapon).toUpperCase()} GROWN INTO THE STASH`, 'lime'); cb.changed(); } else cb.notice(GROW_WHY[r] ?? 'IT WILL NOT GROW', 'danger'); });
      li.append(b);
      ul.append(li);
    }
    arm.append(ul);
  }

  const go = cta('RAID SELECT', 'NEXT: PICK YOUR DROP ZONE');
  go.addEventListener('click', () => cb.next());
  el.append(load, stash, arm, go, keyHints([['CLICK', 'EQUIP / GRAFT / GROW'], ['ENTER', 'RAID SELECT'], ['ESC', 'BACK']]));
  return el;
}
