/**
 * Mid-raid viruses (Larva, docs/gdd/larva-milestone.md, data/viruses.json). Pure logic, unit-tested:
 * the injection channel, the stat modifiers of the active virus, and the Plague-Stalker spore infection.
 * Raid applies the modifiers each frame and owns the parasites and visuals.
 */
import { VIRUSES, VIRUS_RULES } from '../../data';

export interface VirusModifiers {
  overloadDecay: number;
  sprint: number;
  biomassMax: number;
  footstep: number;
}

const NONE: VirusModifiers = { overloadDecay: 1, sprint: 1, biomassMax: 1, footstep: 1 };

/** Multipliers the active virus applies to the host (1 = unchanged). */
export function virusModifiers(id: string | null): VirusModifiers {
  const v = id ? VIRUSES[id] : null;
  if (!v) return NONE;
  const e = v.effect as Record<string, unknown>, c = v.cost as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' ? x : 1);
  return { overloadDecay: n(e.overloadDecayMultiplier), sprint: n(e.sprintMultiplier), biomassMax: n(c.biomassMaxMultiplier), footstep: n(c.footstepVisibility) };
}

/** The virus id an item injects, or null if the item is not a virus. */
export function virusForItem(item: string): string | null {
  return Object.entries(VIRUSES).find(([, v]) => v.item === item)?.[0] ?? null;
}

/** The 3 s injection channel. One at a time; finishing replaces the active virus. */
export class Injection {
  active: string | null = null;
  pending: string | null = null;
  left = 0;

  get injecting(): boolean { return this.pending !== null; }
  get progress(): number { return this.pending ? 1 - this.left / VIRUS_RULES.injectTime : 0; }

  start(virus: string): boolean {
    if (this.pending || !VIRUSES[virus]) return false;
    this.pending = virus;
    this.left = VIRUS_RULES.injectTime;
    return true;
  }

  cancel(): string | null { const v = this.pending; this.pending = null; this.left = 0; return v; }

  /** Returns the virus id on the frame the injection completes. */
  update(dt: number): string | null {
    if (!this.pending) return null;
    this.left -= dt;
    if (this.left > 0) return null;
    this.active = this.pending;
    this.pending = null;
    this.left = 0;
    return this.active;
  }
}

export interface SporeRules { damagePerSecond: number; duration: number; maxStacks: number; spreadOnDeathRadius: number }
export const sporeRules = (): SporeRules => (VIRUSES.plagueStalkerStrain.effect as { sporeInfection: SporeRules }).sporeInfection;

/** Plague-Stalker spores: each hit adds a stack (up to the cap) and refreshes the timer. */
export class SporeInfection {
  private stacks = new Map<number, { stacks: number; left: number }>();
  constructor(readonly r: SporeRules = sporeRules()) {}

  infect(id: number, stacks = 1): void {
    const s = this.stacks.get(id);
    const n = Math.min(this.r.maxStacks, (s?.stacks ?? 0) + stacks);
    this.stacks.set(id, { stacks: n, left: this.r.duration });
  }

  stacksOf(id: number): number { return this.stacks.get(id)?.stacks ?? 0; }
  clear(id: number): void { this.stacks.delete(id); }

  /** Damage to deal this frame per infected id. */
  update(dt: number): Map<number, number> {
    const out = new Map<number, number>();
    for (const [id, s] of this.stacks) {
      const step = Math.min(dt, s.left);
      out.set(id, s.stacks * this.r.damagePerSecond * step);
      s.left -= dt;
      if (s.left <= 0) this.stacks.delete(id);
    }
    return out;
  }
}
