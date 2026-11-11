import * as THREE from 'three';
import { HIVE, PATH, ZONE7 } from './palette';
import { bioNode, bioSurface, bioTime, chitin, livingFlesh } from './materials';

/**
 * The Hive's Genetic Evolution lab stage (reference 03): a specimen on a lit pedestal in a low-key
 * black-teal chamber, acid-green rim light, pedestal light pool, light haze and organic roots framing
 * the shot. UI screens (lab, class select, stash) render their 3D specimen through this.
 *
 *   const lab = createHiveLab();
 *   lab.place(specimenRoot);                 // stands on the pedestal, centred, feet at y = 0 of its root
 *   pipeline.overrideScene = lab.scene;      // render the lab instead of the raid
 *   pipeline.overrideCamera = lab.camera;
 *   pipeline.setPreset('hive');
 *   lab.orbit(yaw);                          // turntable the camera (drag to rotate)
 */
export interface HiveLab {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Top of the pedestal; place() parents the specimen here. */
  plinth: THREE.Group;
  place(specimen: THREE.Object3D): void;
  /** Turntable yaw in radians, around the pedestal. */
  orbit(yaw: number): void;
  /** Image-based light for the GPU tier: bakes the chamber's glow into scene.environment. */
  bakeEnvironment(renderer: THREE.WebGLRenderer): void;
}

export const LAB = {
  /** Pedestal top height and radius (m). */
  plinthY: 0.42,
  plinthR: 1.35,
  /** Camera framing: distance from the pedestal axis, eye height, look-at height, vertical FOV. */
  camDist: 8.2,
  camY: 2.1,
  lookY: 1.3,
  fov: 34,
};

/** Dark lab floor: wet black-teal tiles with faint acid seams that brighten toward the pedestal. */
function labFloor(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: HIVE.background, roughness: 0.28, metalness: 0.5, emissive: HIVE.acid });
  return bioSurface(mat, {
    fragment: /* glsl */ `
      vec2 q = vBioWorld.xz * 1.6;
      vec2 g = abs(fract(q) - 0.5);
      float seam = 1.0 - smoothstep(0.0, 0.03, 0.5 - max(g.x, g.y));
      float r = length(vBioWorld.xz);
      float nearPed = 1.0 - smoothstep(1.5, 6.0, r);
      float pulse = 0.6 + 0.4 * sin(bioTime * 1.4 - r * 2.5);
      diffuseColor.rgb *= 0.7 + 0.5 * bioNoise(vBioWorld * 3.0);
      roughnessFactor = mix(0.12, 0.5, bioNoise(vBioWorld * 1.3));
      totalEmissiveRadiance = emissive * seam * (0.02 + nearPed * 0.22 * pulse);
    `,
  });
}

/** Pedestal top: dark wet glass etched with slowly turning concentric rings and spokes of acid light. */
function plinthTop(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: HIVE.background, roughness: 0.08, metalness: 0.2, clearcoat: 1, emissive: HIVE.acid });
  return bioSurface(mat, {
    uniforms: { uDna: { value: new THREE.Color(PATH.dna) } },
    declarations: 'uniform vec3 uDna;\n',
    fragment: /* glsl */ `
      vec2 q = vBioWorld.xz;
      float r = length(q);
      float ang = atan(q.y, q.x);
      float rings = 1.0 - smoothstep(0.0, 0.035, abs(fract(r * 3.2 - bioTime * 0.05) - 0.5) * 2.0 - 0.9);
      float spokes = (1.0 - smoothstep(0.0, 0.05, abs(fract(ang * 3.8197 + bioTime * 0.03) - 0.5) * 2.0 - 0.9)) * smoothstep(0.35, 0.6, r);
      float outer = 1.0 - smoothstep(0.0, 0.06, abs(r - 1.22));
      float centre = 1.0 - smoothstep(0.0, 0.7, r);
      float pulse = 0.75 + 0.25 * sin(bioTime * 1.6 - r * 4.0);
      totalEmissiveRadiance = emissive * (rings * 0.35 + spokes * 0.2 + outer * 0.9 + centre * 0.25) * pulse + uDna * outer * 0.3;
    `,
  });
}

