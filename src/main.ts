import * as THREE from 'three';
import { haulValue } from '../data';
import { Raid } from './game/raid';
import { RaidHud } from './ui/raid-hud';
import { HiveMenu } from './ui/hive-menu';
import { HiveStage } from './ui/hive-stage';
import { ItemGrid } from './game/grid';
import { browserStorage, deploy, die, extract, loadProfile, saveProfile } from './game/profile';
import { buildZone7 } from './world/zone7';
import { createPipeline } from './render/pipeline';
import { installLookdev } from './render/lookdev';
import pkg from '../package.json';

import { creatureViewerRequested, startCreatureViewer } from './creatures/viewer';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;

// `?creatures` opens the Creature & Mutation specimen viewer instead of a raid.
if (creatureViewerRequested()) startCreatureViewer(canvas);
else bootRaid();

function bootRaid(): void {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1500);
  buildZone7(scene);
  const raid = new Raid(scene, camera, canvas);
  const hud = new RaidHud(raid.bus, raid);

  // Persistent loop (Larva): boot into the Hive, deploy with the cavity loadout, settle the raid into the profile.
  const storage = browserStorage();
  const loaded = loadProfile(storage);
  const profile = loaded.profile;
  const save = () => { if (!saveProfile(storage, profile)) menu.say('Could not save: browser storage is full or blocked.'); };
  function deployNow(): void {
    if (raid.phase !== 'briefing') return;
    const d = deploy(profile);
    save();
    menu.hide();
    // Lock the mouse for play. Automated runs (tests, playtest bot) skip it: headless pointer lock halves software-rendered fps.
    if (!navigator.webdriver) void Promise.resolve(canvas.requestPointerLock?.()).catch(() => { /* denied: click the canvas to lock */ });
    raid.deploy(d);
  }
  const menu = new HiveMenu(profile, save, deployNow, loaded.notice);
  raid.bus.on('raidEnd', (e) => {
    const r = raid.outcome!;
    const totals = (entries: typeof r.pouch) => new ItemGrid(99, 99, entries).totals();
    if (e.result === 'extracted') {
      const st = extract(profile, r, e.kills);
      save();
      const note = `${st.dnaBanked} DNA banked.${st.overflow.length ? ' Stash full: the rest waits in your cavities.' : ''}`;
      menu.showResults({ result: 'extracted', items: r.items, dna: r.dna, value: r.value, kills: e.kills, time: e.time, note });
    } else {
      die(profile, r, e.kills);
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
    hud.update(dt, raid.hud());
    // The main menu draws the 3D Hive lab with the host on its pedestal; other Hive screens cover the whole view, so
    // the 3D frame behind them is skipped (the loop and frame counter keep running). The first frames always render
    // the raid scene so its shaders compile at boot, not on the DEPLOY click.
    const lab = frames >= 3 && menu.wantsStage;
    stage.set(lab, profile.host, camera.aspect);
    menu.stageLive(lab);
    stage.update(dt);
    if (!menu.visible || frames < 3 || stage.due()) pipeline.render(dt);
    frames++;
    // Read by tests/smoke.mjs and tests/raid.mjs: proves the loop is alive and drives scripted raids.
    (window as unknown as { __biophage: object }).__biophage = { frames, position: camera.position.toArray(), state: raid.testState(), profile, debug };
  });
}
