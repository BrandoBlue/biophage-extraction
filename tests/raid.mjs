// Scripted raid: proves a Spore raid can be finished both ways, driving the game through window.__biophage.debug.
//   npm run smoke:raid                 -> against dist/ via `vite preview` (run `npm run build` first)
//   npm run smoke:raid -- --release    -> against release/index.html from disk
//   npm run smoke:raid:hive            -> part 2 (`--hive`): vendors, Flesh Market, gear, boss rewards, zone switch
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
// Two CI jobs: the raid loop (default) and `--hive` (vendors, Flesh Market, gear, boss rewards, zone switch).
const HIVE_PART = process.argv.includes('--hive');
const LOOT = JSON.parse(readFileSync('data/loot.json', 'utf8'));
const PROFILE = JSON.parse(readFileSync('data/profile.json', 'utf8'));
const HOST_BIOMASS = JSON.parse(readFileSync('data/classes.json', 'utf8')).neuroInfiltrator.biomass;
const starter = (item) => PROFILE.newProfile.stash.find((k) => k.item === item).count;
const label = `${release ? 'release' : 'preview'}${HIVE_PART ? ' hive' : ''}`;
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

  if (!HIVE_PART) {
  // --- The Hive: a fresh profile with Design's starter kit.
  let p = await profile();
  if (!(await page.isVisible('#hive'))) await fail('Hive menu is not shown at boot');
  if ((await page.getAttribute('#hive', 'data-tab')) !== 'menu') await fail('the Hive does not open on the main menu');
  // The main menu stands the host's 3D body in the Hive lab behind the specimen column (src/ui/hive-stage.ts).
  // Software rendering has no parallel shader compile, so the lab's first compile freezes the page for ~20 s locally
  // and longer on CI runners; on a GPU it is well under a second.
  await page.waitForSelector('#hive.lab-live', { timeout: 180000 }).catch(() => fail('the 3D Hive lab is not live behind the main menu'));
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

  // --- World layout (seed 1 under automation): three Bio-Pods plus the raid's Gene Bloom harvest nodes.
  const layout = await page.evaluate(() => window.__biophage.layout);
  const blooms = s.pods.filter((q) => q.id.startsWith('bloom-'));
  const caches = s.pods.filter((q) => /^(spire|debris|cave)-/.test(q.id));
  if (s.pods.length !== layout.pods.length + layout.nodes.length + caches.length || blooms.length !== layout.nodes.length || caches.length < 2) await fail(`layout sites not spawned: ${JSON.stringify(s.pods.map((q) => q.id))}`);
  log(`world sites: ${layout.pods.length} Bio-Pods, ${blooms.length} Gene Blooms, ${caches.length} structure caches, spires ${layout.extracts.map((e) => e.id).join(' then ')}, anomaly ${layout.anomaly.id}`);

  // --- Loot the Bio-Pod.
  const pod = s.pods[0];
  await call('teleport', pod.position[0] + 1.2, pod.position[1]);
  await frames(2);
  await call('hold', 'KeyE', true);
  for (let i = 0; i < 60; i++) { await frames(3); s = await state(); if (s.pods[0].opened) break; }
  await call('hold', 'KeyE', false);
  if (!s.pods[0].opened) await fail('Bio-Pod did not open while holding E');
  if (!s.carried.items.length) await fail('Bio-Pod gave no items');
  // Contract log: the harvest, the kill and the first pod open are recorded for the Hive's contract settlement.
  if (s.zone !== 'glowmireIsle' || !s.log.harvested.needlemawGland || !s.log.killed.needlemaw || !Object.keys(s.log.opened).length) await fail(`contract log incomplete: ${JSON.stringify({ zone: s.zone, log: s.log })}`);
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

  // --- Extract. Waits run at 8x sim speed so the two raid smokes fit CI's 35 min job (software rendering is ~1 fps).
  await call('setTimeScale', 8);
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
  // Brood Heart (PvE AI): walking up wakes it, it pulses out a wave, and killing it drops a Brood Cache.
  s = await state();
  if (s.nests?.length) {
    const nest = s.nests[0];
    await call('teleport', nest.position[0] + 18, nest.position[1] + 6);
    await call('aimAt', nest.position[0], 3, nest.position[1]);
    for (let i = 0; i < 40; i++) { await frames(2); s = await state(); if (s.nests[0].brood > 0) break; }
    if (s.nests[0].state !== 'active' || s.nests[0].wave < 1 || s.nests[0].brood < 1) await fail(`Brood Heart did not wake and spawn: ${JSON.stringify(s.nests[0])}`);
    // The HUD's boss bar names the awake heart and shows its waves (src/ui/raid/hud.ts).
    await page.waitForSelector('#hud .h-boss:not(.hidden)', { timeout: 30000 }).catch(() => fail('the boss bar did not show for the awake Brood Heart'));
    const bossText = await page.textContent('#hud .h-boss .bh');
    if (!/BROOD HEART/i.test(bossText) || !/WAVE \d+\/\d+/.test(bossText)) await fail(`boss bar reads "${bossText}"`);
    await freezeAndScreenshot(page, 'tests/out/raid-nest.png', { resume: true });
    const pods = s.pods.length;
    await call('hitNest', 0, 1e6, null);
    await frames(2);
    s = await state();
    if (s.nests[0].state !== 'destroyed' || s.pods.length !== pods + 1) await fail(`Brood Heart kill did not drop a Brood Cache: ${JSON.stringify(s.nests[0])}`);
    log(`Brood Heart woke, sent wave ${s.nests[0].wave} (${s.nests[0].brood} spawn), died and dropped a Brood Cache`);
  }
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
  await freezeAndScreenshot(page, 'tests/out/raid-hive-after.png', { resume: true });
  log('after death: cavities empty, gut pouch kept, banked DNA untouched');

  } else {
  // The Hive lab's first shader compile freezes software rendering for a while; let it finish before timing frames.
  await page.waitForSelector('#hive.lab-live', { timeout: 180000 }).catch(() => fail('the 3D Hive lab is not live behind the main menu'));
  // --- A raid with Flesh Market gear, a Brood Cache and a boss kill (Gameplay), then death back to the Hive.
  await call('setTimeScale', 3);
  await tab('raid');
  await page.click('#deploy');
  await frames(2);
  s = await state();
  if (s.phase !== 'raid') await fail(`Deploy did not start the raid (${s.phase})`);
  await call('killAll'); // a quiet island for the scripted checks
  await call('setTimeScale', 3);
  // The Reliquary (PvE AI's fight, Gameplay's rewards): walking into World's bowl wakes it, the boss bar names it;
  // killing it banks its DNA, drops the Reliquary Cage and leaves the Reliquary Heart to cut out with E.
  s = await state();
  const dnaBefore = s.carried.dna;
  if (s.boss && s.arena) {
    const a = s.arena;
    await call('teleport', a.x, a.z);
    await call('aimAt', s.boss.centre[0], s.boss.centre[1], s.boss.centre[2]);
    for (let i = 0; i < 60; i++) { await frames(2); s = await state(); if (s.boss.state === 'awake') break; }
    if (s.boss.state !== 'awake') await fail(`the Reliquary did not wake: ${JSON.stringify(s.boss)}`);
    await page.waitForFunction(() => /RELIQUARY/i.test(document.querySelector('#hud .h-boss:not(.hidden) .bh')?.textContent ?? ''), null, { timeout: 30000 })
      .catch(() => fail('the boss bar did not name the Reliquary'));
    await frames(20);
    s = await state();
    await call('aimAt', s.boss.centre[0], s.boss.centre[1], s.boss.centre[2]);
    await freezeAndScreenshot(page, 'tests/out/raid-boss.png', { resume: true });
    await call('hitBoss', 1e6, null);
    await frames(2);
    s = await state();
    if (s.boss.state !== 'dead') await fail(`the Reliquary did not die: ${JSON.stringify(s.boss)}`);
  } else {
    await call('bossKilled', 'reliquary'); // no arena in this zone: pay out at the host's feet
    await frames(1);
    s = await state();
  }
  if (!s.log.bosses.includes('reliquary') || !s.pods.some((q) => q.id === 'reliquaryCage-reliquary') || s.carried.dna <= dnaBefore) await fail(`Reliquary kill gave no rewards: ${JSON.stringify({ bosses: s.log.bosses, pods: s.pods.map((q) => q.id), dna: s.carried.dna })}`);
  const heart = s.pods.find((q) => q.id === 'reliquary-harvest');
  if (!heart) await fail('the Reliquary Heart is not harvestable');
  await call('teleport', heart.position[0] - 1.2, heart.position[1]);
  await call('setTimeScale', 8); // the cut is long (rewards.harvest.time); keep it short in frames so nothing hunts the host meanwhile
  await call('killAll');
  await frames(1);
  await call('hold', 'KeyE', true);
  for (let i = 0; i < 60; i++) { await call('killAll'); await frames(1); s = await state(); if (s.pods.find((q) => q.id === 'reliquary-harvest')?.opened || s.phase !== 'raid') break; } // the cut's noise draws packs in: keep clearing them
  await call('hold', 'KeyE', false);
  const heartIn = [...s.carried.items, ...((await call('openContainer'))?.items ?? [])];
  if (!heartIn.some((i) => i.item === 'reliquaryHeart')) await fail(`harvesting the Reliquary gave no Reliquary Heart: ${JSON.stringify({ heartIn, heart: s.pods.find((q) => q.id === 'reliquary-harvest'), phase: s.phase, result: s.result })}`);
  log(`Reliquary killed: +${s.carried.dna - dnaBefore} DNA, Reliquary Cage dropped, Reliquary Heart harvested`);
  // The Pale Vigil (PvE AI): it hangs silent in World's Fungal Cave lair; walking in wakes it and the boss bar names it.
  s = await state();
  if (s.vigil) {
    const L = s.vigil.lair;
    await call('killAll');
    await call('setTimeScale', 3);
    await call('teleport', L.x + 6, L.z + 6);
    for (let i = 0; i < 60; i++) { await frames(2); s = await state(); if (s.vigil.state === 'awake') break; }
    if (s.vigil.state !== 'awake') await fail(`the Pale Vigil did not wake: ${JSON.stringify(s.vigil)}`);
    await page.waitForFunction(() => /PALE VIGIL/i.test(document.querySelector('#hud .h-boss:not(.hidden) .bh')?.textContent ?? ''), null, { timeout: 30000 })
      .catch(() => fail('the boss bar did not name the Pale Vigil'));
    s = await state();
    await call('aimAt', s.vigil.centre[0], s.vigil.centre[1], s.vigil.centre[2]);
    await frames(4);
    await freezeAndScreenshot(page, 'tests/out/raid-vigil.png', { resume: true });
    const dnaV = s.carried.dna;
    await call('hitVigil', 1e6, null);
    await frames(2);
    s = await state();
    if (s.vigil.state !== 'dead' || !s.log.bosses.includes('paleVigil') || s.carried.dna <= dnaV || s.vigil.lair.sealed.some(Boolean)) await fail(`the Pale Vigil kill did not pay out or left the cave sealed: ${JSON.stringify({ vigil: s.vigil, bosses: s.log.bosses })}`);
    log(`Pale Vigil woke in the Fungal Cave and was killed: +${s.carried.dna - dnaV} DNA`);
  }
  await call('killAll');
  await call('setTimeScale', 8);
  // Brood Cache: the container PvE AI's Brood Heart drops on death always holds a Brood Heart Seed.
  const cacheId = await call('dropContainer', 'broodCache');
  await frames(1);
  await call('hold', 'KeyE', true);
  for (let i = 0; i < 60; i++) { await frames(3); s = await state(); if (s.pods.find((q) => q.id === cacheId)?.opened) break; }
  await call('hold', 'KeyE', false);
  if (!s.pods.find((q) => q.id === cacheId)?.opened) await fail('Brood Cache did not open while holding E');
  const inCache = (await call('openContainer'))?.items ?? [];
  if (![...s.carried.items, ...inCache].some((i) => i.item === 'broodHeartSeed')) await fail(`Brood Cache had no Brood Heart Seed: carried ${JSON.stringify(s.carried.items)} cache ${JSON.stringify(inCache)}`);
  log(`Brood Cache opened: ${[...s.carried.items, ...inCache].map((i) => `${i.count}x ${i.item}`).join(', ')}`);
  // Flesh Market gear: a grenade explodes after its fuse; a Heart Husk turns the first death into a revive.
  await call('give', 'neuroSpikeGrenade', 1);
  if (!(await call('grenade'))) await fail('could not throw a Neuro-Spike Grenade');
  for (let i = 0; i < 40; i++) { await frames(2); s = await state(); if (s.grenades === 0) break; }
  if (s.grenades !== 0) await fail('grenade never exploded');
  await call('melee');
  // The raid's loot is random: if the cavities are full, throw stacks out until the Husk fits.
  for (let i = 0; i < 12 && (await call('give', 'heartHusk', 1)) > 0; i++) {
    s = await state();
    const junk = s.carried.items.find((x) => x.item !== 'heartHusk');
    if (!junk) break;
    await call('discard', junk.item, junk.count);
  }
  await call('damage', 10000);
  await frames(2);
  s = await state();
  if (s.phase !== 'raid' || !s.reviving) await fail(`Heart Husk did not catch the death: ${s.phase}, reviving ${s.reviving}`);
  for (let i = 0; i < 40; i++) { await frames(2); s = await state(); if (!s.reviving) break; }
  if (s.reviving || !(s.biomass > 0)) await fail(`Heart Husk revive did not finish: biomass ${s.biomass}`);
  log(`Heart Husk revived the host at ${Math.round(s.biomass)} Biomass`);
  await call('damage', 10000);
  await frames(3);
  s = await state();
  if (s.phase !== 'lost') await fail(`expected lost after the gear run, got ${s.phase}`);
  await page.click('#deploy-again', { noWaitAfter: true });
  await page.waitForFunction(() => window.__biophage?.state?.phase === 'briefing', null, { timeout: 90000 });
  await boot();

  // --- Hive vendors: Mother Clot lists rep-gated stock and contracts, buys from the stash, and a contract can be taken.
  await tab('vendors');
  if (!(await page.isVisible('#hive .scr-vendor'))) await fail('VENDORS did not open the Hive vendors');
  const vCards = await page.locator('#hive .mk-card').count();
  const contracts = await page.locator('#hive .vd-contract').count();
  if (vCards < 1 || contracts < 1) await fail(`Mother Clot shows ${vCards} offers and ${contracts} contracts`);
  let before = (await profile()).dna;
  await page.click('#hive [data-sell="0"]');
  if (!((await profile()).dna > before)) await fail('selling to Mother Clot paid no DNA');
  const vendorPaid = (await profile()).dna - before;
  const accept = page.locator('#hive .vd-contract .hv-btn.accept:not([disabled])').first();
  let taken = 'none offered';
  if (await accept.count()) {
    await accept.click();
    const active = (await profile()).economy?.contracts?.active ?? {};
    if (!Object.keys(active).length) await fail('accepting a contract did not make it active');
    taken = Object.values(active).join(', ');
  }
  await freezeAndScreenshot(page, 'tests/out/raid-vendors.png');
  log(`Mother Clot: ${vCards} offers, ${contracts} contracts, sold one item for ${vendorPaid} DNA, took ${taken}`);

  // --- Flesh Market through the vendor row: today's stock is listed and selling one stash item pays DNA.
  await page.click('#hive [data-vendor="gulletBroker"]');
  const cards = await page.locator('#hive .mk-card').count();
  if (cards < 1) await fail('Flesh Market shows no stock');
  before = (await profile()).dna;
  await page.click('#hive [data-sell="0"]');
  if (!((await profile()).dna > before)) await fail('selling at the Flesh Market paid no DNA');
  await freezeAndScreenshot(page, 'tests/out/raid-market.png');
  log(`Flesh Market: ${cards} offers, sold one item for ${(await profile()).dna - before} DNA`);

  // --- Raid select into another zone: deploying with a different built zone picked reloads into that map and deploys.
  await page.evaluate(() => { const p = window.__biophage.profile; p.economy.unlocks.push('zone:longSeedWreck'); p.economy.zone = 'longSeedWreck'; });
  await Promise.all([page.waitForNavigation({ timeout: 120000 }), page.evaluate(() => window.__biophage.debug.begin())]);
  await boot();
  for (let i = 0; i < 20; i++) { s = await state(); if (s.phase === 'raid') break; await frames(1); }
  if (s.phase !== 'raid' || s.zone !== 'longSeedWreck') await fail(`zone switch did not deploy into the Wreck: phase ${s.phase}, zone ${s.zone}`);
  await freezeAndScreenshot(page, 'tests/out/raid-wreck.png');
  log('raid select: switched to the Wreck of the Long Seed, reloaded and deployed');

  }

  if (errors.length) await fail(`console errors:\n${errors.join('\n')}`);
  await browser.close();
  server?.kill();
  console.log(`RAID OK [${label}]: Hive deploy, fight, loot, extract, stash across reload, and death all reachable; screenshots in tests/out/raid-*.png`);
  process.exit(0);
} catch (e) {
  await fail(e.stack || e);
}
