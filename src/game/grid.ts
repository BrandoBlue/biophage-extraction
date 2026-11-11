/**
 * Item grid shared by the stash, the internal cavities and the gut pouch (Larva, docs/gdd/larva-milestone.md).
 * Items occupy `LOOT.items[id].size` cells ([w, h]; swapped when rotated) and stack up to `stack`.
 * Pure logic, no DOM, so every transfer rule is unit-tested in tests/profile.test.ts.
 */
import { LOOT } from '../../data';

export interface Placed { item: string; count: number; x: number; y: number; rotated: boolean }

export function footprint(item: string, rotated = false): [number, number] {
  const def = LOOT.items[item];
  if (!def) throw new Error(`unknown item ${item}`);
  const [w, h] = def.size;
  return rotated ? [h, w] : [w, h];
}

export const stackLimit = (item: string): number => Math.max(1, LOOT.items[item]?.stack ?? 1);

export class ItemGrid {
  readonly entries: Placed[] = [];

  constructor(public cols: number, public rows: number, entries: Placed[] = []) {
    // Restore saved placements; anything that no longer fits (grid shrank, data changed) is re-packed.
    for (const e of entries) {
      if (!LOOT.items[e.item] || e.count <= 0) continue;
      if (!this.place(e.item, e.count, e.x, e.y, e.rotated)) this.add(e.item, e.count);
    }
  }

  /** True when `item` at (x, y) stays inside the grid and overlaps nothing except `ignore`. */
  fits(item: string, x: number, y: number, rotated = false, ignore?: Placed): boolean {
    const [w, h] = footprint(item, rotated);
    if (x < 0 || y < 0 || x + w > this.cols || y + h > this.rows) return false;
    return !this.entries.some((e) => {
      if (e === ignore) return false;
      const [ew, eh] = footprint(e.item, e.rotated);
      return x < e.x + ew && e.x < x + w && y < e.y + eh && e.y < y + h;
    });
  }

  /** Places a new stack at an exact cell. Returns null if it does not fit or exceeds the stack limit. */
  place(item: string, count: number, x: number, y: number, rotated = false): Placed | null {
    if (count <= 0 || count > stackLimit(item) || !this.fits(item, x, y, rotated)) return null;
    const p = { item, count, x, y, rotated };
    this.entries.push(p);
    return p;
  }

  /** First free cell scanning rows top-down, unrotated before rotated. */
  findSpace(item: string): { x: number; y: number; rotated: boolean } | null {
    const [w, h] = footprint(item);
    for (const rotated of w === h ? [false] : [false, true]) {
      for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) if (this.fits(item, x, y, rotated)) return { x, y, rotated };
    }
    return null;
  }

  /** Tops up existing stacks, then opens new ones first-fit. Returns how many could not be placed. */
  add(item: string, count = 1): number {
    const limit = stackLimit(item);
    for (const e of this.entries) {
      if (count <= 0) break;
      if (e.item !== item || e.count >= limit) continue;
      const n = Math.min(count, limit - e.count);
      e.count += n; count -= n;
    }
    while (count > 0) {
      const at = this.findSpace(item);
      if (!at) break;
      const n = Math.min(count, limit);
      this.entries.push({ item, count: n, ...at });
      count -= n;
    }
    return count;
  }

  /** How many of `item` would fit right now (existing stacks plus free space), capped at `want`. */
  room(item: string, want: number): number {
    const probe = new ItemGrid(this.cols, this.rows);
    probe.entries.push(...this.entries.map((e) => ({ ...e })));
    return want - probe.add(item, want);
  }

  count(item: string): number { return this.entries.reduce((n, e) => n + (e.item === item ? e.count : 0), 0); }

  /** Removes up to `count` of `item`, newest stacks first. Returns how many were removed. */
  remove(item: string, count = 1): number {
    let removed = 0;
    for (let i = this.entries.length - 1; i >= 0 && removed < count; i--) {
      const e = this.entries[i];
      if (e.item !== item) continue;
      const n = Math.min(count - removed, e.count);
      e.count -= n; removed += n;
      if (e.count <= 0) this.entries.splice(i, 1);
    }
    return removed;
  }

  /** Removes one placed stack entirely. */
  take(entry: Placed): Placed | null {
    const i = this.entries.indexOf(entry);
    return i < 0 ? null : this.entries.splice(i, 1)[0];
  }

  /** Moves a stack to a new cell (optionally rotating). Returns false and leaves it alone if blocked. */
  move(entry: Placed, x: number, y: number, rotated = entry.rotated): boolean {
    if (!this.entries.includes(entry) || !this.fits(entry.item, x, y, rotated, entry)) return false;
    Object.assign(entry, { x, y, rotated });
    return true;
  }

  get isEmpty(): boolean { return this.entries.length === 0; }
  get usedCells(): number { return this.entries.reduce((n, e) => { const [w, h] = footprint(e.item, e.rotated); return n + w * h; }, 0); }

  /** Totals per item, in first-seen order (HUD lists, results, haul value). */
  totals(): { item: string; count: number }[] {
    const out: { item: string; count: number }[] = [];
    for (const e of this.entries) {
      const s = out.find((o) => o.item === e.item);
      if (s) s.count += e.count; else out.push({ item: e.item, count: e.count });
    }
    return out;
  }

  snapshot(): Placed[] { return this.entries.map((e) => ({ ...e })); }
}
