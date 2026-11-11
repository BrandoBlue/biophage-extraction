// Creature viewer smoke + look-dev capture (Creature & Mutation).
//   npm run smoke:creatures            -> CI: opens ?creatures on the built preview, shows every species, mutates,
//                                          severs a limb, and saves tests/out/creatures-*.png. Fails on page errors.
//   QUALITY=high node tests/creatures.mjs lineup needlemaw   -> look-dev captures of chosen shots only.
// Software rendering is slow: always wait on window.__biophage.frames, never on wall-clock time.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { freezeAndScreenshot } from './lib/harness.mjs';

const PORT = 4176;
const quality = process.env.QUALITY || 'low';
const env = process.env.ENV || 'hive';
const base = `http://localhost:${PORT}/?creatures&quality=${quality}&env=${env}`;
// CI default is small: software rendering cost scales with pixels (look-dev passes W and H).
const width = Number(process.env.W || 960), height = Number(process.env.H || 540);
const SHOTS = {
  lineup: { lineup: 0 },
  needlemaw: { show: ['needlemaw', 7, 0], view: [0.7, 0.15, 1] },
  bilecantor: { show: ['bilecantor', 7, 0], view: [0.5, 0.05, 1] },
  glasswalker: { show: ['glasswalker', 7, 0], view: [0.8, 0.1, 1] },
  oculimoth: { show: ['oculimoth', 7, 0], view: [0.4, 0.05, 1] },
  mournback: { show: ['mournback', 7, 0], view: [0.9, 0.15, 1] },
  mutated: { lineup: 3 },
  walk: { show: ['glasswalker', 7, 0], walk: true, view: [0.3, 0.35, 1.3], wait: 40 },
  mutate: { show: ['needlemaw', 7, 0], mutate: 3, view: [0.7, 0.2, 1], wait: 12 },
  sever: { show: ['mournback', 7, 0], sever: 'legL0', view: [1.2, 0.2, 1], wait: 10 },
  nest: { call: ['nest'], view: [0.5, 0.18, 1], then: ['pulse'], wait: 3, expect: (st) => st.extra === 'nest' && st.nestWeak > 0 },
  organs: { call: ['organs'], view: [0, 0.25, 1], expect: (st) => st.extra === 'organs' },
  hosts: { call: ['host', 'neuroInfiltrator'], view: [0.35, 0.08, 1], expect: (st) => st.host === 'neuroInfiltrator' },
  boss: { call: ['boss'], view: [0.15, 0.05, 0.8], then: ['phase', 'bloom'], wait: 6, expect: (st) => st.extra === 'boss' && st.boss?.phase === 'bloom' && st.boss.legs === 6 && st.boss.weak === 4 },
  warden: { call: ['warden'], view: [0.9, 0.45, 1.1], then: ['wardenPhase', 'overheat'], wait: 10, expect: (st) => st.extra === 'warden' && st.warden?.phase === 'overheat' && st.warden.pods === 5 },
  weapons: { call: ['weapons'], view: [0.25, 0.15, 1], then: ['graftGuns'], wait: 40, expect: (st) => st.extra === 'weapons' && st.weapons === 15 },
  arm: { call: ['arm'], view: [0.3, 0.3, 1], then: ['arm', 'plagueStalkerStrain'], wait: 8, expect: (st) => st.arm === 'plagueStalkerStrain' },
};
const only = process.argv.slice(2);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const fail = (msg) => { console.error(`CREATURES FAIL: ${msg}`); server.kill(); process.exit(1); };
try {
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) fail('vite preview did not start');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__biophage?.frames > 2, null, { timeout: 180000 });
  mkdirSync('tests/out', { recursive: true });
  const waitFrames = async (n) => {
    const from = await page.evaluate(() => window.__biophage.frames);
    await page.waitForFunction(([f, k]) => window.__biophage.frames > f + k, [from, n], { timeout: 180000 });
  };
  if (process.env.HIDEUI) await page.addStyleTag({ content: '#viewer{display:none!important}' });
  for (const [name, s] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(name)) continue;
    if (s.lineup !== undefined) await page.evaluate((st) => window.__biophageViewer.lineup(st), s.lineup);
    if (s.show) await page.evaluate((a) => window.__biophageViewer.show(...a), s.show);
    if (s.call) await page.evaluate(([m, ...a]) => window.__biophageViewer[m](...a), s.call);
    if (s.view) await page.evaluate((v) => window.__biophageViewer.view(...v), s.view);
    await page.evaluate((w) => window.__biophageViewer.walk(!!w), s.walk);
    await waitFrames(3);
    if (s.mutate) await page.evaluate((m) => window.__biophageViewer.mutate(m), s.mutate);
    if (s.then) await page.evaluate(([m, ...a]) => window.__biophageViewer[m](...a), s.then);
    if (s.sever && !(await page.evaluate((id) => window.__biophageViewer.sever(id), s.sever))) fail(`could not sever ${s.sever}`);
    await waitFrames(s.wait ?? 3);
    const state = await page.evaluate(() => window.__biophageViewer.state());
    if (s.mutate && state.stage !== s.mutate) fail(`mutate: stage ${state.stage}`);
    if (s.sever && state.creatures[0].severed < 1) fail('sever: no limb severed');
    if (s.expect && !s.expect(state)) fail(`${name}: unexpected state ${JSON.stringify(state)}`);
    await freezeAndScreenshot(page, `tests/out/creatures-${name}${env === 'zone7' ? '-zone7' : ''}.png`, { resume: true });
    console.log(`creatures-${name}.png`, JSON.stringify(await page.evaluate(() => window.__biophageViewer.stats())));
  }
  await browser.close();
  const real = errors.filter((e) => !/GPU stall|ReadPixels|swiftshader|Automatic fallback|deprecated/i.test(e));
  if (real.length) fail(real.join('\n'));
  server.kill();
  process.exit(0);
} catch (e) { fail(e.stack || e); }
