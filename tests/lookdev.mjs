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
  weapon: { main: true },
  fire: { main: true, fire: [-38, 1.2, 100] },
  shots: { at: [-15.5, 77], eye: 1.6, yaw: 1.3, pitch: -0.05, shots: [-20.3, 81.2, -24, 70] },
  creatures: { at: [-20, 80], eye: 1.5, yaw: -0.1, pitch: 0.16, creatures: [-19.5, 74.5, 0.25] },
  needlemaw: { at: [-20.6, 76.6], eye: 1.0, yaw: 0.22, pitch: -0.1, nohud: true, creatures: [-19.5, 74.5, 0.35] },
  cantor: { at: [-15.8, 74.6], eye: 2.0, yaw: 0.05, pitch: 0.42, nohud: true, creatures: [-19.5, 74.5, 0.1] },
  mutate: { at: [-41, 108], eye: 1.8, yaw: -0.2, pitch: -0.05, mutate: [-39.6, 103] },
  lab: { lab: 0.35, nohud: true },
  rim: { at: [-105, -25], eye: 4, yaw: 1.25, pitch: -0.2 },
  // World & Level sites (seed 1, the default under automation).
  crater: { at: [-34, -19], eye: 6, yaw: 1.05, pitch: -0.28 },
  anomaly: { at: [36, -17], eye: 2.5, yaw: -0.6, pitch: 0.3 },
  bloom: { at: [4, -31], eye: 1.7, yaw: -0.6, pitch: -0.22 },
  spire: { at: [96, 31], eye: 3, yaw: -2.07, pitch: 0.08 },
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
  await page.addStyleTag({ content: '#prompt,#hive{display:none!important}' });
  await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 120000 });
  mkdirSync('tests/out', { recursive: true });
  const only = process.argv[2];
  for (const [name, pose] of Object.entries(POSES)) {
    if (only && only !== name) continue;
    await page.evaluate(() => window.__biophageLookdev.lab(false));
    if (pose.lab !== undefined) await page.evaluate((y) => window.__biophageLookdev.lab(true, y), pose.lab);
    else if (pose.main) await page.evaluate(() => window.__biophageLookdev.clear());
    else await page.evaluate((p) => window.__biophageLookdev.view(p), pose);
    for (const n of (process.env.HIDE || '').split(',').filter(Boolean)) await page.evaluate((x) => window.__biophageLookdev.show(x, false), n);
    for (const g of pose.gore ?? []) await page.evaluate(([x, z, c]) => window.__biophageLookdev.gore(x, z, c), g);
    await page.evaluate((h) => { const e = document.getElementById('hud'); if (e) e.style.visibility = h ? 'hidden' : ''; }, !!pose.nohud);
    if (pose.fire) await page.evaluate(([x, y, z]) => { const d = window.__biophage.debug; d.begin(); d.aimAt(x, y, z); d.trigger(true); }, pose.fire);
    if (pose.shots) await page.evaluate((a) => window.__biophageLookdev.shots(...a), pose.shots);
    if (pose.creatures) await page.evaluate(([x, z, f]) => window.__biophageLookdev.creatures(x, z, f), pose.creatures);
    if (pose.mutate) await page.evaluate(([x, z]) => window.__biophageLookdev.mutateDemo(x, z), pose.mutate);
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
