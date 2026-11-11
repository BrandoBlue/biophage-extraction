/**
 * In-raid internal cavities (Larva spec, TAB): the view tilts down into the host's own torso, organs part around
 * the cavity grid, the gut pouch sits below and an open Bio-Pod's leftovers sit beside it, so a full host can swap.
 * The raid keeps running behind it. Viruses inject from here: select one and press I, or drag it onto the host's arm.
 */
import { LOOT, VIRUS_RULES } from '../../../data';
import { glyph } from '../icons';
import { DragLayer, firstFit, GridView } from '../hive/grid';
import type { GridSource } from '../hive/grid';
import { torsoSvg } from '../hive/stash';

export type RaidZone = 'cavity' | 'pouch' | 'pod';

export interface RaidInventory {
  /** Current grids; pod is null when no container is open or in reach. */
  grids(): { cavity: GridSource; pouch: GridSource; pod: GridSource | null };
  transfer(from: RaidZone, index: number, to: RaidZone, x: number, y: number, rotated: boolean): boolean;
  inject(zone: RaidZone, index: number): boolean;
}

const h = (tag: string, cls: string, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };

export class CavityOverlay {
  readonly root = h('div', 'cav-overlay hidden');
  private layer: DragLayer | null = null;
  private grids: Record<string, GridView> = {};
  private selected: { zone: RaidZone; index: number } | null = null;
  private say: (m: string, tone?: string) => void;

  constructor(parent: HTMLElement, private inv: RaidInventory, say?: (m: string, tone?: string) => void) {
    this.say = say ?? (() => {});
    parent.append(this.root);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest('.cav-arm')) this.injectSelected(); });
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'KeyI' && this.selected) { e.preventDefault(); this.injectSelected(); }
    });
  }

  get open(): boolean { return !this.root.classList.contains('hidden'); }

  toggle(force?: boolean): boolean {
    const show = force ?? !this.open;
    this.root.classList.toggle('hidden', !show);
    if (show) this.render(); else { this.layer?.dispose(); this.layer = null; this.selected = null; }
    return show;
  }

  /** Re-read the grids (call on inventoryChanged / pickup while open). */
  refresh(): void { if (this.open) this.render(); }

  private render(): void {
    this.layer?.dispose();
    const g = this.inv.grids();
    this.root.innerHTML = `
      <div class="cav-tilt">
        <div class="cav-torso">${torsoSvg()}</div>
        <div class="cav-main"><label>INTERNAL CAVITIES <span>LOST ON DEATH</span></label></div>
        <div class="cav-pouch"><label>GUT POUCH <span>SURVIVES DEATH</span></label></div>
        <div class="cav-arm" title="Drag a virus here to inject">${glyph('virus')}<span>DRAG A VIRUS HERE<br/>OR SELECT + [I]</span></div>
      </div>
      <div class="cav-pod ${g.pod ? '' : 'empty'}"><label>${glyph('pod')}${g.pod ? 'BIO-POD · LEFT BEHIND' : 'NO POD IN REACH'}</label></div>
      <div class="cav-help"><span><kbd>DRAG</kbd> move · swap</span><span><kbd>R</kbd> rotate</span><span><kbd>DBL-CLICK</kbd> quick move</span><span><kbd>I</kbd> inject (${VIRUS_RULES.injectTime} s, slows you)</span><span><kbd>TAB</kbd> close · the raid keeps running</span></div>`;
    this.layer = new DragLayer(this.root, {
      drop: (from, to) => {
        if (!this.inv.transfer(from.zone as RaidZone, from.index, to.zone as RaidZone, to.x, to.y, to.rotated)) this.say('DOES NOT FIT THERE', 'danger');
        this.render();
      },
      quick: (from) => {
        const src = this.grids[from.zone].src.items[from.index];
        const order: RaidZone[] = from.zone === 'pod' ? ['cavity', 'pouch'] : from.zone === 'cavity' ? (g.pod ? ['pod'] : ['pouch']) : ['cavity'];
        for (const z of order) {
          const gv = this.grids[z];
          if (!gv) continue;
          const t = firstFit(gv.src, src.item, src.rotated);
          if (t && this.inv.transfer(from.zone as RaidZone, from.index, z, t.x, t.y, t.rotated)) { this.render(); return; }
        }
        this.say('NO ROOM', 'danger');
      },
      select: (from) => this.select(from.zone as RaidZone, from.index),
      outside: (from, x, y) => {
        const r = this.root.querySelector('.cav-arm')!.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
        this.select(from.zone as RaidZone, from.index);
        this.injectSelected();
      },
    });
    this.grids = {};
    const add = (zone: RaidZone, src: GridSource, host: Element) => { const gv = new GridView(src, this.layer!, zone); host.append(gv.el); this.grids[zone] = gv; };
    add('cavity', g.cavity, this.root.querySelector('.cav-main')!);
    add('pouch', g.pouch, this.root.querySelector('.cav-pouch')!);
    if (g.pod) add('pod', g.pod, this.root.querySelector('.cav-pod')!);
  }

  private onClick(e: MouseEvent): void {
    const it = (e.target as HTMLElement).closest<HTMLElement>('.item');
    if (!it) return;
    this.select(it.dataset.zone as RaidZone, Number(it.dataset.index));
  }

  private select(zone: RaidZone, index: number): void {
    this.root.querySelectorAll('.item.selected').forEach((x) => x.classList.remove('selected'));
    const it = this.root.querySelector<HTMLElement>(`.item[data-zone="${zone}"][data-index="${index}"]`);
    const item = it?.dataset.item;
    if (!it || !item) return;
    it.classList.add('selected');
    this.selected = { zone, index };
    this.root.classList.toggle('virus-armed', LOOT.items[item]?.kind === 'virus');
  }

  private injectSelected(): void {
    const s = this.selected;
    if (!s) return;
    const item = this.grids[s.zone]?.src.items[s.index]?.item;
    if (!item || LOOT.items[item]?.kind !== 'virus') { this.say('ONLY VIRUSES CAN BE INJECTED', 'danger'); return; }
    if (this.inv.inject(s.zone, s.index)) this.toggle(false);
    else this.say('CANNOT INJECT NOW', 'danger');
  }
}
