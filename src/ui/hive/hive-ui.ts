/**
 * Hive UI controller: owns #hive, routes between the screens, handles keyboard shortcuts and notices.
 * It is data-agnostic: give it a ProfileView getter and HiveActions (src/ui/hive-menu.ts adapts
 * Gameplay's Profile; mocks/fixtures.ts provides an in-memory one for look review).
 */
import './hive.css';
import { applyTheme } from '../theme';
import { DEFAULT_SETTINGS, getSettings, GRAPHICS_LEVELS, saveSettings, SETTING_RANGES, type GraphicsLevel } from '../settings';
import { GRAPHICS_WORDS } from './kit';
import type { Settings } from '../settings';
import { frame, h, panel, cta, keyHints } from './kit';
import { glyph } from '../icons';
import type { HiveActions, ProfileView } from './model';
import { drawOrbit, HOST_ORDER, hostSelect, mainMenu, raidSelect, results } from './screens';
import type { ResultData } from './screens';
import { stashScreen } from './stash';
import { bodyScreen } from './body';
import { arsenalScreen } from './arsenal';
import { marketScreen } from './market';
import { vendorRow, vendorScreen } from './vendors';
import { CLASSES } from '../../../data';
import { canFullscreen, isFullscreen, toggleFullscreen } from '../fullscreen';
import type { ClassId } from '../../../data';

export type Tab = 'menu' | 'host' | 'stash' | 'arms' | 'raid' | 'market' | 'vendors' | 'body' | 'settings' | 'results';

