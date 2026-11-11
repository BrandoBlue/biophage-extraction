/**
 * Tithe Weaver web strands (renderer-free). A strand is a segment strung a little above the ground; a host walking
 * through one breaks it, is rooted for `rootDuration`, and everything within `alertRadius` is alerted. Strands can
 * also be shot (`strandBiomass`). The raid draws them and applies the root and the alert.
 */
import type { Vec2 } from './types';

export interface Strand { id: number; owner: number; a: Vec2; b: Vec2; biomass: number }

/** Distance from p to segment ab (XZ). */
export function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ux = b.x - a.x, uz = b.z - a.z, L2 = ux * ux + uz * uz || 1;
  const s = Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.z - a.z) * uz) / L2));
  return Math.hypot(p.x - (a.x + ux * s), p.z - (a.z + uz * s));
}

export class WebField {
  readonly strands: Strand[] = [];
  private next = 1;

  /** Strings a strand for `owner`, dropping its oldest past `max`; returns the new strand and any dropped. */
  add(owner: number, a: Vec2, b: Vec2, biomass: number, max = Infinity): { strand: Strand; dropped: Strand[] } {
    const dropped: Strand[] = [];
    const mine = this.strands.filter((x) => x.owner === owner);
    while (mine.length >= max) { const old = mine.shift()!; this.strands.splice(this.strands.indexOf(old), 1); dropped.push(old); }
    const s = { id: this.next++, owner, a: { ...a }, b: { ...b }, biomass };
    this.strands.push(s);
    return { strand: s, dropped };
  }

  /** Strands the host (at `p`, `radius` wide, moving from `prev`) walked into this frame; they break. */
  tripped(prev: Vec2, p: Vec2, radius = 0.45): Strand[] {
    const hit: Strand[] = [];
    for (let i = this.strands.length - 1; i >= 0; i--) {
      const s = this.strands[i];
      if (segDist(p, s.a, s.b) <= radius || crosses(prev, p, s.a, s.b)) { hit.push(s); this.strands.splice(i, 1); }
    }
    return hit;
  }

  /** Damages strand `id`; returns true if it broke. */
  damage(id: number, amount: number): boolean {
    const i = this.strands.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.strands[i].biomass -= amount;
    if (this.strands[i].biomass > 0) return false;
    this.strands.splice(i, 1);
    return true;
  }

  /** Drops every strand a dead weaver strung. */
  clear(owner: number): Strand[] {
    const gone = this.strands.filter((s) => s.owner === owner);
    for (const s of gone) this.strands.splice(this.strands.indexOf(s), 1);
    return gone;
  }
}

function crosses(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const o = (u: Vec2, v: Vec2, w: Vec2) => (v.x - u.x) * (w.z - u.z) - (v.z - u.z) * (w.x - u.x);
  return o(p, q, a) * o(p, q, b) < 0 && o(a, b, p) * o(a, b, q) < 0;
}
