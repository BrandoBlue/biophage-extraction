// Headless smoke test: boots the game, walks forward, saves a screenshot and a metrics report.
//   npm run smoke                    -> serves dist/ with `vite preview` (run `npm run build` first)
//   npm run smoke -- --release       -> opens release/index.html straight from disk (file://), the way the
//                                       shipped single-file build is played (run `npm run release` first)
// Software rendering in CI is slow: always wait on window.__biophage.frames, never on wall-clock time.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { freezeAndScreenshot } from './lib/harness.mjs';

const release = process.argv.includes('--release');
const label = release ? 'release' : 'preview';
const PREVIEW_URL = 'http://localhost:4173/';
let server;
const fail = (msg) => { console.error(`SMOKE FAIL [${label}]: ${msg}`); server?.kill(); process.exit(1); };

try {
  let url = PREVIEW_URL;
  if (release) {
    const file = resolve('release/index.html');
    if (!existsSync(file)) fail('release/index.html missing; run `npm run release` first');
    url = pathToFileURL(file).href;
  } else {
    server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try { up = (await fetch(PREVIEW_URL)).ok; } catch { /* not up yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 250));
    }
    if (!up) fail('vite preview did not start');
  }

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.__biophage?.frames > 0, null, { timeout: 60000 });
  const firstFrameMs = Date.now() - t0;
  await page.waitForFunction(() => window.__biophage?.frames > 5, null, { timeout: 30000 });

  const start = await page.evaluate(() => window.__biophage.position);
  await page.keyboard.down('KeyW');
  const from = await page.evaluate(() => window.__biophage.frames);
  const tWalk = Date.now();
  await page.waitForFunction((f) => window.__biophage.frames > f + 40, from, { timeout: 120000 });
  const walkMs = Date.now() - tWalk;
  await page.keyboard.up('KeyW');
  const end = await page.evaluate(() => window.__biophage.position);
  const build = await page.evaluate(() => document.querySelector('meta[name="biophage-build"]')?.content ?? null);

  mkdirSync('tests/out', { recursive: true });
  const shot = `tests/out/smoke${release ? '-release' : ''}.png`;
  await freezeAndScreenshot(page, shot);
  await browser.close();

  if (errors.length) fail(`console errors:\n${errors.join('\n')}`);
  const moved = Math.hypot(end[0] - start[0], end[2] - start[2]);
  if (moved < 1) fail(`player did not move (moved ${moved.toFixed(2)} m)`);

  // Software-rendered fps says nothing about a real GPU; it is logged to spot big regressions between runs.
  const report = { target: label, build, firstFrameMs, swiftshaderFps: +(40000 / walkMs).toFixed(1), movedM: +moved.toFixed(2), screenshot: shot };
  writeFileSync(`tests/out/smoke-${label}.json`, JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Smoke (${label}) passed\n| first frame | software fps | moved | build |\n|---|---|---|---|\n| ${firstFrameMs} ms | ${report.swiftshaderFps} | ${report.movedM} m | ${build ?? 'dev'} |\n\n`);
  }
  console.log(`SMOKE OK [${label}]: first frame ${firstFrameMs} ms, moved ${moved.toFixed(1)} m, screenshot at ${shot}`);
  server?.kill();
  process.exit(0);
} catch (e) {
  fail(e.stack || e);
}
