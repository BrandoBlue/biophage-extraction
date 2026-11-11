// Scripted raid: proves a Spore raid can be finished both ways, driving the game through window.__biophage.debug.
//   npm run smoke:raid                 -> against dist/ via `vite preview` (run `npm run build` first)
//   npm run smoke:raid -- --release    -> against release/index.html from disk
// Boots into the Hive with a fresh profile, opens the stash, double-clicks Clot Gel into the cavities and deploys
// from the raid select tab. Fights a Needlemaw with the
// Synapse Burster, tears open the Bio-Pod, extracts at the Seed Spire, checks the EXTRACTED screen, returns to the
// Hive (page reload) and checks the haul is in the stash. Then deploys with a gut pouch item, dies, checks the HOST
// LOST screen and that the cavities were lost while the gut pouch came home. Screenshots go to tests/out/.
// Software rendering is slow: every wait is on simulated frames, never wall-clock time.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { freezeAndScreenshot } from './lib/harness.mjs';

const release = process.argv.includes('--release');
const LOOT = JSON.parse(readFileSync('data/loot.json', 'utf8'));
const PROFILE = JSON.parse(readFileSync('data/profile.json', 'utf8'));
const HOST_BIOMASS = JSON.parse(readFileSync('data/classes.json', 'utf8')).neuroInfiltrator.biomass;
const starter = (item) => PROFILE.newProfile.stash.find((k) => k.item === item).count;
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
  const profile = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__biophage.profile)));
  const total = (entries, item) => entries.filter((e) => e.item === item).reduce((n, e) => n + e.count, 0);
  const menuItem = (zone, item) => `#hive [data-zone="${zone}"] [data-item="${item}"]`;
  const tab = (t) => page.click(`#hive .tab[data-tab="${t}"]`);
  const boot = async () => {
    await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 90000 });
  };

  await page.goto(url);
  await boot();
  let s = await state();
  if (s.phase !== 'briefing') await fail(`expected briefing, got ${s.phase}`);

  // --- The Hive: a fresh profile with Design's starter kit.
  let p = await profile();
  if (!(await page.isVisible('#hive'))) await fail('Hive menu is not shown at boot');
  if ((await page.getAttribute('#hive', 'data-tab')) !== 'menu') await fail('the Hive does not open on the main menu');
  await freezeAndScreenshot(page, 'tests/out/raid-hive-menu.png', { resume: true });
  await tab('stash');
  if (p.dna !== PROFILE.newProfile.dna || !PROFILE.newProfile.stash.every((k) => total(p.stash, k.item) === k.count)) await fail(`unexpected new profile ${JSON.stringify(p)}`);
  await page.dblclick(menuItem('stash', 'clotGel'));
  p = await profile();
  if (total(p.cavity, 'clotGel') !== starter('clotGel') || total(p.stash, 'clotGel') !== 0) await fail(`Clot Gel did not move into the cavities: ${JSON.stringify(p.cavity)}`);
  await freezeAndScreenshot(page, 'tests/out/raid-hive.png', { resume: true });
  const hudText = await page.evaluate(() => document.querySelector('#vitals')?.textContent ?? '');
  if (!/BIOMASS/.test(hudText) || !/NEURAL OVERLOAD/.test(hudText)) await fail('HUD is missing Biomass or Neural Overload');

  const hint = await page.evaluate(() => document.querySelector('#prompt')?.textContent ?? '');
  for (const k of ['LMB fire', 'R regrow', 'F ego charge', '1/Q', '2 clot gel', 'hold E']) if (!hint.includes(k)) await fail(`control hint is missing "${k}"`);

  // Run the simulation 3x faster per frame so the scripted raid fits in CI time (the dt clamp keeps steps small).
  await call('setTimeScale', 3);
  await tab('raid');
  await page.click('#deploy');
  await frames(2);
  s = await state();
  if (s.phase !== 'raid') await fail(`Deploy did not start the raid (${s.phase})`);
  if (await page.isVisible('#hive')) await fail('Hive menu still visible in raid');
  if (!s.carried.items.some((i) => i.item === 'clotGel' && i.count === starter('clotGel'))) await fail(`loadout not carried: ${JSON.stringify(s.carried.items)}`);
  if ((await profile()).cavity.length) await fail('saved profile still holds the deployed loadout (a mid-raid quit would keep it)');

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
  if (!(s.gore?.splats > 0) || !(s.gore?.bursts >= 0)) await fail(`no gore splats after a kill: ${JSON.stringify(s.gore)}`);
  log(`gore live: ${s.gore.splats} splats, ${s.gore.bursts} bursts`);
  log(`killed a Needlemaw; kills ${s.kills}, kill DNA ${s.carried.dna}, biomass ${Math.round(s.biomass)}`);

  // --- Harvest the Needlemaw's gland: hold E on the corpse.
  const corpse = s.enemies.find((x) => x.id === pick.id);
  await call('teleport', corpse.position[0] + 1, corpse.position[2]);
  await frames(2);
  await call('hold', 'KeyE', true);
  for (let i = 0; i < 60; i++) { await frames(3); s = await state(); if (s.harvested.includes(pick.id)) break; }
  await call('hold', 'KeyE', false);
  if (!s.harvested.includes(pick.id) || !s.carried.items.some((i) => i.item === 'needlemawGland')) await fail(`harvest failed: ${JSON.stringify(s.carried.items)}`);
  log('harvested a Needlemaw gland');

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

  // --- In-raid inventory: put the gland into the open pod and take it back (UI's Tab overlay API).
  const gland = s.carried.cavity.findIndex((e) => e.item === 'needlemawGland');
  if ((await call('transfer', 'cavity', gland, 'pod')) !== 1) await fail('could not move the gland into the open pod');
  await frames(1);
  s = await state();
  if (s.carried.items.some((i) => i.item === 'needlemawGland')) await fail('gland still carried after moving it to the pod');
  if ((await call('transfer', 'pod', 0, 'cavity')) !== 1) await fail('could not take the gland back from the pod');

  // --- TAB opens the cavity overlay with the open pod as a third grid; TAB closes it.
  await page.keyboard.press('Tab');
  await frames(2);
  const ov = await page.evaluate(() => ({ open: !document.querySelector('.cav-overlay')?.classList.contains('hidden'),
    zones: [...document.querySelectorAll('.cav-overlay [data-zone]')].map((e) => e.getAttribute('data-zone')) }));
  if (!ov.open || !['cavity', 'pouch'].every((z) => ov.zones.includes(z))) await fail(`TAB overlay not shown: ${JSON.stringify(ov)}`);
  await freezeAndScreenshot(page, 'tests/out/raid-cavities.png', { resume: true });
  await page.keyboard.press('Tab');
  if (await page.isVisible('.cav-overlay')) await fail('TAB did not close the cavity overlay');
  log(`cavity overlay: ${[...new Set(ov.zones)].join(', ')}`);

  // --- Inject the Adrenaline Virus: 3 s channel, then it takes hold and lowers max Biomass.
  const vials = (st) => st.carried.items.filter((i) => i.item === 'adrenalineVirus').reduce((n, i) => n + i.count, 0);
  const vialsBefore = vials(s);
  await call('give', 'adrenalineVirus', 1);
  if (!(await call('inject', 'adrenalineVirus'))) await fail('injection did not start');
  for (let i = 0; i < 40; i++) { await frames(3); s = await state(); if (s.virus) break; }
  if (s.virus !== 'adrenalineVirus' || !(s.maxBiomass < HOST_BIOMASS) || vials(s) !== vialsBefore) await fail(`virus did not take hold: ${s.virus}, max ${s.maxBiomass}`);
  log(`injected ${s.virus}; max Biomass ${s.maxBiomass}`);
  if (s.armLook !== 'adrenalineVirus') await fail(`host arm did not mutate: ${s.armLook}`);

  // --- Zone collapse warning must be readable (issue #8): a backed, enlarged banner.
  await call('setTimeLeft', 120.2);
  await frames(6);
  const banner = await page.evaluate(() => { const t = document.querySelector('.toast'); return { text: t?.textContent, cls: t?.className, bg: t ? getComputedStyle(t).backgroundColor : '' }; });
  if (!/ZONE COLLAPSE/.test(banner.text ?? '') || !/alarm/.test(banner.cls ?? '') || /rgba\(0, 0, 0, 0\)/.test(banner.bg)) await fail(`collapse banner not shown as an alarm plate: ${JSON.stringify(banner)}`);
  await freezeAndScreenshot(page, 'tests/out/raid-collapse.png', { resume: true });
  await call('setTimeLeft', 500);

  // --- Extract.
  await call('extractNow');
  for (let i = 0; i < 120; i++) { await frames(4); s = await state(); if (s.phase !== 'raid') break; }
  if (s.phase !== 'extracted') await fail(`expected extracted, got ${s.phase} (progress ${s.extractProgress})`);
  await frames(3);
  const won = await page.evaluate(() => document.querySelector('.results h1')?.textContent);
  if (won !== 'EXTRACTED') await fail(`result screen says ${won}`);
  const promptShown = await page.evaluate(() => getComputedStyle(document.querySelector('#prompt')).display !== 'none');
  if (promptShown) await fail('enter prompt shows behind the result screen (issue #7)');
  await freezeAndScreenshot(page, 'tests/out/raid-extracted.png', { resume: true });
  log(`EXTRACTED with haul ${s.result.value}`);
  const haul = s.result.cavity.filter((e) => e.item !== 'dnaStrand');
  const strands = total(s.result.cavity, 'dnaStrand');

  // --- Return to the Hive (reload): the haul must be in the stash, kill DNA and strands banked.
  // The reload can take a while on software rendering; the next line waits for the fresh Hive.
  await page.click('#deploy-again', { noWaitAfter: true });
  await page.waitForFunction(() => window.__biophage?.state?.phase === 'briefing', null, { timeout: 90000 });
  await boot();
  p = await profile();
  for (const h of haul) if (total(p.stash, h.item) < h.count) await fail(`${h.item} missing from the stash after reload: ${JSON.stringify(p.stash)}`);
  const expectDna = PROFILE.newProfile.dna + s.result.dna + strands * LOOT.items.dnaStrand.value;
  if (p.dna !== expectDna) await fail(`banked DNA ${p.dna}, expected ${expectDna}`);
  if (p.stats.extracts !== 1 || p.stats.raids !== 1) await fail(`raid record wrong: ${JSON.stringify(p.stats)}`);
  log(`after reload: stash ${p.stash.map((e) => `${e.count}x ${e.item}`).join(', ')}; DNA ${p.dna}`);

  // --- Second raid: a starter DNA bundle in the cavities, Clot Gel in the gut pouch, then die.
  await tab('stash');
  await page.dblclick(menuItem('stash', 'dnaStrand'));
  await page.dblclick(menuItem('stash', 'clotGel'), { modifiers: ['Shift'] });
  p = await profile();
  if (total(p.cavity, 'dnaStrand') !== starter('dnaStrand') || total(p.gutPouch, 'clotGel') < 1) await fail(`loadout not set: cavity ${JSON.stringify(p.cavity)} pouch ${JSON.stringify(p.gutPouch)}`);
  const pouchGel = total(p.gutPouch, 'clotGel');
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
  await freezeAndScreenshot(page, 'tests/out/raid-lost.png', { resume: true });
  log(`HOST LOST; lost value ${s.result.value}`);
  // The reload can take a while on software rendering; the next line waits for the fresh Hive.
  await page.click('#deploy-again', { noWaitAfter: true });
  await page.waitForFunction(() => window.__biophage?.state?.phase === 'briefing', null, { timeout: 90000 });
  await boot();
  p = await profile();
  if (p.cavity.length || total(p.stash, 'dnaStrand') || total(p.stash, 'synapseLens') > total(haul, 'synapseLens')) await fail(`death did not empty the cavities: ${JSON.stringify(p)}`);
  if (total(p.gutPouch, 'clotGel') !== pouchGel) await fail(`gut pouch did not survive death: ${JSON.stringify(p.gutPouch)}`);
  if (p.stats.deaths !== 1 || p.dna !== expectDna) await fail(`death record or banked DNA wrong: ${JSON.stringify(p.stats)} DNA ${p.dna}`);
  await freezeAndScreenshot(page, 'tests/out/raid-hive-after.png');
  log('after death: cavities empty, gut pouch kept, banked DNA untouched');

  if (errors.length) await fail(`console errors:\n${errors.join('\n')}`);
  await browser.close();
  server?.kill();
  console.log(`RAID OK [${label}]: Hive deploy, fight, loot, extract, stash across reload, and death all reachable; screenshots in tests/out/raid-*.png`);
  process.exit(0);
} catch (e) {
  await fail(e.stack || e);
}
