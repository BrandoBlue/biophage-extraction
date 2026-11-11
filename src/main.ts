import * as THREE from 'three';
import { LOOT, haulValue } from '../data';
import { Raid } from './game/raid';
import { RaidHud } from './ui/raid-hud';
import { HiveMenu } from './ui/hive-menu';
import { ItemGrid } from './game/grid';
import { browserStorage, deploy, die, extract, loadProfile, saveProfile } from './game/profile';
import { buildZone7 } from './world/zone7';
import { zone7Layout } from './world/layout';
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
  // Each raid draws its live sites (which Seed Spires open, which Gene Blooms grow, where the anomaly sits)
  // from a fresh seed. `?seed=N` pins it; automated runs use seed 1 (Design's RAID.larva layout) so tests are reproducible.
  const seedParam = Number(new URLSearchParams(location.search).get('seed'));
  const raidSeed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : navigator.webdriver ? 1 : 1 + Math.floor(Math.random() * 1e6);
  const world = buildZone7(scene, zone7Layout(raidSeed));
  const raid = new Raid(scene, camera, canvas, world.layout, world.sites);
  const hud = new RaidHud(raid.bus, () => location.reload());
  const labels = Object.fromEntries(Object.entries(LOOT.items).map(([k, v]) => [k, v.label]));

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
    let note = '';
    if (e.result === 'extracted') {
      const st = extract(profile, r, e.kills);
      note = `${st.dnaBanked} DNA banked.${st.overflow.length ? ' Stash full: the rest waits in your cavities.' : ''}`;
      save();
      hud.showResult(e.result, r, labels, e.kills, e.time, note);
    } else {
      die(profile, r, e.kills);
      save();
      const lost = new ItemGrid(99, 99, r.cavity).totals();
      if (r.pouch.length) note = `Gut pouch kept: ${new ItemGrid(99, 99, r.pouch).totals().map((i) => `${i.count}× ${labels[i.item]}`).join(', ')}.`;
      hud.showResult(e.result, { ...r, items: lost, value: haulValue(lost, r.dna) }, labels, e.kills, e.time, note);
    }
  });

  const pipeline = createPipeline(canvas, scene, camera, 'zone7');
  installLookdev(pipeline, camera, scene);
  raid.pipeline = pipeline;

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
    pipeline.render(dt);
    frames++;
    // Read by tests/smoke.mjs and tests/raid.mjs: proves the loop is alive and drives scripted raids.
    (window as unknown as { __biophage: object }).__biophage = { frames, position: camera.position.toArray(), state: raid.testState(), profile, debug, layout: world.layout };
  });
}
