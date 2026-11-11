/**
 * Hive UI controller: owns #hive, routes between the screens, handles keyboard shortcuts and notices.
 * It is data-agnostic: give it a ProfileView getter and HiveActions (src/ui/hive-menu.ts adapts
 * Gameplay's Profile; mocks/fixtures.ts provides an in-memory one for look review).
 */
import './hive.css';
import { applyTheme } from '../theme';
import { DEFAULT_SETTINGS, getSettings, saveSettings, SETTING_RANGES } from '../settings';
import type { Settings } from '../settings';
import { frame, h, panel, cta, keyHints } from './kit';
import type { HiveActions, ProfileView } from './model';
import { drawOrbit, HOST_ORDER, hostSelect, mainMenu, raidSelect, results } from './screens';
import type { ResultData } from './screens';
import { stashScreen } from './stash';
import { marketScreen } from './market';
import { vendorRow, vendorScreen } from './vendors';
import { CLASSES } from '../../../data';
import type { ClassId } from '../../../data';

export type Tab = 'menu' | 'host' | 'stash' | 'raid' | 'market' | 'vendors' | 'settings' | 'results';

const TITLES: Record<Tab, string> = {
  menu: 'THE HIVE', host: 'STARTER HOST SELECT & PROGRESSION', stash: 'STASH & INTERNAL CAVITIES',
  raid: 'EXCLUSION ZONE SELECT', market: 'FLESH MARKET', vendors: 'HIVE VENDORS', settings: 'SETTINGS', results: 'RAID DEBRIEF',
};
const NAV_TAB: Partial<Record<Tab, string>> = { menu: 'menu', host: 'host', stash: 'stash', raid: 'raid', market: 'vendors', vendors: 'vendors' };

export interface HiveUIOptions {
  /** Called when the host changes (Gameplay stores it on the profile). */
  pickHost?(id: ClassId): void;
  /** Return to the Hive after results (Gameplay reloads or resets the raid). */
  afterResults?(): void;
}

export class HiveUI {
  tab: Tab = 'menu';
  private cur: (HTMLElement & { dispose?: () => void }) | null = null;
  private noticeEl = h('div', 'hv-notice');
  private noticeTimer = 0;
  private orbitRaf = 0;
  private lastResult: ResultData | null = null;

  constructor(readonly root: HTMLElement, private view: () => ProfileView, private actions: HiveActions, private opts: HiveUIOptions = {}) {
    applyTheme();
    root.id = 'hive';
    addEventListener('keydown', this.onKey);
  }