/** Soft volumetric-looking shaft of light falling on the pedestal: additive, fades with height and at the rim. */
function lightShaft(colour: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uCol: { value: new THREE.Color(colour) }, bioTime },
    vertexShader: 'varying vec2 vUv; varying vec3 vN, vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float bioTime; varying vec2 vUv; varying vec3 vN, vV;
      void main() {
        float facing = abs(dot(vN, vV));
        float core = pow(facing, 2.0);
        float fall = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.65, 1.0, vUv.y));
        float drift = 0.85 + 0.15 * sin(vUv.y * 18.0 - bioTime * 0.8 + vUv.x * 25.0);
        float a = core * fall * drift * 0.035;
        gl_FragColor = vec4(uCol * a, a);
      }`,
  });
}

/** Hooked bone root curling out of the floor and over toward the pedestal. */
function root(angle: number, radius: number, height: number, seed: number): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const r = radius - t * radius * 0.55;
    const a = angle + Math.sin(t * 3 + seed) * 0.25;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(t * Math.PI * 0.85) * height, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.09 + (seed % 3) * 0.03, 7);
}

export function createHiveLab(): HiveLab {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HIVE.background);
  scene.fog = new THREE.FogExp2(HIVE.background, 0.035);

  // Chamber: floor and a far cylindrical wall with dim vertical light ribs.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64).rotateX(-Math.PI / 2), labFloor());
  scene.add(floor);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 9, 48, 1, true), new THREE.MeshStandardMaterial({ color: HIVE.panel, roughness: 0.6, metalness: 0.3, side: THREE.BackSide }));
  wall.position.y = 4.5;
  scene.add(wall);
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    ribs.push(new THREE.BoxGeometry(0.05, 6, 0.05).translate(Math.cos(a) * 10.9, 3.4, Math.sin(a) * 10.9));
  }
  const ribMat = new THREE.MeshStandardMaterial({ color: HIVE.background, emissive: HIVE.acid, emissiveIntensity: 0.6 });
  scene.add(new THREE.Mesh(mergeAll(ribs), ribMat));

  // Pedestal: armoured drum, glowing seam, liquid-light top pool, bone claws gripping it.
  const ped = new THREE.Group();
  const shell = chitin(HIVE.panel, HIVE.acid, 2.5);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(LAB.plinthR + 0.25, LAB.plinthR + 0.45, 0.28, 48), shell);
  drum.position.y = 0.14;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(LAB.plinthR, LAB.plinthR + 0.15, 0.14, 48), shell);
  cap.position.y = 0.35;
  const seam = new THREE.Mesh(new THREE.TorusGeometry(LAB.plinthR + 0.1, 0.025, 8, 64).rotateX(Math.PI / 2), bioNode(HIVE.acid, 1.4));
  seam.position.y = 0.29;
  const pool = new THREE.Mesh(new THREE.CircleGeometry(LAB.plinthR - 0.02, 64).rotateX(-Math.PI / 2), plinthTop());
  pool.position.y = LAB.plinthY + 0.005;
  ped.add(drum, cap, seam, pool);
  const bone = chitin(HIVE.bone, HIVE.acid, 5);
  const claws: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const pts = [0, 1, 2, 3, 4].map((k) => {
      const t = k / 4;
      const r = LAB.plinthR + 0.75 - t * 0.6 - Math.sin(t * Math.PI) * -0.25;
      return new THREE.Vector3(Math.cos(a + t * 0.2) * r, t * 0.6, Math.sin(a + t * 0.2) * r);
    });
    claws.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.07, 6));
    claws.push(new THREE.ConeGeometry(0.07, 0.25, 6).translate(0, 0.12, 0).rotateZ(0.9).rotateY(-a).translate(pts[4].x, pts[4].y, pts[4].z));
  }
  const clawMesh = new THREE.Mesh(mergeAll(claws), bone);
  ped.add(clawMesh);
  scene.add(ped);
  const plinth = new THREE.Group();
  plinth.position.y = LAB.plinthY;
  scene.add(plinth);

  // Light shaft from above, haze on the floor comes from the shared height fog.
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(LAB.plinthR * 0.7, LAB.plinthR * 1.15, 6, 32, 1, true), lightShaft(HIVE.acid));
  shaft.position.y = 3.3;
  shaft.userData.noAO = true;
  scene.add(shaft);

  // Organic roots framing the chamber (reference 03's vine border), studded with dim acid nodes.
  const fleshMat = livingFlesh(HIVE.panel, HIVE.acid, ZONE7.violet, 3);
  const roots: THREE.BufferGeometry[] = [];
  const nodes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 1.02 + (i / 8) * Math.PI * 0.96; // behind the pedestal only (camera sits on +z)
    roots.push(root(a, 7 + (i % 3), 3.5 + (i % 4) * 0.9, i));
    nodes.push(new THREE.SphereGeometry(0.09 + (i % 3) * 0.03, 10, 8).translate(Math.cos(a) * 6.2, 1.2 + (i % 4) * 0.5, Math.sin(a) * 6.2));
  }
  scene.add(new THREE.Mesh(mergeAll(roots), fleshMat));
  scene.add(new THREE.Mesh(mergeAll(nodes), bioNode(HIVE.acid, 1.8)));

  // Drifting spores in the shaft.
  const motes = new Float32Array(240 * 3);
  for (let i = 0; i < 240; i++) {
    const a = i * 2.399, r = Math.sqrt((i * 0.618) % 1) * 3.2;
    motes.set([Math.cos(a) * r, ((i * 0.377) % 1) * 5, Math.sin(a) * r], i * 3);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motes, 3));
  const moteLayer = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: HIVE.acid, size: 0.025, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  moteLayer.onBeforeRender = () => { moteLayer.rotation.y = bioTime.value * 0.03; moteLayer.position.y = Math.sin(bioTime.value * 0.2) * 0.2; };
  scene.add(moteLayer);

  // Lighting: low-key teal fill, a cool top key, two hard acid/cyan rims from behind, pedestal under-glow.
  scene.add(new THREE.HemisphereLight(HIVE.panel, HIVE.background, 0.7));
  const key = new THREE.SpotLight(HIVE.bone, 90, 14, 0.42, 0.6, 1.6);
  key.position.set(1.8, 7, 3);
  key.target.position.set(0, 1, 0);
  const rimL = new THREE.SpotLight(HIVE.acid, 55, 14, 0.5, 0.5, 1.6);
  rimL.position.set(-3.2, 3.4, -3.6);
  rimL.target.position.set(0, 1.2, 0);
  const rimR = new THREE.SpotLight(PATH.dna, 40, 14, 0.5, 0.5, 1.6);
  rimR.position.set(3.4, 2.6, -3.2);
  rimR.target.position.set(0, 1.2, 0);
  const under = new THREE.PointLight(HIVE.acid, 2.5, 4, 2);
  under.position.set(0, LAB.plinthY + 0.7, 1.1);
  scene.add(key, key.target, rimL, rimL.target, rimR, rimR.target, under);

  const camera = new THREE.PerspectiveCamera(LAB.fov, 16 / 9, 0.1, 60);
  const orbit = (yaw: number) => {
    camera.position.set(Math.sin(yaw) * LAB.camDist, LAB.camY, Math.cos(yaw) * LAB.camDist);
    camera.lookAt(0, LAB.lookY, 0);
  };
  orbit(0);

  let baked = false;
  return {
    scene, camera, plinth, orbit,
    place(specimen) {
      plinth.clear();
      plinth.add(specimen);
    },
    bakeEnvironment(renderer) {
      if (baked) return;
      baked = true;
      // A coarse glow-only copy of the chamber is enough for reflections on wet chitin.
      const env = new THREE.Scene();
      env.background = new THREE.Color(HIVE.background);
      const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(HIVE.acid).multiplyScalar(2) });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        env.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), strip).translateX(Math.cos(a) * 8).translateZ(Math.sin(a) * 8).translateY(3));
      }
      const top = new THREE.Mesh(new THREE.CircleGeometry(3, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(HIVE.bone).multiplyScalar(1.5) }));
      top.position.y = 8;
      env.add(top);
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(env, 0.02).texture;
      pmrem.dispose();
    },
  };
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Non-indexed, normal and position only: roots, claws and nodes mix tube, cone and sphere geometry.
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
