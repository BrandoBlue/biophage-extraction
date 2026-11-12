// Draws the installable app's icons (src/app/app-shell.ts appIconSvg) into assets/app/*.png with headless Chromium.
// Code-generated, so no licence entry is needed. Re-run after changing the icon art: `node scripts/app-icons.mjs`.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { loadTs } from './load-ts.mjs';

const { APP_ICONS, appIconSvg } = await loadTs('src/app/app-shell.ts');
mkdirSync('assets/app', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const icon of APP_ICONS) {
  const svg = appIconSvg(icon.size, icon.purpose === 'maskable');
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: `assets/app/${icon.file}`, omitBackground: true });
  console.log(`app-icons: assets/app/${icon.file}`);
}
await browser.close();