  show(tab: Tab = this.tab): void {
    this.tab = tab;
    cancelAnimationFrame(this.orbitRaf);
    this.cur?.dispose?.();
    const p = this.view();
    const f = frame({ title: TITLES[tab], tab: NAV_TAB[tab], callsign: p.callsign, dna: p.dna,
      extras: [{ label: 'HOST', value: CLASSES[p.host].label.replace('The ', '').toUpperCase(), tone: 'lime' }, { label: 'EXTRACTS', value: String(p.stats.extracts), tone: 'amber' }],
      unlocked: this.trades() ? ['vendors'] : [] });
    f.nav.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('.tab');
      if (t && !t.disabled) this.show(t.dataset.tab === 'vendors' ? this.tradeTab() : t.dataset.tab as Tab);
    });
    let screen: HTMLElement & { dispose?: () => void };
    switch (tab) {
      case 'menu': screen = mainMenu(p, { go: (t) => this.show(t === 'vendors' ? this.tradeTab() : t as Tab), deploy: () => this.show('host'), quit: () => this.quit(), market: this.trades() }); break;
      case 'host': screen = hostSelect(p, { pick: (id) => { this.opts.pickHost?.(id); this.show('host'); }, next: () => this.show('stash') }); break;
      case 'stash': screen = stashScreen(p, { actions: this.actions, next: () => this.show('raid'), changed: () => this.show('stash'), notice: (m, t) => this.notice(m, t) }); break;
      case 'market': {
        screen = marketScreen(p, { actions: this.actions, changed: () => this.show('market'), notice: (m, t) => this.notice(m, t), next: () => this.show('stash') });
        const vs = this.actions.vendors?.() ?? [];
        if (vs.length) screen.prepend(vendorRow(vs, 'gulletBroker', (id) => { this.vendor = id; this.show('vendors'); }, () => this.show('market')));
        break;
      }
      case 'vendors': screen = vendorScreen(p, this.vendor, { actions: this.actions, changed: () => this.show('vendors'), notice: (m, t) => this.notice(m, t), next: () => this.show('stash'),
        market: () => this.show('market'), pick: (id) => { this.vendor = id; this.show('vendors'); } }); break;
      case 'raid': screen = raidSelect(p, { deploy: () => this.actions.deploy(), notice: (m, t) => this.notice(m, t), zones: this.actions.zones, selectZone: this.actions.selectZone, changed: () => this.show('raid') }); this.animateOrbit(screen); break;
      case 'results': screen = results(this.lastResult!, { again: () => (this.opts.afterResults ? this.opts.afterResults() : this.show('stash')) }); break;
      default: screen = this.settingsScreen();
    }
    screen.classList.add(`tab-${tab}`);
    f.body.append(screen);
    f.root.append(this.noticeEl);
    this.root.replaceChildren(f.root);
    this.root.classList.remove('hidden');
    this.cur = screen;
    this.root.dataset.tab = tab;
  }

  /** Vendor shown on the VENDORS tab. */
  vendor = 'motherClot';
  private trades(): boolean { return !!(this.actions.vendors || this.actions.market); }
  /** VENDORS opens the Hive vendors when the economy is there, otherwise straight to the Flesh Market. */
  private tradeTab(): Tab { return this.actions.vendors ? 'vendors' : 'market'; }

  showResults(r: ResultData): void { this.lastResult = r; this.show('results'); }

  hide(): void {
    cancelAnimationFrame(this.orbitRaf);
    this.cur?.dispose?.();
    this.root.classList.add('hidden');
    this.root.replaceChildren();
  }

  get visible(): boolean { return !this.root.classList.contains('hidden') && this.root.childElementCount > 0; }

  notice(msg: string, tone = ''): void {
    this.noticeEl.textContent = msg;
    this.noticeEl.className = `hv-notice on ${tone}`;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.noticeEl.classList.remove('on'), 2200);
  }

  private animateOrbit(screen: HTMLElement): void {
    const cv = screen.querySelector('canvas');
    if (!cv || getSettings().reduceMotion) return;
    const t0 = performance.now();
    let last = 0;
    const tick = (now: number) => {
      // ~20 fps is plenty for a slowly turning map and keeps the menu cheap.
      if (now - last > 50) { last = now; drawOrbit(cv, (now - t0) / 1000); }
      this.orbitRaf = requestAnimationFrame(tick);
    };
    this.orbitRaf = requestAnimationFrame(tick);
  }

  private settingsScreen(): HTMLElement {
    const el = h('div', 'scr scr-settings');
    const s = getSettings();
    const pnl = panel('hv-settings', 'SETTINGS', 'Saved on this device');
    const row = (k: keyof typeof SETTING_RANGES, label: string, fmt: (v: number) => string) => {
      const [lo, hi, step] = SETTING_RANGES[k];
      return `<label>${label}<input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${step}" value="${s[k]}"/><output>${fmt(s[k])}</output></label>`;
    };
    pnl.insertAdjacentHTML('beforeend', row('sensitivity', 'MOUSE SENSITIVITY', (v) => `${v.toFixed(2)}×`) + row('fov', 'FIELD OF VIEW', (v) => `${v}°`) + row('volume', 'MASTER VOLUME', (v) => `${Math.round(v * 100)}%`)
      + `<label>REDUCE MOTION<input type="checkbox" data-k="reduceMotion" ${s.reduceMotion ? 'checked' : ''}/><output></output></label>`);
    pnl.addEventListener('input', (e) => {
      const i = e.target as HTMLInputElement;
      const k = i.dataset.k as keyof Settings;
      const next = { ...getSettings(), [k]: i.type === 'checkbox' ? i.checked : Number(i.value) } as Settings;
      saveSettings(next);
      const out = i.parentElement!.querySelector('output')!;
      if (k === 'sensitivity') out.textContent = `${Number(i.value).toFixed(2)}×`;
      if (k === 'fov') out.textContent = `${i.value}°`;
      if (k === 'volume') out.textContent = `${Math.round(Number(i.value) * 100)}%`;
    });
    const reset = h<HTMLButtonElement>('button', 'hv-btn', 'RESTORE DEFAULTS');
    reset.addEventListener('click', () => { saveSettings({ ...DEFAULT_SETTINGS }); this.show('settings'); });
    pnl.append(reset);
    const back = cta('BACK TO HIVE', 'SETTINGS SAVE AS YOU CHANGE THEM');
    back.addEventListener('click', () => this.show('menu'));
    el.append(pnl, back, keyHints([['ESC', 'BACK']]));
    return el;
  }

  private quit(): void {
    const d = h('div', 'hv-dormant', 'HOST DORMANT<small>Close this tab to leave. Click to wake the Hive.</small>');
    d.addEventListener('click', () => d.remove());
    this.root.querySelector('.hv-frame')?.append(d);
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.visible || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const back: Partial<Record<Tab, Tab>> = { host: 'menu', stash: 'host', raid: 'stash', market: 'menu', vendors: 'menu', settings: 'menu' };
    if (e.code === 'Escape' && back[this.tab]) { this.show(back[this.tab]); return; }
    if (e.code === 'Enter') {
      if (this.tab === 'menu') this.show('host');
      else if (this.tab === 'host') this.show('stash');
      else if (this.tab === 'stash') this.show('raid');
      else if (this.tab === 'raid') this.actions.deploy();
      else if (this.tab === 'results') this.root.querySelector<HTMLButtonElement>('#deploy-again')?.click();
      return;
    }
    if (this.tab === 'menu') {
      if (e.code === 'KeyS') this.show('stash');
      if (e.code === 'KeyH') this.show('host');
      if (e.code === 'KeyM' && this.trades()) this.show(this.tradeTab());
    }
    if (this.tab === 'vendors' && e.code === 'Tab') {
      e.preventDefault();
      const ids = (this.actions.vendors?.() ?? []).map((v) => v.id);
      this.vendor = ids[(ids.indexOf(this.vendor) + 1) % ids.length] ?? this.vendor;
      this.show('vendors');
    }
    if (this.tab === 'host' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      const open = HOST_ORDER.filter((id) => CLASSES[id].playableFrom !== 'host');
      const i = open.indexOf(this.view().host);
      const next = open[(i + (e.code === 'ArrowRight' ? 1 : open.length - 1)) % open.length];
      if (next) { this.opts.pickHost?.(next); this.show('host'); }
    }
  };

  dispose(): void { removeEventListener('keydown', this.onKey); this.hide(); }
}
