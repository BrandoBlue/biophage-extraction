import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { creatureHide } from '../src/creatures/hide';
import { slotMaterial } from '../src/creatures/rig';
import { planFor } from '../src/creatures/species';

const compile = (m: THREE.Material) => {
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <emissivemap_fragment>\nmaterial.clearcoat = clearcoat;' } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
};

describe('Abomination hide', () => {
  it('adds sutures, dry crust, tumour knots and bone, and dry crust loses its clearcoat', () => {
    const s = compile(creatureHide('#6E4E4C', '#5A3036', '#8C9BB4', '#4A3A34', '#D3CBB2', 6));
    for (const k of ['seam', 'stitch', 'dry', 'cracks', 'boneWin', 'tum', 'bruise']) expect(s.fragmentShader, k).toContain(k);
    expect(s.fragmentShader).toContain('material.clearcoat = clearcoat * hideWet;');
    expect(Object.keys(s.uniforms)).toEqual(expect.arrayContaining(['uCrust', 'uBone', 'uHideScale']));
  });

  it('is the flesh of every Abomination', () => {
    for (const id of ['needlemaw', 'bilecantor', 'glasswalker', 'oculimoth', 'mournback'] as const) {
      const s = compile(slotMaterial(planFor(id, 1, 0), 'flesh'));
      expect(s.fragmentShader, id).toContain('hideWet');
    }
  });
});
