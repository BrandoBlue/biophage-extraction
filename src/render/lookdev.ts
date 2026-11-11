import * as THREE from 'three';
import type { Pipeline } from './pipeline';
import { groundHeight } from '../world/zone7';
import { gore } from './gore';
import { dissolvable } from './dissolve';
import { createHiveLab, type HiveLab } from './hivelab';
import { boltLook, shotFx } from './shotfx';
import { grownWall } from './materials';
import { hazeVolume, lightShaft } from './atmos';
import { ZONE7_SHADE } from './palette';
import { crystal, livingFlesh } from './materials';
import { HIVE, ZONE7 } from './palette';
import { Abomination } from '../game/abominations';
import { ABOMINATIONS } from '../../data';

/** A look-dev camera pose: position (or ground point `at` plus `eye` height), yaw and pitch in radians, vertical field of view in degrees. */
export interface LookdevPose { pos?: [number, number, number]; at?: [number, number]; eye?: number; yaw: number; pitch: number; fov?: number }

/**
 * Debug hook for look-dev captures (tests/lookdev.mjs). Renders through a detached camera so it never
 * fights the player controller. `window.__biophageLookdev.view(pose)` / `.clear()` / `.stats()`.
 */
export function installLookdev(pipeline: Pipeline, base: THREE.PerspectiveCamera, scene?: THREE.Scene): void {
  const cam = new THREE.PerspectiveCamera();
  let lab: HiveLab | null = null;
  const api = {
    view(p: LookdevPose) {
      cam.copy(base);
      cam.fov = p.fov ?? base.fov;
      cam.aspect = base.aspect;
      if (p.at) cam.position.set(p.at[0], groundHeight(p.at[0], p.at[1]) + (p.eye ?? 1.7), p.at[1]);
      else if (p.pos) cam.position.set(...p.pos);
      cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      cam.updateProjectionMatrix();
      pipeline.overrideCamera = cam;
    },
    overload(v: number) { pipeline.setOverload(v); },
    /** Freeze a volley of spore bolts in flight from (x, z) toward (tx, tz), with impact flashes at the far end. */
    shots(x: number, z: number, tx: number, tz: number) {
      if (!scene) return;
      const make = boltLook(HIVE.acid);
      const y0 = groundHeight(x, z) + 1.3, y1 = groundHeight(tx, tz) + 0.4;
      for (let i = 0; i < 4; i++) {
        const k = 0.2 + i * 0.2;
        const b = make();
        b.position.set(x + (tx - x) * k + (i % 2 ? 0.15 : -0.1), y0 + (y1 - y0) * k, z + (tz - z) * k);
        b.userData.origin = new THREE.Vector3(x, y0, z).lerp(b.position, i * 0.25);
        b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(tx - x, y1 - y0, tz - z).normalize());
        scene.add(b);
      }
      shotFx.flash(scene, new THREE.Vector3(tx, y1, tz), new THREE.Color(HIVE.acid), 0.9, 1e6);
    },
    /** A test chamber of grown walls (8 x 10 m, open top, one slit window) with a light shaft and haze. */
    chamber(x: number, z: number) {
      if (!scene) return;
      const y = groundHeight(x, z), H = 10, W = 8, T = 0.8;
      const wall = grownWall();
      const add = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
        m.position.set(x + px, y + py, z + pz);
        scene.add(m);
      };
      add(W, H, T, 0, H / 2, -W / 2);                 // back
      add(T, H, W, -W / 2, H / 2, 0);                 // left
      add(T, H, W, W / 2, H / 2, 0);                  // right, with a slit window cut as two pieces
      add(W / 2 - 0.6, H, T, -W / 4 - 0.3, H / 2, W / 2);
      add(W / 2 - 0.6, H, T, W / 4 + 0.3, H / 2, W / 2);
      add(1.2, 3.5, T, 0, H - 1.75, W / 2);           // lintel over the doorway gap
      scene.add(lightShaft({ from: new THREE.Vector3(x - 1.5, y + H + 4, z - 1), to: new THREE.Vector3(x + 0.5, y, z + 0.5), width: 2.2, spread: 1.4, colour: new THREE.Color(HIVE.bone).lerp(new THREE.Color(ZONE7.cyan), 0.25), strength: 0.14 }));
      scene.add(hazeVolume({ centre: new THREE.Vector3(x, y + H / 2, z), size: new THREE.Vector3(W - T, H, W - T), colour: new THREE.Color(ZONE7_SHADE.skyHorizon).lerp(new THREE.Color(HIVE.bone), 0.35), density: 0.05 }));
    },
    /** Count visible objects with this name, and where the first one is (debugging transient FX). */
    find(name: string) {
      const hits: number[][] = [];
      scene?.traverse((o) => { if (o.name === name && o.visible) hits.push(o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Math.round(v * 10) / 10)); });
      return { n: hits.length, first: hits[0] ?? null };
    },
    /** Toggle visibility of every object with this name (isolating a layer while tuning). */
    show(name: string, on: boolean) { scene?.traverse((o) => { if (o.name === name) o.visible = on; }); },
    /** Spray a gore splat and burst on the ground at (x, z) for look-dev. */
    gore(x: number, z: number, colour?: string) {
      if (!scene) return;
      const point = new THREE.Vector3(x, groundHeight(x, z), z);
      gore.splat(scene, { point, normal: new THREE.Vector3(0, 1, 0), size: 2.2, colour });
      gore.burst(scene, { point: point.clone().setY(point.y + 0.6), colour });
    },
    /** Freeze a mid-mutation frame at (x, z): a flesh mass burning away as a crystal growth knits in. */
    mutateDemo(x: number, z: number, amount = 0.5) {
      if (!scene) return;
      const y = groundHeight(x, z);
      const flesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 5), livingFlesh(HIVE.danger, ZONE7.magenta, ZONE7.magenta));
      flesh.position.set(x, y + 1.1, z);
      flesh.scale.set(1, 1.3, 1);
      const growth = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), crystal(ZONE7.cyan));
      growth.position.set(x + 0.2, y + 1.2, z);
      growth.scale.set(0.8, 1.9, 0.8);
      scene.add(flesh, growth);
      flesh.updateMatrixWorld(); growth.updateMatrixWorld();
      dissolvable(flesh, ZONE7.lime).amount.value = amount;
      dissolvable(growth, ZONE7.lime).amount.value = 1 - amount + 0.15;
    },
    /** Stage one of each Abomination at (x, z), side by side, facing yaw `face` (look-dev only; not simulated). */
    creatures(x: number, z: number, face = 0) {
      if (!scene) return;
      const n = new Abomination('needlemaw', ABOMINATIONS.needlemaw, x - 1.6, z, 11);
      const c = new Abomination('bilecantor', ABOMINATIONS.bilecantor, x + 3.5, z - 4, 12);
      for (const a of [n, c]) { a.root.rotation.y = face; scene.add(a.root); }
      c.root.position.y = groundHeight(x + 3.5, z - 4) - 1.2;
    },
    /** Switch to the Hive lab stage with a specimen on the pedestal (on), or back to the raid (off). */
    lab(on: boolean, yaw = 0.35) {
      if (!on) { pipeline.overrideScene = null; pipeline.overrideCamera = null; pipeline.setPreset('zone7'); return; }
      if (!lab) {
        lab = createHiveLab();
        const spec = new Abomination('needlemaw', ABOMINATIONS.needlemaw, 0, 0, 11);
        spec.root.position.set(0, 0, 0);
        spec.root.scale.setScalar(1.7);
        lab.place(spec.root);
        if (pipeline.quality === 'high') lab.bakeEnvironment(pipeline.renderer);
      }
      lab.camera.aspect = base.aspect;
      lab.camera.updateProjectionMatrix();
      lab.orbit(yaw);
      pipeline.overrideScene = lab.scene;
      pipeline.overrideCamera = lab.camera;
      pipeline.setPreset('hive');
    },
    quality() { return pipeline.quality; },
    raw(on: boolean) { pipeline.bypassPost = on; },
    hit() { pipeline.hitPulse(1); },
    clear() { pipeline.overrideCamera = null; },
    stats() { const i = pipeline.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length ?? 0 }; },
  };
  (window as unknown as { __biophageLookdev: typeof api }).__biophageLookdev = api;
}
