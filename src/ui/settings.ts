/**
 * Player settings (Hive menu → Settings). Stored client-side; the raid reads them through getSettings().
 * Ranges are UI limits, not balance numbers.
 */
/** eyeScope: long-range guns aim through the living-eye scope; off = a slight zoom with the normal reticle. */
/**
 * brightness: exposure multiplier on top of the zone's grade (1 = as designed).
 * renderScale: fraction of the display's pixel density the 3D view renders at (lower = faster).
 * graphics: 'high' (all effects), 'balanced' (no ambient occlusion), 'performance' (no AO or sun shadows, 1x density cap)
 * for high refresh rates. The frame rate is never capped by the game; it follows the display (60 to 240 Hz and up).
 */
export type GraphicsLevel = 'high' | 'balanced' | 'performance';
export const GRAPHICS_LEVELS: GraphicsLevel[] = ['high', 'balanced', 'performance'];
export interface Settings { sensitivity: number; fov: number; volume: number; reduceMotion: boolean; eyeScope: boolean; brightness: number; renderScale: number; graphics: GraphicsLevel }
export const SETTINGS_KEY = 'biophage.settings.v1';
export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, fov: 75, volume: 0.8, reduceMotion: false, eyeScope: true, brightness: 1, renderScale: 1, graphics: 'high' };
export const SETTING_RANGES = { sensitivity: [0.2, 3, 0.05], fov: [60, 100, 1], volume: [0, 1, 0.05], brightness: [0.6, 1.8, 0.05], renderScale: [0.5, 1, 0.05] } as const;

export function getSettings(store: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): Settings {
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    const s = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    for (const [k, [lo, hi]] of Object.entries(SETTING_RANGES)) {
      const v = Number(s[k]);
      s[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_SETTINGS[k as keyof typeof SETTING_RANGES];
    }
    s.reduceMotion = !!s.reduceMotion;
    s.eyeScope = s.eyeScope !== false;
    if (!GRAPHICS_LEVELS.includes(s.graphics)) s.graphics = DEFAULT_SETTINGS.graphics;
    return s;
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s: Settings, store: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null): void {
  store?.setItem(SETTINGS_KEY, JSON.stringify(s));
  if (typeof dispatchEvent === 'function' && typeof CustomEvent === 'function') dispatchEvent(new CustomEvent('biophage:settings', { detail: s }));
}
