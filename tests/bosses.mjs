// The new zone bosses in a raid: the Nethermaw at the bottom of the Marrow Pit and the Mire Regent under the Weeping
// Fen's pool. For each zone: boots `?zone=...`, deploys, checks the boss is there and asleep, walks a host into its
// arena, checks it wakes and acts, captures tests/out/boss-<id>.png, kills it and checks the kill pays out.
//   npm run smoke:bosses
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
const ZONES = [
  { zone: 'marrowPit', key: 'maw', id: 'nethermaw', hit: 'hitMaw', at: (b) => [b.pit.x + 14, b.pit.z + 4] },
  { zone: 'weepingFen', key: 'regent', id: 'mireRegent', hit: 'hitRegent', at: (b) => [b.pool.x + 9, b.pool.z + 3] },
];

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', ...(process.env.OUTDIR ? ['--outDir', process.env.OUTDIR] : [])], { stdio: 'ignore' });
const fail = (msg) => { console.error(`BOSSES FAIL: ${msg}`); server.kill(); process.exit(1); };
const frames = async (page, n) => {
  const f = await page.evaluate(() => window.__biophage.frames);
  await page.waitForFunction(([f0, k]) => window.__biophage.frames > f0 + k, [f, n], { timeout: 180000 });
};
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  mkdirSync('tests/out', { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const Z of ZONES) {
    if (process.env.ZONES && !process.env.ZONES.split(',').includes(Z.zone)) continue;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/?zone=${Z.zone}&quality=${process.env.QUALITY || 'low'}`, { timeout: 120000 });
    await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 180000 });
    await page.evaluate(() => window.__biophage.debug.begin());
    await page.waitForFunction(() => window.__biophage.state?.phase === 'raid', null, { timeout: 60000 });
    await page.addStyleTag({ content: '#prompt,#hive{display:none!important}' });
    const b0 = await page.evaluate((k) => ({ zone: window.__biophage.state.zone, boss: window.__biophage.state[k] }), Z.key);
    if (b0.zone !== Z.zone) fail(`expected ${Z.zone}, got ${b0.zone}`);
    if (!b0.boss) fail(`no ${Z.id} in ${Z.zone}`);
    if (b0.boss.state !== 'dormant') fail(`${Z.id} should sleep until a host comes: ${JSON.stringify(b0.boss)}`);
    // Spawn protection hides the host for the raid's first seconds (raid.json spawn.safeTime): skip past it (the fen
    // draws at well under 1 fps in software rendering, so waiting it out would take minutes).
    await page.evaluate(() => window.__biophage.debug.setTimeLeft(window.__biophage.state.timeLeft - 30));
    await page.evaluate(() => window.__biophage.debug.killAll());
    const [x, z] = Z.at(b0.boss);
    await page.evaluate(([px, pz]) => window.__biophage.debug.teleport(px, pz), [x, z]);
    let b = b0.boss;
    for (let i = 0; i < 60 && b.state !== 'awake'; i++) {
      await frames(page, 1);
      await page.evaluate(([px, pz]) => window.__biophage.debug.teleport(px, pz), [x, z]);
      b = await page.evaluate((k) => window.__biophage.state[k], Z.key);
    }
    if (b.state !== 'awake') fail(`${Z.id} did not wake: ${JSON.stringify(b)}`);
    await frames(page, 6);
    b = await page.evaluate((k) => window.__biophage.state[k], Z.key);
    await page.evaluate((c) => window.__biophage.debug.aimAt(c[0], c[1], c[2]), b.centre);
    await frames(page, 3);
    await page.screenshot({ path: `tests/out/boss-${Z.id}.png`, timeout: 120000 });
    console.log(`bosses: ${Z.id} awake: ${JSON.stringify({ phase: b.phase, action: b.action, fraction: b.fraction })}`);
    const dna0 = await page.evaluate(() => window.__biophage.state.carried.dna);
    await page.evaluate((h) => window.__biophage.debug[h](1e6, null), Z.hit);
    await frames(page, 3);
    const end = await page.evaluate((k) => ({ b: window.__biophage.state[k], bosses: window.__biophage.state.log.bosses, dna: window.__biophage.state.carried.dna }), Z.key);
    if (end.b.state !== 'dead' || !end.bosses.includes(Z.id) || end.dna <= dna0) fail(`${Z.id} kill did not pay out: ${JSON.stringify({ state: end.b.state, bosses: end.bosses, dna: end.dna, dna0 })}`);
    console.log(`bosses: ${Z.id} woke, acted and was killed: +${end.dna - dna0} DNA`);
    const real = errors.filter((e) => !/GPU stall|ReadPixels|swiftshader|Automatic fallback|deprecated/i.test(e));
    if (real.length) fail(real.join('\n'));
    await page.close();
  }
  await browser.close();
  console.log('BOSSES OK');
  server.kill();
  process.exit(0);
} catch (e) { fail(e.stack || e); }
