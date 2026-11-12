// The Expanse (World & Level, the 1 km Host map) smoke and look-dev: boots `?zone=expanse`, deploys, checks the
// layout and the creature homes spread over the biomes (bridges and the chasm lip: tests/expanse.test.ts), and captures fixed poses to
// tests/out/expanse-*.png.
//   npm run smoke:expanse              -> smoke + the "aerial" capture (CI)
//   node tests/expanse.mjs --all       -> every pose (look-dev)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
const all = process.argv.includes('--all');
const URL = `http://localhost:${PORT}/?zone=expanse&quality=${process.env.QUALITY || (all ? 'high' : 'low')}`;
// Camera poses: `at` [x, z] with eye height over the ground, or `pos`; yaw 0 looks north (-z).
const POSES = {
  aerial: { pos: [0, 380, 430], yaw: 0, pitch: -0.72 },
  drop: { pos: [10, 70, -30], yaw: 0.1, pitch: -0.3 },
  flats: { at: [-30, -40], eye: 1.7, yaw: 0.35, pitch: 0.08 },
  spires: { at: [150, -105], eye: 1.7, yaw: -1.4, pitch: 0.18 },
  wreck: { at: [-22, 214], eye: 2.2, yaw: -2.36, pitch: 0.04 },
  chasm: { at: [-306, -10], eye: 2, yaw: 1.57, pitch: -0.12 },
  bridge: { at: [-318, -54], eye: 1.7, yaw: 1.4, pitch: -0.04 },
  brood: { at: [-140, -300], eye: 1.7, yaw: 0.43, pitch: 0.12 },
};

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', ...(process.env.OUTDIR ? ['--outDir', process.env.OUTDIR] : [])], { stdio: 'ignore' });
const fail = (msg) => { console.error(`EXPANSE FAIL: ${msg}`); server.kill(); process.exit(1); };
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
  const tLoad = Date.now();
  await page.goto(URL, { timeout: 120000 });
  await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 180000 });
  console.log(`expanse: first frames after ${((Date.now() - tLoad) / 1000).toFixed(1)} s (software rendering)`);
  await page.evaluate(() => window.__biophage.debug.begin());
  await page.waitForFunction(() => window.__biophage.state?.phase === 'raid', null, { timeout: 60000 });

  const s = await page.evaluate(() => {
    const b = window.__biophage;
    return { zone: b.state.zone, radius: b.layout.playableRadius, extracts: b.layout.extracts.length, nests: b.layout.nests.length, creatures: b.state.enemies.map((e) => [e.position[0], e.position[2]]), pos: b.position };
  });
  console.log(`expanse: zone ${s.zone}, radius ${s.radius}, ${s.extracts} extracts, ${s.nests} nests, ${s.creatures.length} creatures, host at ${s.pos.map((v) => v.toFixed(1))}`);
  if (s.zone !== 'expanse' || s.radius !== 500 || s.extracts !== 4 || s.nests !== 2) fail(`not the Expanse layout: ${JSON.stringify({ ...s, creatures: s.creatures.length })}`);
  if (Math.hypot(s.pos[0], s.pos[2] + 100) > 75) fail(`host did not drop into the Glowmire Flats: ${s.pos}`);
  if (s.creatures.length < 15) fail(`creature homes missing: ${s.creatures.length}`);
  // Homes spread over the map, not piled at the centre: some in each half.
  const west = s.creatures.filter(([x]) => x < -150).length, south = s.creatures.filter(([, z]) => z > 150).length, east = s.creatures.filter(([x]) => x > 150).length;
  if (!west || !south || !east) fail(`creatures not spread over the biomes: west ${west}, south ${south}, east ${east}`);

  mkdirSync('tests/out', { recursive: true });
  await page.addStyleTag({ content: '#prompt,#hive{display:none!important}' });
  const t0 = Date.now(), fr0 = await page.evaluate(() => window.__biophage.frames);
  for (const [name, pose] of Object.entries(POSES)) {
    if (!all && name !== 'aerial') continue;
    if (process.env.POSES && !process.env.POSES.split(',').includes(name)) continue;
    await page.evaluate((p) => window.__biophageLookdev.view(p), pose);
    const from = await page.evaluate(() => window.__biophage.frames);
    await page.waitForFunction((f) => window.__biophage.frames > f + 2, from, { timeout: 120000 });
    await page.screenshot({ path: `tests/out/expanse-${name}.png`, timeout: 120000 });
    console.log(`expanse-${name}.png`);
  }
  const fps = ((await page.evaluate(() => window.__biophage.frames)) - fr0) / ((Date.now() - t0) / 1000);
  console.log(`expanse: ${fps.toFixed(2)} fps (software rendering)`);
  await page.evaluate(() => window.__biophageLookdev.clear?.());

  await browser.close();
  const real = errors.filter((e) => !/GPU stall|ReadPixels|swiftshader|Automatic fallback|deprecated/i.test(e));
  if (real.length) fail(real.join('\n'));
  console.log('EXPANSE OK');
  server.kill();
  process.exit(0);
} catch (e) { fail(e.stack || e); }
