/**
 * The Hive (Larva): adapts Gameplay's persistent Profile (src/game/profile.ts) to the UI department's HiveUI
 * screens (src/ui/hive/): main menu, host select, stash and internal cavities, raid select, settings and the raid
 * debrief. main.ts keeps the same small surface it had with the interim menu: construct, hide, say, visible,
 * plus showResults for the debrief.
 */
import { CLASSES, PROFILE } from '../../data';
import type { ClassId } from '../../data';
import { ItemGrid } from '../game/grid';
import { expandStash, nextStashRowCost, placeAt, pouchUpgradeCost, stashGrid, upgradePouch, type Profile } from '../game/profile';
import { HiveUI } from './hive/hive-ui';
import type { HiveActions, ProfileView } from './hive/model';
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
      gutPouch: p.gutPouch, gutPouchLevel: p.gutPouchLevel, stats: p.stats, last: this.last };
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
