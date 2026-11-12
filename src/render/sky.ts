import * as THREE from 'three';
import { ZONE7, ZONE7_SHADE } from './palette';
import { bioTime, GLSL_NOISE } from './materials';

const col = (hex: string) => ({ value: new THREE.Color(hex) });

/**
 * Zone 7 sky: a psychedelic nebula dome (reference 04). Domain-warped noise mixes magenta, violet and
 * cyan gas over a deep void, with a bright plasma rift, dust lanes and twinkling stars. Fully procedural.
 */
export function zone7Sky(radius = 900): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      bioTime,
      uZenith: col(ZONE7_SHADE.skyZenith), uHorizon: col(ZONE7_SHADE.skyHorizon), uVoid: col(ZONE7.void),
      uMagenta: col(ZONE7.magenta), uCyan: col(ZONE7.cyan), uViolet: col(ZONE7.violet), uLime: col(ZONE7.lime),
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform float bioTime;
      uniform vec3 uZenith, uHorizon, uVoid, uMagenta, uCyan, uViolet, uLime;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.1, 0.7, h));
        sky = mix(sky, uVoid * 0.6, (1.0 - smoothstep(-0.5, 0.0, h)));

        // Domain-warped nebula
        vec3 q = d * 2.2 + vec3(0.0, 0.0, bioTime * 0.004);
        vec3 w = vec3(bioFbm(q + 1.7), bioFbm(q + 9.2), bioFbm(q + 4.4));
        float n = bioFbm(q * 1.4 + w * 2.6);
        float n2 = bioFbm(q * 2.7 - w * 1.8 + 3.0);
        vec3 gas = mix(uViolet, uMagenta, smoothstep(0.35, 0.75, w.x));
        gas = mix(gas, uCyan, smoothstep(0.55, 0.85, w.y) * 0.85);
        float density = smoothstep(0.38, 0.85, n);
        // Ethereal, not neon: the gas is a veil, partly desaturated toward its own luminance.
        // Grounded and eerie: the nebula is a faint, mostly grey veil behind an overcast night, not a light show.
        gas = mix(vec3(dot(gas, vec3(0.2126, 0.7152, 0.0722))), gas, 0.3);
        sky += gas * density * 0.36;
        sky += uMagenta * smoothstep(0.6, 0.95, n2) * 0.03;

        // Plasma rift: a bright band of cyan-white across the sky, broken by noise.
        vec3 axis = normalize(vec3(0.35, 0.82, -0.45));
        float band = exp(-pow(dot(d, axis) * 7.0 + (n - 0.5) * 2.2, 2.0)) * smoothstep(-0.05, 0.25, h);
        sky += mix(uCyan, vec3(1.0), 0.6) * band * smoothstep(0.55, 0.9, n2 + n * 0.4) * 0.26;
        sky += uViolet * band * 0.06;

        // Dust lanes eat into the gas.
        float dust = smoothstep(0.5, 0.75, bioFbm(q * 3.5 + w * 3.0));
        sky *= mix(1.0, 0.35, dust * density);

        // Stars are a separate point layer (starField): crisp at any cubemap resolution.
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
  mesh.name = 'zone7-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** A gas giant or moon with a lit terminator, banding and an atmospheric rim. Optional ring. */
export function planet(opts: { radius: number; band: string; rim: string; ring?: string; lightDir: THREE.Vector3; seed?: number; ringNormal?: THREE.Vector3 }): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(opts.radius, 64, 48),
    new THREE.ShaderMaterial({
      fog: false,
      uniforms: { uBand: col(opts.band), uRim: col(opts.rim), uBase: col(ZONE7_SHADE.planet), uHaze: col(ZONE7_SHADE.skyHorizon), uLight: { value: opts.lightDir.clone().normalize() }, uSeed: { value: opts.seed ?? 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vP; varying vec3 vView;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal); vP = position;
          vec4 wp = modelMatrix * vec4(position, 1.0); vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uBand, uRim, uBase, uHaze, uLight; uniform float uSeed;
        varying vec3 vN; varying vec3 vP; varying vec3 vView;
        ${GLSL_NOISE}
        void main() {
          vec3 p = normalize(vP);
          float bands = bioFbm(vec3(p.y * 9.0 + bioFbm(p * 3.0 + uSeed) * 2.0, uSeed, 0.0));
          // Soft, low-contrast banding in a greyed band colour: a distant world seen through haze, not a poster.
          vec3 band = mix(vec3(dot(uBand, vec3(0.2126, 0.7152, 0.0722))), uBand, 0.2);
          vec3 surf = mix(uBase, band, smoothstep(0.3, 0.8, bands) * 0.4);
          surf = mix(surf, uRim * 0.6, smoothstep(0.7, 0.9, bioFbm(p * 6.0 + uSeed)) * 0.4);
          float lit = smoothstep(-0.15, 0.6, dot(vN, uLight));
          float fres = pow(1.0 - max(dot(vN, vView), 0.0), 3.0);
          vec3 c = surf * (0.08 + lit * 0.9) + uRim * fres * (0.25 + lit * 1.1);
          // Aerial perspective: veil the disc in the sky's horizon haze, a little more on the dark side.
          c = mix(c, uHaze * 0.55, 0.5 + 0.2 * (1.0 - lit));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  g.add(body);
  if (opts.ring) {
    const inner = opts.radius * 1.35, outer = opts.radius * 2.3;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 128, 1),
      new THREE.ShaderMaterial({
        fog: false, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uCol: col(opts.ring), uRim: col(opts.rim), uIn: { value: inner }, uOut: { value: outer } },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: /* glsl */ `
          uniform vec3 uCol, uRim; uniform float uIn, uOut; varying vec3 vP;
          ${GLSL_NOISE}
          void main() {
            float t = (length(vP.xy) - uIn) / (uOut - uIn);
            float bands = bioNoise(vec3(t * 60.0, 0.0, 0.0)) * 0.7 + bioNoise(vec3(t * 13.0, 5.0, 0.0)) * 0.5;
            float a = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.75, 1.0, t)) * bands;
            vec3 c = mix(uCol, uRim, t);
            c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.2);
            gl_FragColor = vec4(c * a * 0.25, a);
          }`,
      }),
    );
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), (opts.ringNormal ?? new THREE.Vector3(0.2, 1, 0.1)).clone().normalize());
    g.add(ring);
  }
  return g;
}

