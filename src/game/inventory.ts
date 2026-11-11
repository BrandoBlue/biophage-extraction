/**
 * What the host carries in a raid (Larva): the internal-cavity grid (lost on death) and the gut pouch
 * (a secure slot that survives death), plus kill DNA, which is banked only on extraction.
 */
import { haulValue } from '../../data';
import { ItemGrid, type Placed } from './grid';

export interface Stack { item: string; count: number }

export interface Loadout { cavity: Placed[]; pouch: Placed[] }

export interface CarriedSnapshot { items: Stack[]; dna: number; value: number; cavity: Placed[]; pouch: Placed[] }

export class Carried {
  cavity: ItemGrid;
  pouch: ItemGrid;
  /** DNA from kills, banked only on extraction. */
  dna = 0;

  constructor(cavitySize: [number, number] = [5, 4], pouchSize: [number, number] = [2, 1]) {
    this.cavity = new ItemGrid(cavitySize[0], cavitySize[1]);
    this.pouch = new ItemGrid(pouchSize[0], pouchSize[1]);
  }

  /** Replaces the contents with a deployed loadout (keeps grid sizes from the loadout's owner). */
  load(l: Loadout, cavitySize: [number, number], pouchSize: [number, number]): void {
    this.cavity = new ItemGrid(cavitySize[0], cavitySize[1], l.cavity);
    this.pouch = new ItemGrid(pouchSize[0], pouchSize[1], l.pouch);
    this.dna = 0;
  }

  /** Pickups fill the cavities, then the gut pouch. Returns how many did not fit (left where they were). */
  add(item: string, count = 1): number {
    const left = this.cavity.add(item, count);
    return left > 0 ? this.pouch.add(item, left) : 0;
  }

  /** How many of `item` would fit right now. */
  room(item: string, want: number): number {
    const a = this.cavity.room(item, want);
    return a + (a < want ? this.pouch.room(item, want - a) : 0);
  }

  count(item: string): number { return this.cavity.count(item) + this.pouch.count(item); }

  /** Removes one of `item`, spending cavity stock before the secure pouch. Returns false if none carried. */
  consume(item: string): boolean {
    return this.cavity.remove(item, 1) === 1 || this.pouch.remove(item, 1) === 1;
  }

  /** Item totals across cavities and pouch. */
  get items(): Stack[] {
    const out = this.cavity.totals();
    for (const s of this.pouch.totals()) {
      const o = out.find((x) => x.item === s.item);
      if (o) o.count += s.count; else out.push({ ...s });
    }
    return out;
  }

  get value(): number { return haulValue(this.items, this.dna); }

  snapshot(): CarriedSnapshot {
    return { items: this.items, dna: this.dna, value: this.value, cavity: this.cavity.snapshot(), pouch: this.pouch.snapshot() };
  }
}
