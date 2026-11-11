/** What the host carries in a raid. Spore keeps a simple stacked list; Larva replaces it with the cavity grid. */
import { haulValue, LOOT } from '../../data';

export interface Stack { item: string; count: number }

export class Carried {
  readonly items: Stack[] = [];
  /** DNA from kills, banked only on extraction. */
  dna = 0;

  add(item: string, count = 1): void {
    if (!LOOT.items[item]) throw new Error(`unknown item ${item}`);
    const s = this.items.find((x) => x.item === item);
    if (s) s.count += count; else this.items.push({ item, count });
  }

  count(item: string): number { return this.items.find((x) => x.item === item)?.count ?? 0; }

  /** Removes one of `item`. Returns false if none carried. */
  consume(item: string): boolean {
    const i = this.items.findIndex((x) => x.item === item);
    if (i < 0) return false;
    if (--this.items[i].count <= 0) this.items.splice(i, 1);
    return true;
  }

  get value(): number { return haulValue(this.items, this.dna); }

  snapshot(): { items: Stack[]; dna: number; value: number } {
    return { items: this.items.map((s) => ({ ...s })), dna: this.dna, value: this.value };
  }
}
