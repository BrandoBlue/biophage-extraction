/**
 * The Hive Body (docs/gdd/07, data/hive.json): the base is an organism you grow by feeding it what you extract.
 * Left: the organs, each with its level, what it does now, and what the next level costs and adds. Right: the two
 * organs you tend between raids, the Spore Garden (DNA that fruits over real time) and the Gestation Vat (one
 * recipe growing at a time). Pure view over HiveBodyView + HiveActions; Gameplay's src/game/hive.ts owns the rules.
 */
import { RECIPES, type HiveOrganLevel } from '../../../data';
import { glyph } from '../icons';
import { label } from '../items';
import { cta, esc, h, keyHints, panel } from './kit';
import type { HiveActions, HiveBodyView, OrganState, OrganView, ProfileView, RecipeState } from './model';
import { tile } from './screens';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

const EFFECT_TEXT: Record<string, (v: unknown) => string> = {
  scannerShowsPodsAtStart: () => 'Your scanner shows bio-pods from the drop',
  scannerShowsBossState: () => 'Your scanner shows whether the boss is awake',
  raidSelectShowsAnomaly: () => 'Raid select shows the zone’s anomaly',
  toxinResistance: (v) => `Toxin resistance +${Math.round(Number(v) * 100)}%`,
  viralLoadStableBonus: (v) => `Viral load holds stable ${v} step${Number(v) === 1 ? '' : 's'} longer`,
};
const humanise = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

const outputLabel = (o: { item?: string; pool?: string[]; count: number }) =>
  `${o.count > 1 ? `${o.count}× ` : ''}${o.item ? label(o.item) : `a random strain (${(o.pool ?? []).map(label).join(', ')})`}`;

/** Plain lines for what an organ level does. Shared by the live adapter and the mocks. */
export function describeLevel(l: HiveOrganLevel | null | undefined): string[] {
  if (!l) return [];
  const out: string[] = [];
  if (l.dnaPerHour) out.push(`Fruits ${l.dnaPerHour} DNA an hour${l.cap ? `, holds up to ${l.cap}` : ''}`);
  if (l.recipes?.length) out.push(`Grows ${l.recipes.map((r) => (RECIPES[r] ? outputLabel({ ...RECIPES[r].output, count: 1 }) : r)).join(', ')}`);
  for (const [k, v] of Object.entries(l.effect ?? {})) out.push(EFFECT_TEXT[k]?.(v) ?? `${humanise(k)}${v === true ? '' : ` ${v}`}`);
  return out;
}

const GROW_WHY: Record<Exclude<OrganState, 'ok'>, string> = { max: 'Fully grown', coming: 'Arrives in a later build', locked: 'Locked', dna: 'Not enough DNA', items: 'Missing organs' };
const VAT_WHY: Record<Exclude<RecipeState, 'ok'>, string> = { 'no-vat': 'Grow the vat first', unknown: 'The vat cannot grow this yet', busy: 'The vat is busy', items: 'Missing inputs' };

