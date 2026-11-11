import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/**
 * Ground-truth ambient occlusion for the GPU tier: grounds fungi, crystals and creatures in the moss.
 * Transparent and additive layers (liquid light, membranes, spores, the sky) are hidden from the
 * normal/depth prepass so they never cast AO halos.
 */
export class BioAOPass extends GTAOPass {
  constructor(scene: THREE.Scene, camera: THREE.Camera, w = 1, h = 1) {
    super(scene, camera, w, h);
    this.output = GTAOPass.OUTPUT.Default;
    this.blendIntensity = 0.85;
    this.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 12 });
    this.updatePdMaterial({ radius: 6, samples: 12 });
  }

  /** Follow the active camera each frame (look-dev override, resize after setSize). */
  syncCamera(cam: THREE.Camera): void {
    this.camera = cam;
    const g = this.gtaoMaterial.uniforms, pd = this.pdMaterial.uniforms;
    g.cameraProjectionMatrix.value.copy(cam.projectionMatrix);
    g.cameraProjectionMatrixInverse.value.copy(cam.projectionMatrixInverse);
    pd.cameraProjectionMatrixInverse.value.copy(cam.projectionMatrixInverse);
  }

  /** Called by GTAOPass before its prepass. */
  _overrideVisibility(): void {
    const cache = (this as unknown as { _visibilityCache: THREE.Object3D[] })._visibilityCache;
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      const hide = (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (mat && !Array.isArray(mat) && mat.transparent) || o.userData.noAO;
      if (hide && o.visible) { o.visible = false; cache.push(o); }
    });
  }
}
