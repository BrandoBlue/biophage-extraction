/**
 * Borderless fullscreen for the whole game (Brandon, 2026-11-12). The browser owns the switch: it needs a click or key
 * press, and Esc always leaves. The canvas follows on `resize`; the frame rate follows the display (setAnimationLoop).
 */
export const isFullscreen = (): boolean => !!document.fullscreenElement;

export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* refused (iframe without allowfullscreen, or no user gesture): stay windowed */ }
  return isFullscreen();
}

/** Whether this page may go fullscreen at all (an embedding iframe can forbid it). */
export const canFullscreen = (): boolean => document.fullscreenEnabled !== false;
