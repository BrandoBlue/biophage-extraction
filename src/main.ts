import * as THREE from 'three';
import { haulValue } from '../data';
import { Raid } from './game/raid';
import { RaidHud } from './ui/raid-hud';
import { HiveMenu } from './ui/hive-menu';
import { HiveStage } from './ui/hive-stage';
import { ItemGrid } from './game/grid';
import { browserStorage, deploy, die, extract, loadProfile, saveProfile } from './game/profile';
import { settleContracts } from './game/economy';
import { BUILT_ZONES, buildZone } from './world/zones';
import { createPipeline } from './render/pipeline';
import { installLookdev } from './render/lookdev';
import pkg from '../package.json';

import { creatureViewerRequested, startCreatureViewer } from './creatures/viewer';
import { Sfx } from './audio/sfx';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
/** sessionStorage key: deploy right after the reload that built the newly picked zone. */
const AUTO_DEPLOY = 'biophage.autoDeploy';

// `?creatures` opens the Creature & Mutation specimen viewer instead of a raid.
if (creatureViewerRequested()) startCreatureViewer(canvas);
else bootRaid();

function bootRaid(): void {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1500);
  // Each raid draws its live sites (which Seed Spires open, which Gene Blooms grow, where the anomaly sits)
  // from a fresh seed. `?seed=N` pins it; automated runs use seed 1 (Design's RAID.larva layout) so tests are reproducible.
  const seedParam = Number(new URLSearchParams(location.search).get('seed'));
  const raidSeed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : navigator.webdriver ? 1 : 1 + Math.floor(Math.random() * 1e6);
  // Persistent loop (Larva): boot into the Hive, deploy with the cavity loadout, settle the raid into the profile.
  const storage = browserStorage();
  const loaded = loadProfile(storage);
  const profile = loaded.profile;
  const save = () => { if (!saveProfile(storage, profile)) menu.say('Could not save: browser storage is full or blocked.'); };

  // The world is built once at boot, so it is the zone picked on raid select (`?zone=` overrides for World's look-dev).
  // Picking another zone saves and reloads straight into the deploy (AUTO_DEPLOY).
  const zoneParam = new URLSearchParams(location.search).get('zone');
  const world = buildZone(scene, zoneParam ?? profile.economy.zone, raidSeed);
  const raid = new Raid(scene, camera, canvas, world.layout, world.sites, world.structures);
  new Sfx(raid.bus); // code-generated gun, reload and hit sounds
  const hud = new RaidHud(raid.bus, raid);
  function deployNow(): void {
    if (raid.phase !== 'briefing') return;
    const want = profile.economy.zone;
    if (!zoneParam && want !== world.zone && BUILT_ZONES.includes(want)) {
      save();
      try { sessionStorage.setItem(AUTO_DEPLOY, want); } catch { /* storage blocked: the player presses deploy again */ }
      location.reload();
      return;
    }
    // Contracts and the HUD see the map actually built.
    const d = { ...deploy(profile), zone: world.zone };
    save();
    menu.hide();
    // Lock the mouse for play. Automated runs (tests, playtest bot) skip it: headless pointer lock halves software-rendered fps.
    if (!navigator.webdriver) void Promise.resolve(canvas.requestPointerLock?.()).catch(() => { /* denied: click the canvas to lock */ });
    raid.deploy(d);
  }
  const menu = new HiveMenu(profile, save, deployNow, loaded.notice);
  let auto: string | null = null;
  try { auto = sessionStorage.getItem(AUTO_DEPLOY); sessionStorage.removeItem(AUTO_DEPLOY); } catch { /* storage blocked */ }
  if (auto && auto === world.zone) setTimeout(deployNow, 0); // after boot has wired the pipeline
  raid.bus.on('raidEnd', (e) => {
    const r = raid.outcome!;
    const totals = (entries: typeof r.pouch) => new ItemGrid(99, 99, entries).totals();
    if (e.result === 'extracted') {
      const st = extract(profile, r, e.kills);
      const done = settleContracts(profile, raid.log, true).filter((c) => c.completed);
      save();
      const note = `${st.dnaBanked} DNA banked.${st.overflow.length ? ' Stash full: the rest waits in your cavities.' : ''}${done.length ? ` Contract complete: ${done.map((c) => c.title).join(', ')}.` : ''}`;
      menu.showResults({ result: 'extracted', items: r.items, dna: r.dna, value: r.value, kills: e.kills, time: e.time, note });
    } else {
      die(profile, r, e.kills);
      settleContracts(profile, raid.log, false);
      save();
      const lost = totals(r.cavity);
      menu.showResults({ result: 'lost', items: lost, dna: r.dna, value: haulValue(lost, r.dna), kills: e.kills, time: e.time, cause: r.cause, kept: totals(r.pouch) });
    }
  });


  const pipeline = createPipeline(canvas, scene, camera, 'zone7');
  installLookdev(pipeline, camera, scene);
  raid.pipeline = pipeline;
  const stage = new HiveStage(pipeline);

  function resize(): void {
    const w = innerWidth, h = innerHeight;
    pipeline.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  const prompt = document.querySelector<HTMLElement>('#prompt')!;
  document.querySelector('#build')!.textContent = `v${pkg.version} · SPORE`;
  document.addEventListener('pointerlockchange', () => prompt.classList.toggle('hidden', document.pointerLockElement === canvas));

  let frames = 0;
  // `begin` deploys through the Hive so scripted raids (tests/raid.mjs, scripts/playtest.mjs) follow the real loop.
  const debug = { ...raid.debug(), begin: deployNow };
  const clock = new THREE.Clock();
  pipeline.renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    raid.update(dt);
    // Landmarks (Design's zones.json) count toward contracts the first time the host walks into one.
    if (!menu.visible) { const lm = world.landmarkAt(camera.position.x, camera.position.z); if (lm) raid.visit(lm); }
    hud.update(dt, raid.hud());
    // The main menu draws the 3D Hive lab with the host on its pedestal; other Hive screens cover the whole view, so
    // the 3D frame behind them is skipped (the loop and frame counter keep running). The first frames always render
    // the raid scene so its shaders compile at boot, not on the DEPLOY click.
    menu.stageLive(stage.set(frames >= 3 && menu.wantsStage, profile.host, camera.aspect));
    stage.update(dt);
    if (!menu.visible || frames < 3 || stage.due()) pipeline.render(dt);
    frames++;
    // Read by tests/smoke.mjs and tests/raid.mjs: proves the loop is alive and drives scripted raids.
    (window as unknown as { __biophage: object }).__biophage = { frames, position: camera.position.toArray(), state: raid.testState(), profile, debug, layout: world.layout };
  });
}
