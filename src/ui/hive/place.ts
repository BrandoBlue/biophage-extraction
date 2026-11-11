/**
 * Exact-cell placement over Gameplay's Profile for drag and drop in the stash screen. Gameplay's profile.ts owns
 * transfer/rotate (auto-placement); this adds "put it here". Swap to Gameplay's placeAt when it lands in profile.ts.
 */
import { footprint, ItemGrid, stackLimit } from '../../game/grid';
import { cavityGrid, pouchGrid, stashGrid, type Profile } from '../../game/profile';
import type { GridZone } from './model';

const grids = (p: Profile): Record<GridZone, ItemGrid> => ({ stash: stashGrid(p), cavity: cavityGrid(p), pouch: pouchGrid(p) });
function commit(p: Profile, g: Record<GridZone, ItemGrid>): void {
  p.stash = g.stash.snapshot(); p.cavity = g.cavity.snapshot(); p.gutPouch = g.pouch.snapshot();
}

/**
 * Drag-and-drop placement: moves the stack at `index` of `from` to cell (x, y) of `to`, optionally rotated.
 * Dropping onto the same item tops that stack up to its limit (the rest stays where it was).
 * Returns false and changes nothing when the cell is blocked.
 */
export function placeAt(p: Profile, from: GridZone, index: number, to: GridZone, x: number, y: number, rotated: boolean): boolean {
  const g = grids(p);
  const e = g[from].entries[index];
  if (!e) return false;
  const dst = g[to];
  if (from === to ? dst.fits(e.item, x, y, rotated, e) : dst.fits(e.item, x, y, rotated)) {
    if (from === to) dst.move(e, x, y, rotated);
    else { g[from].take(e); dst.entries.push({ ...e, x, y, rotated }); }
    commit(p, g);
    return true;
  }
  // Not free: stack onto the same item under the cursor.
  const t = dst.entries.find((o) => {
    if (o === e || o.item !== e.item) return false;
    const [w, h] = footprint(o.item, o.rotated);
    return x >= o.x && x < o.x + w && y >= o.y && y < o.y + h;
  });
  const n = t ? Math.min(e.count, stackLimit(e.item) - t.count) : 0;
  if (!t || n <= 0) return false;
  t.count += n; e.count -= n;
  if (e.count <= 0) g[from].take(e);
  commit(p, g);
  return true;
}