const TITLES: Record<Tab, string> = {
  menu: 'THE HIVE', host: 'STARTER HOST SELECT & PROGRESSION', stash: 'STASH & INTERNAL CAVITIES',
  arms: 'WEAPONS & GRAFTS', raid: 'EXCLUSION ZONE SELECT', market: 'FLESH MARKET', vendors: 'HIVE VENDORS', body: 'THE HIVE BODY', settings: 'SETTINGS', results: 'RAID DEBRIEF',
};
const NAV_TAB: Partial<Record<Tab, string>> = { menu: 'menu', host: 'host', stash: 'stash', arms: 'arms', raid: 'raid', market: 'vendors', vendors: 'vendors', body: 'body' };

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
    document.addEventListener('fullscreenchange', this.onFull);
  }

  show(tab: Tab = this.tab): void {
    this.tab = tab;
    cancelAnimationFrame(this.orbitRaf);
    this.cur?.dispose?.();
    const p = this.view();
    const f = frame({ title: TITLES[tab], tab: NAV_TAB[tab], callsign: p.callsign, dna: p.dna,
      extras: [{ label: 'HOST', value: CLASSES[p.host].label.replace('The ', '').toUpperCase(), tone: 'lime' }, { label: 'EXTRACTS', value: String(p.stats.extracts), tone: 'amber' }],
      unlocked: [...(this.trades() ? ['vendors'] : []), ...(this.actions.hiveBody ? ['body'] : []), ...(this.actions.arsenal ? ['arms'] : []), ...(this.hiveMind() ? ['hivemind'] : [])] });
    f.nav.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('.tab');
      if (!t || t.disabled) return;
      if (t.dataset.tab === 'hivemind') { this.openHiveMind(); return; }
      this.show(t.dataset.tab === 'vendors' ? this.tradeTab() : t.dataset.tab as Tab);
    });
    const full = f.root.querySelector<HTMLButtonElement>('[data-full]')!;
    full.hidden = !canFullscreen();
    full.classList.toggle('on', isFullscreen());
    full.addEventListener('click', () => void toggleFullscreen());
    let screen: HTMLElement & { dispose?: () => void };
    switch (tab) {
      case 'menu': screen = mainMenu(p, { go: (t) => this.show(t === 'vendors' ? this.tradeTab() : t as Tab), deploy: () => this.show('host'), quit: () => this.quit(), market: this.trades(), arms: !!this.actions.arsenal }); break;
      case 'host': screen = hostSelect(p, { pick: (id) => { this.opts.pickHost?.(id); this.show('host'); }, next: () => this.show('stash') }); break;
      case 'stash': screen = stashScreen(p, { actions: this.actions, next: () => this.show(this.afterStash()), changed: () => this.show('stash'), notice: (m, t) => this.notice(m, t) }); break;
      case 'market': {
        screen = marketScreen(p, { actions: this.actions, changed: () => this.show('market'), notice: (m, t) => this.notice(m, t), next: () => this.show('stash') });
        const vs = this.actions.vendors?.() ?? [];
        if (vs.length) screen.prepend(vendorRow(vs, 'gulletBroker', (id) => { this.vendor = id; this.show('vendors'); }, () => this.show('market')));
        break;
      }
      case 'vendors': screen = vendorScreen(p, this.vendor, { actions: this.actions, changed: () => this.show('vendors'), notice: (m, t) => this.notice(m, t), next: () => this.show('stash'),
        market: () => this.show('market'), pick: (id) => { this.vendor = id; this.show('vendors'); } }); break;
      case 'arms': screen = arsenalScreen(p, { actions: this.actions, changed: () => this.show('arms'), notice: (m, t) => this.notice(m, t), next: () => this.show('raid') }); break;
      case 'body': screen = bodyScreen(p, { actions: this.actions, changed: () => this.show('body'), notice: (m, t) => this.notice(m, t), next: () => this.show('stash') }); break;
      case 'raid': screen = raidSelect(p, { deploy: () => this.actions.deploy(), notice: (m, t) => this.notice(m, t), zones: this.actions.zones, selectZone: this.actions.selectZone, changed: () => this.show('raid') }); this.animateOrbit(screen); break;
      case 'results': screen = results(this.lastResult!, { again: () => (this.opts.afterResults ? this.opts.afterResults() : this.show('stash')) }); break;
      default: screen = this.settingsScreen();
    }
    screen.classList.add(`tab-${tab}`);
    f.body.append(screen);
    f.root.append(this.noticeEl);
    // A change of screen settles in; a refresh of the same screen (after a buy, a move, a sale) does not.
    this.root.dataset.enter = this.root.dataset.tab !== tab || this.root.classList.contains('hidden') ? '1' : '0';
    this.root.replaceChildren(f.root);
    this.root.classList.remove('hidden');
    this.cur = screen;
    this.root.dataset.tab = tab;
    document.body.dataset.hiveTab = tab;
    // DNA ticks up or down when it changed since the last screen.
    if (this.lastDna !== null && p.dna !== this.lastDna) f.root.querySelector('.cur.dna b')?.classList.add(p.dna > this.lastDna ? 'up' : 'down');
    this.lastDna = p.dna;
  }

  private lastDna: number | null = null;

  /** The online Hive-Mind panel (src/net/lobby.ts) lives beside the Hive; the HIVE-MIND tab unfolds it. */
  private hiveMind(): HTMLElement | null { return document.querySelector<HTMLElement>('#hivemind'); }
  private openHiveMind(): void {
    const hm = this.hiveMind();
    if (hm?.classList.contains('collapsed')) hm.querySelector<HTMLElement>('.hm-head')?.click();
    hm?.querySelector<HTMLElement>('input, button')?.focus();
  }
  private onFull = () => this.root.querySelectorAll('[data-full]').forEach((b) => b.classList.toggle('on', isFullscreen()));

  /** Vendor shown on the VENDORS tab. */
  vendor = 'motherClot';
  private trades(): boolean { return !!(this.actions.vendors || this.actions.market); }
  /** VENDORS opens the Hive vendors when the economy is there, otherwise straight to the Flesh Market. */
  private tradeTab(): Tab { return this.actions.vendors ? 'vendors' : 'market'; }

  /** Stash leads on to the guns when there is a WEAPONS screen, otherwise straight to raid select. */
  private afterStash(): Tab { return this.actions.arsenal ? 'arms' : 'raid'; }

  showResults(r: ResultData): void { this.lastResult = r; this.show('results'); }

  hide(): void {
    cancelAnimationFrame(this.orbitRaf);
    this.cur?.dispose?.();
    this.root.classList.add('hidden');
    this.root.replaceChildren();
    delete document.body.dataset.hiveTab;
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
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const box = (k: 'reduceMotion' | 'eyeScope', label: string) => `<label>${label}<input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}/><output></output></label>`;
    const quality = GRAPHICS_LEVELS.map((g) => `<button type="button" class="q${s.graphics === g ? ' on' : ''}" data-graphics="${g}"><b>${GRAPHICS_WORDS[g][0]}</b><small>${GRAPHICS_WORDS[g][1]}</small></button>`).join('');
    pnl.insertAdjacentHTML('beforeend', `<div class="set-cols">
      <section><h4>Controls & sound</h4>${row('sensitivity', 'MOUSE SENSITIVITY', (v) => `${v.toFixed(2)}×`)}${row('fov', 'FIELD OF VIEW', (v) => `${v}°`)}${row('volume', 'MASTER VOLUME', pct)}${box('reduceMotion', 'REDUCE MOTION')}${box('eyeScope', 'EYE SCOPE ON LONG GUNS')}</section>
      <section><h4>Display</h4>${row('brightness', 'BRIGHTNESS', pct)}${row('renderScale', 'RENDER SCALE', pct)}
        <div class="set-q"><span>GRAPHICS</span><div class="qs">${quality}</div></div>
        <p class="set-note">The frame rate follows your display, up to 240 Hz and beyond. For high refresh rates pick Performance or lower the render scale.</p>
        <div class="set-full"></div></section></div>`);
    pnl.querySelectorAll<HTMLButtonElement>('[data-graphics]').forEach((b) => b.addEventListener('click', () => {
      saveSettings({ ...getSettings(), graphics: b.dataset.graphics as GraphicsLevel });
      pnl.querySelectorAll('[data-graphics]').forEach((o) => o.classList.toggle('on', o === b));
    }));
    if (canFullscreen()) {
      const fs = h<HTMLButtonElement>('button', 'hv-btn', `${glyph('expand')}BORDERLESS FULLSCREEN <kbd>F</kbd>`);
      fs.dataset.full = '';
      fs.classList.toggle('on', isFullscreen());
      fs.addEventListener('click', () => void toggleFullscreen());
      pnl.querySelector('.set-full')!.append(fs);
    }
    pnl.addEventListener('input', (e) => {
      const i = e.target as HTMLInputElement;
      const k = i.dataset.k as keyof Settings;
      const next = { ...getSettings(), [k]: i.type === 'checkbox' ? i.checked : Number(i.value) } as Settings;
      saveSettings(next);
      const out = i.parentElement!.querySelector('output')!;
      if (k === 'sensitivity') out.textContent = `${Number(i.value).toFixed(2)}×`;
      if (k === 'fov') out.textContent = `${i.value}°`;
      if (k === 'volume' || k === 'brightness' || k === 'renderScale') out.textContent = `${Math.round(Number(i.value) * 100)}%`;
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
    if (e.code === 'KeyF' && !e.repeat) { void toggleFullscreen(); return; }
    const back: Partial<Record<Tab, Tab>> = { host: 'menu', stash: 'host', arms: 'stash', raid: this.actions.arsenal ? 'arms' : 'stash', market: 'menu', vendors: 'menu', settings: 'menu' };
    if (e.code === 'Escape' && back[this.tab]) { this.show(back[this.tab]); return; }
    if (e.code === 'Enter') {
      if (this.tab === 'menu') this.show('host');
      else if (this.tab === 'host') this.show('stash');
      else if (this.tab === 'stash') this.show(this.afterStash());
      else if (this.tab === 'arms') this.show('raid');
      else if (this.tab === 'raid') this.root.querySelector<HTMLButtonElement>('#deploy:not(:disabled)')?.click();
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

  dispose(): void { removeEventListener('keydown', this.onKey); document.removeEventListener('fullscreenchange', this.onFull); this.hide(); }
}
