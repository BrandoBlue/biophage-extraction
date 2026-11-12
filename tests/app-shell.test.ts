import { describe, expect, it } from 'vitest';
import { APP_ICONS, appIconSvg, buildManifest } from '../src/app/app-shell';
import { ALL_COLOURS } from '../src/render/palette';

describe('installable app shell', () => {
  const m = buildManifest() as Record<string, any>;
  it('works under the GitHub Pages sub-path', () => {
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    for (const i of m.icons) expect(i.src.startsWith('/')).toBe(false);
  });
  it('opens without browser bars and asks for fullscreen first', () => {
    expect(m.display).toBe('standalone');
    expect(m.display_override[0]).toBe('fullscreen');
  });
  it('has the icon sizes Chrome and Edge need, including a maskable one', () => {
    const sizes = m.icons.map((i: any) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(m.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
    expect(APP_ICONS.length).toBe(m.icons.length);
  });
  it('draws the icon only with palette colours', () => {
    const palette = new Set(Object.values(ALL_COLOURS).map((c) => c.toUpperCase()));
    for (const maskable of [false, true]) {
      const hexes = appIconSvg(512, maskable).match(/#[0-9A-Fa-f]{6}/g) ?? [];
      expect(hexes.length).toBeGreaterThan(0);
      for (const h of hexes) expect(palette.has(h.toUpperCase()), h).toBe(true);
    }
    expect(palette.has(m.theme_color)).toBe(true);
  });
});
