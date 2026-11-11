import * as THREE from 'three';

/**
 * Soft sun shadows for the high tier: the brightest directional light in a scene casts a PCF-soft shadow from a
 * box that follows the camera (snapped to whole shadow texels so edges do not crawl), and solid meshes are opted in
 * as they appear. Transparent, additive and custom-shader meshes (sky, haze, shafts, FX) never cast.
 * Mark a mesh `userData.noShadow = true` to keep it out.
 */
export const SHADOWS = { mapSize: 2048, extent: 45, depth: 320, distance: 150, bias: -0.0003, normalBias: 0.035, radius: 2.5, rescanFrames: 30 } as const;

export function shadowEligible(o: THREE.Object3D): boolean {
  const m = o as THREE.Mesh;
  if (!m.isMesh || o.userData.noShadow) return false;
  // Nothing held by the camera (the first-person gun and hands) casts onto the world.
  for (let p = o.parent; p; p = p.parent) if ((p as THREE.Camera).isCamera) return false;
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return mats.every((mat) => mat && !(mat as THREE.ShaderMaterial).isShaderMaterial && !mat.transparent && mat.blending === THREE.NormalBlending && mat.visible);
}

/** The light that casts: the strongest DirectionalLight in the scene, or null. */
export function keyLight(scene: THREE.Object3D): THREE.DirectionalLight | null {
  let best: THREE.DirectionalLight | null = null;
  scene.traverse((o) => { const l = o as THREE.DirectionalLight; if (l.isDirectionalLight && (!best || l.intensity > best.intensity)) best = l; });
  return best;
}

export interface SunShadows { update(scene: THREE.Scene, camera: THREE.Camera): void; readonly enabled: boolean }

export function sunShadows(renderer: THREE.WebGLRenderer, enabled: boolean): SunShadows {
  if (enabled) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCF with shadow.radius softening; PCFSoftShadowMap was removed in this three version
  }
  const seen = new WeakSet<THREE.Object3D>();
  const keys = new WeakMap<THREE.Scene, { light: THREE.DirectionalLight | null; dir: THREE.Vector3 }>();
  let frame = 0;
  const centre = new THREE.Vector3(), lightSpace = new THREE.Matrix4(), inv = new THREE.Matrix4(), tmp = new THREE.Vector3();
  return {
    enabled,
    update(scene, camera) {
      if (!enabled) return;
      let k = keys.get(scene);
      if (!k) {
        const light = keyLight(scene);
        const dir = light ? light.position.clone().sub(light.target.position).normalize() : new THREE.Vector3(0, 1, 0);
        k = { light, dir };
        keys.set(scene, k);
        if (light) {
          light.castShadow = true;
          const s = light.shadow;
          s.mapSize.set(SHADOWS.mapSize, SHADOWS.mapSize);
          const cam = s.camera as THREE.OrthographicCamera;
          cam.left = cam.bottom = -SHADOWS.extent; cam.right = cam.top = SHADOWS.extent;
          cam.near = 1; cam.far = SHADOWS.depth;
          cam.updateProjectionMatrix();
          s.bias = SHADOWS.bias; s.normalBias = SHADOWS.normalBias; s.radius = SHADOWS.radius;
          if (!light.target.parent) scene.add(light.target);
        }
      }
      // Opt new solid meshes in, a scene sweep every few frames (creatures and props arrive mid-raid).
      if (frame++ % SHADOWS.rescanFrames === 0) {
        scene.traverse((o) => {
          if (seen.has(o)) return;
          seen.add(o);
          if (!shadowEligible(o)) return;
          o.receiveShadow = true;
          // Instanced fields (cover, fungus forests) only receive: thousands of casters would cost more than they show.
          if (!(o as THREE.InstancedMesh).isInstancedMesh) o.castShadow = true;
        });
      }
      const light = k.light;
      if (!light) return;
      // Follow the camera, snapped to the shadow texel grid in light space so shadow edges stay still as you move.
      camera.getWorldPosition(centre);
      const texel = (SHADOWS.extent * 2) / SHADOWS.mapSize;
      lightSpace.lookAt(tmp.set(0, 0, 0), k.dir.clone().negate(), new THREE.Vector3(0, 1, 0));
      inv.copy(lightSpace).invert();
      centre.applyMatrix4(inv);
      centre.x = Math.round(centre.x / texel) * texel;
      centre.y = Math.round(centre.y / texel) * texel;
      centre.applyMatrix4(lightSpace);
      light.target.position.copy(centre);
      light.position.copy(centre).addScaledVector(k.dir, SHADOWS.distance);
      light.target.updateMatrixWorld();
    },
  };
}
