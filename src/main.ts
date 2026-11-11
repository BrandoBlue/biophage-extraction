import * as THREE from 'three';
import { LOOT } from '../data';
import { Raid } from './game/raid';
import { RaidHud } from './ui/raid-hud';
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
raid.bus.on('raidEnd', (e) => hud.showResult(e.result, raid.outcome!, labels, e.kills, e.time));

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
const debug = raid.debug();
const clock = new THREE.Clock();
pipeline.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  raid.update(dt);
  hud.update(dt, raid.hud());
  pipeline.render(dt);
  frames++;
  // Read by tests/smoke.mjs and tests/raid.mjs: proves the loop is alive and drives scripted raids.
  (window as unknown as { __biophage: object }).__biophage = { frames, position: camera.position.toArray(), state: raid.testState(), debug };
});
