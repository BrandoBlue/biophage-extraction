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

describe('ground cover field', () => {
  it('fills the field around the viewer, stays put in the world, and keeps out of excluded ground', async () => {
    const { groundCover, COVER } = await import('../src/render/cover');
    const cover = groundCover({ height: () => 0, exclude: (x) => x > 5 });
    cover.relay(0.1, 0.1, false);
    const total = Object.values(cover.counts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(400);
    expect(cover.counts.frond).toBeGreaterThan(cover.counts.pebble);
    const frond = cover.group.getObjectByName('cover-frond') as THREE.InstancedMesh;
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    let maxX = -Infinity, maxR = 0;
    for (let i = 0; i < frond.count; i++) {
      frond.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      maxX = Math.max(maxX, p.x); maxR = Math.max(maxR, Math.hypot(p.x, p.z));
    }
    expect(maxX).toBeLessThanOrEqual(5);
    expect(maxR).toBeLessThanOrEqual(COVER.radius + 1);
    // Moving within the same cell does not re-lay; the software tier gets a smaller field.
    frond.getMatrixAt(0, m); const first = m.clone();
    cover.relay(0.2, 0.2, false);
    frond.getMatrixAt(0, m); expect(m.equals(first)).toBe(true);
    cover.relay(0.2, 0.2, true);
    const low = Object.values(cover.counts).reduce((a, b) => a + b, 0);
    expect(low).toBeLessThan(total * 0.45);
  });
});

describe('shot effects', () => {
  it('stretch the tracer back to the muzzle, capped, and pool impact flashes that fade out', async () => {
    const { boltLook, shotFx, glowTexture } = await import('../src/render/shotfx');
    expect(glowTexture().image.width).toBe(64);
    const bolt = boltLook('#6CFF4A', { tail: 8 })();
    const trail = bolt.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
    const cam = new THREE.PerspectiveCamera();
    bolt.userData.origin = new THREE.Vector3(0, 0, 0);
    bolt.position.set(0, 0, -3);
    trail.onBeforeRender(null as never, null as never, cam, null as never, null as never, null as never);
    expect(trail.scale.y).toBeCloseTo(3);
    bolt.position.set(0, 0, -40);
    trail.onBeforeRender(null as never, null as never, cam, null as never, null as never, null as never);
    expect(trail.scale.y).toBe(8);

    shotFx.reset();
    const scene = new THREE.Scene();
    const t0 = bioTime.value;
    for (let i = 0; i < 40; i++) shotFx.flash(scene, new THREE.Vector3(i, 0, 0), new THREE.Color('#6CFF4A'));
    expect(scene.children.length).toBeLessThanOrEqual(24);
    shotFx.update();
    expect(shotFx.live).toBeGreaterThan(0);
    bioTime.value = t0 + 1; shotFx.update();
    expect(shotFx.live).toBe(0);
  });
});

describe('built-space atmosphere and grown walls', () => {
  it('orients a light shaft from the opening to where it lands, and boxes haze around its centre', async () => {
    const { lightShaft, hazeVolume } = await import('../src/render/atmos');
    const from = new THREE.Vector3(0, 6, 0), to = new THREE.Vector3(2, 0, 0);
    const shaft = lightShaft({ from, to, width: 0.6 });
    expect(shaft.position.distanceTo(from.clone().lerp(to, 0.5))).toBeLessThan(1e-6);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(shaft.quaternion);
    expect(up.dot(from.clone().sub(to).normalize())).toBeCloseTo(1); // +Y (opening end) points back at the opening
    expect((shaft.material as THREE.ShaderMaterial).blending).toBe(THREE.AdditiveBlending);
    const haze = hazeVolume({ centre: new THREE.Vector3(1, 2, 3), size: new THREE.Vector3(4, 4, 4) });
    const mat = haze.material as THREE.ShaderMaterial;
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.depthWrite).toBe(false);
    expect((mat.uniforms.uMin.value as THREE.Vector3).toArray()).toEqual([-1, 0, 1]);
    expect((mat.uniforms.uMax.value as THREE.Vector3).toArray()).toEqual([3, 4, 5]);
  });

  it('gives grown walls plates, bumped normals and restrained vein glow', async () => {
    const { grownWall } = await import('../src/render/materials');
    const s = compile(grownWall());
    expect(s.fragmentShader).toContain('normal = normalize(abs(det) * normal - grad)');
    expect(s.fragmentShader).toContain('* bioGlow');
  });

  it('keeps the held gun in lit, natural tones rather than neon pink', async () => {
    const { ORGANIC, ZONE7 } = await import('../src/render/palette');
    const { SynapseBursterView } = await import('../src/game/viewmodel');
    const view = new SynapseBursterView();
    const { WeaponRig } = await import('../src/game/weapon-rig');
    const rig = new WeaponRig(new THREE.PerspectiveCamera());
    rig.equip(view, 0);
    const lights: THREE.PointLight[] = [];
    rig.root.traverse((o) => { if ((o as THREE.PointLight).isPointLight) lights.push(o as THREE.PointLight); });
    expect(lights.some((l) => l.color.getHexString() === new THREE.Color(ZONE7.magenta).getHexString())).toBe(false);
    let flesh = false;
    view.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
      if (m?.color?.getHexString() === new THREE.Color(ORGANIC.wetFlesh).getHexString()) flesh = true;
    });
    expect(flesh).toBe(true);
  });
});

