/**
 * Data-driven ability system. Each entry in data/abilities.json maps by id to an effect handler here.
 * Neural Overload is the resource: an ability adds its overloadCost as heat and is refused while Overloaded.
 * Mutations and viruses in Larva register new handlers and fill slots 3 to 5.
 */
import type { Ability } from '../../data';
import type { NeuralOverload } from './vitals';

export interface AbilityHost {
  overload: NeuralOverload;
  /** Count of a consumable item carried. */
  count(item: string): number;
  consume(item: string): boolean;
}

export type AbilityEffect = (a: Ability, id: string) => void;

export interface SlotView { id: string; label: string; slot: number; cooldown: number; cooldownFrac: number; active: boolean; count: number | null; usable: boolean }

export type UseResult = 'ok' | 'cooldown' | 'overloaded' | 'empty' | 'unknown';

export class AbilitySystem {
  private cooldowns = new Map<string, number>();
  private effects = new Map<string, AbilityEffect>();
  private active = new Map<string, number>();

  constructor(readonly defs: Record<string, Ability>, private host: AbilityHost) {}

  register(id: string, effect: AbilityEffect): void { this.effects.set(id, effect); }

  bySlot(slot: number): string | undefined { return Object.keys(this.defs).find((k) => this.defs[k].slot === slot); }

  use(id: string): UseResult {
    const a = this.defs[id];
    const fx = this.effects.get(id);
    if (!a || !fx) return 'unknown';
    if ((this.cooldowns.get(id) ?? 0) > 0) return 'cooldown';
    if (a.overloadCost > 0 && this.host.overload.overloaded) return 'overloaded';
    if (a.consumable && a.item && this.host.count(a.item) <= 0) return 'empty';
    if (a.consumable && a.item) this.host.consume(a.item);
    this.host.overload.add(a.overloadCost);
    this.cooldowns.set(id, a.cooldown);
    fx(a, id);
    return 'ok';
  }

  /** Marks an ability as visibly active (e.g. a heal over time) for `seconds`. */
  setActive(id: string, seconds: number): void { this.active.set(id, seconds); }

  update(dt: number): void {
    for (const [k, v] of this.cooldowns) this.cooldowns.set(k, Math.max(0, v - dt));
    for (const [k, v] of this.active) { if (v - dt <= 0) this.active.delete(k); else this.active.set(k, v - dt); }
  }

  slots(): SlotView[] {
    return Object.entries(this.defs).map(([id, a]) => {
      const cd = this.cooldowns.get(id) ?? 0;
      const count = a.consumable && a.item ? this.host.count(a.item) : null;
      return {
        id, label: a.label, slot: a.slot, cooldown: cd, cooldownFrac: a.cooldown > 0 ? cd / a.cooldown : 0, active: this.active.has(id), count,
        usable: cd === 0 && !(a.overloadCost > 0 && this.host.overload.overloaded) && (count === null || count > 0),
      };
    });
  }
}
