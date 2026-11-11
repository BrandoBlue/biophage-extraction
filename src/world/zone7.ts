import * as THREE from 'three';
import { ZONE7 } from '../render/palette';

/** Deterministic RNG so every raid pocket (and every screenshot test) is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ISLAND_RADIUS = 60;

/** Height of the island surface at (x, z). Shared by the mesh and the player controller. */
export function groundHeight(x: number, z: number): number {
  const r = Math.hypot(x, z) / ISLAND_RADIUS;
  const rolling = Math.sin(x * 0.11) * Math.cos(z * 0.09) * 1.6 + Math.sin(x * 0.31 + z * 0.27) * 0.4;
  return rolling * Math.max(0, 1 - r * r) - Math.max(0, r - 0.85) * 40;
}

function glow(colour: string, intensity = 1.1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#0a0518', emissive: colour, emissiveIntensity: intensity, roughness: 0.4 });
}

function mushroom(rand: () => number, colour: string): THREE.Group {
  const g = new THREE.Group();
  const h = 1.5 + rand() * 5;
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * h * 0.3, 0.2 * h * 0.3, h, 8),
    new THREE.MeshStandardMaterial({ color: '#2a1a4a', emissive: colour, emissiveIntensity: 0.25, roughness: 0.7 }),
  );
  stem.position.y = h / 2;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(h * 0.38, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glow(colour));
  cap.position.y = h;
  cap.scale.y = 0.55;
  g.add(stem, cap);
  if (h > 4) {
    const light = new THREE.PointLight(colour, 12, 18, 2);
    light.position.y = h * 0.9;
    g.add(light);
  }
  return g;
}

/** The Spore pocket of Zone 7: one floating island over the void, bioluminescent flora, cosmic sky. */
export function buildZone7(scene: THREE.Scene, seed = 7): void {
  const rand = mulberry32(seed);
  scene.background = new THREE.Color(ZONE7.void);
  scene.fog = new THREE.FogExp2(ZONE7.void, 0.012);

  scene.add(new THREE.HemisphereLight(ZONE7.cyan, ZONE7.violet, 0.25));
  const key = new THREE.DirectionalLight(ZONE7.magenta, 0.6);
  key.position.set(-40, 60, -30);
  scene.add(key);

  // Island
  const geo = new THREE.CircleGeometry(ISLAND_RADIUS * 1.05, 96, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const ring = new THREE.PlaneGeometry(ISLAND_RADIUS * 2.2, ISLAND_RADIUS * 2.2, 160, 160);
  ring.rotateX(-Math.PI / 2);
  const pos = ring.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  ring.computeVertexNormals();
  geo.dispose();
  const ground = new THREE.Mesh(ring, new THREE.MeshStandardMaterial({ color: '#1b1238', roughness: 0.85, metalness: 0.1 }));
  scene.add(ground);

  // Flora
  const colours = [ZONE7.cyan, ZONE7.magenta, ZONE7.lime, ZONE7.violet];
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    const d = 6 + rand() * (ISLAND_RADIUS * 0.78);
    const m = mushroom(rand, colours[Math.floor(rand() * colours.length)]);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    m.position.set(x, groundHeight(x, z) - 0.1, z);
    scene.add(m);
  }

  // Drifting rocks in the void
  const rockMat = new THREE.MeshStandardMaterial({ color: '#241547', roughness: 0.9 });
  for (let i = 0; i < 40; i++) {
    const s = 2 + rand() * 12;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    const a = rand() * Math.PI * 2, d = 90 + rand() * 220;
    rock.position.set(Math.cos(a) * d, -30 + rand() * 110, Math.sin(a) * d);
    rock.rotation.set(rand() * 6, rand() * 6, rand() * 6);
    scene.add(rock);
  }

  // Ringed planet and stars
  const planet = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32), new THREE.MeshBasicMaterial({ color: '#0b0420', fog: false }));
  planet.position.set(-220, 170, -420);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(110, 3.5, 8, 96), new THREE.MeshBasicMaterial({ color: ZONE7.magenta, fog: false }));
  halo.rotation.set(1.2, 0.3, 0);
  planet.add(halo);
  scene.add(planet);

  const stars = new Float32Array(3000 * 3);
  for (let i = 0; i < 3000; i++) {
    const v = new THREE.Vector3(rand() - 0.5, rand() * 0.9 - 0.25, rand() - 0.5).normalize().multiplyScalar(700);
    stars.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: ZONE7.cyan, size: 1.6, sizeAttenuation: false, fog: false })));

  // Extraction beacon: the goal the Gameplay department wires up in Spore.
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 80, 16, 1, true), new THREE.MeshBasicMaterial({ color: ZONE7.lime, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  beacon.position.set(34, 40 + groundHeight(34, -28), -28);
  beacon.name = 'extraction-beacon';
  scene.add(beacon);
}
