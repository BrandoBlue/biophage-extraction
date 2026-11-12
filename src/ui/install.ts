/**
 * Install the game as an app (Brandon, 2026-11-12): on the online build Chrome and Edge can put a BIOPHAGE icon on
 * the desktop and taskbar that opens the game in its own borderless window. The manifest, icons and service worker
 * are only served by the GitHub Pages site (scripts/stage-pages.mjs adds the manifest link), so on the play-link
 * artifact or a file:// copy everything here quietly does nothing.
 */
import { MANIFEST_FILE, SERVICE_WORKER_FILE } from '../app/app-shell';
import { canFullscreen, isFullscreen, toggleFullscreen } from './fullscreen';

/** Chrome / Edge's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** True when the page carries the app manifest, i.e. it is the online (Pages) build. */
export const hasManifest = (): boolean => !!document.querySelector(`link[rel="manifest"][href$="${MANIFEST_FILE}"]`);

/** True when running as the installed app (its own window) rather than in a browser tab. */
export function isInstalledApp(): boolean {
  return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => matchMedia?.(`(display-mode: ${m})`).matches);
}

/** The browser has offered to install, and we can show our own Install button. */
export const canInstall = (): boolean => !!deferred && !installed && !isInstalledApp();
/** Installed in this session or opened from the app icon. */
export const isInstalled = (): boolean => installed || isInstalledApp();

/** Subscribe to install state changes (offer appeared, installed). Returns an unsubscribe. */
export function onInstallChange(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }

/** Show the browser's install dialog. Resolves true if the player accepted. Needs a click. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') installed = true;
    return outcome === 'accepted';
  } catch { return false; } finally { changed(); }
}

/** Plain words for the Settings screen when no Install button can be shown. */
export function installHint(): string {
  if (isInstalled()) return 'Installed. Open BIOPHAGE from its desktop or Start menu icon; it goes fullscreen on your first click.';
  if (!hasManifest()) return 'To get a desktop icon, open the online link (brandoblue.github.io/biophage-extraction) in Chrome or Edge.';
  return 'In Chrome or Edge, use the install icon at the right end of the address bar to get a desktop icon.';
}

let started = false;
/**
 * Wire it all up once at boot: capture the install offer, register the service worker on the Pages build, and in
 * the installed app go borderless fullscreen on the first click or key (browsers only allow it after one).
 */
export function initInstall(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; changed(); });
  addEventListener('appinstalled', () => { installed = true; deferred = null; changed(); });
  if (hasManifest() && isSecureContext && location.protocol !== 'file:' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(SERVICE_WORKER_FILE, { scope: './' }).catch(() => { /* not installable here; the game still plays */ });
  }
  if (isInstalledApp() && canFullscreen()) {
    const go = () => {
      removeEventListener('pointerdown', go, true);
      removeEventListener('keydown', go, true);
      if (!isFullscreen()) void toggleFullscreen();
    };
    addEventListener('pointerdown', go, true);
    addEventListener('keydown', go, true);
  }
}
