/**
 * Player settings (Hive menu → Settings). Stored client-side; the raid reads them through getSettings().
 * Ranges are UI limits, not balance numbers.
 */
export interface Settings { sensitivity: number; fov: number; volume: number; reduceMotion: boolean }
export const SETTINGS_KEY = 'biophage.settings.v1';
export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, fov: 75, volume: 0.8, reduceMotion: false };
export const SETTING_RANGES = { sensitivity: [0.2, 3, 0.05], fov: [60, 100, 1], volume: [0, 1, 0.05] } as const;

export function getSettings(store: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): Settings {
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    const s = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    for (const [k, [lo, hi]] of Object.entries(SETTING_RANGES)) {
      const v = Number(s[k]);
      s[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_SETTINGS[k as keyof typeof SETTING_RANGES];
    }
    s.reduceMotion = !!s.reduceMotion;
    return s;
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s: Settings, store: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null): void {
  store?.setItem(SETTINGS_KEY, JSON.stringify(s));
  if (typeof dispatchEvent === 'function' && typeof CustomEvent === 'function') dispatchEvent(new CustomEvent('biophage:settings', { detail: s }));
}
