import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bioTime, livingFlesh } from '../src/render/materials';
import { dissolvable, mutation, patchDissolve } from '../src/render/dissolve';
import { createHiveLab, LAB } from '../src/render/hivelab';
import { Abomination } from '../src/game/abominations';
import { ABOMINATIONS } from '../data';

/** Run a material's onBeforeCompile against the real standard shader source, as the renderer would. */
function compile(mat: THREE.Material): { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> } {
  const lib = THREE.ShaderLib.standard;
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) };
  mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}

describe('dissolve-mutate', () => {
  it('injects the burn front into a plain standard material', () => {
    const mat = new THREE.MeshStandardMaterial();
    const h = dissolvable(new THREE.Mesh(new THREE.BoxGeometry(), mat));
    const s = compile(mat);
    expect(s.vertexShader).toContain('vDisWorld = (modelMatrix * dw).xyz');
    expect(s.fragmentShader).toContain('discard');
    expect(s.fragmentShader).toContain('uDisColour * edge');
    expect(s.uniforms.uDisAmount).toBe(h.amount);
    expect(mat.customProgramCacheKey()).toContain('dissolve');
  });

  it('composes with a bio-material patch and does not redeclare bioTime', () => {
    const mat = livingFlesh('#5A2A55', '#FF3FA4', '#FF3FA4', 9);
    const before = mat.customProgramCacheKey();
    patchDissolve(mat, { amount: { value: 0 }, colour: { value: new THREE.Color() }, minY: { value: 0 }, maxY: { value: 1 } });
    patchDissolve(mat, { amount: { value: 0 }, colour: { value: new THREE.Color() }, minY: { value: 0 }, maxY: { value: 1 } });
    const s = compile(mat);
    expect(s.fragmentShader.match(/uniform float bioTime;/g)?.length).toBe(1);
    expect(s.fragmentShader.match(/float disField\(\)/g)?.length).toBe(1); // idempotent
    expect(s.fragmentShader).toContain('uFleshScale');
    expect(mat.customProgramCacheKey()).toBe(`${before}|dissolve`);
  });

  it('runs swap jobs to completion on the shared clock and hides the old form', () => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    let done = false;
    const t0 = bioTime.value;
    mutation.swap(a, b, { duration: 1, done: () => { done = true; } });
    expect(mutation.running).toBeGreaterThan(0);
    bioTime.value = t0 + 0.5; mutation.update();
    expect(done).toBe(false);
    bioTime.value = t0 + 1.01; mutation.update();
    expect(done).toBe(true);
    expect(a.visible).toBe(false);
    expect(mutation.running).toBe(0);
  });
});

describe('Hive lab stage', () => {
  it('frames a specimen on the pedestal with the camera looking at it', () => {
    const lab = createHiveLab();
    const spec = new THREE.Object3D();
    lab.place(spec);
    expect(spec.parent).toBe(lab.plinth);
    expect(lab.plinth.position.y).toBeCloseTo(LAB.plinthY);
    lab.orbit(Math.PI / 2);
    const dir = new THREE.Vector3();
    lab.camera.getWorldDirection(dir);
    expect(dir.x).toBeLessThan(-0.9); // camera on +x looks back at the pedestal
    expect(lab.camera.position.length()).toBeGreaterThan(LAB.camDist * 0.9);
  });
  it('has a rim light from behind the specimen (reference 03)', () => {
    const lab = createHiveLab();
    const spots = lab.scene.children.filter((o): o is THREE.SpotLight => (o as THREE.SpotLight).isSpotLight);
    expect(spots.some((s) => s.position.z < -2 && s.intensity > 0)).toBe(true);
  });
});

describe('Abomination art', () => {
  it('builds both creatures with eye clusters, weak points and a modest draw-call count', () => {
    for (const kind of ['needlemaw', 'bilecantor'] as const) {
      const a = new Abomination(kind, ABOMINATIONS[kind], 0, 0, 3);
      let eyes = 0, meshes = 0;
      a.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        meshes++;
        if (m instanceof THREE.MeshPhysicalMaterial && m.emissive.getHex() !== 0 && m.clearcoatRoughness === 0.02) eyes++;
      });
      expect(eyes, kind).toBeGreaterThanOrEqual(5);
      expect(meshes, kind).toBeLessThan(80); // draw-call budget per creature
      expect(a.hitSpheres.some((h) => h.weak)).toBe(true);
    }
  });
});
