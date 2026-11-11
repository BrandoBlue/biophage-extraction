// The weapon roster on its own (the same check runs inside `npm run smoke:raid:hive`):
//   npm run build && node tests/weapons.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { checkWeapons } from './lib/weapons-check.mjs';

const URL = 'http://localhost:4175/';
let server, browser;
const fail = async (msg) => { console.error(`WEAPONS FAIL: ${msg}`); await browser?.close(); server?.kill(); process.exit(1); };
const log = (msg) => console.log(`weapons: ${msg}`);
try {
  server = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(URL)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  mkdirSync('tests/out', { recursive: true });
  await page.goto(URL);
  await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 120000 });
  const frames = (n) => page.evaluate((k) => window.__biophage.frames + k, n).then((t) => page.waitForFunction((x) => window.__biophage.frames >= x, t, { timeout: 180000 }));
  const call = (fn, ...a) => page.evaluate(([f, x]) => window.__biophage.debug[f](...x), [fn, a]);
  const state = () => page.evaluate(() => window.__biophage.state);
  await call('begin');
  await frames(3);
  await checkWeapons({ page, call, frames, state, fail, log });
  if (errors.length) await fail(`page errors: ${errors.join(' | ')}`);
  console.log('WEAPONS OK');
} catch (e) { await fail(String(e?.stack ?? e)); }
await browser?.close(); server?.kill();
