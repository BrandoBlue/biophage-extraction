/**
 * Flesh Market (data/market.json): The Gullet Broker, a sessile vendor grown into the Hive wall.
 * Left: the broker and its mood. Centre: today's stock (rotates daily, same for everyone). Right: sell from the stash.
 * Pure view over ProfileView + HiveActions.market/sell/buy; Gameplay's profile.ts owns prices and rules.
 */
import { MARKET } from '../../../data';
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../../render/palette';
import { glyph } from '../icons';
import { def } from '../items';
import { cta, esc, h, keyHints, panel } from './kit';
import type { BuyState, HiveActions, MarketView, ProfileView } from './model';
import { tile } from './screens';

const WHY: Record<Exclude<BuyState, 'ok'>, string> = { 'not-stocked': 'SOLD OUT', dna: 'NOT ENOUGH DNA', space: 'STASH FULL' };
const MOOD_WORDS = ['SOURED', 'SULLEN', 'WARY', 'INDIFFERENT', 'CURIOUS', 'PLEASED', 'SATED'];

export const moodWord = (mood: number) => MOOD_WORDS[Math.max(0, Math.min(6, Math.round(mood + 3)))];
export const fmtRotate = (s: number) => `${Math.floor(s / 3600)}H ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}M`;

let uid = 0;
/** The broker: a translucent gullet column, a choir of small hands, an iris of lenses, a payment slit. viewBox 220 x 320. */
export function brokerSvg(mood = 0): string {
  const u = `gb${uid++}`;
  const lens = (a: number, r: number, s: number) => {
    const x = 110 + Math.cos(a) * r, y = 92 + Math.sin(a) * r;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s}" fill="${ZONE7_SHADE.rockDeep}" stroke="${HIVE.bone}" stroke-opacity=".6"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(s * 0.45).toFixed(1)}" fill="${ZONE7.cyan}" fill-opacity=".55"/>`;
  };
  const hand = (x: number, y: number, dir: number, k: number) => `<g transform="translate(${x} ${y}) scale(${dir} 1) rotate(${k})">
      <path d="M0 0 C10 -2 20 0 28 4" stroke="url(#sk${u})" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M28 4 l7 -5 M28 4 l9 -1 M28 4 l8 3 M28 4 l5 6" stroke="${HIVE.bone}" stroke-opacity=".8" stroke-width="1.6" stroke-linecap="round"/></g>`;
  const glow = mood >= 0 ? ZONE7.cyan : HIVE.danger;
  return `<svg class="broker" viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="gu${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ZONE7_SHADE.flesh}" stop-opacity=".85"/><stop offset=".5" stop-color="${HIVE.bone}" stop-opacity=".28"/><stop offset="1" stop-color="${ZONE7_SHADE.flesh}" stop-opacity=".85"/></linearGradient>
      <linearGradient id="sk${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ZONE7_SHADE.flesh}"/><stop offset="1" stop-color="${HIVE.bone}"/></linearGradient>
      <radialGradient id="in${u}" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="${glow}" stop-opacity=".35"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
      <filter id="wt${u}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency=".035 .09" numOctaves="3" seed="7" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="5"/>
      </filter>
    </defs>
    <path d="M30 0 C40 40 70 52 74 92 C78 128 50 160 46 214 C42 262 62 300 70 320 L150 320 C158 300 178 262 174 214 C170 160 142 128 146 92 C150 52 180 40 190 0Z" fill="url(#gu${u})" filter="url(#wt${u})"/>
    <path d="M30 0 C40 40 70 52 74 92 C78 128 50 160 46 214 C42 262 62 300 70 320 M190 0 C180 40 150 52 146 92 C142 128 170 160 174 214 C178 262 158 300 150 320" stroke="${HIVE.bone}" stroke-opacity=".3" stroke-width="2" fill="none"/>
    ${[-30, -14, 0, 14, 30].map((dx, i) => `<path d="M${110 + dx * 1.6} 0 C${110 + dx * 0.4} 90 ${110 + dx * 1.3} 170 ${110 + dx * 0.9} 320" stroke="${i % 2 ? ZONE7_SHADE.flesh : HIVE.danger}" stroke-opacity=".35" stroke-width="${1 + (i % 3)}" fill="none"/>`).join('')}
    ${[[96, 190, 9], [124, 214, 6], [104, 244, 7], [120, 172, 4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ZONE7_SHADE.rockDeep}" fill-opacity=".45"/>`).join('')}
    <ellipse cx="110" cy="200" rx="40" ry="70" fill="url(#in${u})"/>
    <g opacity=".85">${[[0, 0.62], [0.9, 0.5], [1.8, 0.55], [2.7, 0.6], [3.6, 0.52], [4.5, 0.58], [5.4, 0.5]].map(([a, s], i) => lens(a, 18 + (i % 2) * 6, 7 * s + 2)).join('')}${lens(0, 0, 9)}</g>
    ${hand(64, 150, -1, 10)}${hand(52, 186, -1, -12)}${hand(48, 226, -1, 18)}${hand(56, 262, -1, -6)}${hand(156, 156, 1, -8)}${hand(168, 196, 1, 14)}${hand(172, 236, 1, -16)}${hand(164, 270, 1, 6)}
    <path d="M92 270 C100 262 120 262 128 270 C120 276 100 276 92 270Z" fill="${ZONE7_SHADE.rockDeep}" stroke="${PATH.dna}" stroke-opacity=".7"/>
  </svg>`;
}

export interface MarketCallbacks { actions: HiveActions; changed(): void; notice(msg: string, tone?: string): void; next(): void }

export function marketScreen(p: ProfileView, cb: MarketCallbacks): HTMLElement {
  const el = h('div', 'scr scr-market');
  const m: MarketView | undefined = cb.actions.market?.();
  if (!m) {
    el.append(panel('mk-closed', 'THE GULLET BROKER IS DORMANT', 'The Flesh Market opens with the Host milestone.'));
    return el;
  }
  const v = MARKET.vendor;
  const left = panel('mk-vendor', v.label.toUpperCase(), 'Flesh Market · grown into the Hive wall');
  const pct = ((m.mood - MARKET.mood.min) / (MARKET.mood.max - MARKET.mood.min)) * 100;
  const likes = MARKET.mood.likes.join(', '), dislikes = MARKET.mood.dislikes.join(', ');
  left.insertAdjacentHTML('beforeend', `<div class="mk-portrait">${brokerSvg(m.mood)}</div>
    <div class="mk-mood"><span>MOOD</span><b>${moodWord(m.mood)}</b><i style="--v:${pct.toFixed(1)}%"></i></div>
    <p class="mk-quote">It craves ${esc(likes)} and is offended by ${esc(dislikes)}. Feed it what it wants and its prices soften.</p>`);

  const mid = panel('mk-stock', 'TODAY’S STOCK', `Rotates in ${fmtRotate(m.rotatesIn)} · the same for every host`);
  const grid = h('div', 'mk-cards');
  for (const s of m.stock) {
    const d = def(s.item);
    const card = h('div', `mk-card${s.state === 'ok' ? '' : ' off'}`, `${tile(s.item, 1)}
      <div class="mk-name"><b>${esc(d?.label ?? s.item)}</b><small>${esc(d?.kind ?? '')}${MARKET.contraband[s.item] ? ' · CONTRABAND' : ''}</small></div>
      <div class="mk-price">${glyph('dna')}<b>${s.price.toLocaleString('en-US')}</b></div>`);
    const buy = h<HTMLButtonElement>('button', 'hv-btn mk-buy', s.state === 'ok' ? 'BUY' : WHY[s.state]);
    buy.dataset.buy = s.item;
    buy.disabled = s.state !== 'ok';
    buy.addEventListener('click', () => {
      if (cb.actions.buy?.(s.item)) { cb.notice(`BOUGHT ${(d?.label ?? s.item).toUpperCase()} · IN YOUR STASH`, 'good'); cb.changed(); }
      else cb.notice('THE BROKER WILL NOT PART WITH IT', 'danger');
    });
    card.append(buy);
    grid.append(card);
  }
  mid.append(grid);

  const right = panel('mk-sell', 'SELL FROM STASH', `It pays ${Math.round(MARKET.buyRate * 100)}% of an item’s value`);
  const list = h('ul', 'mk-list');
  let total = 0;
  p.stash.forEach((st, i) => {
    const each = m.sellPrice(st.item);
    total += each * st.count;
    const li = h('li', '', `${tile(st.item, st.count, st.rotated)}<span>${esc(def(st.item)?.label ?? st.item)}</span><em>${each} each</em>`);
    const one = h<HTMLButtonElement>('button', 'hv-btn one', 'SELL 1');
    const all = h<HTMLButtonElement>('button', 'hv-btn all', `ALL · ${(each * st.count).toLocaleString('en-US')}`);
    one.dataset.sell = String(i); all.dataset.sellAll = String(i);
    const sell = (n: number) => {
      const paid = cb.actions.sell?.('stash', i, n) ?? 0;
      if (paid > 0) { cb.notice(`+${paid} DNA`, 'good'); cb.changed(); } else cb.notice('NOTHING SOLD', 'danger');
    };
    one.addEventListener('click', () => sell(1));
    all.addEventListener('click', () => sell(st.count));
    li.append(one, all);
    list.append(li);
  });
  if (!p.stash.length) list.innerHTML = '<li class="none">Your stash is empty</li>';
  right.append(list);
  right.insertAdjacentHTML('beforeend', `<div class="cap"><span>STASH SELLS FOR</span><b>${total.toLocaleString('en-US')} DNA</b></div>`);

  const go = cta('STASH & LOADOUT', 'NEXT: PACK YOUR CAVITIES');
  go.addEventListener('click', () => cb.next());
  el.append(left, mid, right, go, keyHints([['CLICK', 'BUY / SELL'], ['ESC', 'BACK']]));
  return el;
}
