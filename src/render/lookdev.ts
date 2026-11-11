import * as THREE from 'three';
import type { Pipeline } from './pipeline';
import { groundHeight } from '../world/zone7';
import { gore } from './gore';

/** A look-dev camera pose: position (or ground point `at` plus `eye` height), yaw and pitch in radians, vertical field of view in degrees. */
export interface LookdevPose { pos?: [number, number, number]; at?: [number, number]; eye?: number; yaw: number; pitch: number; fov?: number }

/**
 * Debug hook for look-dev captures (tests/lookdev.mjs). Renders through a detached camera so it never
 * fights the player controller. `window.__biophageLookdev.view(pose)` / `.clear()` / `.stats()`.
 */
export function installLookdev(pipeline: Pipeline, base: THREE.PerspectiveCamera, scene?: THREE.Scene): void {
  const cam = new THREE.PerspectiveCamera();
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
    /** Toggle visibility of every object with this name (isolating a layer while tuning). */
    show(name: string, on: boolean) { scene?.traverse((o) => { if (o.name === name) o.visible = on; }); },
    /** Spray a gore splat and burst on the ground at (x, z) for look-dev. */
    gore(x: number, z: number, colour?: string) {
      if (!scene) return;
      const point = new THREE.Vector3(x, groundHeight(x, z), z);
      gore.splat(scene, { point, normal: new THREE.Vector3(0, 1, 0), size: 2.2, colour });
      gore.burst(scene, { point: point.clone().setY(point.y + 0.6), colour });
    },
    quality() { return pipeline.quality; },
    raw(on: boolean) { pipeline.bypassPost = on; },
    hit() { pipeline.hitPulse(1); },
    clear() { pipeline.overrideCamera = null; },
    stats() { const i = pipeline.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length ?? 0 }; },
  };
  (window as unknown as { __biophageLookdev: typeof api }).__biophageLookdev = api;
}
