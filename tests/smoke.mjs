// Headless smoke test: serves the production build, boots the game, walks forward, saves a screenshot.
// Run with `npm run smoke` after `npm run build`.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
const fail = (msg) => { console.error(`SMOKE FAIL: ${msg}`); server.kill(); process.exit(1); };

try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(URL)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__biophage?.frames > 5, null, { timeout: 30000 });
  const start = await page.evaluate(() => window.__biophage.position);
  await page.keyboard.down('KeyW');
  // Software rendering in CI is slow, so wait for simulated frames, not wall-clock time.
  const from = await page.evaluate(() => window.__biophage.frames);
  await page.waitForFunction((f) => window.__biophage.frames > f + 40, from, { timeout: 120000 });
  await page.keyboard.up('KeyW');
  const end = await page.evaluate(() => window.__biophage.position);
  mkdirSync('tests/out', { recursive: true });
  await page.screenshot({ path: 'tests/out/smoke.png' });
  await browser.close();
  if (errors.length) fail(`console errors:\n${errors.join('\n')}`);
  const moved = Math.hypot(end[0] - start[0], end[2] - start[2]);
  if (moved < 1) fail(`player did not move (moved ${moved.toFixed(2)} m)`);
  console.log(`SMOKE OK: moved ${moved.toFixed(1)} m, screenshot at tests/out/smoke.png`);
  server.kill();
  process.exit(0);
} catch (e) {
  fail(e.stack || e);
}
