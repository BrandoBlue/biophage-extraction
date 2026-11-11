import * as THREE from 'three';
import { bioTime } from './materials';

/**
 * Atmosphere for built spaces: light shafts through openings (slit windows, open roofs, lab pedestals)
 * and haze volumes that fill interiors. Both are cheap additive shells with no lights and no textures;
 * they give depth instead of more glow (Art Bible, "Ethereal, not neon").
 *
 *   scene.add(lightShaft({ from: windowCentre, to: floorSpot, width: 0.6, colour: HIVE.bone }));
 *   scene.add(hazeVolume({ centre, size: new THREE.Vector3(8, 6, 8), colour: ZONE7_SHADE.skyHorizon }));
 */

export interface ShaftOptions {
  /** Where light enters (window, roof opening) and where it lands, in world space. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Width at the opening, and how much it spreads by the far end (1 = parallel). */
  width?: number;
  spread?: number;
  colour?: THREE.ColorRepresentation;
  /** Peak opacity; keep low, shafts stack. */
  strength?: number;
}

export function lightShaftMaterial(colour: THREE.ColorRepresentation, strength = 0.05): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uCol: { value: new THREE.Color(colour) }, uStrength: { value: strength }, bioTime },
    vertexShader: 'varying vec2 vUv; varying vec3 vN, vV, vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uStrength, bioTime; varying vec2 vUv; varying vec3 vN, vV, vW;
      float h(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main() {
        // Soft edges: brightest where the shell faces the viewer (the shaft's core), fading at the rim.
        float core = pow(abs(dot(vN, vV)), 2.0);
        // Fade in just past the opening and out before the floor, so neither end shows a hard cap.
        float along = smoothstep(0.0, 0.12, 1.0 - vUv.y) * (1.0 - smoothstep(0.75, 1.0, 1.0 - vUv.y));
        // Dust drifting through the beam.
        float dust = 0.7 + 0.3 * n(vW * 1.6 + vec3(0.0, -bioTime * 0.15, bioTime * 0.05));
        float a = core * along * dust * uStrength;
        gl_FragColor = vec4(uCol * a, a);
      }`,
  });
}

/** A shaft of light from an opening to where it lands. */
export function lightShaft(o: ShaftOptions): THREE.Mesh {
  const dir = o.to.clone().sub(o.from);
  const len = dir.length();
  const w = o.width ?? 0.8;
  // Cylinder from y = +len/2 (opening, uv.y = 1) to -len/2 (landing, uv.y = 0); widens toward the floor.
  const geo = new THREE.CylinderGeometry(w * 0.5, w * 0.5 * (o.spread ?? 1.6), len, 20, 1, true);
  const mesh = new THREE.Mesh(geo, lightShaftMaterial(o.colour ?? 0xffffff, o.strength ?? 0.05));
  mesh.position.copy(o.from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate().normalize());
  mesh.name = 'light-shaft';
  mesh.userData.noAO = true;
  mesh.renderOrder = 3;
  return mesh;
}

export interface HazeOptions {
  centre: THREE.Vector3;
  size: THREE.Vector3;
  colour?: THREE.ColorRepresentation;
  /** Optical density per metre of view depth through the box; 0.02 to 0.06 reads as light haze. */
  density?: number;
}

/**
 * Interior haze: a box whose back faces integrate view depth through it, thickest near the floor.
 * Rendered after opaques, depth-tested, so walls and creatures occlude it naturally.
 */
export function hazeVolume(o: HazeOptions): THREE.Mesh {
  const geo = new THREE.BoxGeometry(o.size.x, o.size.y, o.size.z);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
    uniforms: {
      uCol: { value: new THREE.Color(o.colour ?? 0x808080) }, uDensity: { value: o.density ?? 0.035 },
      uMin: { value: o.centre.clone().addScaledVector(o.size, -0.5) }, uMax: { value: o.centre.clone().addScaledVector(o.size, 0.5) }, bioTime,
    },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      uniform vec3 uCol, uMin, uMax; uniform float uDensity, bioTime; varying vec3 vW;
      void main() {
        // Ray from the camera to this back face, clipped to the box: the length inside is the haze depth.
        vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
        vec3 t0 = (uMin - ro) / rd, t1 = (uMax - ro) / rd;
        vec3 tn = min(t0, t1), tf = max(t0, t1);
        float enter = max(max(max(tn.x, tn.y), tn.z), 0.0);
        float exit = length(vW - ro);
        float depth = max(0.0, exit - enter);
        // Thicker toward the floor of the volume.
        float midY = ro.y + rd.y * (enter + exit) * 0.5;
        float low = 1.0 - smoothstep(uMin.y, uMax.y, midY) * 0.7;
        float a = 1.0 - exp(-depth * uDensity * low);
        gl_FragColor = vec4(uCol, a * 0.85);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(o.centre);
  mesh.name = 'haze-volume';
  mesh.userData.noAO = true;
  mesh.renderOrder = 2;
  return mesh;
}
