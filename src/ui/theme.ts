/**
 * UI theme: Art Bible fonts ("Membrane", see docs/ART_BIBLE.md) and the palette exposed as CSS custom properties.
 * Every UI stylesheet reads colours from these variables, so palette.ts stays the only source of colour.
 * Fonts are open-licence (SIL OFL 1.1, see assets/LICENSES.md) and bundled through Vite, never fetched.
 */
// Display: Cormorant Garamond, a high-contrast serif that reads as a naturalist's specimen plate rather than a
// military terminal. Labels and body: Manrope, a soft humanist sans.
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import { GRADE, HIVE, ORGANIC, PATH, ZONE7, ZONE7_SHADE } from '../render/palette';

export const CSS_VARS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(HIVE).map(([k, v]) => [`--${k}`, v])),
  ...Object.fromEntries(Object.entries(ZONE7).map(([k, v]) => [`--${k}`, v])),
  ...Object.fromEntries(Object.entries(PATH).map(([k, v]) => [`--path-${k}`, v])),
  ...Object.fromEntries(Object.entries(ZONE7_SHADE).map(([k, v]) => [`--shade-${k}`, v])),
  ...Object.fromEntries(Object.entries(GRADE).map(([k, v]) => [`--grade-${k}`, v])),
  // Lit, natural tones (Art Bible "Ethereal, not neon"): --wetFlesh, --amber, --mist ...
  ...Object.fromEntries(Object.entries(ORGANIC).map(([k, v]) => [`--${k}`, v])),
  // Type: --display for names, numbers and titles; --ui for labels and body.
  '--display': '"Cormorant Garamond", "Iowan Old Style", Georgia, serif',
  '--ui': '"Manrope", "Segoe UI", system-ui, sans-serif',
  // Legacy short names used by the Spore HUD stylesheet.
  '--bg': HIVE.background,
  '--viral': PATH.viral,
};

let applied = false;
export function applyTheme(root: HTMLElement = document.documentElement): void {
  if (applied && root === document.documentElement) return;
  applied = true;
  for (const [k, v] of Object.entries(CSS_VARS)) root.style.setProperty(k, v);
}
