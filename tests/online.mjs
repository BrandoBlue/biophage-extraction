// Online raid (Hive): two players in one raid, in two pages of one headless browser, over the same-browser link
// (`?net=local`, BroadcastChannel). The WebRTC transport carries exactly the same messages between machines.
//   npm run smoke:online             -> against dist/ via `vite preview` (run `npm run build` first)
//   npm run smoke:online -- --release -> against release/index.html from disk
// Checks: the leader opens a squad, the guest joins by code and picks the rival side, the leader's Deploy drops both,
// each sees the other's body move, a shot from one hurts the other, creatures are the leader's (the guest's kill is
// decided on the leader's machine and both agree), and a death reaches the other player.
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
const CODE = 'TEST7';
let server;
let browser;
const fail = async (msg) => { console.error(`ONLINE FAIL [${label}]: ${msg}`); await browser?.close(); server?.kill(); process.exit(1); };
const log = (msg) => console.log(`online [${label}]: ${msg}`);

try {
  let base = PREVIEW_URL;
  if (release) {
    const file = resolve('release/index.html');
    if (!existsSync(file)) await fail('release/index.html missing; run `npm run release` first');
    base = pathToFileURL(file).href;
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
  // One context: BroadcastChannel joins pages of the same origin and profile.
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const errors = [];
  const open = async (who, query) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${who}: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who}: ${m.text()}`); });
    await page.goto(`${base}?net=local&seed=1&nodrop${query}`, { waitUntil: 'commit', timeout: 180000 });
    await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 180000 });
    return page;
  };
  mkdirSync('tests/out', { recursive: true });
  const st = (p) => p.evaluate(() => window.__biophage.state);
  const net = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__biophage.net, (k, v) => (typeof v === 'function' ? undefined : v))));
  const call = (p, fn, ...args) => p.evaluate(([f, a]) => window.__biophage.debug[f](...a), [fn, args]);
  const netCall = (p, fn, ...args) => p.evaluate(([f, a]) => window.__biophage.net[f](...a), [fn, args]);
  const frames = async (p, n) => {
    const target = await p.evaluate((k) => window.__biophage.frames + k, n);
    await p.waitForFunction((t) => window.__biophage.frames >= t, target, { timeout: 240000 });
  };
  /** Waits until `check(leaderNet, guestNet)` holds, stepping frames on both pages. */
  const until = async (what, check, tries = 60) => {
    for (let i = 0; i < tries; i++) {
      const [a, b] = await Promise.all([net(lead), net(guest)]);
      if (await check(a, b)) return [a, b];
      await Promise.all([frames(lead, 1), frames(guest, 1)]);
    }
    await fail(`timed out waiting for ${what}: ${JSON.stringify(await net(lead))} / ${JSON.stringify(await net(guest))}`);
  };

  // --- Lobby.
  const lead = await open('leader', '');
  await netCall(lead, 'host', CODE);
  const guest = await open('guest', `&join=${CODE}`);
  await until('the guest to join the lobby', (a, b) => a.state === 'lobby' && b.state === 'lobby' && a.members.length === 2 && b.members.length === 2);
  if (!(await lead.isVisible('#hivemind'))) await fail('Hive-Mind panel is not shown in the Hive');
  const code = await lead.textContent('#hivemind .hm-code');
  if (code?.trim() !== CODE) await fail(`panel shows code "${code}", expected ${CODE}`);
  await netCall(guest, 'side', 1);
  await until('the guest to switch to the rival side', (a) => a.members.some((m) => m.squad === 1));
  await freezeAndScreenshot(lead, 'tests/out/online-lobby.png', { resume: true });
  log('lobby: guest joined by code and picked the rival side');

  // --- The guest cannot start the raid; the leader's Deploy drops both.
  await call(guest, 'begin');
  await frames(guest, 1);
  if ((await st(guest)).phase !== 'briefing') await fail('a guest started the raid on its own');
  await call(lead, 'begin');
  await until('both hosts in the raid', async () => (await st(lead)).phase === 'raid' && (await st(guest)).phase === 'raid');
  for (const p of [lead, guest]) await call(p, 'setTimeScale', 2);
  const sl = await st(lead), sg = await st(guest);
  log(`deployed: leader at ${sl.carried ? 'spawn' : '?'}, ${sl.enemies.length} creatures on the leader, ${sg.enemies.length} on the guest`);
  const [ln0, gn0] = await until('creature pairing', (a, b) => b.raid?.paired >= sl.enemies.length && !b.raid.authority && a.raid.authority);
  if (ln0.raid.paired !== 0 && !ln0.raid.authority) await fail('leader lost authority');
  if (gn0.raid.paired < sl.enemies.length) await fail(`guest paired ${gn0.raid.paired} of ${sl.enemies.length} creatures`);

  // --- Each sees the other move.
  const pos = async (p) => p.evaluate(() => window.__biophage.position);
  const lp = await pos(lead);
  await call(guest, 'teleport', lp[0] + 6, lp[2] - 6);
  const [, seen] = await until('the guest to see the leader and the leader to see the guest where it stands', async (a, b) => {
    const g = await pos(guest);
    const rg = a.raid.remotes[0], rl = b.raid.remotes[0];
    // The guest's own frame must show the teleport too: before it does, both pages still agree on the spawn point.
    return rg && rl && rg.present && rl.present && Math.hypot(g[0] - lp[0] - 6, g[2] - lp[2] + 6) < 0.5 && Math.hypot(rg.position[0] - g[0], rg.position[2] - g[2]) < 0.5;
  });
  log(`bodies: leader sees guest, guest sees leader (${seen.raid.remotes[0].name})`);

  // --- PvP: the leader shoots the rival guest.
  const before = (await st(guest)).biomass;
  const g = await pos(guest);
  await call(lead, 'aimAt', g[0], g[1] - 0.35, g[2]);
  await call(lead, 'trigger', true);
  await until('a shot to hurt the guest', async () => (await st(guest)).biomass < before, 40);
  await call(lead, 'trigger', false);
  await call(lead, 'clearAim');
  log(`pvp: guest biomass ${before} -> ${(await st(guest)).biomass}`);
  await freezeAndScreenshot(lead, 'tests/out/online-raid.png', { resume: true });

  // --- The leader's tab goes to the background: drawing stops, but the shared raid must keep running.
  await lead.evaluate(() => {
    window.__biophageRaf ??= window.requestAnimationFrame;
    window.__biophagePending = null;
    window.requestAnimationFrame = (cb) => { window.__biophagePending = cb; return 0; }; // no frames, as in a hidden tab
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  const gotBefore = (await net(guest)).raid.received;
  await new Promise((r) => setTimeout(r, 4000)); // wall clock on purpose: the hidden-tab timer is wall-clock
  await frames(guest, 2);
  const gotAfter = (await net(guest)).raid.received;
  await lead.evaluate(() => {
    delete document.hidden;
    window.requestAnimationFrame = window.__biophageRaf;
    const cb = window.__biophagePending;
    window.__biophagePending = null;
    if (cb) window.requestAnimationFrame(cb);
  });
  if (gotAfter - gotBefore < 20) await fail(`the leader's hidden tab stopped sending (${gotAfter - gotBefore} messages in 4 s)`);
  log(`background: the hidden leader kept sending (${gotAfter - gotBefore} messages in 4 s)`);

  // --- Creatures: the guest kills one; the leader decides it, both agree, the guest gets the credit.
  const alive = (s) => s.enemies.filter((e) => e.alive).length;
  const kills0 = (await st(guest)).kills;
  const aliveLead0 = alive(await st(lead));
  const target = (await st(guest)).enemies.find((e) => e.alive);
  if (!target) await fail('no living creature on the guest');
  // killAll goes through the same path as a bullet: on a guest the damage is sent to the leader.
  await call(guest, 'killAll');
  await until('the leader to apply the guest\'s kills', async () => alive(await st(lead)) < aliveLead0);
  await until('both to agree every creature is dead', async () => alive(await st(lead)) === 0 && alive(await st(guest)) === 0);
  const kills1 = (await st(guest)).kills;
  if (kills1 <= kills0) await fail(`the guest got no kill credit (${kills0} -> ${kills1})`);
  if ((await st(lead)).kills !== 0) await fail('the leader was credited with the guest\'s kills');
  log(`creatures: guest killed ${kills1 - kills0}, leader agrees all dead`);

  // --- A death reaches the other host.
  await call(guest, 'damage', 9999);
  await until('the leader to see the guest go down', (a) => a.raid.remotes[0] && !a.raid.remotes[0].alive);
  if ((await st(guest)).phase !== 'lost') await fail('the guest did not die');
  log('death: the leader sees the guest fall');

  const bad = errors.filter((e) => !/WebGL|GPU stall|Automatic fallback|swiftshader/i.test(e));
  if (bad.length) await fail(`page errors: ${bad.slice(0, 5).join(' | ')}`);
  log('PASS');
  await browser.close();
  server?.kill();
} catch (e) {
  await fail(e?.stack ?? String(e));
}
