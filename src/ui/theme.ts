/**
 * UI theme: Art Bible fonts and the palette exposed as CSS custom properties.
 * Every UI stylesheet reads colours from these variables, so palette.ts stays the only source of colour.
 * Fonts are open-licence (SIL OFL 1.1, see assets/LICENSES.md) and bundled through Vite, never fetched.
 */
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-700.css';
import { GRADE, HIVE, PATH, ZONE7, ZONE7_SHADE } from '../render/palette';

export const CSS_VARS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(HIVE).map(([k, v]) => [`--${k}`, v])),
  ...Object.fromEntries(Object.entries(ZONE7).map(([k, v]) => [`--${k}`, v])),
  ...Object.fromEntries(Object.entries(PATH).map(([k, v]) => [`--path-${k}`, v])),
  ...Object.fromEntries(Object.entries(ZONE7_SHADE).map(([k, v]) => [`--shade-${k}`, v])),
  ...Object.fromEntries(Object.entries(GRADE).map(([k, v]) => [`--grade-${k}`, v])),
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
