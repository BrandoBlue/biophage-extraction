import * as THREE from 'three';
import { awardXp, raidXp } from './game/progression';
import { haulValue, weaponSpec, ZONE7_SITES } from '../data';
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
import { GameAudio } from './audio';
import { getSettings, type Settings } from './ui/settings';
import { ZONE_GRADE } from './render/presets';
import { organicize } from './render/organic';
import { caveDistance } from './world/cave';
import { layerAt } from './world/pit';
import { AUDIO } from './audio';
import pkg from '../package.json';
import { Online } from './net';
import { initInstall } from './ui/install';

import { creatureViewerRequested, startCreatureViewer } from './creatures/viewer';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
/** sessionStorage key: deploy right after the reload that built the newly picked zone. */
const AUTO_DEPLOY = 'biophage.autoDeploy';

initInstall();

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
  // Nothing in the world should read as machined: boxes, cylinders and cones are grown into organic shapes (src/render/organic).
  organicize(scene);
  const raid = new Raid(scene, camera, canvas, world.layout, world.sites, world.structures, world.zone);
  const hud = new RaidHud(raid.bus, raid);
  function deployNow(): void {
    if (raid.phase !== 'briefing') return;
    // Online squads (src/net): guests wait for the leader; the leader's Deploy drops everyone into the raid it built.
    const gate = online.deployGate();
    if (gate === 'wait') { menu.say('Waiting for the squad leader to deploy.'); return; }
    const want = profile.economy.zone;
    if (gate === 'solo' && !zoneParam && want !== world.zone && BUILT_ZONES.includes(want)) {
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
  const online = new Online({
    raid, scene, seed: raidSeed, zone: world.zone, build: pkg.version, cls: () => profile.host,
    deploy: deployNow, say: (t) => menu.say(t), menuVisible: () => menu.visible,
  });
  let auto: string | null = null;
  try { auto = sessionStorage.getItem(AUTO_DEPLOY); sessionStorage.removeItem(AUTO_DEPLOY); } catch { /* storage blocked */ }
  if (auto && auto === world.zone) setTimeout(deployNow, 0); // after boot has wired the pipeline
  raid.bus.on('raidEnd', (e) => {
    const r = raid.outcome!;
    const totals = (entries: typeof r.pouch) => new ItemGrid(99, 99, entries).totals();
    if (e.result === 'extracted') {
      const st = extract(profile, r, e.kills);
      const done = settleContracts(profile, raid.log, true).filter((c) => c.completed);
      const xp = awardXp(profile, raidXp(raid.log, true, st.dnaBanked));
      save();
      const note = `${st.dnaBanked} DNA banked.${r.bankToll ? ` The tether took ${r.bankToll} DNA from your bank.` : ''} +${xp.xp} XP${xp.to > xp.from ? `, level ${xp.to}` : ''}.${xp.unlocked.length ? ` Armoury: ${xp.unlocked.map((w) => weaponSpec(w).label).join(', ')} unlocked.` : ''}${st.overflow.length ? ' Stash full: the rest waits in your cavities.' : ''}${done.length ? ` Contract complete: ${done.map((c) => c.title).join(', ')}.` : ''}`;
      menu.showResults({ result: 'extracted', items: r.items, dna: r.dna, value: r.value, kills: e.kills, time: e.time, note });
    } else {
      die(profile, r, e.kills);
      settleContracts(profile, raid.log, false);
      awardXp(profile, raidXp(raid.log, false));
      save();
      const lost = totals(r.cavity);
      menu.showResults({ result: 'lost', items: lost, dna: r.dna, value: haulValue(lost, r.dna), kills: e.kills, time: e.time, cause: r.cause, kept: totals(r.pouch) });
    }
  });


  // Audio (src/audio): starts on the first click or key press, reads the raid each frame.
  const audio = new GameAudio(raid, {
    zone: world.zone,
    hostClass: () => profile.host,
    menuVisible: () => menu.visible,
    enclosed: world.zone === 'longSeedWreck' || world.zone === 'marrowPit' ? () => true
      : world.zone === 'glowmireIsle' ? (x, z) => ZONE7_SITES.caves.some((c) => caveDistance(c, x, z) < 0) : () => false,
    // Marrow Pit: each layer has its own ambience, and dread grows with depth.
    region: world.zone === 'marrowPit' ? (x, y, z) => `pit${layerAt(x, z, y).replace(/^./, (c) => c.toUpperCase())}` : undefined,
    depth: world.zone === 'marrowPit' ? (_x, y) => -y / -AUDIO.pitDepth.floorY : undefined,
    volume: () => getSettings().volume,
  });

  const pipeline = createPipeline(canvas, scene, camera, 'zone7');
  // Display settings (Hive → Settings): brightness, render scale and graphics level apply live.
  pipeline.applyDisplay(getSettings());
  pipeline.setZoneGrade(ZONE_GRADE[world.zone] ?? {});
  addEventListener('biophage:settings', (e) => pipeline.applyDisplay((e as CustomEvent<Settings>).detail));
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
  document.querySelector('#build')!.textContent = `v${pkg.version} · LARVA`;
  document.addEventListener('pointerlockchange', () => prompt.classList.toggle('hidden', document.pointerLockElement === canvas));

  let frames = 0;
  // `begin` deploys through the Hive so scripted raids (tests/raid.mjs, scripts/playtest.mjs) follow the real loop.
  const debug = { ...raid.debug(), begin: deployNow };
  const clock = new THREE.Clock();
  // Online raids keep simulating while this tab is in the background (src/net keepAlive), so others don't freeze.
  online.keepAlive((dt) => { raid.update(dt); online.tick(dt); });
  pipeline.renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    raid.update(dt);
    online.tick(dt);
    // Landmarks (Design's zones.json) count toward contracts the first time the host walks into one.
    if (!menu.visible) { const lm = world.landmarkAt(camera.position.x, camera.position.z, raid.player.position.y); if (lm) raid.visit(lm); }
    hud.update(dt, raid.hud());
    audio.update(dt, camera);
    // The main menu draws the 3D Hive lab with the host on its pedestal; other Hive screens cover the whole view, so
    // the 3D frame behind them is skipped (the loop and frame counter keep running). The first frames always render
    // the raid scene so its shaders compile at boot, not on the DEPLOY click.
    menu.stageLive(stage.set(frames >= 3 && menu.wantsStage, profile.host, camera.aspect));
    stage.update(dt);
    if (!menu.visible || frames < 3 || stage.due()) pipeline.render(dt);
    frames++;
    // Read by tests/smoke.mjs and tests/raid.mjs: proves the loop is alive and drives scripted raids.
    (window as unknown as { __biophage: object }).__biophage = { frames, position: camera.position.toArray(), state: raid.testState(), audio: audio.stats(), profile, debug, layout: world.layout, net: online.test };
  });
}
