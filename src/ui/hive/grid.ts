/**
 * Item grids with drag and drop: the stash, the internal cavities, the gut pouch and (in raid) an open
 * Bio-Pod. Pointer drag, R or right-click to rotate while dragging, double-click to quick-move to the
 * other side. The grid only previews fits; the move itself is the caller's (Gameplay's transfer rules).
 */
import './grid.css';
import { LOOT, VIRUSES, VIRUS_RULES } from '../../../data';
import { itemIcon, KIND_COLOUR } from '../icons';
import { esc, h } from './kit';
import { footprint } from './model';
import type { Placed } from './model';

export type ZoneId = string;

export interface GridSource {
  zone: ZoneId;
  label: string;
  size: [number, number];
  items: Placed[];
}

export interface DropTarget { zone: ZoneId; x: number; y: number; rotated: boolean }

/** Occupancy test that ignores one stack (the one being dragged). */
export function fits(src: GridSource, item: string, x: number, y: number, rotated: boolean, ignore = -1): 'fit' | 'stack' | 'blocked' {
  const [w, hh] = footprint({ item, rotated });
  const [W, H] = src.size;
  if (x < 0 || y < 0 || x + w > W || y + hh > H) return 'blocked';
  for (let i = 0; i < src.items.length; i++) {
    if (i === ignore) continue;
    const o = src.items[i];
    const [ow, oh] = footprint(o);
    const overlap = x < o.x + ow && x + w > o.x && y < o.y + oh && y + hh > o.y;
    if (!overlap) continue;
    const def = LOOT.items[item];
    if (o.item === item && def && def.stack > 1 && o.count < def.stack) return 'stack';
    return 'blocked';
  }
  return 'fit';
}

/** First free spot, scanning rows then columns, trying both orientations. */
export function firstFit(src: GridSource, item: string, prefer = false): DropTarget | null {
  const def = LOOT.items[item];
  if (def && def.stack > 1) {
    const s = src.items.find((o) => o.item === item && o.count < def.stack);
    if (s) return { zone: src.zone, x: s.x, y: s.y, rotated: s.rotated };
  }
  for (const rotated of [prefer, !prefer]) {
    for (let y = 0; y < src.size[1]; y++) for (let x = 0; x < src.size[0]; x++) if (fits(src, item, x, y, rotated) === 'fit') return { zone: src.zone, x, y, rotated };
  }
  return null;
}

const signed = (x: number) => `${x >= 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}%`;
/** Plain-language gain and cost for a virus, worded from viruses.json numbers. */
export function virusText(item: string): { gain: string; cost: string } | null {
  const v = Object.values(VIRUSES).find((x) => x.item === item);
  if (!v) return null;
  const e = v.effect as Record<string, Record<string, number> | number>, c = v.cost as Record<string, number | boolean>;
  const gain: string[] = [], cost: string[] = [];
  const si = e.sporeInfection as Record<string, number> | undefined;
  if (si) gain.push(`Spores infect: ${si.damagePerSecond}/s for ${si.duration} s, stacks to ${si.maxStacks}, spreads on death`);
  if (typeof e.overloadDecayMultiplier === 'number') gain.push(`Overload decays ${e.overloadDecayMultiplier}× as fast`);
  if (typeof e.sprintMultiplier === 'number') gain.push(`Sprint ${signed(e.sprintMultiplier)}`);
  const po = e.parasiteOnKill as Record<string, number> | undefined;
  if (po) gain.push(`Kills release a parasite that bites the nearest enemy for ${po.damage}`);
  if (typeof c.footstepVisibility === 'number') cost.push(`${Math.round((c.footstepVisibility - 1) * 100)}% easier to spot`);
  if (c.glowTrail) cost.push('Your footprints glow');
  if (typeof c.biomassMaxMultiplier === 'number') cost.push(`Max Biomass ${signed(c.biomassMaxMultiplier)}`);
  if (typeof c.biomassDrainPerSecondWhileParasiteAlive === 'number') cost.push(`−${c.biomassDrainPerSecondWhileParasiteAlive} Biomass/s while a parasite lives`);
  return { gain: gain.join('. '), cost: cost.join('. ') };
}

export function tooltipHtml(pl: Placed): string {
  const d = LOOT.items[pl.item];
  if (!d) return esc(pl.item);
  const v = virusText(pl.item);
  return `<div class="tt-head" style="--kc:${KIND_COLOUR[d.kind]}"><b>${esc(d.label)}</b><span>${d.kind.toUpperCase()}</span></div>
    <div class="tt-row"><span>VALUE</span><b>${d.value * pl.count} DNA</b></div>
    <div class="tt-row"><span>SIZE</span><b>${d.size[0]}×${d.size[1]}</b></div>
    <div class="tt-row"><span>STACK</span><b>${pl.count}/${d.stack}</b></div>
    ${d.kind === 'currency' ? '<p>Converts to banked DNA on extraction.</p>' : ''}
    ${v ? `<p class="gain">+ ${esc(v.gain)}</p><p class="cost">− ${esc(v.cost)}</p><p class="hint">Inject in raid: ${VIRUS_RULES.injectTime} s, lasts the raid. One active strain.</p>` : ''}`;
}

