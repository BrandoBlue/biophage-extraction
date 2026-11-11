// Player-view captures for visual review: the game as a player sees it, HUD and all, at the chosen quality tier.
// Run after `npm run build`: `npm run lookdev:player` (QUALITY=high by default, TAG suffixes the file names).
// Writes tests/out/player-*.png: Hive menu, raid spawn, a fight with each nearby Abomination kind, and the arm.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { freezeAndScreenshot } from './lib/harness.mjs';

const URL = `http://localhost:4175/?quality=${process.env.QUALITY || 'high'}`;
const TAG = process.env.TAG ?? '';
const only = process.argv[2];
const server = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
let browser;
const fail = async (msg) => { console.error(`PLAYERVIEW FAIL: ${msg}`); await browser?.close(); server.kill(); process.exit(1); };
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch('http://localhost:4175/')).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  mkdirSync('tests/out', { recursive: true });
  const frames = (n) => page.evaluate((k) => window.__biophage.frames + k, n).then((t) =>
    page.waitForFunction((x) => window.__biophage.frames >= x, t, { timeout: 180000 }));
  const call = (fn, ...args) => page.evaluate(([f, a]) => window.__biophage.debug[f](...a), [fn, args]);
  const state = () => page.evaluate(() => window.__biophage.state);
  const shot = async (name) => {
    if (only && only !== name) return;
    await freezeAndScreenshot(page, `tests/out/player-${name}${TAG}.png`, { resume: true });
    console.log(`player-${name}${TAG}.png`);
  };

  await page.goto(URL, { timeout: 120000 });
  await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 120000 });
  await frames(2);
  await shot('hive');
  // The Hive opens on its main menu; the deploy button lives on the raid tab (older builds show it directly).
  if (await page.$('#hive .tab[data-tab="raid"]')) {
    await page.click('#hive .tab[data-tab="stash"]'); await frames(1); await shot('stash');
    await page.click('#hive .tab[data-tab="raid"]'); await frames(1);
  }
  await page.click('#deploy');
  // A player clicks to take control, which clears the controls card; hide it rather than lock the pointer.
  await page.addStyleTag({ content: '#prompt{display:none!important}' });
  await frames(4);
  await shot('spawn');

  // A fight: stand off each kind's nearest living creature, aim at its centre and fire a few bursts.
  const s = await state();
  const kinds = [...new Set(s.enemies.map((e) => e.kind))];
  for (const kind of kinds) {
    const st = await state();
    const e = st.enemies.filter((x) => x.alive && x.kind === kind)[0];
    if (!e) continue;
    await call('teleport', e.position[0] + 5, e.position[2] + 5);
    await frames(2);
    const now = (await state()).enemies.find((x) => x.id === e.id);
    await call('aimAt', now.centre[0], now.centre[1], now.centre[2]);
    await frames(2);
    await shot(`look-${kind}`);
    await call('trigger', true);
    await frames(3);
    await shot(`fight-${kind}`);
    await call('trigger', false);
    await frames(1);
  }
  await call('clearAim');
  // First-person arm and weapon at rest, looking slightly down at the ground cover.
  await call('teleport', -41, 113);
  await frames(2);
  await call('aimAt', -45, 0.2, 105);
  await frames(3);
  await shot('arm');
  await call('clearAim');

  await browser.close();
  if (errors.length) await fail(errors.join('\n'));
  server.kill();
  process.exit(0);
} catch (e) { await fail(e.stack || e); }
