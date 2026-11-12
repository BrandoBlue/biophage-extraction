import * as THREE from 'three';
import { bioSurface } from '../render/materials';

/**
 * Abomination hide: Rendering's grounded rule 3 ("strange texture: sutures, pores, tumour clusters, exposed bone,
 * wet against dry") on top of the living-flesh look. Wet mottled skin with pores and veins, broken by:
 *  - sutures: sunken seams where the skin was grown together, puckered with stitch pits along them,
 *  - dry patches: crusted, cracked, matte hide with no clearcoat (wet against dry),
 *  - tumour clusters: tight knots of glossy swellings in a few places,
 *  - bone windows: where the crust has worn through to pale bone.
 * `scale` is detail per local unit, as livingFlesh (6-10 for creature bodies).
 */
export function creatureHide(base: string, vein: string, rim: string, crust: string, bone: string, scale = 8): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.4, sheen: 0.25, sheenColor: new THREE.Color(rim), sheenRoughness: 0.5 });
  bioSurface(mat, {
    uniforms: { uVein: { value: new THREE.Color(vein) }, uRim: { value: new THREE.Color(rim) }, uCrust: { value: new THREE.Color(crust) }, uBone: { value: new THREE.Color(bone) }, uHideScale: { value: scale } },
    declarations: 'uniform vec3 uVein, uRim, uCrust, uBone; uniform float uHideScale;\nfloat hideWet = 1.0;\n',
    fragment: /* glsl */ `
      vec3 p = vBioLocal * uHideScale + vBioSeed;
      float mott = bioFbm(p * 0.6);
      diffuseColor.rgb *= 0.6 + mott * 0.75;
      // Bruising: slow dark blotches toward the vein colour, so no stretch of skin is one even tone.
      float bruise = smoothstep(0.45, 0.75, bioNoise(p * 0.3 + 11.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45 + uVein * 0.12, bruise * 0.5);
      float pores = 1.0 - smoothstep(0.05, 0.16, bioCells(p * 1.8));
      diffuseColor.rgb *= 1.0 - pores * 0.3;
      float veins = max(bioVein(p * 0.5), bioVein(p * 1.3 + 4.0) * 0.6);

      // Sutures: long seams (a low-frequency zero-crossing), sunken and dark, with stitch pits along them.
      float seam = 1.0 - smoothstep(0.0, 0.035, abs(bioNoise(p * 0.3 + 21.0) * 2.0 - 1.0));
      float stitch = 0.0;
      if (seam > 0.01) stitch = seam * (1.0 - smoothstep(0.08, 0.2, bioCells(p * 2.6 + 5.0)));
      diffuseColor.rgb *= 1.0 - seam * 0.45 - stitch * 0.25;

      // Dry crust patches against wet skin; cracked, matte, a few worn through to bone.
      float dry = smoothstep(0.42, 0.54, bioNoise(p * 0.22 + 40.0) * 0.75 + bioNoise(p * 0.6 + 41.0) * 0.25);
      float cracks = 0.0, boneWin = 0.0;
      if (dry > 0.01) {
        cracks = bioVein(p * 1.6 + 9.0) * dry;
        boneWin = dry * (1.0 - smoothstep(0.06, 0.14, bioCells(p * 0.45 + 17.0)));
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, uCrust * (0.55 + mott * 0.7), dry * 0.9);
      diffuseColor.rgb *= 1.0 - cracks * 0.6;
      diffuseColor.rgb = mix(diffuseColor.rgb, uBone * (0.75 + mott * 0.3), boneWin);

      // Tumour clusters: knots of swellings where a slow noise peaks.
      float knot = smoothstep(0.6, 0.72, bioNoise(p * 0.16 + 70.0)) * (1.0 - dry);
      float tum = 0.0;
      if (knot > 0.01) tum = knot * (1.0 - smoothstep(0.15, 0.42, bioCells(p * 0.9 + 33.0)));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 0.82, 0.78), tum * 0.6);

      BIO_BUMP(mott * 0.5 - pores * 0.5 + veins * 0.3 * (1.0 - dry) - seam * 0.9 - stitch * 0.5 - cracks * 0.6 + tum * 1.6 + boneWin * 0.3, 0.012);
      float flow = 0.55 + 0.45 * sin(bioTime * 3.0 - dot(vBioLocal, vec3(0.0, 0.0, 40.0)));
      vec3 V = normalize(cameraPosition - vBioWorld);
      float fres = pow(1.0 - abs(dot(normalize(vBioNormal), V)), 2.5);
      // Glow only in a few big veins (grounded rule 2); the fine ones are relief, not light.
      float bigVein = bioVein(p * 0.5) * smoothstep(0.45, 0.6, bioNoise(p * 0.15 + 3.0));
      totalEmissiveRadiance += uVein * bigVein * flow * (1.0 - dry) * 0.4 + uRim * fres * 0.22 * (1.0 - dry * 0.6);
      roughnessFactor = mix(mix(roughnessFactor, 0.15, pores + tum * 0.6), 0.88, max(dry, boneWin * 0.6));
      hideWet = 1.0 - dry;
    `,
  });
  // Dry crust loses its wet clearcoat.
  const inject = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    inject.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('material.clearcoat = clearcoat;', 'material.clearcoat = clearcoat * hideWet;');
  };
  return mat;
}