export interface GridHandlers {
  drop(from: { zone: ZoneId; index: number }, to: DropTarget): void;
  /** Double-click: quick-move to the most likely other grid. */
  quick?(from: { zone: ZoneId; index: number }): void;
  /** Extra actions (inject) on a stack; shown in raid. */
  select?(from: { zone: ZoneId; index: number }): void;
  /** Dropped outside every grid (in raid: onto the host's arm to inject). */
  outside?(from: { zone: ZoneId; index: number }, clientX: number, clientY: number): void;
}

/**
 * One draggable item grid. Renders into `el`; call render() after data changes.
 * All grids on screen share one DragLayer so items move between them.
 */
export class GridView {
  readonly el: HTMLElement;
  constructor(public src: GridSource, layer: DragLayer, cls = '') {
    this.el = h('div', `grid ${cls}`);
    this.el.dataset.zone = src.zone;
    layer.add(this);
    this.render();
  }

  render(src = this.src): void {
    this.src = src;
    const [W, H] = src.size;
    this.el.style.setProperty('--cols', String(W));
    this.el.style.setProperty('--rows', String(H));
    let cells = '';
    for (let i = 0; i < W * H; i++) cells += '<i></i>';
    this.el.innerHTML = `<div class="cells">${cells}</div><div class="hint-box"></div>`
      + src.items.map((pl, i) => {
        const [w, hh] = footprint(pl);
        const d = LOOT.items[pl.item];
        return `<div class="item k-${d?.kind ?? 'tech'}" data-zone="${src.zone}" data-item="${esc(pl.item)}" data-index="${i}"
          style="--x:${pl.x};--y:${pl.y};--w:${w};--h:${hh};--kc:${KIND_COLOUR[d?.kind ?? 'tech']}">${itemIcon(pl.item, pl.rotated)}${pl.count > 1 ? `<b class="n">${pl.count}</b>` : ''}</div>`;
      }).join('');
  }

  /** Cell under a client point, or null. */
  cellAt(cx: number, cy: number): [number, number] | null {
    const r = this.el.getBoundingClientRect();
    if (cx < r.left || cy < r.top || cx > r.right || cy > r.bottom) return null;
    const [W, H] = this.src.size;
    return [Math.floor(((cx - r.left) / r.width) * W), Math.floor(((cy - r.top) / r.height) * H)];
  }

  cellPx(): number { return this.el.getBoundingClientRect().width / this.src.size[0]; }

  showHint(x: number, y: number, w: number, hh: number, state: 'fit' | 'stack' | 'blocked' | null): void {
    const b = this.el.querySelector<HTMLElement>('.hint-box')!;
    b.className = `hint-box${state ? ` on ${state}` : ''}`;
    if (state) b.style.cssText = `--x:${x};--y:${y};--w:${w};--h:${hh}`;
  }
}

/** Shared drag state, ghost and tooltip for every GridView on screen. */
export class DragLayer {
  private grids: GridView[] = [];
  private ghost = h('div', 'drag-ghost');
  private tip = h('div', 'item-tip');
  private drag: { from: GridView; index: number; pl: Placed; rotated: boolean; grabX: number; grabY: number } | null = null;
  private lastPt = { x: 0, y: 0 };

  constructor(private root: HTMLElement, private handlers: GridHandlers) {
    root.append(this.ghost, this.tip);
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('dblclick', this.onDbl);
    root.addEventListener('contextmenu', this.onContext);
    root.addEventListener('pointerover', this.onOver);
    root.addEventListener('pointerout', (e) => { if ((e.target as HTMLElement).closest?.('.item')) this.tip.classList.remove('on'); });
    addEventListener('keydown', this.onKey);
  }

  add(g: GridView): void { this.grids.push(g); }
  dispose(): void { removeEventListener('keydown', this.onKey); }

  private itemAt(t: EventTarget | null): { grid: GridView; index: number; el: HTMLElement } | null {
    const el = (t as HTMLElement)?.closest?.<HTMLElement>('.item');
    if (!el) return null;
    const grid = this.grids.find((g) => g.el.contains(el));
    return grid ? { grid, index: Number(el.dataset.index), el } : null;
  }

