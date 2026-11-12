/**
 * Hive building blocks in the UI department's "membrane" language: the screen frame (hairline header with the
 * currencies, a quiet text nav, the screen title in the display serif), glass panels, the primary action as a
 * soft amber capsule with its warning set beneath it, and key hints. Screens compose these; colours come from
 * CSS variables set by src/ui/theme.ts.
 */
import type { GraphicsLevel } from '../settings';
import { ZONE7 } from '../../render/palette';
import { glyph } from '../icons';

export const h = <T extends HTMLElement = HTMLElement>(tag: string, cls = '', html = ''): T => {
  const e = document.createElement(tag) as T;
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
export const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface FrameOpts {
  title: string;
  /** Lit nav tab id. */
  tab?: string;
  callsign: string;
  dna: number;
  extras?: { label: string; value: string; tone?: string }[];
  /** Nav tabs to open even though their milestone has not arrived (feature-detected screens). */
  unlocked?: string[];
}

/** `locked` is what the player reads on a shut tab: plain words, never a milestone codename. */
export const NAV: { id: string; label: string; sub?: string; locked?: string }[] = [
  { id: 'menu', label: 'MAIN MENU' },
  { id: 'host', label: 'HOST SELECT' },
  { id: 'stash', label: 'STASH & LOADOUT' },
  { id: 'arms', label: 'WEAPONS', sub: 'Slots, grafts, armoury', locked: 'SOON' },
  { id: 'raid', label: 'RAID SELECT', sub: 'Exclusion Zone' },
  { id: 'synapse', label: 'SYNAPSE & SKILLS', locked: 'NEXT UPDATE' },
  { id: 'lab', label: 'VIRAL LAB', locked: 'NEXT UPDATE' },
  { id: 'vendors', label: 'VENDORS', sub: 'Trade & contracts', locked: 'SOON' },
  { id: 'body', label: 'HIVE BODY', sub: 'Organs & vat', locked: 'SOON' },
  { id: 'hivemind', label: 'HIVE-MIND', sub: 'Multiplayer', locked: 'ONLINE BUILD' },
];

/** Tooltips for shut tabs. */
const LOCK_WHY: Record<string, string> = {
  synapse: 'The Synapse tree grows in the next update, with host levels',
  lab: 'The Viral Lab opens in the next update',
  hivemind: 'Online squads play on the online build',
};

/** The nav hangs along a soft vein: 0 at the middle tab, 1 at the ends (a parabola, like the vein's curve). */
export const sag = (i: number, n: number) => { const t = n < 2 ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2); return t * t; };

/** The full-screen Hive frame. Returns the root and the content slot to fill. */
export function frame(o: FrameOpts): { root: HTMLElement; body: HTMLElement; nav: HTMLElement } {
  const root = h('div', 'hv-frame');
  root.innerHTML = `
    <div class="hv-backdrop"></div>
    <header class="hv-top">
      <div class="hv-callsign">${esc(o.callsign)}</div>
      <div class="hv-currency">
        <span class="cur dna">${glyph('dna')}DNA <b data-bind="dna">${o.dna.toLocaleString('en-US')}</b></span>
        ${(o.extras ?? []).map((x) => `<span class="cur ${x.tone ?? ''}">${esc(x.label)} <b>${esc(x.value)}</b></span>`).join('')}
      </div>
      <div class="hv-brand">Biophage <small>EXTRACTION</small></div>
    </header>
    <nav class="hv-nav"><svg class="vein" viewBox="0 -0.2 100 1.4" preserveAspectRatio="none" aria-hidden="true"><path d="M0 1 Q50 -1 100 1"/></svg>${NAV.map((n) => (o.unlocked?.includes(n.id) ? { ...n, locked: undefined } : n)).map((n, i) => `<button class="tab${n.id === o.tab ? ' on' : ''}${n.locked ? ' locked' : ''}" data-tab="${n.id}" style="--d:${sag(i, NAV.length).toFixed(3)}" ${n.locked ? `disabled title="${esc(LOCK_WHY[n.id] ?? n.locked)}"` : ''}>
      ${n.label}${n.sub ? `<small>${n.sub}</small>` : ''}${n.locked ? `<em>${glyph('lock')}${n.locked}</em>` : ''}</button>`).join('')}</nav>
    <button class="hv-full" data-full title="Borderless fullscreen (F)">${glyph('expand')}</button>
    <h1 class="hv-title"><span>${esc(o.title)}</span></h1>
    <main class="hv-body"></main>`;
  return { root, body: q(root, '.hv-body'), nav: q(root, '.hv-nav') };
}

export function panel(cls: string, title = '', sub = ''): HTMLElement {
  return h('section', `hv-panel ${cls}`, title ? `<h2>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h2>` : '');
}

/** "ENTER EXCLUSION ZONE" -> "Enter exclusion zone": the capsule label reads as a sentence in the serif. */
export const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/\bhive\b/g, 'Hive');

/** Primary action: a soft amber capsule, bottom right, with an arrow that leans forward on hover and the warning beneath. */
export function cta(label: string, warning: string, id?: string): HTMLButtonElement {
  const b = h<HTMLButtonElement>('button', 'hv-cta', `<span class="lbl">${esc(sentence(label))}</span><span class="arrow">${glyph('play')}</span><small>${glyph('warn')}${esc(warning)}</small>`);
  if (id) b.id = id;
  return b;
}

export function keyHints(hints: [string, string][]): HTMLElement {
  return h('footer', 'hv-keys', hints.map(([k, v]) => `<span><kbd>[${esc(k)}]</kbd> ${esc(v)}</span>`).join(''));
}

/** Small stat meter row (class cards, tooltips). value 0..1. */
export function meter(label: string, icon: string, value: number, word: string, tone: 'good' | 'bad' | 'mid' = 'mid'): string {
  return `<div class="meter ${tone}">${glyph(icon)}<span class="ml">${esc(label)}</span><span class="mv">${esc(word)}</span><i style="--v:${Math.max(0, Math.min(1, value)).toFixed(3)}"></i></div>`;
}

export const ZONE_TONE = { lime: ZONE7.lime, cyan: ZONE7.cyan, magenta: ZONE7.magenta };

/** The graphics levels in a player's words (what each one gives up); Rendering's settings.ts owns the levels. */
export const GRAPHICS_WORDS: Record<GraphicsLevel, [string, string]> = {
  high: ['High', 'Every effect'],
  balanced: ['Balanced', 'No ambient shade'],
  performance: ['Performance', 'No shade or sun shadows'],
};
