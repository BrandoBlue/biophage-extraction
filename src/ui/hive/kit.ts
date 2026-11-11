/**
 * Hive register building blocks (Art Bible "UI language"): the screen frame with thorned vine corners,
 * top bar, currency strip and nav, the chamfered panel, the glowing bevelled CTA with its PvPvE warning,
 * and key hints. Screens compose these; colours come from CSS variables set by src/ui/theme.ts.
 */
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../../render/palette';
import { glyph } from '../icons';

export const h = <T extends HTMLElement = HTMLElement>(tag: string, cls = '', html = ''): T => {
  const e = document.createElement(tag) as T;
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
export const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Deterministic little PRNG so vines grow the same way every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Thorned vine growing out of a screen corner: a few tendrils with thorns and glowing pustules.
 * Drawn for the top-left corner in a 360 x 360 box; CSS mirrors it for the other three.
 */
export function vineCorner(seed: number): string {
  const r = rng(seed);
  let paths = '', thorns = '', pustules = '';
  const tendrils = 5;
  for (let t = 0; t < tendrils; t++) {
    // Each tendril leaves the corner along one of the two edges and curls inward.
    const alongTop = t % 2 === 0;
    const len = 150 + r() * 210;
    const wob = 18 + r() * 30;
    const off = 6 + r() * 26;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const s = i / 14, d = s * len, side = off + Math.sin(s * Math.PI * (1.2 + r() * 0.4) + t) * wob * s;
      pts.push(alongTop ? [d, side] : [side, d]);
    }
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const w = 7 - t * 1.0;
    paths += `<path d="${d}" stroke="url(#vg${seed})" stroke-width="${Math.max(1.6, w)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    paths += `<path d="${d}" stroke="${HIVE.bone}" stroke-opacity=".14" stroke-width="${Math.max(0.8, w * 0.3)}" fill="none" transform="translate(-1 -1)"/>`;
    for (let i = 2; i < pts.length - 1; i += 2) {
      const [x, y] = pts[i], [nx, ny] = pts[i + 1];
      const ang = Math.atan2(ny - y, nx - x) + (r() < 0.5 ? 1 : -1) * (0.9 + r() * 0.5);
      const tl = 6 + r() * 9;
      thorns += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} L${(x + Math.cos(ang) * tl).toFixed(1)} ${(y + Math.sin(ang) * tl).toFixed(1)} L${(x + Math.cos(ang + 0.5) * 3).toFixed(1)} ${(y + Math.sin(ang + 0.5) * 3).toFixed(1)}Z" fill="${HIVE.bone}" fill-opacity=".55"/>`;
      if (r() < 0.32) {
        const pr = 2.4 + r() * 4.2;
        const q = r(), col = q < 0.5 ? HIVE.bone : q < 0.8 ? PATH.viral : HIVE.acid;
        pustules += `<circle class="pustule" style="animation-delay:${(-r() * 4).toFixed(2)}s" cx="${(x + Math.cos(ang) * 4).toFixed(1)}" cy="${(y + Math.sin(ang) * 4).toFixed(1)}" r="${pr.toFixed(1)}" fill="${col}" filter="url(#vp${seed})"/>`;
      }
    }
  }
  return `<svg class="vine" viewBox="0 0 360 360" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="vg${seed}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ZONE7_SHADE.flesh}"/><stop offset=".5" stop-color="${HIVE.panel}"/><stop offset="1" stop-color="${HIVE.background}"/></linearGradient>
      <filter id="vp${seed}" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path d="M0 0 C60 8 110 4 170 0 L0 0 C8 60 4 110 0 170Z" fill="${ZONE7_SHADE.rockDeep}" opacity=".8"/>
    ${paths}${thorns}${pustules}
  </svg>`;
}

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

export const NAV: { id: string; label: string; sub?: string; locked?: string }[] = [
  { id: 'menu', label: 'MAIN MENU' },
  { id: 'host', label: 'HOST SELECT' },
  { id: 'stash', label: 'STASH & LOADOUT' },
  { id: 'raid', label: 'RAID SELECT', sub: 'Exclusion Zone' },
  { id: 'synapse', label: 'SYNAPSE & SKILLS', locked: 'HOST' },
  { id: 'lab', label: 'VIRAL LAB', locked: 'HOST' },
  { id: 'vendors', label: 'VENDORS', sub: 'Trade & contracts', locked: 'LARVA' },
  { id: 'hivemind', label: 'HIVE-MIND', sub: 'Multiplayer', locked: 'HIVE' },
];

/** The full-screen Hive frame. Returns the root and the content slot to fill. */
export function frame(o: FrameOpts): { root: HTMLElement; body: HTMLElement; nav: HTMLElement } {
  const root = h('div', 'hv-frame');
  root.innerHTML = `
    <div class="hv-backdrop"></div>
    <div class="hv-corner tl">${vineCorner(11)}</div><div class="hv-corner tr">${vineCorner(23)}</div>
    <div class="hv-corner bl">${vineCorner(37)}</div><div class="hv-corner br">${vineCorner(51)}</div>
    <header class="hv-top">
      <div class="hv-callsign">${esc(o.callsign)}</div>
      <div class="hv-currency">
        <span class="cur dna">${glyph('dna')}DNA <b data-bind="dna">${o.dna.toLocaleString('en-US')}</b></span>
        ${(o.extras ?? []).map((x) => `<span class="cur ${x.tone ?? ''}">${esc(x.label)} <b>${esc(x.value)}</b></span>`).join('')}
      </div>
      <div class="hv-brand">BIOPHAGE: EXTRACTION <i>${glyph('virus')}</i></div>
    </header>
    <nav class="hv-nav">${NAV.map((n) => (o.unlocked?.includes(n.id) ? { ...n, locked: undefined } : n)).map((n) => `<button class="tab${n.id === o.tab ? ' on' : ''}${n.locked ? ' locked' : ''}" data-tab="${n.id}" ${n.locked ? 'disabled' : ''}>
      ${n.label}${n.sub ? `<small>${n.sub}</small>` : ''}${n.locked ? `<em>${glyph('lock')}${n.locked}</em>` : ''}</button>`).join('')}</nav>
    <h1 class="hv-title"><span>${esc(o.title)}</span></h1>
    <main class="hv-body"></main>`;
  return { root, body: q(root, '.hv-body'), nav: q(root, '.hv-nav') };
}

export function panel(cls: string, title = '', sub = ''): HTMLElement {
  return h('section', `hv-panel ${cls}`, title ? `<h2>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h2>` : '');
}

/** Primary action: glowing bevelled green, bottom right, with the red PvPvE warning line. */
export function cta(label: string, warning: string, id?: string): HTMLButtonElement {
  const b = h<HTMLButtonElement>('button', 'hv-cta', `<span class="thorn l"></span><span class="lbl">${esc(label)}</span><small>${glyph('warn')}${esc(warning)}</small><span class="thorn r"></span>`);
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
