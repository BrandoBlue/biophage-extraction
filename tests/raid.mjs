// Scripted raid: proves a Spore raid can be finished both ways, driving the game through window.__biophage.debug.
//   npm run smoke:raid                 -> against dist/ via `vite preview` (run `npm run build` first)
//   npm run smoke:raid -- --release    -> against release/index.html from disk
// Fights a Needlemaw with the Synapse Burster, tears open the Bio-Pod, extracts at the Seed Spire, checks the
// EXTRACTED screen, deploys again, dies, checks the HOST LOST screen. Screenshots go to tests/out/.
// Software rendering is slow: every wait is on simulated frames, never wall-clock time.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { freezeAndScreenshot } from './lib/harness.mjs';

const release = process.argv.includes('--release');
const label = release ? 'release' : 'preview';
const PREVIEW_URL = 'http://localhost:4173/';
let server;
let browser;
const fail = async (msg) => { console.error(`RAID FAIL [${label}]: ${msg}`); await browser?.close(); server?.kill(); process.exit(1); };
const log = (msg) => console.log(`raid [${label}]: ${msg}`);

try {
  let url = PREVIEW_URL;
  if (release) {
    const file = resolve('release/index.html');
    if (!existsSync(file)) await fail('release/index.html missing; run `npm run release` first');
    url = pathToFileURL(file).href;
  } else {
    server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try { up = (await fetch(PREVIEW_URL)).ok; } catch { /* not up yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 250));
    }
    if (!up) await fail('vite preview did not start');
  }

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  mkdirSync('tests/out', { recursive: true });

  const state = () => page.evaluate(() => window.__biophage.state);
  const frames = (n) => page.evaluate((k) => window.__biophage.frames + k, n).then((target) =>
    page.waitForFunction((t) => window.__biophage.frames >= t, target, { timeout: 180000 }));
  const call = (fn, ...args) => page.evaluate(([f, a]) => window.__biophage.debug[f](...a), [fn, args]);
  const boot = async () => {
    await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 90000 });
  };

  await page.goto(url);
  await boot();
  let s = await state();
  if (s.phase !== 'briefing') await fail(`expected briefing, got ${s.phase}`);
  const hudText = await page.evaluate(() => document.querySelector('#vitals')?.textContent ?? '');
  if (!/BIOMASS/.test(hudText) || !/NEURAL OVERLOAD/.test(hudText)) await fail('HUD is missing Biomass or Neural Overload');

  // Run the simulation 3x faster per frame so the scripted raid fits in CI time (the dt clamp keeps steps small).
  await call('setTimeScale', 3);
  await call('begin');

  // --- Fight: hunt the nearest Needlemaw until it dies.
  s = await state();
  const pick = s.enemies.filter((e) => e.alive && e.kind === 'needlemaw')
    .sort((a, b) => Math.hypot(a.position[0], a.position[2]) - Math.hypot(b.position[0], b.position[2]))[0];
  if (!pick) await fail('no Needlemaw spawned');
  await call('teleport', pick.position[0] + 9, pick.position[2] + 9);
  await frames(2);
  let killed = false;
  let shotFrames = 0;
  for (let i = 0; i < 80 && !killed; i++) {
    s = await state();
    const e = s.enemies.find((x) => x.id === pick.id);
    if (!e?.alive) { killed = true; break; }
    await call('aimAt', e.centre[0], e.centre[1], e.centre[2]);
    await call('trigger', true);
    if (i === 6) await freezeAndScreenshot(page, 'tests/out/raid-combat.png', { resume: true });
    await frames(3);
    shotFrames += 3;
  }
  await call('trigger', false);
  await call('clearAim');
  s = await state();
  if (!killed || s.kills < 1) await fail(`Needlemaw survived ${shotFrames} frames of fire (kills ${s.kills}, ammo ${s.ammo})`);
  log(`killed a Needlemaw; kills ${s.kills}, kill DNA ${s.carried.dna}, biomass ${Math.round(s.biomass)}`);

  // Clear the island so the rest of the script is deterministic.
  await call('killAll');
  await frames(5);

  // --- Loot the Bio-Pod.
  const pod = s.pods[0];
  await call('teleport', pod.position[0] + 1.2, pod.position[1]);
  await frames(2);
  await call('hold', 'KeyE', true);
  for (let i = 0; i < 60; i++) { await frames(3); s = await state(); if (s.pods[0].opened) break; }
  await call('hold', 'KeyE', false);
  if (!s.pods[0].opened) await fail('Bio-Pod did not open while holding E');
  if (!s.carried.items.length) await fail('Bio-Pod gave no items');
  log(`Bio-Pod: ${s.carried.items.map((i) => `${i.count}x ${i.item}`).join(', ')}; haul ${s.carried.value}`);

  // --- Extract.
  await call('extractNow');
  for (let i = 0; i < 120; i++) { await frames(4); s = await state(); if (s.phase !== 'raid') break; }
  if (s.phase !== 'extracted') await fail(`expected extracted, got ${s.phase} (progress ${s.extractProgress})`);
  await frames(3);
  const won = await page.evaluate(() => document.querySelector('.results h1')?.textContent);
  if (won !== 'EXTRACTED') await fail(`result screen says ${won}`);
  await freezeAndScreenshot(page, 'tests/out/raid-extracted.png', { resume: true });
  log(`EXTRACTED with haul ${s.result.value}`);

  // --- Deploy again, then die.
  await page.click('#deploy-again');
  await page.waitForFunction(() => window.__biophage?.state?.phase === 'briefing', null, { timeout: 90000 });
  await boot();
  await call('setTimeScale', 3);
  await call('begin');
  await frames(2);
  await call('give', 'synapseLens', 1);
  await call('damage', 10000);
  await frames(3);
  s = await state();
  if (s.phase !== 'lost') await fail(`expected lost, got ${s.phase}`);
  const lost = await page.evaluate(() => document.querySelector('.results h1')?.textContent);
  if (lost !== 'HOST LOST') await fail(`result screen says ${lost}`);
  await freezeAndScreenshot(page, 'tests/out/raid-lost.png');
  log(`HOST LOST; lost value ${s.result.value}`);

  if (errors.length) await fail(`console errors:\n${errors.join('\n')}`);
  await browser.close();
  server?.kill();
  console.log(`RAID OK [${label}]: fight, loot, extract and death all reachable; screenshots in tests/out/raid-*.png`);
  process.exit(0);
} catch (e) {
  await fail(e.stack || e);
}
