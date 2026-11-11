/** Art Bible palette. The single source for every colour in the game. See docs/ART_BIBLE.md. */
export const HIVE = {
  background: '#050F0C',
  panel: '#0B2A26',
  acid: '#6CFF4A',
  bone: '#D3CBB2',
  danger: '#E0402E',
} as const;

export const PATH = {
  stealth: '#6CFF4A',
  melee: '#FFB13B',
  viral: '#A55BFF',
  dna: '#34E3F0',
} as const;

export const ZONE7 = {
  void: '#140A33',
  magenta: '#FF3FA4',
  cyan: '#2EE6FF',
  violet: '#8B3DFF',
  lime: '#B6FF3B',
} as const;

export const ALL_COLOURS: Record<string, string> = { ...HIVE, ...PATH, ...ZONE7 };
