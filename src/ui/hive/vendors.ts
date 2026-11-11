/**
 * Hive vendors (data/vendors.json, docs/gdd/07): Mother Clot and the Archivist, a menu rather than a town.
 * Left: the vendor, its reputation and what each level unlocks. Centre: stock gated by reputation, then its contract
 * chain. Right: sell from the stash at this vendor's rates. A switcher row on top also leads to the Gullet Broker.
 * Pure view over ProfileView + HiveActions; Gameplay's economy.ts owns prices, reputation and contract rules.
 */
import { BOSSES, ZONES } from '../../../data';
import { HIVE, ORGANIC, PATH, ZONE7, ZONE7_SHADE } from '../../render/palette';
import { glyph } from '../icons';
import { def, label } from '../items';
import { cta, esc, h, keyHints, panel } from './kit';
import type { ContractView, HiveActions, ProfileView, VendorBuyState, VendorView } from './model';
import { tile } from './screens';

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const WHY: Record<Exclude<VendorBuyState, 'ok'>, string> = { 'not-stocked': 'SOLD OUT', rep: 'REP', dna: 'NEED DNA', space: 'STASH FULL' };
const ROLE: Record<string, string> = { motherClot: 'Healer and midwife', archivist: 'Tech, intel and access', gulletBroker: 'Black market' };

let uid = 0;

