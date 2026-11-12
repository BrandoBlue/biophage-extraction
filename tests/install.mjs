// Installable-app check for the GitHub Pages build (desktop icon, Brandon 2026-11-12):
// stages site/ the way the Pages workflow does, serves it over http://localhost (a secure context), and checks that
// Chromium finds no installability errors, the service worker takes control, Settings shows the install control,
// and the installed app (display-mode standalone) goes borderless fullscreen on the first click.
//   npm run release && npm run smoke:install
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { freezeAndScreenshot } from './lib/harness.mjs';

const SITE = 'tests/out/site';
const fail = (msg) => { console.error(`INSTALL FAIL: ${msg}`); process.exit(1); };
const log = (msg) => console.log(`install: ${msg}`);
if (!existsSync('release/index.html')) fail('release/index.html missing; run `npm run release` first');
mkdirSync('tests/out', { recursive: true });
execFileSync('node', ['scripts/stage-pages.mjs', SITE], { stdio: 'inherit' });

// Served under a sub-path, like https://brandoblue.github.io/biophage-extraction/.
const BASE = '/biophage-extraction/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) { res.writeHead(404).end(); return; }
  let file = normalize(join(SITE, path.slice(BASE.length) || 'index.html'));
  if (!file.startsWith(normalize(SITE))) { res.writeHead(403).end(); return; }
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(4175, '127.0.0.1', r));
const url = `http://localhost:4175${BASE}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__biophage?.frames > 0, null, { timeout: 90000 });

  const cdp = await ctx.newCDPSession(page);
  const man = await cdp.send('Page.getAppManifest');
  if (man.errors?.length) fail(`manifest errors: ${JSON.stringify(man.errors)}`);
  const manifest = JSON.parse(man.data ?? '{}');
  if (!man.url.endsWith(`${BASE}manifest.webmanifest`)) fail(`manifest at ${man.url}`);
  if (manifest.start_url !== './' || manifest.scope !== './') fail('start_url and scope must be relative for the Pages sub-path');
  log(`manifest ${man.url}: ${manifest.name}, display ${manifest.display}`);
  for (const i of manifest.icons) {
    const r = await page.request.get(new URL(i.src, man.url).href);
    if (!r.ok() || !(r.headers()['content-type'] ?? '').startsWith('image/png')) fail(`icon ${i.src} not served`);
  }
  log(`${manifest.icons.length} icons served`);

  await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.active), null, { timeout: 30000 }).catch(() => fail('service worker never activated'));
  await page.reload();
  await page.waitForFunction(() => window.__biophage?.frames > 0 && !!navigator.serviceWorker.controller, null, { timeout: 90000 });
  log('service worker controls the page');
  const inst = await cdp.send('Page.getInstallabilityErrors');
  if (inst.installabilityErrors.length) fail(`not installable: ${JSON.stringify(inst.installabilityErrors)}`);
  log('Chromium reports no installability errors');

  // Settings carries the desktop-icon control: the Install button when the browser offers it, plain steps otherwise.
  await page.click('#hive [data-go="settings"]');
  await page.waitForSelector('#hive .set-app');
  const control = await page.$eval('#hive .set-app', (el) => el.textContent?.trim() ?? '');
  if (!control) fail('Settings has no install control');
  log(`settings: "${control}"`);
  await freezeAndScreenshot(page, 'tests/out/install-settings.png', { resume: true });

  // The installed app (its own window) goes borderless fullscreen on the first click.
  const app = await ctx.newPage();
  await app.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.includes('display-mode: standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
  });
  await app.goto(url);
  await app.waitForFunction(() => window.__biophage?.frames > 0, null, { timeout: 90000 });
  if (await app.evaluate(() => !!document.fullscreenElement)) fail('fullscreen before any click');
  await app.mouse.click(5, 300);
  await app.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 10000 }).catch(() => fail('installed app did not go fullscreen on the first click'));
  log('installed app goes fullscreen on the first click');
  if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
  console.log('INSTALL OK');
} finally {
  await browser.close();
  server.close();
}