const fmtTime = (s: number) => {
  const m = Math.ceil(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
};

/** Levels as small seeds: grown ones filled, the next one ringed. */
const seeds = (o: OrganView) => `<span class="bd-seeds">${Array.from({ length: o.max }, (_, i) => `<i class="${i < o.level ? 'on' : i === o.level ? 'nx' : ''}"></i>`).join('')}</span>`;

const costLine = (c: { item: string; count: number; have: number }) =>
  `<span class="bd-cost${c.have < c.count ? ' short' : ''}" title="${esc(label(c.item))}">${tile(c.item, 1)}<b>${Math.min(c.have, c.count)}/${c.count}</b></span>`;

function organCard(o: OrganView, cb: { grow(id: string): void }): HTMLElement {
  const c = h('div', `bd-organ st-${o.state}${o.level ? ' grown' : ''}`);
  c.dataset.organ = o.id;
  const now = o.now.length ? `<ul class="now">${o.now.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : `<p class="dormant">Not grown yet</p>`;
  const next = o.next ? `<div class="next"><span class="lab">${o.level ? `Level ${ROMAN[o.level + 1]} adds` : 'Growing it gives'}</span>
      <ul>${o.next.adds.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="costs"><span class="bd-cost dna${o.state === 'dna' ? ' short' : ''}">${glyph('dna')}<b>${o.next.dna.toLocaleString('en-US')}</b></span>${o.next.items.map(costLine).join('')}</div></div>` : '';
  c.innerHTML = `<header><h3>${esc(o.label)}</h3>${seeds(o)}</header><p class="brief">${esc(o.brief.charAt(0).toUpperCase() + o.brief.slice(1))}.</p>${now}${next}`;
  const b = h<HTMLButtonElement>('button', `hv-btn grow${o.state === 'ok' ? ' ready' : ''}`, o.state === 'ok' ? `${glyph('plus')}${o.level ? `Grow to level ${ROMAN[o.level + 1]}` : 'Grow it'}`
    : o.state === 'locked' && o.lockedBy ? `${glyph('lock')}Contract: ${esc(o.lockedBy)}` : esc(GROW_WHY[o.state as Exclude<OrganState, 'ok'>]));
  b.disabled = o.state !== 'ok';
  b.addEventListener('click', () => cb.grow(o.id));
  c.append(b);
  return c;
}

let grownFlash = '';

export function bodyScreen(_p: ProfileView, cb: { actions: HiveActions; changed(): void; notice(msg: string, tone?: string): void; next(): void }): HTMLElement {
  const el = h('div', 'scr scr-body');
  const v: HiveBodyView = cb.actions.hiveBody?.() ?? { organs: [], garden: null, vat: null };

  const organs = panel('bd-organs', 'Organs', 'Feed the Hive what you carry home and it grows');
  const grid = h('div', 'bd-grid');
  for (const o of v.organs) {
    const card = organCard(o, {
      grow: (id) => {
        if (cb.actions.growOrgan?.(id)) { grownFlash = id; cb.notice(`${o.label.toUpperCase()} GROWS`, 'lime'); cb.changed(); }
        else cb.notice('IT WILL NOT GROW YET', 'danger');
      },
    });
    if (grownFlash === o.id) card.classList.add('grew');
    grid.append(card);
  }
  grownFlash = '';
  organs.append(grid);

  const side = h('div', 'bd-side');
  // Spore Garden: a meter of fruiting DNA and a collect action.
  const garden = panel('bd-garden', 'Spore Garden', v.garden ? `${v.garden.perHour} DNA an hour` : 'Grow the garden to fruit DNA between raids');
  if (v.garden) {
    const f = v.garden.cap ? Math.min(1, v.garden.stored / v.garden.cap) : 0;
    garden.insertAdjacentHTML('beforeend', `<div class="bd-fruit"><b>${v.garden.stored}</b><span>/ ${v.garden.cap} DNA</span></div>
      <div class="bd-meter"><i style="width:${f * 100}%"></i></div>${f >= 1 ? '<p class="full">The garden is full and has stopped fruiting.</p>' : ''}`);
    const c = h<HTMLButtonElement>('button', 'hv-btn collect', `${glyph('dna')}Collect ${v.garden.stored} DNA`);
    c.disabled = v.garden.stored <= 0;
    c.addEventListener('click', () => { const n = cb.actions.collectGarden?.() ?? 0; if (n) { cb.notice(`+${n} DNA FROM THE GARDEN`, 'lime'); cb.changed(); } });
    garden.append(c);
  } else garden.classList.add('dormant');

  // Gestation Vat: the job growing (with a ring), then the recipes it knows.
  const vat = panel('bd-vat', 'Gestation Vat', v.vat ? 'One recipe grows at a time, even while you raid' : 'Grow the vat to turn organs into consumables');
  if (v.vat) {
    const j = v.vat.job;
    if (j) {
      const r = RECIPES[j.recipe];
      const f = j.total ? 1 - j.secondsLeft / j.total : 1;
      const job = h('div', `bd-job${j.ready ? ' ready' : ''}`, `<svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="42"/><circle class="val" cx="50" cy="50" r="42" style="stroke-dashoffset:${264 * (1 - f)}"/></svg>
        <div>${r?.output.item ? tile(r.output.item, r.output.count) : ''}</div><p><b>${esc(r ? outputLabel(r.output) : j.recipe)}</b><span>${j.ready ? 'Ready' : `${fmtTime(j.secondsLeft)} left`}</span></p>`);
      if (j.ready) {
        const c = h<HTMLButtonElement>('button', 'hv-btn collect ready', `${glyph('stash')}Take it out`);
        c.addEventListener('click', () => { const got = cb.actions.collectVat?.(); if (got) { cb.notice(`${label(got.item).toUpperCase()} TO THE STASH`, 'lime'); cb.changed(); } else cb.notice('NO ROOM IN THE STASH', 'danger'); });
        job.append(c);
      }
      vat.append(job);
    }
    const list = h('div', 'bd-recipes');
    for (const r of v.vat.recipes) {
      const row = h('div', `bd-recipe st-${r.state}`, `<div class="out">${r.output.item ? tile(r.output.item, r.output.count) : `<div class="tile pool">?</div>`}</div>
        <div class="txt"><b>${esc(outputLabel(r.output))}</b><span>${r.inputs.map(costLine).join('')}<em>${fmtTime(r.time)}</em></span></div>`);
      row.dataset.recipe = r.id;
      const b = h<HTMLButtonElement>('button', 'hv-btn', r.state === 'ok' ? 'Grow' : esc(VAT_WHY[r.state as Exclude<RecipeState, 'ok'>]));
      b.disabled = r.state !== 'ok';
      b.addEventListener('click', () => { if (cb.actions.startRecipe?.(r.id)) { cb.notice('THE VAT BEGINS TO GROW', 'lime'); cb.changed(); } });
      row.append(b);
      list.append(row);
    }
    vat.append(list);
  } else vat.classList.add('dormant');
  side.append(garden, vat);

  const go = cta('STASH & LOADOUT', 'NEXT: PACK YOUR CAVITIES');
  go.addEventListener('click', () => cb.next());
  el.append(organs, side, go, keyHints([['CLICK', 'GROW / COLLECT'], ['ESC', 'BACK']]));
  return el;
}
