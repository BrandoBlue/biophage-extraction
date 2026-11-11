import * as THREE from 'three';
import classes from '../data/classes.json';
import { Player } from './game/player';
import { buildZone7 } from './world/zone7';
import { createPipeline } from './render/pipeline';
import { installLookdev } from './render/lookdev';
import pkg from '../package.json';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1500);
buildZone7(scene);
const player = new Player(camera, classes.neuroInfiltrator, canvas);

const pipeline = createPipeline(canvas, scene, camera, 'zone7');
installLookdev(pipeline, camera, scene);

function resize(): void {
  const w = innerWidth, h = innerHeight;
  pipeline.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const prompt = document.querySelector<HTMLElement>('#prompt')!;
const neural = document.querySelector<HTMLElement>('#neural')!;
document.querySelector('#build')!.textContent = `v${pkg.version} · SPORE`;
document.addEventListener('pointerlockchange', () => prompt.classList.toggle('hidden', document.pointerLockElement === canvas));

let overload = 1;
let frames = 0;
const clock = new THREE.Clock();
pipeline.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  player.update(dt);
  overload = THREE.MathUtils.clamp(overload + (player.sprinting ? -0.25 : 0.15) * dt, 0, 1);
  neural.style.width = `${overload * 100}%`;
  pipeline.setOverload(1 - overload);
  pipeline.render(dt);
  frames++;
  // Read by tests/smoke.mjs to prove the game loop is alive.
  (window as unknown as { __biophage: object }).__biophage = { frames, position: camera.position.toArray() };
});
