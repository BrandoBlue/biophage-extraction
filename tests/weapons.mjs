// The living weapon roster in a real raid: npm run smoke:weapons (after npm run build).
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
  // A gun packed into the cavities in the Hive is in the host's hands from the start of the raid.
  await page.evaluate(() => { window.__biophage.profile.cavity = [{ item: 'gulletScatter', count: 1, x: 0, y: 0, rotated: false }]; });
  await call('begin');
  await frames(3);
  const packed = (await state()).weapons.list.map((w) => w.id);
  if (!packed.includes('gulletScatter')) await fail(`a gun packed in the cavities was not drawn at deploy: ${JSON.stringify(packed)}`);
  log(`deploy drew the packed gun: ${packed.join(', ')}`);
  await checkWeapons({ page, call, frames, state, fail, log });
  if (errors.length) await fail(`page errors: ${errors.join(' | ')}`);
  console.log('WEAPONS OK');
} catch (e) { await fail(String(e?.stack ?? e)); }
await browser?.close(); server?.kill();
