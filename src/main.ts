import * as THREE from 'three';
import { LOOT, haulValue } from '../data';
import { Raid } from './game/raid';
import { RaidHud } from './ui/raid-hud';
import { HiveMenu } from './ui/hive-menu';
import { ItemGrid } from './game/grid';
import { browserStorage, deploy, die, extract, loadProfile, saveProfile } from './game/profile';
import { buildZone7 } from './world/zone7';
import { createPipeline } from './render/pipeline';
import { installLookdev } from './render/lookdev';
import pkg from '../package.json';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1500);
buildZone7(scene);
const raid = new Raid(scene, camera, canvas);
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
  void Promise.resolve(canvas.requestPointerLock?.()).catch(() => { /* headless or denied: click the canvas to lock */ });
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
  (window as unknown as { __biophage: object }).__biophage = { frames, position: camera.position.toArray(), state: raid.testState(), profile, debug };
});
