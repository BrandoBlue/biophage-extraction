// Look-dev capture: renders fixed camera poses of Zone 7 for side-by-side review against docs/reference/04.
// Run after `npm run build`: `npm run lookdev`. Writes tests/out/lookdev-*.png.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = `http://localhost:4174/?quality=${process.env.QUALITY || 'high'}`;
const POSES = {
  spawn: { at: [-41, 113], eye: 1.7, yaw: -0.35, pitch: 0.08 },
  pool: { at: [-5, 66], eye: 3, yaw: 0.45, pitch: -0.12 },
  vista: { at: [10, -30], eye: 2.5, yaw: 0.25, pitch: 0.16 },
  gore: { at: [-41, 113], eye: 1.7, yaw: -0.35, pitch: -0.35, gore: [[-39.5, 108.5], [-37, 109.5, '#B6FF3B']] },
  rim: { at: [-105, -25], eye: 4, yaw: 1.25, pitch: -0.2 },
};
const width = Number(process.env.LOOKDEV_W || 1280), height = Number(process.env.LOOKDEV_H || 720);
const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
const fail = (msg) => { console.error(`LOOKDEV FAIL: ${msg}`); server.kill(); process.exit(1); };
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch('http://localhost:4174/')).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  await page.goto(URL);
  await page.addStyleTag({ content: '#prompt{display:none!important}' });
  await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 120000 });
  mkdirSync('tests/out', { recursive: true });
  const only = process.argv[2];
  for (const [name, pose] of Object.entries(POSES)) {
    if (only && only !== name) continue;
    await page.evaluate((p) => window.__biophageLookdev.view(p), pose);
    for (const n of (process.env.HIDE || '').split(',').filter(Boolean)) await page.evaluate((x) => window.__biophageLookdev.show(x, false), n);
    for (const g of pose.gore ?? []) await page.evaluate(([x, z, c]) => window.__biophageLookdev.gore(x, z, c), g);
    if (process.env.RAW) await page.evaluate(() => window.__biophageLookdev.raw(true));
    const from = await page.evaluate(() => window.__biophage.frames);
    await page.waitForFunction((f) => window.__biophage.frames > f + 2, from, { timeout: 120000 });
    await page.screenshot({ path: `tests/out/lookdev-${name}${process.env.RAW ? '-raw' : ''}${process.env.TAG ?? ''}.png`, timeout: 120000 });
    console.log(`lookdev-${name}.png`);
  }
  await browser.close();
  const real = errors.filter((e) => !/GPU stall|ReadPixels|swiftshader|Automatic fallback|deprecated/i.test(e));
  if (real.length) fail(real.join('\n'));
  server.kill();
  process.exit(0);
} catch (e) { fail(e.stack || e); }
