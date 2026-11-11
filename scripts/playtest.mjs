// Game Design playtest bot: plays whole Spore raids with a simple human-like policy and prints balance metrics.
//   npm run build && node scripts/playtest.mjs [rush|full|greedy] [runs] [timeScale]
// Not part of CI. Used for tuning passes; results go in data/CHANGELOG.md.
// Policy: walk/sprint toward the goal (Bio-Pod, then Seed Spire), managing Neural Overload; stop and shoot the
// nearest threat inside engage range, aiming at its centre with a human-ish aim error; heal under 40% Biomass.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const mode = process.argv[2] ?? 'full';
const runs = Number(process.argv[3] ?? 3);
const timeScale = Number(process.argv[4] ?? 2);
const URL = 'http://localhost:4173/';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(URL)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const results = [];
for (let run = 0; run < runs; run++) {
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  // Skip rasterisation: the simulation still runs every frame, but software WebGL stops being the bottleneck.
  await page.addInitScript(() => {
    for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
      for (const m of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (C.prototype[m]) C.prototype[m] = function () {};
    }
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__biophage?.frames > 3, null, { timeout: 90000 });
  const out = await page.evaluate(([mode, run, timeScale]) => new Promise((done) => {
    const B = window.__biophage, d = B.debug;
    d.setTimeScale(timeScale);
    d.begin();
    const engage = mode === 'rush' ? 14 : 32;
    let seed = 1234 + run * 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const log = { minBiomass: 1e9, damageTaken: 0, overloads: 0, heals: 0, firstContact: null, podAt: null, timeline: [] };
    let lastBio = null, wasOver = false, lastSample = -1, stuck = 0, lastPos = null;
    const tick = () => {
      const s = B.state;
      if (s.phase === 'briefing') { requestAnimationFrame(tick); return; }
      if (s.phase !== 'raid') {
        done({ result: s.phase, elapsed: 600 - s.timeLeft, kills: s.kills, value: s.result?.value ?? s.carried.value, ...log });
        return;
      }
      const t = 600 - s.timeLeft;
      if (lastBio !== null && s.biomass < lastBio) log.damageTaken += lastBio - s.biomass;
      lastBio = s.biomass; log.minBiomass = Math.min(log.minBiomass, s.biomass);
      if (s.overloaded && !wasOver) log.overloads++;
      wasOver = s.overloaded;
      const [px, , pz] = B.position;
      const alive = s.enemies.filter((e) => e.alive).map((e) => ({ ...e, dist: Math.hypot(e.position[0] - px, e.position[2] - pz) }));
      const threat = alive.filter((e) => e.dist < engage && (e.state !== 'idle' || mode !== 'rush')).sort((a, b) => a.dist - b.dist)[0];
      if (Math.floor(t / 10) !== lastSample) { lastSample = Math.floor(t / 10); log.timeline.push([Math.round(t), Math.round(s.biomass), Math.round(s.overload), s.kills, alive.filter((e) => e.state !== 'idle').length]); }
      if (s.biomass < 80 && s.carried.items.some((i) => i.item === 'clotGel')) { d.ability(2); log.heals++; }
      if (threat) {
        if (log.firstContact === null) log.firstContact = Math.round(t);
        const err = Math.min(1.2, threat.dist * 0.03);
        d.aimAt(threat.centre[0] + (rnd() - 0.5) * err, threat.centre[1] + (rnd() - 0.5) * err, threat.centre[2] + (rnd() - 0.5) * err);
        d.trigger(true);
        d.hold('KeyW', false); d.hold('ShiftLeft', false); d.hold('KeyE', false);
        if (s.ego >= 30 && threat.dist < 25) d.ego();
      } else {
        d.trigger(false);
        const pod = s.pods.find((p) => !p.opened);
        const goal = mode !== 'rush' && pod ? pod.position : s.extractPosition;
        const gd = Math.hypot(goal[0] - px, goal[1] - pz);
        d.aimAt(goal[0], B.position[1], goal[1]);
        if (pod && goal === pod.position && gd < 1.8) {
          d.hold('KeyW', false); d.hold('KeyE', true);
        } else {
          d.hold('KeyE', false);
          if (pod === undefined && log.podAt === null && mode !== 'rush') log.podAt = Math.round(t);
          if (mode === 'greedy' && !pod && s.timeLeft > 150 && gd < 12) { d.hold('KeyW', false); }
          else d.hold('KeyW', gd > 1);
          d.hold('ShiftLeft', !s.overloaded && s.overload < 70);
        }
        // nudge if stuck on geometry
        if (lastPos && Math.hypot(px - lastPos[0], pz - lastPos[1]) < 0.002) stuck++; else stuck = 0;
        if (stuck > 60) { d.hold('Space', true); setTimeout(() => d.hold('Space', false), 50); stuck = 0; }
      }
      lastPos = [px, pz];
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [mode, run, timeScale]);
  results.push(out);
  console.log(JSON.stringify({ run, mode, ...out, timeline: undefined }));
  console.log('  timeline [t, biomass, overload, kills, engaged]:', JSON.stringify(out.timeline));
  await page.close();
}
await browser.close();
server.kill();
const ok = results.filter((r) => r.result === 'extracted').length;
const avg = (k) => (results.reduce((s, r) => s + r[k], 0) / results.length).toFixed(1);
console.log(`\n${mode}: extracted ${ok}/${results.length}; avg time ${avg('elapsed')} s, kills ${avg('kills')}, damage taken ${avg('damageTaken')}, overloads ${avg('overloads')}, value ${avg('value')}`);