  private onOver = (e: PointerEvent) => {
    if (this.drag) return;
    const hit = this.itemAt(e.target);
    if (!hit) return;
    const pl = hit.grid.src.items[hit.index];
    this.tip.innerHTML = tooltipHtml(pl);
    const r = hit.el.getBoundingClientRect(), rr = this.root.getBoundingClientRect();
    const left = r.right - rr.left + 10, top = r.top - rr.top;
    this.tip.style.left = `${Math.min(left, rr.width - 280)}px`;
    this.tip.style.top = `${Math.max(0, Math.min(top, rr.height - 220))}px`;
    this.tip.classList.add('on');
  };

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const hit = this.itemAt(e.target);
    if (!hit) return;
    e.preventDefault();
    const pl = hit.grid.src.items[hit.index];
    const r = hit.el.getBoundingClientRect();
    this.drag = { from: hit.grid, index: hit.index, pl, rotated: pl.rotated, grabX: (e.clientX - r.left) / r.width, grabY: (e.clientY - r.top) / r.height };
    hit.el.classList.add('lifted');
    this.tip.classList.remove('on');
    this.root.setPointerCapture?.(e.pointerId);
    this.paintGhost(hit.grid.cellPx());
    this.onMove(e);
  };

  private paintGhost(cell: number): void {
    if (!this.drag) return;
    const [w, hh] = footprint({ item: this.drag.pl.item, rotated: this.drag.rotated });
    this.ghost.style.width = `${w * cell}px`;
    this.ghost.style.height = `${hh * cell}px`;
    this.ghost.innerHTML = itemIcon(this.drag.pl.item, this.drag.rotated);
    this.ghost.classList.add('on');
  }

  private target(cx: number, cy: number): { grid: GridView; x: number; y: number; w: number; h: number } | null {
    if (!this.drag) return null;
    const [w, hh] = footprint({ item: this.drag.pl.item, rotated: this.drag.rotated });
    for (const g of this.grids) {
      if (!g.cellAt(cx, cy)) continue;
      const r = g.el.getBoundingClientRect();
      const cell = r.width / g.src.size[0];
      // Anchor the footprint at the grab point, so the item lands where the ghost shows it.
      const x = Math.round((cx - this.drag.grabX * w * cell - r.left) / cell);
      const y = Math.round((cy - this.drag.grabY * hh * cell - r.top) / cell);
      const clamp = (v: number, hi: number) => Math.max(0, Math.min(v, hi));
      return { grid: g, x: clamp(x, g.src.size[0] - w), y: clamp(y, g.src.size[1] - hh), w, h: hh };
    }
    return null;
  }

  private onMove = (e: PointerEvent) => {
    this.lastPt = { x: e.clientX, y: e.clientY };
    if (!this.drag) return;
    const rr = this.root.getBoundingClientRect();
    const gw = this.ghost.offsetWidth, gh = this.ghost.offsetHeight;
    this.ghost.style.transform = `translate(${e.clientX - rr.left - this.drag.grabX * gw}px, ${e.clientY - rr.top - this.drag.grabY * gh}px)`;
    for (const g of this.grids) g.showHint(0, 0, 0, 0, null);
    const t = this.target(e.clientX, e.clientY);
    if (!t) return;
    const ignore = t.grid === this.drag.from ? this.drag.index : -1;
    t.grid.showHint(t.x, t.y, t.w, t.h, fits(t.grid.src, this.drag.pl.item, t.x, t.y, this.drag.rotated, ignore));
  };

  private onUp = (e: PointerEvent) => {
    if (!this.drag) return;
    const d = this.drag;
    const t = this.target(e.clientX, e.clientY);
    this.cancel();
    if (!t) { this.handlers.outside?.({ zone: d.from.src.zone, index: d.index }, e.clientX, e.clientY); return; }
    if (t.grid === d.from && t.x === d.pl.x && t.y === d.pl.y && d.rotated === d.pl.rotated) return;
    this.handlers.drop({ zone: d.from.src.zone, index: d.index }, { zone: t.grid.src.zone, x: t.x, y: t.y, rotated: d.rotated });
  };

  private cancel(): void {
    this.drag = null;
    this.ghost.classList.remove('on');
    for (const g of this.grids) { g.showHint(0, 0, 0, 0, null); g.el.querySelectorAll('.lifted').forEach((x) => x.classList.remove('lifted')); }
  }

  private rotate(): void {
    if (!this.drag) return;
    this.drag.rotated = !this.drag.rotated;
    [this.drag.grabX, this.drag.grabY] = [this.drag.grabY, this.drag.grabX];
    this.paintGhost(this.drag.from.cellPx());
    this.onMove({ clientX: this.lastPt.x, clientY: this.lastPt.y } as PointerEvent);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyR' && this.drag) { e.preventDefault(); this.rotate(); }
    if (e.code === 'Escape' && this.drag) this.cancel();
  };

  private onContext = (e: MouseEvent) => {
    if (this.drag) { e.preventDefault(); this.rotate(); return; }
    const hit = this.itemAt(e.target);
    if (hit && this.handlers.select) { e.preventDefault(); this.handlers.select({ zone: hit.grid.src.zone, index: hit.index }); }
  };

  private onDbl = (e: MouseEvent) => {
    const hit = this.itemAt(e.target);
    if (hit && this.handlers.quick) this.handlers.quick({ zone: hit.grid.src.zone, index: hit.index });
  };
}
