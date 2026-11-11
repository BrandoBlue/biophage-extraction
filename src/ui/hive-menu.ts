/**
 * The Hive (Larva): adapts Gameplay's persistent Profile (src/game/profile.ts) to the UI department's HiveUI
 * screens (src/ui/hive/): main menu, host select, stash and internal cavities, raid select, settings and the raid
 * debrief. main.ts keeps the same small surface it had with the interim menu: construct, hide, say, visible,
 * plus showResults for the debrief.
 */
import { BUILT_ZONES } from '../world/zones';
import { CLASSES, MARKET, PROFILE, VENDOR_REP_THRESHOLDS, VENDORS, vendorBuyPrice } from '../../data';
import type { ClassId, VendorId } from '../../data';
import {
  abandonContract, acceptContract, canVendorBuy, contractById, openVendors, repLevel, repPoints, selectZone, vendorBuy, vendorContracts, vendorSell, vendorStock, zoneList,
} from '../game/economy';
import { ItemGrid } from '../game/grid';
import {
  buy, canBuy, expandStash, marketStock, marketWindow, nextStashRowCost, placeAt, pouchUpgradeCost, sell, sellPrice, stashGrid, upgradePouch,
  type Profile,
} from '../game/profile';
import { HiveUI } from './hive/hive-ui';
import type { HiveActions, ProfileView, VendorView } from './hive/model';
import { objectiveText } from './hive/vendors';
import type { ResultData } from './hive/screens';

/** Short, stable callsign from the profile's raid record; a real name arrives with the Hive account. */
const callsign = (p: Profile) => `HOST-${(0x7f3a + p.stats.raids * 31).toString(16).toUpperCase().slice(-4)}`;

export class HiveMenu {
  readonly ui: HiveUI;
  private last: ProfileView['last'];

