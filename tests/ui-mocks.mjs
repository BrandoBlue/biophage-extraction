// Captures every Hive mock screen for look review: starts `vite` (dev server, which serves mocks/ui.html),
// screenshots each screen at 1920x1080 and writes tests/out/ui/<screen>.png. `npm run mocks`.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5179/mocks/';
const URL = `${BASE}ui.html`;
const screens = (process.argv[2] ?? 'menu,host,stash,arms,raid,market,vendors,archivist,settings,won,lost,hud:fight,hud:inject,hud:mutated,hud:harvest,hud:extract,hud:low,hud:cavity,hud:boss,hud:gear,hud:prompt').split(',');
const server = spawn('npx', ['vite', '--port', '5179', '--strictPort'], { stdio: 'ignore' });
const fail = (m) => { console.error(`MOCKS FAIL: ${m}`); server.kill(); process.exit(1); };
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(URL)).ok; } catch { /* not yet */ } if (!up) await new Promise((r) => setTimeout(r, 250)); }
  if (!up) fail('vite did not start');
  mkdirSync('tests/out/ui', { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  for (const s of screens) {
    const [page_, arg] = s.startsWith('hud:') ? ['hud.html?state=', s.slice(4)] : ['ui.html?screen=', s];
    await page.goto(`${BASE}${page_}${arg}`);
    await page.waitForFunction(() => window.__mock?.ready, null, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(Number(process.env.WAIT ?? 700));
    await page.screenshot({ path: `tests/out/ui/${s.replace(':', '-')}.png` });
    console.log(`captured ${s}`);
  }
  await browser.close();
  if (errors.length) fail(errors.join('\n'));
  server.kill();
  process.exit(0);
} catch (e) { fail(e.stack || e); }
