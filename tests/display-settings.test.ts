import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS, getSettings, SETTINGS_KEY } from '../src/ui/settings';
import { sunShadows } from '../src/render/lighting';

const store = (v: object) => ({ getItem: (k: string) => (k === SETTINGS_KEY ? JSON.stringify(v) : null) });

describe('display settings', () => {
  it('defaults to designed brightness, full render scale and high graphics', () => {
    expect(DEFAULT_SETTINGS.brightness).toBe(1);
    expect(DEFAULT_SETTINGS.renderScale).toBe(1);
    expect(DEFAULT_SETTINGS.graphics).toBe('high');
  });

  it('clamps brightness and render scale and rejects unknown graphics levels', () => {
    const s = getSettings(store({ brightness: 9, renderScale: 0.1, graphics: 'ultra' }));
    expect(s.brightness).toBe(1.8);
    expect(s.renderScale).toBe(0.5);
    expect(s.graphics).toBe('high');
    expect(getSettings(store({ graphics: 'performance' })).graphics).toBe('performance');
  });

  it('turns sun shadows off and on at runtime only where the tier allows them', () => {
    const renderer = { shadowMap: { enabled: false, type: 0 } } as unknown as THREE.WebGLRenderer;
    const on = sunShadows(renderer, true);
    expect(renderer.shadowMap.enabled).toBe(true);
    on.setActive(false);
    expect(on.active).toBe(false);
    expect(renderer.shadowMap.enabled).toBe(false);
    on.setActive(true);
    expect(renderer.shadowMap.enabled).toBe(true);
    const off = sunShadows(renderer, false);
    off.setActive(true);
    expect(off.active).toBe(false);
  });
});

describe('frame-rate independence', () => {
  it('walks the same distance and jumps the same height at 30, 60, 144 and 240 fps', async () => {
    vi.stubGlobal('addEventListener', () => {});
    vi.stubGlobal('document', { addEventListener: () => {}, pointerLockElement: null });
    const { Player } = await import('../src/game/player');
    const { CLASSES, HOST } = await import('../data');
    const dom = { addEventListener: () => {} } as unknown as HTMLElement;
    const run = (fps: number) => {
      const p = new Player(new THREE.PerspectiveCamera(), CLASSES.neuroInfiltrator, HOST, dom);
      p.position.set(0, 50, 0);
      const dt = 1 / fps;
      for (let t = 0; t < 1; t += dt) p.update(dt); // settle onto the ground
      const start = p.position.clone();
      p.keys.add('KeyW');
      for (let t = 0; t < 2; t += dt) p.update(dt);
      const walked = Math.hypot(p.position.x - start.x, p.position.z - start.z);
      p.keys.clear();
      for (let t = 0; t < 1; t += dt) p.update(dt);
      const floor = p.position.y;
      p.keys.add('Space');
      let apex = floor;
      for (let t = 0; t < 1.5; t += dt) { p.update(dt); p.keys.delete('Space'); apex = Math.max(apex, p.position.y); }
      return { walked, jump: apex - floor };
    };
    const ref = run(60);
    expect(ref.walked).toBeGreaterThan(1);
    expect(ref.jump).toBeGreaterThan(0.3);
    for (const fps of [30, 144, 240]) {
      const r = run(fps);
      expect(Math.abs(r.walked - ref.walked) / ref.walked).toBeLessThan(0.05);
      expect(Math.abs(r.jump - ref.jump) / ref.jump).toBeLessThan(0.05);
    }
    vi.unstubAllGlobals();
  });
});