  constructor(private profile: Profile, private onChange: () => void, onDeploy: () => void, notice: string | null = null) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    document.body.classList.add('in-hive');
    const p = profile;
    const actions: HiveActions = {
      move: (from, index, to, x, y, rotated) => { const ok = placeAt(p, from, index, to, x, y, rotated); if (ok) onChange(); return ok; },
      stashRowCost: () => { const c = nextStashRowCost(p); return Number.isFinite(c) ? c : null; },
      expandStash: () => { const ok = expandStash(p); if (ok) onChange(); return ok; },
      pouchUpgrade: () => {
        const cost = pouchUpgradeCost(p);
        const u = PROFILE.gutPouch.upgrades[p.gutPouchLevel];
        return Number.isFinite(cost) && u ? { cost, size: u.size as [number, number] } : null;
      },
      upgradePouch: () => { const ok = upgradePouch(p); if (ok) onChange(); return ok; },
      deploy: onDeploy,
      market: () => {
        const now = new Date();
        const next = (marketWindow(now) + 1) * MARKET.rotateHours * 3600e3;
        return { mood: p.marketMood, rotatesIn: Math.max(0, (next - now.getTime()) / 1000), sellPrice: (item) => sellPrice(p, item),
          stock: marketStock(p, now).map((s) => ({ ...s, state: canBuy(p, s.item, now) })) };
      },
      sell: (zone, index, count) => { const paid = sell(p, zone, index, count); if (paid) onChange(); return paid; },
      buy: (item) => { const ok = buy(p, item); if (ok) onChange(); return ok; },
      vendors: () => openVendors().map((v) => this.vendorView(v)),
      vendorBuy: (v, item) => { const ok = vendorBuy(p, v as VendorId, item); if (ok) onChange(); return ok; },
      vendorSell: (v, zone, index, count) => { const paid = vendorSell(p, v as VendorId, zone, index, count); if (paid) onChange(); return paid; },
      acceptContract: (id) => { const ok = acceptContract(p, id); if (ok) onChange(); return ok; },
      abandonContract: (v) => { const ok = abandonContract(p, v as VendorId); if (ok) onChange(); return ok; },
      // Zones whose map World has not built yet read as 'coming' instead of quietly loading Glowmire.
      zones: () => zoneList(p, 0, BUILT_ZONES),
      selectZone: (id) => { const ok = selectZone(p, id, 0, BUILT_ZONES); if (ok) onChange(); return ok; },
    };
    this.ui = new HiveUI(root, () => this.view(), actions, {
      pickHost: (id) => this.pickHost(id),
      afterResults: () => location.reload(),
    });
    this.ui.show('menu');
    if (notice) this.say(notice);
  }

  private view(): ProfileView {
    const p = this.profile;
    return { callsign: callsign(p), dna: p.dna, host: p.host, stash: p.stash, stashRows: p.stashRows, cavity: p.cavity,
      gutPouch: p.gutPouch, gutPouchLevel: p.gutPouchLevel, stats: p.stats, last: this.last, zone: p.economy.zone };
  }

  /** One vendor as the vendor screen reads it: rep band, rep-gated stock, unlock text, contract chain. */
  private vendorView(v: VendorId): VendorView {
    const p = this.profile, d = VENDORS[v], level = repLevel(p, v), T = VENDOR_REP_THRESHOLDS;
    return {
      id: v, label: d.label, role: d.role, brief: d.brief ?? '',
      rep: { level, points: Math.floor(repPoints(p, v)), floor: T[level - 1] ?? 0, next: level < T.length ? T[level] : null },
      unlocks: Object.entries(d.unlocks).map(([r, text]) => ({ rep: Number(r), text, earned: level >= Number(r) })),
      stock: vendorStock(p, v).map((s) => {
        const st = canVendorBuy(p, v, s.item);
        return { item: s.item, price: s.price, rep: s.rep, state: st };
      }),
      sellPrice: (item) => vendorBuyPrice(v, item),
      contracts: vendorContracts(p, v).map(({ contract: c, state, progress }) => ({
        id: c.id, title: c.title, brief: c.brief, state,
        objectives: c.objectives.map((o, i) => ({ text: objectiveText(o), done: progress[i] ?? 0, need: o.count ?? 1 })),
        reward: { dna: c.reward.dna, rep: c.reward.rep, items: c.reward.items ?? [], unlock: c.reward.unlock },
        requires: (c.requires ?? []).map((id) => contractById(id)?.title ?? id),
      })),
    };
  }

  /** Only hosts open in this milestone can be picked; a smaller cavity grid spills its loadout back to the stash. */
  private pickHost(id: ClassId): void {
    const p = this.profile;
    if (id === p.host || CLASSES[id].playableFrom === 'host') return;
    const before = new ItemGrid(99, 99, p.cavity).totals();
    const stash = stashGrid(p);
    const [c, r] = CLASSES[id].cavityGrid as [number, number];
    const cav = new ItemGrid(c, r);
    for (const e of p.cavity) if (!cav.place(e.item, e.count, e.x, e.y, e.rotated)) {
      const left = cav.add(e.item, e.count);
      if (left && stash.add(e.item, left)) { this.say('No room in the stash for the loadout this host cannot carry.'); return; }
    }
    p.host = id;
    p.cavity = cav.snapshot();
    p.stash = stash.snapshot();
    if (new ItemGrid(99, 99, p.cavity).totals().length !== before.length) this.say('Part of the loadout went back to the stash.');
    this.onChange();
  }

  get visible(): boolean { return this.ui.visible; }

  /** The main menu shows the live 3D Hive lab (src/ui/hive-stage.ts) behind its specimen column. */
  get wantsStage(): boolean { return this.ui.visible && this.ui.tab === 'menu'; }

  /** The 2D specimen hides and the backdrop thins to a vignette while the 3D stage is drawing. */
  stageLive(on: boolean): void { this.ui.root.classList.toggle('lab-live', on); }

  hide(): void { this.ui.hide(); document.body.classList.remove('in-hive'); }

  say(text: string): void { this.ui.notice(text.toUpperCase(), 'danger'); }

  /** Raid debrief: the HUD hides and the Hive frame shows the result; RETURN TO HIVE reloads into the menu. */
  showResults(r: ResultData): void {
    this.last = { result: r.result, value: r.value };
    document.body.classList.add('in-hive');
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showResults(r);
  }
}