/** Mother Clot: a heavy, kindly organism in a nest of warm membrane, umbilical arms offering a vial, a crèche of pods. viewBox 220 x 320. */
export function motherClotSvg(): string {
  const u = `mc${uid++}`;
  const pod = (x: number, y: number, r: number) => `<g><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.25}" fill="url(#pd${u})" stroke="${HIVE.bone}" stroke-opacity=".35"/>
    <path d="M${x - r * 0.35} ${y + r * 0.2} c${r * 0.2} ${-r * 0.6} ${r * 0.6} ${-r * 0.6} ${r * 0.7} 0" stroke="${ORGANIC.wetFleshDeep}" stroke-width="2" fill="none" opacity=".7"/></g>`;
  const sac = (x: number, y: number, r: number) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.85}" fill="url(#sc${u})"/><circle cx="${x + r * 0.15}" cy="${y + r * 0.35}" r="${r * 0.14}" fill="${ORGANIC.vein}" opacity=".6"/>`;
  return `<svg class="vendor-art" viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <radialGradient id="bd${u}" cx="45%" cy="38%" r="70%"><stop offset="0" stop-color="${ORGANIC.wetFlesh}"/><stop offset=".65" stop-color="${ORGANIC.wetFleshDeep}"/><stop offset="1" stop-color="${ZONE7_SHADE.rockDeep}"/></radialGradient>
      <radialGradient id="sc${u}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="${HIVE.bone}" stop-opacity=".85"/><stop offset=".7" stop-color="${ORGANIC.wetFlesh}"/><stop offset="1" stop-color="${ORGANIC.wetFleshDeep}"/></radialGradient>
      <radialGradient id="pd${u}" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="${PATH.melee}" stop-opacity=".35"/><stop offset=".6" stop-color="${ORGANIC.amber}" stop-opacity=".25"/><stop offset="1" stop-color="${ORGANIC.wetFleshDeep}" stop-opacity=".9"/></radialGradient>
      <linearGradient id="cd${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ORGANIC.vein}"/><stop offset="1" stop-color="${ORGANIC.wetFlesh}"/></linearGradient>
      <radialGradient id="wm${u}" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="${ORGANIC.amber}" stop-opacity=".22"/><stop offset="1" stop-color="${ORGANIC.amber}" stop-opacity="0"/></radialGradient>
      <filter id="wt${u}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".04 .07" numOctaves="3" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4"/></filter>
    </defs>
    <ellipse cx="110" cy="190" rx="105" ry="120" fill="url(#wm${u})"/>
    <path d="M6 320 C10 250 30 210 58 196 C40 160 46 120 70 96 C64 70 80 40 110 36 C140 40 156 70 150 96 C174 120 180 160 162 196 C190 210 210 250 214 320Z" fill="${ORGANIC.wetFleshDeep}" opacity=".55" filter="url(#wt${u})"/>
    ${[[-70, 40], [-40, 18], [40, 18], [70, 40]].map(([dx, dy]) => `<path d="M${110 + dx} ${300 - dy} C${110 + dx * 1.2} ${230 - dy} ${110 + dx * 0.8} ${170 - dy} ${110 + dx * 0.5} ${120}" stroke="${HIVE.bone}" stroke-opacity=".18" stroke-width="2" fill="none"/>`).join('')}
    <path d="M44 300 C40 236 56 168 84 138 C78 112 90 88 110 86 C130 88 142 112 136 138 C164 168 180 236 176 300Z" fill="${ORGANIC.wetFleshDeep}" opacity=".7" filter="url(#wt${u})"/>
    <g filter="url(#wt${u})">
      <path d="M56 300 C50 250 62 196 88 170 C96 160 102 150 110 150 C118 150 124 160 132 170 C158 196 170 250 164 300Z" fill="url(#bd${u})" stroke="${HIVE.bone}" stroke-opacity=".25" stroke-width="1.5"/>
      ${sac(96, 214, 11)}${sac(124, 214, 11)}${sac(88, 244, 10)}${sac(132, 244, 10)}${sac(110, 262, 9)}
      ${[[78, 196, 70, 280], [142, 196, 150, 280], [110, 176, 110, 230]].map(([x1, y1, x2, y2]) => `<path d="M${x1} ${y1} Q${(x1 + x2) / 2 + 6} ${(y1 + y2) / 2} ${x2} ${y2}" stroke="${ORGANIC.vein}" stroke-width="1.2" fill="none" opacity=".7"/>`).join('')}
    </g>
    <path d="M84 138 C80 114 92 96 110 96 C128 96 140 114 136 138 C126 130 118 128 110 128 C102 128 94 130 84 138Z" fill="${ORGANIC.wetFleshDeep}" stroke="${HIVE.bone}" stroke-opacity=".3"/>
    <ellipse cx="110" cy="132" rx="15" ry="17" fill="url(#sc${u})"/>
    <path d="M101 132 q4 3 8 0 M111 132 q4 3 8 0" stroke="${ORGANIC.wetFleshDeep}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M105 141 q5 3 10 0" stroke="${ORGANIC.vein}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M88 168 C64 176 44 196 40 222 C38 242 48 256 64 262" stroke="url(#cd${u})" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M132 168 C160 172 184 190 186 212 C188 228 178 238 166 240" stroke="url(#cd${u})" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M88 168 C64 176 44 196 40 222 C38 242 48 256 64 262 M132 168 C160 172 184 190 186 212 C188 228 178 238 166 240" stroke="${HIVE.bone}" stroke-opacity=".25" stroke-width="1" stroke-dasharray="2 5" fill="none"/>
    <g transform="translate(162 228) rotate(-18)"><rect x="-5" y="-16" width="10" height="24" rx="4" fill="${ZONE7_SHADE.rockDeep}" stroke="${HIVE.bone}" stroke-opacity=".7"/><rect x="-3.5" y="-6" width="7" height="12" rx="3" fill="${HIVE.danger}" opacity=".75"/></g>
    ${pod(30, 292, 13)}${pod(62, 304, 10)}${pod(190, 290, 14)}${pod(160, 306, 9)}
    ${[0, 1, 2].map((i) => `<path d="M${146 + i * 8} ${118 - i * 6} q6 -4 0 -8 q-6 -4 0 -8" stroke="${HIVE.bone}" stroke-opacity="${0.35 - i * 0.1}" stroke-width="1.2" fill="none"/>`).join('')}
  </svg>`;
}

