import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import classes from '../data/classes.json';
import { Player } from './game/player';
import { buildZone7 } from './world/zone7';
import pkg from '../package.json';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1500);
buildZone7(scene);
const player = new Player(camera, classes.neuroInfiltrator, canvas);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.5, 0.75);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize(): void {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
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
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  player.update(dt);
  overload = THREE.MathUtils.clamp(overload + (player.sprinting ? -0.25 : 0.15) * dt, 0, 1);
  neural.style.width = `${overload * 100}%`;
  composer.render();
  frames++;
  // Read by tests/smoke.mjs to prove the game loop is alive.
  (window as unknown as { __biophage: object }).__biophage = { frames, position: camera.position.toArray() };
});
