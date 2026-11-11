/**
 * Habitats: each Abomination kind lives in the kinds of places that suit it (data/ai.json `habitats`), so a raid's
 * threats are learnable instead of scattered. World's layout names the areas (`Habitat`); this picks where a spawn
 * or a reinforcement comes from. Renderer-free.
 */
import { AI } from '../../data';

export type HabitatTag = 'grove' | 'pool' | 'interior' | 'open' | 'crater' | 'ridge';

/** A named area of a zone. `y` is the floor height for areas off the terrain (structure decks, caves). */
export interface Habitat { id: string; tag: HabitatTag; x: number; z: number; radius: number; y?: number }

export interface HabitatSpot { x: number; z: number; y?: number; area: Habitat }

/** The tags a kind lives in, most preferred first (empty: no habitat rule, use the old placement). */
export function habitatTags(kind: string): string[] { return AI.habitats.kinds[kind] ?? []; }

export class HabitatPlanner {
  /** How many spawns each area has taken, so packs spread over a kind's areas instead of stacking. */
  private used = new Map<string, number>();

  constructor(readonly areas: readonly Habitat[], private rand: () => number = Math.random) {}

  /** Areas a kind lives in: the first preferred tag that has any area that passes `ok`. */
  private candidates(kind: string, ok: (a: Habitat) => boolean): Habitat[] {
    for (const tag of habitatTags(kind)) {
      const list = this.areas.filter((a) => a.tag === tag && ok(a));
      if (list.length) return list;
    }
    return [];
  }

  private spot(a: Habitat): HabitatSpot {
    this.used.set(a.id, (this.used.get(a.id) ?? 0) + 1);
    const ang = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * a.radius * AI.habitats.spread;
    return { x: a.x + Math.cos(ang) * d, z: a.z + Math.sin(ang) * d, y: a.y, area: a };
  }

  /**
   * Where a kind starts the raid: its least-used area, at least `clear` metres from `avoid` (the host's spawn).
   * Null when the zone has no area for it.
   */
  place(kind: string, avoid: { x: number; z: number }, clear: number): HabitatSpot | null {
    const list = this.candidates(kind, (a) => Math.hypot(a.x - avoid.x, a.z - avoid.z) - a.radius >= clear);
    if (!list.length) return null;
    const least = Math.min(...list.map((a) => this.used.get(a.id) ?? 0));
    const pool = list.filter((a) => (this.used.get(a.id) ?? 0) === least);
    return this.spot(pool[Math.floor(this.rand() * pool.length)]);
  }

  /** Where reinforcements of a kind come from: its nearest area at least `min` metres from the host. */
  nearest(kind: string, host: { x: number; z: number }, min: number): HabitatSpot | null {
    const dist = (a: Habitat) => Math.hypot(a.x - host.x, a.z - host.z);
    const list = this.candidates(kind, (a) => dist(a) - a.radius * AI.habitats.spread >= min);
    if (!list.length) return null;
    return this.spot(list.reduce((b, a) => (dist(a) < dist(b) ? a : b)));
  }
}
