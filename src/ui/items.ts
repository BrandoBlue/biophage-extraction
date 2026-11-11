/**
 * Item lookup for the UI: loot items plus Flesh Market contraband (data/market.json). Every screen resolves item
 * labels, kinds, sizes and values through `def`, so contraband bought at the market shows up like any other item.
 */
import { LOOT, MARKET } from '../../data';
import type { Item } from '../../data';

export const def = (id: string): Item | undefined => LOOT.items[id] ?? (MARKET.contraband[id] as Item | undefined);
export const label = (id: string): string => def(id)?.label ?? id;
