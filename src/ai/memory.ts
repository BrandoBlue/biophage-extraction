/**
 * What the creatures of one raid have learned about the host (docs/gdd/11-creature-minds.md, rule 4: "they learn you
 * within a raid"). Brains note the tricks they see the host use (keyed by creature kind, so Needlemaws learn about
 * Needlemaws), and once a trick has worked `ai.json learning.after` times they counter it. Nothing carries between
 * raids, so each raid starts fair. One memory per raid, keyed like the attack tokens.
 */
import { AI } from '../../data';

export class RaidMemory {
  private readonly counts = new Map<string, number>();
  private readonly marks = new Map<string, number>();

  private key(kind: string, trick: string): string { return `${kind}:${trick}`; }

  /** The host used `trick` on a creature of `kind`. Returns how many times it has now. */
  note(kind: string, trick: string): number {
    const k = this.key(kind, trick), n = (this.counts.get(k) ?? 0) + 1;
    this.counts.set(k, n);
    return n;
  }

  count(kind: string, trick: string): number { return this.counts.get(this.key(kind, trick)) ?? 0; }

  /** True once the trick has been used enough times that the creatures counter it. */
  learned(kind: string, trick: string): boolean { return this.count(kind, trick) >= AI.learning.after; }

  /** A free running counter (whose turn it is to lunge, and so on). */
  tick(kind: string, mark: string): number {
    const k = this.key(kind, mark), n = (this.marks.get(k) ?? 0) + 1;
    this.marks.set(k, n);
    return n;
  }
}

const memories = new WeakMap<object, RaidMemory>();
/** The memory for one raid, keyed by the raid's creature list. */
export function memoryFor(owner: object): RaidMemory {
  let m = memories.get(owner);
  if (!m) { m = new RaidMemory(); memories.set(owner, m); }
  return m;
}
