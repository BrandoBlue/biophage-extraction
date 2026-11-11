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



/**
 * Zone 7 surface tones (Art Bible, "Grounded and eerie", Brandon 2026-11-11 evening): weathered stone, olive moss,
 * bruise-brown flesh and a cold grey-teal night. Bodies are natural and lit; the glow palette above is a rare accent.
 */
export const ZONE7_SHADE = {
  rock: '#4A453E',
  rockDeep: '#101012',
  moss: '#26301F',
  stem: '#4A3E39',
  flesh: '#523437',
  planet: '#17171D',
  skyHorizon: '#3A3F46',
  skyZenith: '#050607',
} as const;

/**
 * Natural, lit tones (Art Bible, "Ethereal, not neon"): wet flesh, bone, amber and mist for bodies that are
 * lit rather than glowing, such as the held weapon, hands and hides. Glow colours above stay accents on these.
 */
export const ORGANIC = {
  wetFlesh: '#6E4E4C',
  wetFleshDeep: '#3A1C2A',
  vein: '#5A3036',
  amber: '#C98A3E',
  mist: '#8C9BB4',
} as const;

/** Colour grading targets for the final post pass (split-tone shadows and highlights). */
export const GRADE = {
  zone7Shadow: '#0B1315',
  zone7Highlight: '#DCD6C8',
  hiveShadow: '#03120E',
  hiveHighlight: '#E6FFD9',
} as const;
export const ALL_COLOURS: Record<string, string> = { ...HIVE, ...PATH, ...ZONE7, ...ZONE7_SHADE, ...ORGANIC, ...GRADE };
