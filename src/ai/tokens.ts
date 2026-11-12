/**
 * Attack tokens: only a few creatures may commit to an attack on the host at once; the rest circle, feint and wait.
 * This is what makes a pack of ten readable instead of a blender. Tokens expire after `holdTime` so a stuck holder
 * cannot starve the pack;
 * holders refresh theirs every frame they are still committed. Shared cooldowns (one screech per swarm window) live here too.
 */
import { AI } from '../../data';

export type TokenKind = 'melee' | 'ranged';

export class AttackTokens {
  time = 0;
  private held = new Map<number, { kind: TokenKind; since: number }>();
  private shared = new Map<string, number>();

  constructor(private limits: Record<TokenKind, number> = { melee: AI.tokens.melee, ranged: AI.tokens.ranged }, private holdTime = AI.tokens.holdTime) {}

  tick(dt: number): void {
    this.time += dt;
    for (const [id, h] of this.held) if (this.time - h.since > this.holdTime) this.held.delete(id);
  }

  holds(id: number): boolean { return this.held.has(id); }

  count(kind: TokenKind): number {
    let n = 0;
    for (const h of this.held.values()) if (h.kind === kind) n++;
    return n;
  }

  /** Try to take a slot. Re-requesting a held token refreshes it. */
  request(id: number, kind: TokenKind, bonus = 0): boolean {
    const h = this.held.get(id);
    if (h) { h.since = this.time; return true; }
    if (this.count(kind) >= this.limits[kind] + bonus) return false;
    this.held.set(id, { kind, since: this.time });
    return true;
  }

  release(id: number): void { this.held.delete(id); }

  /** A cooldown shared by every creature using `key` (for example one screech per swarm window). */
  sharedReady(key: string, cooldown: number): boolean {
    const t = this.shared.get(key);
    return t === undefined || this.time - t >= cooldown;
  }
  useShared(key: string): void { this.shared.set(key, this.time); }
}

/** One token pool per raid, keyed by the raid's creature list (stable for the raid's lifetime). */
const pools = new WeakMap<object, AttackTokens>();
export function tokensFor(owner: object): AttackTokens {
  let t = pools.get(owner);
  if (!t) { t = new AttackTokens(); pools.set(owner, t); }
  return t;
}
