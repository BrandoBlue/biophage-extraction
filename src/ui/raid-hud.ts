/**
 * In-raid HUD (Larva): the UI department's organic HUD (src/ui/raid/hud.ts, reference 04) on #hud, the
 * click-to-enter prompt with the full control list, and the TAB cavity overlay over Gameplay's in-raid inventory API
 * (raid.transfer / openContainer / inject). Reads Raid.hud() each frame and listens to gameplay events; it only
 * touches the raid through that API. The raid debrief lives in the Hive (HiveMenu.showResults).
 */
import type { EventBus, GameEvents } from '../game/events';
import type { HudState } from '../game/raid';
import type { Placed } from '../game/grid';
import { footprint } from './hive/model';
import { CONTROLS, OrganicHud } from './raid/hud';
import { CavityOverlay } from './raid/cavity-overlay';
import type { RaidInventory, RaidZone } from './raid/cavity-overlay';

type Zone = 'cavity' | 'pouch' | 'pod';
interface Grid { cols: number; rows: number; entries: Placed[] }
/** The slice of Raid the overlay uses (Gameplay #21). */
export interface RaidInventoryApi {
  phase: string;
  carried: { cavity: Grid; pouch: Grid };
  openContainer(): { id: string; type: string; items: { item: string; count: number }[] } | null;
  transfer(from: Zone, index: number, to: Zone, x?: number, y?: number, rotated?: boolean): number;
  inject(zone: 'cavity' | 'pouch', index: number): boolean;
}

/** Lays the pod's loose stacks out on a grid, one entry per stack so indices match `openContainer().items`. */
export function podLayout(items: { item: string; count: number }[], cols = 4): { size: [number, number]; items: Placed[] } {
  let rows = 3;
  for (;;) {
    const used: Placed[] = [];
    const free = (x: number, y: number, w: number, hh: number) => x + w <= cols && y + hh <= rows
      && !used.some((u) => { const [uw, uh] = footprint(u); return x < u.x + uw && u.x < x + w && y < u.y + uh && u.y < y + hh; });
    const ok = items.every((s) => {
      for (const rotated of [false, true]) {
        const [w, hh] = footprint({ item: s.item, rotated });
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (free(x, y, w, hh)) { used.push({ ...s, x, y, rotated }); return true; }
      }
      return false;
    });
    if (ok || rows > 12) return { size: [cols, rows], items: used };
    rows++;
  }
}

export class RaidHud {
  readonly hud: OrganicHud;
  readonly overlay: CavityOverlay | null = null;
  private prompt = document.querySelector<HTMLElement>('#prompt')!;
  private lastPhase = '';

  constructor(bus: EventBus<GameEvents>, raid?: RaidInventoryApi) {
    const root = document.querySelector<HTMLElement>('#hud')!;
    this.hud = new OrganicHud(root, bus as unknown as ConstructorParameters<typeof OrganicHud>[1]);
    this.prompt.innerHTML = `CLICK TO DROP INTO ZONE 7${CONTROLS}`;
    if (!raid) return;
    this.overlay = new CavityOverlay(document.body, this.inventory(raid), (m, t) => this.hud.say(m, t));
    addEventListener('keydown', (e) => {
      if (e.code !== 'Tab' || raid.phase !== 'raid') return;
      e.preventDefault();
      if (e.repeat) return;
      this.setOverlay(!this.overlay!.open);
    });
    const refresh = () => this.overlay?.refresh();
    const on = bus.on.bind(bus) as (t: string, fn: () => void) => void;
    for (const t of ['inventoryChanged', 'pickup', 'harvestDone', 'virusInjectCancel']) on(t, refresh);
  }

  private inventory(raid: RaidInventoryApi): RaidInventory {
    const src = (zone: 'cavity' | 'pouch', label: string) => {
      const g = raid.carried[zone];
      return { zone, label, size: [g.cols, g.rows] as [number, number], items: g.entries };
    };
    return {
      grids: () => {
        const pod = raid.openContainer();
        const lay = pod ? podLayout(pod.items) : null;
        return { cavity: src('cavity', 'CAVITIES'), pouch: src('pouch', 'GUT POUCH'), pod: lay ? { zone: 'pod', label: 'BIO-POD', size: lay.size, items: lay.items } : null };
      },
      // Into the pod there is no exact cell (it holds loose stacks), so only cavity and pouch drops are placed.
      transfer: (from: RaidZone, index, to: RaidZone, x, y, rotated) => raid.transfer(from, index, to, to === 'pod' ? undefined : x, to === 'pod' ? undefined : y, rotated) > 0,
      inject: (zone: RaidZone, index) => zone !== 'pod' && raid.inject(zone, index),
    };
  }

  /** Opening frees the mouse to drag; closing takes control back (the raid keeps running either way). */
  private setOverlay(open: boolean): void {
    this.overlay!.toggle(open);
    const canvas = document.querySelector<HTMLCanvasElement>('#game');
    if (open) { if (document.pointerLockElement) document.exitPointerLock(); }
    else if (!navigator.webdriver) void Promise.resolve(canvas?.requestPointerLock?.()).catch(() => { /* click to lock */ });
  }

  update(dt: number, s: HudState): void {
    this.hud.update(dt, s);
    // The overlay owns the centre of the screen: hide the enter prompt behind it.
    document.body.classList.toggle('cav-open', !!this.overlay?.open);
    if (s.phase !== this.lastPhase) {
      this.lastPhase = s.phase;
      if (s.phase === 'raid') this.prompt.innerHTML = `CLICK TO TAKE CONTROL · THE RAID KEEPS RUNNING${CONTROLS}`;
      // The debrief owns the screen once the raid ends: never show the enter prompt behind it.
      this.prompt.classList.toggle('ended', s.phase === 'extracted' || s.phase === 'lost');
      if (s.phase !== 'raid' && this.overlay?.open) this.overlay.toggle(false);
    }
  }
}
