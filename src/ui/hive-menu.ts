/**
 * The Hive: boot menu for the persistent loop (Larva). Host cards, stash grid, the host's internal cavities and gut
 * pouch, banked DNA, the raid record and DEPLOY. Interim Gameplay Engineering screen; the UI & HUD department
 * replaces the presentation (drag and drop, host pedestal, raid select) behind the same profile functions.
 *
 * Controls: click moves a stack between stash and cavities (pouch items go back to the stash);
 * shift-click sends it to the gut pouch; right-click rotates it in place.
 */
import { CLASSES, LOOT, PROFILE, RAID } from '../../data';
import { footprint } from '../game/grid';
import {
  cavitySize, expandStash, nextStashRowCost, pouchSize, pouchUpgradeCost, rotate, transfer, upgradePouch,
  type Profile, type Zone,
} from '../game/profile';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const cost = (n: number) => (Number.isFinite(n) ? `${n} DNA` : 'MAX');

export class HiveMenu {
  readonly root = document.createElement('div');
  private notice: string | null;

  constructor(private profile: Profile, private onChange: () => void, private onDeploy: () => void, notice: string | null = null) {
    this.notice = notice;
    this.root.id = 'hive';
    document.body.appendChild(this.root);
    document.body.classList.add('in-hive');
    this.root.addEventListener('click', (e) => this.click(e, false));
    this.root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.click(e, true); });
    this.render();
  }

  get visible(): boolean { return !this.root.classList.contains('hidden'); }
  hide(): void { this.root.classList.add('hidden'); document.body.classList.remove('in-hive'); }

  say(text: string): void { this.notice = text; this.render(); }

  private click(e: MouseEvent, secondary: boolean): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-index]');
    if (!t) return;
    const p = this.profile;
    const action = t.dataset.action;
    if (action === 'deploy') return this.onDeploy();
    if (action === 'expand') { if (!expandStash(p)) this.notice = `Need ${cost(nextStashRowCost(p))} to grow the stash.`; }
    else if (action === 'pouch') { if (!upgradePouch(p)) this.notice = `Need ${cost(pouchUpgradeCost(p))} to grow the gut pouch.`; }
    else if (t.dataset.index != null) {
      const zone = t.closest<HTMLElement>('[data-zone]')!.dataset.zone as Zone;
      const i = Number(t.dataset.index);
      const item = LOOT.items[t.dataset.item!]?.label ?? '';
      if (secondary) { if (!rotate(p, zone, i)) this.notice = `No room to turn the ${item}.`; }
      else {
        const to: Zone = e.shiftKey && zone !== 'pouch' ? 'pouch' : zone === 'stash' ? 'cavity' : 'stash';
        if (transfer(p, zone, i, to) === 0) this.notice = `No room for the ${item} in the ${to === 'cavity' ? 'cavities' : to === 'pouch' ? 'gut pouch' : 'stash'}.`;
        else this.notice = null;
      }
    } else return;
    this.onChange();
    this.render();
  }

  private grid(zone: Zone, cols: number, rows: number, entries: Profile['stash']): string {
    const items = entries.map((e, i) => {
      const def = LOOT.items[e.item];
      const [w, h] = footprint(e.item, e.rotated);
      return `<button class="item k-${def.kind}" data-item="${e.item}" data-index="${i}" title="${esc(def.label)} · ${def.value} DNA each"
        style="grid-column:${e.x + 1} / span ${w};grid-row:${e.y + 1} / span ${h}"><span>${esc(def.label)}</span>${e.count > 1 ? `<b>×${e.count}</b>` : ''}</button>`;
    }).join('');
    return `<div class="grid" data-zone="${zone}" style="--cols:${cols};--rows:${rows}">${items}</div>`;
  }

  render(): void {
    const p = this.profile;
    const [cc, cr] = cavitySize(p);
    const [pc, pr] = pouchSize(p.gutPouchLevel);
    const s = p.stats;
    const hosts = Object.entries(CLASSES).map(([id, c]) => {
      const open = c.playableFrom === 'spore' || c.playableFrom === 'larva';
      return `<div class="host ${id === p.host ? 'on' : ''} ${open ? '' : 'locked'}"><h3>${esc(c.label)}</h3><small>${open ? `${c.weight} · cavities ${c.cavityGrid[0]}×${c.cavityGrid[1]}` : 'EVOLVES IN HOST'}</small></div>`;
    }).join('');
    const stashCost = nextStashRowCost(p), pouchCost = pouchUpgradeCost(p);
    this.root.innerHTML = `
      <header>
        <div class="logo">BIOPHAGE<span>EXTRACTION</span></div>
        <div class="reg">THE HIVE</div>
        <div class="dna"><label>BANKED DNA</label><b id="hive-dna">${p.dna}</b></div>
      </header>
      <section class="hosts">${hosts}</section>
      <section class="loadout">
        <div class="col">
          <h2>STASH <small>${PROFILE.stash.gridColumns}×${p.stashRows} · CLICK TO LOAD</small></h2>
          ${this.grid('stash', PROFILE.stash.gridColumns, p.stashRows, p.stash)}
          <button class="sub-cta" data-action="expand" ${Number.isFinite(stashCost) ? '' : 'disabled'}>GROW STASH +1 ROW · ${cost(stashCost)}</button>
        </div>
        <div class="col">
          <h2>INTERNAL CAVITIES <small class="danger">LOST ON DEATH</small></h2>
          ${this.grid('cavity', cc, cr, p.cavity)}
          <h2>GUT POUCH <small>SECURE · SURVIVES DEATH · SHIFT-CLICK</small></h2>
          ${this.grid('pouch', pc, pr, p.gutPouch)}
          <button class="sub-cta" data-action="pouch" ${Number.isFinite(pouchCost) ? '' : 'disabled'}>GROW GUT POUCH · ${cost(pouchCost)}</button>
          <p class="tip">Right-click turns an item. DNA strand bundles bank as DNA when you extract.</p>
        </div>
      </section>
      <footer>
        <div class="record">RAIDS ${s.raids} · EXTRACTED ${s.extracts} · HOSTS LOST ${s.deaths} · KILLS ${s.kills}</div>
        <div class="notice">${this.notice ? esc(this.notice) : ''}</div>
        <button class="cta" id="deploy" data-action="deploy">DEPLOY · ZONE 7<small>${Math.round(RAID.raidTime / 60)} MIN · DEATH LOSES THE CAVITIES</small></button>
      </footer>`;
  }
}
