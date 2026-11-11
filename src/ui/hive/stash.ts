/**
 * Stash & loadout (Larva spec): stash grid on the left, the host's translucent torso with its internal
 * cavity grid on the right, gut pouch below it, DNA balance top right, expand-stash and upgrade-pouch
 * buttons. Drag between grids; R or right-click rotates mid-drag; double-click quick-moves.
 */
import { def as itemOf } from '../items';
import { CLASSES } from '../../../data';
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../../render/palette';
import { glyph } from '../icons';
import { DragLayer, firstFit, GridView } from './grid';
import type { GridSource } from './grid';
import { cta, h, keyHints, panel } from './kit';
import { gridSize, itemsIn, usage, valueOf } from './model';
import type { GridZone, HiveActions, ProfileView } from './model';

/** Translucent torso the cavity grid sits inside: ribs part around it, organs glow at the edges. */
export function torsoSvg(): string {
  const ribs = [0, 1, 2, 3, 4].map((i) => {
    const y = 120 + i * 34;
    return `<path d="M200 ${y - 8} C150 ${y - 14} 96 ${y} 70 ${y + 34}" stroke="${HIVE.bone}" stroke-opacity=".5" stroke-width="${7 - i}" fill="none" stroke-linecap="round"/>
      <path d="M200 ${y - 8} C250 ${y - 14} 304 ${y} 330 ${y + 34}" stroke="${HIVE.bone}" stroke-opacity=".5" stroke-width="${7 - i}" fill="none" stroke-linecap="round"/>`;
  }).join('');
  return `<svg class="torso" viewBox="0 0 400 520" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <radialGradient id="tz" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="${HIVE.bone}" stop-opacity=".07"/><stop offset=".6" stop-color="${HIVE.panel}" stop-opacity=".5"/><stop offset="1" stop-color="${HIVE.background}" stop-opacity=".2"/></radialGradient>
      <radialGradient id="tor" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${ZONE7.magenta}"/><stop offset="1" stop-color="${ZONE7_SHADE.flesh}" stop-opacity=".2"/></radialGradient>
      <filter id="tg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path d="M200 6 C238 6 252 34 248 60 C262 66 300 70 336 84 C366 96 382 126 384 168 C388 250 360 330 330 380 C312 420 296 470 290 516 L110 516 C104 470 88 420 70 380 C40 330 12 250 16 168 C18 126 34 96 64 84 C100 70 138 66 152 60 C148 34 162 6 200 6Z"
      fill="url(#tz)" stroke="${HIVE.bone}" stroke-opacity=".35" stroke-width="1.5"/>
    <path d="M200 70 L200 500" stroke="${HIVE.bone}" stroke-opacity=".35" stroke-width="9" stroke-dasharray="14 6"/>
    ${ribs}
    <path d="M36 200 C30 250 40 300 60 340" stroke="${PATH.viral}" stroke-opacity=".6" stroke-width="3" fill="none" filter="url(#tg)"/>
    <path d="M364 200 C370 250 360 300 340 340" stroke="${PATH.viral}" stroke-opacity=".6" stroke-width="3" fill="none" filter="url(#tg)"/>
    <ellipse cx="52" cy="160" rx="18" ry="30" fill="url(#tor)" opacity=".55"/><ellipse cx="348" cy="160" rx="18" ry="30" fill="url(#tor)" opacity=".55"/>
    <ellipse cx="200" cy="450" rx="70" ry="30" fill="url(#tor)" opacity=".3"/>
    ${[[60, 120], [340, 120], [40, 260], [360, 260], [90, 400], [310, 400]].map(([x, y], i) => `<circle class="pustule" style="animation-delay:-${i * 0.6}s" cx="${x}" cy="${y}" r="5" fill="${HIVE.acid}" filter="url(#tg)"/>`).join('')}
  </svg>`;
}

const ZONE_LABEL: Record<GridZone, string> = { stash: 'STASH', cavity: 'INTERNAL CAVITIES', pouch: 'GUT POUCH' };

export function source(zone: GridZone, p: ProfileView): GridSource {
  return { zone, label: ZONE_LABEL[zone], size: gridSize(zone, p), items: itemsIn(zone, p) };
}

export interface StashCallbacks { actions: HiveActions; next(): void; changed(): void; notice(msg: string, tone?: string): void }