/** The Archivist: a blind cephalopod in a tank of milky memory, arms wrapped around glass data-spines. viewBox 220 x 320. */
export function archivistSvg(): string {
  const u = `ar${uid++}`;
  const arm = (x0: number, y0: number, c1: string, end: string, w: number) => `<path d="M${x0} ${y0} C${c1} ${end}" stroke="url(#am${u})" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
  const spine = (x: number, y: number, hgt: number) => `<rect x="${x - 2}" y="${y}" width="4" height="${hgt}" rx="2" fill="${HIVE.bone}" fill-opacity=".22" stroke="${HIVE.bone}" stroke-opacity=".55" stroke-width=".8"/><rect x="${x - 0.6}" y="${y + 4}" width="1.2" height="${hgt * 0.4}" fill="${ZONE7.cyan}" opacity=".45"/>`;
  return `<svg class="vendor-art" viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="mk${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ORGANIC.mist}" stop-opacity=".45"/><stop offset=".6" stop-color="${HIVE.bone}" stop-opacity=".18"/><stop offset="1" stop-color="${ORGANIC.mist}" stop-opacity=".35"/></linearGradient>
      <radialGradient id="mn${u}" cx="45%" cy="35%" r="70%"><stop offset="0" stop-color="${HIVE.bone}" stop-opacity=".9"/><stop offset=".55" stop-color="${ORGANIC.mist}"/><stop offset="1" stop-color="${ORGANIC.wetFleshDeep}"/></radialGradient>
      <linearGradient id="am${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ORGANIC.mist}"/><stop offset="1" stop-color="${ORGANIC.wetFlesh}"/></linearGradient>
      <filter id="wt${u}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".02 .05" numOctaves="2" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="6"/></filter>
    </defs>
    <path d="M24 300 L24 70 C24 30 60 12 110 12 C160 12 196 30 196 70 L196 300Z" fill="url(#mk${u})" stroke="${HIVE.bone}" stroke-opacity=".45" stroke-width="2"/>
    <path d="M34 80 C34 44 64 26 100 24" stroke="${HIVE.bone}" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${spine(52, 150, 120)}${spine(72, 120, 150)}${spine(150, 128, 142)}${spine(170, 160, 110)}${spine(96, 200, 80)}${spine(126, 196, 86)}
    <g filter="url(#wt${u})">
      ${arm(96, 132, '70 150 50 180', '56 230', 7)}${arm(104, 136, '86 170 70 200', '76 250', 6)}${arm(124, 136, '146 170 156 200', '150 246', 6)}${arm(130, 132, '160 150 176 186', '170 226', 7)}
      ${arm(108, 140, '100 190 92 230', '98 280', 5)}${arm(116, 140, '124 190 132 230', '126 282', 5)}
      <path d="M70 110 C66 64 86 40 112 40 C138 40 156 64 152 110 C148 134 132 144 112 144 C92 144 74 134 70 110Z" fill="url(#mn${u})" stroke="${HIVE.bone}" stroke-opacity=".4"/>
    </g>
    <path d="M92 104 q8 6 16 0 M116 104 q8 6 16 0" stroke="${ORGANIC.wetFleshDeep}" stroke-opacity=".5" stroke-width="1.4" fill="none"/>
    <path d="M84 76 q10 -6 22 -2 M120 70 q10 2 16 10" stroke="${HIVE.bone}" stroke-opacity=".4" stroke-width="1" fill="none"/>
    ${[[60, 60, 3], [170, 90, 2.4], [150, 40, 2], [44, 230, 2.6], [182, 250, 2], [120, 22, 1.6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${HIVE.bone}" stroke-opacity=".45"/>`).join('')}
    <rect x="16" y="296" width="188" height="20" rx="4" fill="${ZONE7_SHADE.rockDeep}" stroke="${HIVE.bone}" stroke-opacity=".35"/>
    ${[40, 80, 120, 160].map((x) => `<rect x="${x}" y="303" width="18" height="5" rx="2" fill="${ORGANIC.amber}" opacity=".45"/>`).join('')}
  </svg>`;
}

const PORTRAIT: Record<string, () => string> = { motherClot: motherClotSvg, archivist: archivistSvg };

/** Plain-words objective line for contracts.json objective types. */
export function objectiveText(o: { type: string; item?: string; creature?: string; count?: number; landmark?: string; boss?: string; container?: string; zone?: string }): string {
  const n = o.count ?? 1;
  const many = (s: string) => (n > 1 ? `${n} × ${s}` : s);
  const place = (id?: string) => (id ? id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) : 'the site');
  switch (o.type) {
    case 'harvest': return `Harvest ${many(label(o.item ?? ''))}`;
    case 'kill': return `Kill ${many(place(o.creature))}`;
    case 'extractWith': return `Extract carrying ${many(label(o.item ?? ''))}`;
    case 'visit': return `Reach ${place(o.landmark)}`;
    case 'open': return `Open ${many(label(o.container ?? '') === o.container ? place(o.container) : label(o.container ?? ''))}`;
    case 'killBoss': return `Kill ${BOSSES[o.boss ?? '']?.label ?? place(o.boss)}`;
    case 'killRival': return `Kill ${n} rival host${n > 1 ? 's' : ''}`;
    case 'surviveRaid': return `Survive a raid in ${ZONES[o.zone ?? '']?.label ?? place(o.zone)}`;
    case 'place': return `Place ${label(o.item ?? '')} at ${place(o.landmark)}`;
    default: return o.type;
  }
}

export interface VendorCallbacks { actions: HiveActions; changed(): void; notice(msg: string, tone?: string): void; next(): void; market(): void; pick(id: string): void }

/** Vendor switcher shared by the vendor and Flesh Market screens. */
export function vendorRow(vendors: { id: string; label: string }[], current: string, pick: (id: string) => void, broker: (() => void) | null): HTMLElement {
  const row = h('div', 'vd-row');
  const all = [...vendors, ...(broker ? [{ id: 'gulletBroker', label: 'The Gullet Broker' }] : [])];
  for (const v of all) {
    const b = h<HTMLButtonElement>('button', `vd-pick${v.id === current ? ' on' : ''}`, `<b>${esc(v.label.toUpperCase())}</b><small>${esc(ROLE[v.id] ?? '')}</small>`);
    b.dataset.vendor = v.id;
    b.addEventListener('click', () => (v.id === 'gulletBroker' ? broker?.() : pick(v.id)));
    row.append(b);
  }
  return row;
}

/** What the last action changed, so the rebuilt screen can answer it: the card bought from, the contract taken, the DNA paid. */
let flash: { buy?: string; accept?: string; paid?: number } = {};

function contractCard(c: ContractView, vendor: VendorView, cb: VendorCallbacks, busy: boolean): HTMLElement {
  const el = h('div', `vd-contract ${c.state}${flash.accept === c.id ? ' accepted' : ''}`);
  const reward = [c.reward.dna ? `${c.reward.dna} DNA` : '', c.reward.rep ? `+${c.reward.rep} REP` : '', ...c.reward.items.map((i) => `${i.count > 1 ? `${i.count}× ` : ''}${label(i.item)}`)].filter(Boolean).join(' · ');
  const tag = { active: 'ACTIVE', available: 'OFFERED', done: 'DONE', locked: 'LOCKED', coming: 'LATER' }[c.state];
  el.innerHTML = `<header><b>${esc(c.title)}</b><em>${tag}</em></header>
    <p>${esc(c.brief)}</p>
    <ul>${c.objectives.map((o) => `<li class="${o.done >= o.need ? 'met' : ''}"><span>${esc(o.text)}</span><i>${Math.min(o.done, o.need)}/${o.need}</i></li>`).join('')}</ul>
    <footer><span>${glyph('dna')}${esc(reward)}${c.reward.unlock ? ` · <b>UNLOCKS ${esc(c.reward.unlock.replace(/^zone:/, '').replace(/([A-Z])/g, ' $1').toUpperCase())}</b>` : ''}</span></footer>
    ${c.state === 'locked' && c.requires.length ? `<small class="req">${glyph('lock')}After ${esc(c.requires.join(', '))}</small>` : ''}`;
  if (c.state === 'available' || c.state === 'active') {
    const b = h<HTMLButtonElement>('button', `hv-btn ${c.state === 'active' ? 'abandon' : 'accept'}`, c.state === 'active' ? 'ABANDON' : busy ? 'ONE AT A TIME' : 'ACCEPT');
    b.dataset.contract = c.id;
    b.disabled = c.state === 'available' && busy;
    b.addEventListener('click', () => {
      if (c.state === 'active') { if (cb.actions.abandonContract?.(vendor.id)) { cb.notice(`ABANDONED ${c.title.toUpperCase()}`, 'danger'); cb.changed(); } return; }
      if (cb.actions.acceptContract?.(c.id)) { flash = { accept: c.id }; cb.notice(`CONTRACT TAKEN · ${c.title.toUpperCase()} · PROGRESS COUNTS ON EXTRACT`, 'good'); cb.changed(); }
      else cb.notice('FINISH OR ABANDON THE ACTIVE CONTRACT FIRST', 'danger');
    });
    el.querySelector('footer')!.append(b);
  }
  return el;
}

export function vendorScreen(p: ProfileView, current: string, cb: VendorCallbacks): HTMLElement {
  const el = h('div', 'scr scr-market scr-vendor');
  const all = cb.actions.vendors?.() ?? [];
  const v = all.find((x) => x.id === current) ?? all[0];
  if (!v) { el.append(panel('mk-closed', 'THE VENDORS ARE DORMANT', 'They wake with the Larva economy.')); return el; }
  el.append(vendorRow(all, v.id, cb.pick, cb.actions.market ? cb.market : null));

  // Left: who they are, reputation, what each level gives.
  const left = panel('mk-vendor vd-vendor', v.label.toUpperCase(), `${ROLE[v.id] ?? v.role} · grown into the Hive`);
  const span = v.rep.next === null ? 1 : (v.rep.points - v.rep.floor) / Math.max(1, v.rep.next - v.rep.floor);
  left.insertAdjacentHTML('beforeend', `<div class="mk-portrait">${(PORTRAIT[v.id] ?? motherClotSvg)()}</div>
    <div class="vd-rep"><span>REPUTATION</span><b>${ROMAN[v.rep.level] ?? v.rep.level}</b><i style="--v:${(Math.max(0, Math.min(1, span)) * 100).toFixed(1)}%"></i>
      <small>${v.rep.next === null ? 'Highest standing' : `${v.rep.points} / ${v.rep.next} to ${ROMAN[v.rep.level + 1]}`} · 1 per 100 DNA traded, more from contracts</small></div>
    <ul class="vd-unlocks">${v.unlocks.map((u) => `<li class="${u.earned ? 'on' : ''}"><em>${ROMAN[u.rep]}</em><span>${esc(u.text)}</span></li>`).join('')}</ul>`);

  // Centre: stock, then the contract chain.
  const mid = panel('mk-stock vd-mid', 'STOCK', 'Better stock opens with reputation');
  const grid = h('div', 'mk-cards');
  for (const s of v.stock) {
    const d = def(s.item);
    const card = h('div', `mk-card${s.state === 'ok' ? '' : ' off'}${flash.buy === s.item ? ' bought' : ''}`, `${tile(s.item, 1)}
      <div class="mk-name"><b>${esc(d?.label ?? s.item)}</b><small>${esc(d?.kind ?? '')} · REP ${ROMAN[s.rep]}</small></div>
      <div class="mk-price">${glyph('dna')}<b>${s.price.toLocaleString('en-US')}</b></div>`);
    const buy = h<HTMLButtonElement>('button', 'hv-btn mk-buy', s.state === 'ok' ? 'BUY' : s.state === 'rep' ? `REP ${ROMAN[s.rep]}` : WHY[s.state]);
    buy.dataset.buy = s.item;
    buy.disabled = s.state !== 'ok';
    buy.addEventListener('click', () => {
      if (cb.actions.vendorBuy?.(v.id, s.item)) { flash = { buy: s.item }; cb.notice(`BOUGHT ${(d?.label ?? s.item).toUpperCase()} · IN YOUR STASH`, 'good'); cb.changed(); }
      else cb.notice(`${v.label.toUpperCase()} WILL NOT PART WITH IT`, 'danger');
    });
    card.append(buy);
    grid.append(card);
  }
  mid.append(grid);
  const busy = v.contracts.some((c) => c.state === 'active');
  const shown = v.contracts.filter((c) => c.state !== 'coming');
  mid.insertAdjacentHTML('beforeend', `<h3 class="vd-h">CONTRACTS <small>${shown.filter((c) => c.state === 'done').length}/${shown.length} done · progress counts only when you extract</small></h3>`);
  const list = h('div', 'vd-contracts');
  // Active first, then offered, then what comes after, then finished.
  const order: Record<string, number> = { active: 0, available: 1, locked: 2, done: 3, coming: 4 };
  for (const c of [...shown].sort((a, b) => order[a.state] - order[b.state])) list.append(contractCard(c, v, cb, busy));
  if (!shown.length) list.innerHTML = '<p class="none">No contracts yet.</p>';
  mid.append(list);

  // Right: sell from the stash at this vendor's rates.
  const right = panel('mk-sell', 'SELL FROM STASH', `${v.label} pays more for what it ${v.id === 'archivist' ? 'can read' : 'can use'}`);
  const ul = h('ul', 'mk-list');
  let total = 0;
  p.stash.forEach((st, i) => {
    const each = v.sellPrice(st.item);
    total += each * st.count;
    const li = h('li', '', `${tile(st.item, st.count, st.rotated)}<span>${esc(label(st.item))}</span><em>${each} each</em>`);
    const one = h<HTMLButtonElement>('button', 'hv-btn one', 'SELL 1');
    const all2 = h<HTMLButtonElement>('button', 'hv-btn all', `ALL · ${(each * st.count).toLocaleString('en-US')}`);
    one.dataset.sell = String(i); all2.dataset.sellAll = String(i);
    const sell = (n: number) => {
      const paid = cb.actions.vendorSell?.(v.id, 'stash', i, n) ?? 0;
      if (paid > 0) { flash = { paid }; cb.notice(`+${paid} DNA`, 'good'); cb.changed(); } else cb.notice('NOTHING SOLD', 'danger');
    };
    one.addEventListener('click', () => sell(1));
    all2.addEventListener('click', () => sell(st.count));
    li.append(one, all2);
    ul.append(li);
  });
  if (!p.stash.length) ul.innerHTML = '<li class="none">Your stash is empty</li>';
  right.append(ul);
  right.insertAdjacentHTML('beforeend', `<div class="cap"><span>STASH SELLS FOR</span><b>${total.toLocaleString('en-US')} DNA</b>${flash.paid ? `<i class="paid">+${flash.paid} DNA</i>` : ''}</div>`);
  flash = {};

  const go = cta('STASH & LOADOUT', 'NEXT: PACK YOUR CAVITIES');
  go.addEventListener('click', () => cb.next());
  el.append(left, mid, right, go, keyHints([['CLICK', 'BUY / SELL / ACCEPT'], ['TAB', 'NEXT VENDOR'], ['ESC', 'BACK']]));
  return el;
}