describe('first-person gun framing', () => {
  it('keeps the gun at its framed size while it breathes', async () => {
    const { SynapseBursterView, GUN_SCALE } = await import('../src/game/viewmodel');
    const view = new SynapseBursterView();
    const gun = view.root.children.find((c) => c instanceof THREE.Group && c.children.length > 10) as THREE.Group;
    for (let i = 0; i < 3; i++) view.update(1 / 60, { ammoFrac: 1, aim: 0, ego: 0, charge: 0, reloading: false, look: null });
    expect(gun.scale.x).toBeCloseTo(GUN_SCALE);
    expect(gun.scale.y).toBeLessThan(GUN_SCALE * 1.05);
  });
});

describe('lighting, relief and world scale', () => {
  it('casts soft sun shadows from the strongest directional light, following the camera, never from held items', async () => {
    const { sunShadows, shadowEligible, keyLight, SHADOWS } = await import('../src/render/lighting');
    const scene = new THREE.Scene();
    const weak = new THREE.DirectionalLight(0xffffff, 0.5), key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(60, 80, -120);
    scene.add(weak, key);
    expect(keyLight(scene)).toBe(key);
    const rock = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const haze = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ transparent: true }));
    const cam = new THREE.PerspectiveCamera();
    const held = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    cam.add(held);
    scene.add(rock, haze, cam);
    expect(shadowEligible(held)).toBe(false);
    expect(shadowEligible(haze)).toBe(false);
    const renderer = { shadowMap: { enabled: false, type: 0 } } as unknown as THREE.WebGLRenderer;
    const s = sunShadows(renderer, true);
    cam.position.set(30, 2, -40);
    cam.updateMatrixWorld();
    s.update(scene, cam);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(key.castShadow).toBe(true);
    expect(rock.castShadow && rock.receiveShadow).toBe(true);
    expect(haze.castShadow || held.castShadow).toBe(false);
    expect(key.target.position.distanceTo(cam.position)).toBeLessThan((SHADOWS.extent * 2) / SHADOWS.mapSize * 2);
    expect(key.position.distanceTo(key.target.position)).toBeCloseTo(SHADOWS.distance);
  });

  it('rings the zone with distant landforms inside the sky dome', async () => {
    const { horizonLands, ridgeProfile, HORIZON } = await import('../src/render/horizon');
    const g = horizonLands({ seed: 7 });
    expect(g.children.length).toBe(HORIZON.radii.length);
    for (const m of g.children as THREE.Mesh[]) {
      m.geometry.computeBoundingSphere();
      const pos = m.geometry.attributes.position;
      let maxR = 0;
      for (let i = 0; i < pos.count; i++) maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getZ(i)));
      expect(maxR).toBeLessThan(900);
    }
    for (let t = 0; t < 1; t += 0.01) { const h = ridgeProfile(7, t); expect(h).toBeGreaterThan(0); expect(h).toBeLessThan(1.6); }
  });

  it('gives terrain, flesh and chitin relief through the shared bump hook', async () => {
    const { zoneRock, livingFlesh, chitin } = await import('../src/render/materials');
    for (const m of [zoneRock(), livingFlesh('#5A2A55', '#FF3FA4', '#FF3FA4'), chitin()]) {
      const s = compile(m);
      expect(s.fragmentShader).toContain('#define BIO_BUMP');
      expect(s.fragmentShader).toMatch(/BIO_BUMP\(.+\)\s*;/);
    }
  });

  it('adds close-range micro detail that fades before it can alias', async () => {
    const { zoneRock, livingFlesh, chitin } = await import('../src/render/materials');
    for (const m of [zoneRock(), livingFlesh('#5A2A55', '#FF3FA4', '#FF3FA4'), chitin()]) {
      const s = compile(m);
      expect(s.fragmentShader).toContain('length(vViewPosition)');
      expect(s.fragmentShader).toContain('fwidth(');
    }
  });

  it('grades night shadows without clipping them to black, and sharpens', async () => {
    const { GradeShader } = await import('../src/render/pipeline');
    expect(GradeShader.fragmentShader).not.toContain('(col - 0.5) * uContrast');
    expect(GradeShader.uniforms.uSharpen.value).toBeGreaterThan(0);
    expect(GradeShader.uniforms.uSharpen.value).toBeLessThan(0.5);
    // The power-curve contrast keeps a dark value above zero at the zone's contrast.
    const curve = (v: number, k: number) => Math.pow(v / 0.3, k) * 0.3;
    expect(curve(0.05, 1.12)).toBeGreaterThan(0.03);
  });

  it('has a complete impact look for every living-weapon style', async () => {
    const { SHOT_STYLES, shotStyle } = await import('../src/render/shotfx');
    for (const s of ['spore', 'quill', 'spit', 'bile', 'beam']) {
      const look = SHOT_STYLES[s as keyof typeof SHOT_STYLES];
      expect(look.n).toBeGreaterThan(0);
      expect(look.size[0]).toBeLessThanOrEqual(look.size[1]);
    }
    expect(shotStyle('nope')).toBe(SHOT_STYLES.spore);
  });
});