export function stashScreen(p: ProfileView, cb: StashCallbacks): HTMLElement & { dispose?: () => void } {
  const el = h('div', 'scr scr-stash') as HTMLElement & { dispose?: () => void };
  const left = panel('stash-panel', 'STASH CONTAINER', 'The Hive keeps it while you live');
  const right = panel('host-panel', 'HOST LOADOUT', CLASSES[p.host].label);
  el.append(left, right);

  const layer = new DragLayer(el, {
    drop: (from, to) => {
      const ok = cb.actions.move(from.zone as GridZone, from.index, to.zone as GridZone, to.x, to.y, to.rotated);
      if (!ok) cb.notice('DOES NOT FIT THERE', 'danger');
      cb.changed();
    },
    quick: (from, shift) => {
      const pl = itemsIn(from.zone as GridZone, p)[from.index];
      const order: GridZone[] = shift && from.zone !== 'pouch' ? ['pouch'] : from.zone === 'stash' ? ['cavity', 'pouch'] : ['stash'];
      for (const z of order) {
        const t = firstFit(source(z, p), pl.item, pl.rotated);
        if (t && cb.actions.move(from.zone as GridZone, from.index, z, t.x, t.y, t.rotated)) { cb.changed(); return; }
      }
      cb.notice(order[0] === 'pouch' ? 'GUT POUCH FULL' : from.zone === 'stash' ? 'CAVITIES FULL' : 'STASH FULL', 'danger');
    },
  });
  el.dispose = () => layer.dispose();

  const stashGrid = new GridView(source('stash', p), layer, 'stash');
  const [su, sc] = usage('stash', p);
  const rowCost = cb.actions.stashRowCost();
  left.insertAdjacentHTML('beforeend', `<div class="cap"><span>${su}/${sc} CELLS</span><span>VALUE <b>${valueOf(p.stash).toLocaleString('en-US')} DNA</b></span></div>`);
  left.append(stashGrid.el);
  const expand = h<HTMLButtonElement>('button', 'hv-btn', rowCost === null ? `${glyph('stash')}STASH AT MAX SIZE` : `${glyph('plus')}GROW STASH +1 ROW <b>${rowCost} DNA</b>`);
  expand.id = 'expand-stash';
  expand.disabled = rowCost === null || p.dna < rowCost;
  expand.addEventListener('click', () => { if (cb.actions.expandStash()) cb.changed(); else cb.notice('NOT ENOUGH DNA', 'danger'); });
  left.append(expand);

  const cav = new GridView(source('cavity', p), layer, 'cavity');
  const pouch = new GridView(source('pouch', p), layer, 'pouch');
  const [cu, cc] = usage('cavity', p);
  const up = cb.actions.pouchUpgrade();
  const body = h('div', 'torso-wrap', torsoSvg());
  const cavBox = h('div', 'cavity-box', `<label>INTERNAL CAVITIES <span>${cu}/${cc}</span></label>`);
  cavBox.append(cav.el);
  const pouchBox = h('div', 'pouch-box', `<label>GUT POUCH <span>SURVIVES DEATH</span></label>`);
  pouchBox.append(pouch.el);
  body.append(cavBox, pouchBox);
  right.append(body);
  const upgrade = h<HTMLButtonElement>('button', 'hv-btn', up ? `${glyph('plus')}GROW GUT POUCH ${up.size[0]}×${up.size[1]} <b>${up.cost} DNA</b>` : `${glyph('stash')}GUT POUCH AT MAX`);
  upgrade.id = 'upgrade-pouch';
  upgrade.disabled = !up || p.dna < up.cost;
  upgrade.addEventListener('click', () => { if (cb.actions.upgradePouch()) cb.changed(); else cb.notice('NOT ENOUGH DNA', 'danger'); });
  right.insertAdjacentHTML('beforeend', `<div class="carry"><span>CARRYING IN</span><b>${valueOf(p.cavity).toLocaleString('en-US')} DNA</b><em>${glyph('warn')} lost if the host dies</em></div>`);
  right.append(upgrade);

  const kinds = new Set(p.stash.map((s) => itemOf(s.item)?.kind));
  el.insertAdjacentHTML('beforeend', `<div class="legend-kinds">${(['consumable', 'currency', 'mutagen', 'virus', 'tech', 'organ'] as const).filter((k) => kinds.has(k) || k === 'organ' || k === 'virus').map((k) => `<span class="k-${k}"><i></i>${k}</span>`).join('')}</div>`);
  const go = cta('CHOOSE DROP ZONE', 'NEXT: RAID SELECT');
  el.append(go, keyHints([['DRAG', 'MOVE'], ['R / RMB', 'ROTATE WHILE DRAGGING'], ['DBL-CLICK', 'QUICK MOVE'], ['SHIFT+DBL', 'TO GUT POUCH'], ['ESC', 'BACK']]));
  go.addEventListener('click', () => cb.next());
  return el;
}
