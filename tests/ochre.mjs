// The Ochre Reach (desert zone) smoke and look-dev: boots `?zone=ochreReach`, deploys, checks the zone, its homes and
// a buried pack bursting out of the sand, and captures fixed poses to tests/out/ochre-*.png.
//   npm run smoke:ochre               -> smoke + the "spawn" capture (CI)
//   node tests/ochre.mjs --all        -> every pose (look-dev)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4178;
const all = process.argv.includes('--all');
const URL = `http://localhost:${PORT}/?zone=ochreReach&quality=${process.env.QUALITY || (all ? 'high' : 'low')}`;
// Camera poses: `at` [x, z] with eye height over the ground, or `pos`; yaw 0 looks north (-z).
const POSES = {
  spawn: { at: [40, 352], eye: 1.7, yaw: 0.07, pitch: 0.04 },
  aerial: { pos: [40, 110, 330], yaw: 0.06, pitch: -0.28 },
  village: { at: [24, 122], eye: 1.7, yaw: 0.05, pitch: 0.06 },
  hutDoor: { at: [21, 60], eye: 1.7, yaw: 0, pitch: 0.12 },
  hutInside: { at: [20, 44], eye: 1.7, yaw: 0.3, pitch: 0.18 },
  rig: { at: [-170, -6], eye: 1.8, yaw: 1.1, pitch: 0.14 },
  dunes: { at: [180, -60], eye: 2, yaw: -0.55, pitch: 0.02 },
  colossus: { at: [196, -168], eye: 1.8, yaw: -2.2, pitch: 0.16 },
  gulch: { at: [-90, 205], eye: 1.8, yaw: 1.75, pitch: 0.06 },
  crater: { at: [0, -212], eye: 4, yaw: 0.59, pitch: -0.12 },
  flats: { at: [118, 300], eye: 1.7, yaw: -0.52, pitch: 0.03 },
};

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', ...(process.env.OUTDIR ? ['--outDir', process.env.OUTDIR] : [])], { stdio: 'ignore' });
const fail = (msg) => { console.error(`OCHRE FAIL: ${msg}`); server.kill(); process.exit(1); };
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { timeout: 120000 });
  await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 180000 });
  await page.evaluate(() => window.__biophage.debug.begin());
  await page.waitForFunction(() => window.__biophage.state?.phase === 'raid', null, { timeout: 60000 });

  // The zone and its homes.
  const s = await page.evaluate(() => {
    const b = window.__biophage;
    return { zone: b.state.zone, spawns: b.layout.spawns?.length ?? 0, radius: b.layout.playableRadius, creatures: b.state.enemies.length, pos: b.position };
  });
  console.log(`ochre: ${JSON.stringify(s)}`);
  if (s.radius !== 400 || s.spawns < 10) fail(`not the Ochre Reach layout: ${JSON.stringify(s)}`);
  if (Math.hypot(s.pos[0] - 40, s.pos[2] - 352) > 3) fail(`host did not start at the south spawn: ${s.pos}`);

  if (s.zone !== 'ochreReach' || s.creatures < 20) fail(`zone or creature homes missing: ${JSON.stringify(s)}`);

  mkdirSync('tests/out', { recursive: true });
  await page.addStyleTag({ content: '#prompt,#hive{display:none!important}' });
  const t0 = Date.now(), fr0 = await page.evaluate(() => window.__biophage.frames);
  for (const [name, pose] of Object.entries(POSES)) {
    if (!all && name !== 'spawn') continue;
    if (process.env.POSES && !process.env.POSES.split(',').includes(name)) continue;
    await page.evaluate((p) => window.__biophageLookdev.view(p), pose);
    const from = await page.evaluate(() => window.__biophage.frames);
    await page.waitForFunction((f) => window.__biophage.frames > f + 2, from, { timeout: 120000 });
    await page.screenshot({ path: `tests/out/ochre-${name}.png`, timeout: 120000 });
    console.log(`ochre-${name}.png`);
  }
  const fps = ((await page.evaluate(() => window.__biophage.frames)) - fr0) / ((Date.now() - t0) / 1000);
  console.log(`ochre: ${fps.toFixed(2)} fps (software rendering)`);
  await page.evaluate(() => window.__biophageLookdev.clear?.());
  // A buried pack in the Dune Sea: under the sand until the host walks up, then out and on the surface.
  const den = [200, -108];
  const under = await page.evaluate(([x, z]) => window.__biophage.state.enemies.filter((e) => Math.hypot(e.position[0] - x, e.position[2] - z) < 9), den);
  if (!under.length) fail('no creatures at the Dune Sea den');
  await page.evaluate(([x, z]) => window.__biophage.debug.teleport(x, z + 30), den);
  const f0 = await page.evaluate(() => window.__biophage.frames);
  await page.waitForFunction((f) => window.__biophage.frames > f + 3, f0, { timeout: 60000 });
  const buried = await page.evaluate(([x, z]) => window.__biophage.state.enemies.filter((e) => Math.hypot(e.position[0] - x, e.position[2] - z) < 9), den);
  // The host is hidden for the raid's first seconds (raid.json spawn.safeTime): wait it out, then walk up.
  // The raid clock is the zone's own length (zones.json raidTime).
  const raidTime = JSON.parse(readFileSync('data/zones.json', 'utf8')).ochreReach.raidTime;
  await page.waitForFunction((t) => window.__biophage.state.timeLeft < t - 9, raidTime, { timeout: 240000 });
  await page.evaluate(([x, z]) => window.__biophage.debug.teleport(x, z + 3), den);
  const f1 = await page.evaluate(() => window.__biophage.frames);
  await page.waitForFunction((f) => window.__biophage.frames > f + 30, f1, { timeout: 120000 });
  const out = await page.evaluate(([x, z]) => window.__biophage.state.enemies.filter((e) => Math.hypot(e.position[0] - x, e.position[2] - z) < 25), den);
  // Lying in wait they do not move; once out they hunt (the sink itself is covered by tests/burrow.test.ts).
  const still = buried.every((e) => { const u = under.find((q) => q.id === e.id); return u && Math.hypot(u.position[0] - e.position[0], u.position[2] - e.position[2]) < 0.01; });
  const hunting = out.filter((e) => e.state !== 'idle').length;
  console.log(`ochre: den of ${buried.length} lay still: ${still}; after the host walked up: ${out.map((e) => e.state).join(', ')}`);
  if (!still || !hunting) fail('the buried pack did not wait under the sand and then come out hunting');

  // The Sandwidow (PvE AI): under the Skyfall Crater until a host steps onto its floor; up to breathe, she can be killed.
  const sw0 = await page.evaluate(() => window.__biophage.state.widow);
  if (!sw0) fail('no Sandwidow under the Skyfall Crater');
  await page.evaluate(() => window.__biophage.debug.killAll());
  await page.evaluate(([x, z]) => window.__biophage.debug.teleport(x + 8, z + 8), [sw0.crater.x, sw0.crater.z]);
  let sw = sw0;
  for (let i = 0; i < 60 && sw.state !== 'awake'; i++) {
    const f = await page.evaluate(() => window.__biophage.frames);
    await page.waitForFunction((k) => window.__biophage.frames > k + 1, f, { timeout: 60000 });
    sw = await page.evaluate(() => window.__biophage.state.widow);
  }
  if (sw.state !== 'awake') fail(`the Sandwidow did not wake: ${JSON.stringify(sw)}`);
  await page.evaluate(() => window.__biophage.debug.surfaceWidow(8));
  const f2 = await page.evaluate(() => window.__biophage.frames);
  await page.waitForFunction((f) => window.__biophage.frames > f + 4, f2, { timeout: 120000 });
  sw = await page.evaluate(() => window.__biophage.state.widow);
  await page.evaluate((c) => window.__biophage.debug.aimAt(c[0], c[1], c[2]), sw.centre);
  const f3 = await page.evaluate(() => window.__biophage.frames);
  await page.waitForFunction((f) => window.__biophage.frames > f + 2, f3, { timeout: 120000 });
  await page.screenshot({ path: 'tests/out/ochre-widow.png', timeout: 120000 });
  const dna0 = await page.evaluate(() => window.__biophage.state.carried.dna);
  await page.evaluate(() => window.__biophage.debug.hitWidow(1e6, null));
  const f4 = await page.evaluate(() => window.__biophage.frames);
  await page.waitForFunction((f) => window.__biophage.frames > f + 2, f4, { timeout: 120000 });
  const end = await page.evaluate(() => ({ w: window.__biophage.state.widow, bosses: window.__biophage.state.log.bosses, dna: window.__biophage.state.carried.dna }));
  if (end.w.state !== 'dead' || !end.bosses.includes('sandwidow') || end.dna <= dna0) fail(`the Sandwidow kill did not pay out: ${JSON.stringify(end)}`);
  console.log(`ochre: the Sandwidow woke in the crater, surfaced and was killed: +${end.dna - dna0} DNA`);

  await browser.close();
  const real = errors.filter((e) => !/GPU stall|ReadPixels|swiftshader|Automatic fallback|deprecated/i.test(e));
  if (real.length) fail(real.join('\n'));
  console.log('OCHRE OK');
  server.kill();
  process.exit(0);
} catch (e) { fail(e.stack || e); }
