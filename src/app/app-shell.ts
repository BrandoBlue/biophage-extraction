/**
 * The installable-app shell for the online build (Brandon, 2026-11-12: "an icon to click ... full screen borderless").
 * Chrome and Edge offer "Install" for a page with a web app manifest and a service worker; the installed game then
 * opens from a desktop / taskbar icon in its own window with no browser bars, and goes fullscreen on the first click.
 * This module is pure (no DOM): `scripts/stage-pages.mjs` writes the manifest and `scripts/app-icons.mjs` draws the
 * icon from it, and both are tested in tests/app-shell.test.ts. The game-side half lives in src/ui/install.ts.
 */
import { HIVE, ORGANIC, ZONE7_SHADE } from '../render/palette';

export const APP_NAME = 'BIOPHAGE: EXTRACTION';
export const APP_SHORT_NAME = 'BIOPHAGE';

/** Icon files the Pages site serves, relative to the site root. Drawn by scripts/app-icons.mjs into assets/app/. */
export const APP_ICONS = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'icon-maskable-512.png', size: 512, purpose: 'maskable' },
] as const;

export const MANIFEST_FILE = 'manifest.webmanifest';
export const SERVICE_WORKER_FILE = 'sw.js';

/**
 * The web app manifest. Every path is relative ('./') so it works under the GitHub Pages sub-path
 * (/biophage-extraction/) and on any other static host. `display_override` asks for fullscreen first; desktop
 * browsers that only do windowed apps fall back to `standalone` (no browser bars), and the game requests real
 * fullscreen on the first click (see src/ui/install.ts).
 */
export function buildManifest(): Record<string, unknown> {
  return {
    id: './',
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: 'A bio-cybernetic PvPvE extraction shooter. Loot, evolve, extract.',
    start_url: './',
    scope: './',
    display: 'standalone',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'landscape',
    background_color: HIVE.background,
    theme_color: HIVE.background,
    categories: ['games', 'entertainment'],
    icons: APP_ICONS.map((i) => ({ src: `icons/${i.file}`, sizes: `${i.size}x${i.size}`, type: 'image/png', purpose: i.purpose })),
  };
}

/**
 * The app icon: a living cell-eye. A wet, slightly lopsided membrane on the Hive's near-black, a bone iris ringed
 * with veins and an amber nucleus split by a vertical pupil. Lit and organic, not neon (Art Bible); the only glow is
 * a small wet highlight. `maskable` keeps the art inside the 80% safe circle and fills the whole square.
 */
export function appIconSvg(size: number, maskable = false): string {
  const s = maskable ? 0.74 : 0.92; // art scale inside the 512 design square
  const corner = maskable ? 0 : 112;
  const f = (v: number) => v.toFixed(1);
  // A lopsided membrane: eleven control points around the centre, each pushed in or out a little.
  const lobes = [1.0, 0.95, 1.03, 0.97, 1.04, 0.94, 1.01, 0.96, 1.05, 0.95, 0.99];
  const R = 205;
  const pts = lobes.map((k, i) => { const a = (i / lobes.length) * Math.PI * 2 - Math.PI / 2; return [Math.cos(a) * R * k, Math.sin(a) * R * k]; });
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M${mid(pts[pts.length - 1], pts[0]).map(f).join(' ')}`;
  for (let i = 0; i < pts.length; i++) { const m = mid(pts[i], pts[(i + 1) % pts.length]); d += ` Q${f(pts[i][0])} ${f(pts[i][1])} ${f(m[0])} ${f(m[1])}`; }
  d += 'Z';
  // Veins creep in from the membrane edge towards the iris, bending and thinning as they go.
  const veins = Array.from({ length: 13 }, (_, i) => {
    const a = (i / 13) * Math.PI * 2 + 0.2 * Math.sin(i * 2.3), bend = 0.25 * Math.sin(i * 1.7 + 1);
    const p = (r: number, off = 0) => `${f(Math.cos(a + off) * r)} ${f(Math.sin(a + off) * r)}`;
    const w = 3 + (i % 3);
    return `<path d="M${p(184)} Q${p(160, bend)} ${p(124, bend * 0.4)}" stroke-width="${w}"/>`
      + (i % 2 ? `<path d="M${p(165, bend * 0.9)} Q${p(150, bend * 1.9)} ${p(134, bend * 2.3)}" stroke-width="${w - 1.5}"/>` : '');
  }).join('');
  // Fibres of the iris, radiating from the nucleus.
  const fibres = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2, r1 = 70 + (i % 3) * 4;
    return `<path d="M${f(Math.cos(a) * 46)} ${f(Math.sin(a) * 46)} L${f(Math.cos(a + 0.05) * r1)} ${f(Math.sin(a + 0.05) * r1)}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="46%" r="72%"><stop offset="0" stop-color="${HIVE.panel}"/><stop offset="1" stop-color="${HIVE.background}"/></radialGradient>
    <radialGradient id="flesh" cx="40%" cy="34%" r="74%"><stop offset="0" stop-color="${ORGANIC.wetFlesh}"/><stop offset=".55" stop-color="${ORGANIC.vein}"/><stop offset="1" stop-color="${ORGANIC.wetFleshDeep}"/></radialGradient>
    <radialGradient id="socket" r="50%"><stop offset=".62" stop-color="${ORGANIC.wetFleshDeep}" stop-opacity="0"/><stop offset=".74" stop-color="${ORGANIC.wetFleshDeep}" stop-opacity=".9"/><stop offset="1" stop-color="${ORGANIC.wetFleshDeep}" stop-opacity="0"/></radialGradient>
    <radialGradient id="sclera" cx="44%" cy="38%" r="66%"><stop offset="0" stop-color="${HIVE.bone}"/><stop offset=".72" stop-color="${ORGANIC.mist}"/><stop offset="1" stop-color="${ZONE7_SHADE.flesh}"/></radialGradient>
    <radialGradient id="iris" cx="50%" cy="44%" r="58%"><stop offset="0" stop-color="${ORGANIC.amber}"/><stop offset=".8" stop-color="${ZONE7_SHADE.stem}"/><stop offset="1" stop-color="${ORGANIC.wetFleshDeep}"/></radialGradient>
    <radialGradient id="shine" cx="35%" cy="25%" r="50%"><stop offset="0" stop-color="${HIVE.bone}" stop-opacity=".35"/><stop offset="1" stop-color="${HIVE.bone}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="512" height="512" rx="${corner}" fill="url(#bg)"/>
  <g transform="translate(256 260) scale(${s})">
    <path d="${d}" fill="url(#flesh)"/>
    <path d="${d}" fill="url(#shine)"/>
    <g fill="none" stroke="${ORGANIC.wetFlesh}" stroke-linecap="round" opacity=".75">${veins}</g>
    <circle r="150" fill="url(#socket)"/>
    <circle r="114" fill="url(#sclera)"/>
    <circle r="76" fill="url(#iris)"/>
    <g stroke="${ORGANIC.amber}" stroke-width="2" opacity=".55">${fibres}</g>
    <path d="M0 -66 C17 -28 17 28 0 66 C-17 28 -17 -28 0 -66Z" fill="${HIVE.background}"/>
    <ellipse cx="-46" cy="-60" rx="24" ry="11" transform="rotate(-32 -46 -60)" fill="${HIVE.bone}" opacity=".6"/>
    <circle cx="28" cy="-34" r="4" fill="${HIVE.bone}" opacity=".7"/>
  </g>
</svg>`;
}