/** Sea of luminous cloud far below the islands; sells the height and fills the lower frame with colour. */
export function cloudSea(y: number, size = 2400): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    fog: false, transparent: true, depthWrite: false,
    uniforms: { bioTime, uA: col(ZONE7.violet), uB: col(ZONE7.magenta), uC: col(ZONE7.cyan), uVoid: col(ZONE7.void) },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      uniform float bioTime; uniform vec3 uA, uB, uC, uVoid; varying vec3 vW;
      ${GLSL_NOISE}
      void main() {
        vec3 p = vec3(vW.xz * 0.006, bioTime * 0.02);
        float n = bioFbm(p + bioFbm(p * 2.0 + 3.0));
        vec3 c = mix(uA, uB, smoothstep(0.35, 0.7, n));
        c = mix(c, uC, smoothstep(0.62, 0.8, bioFbm(p * 1.7 + 7.0)) * 0.6);
        float dist = length(vW.xz - cameraPosition.xz);
        float a = smoothstep(0.25, 0.7, n) * (1.0 - smoothstep(300.0, 1200.0, dist));
        gl_FragColor = vec4(mix(uVoid, c, 0.55) * (0.5 + n), a * 0.85);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  mesh.position.y = y;
  mesh.renderOrder = -5;
  mesh.name = 'cloud-sea';
  return mesh;
}

/** Drifting glowing spores. Animated entirely on the GPU. */
export function sporeField(rand: () => number, count: number, radius: number, height: number, colours: string[]): THREE.Points {
  const pos = new Float32Array(count * 3);
  const colArr = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * radius;
    pos.set([Math.cos(a) * d, rand() * height, Math.sin(a) * d], i * 3);
    tmp.set(colours[i % colours.length]);
    colArr.set([tmp.r, tmp.g, tmp.b], i * 3);
    seed[i] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { bioTime, uBox: { value: new THREE.Vector3(radius * 2, height, radius * 2) } },
    vertexShader: /* glsl */ `
      uniform float bioTime; uniform vec3 uBox; attribute float seed; attribute vec3 color; varying vec3 vC; varying float vA;
      void main() {
        // The field wraps around the camera, so spores are everywhere without placing millions.
        vec3 p = position;
        p.y += bioTime * (0.3 + seed * 0.6);
        p = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5 + cameraPosition;
        p.x += sin(bioTime * 0.4 + seed * 30.0) * 2.0; p.z += cos(bioTime * 0.33 + seed * 17.0) * 2.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min((1.0 + seed * 2.5) * (90.0 / -mv.z), 7.0);
        vC = color; vA = (0.4 + 0.6 * sin(bioTime * 2.0 + seed * 50.0) * 0.5 + 0.3) * (1.0 - smoothstep(20.0, 120.0, -mv.z)) * smoothstep(2.0, 6.0, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.0, 0.5, d)); a *= a;
        gl_FragColor = vec4(vC * 1.2 * a * vA, a * vA);
      }`,
  }));
  pts.frustumCulled = false;
  pts.name = 'spore-field';
  return pts;
}

/**
 * Star layer: GPU points on a far sphere, always pixel-sharp (the sky cubemap is baked small on
 * software renderers, where per-texel stars turned into squares). Follows the camera.
 */
export function starField(rand: () => number, count = 2600, radius = 1300): THREE.Points {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.set(rand() * 2 - 1, rand() * 1.2 - 0.25, rand() * 2 - 1).normalize().multiplyScalar(radius);
    pos.set([v.x, v.y, v.z], i * 3);
    seed[i] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { bioTime, uCyan: col(ZONE7.cyan) },
    vertexShader: /* glsl */ `
      uniform float bioTime; attribute float seed; varying float vS; varying float vTw;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w * 0.9999; // behind everything, in front of the far plane
        vS = seed;
        vTw = 0.6 + 0.4 * sin(bioTime * (1.0 + seed * 3.0) + seed * 40.0);
        gl_PointSize = seed > 0.97 ? 4.5 : (seed > 0.8 ? 3.0 : 2.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCyan; varying float vS; varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.15, 0.5, d);
        vec3 c = mix(uCyan, vec3(1.0), vS) * (0.9 + vS * 1.6) * vTw;
        gl_FragColor = vec4(c * a, a);
      }`,
  }));
  pts.frustumCulled = false;
  pts.renderOrder = -8;
  pts.name = 'star-field';
  return pts;
}
