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

/**
 * The Ochre Reach (desert savannah zone): sun-baked clay, bleached bone and dust under a hazed amber sky.
 * Grounded like the rest of Zone 7: earth tones lit by low suns, glow stays a rare accent.
 */
export const OCHRE = {
  sand: '#B08A5E',
  sandShade: '#6E5038',
  clay: '#9C6B48',
  clayDark: '#4E3427',
  dust: '#C9A57A',
  bleached: '#D8CBB0',
  thorn: '#3B3326',
  leaf: '#5E6440',
  skyHaze: '#C79E74',
  skyHigh: '#6F6A73',
  sun: '#F4E2BE',
  rust: '#7A4A30',
} as const;

/**
 * Natural hides for the new-zone creatures (Creature & Mutation, zones/): sun-bleached sand and ochre dust for the
 * Ochre Reach, rope-pale and soot for the Marrow Pit, reed, peat and moss for the Weeping Fen. Lit, not glowing.
 */
export const FAUNA = {
  sand: '#B89870',
  sandDeep: '#6E5238',
  ochre: '#9A5B32',
  dustPale: '#D8C6A2',
  rope: '#A39A86',
  soot: '#24201E',
  sickGreen: '#7E9A52',
  reed: '#8C8A5E',
  peat: '#2E2A1E',
  fenMoss: '#4E5A34',
  pearl: '#D9D2C0',
  water: '#2C3A36',
} as const;

/**
 * The starter gun (Gameplay's Synapse Burster, Brandon 2026-11-12: "veiny and brown", wants it to look good):
 * pale polished bone plates over a dark slate carapace, a little tissue in the seams, one soft sea-green accent.
 */
export const ARMOURY = {
  shell: '#D6CDB8',
  shellShade: '#A89E89',
  carapace: '#24272D',
  carapaceEdge: '#3A3F47',
  tissue: '#6A3F45',
  accent: '#5ED6B8',
  accentDeep: '#1F5E52',
} as const;

/** Colour grading targets for the final post pass (split-tone shadows and highlights). */
export const GRADE = {
  zone7Shadow: '#0B1315',
  zone7Highlight: '#DCD6C8',
  hiveShadow: '#03120E',
  hiveHighlight: '#E6FFD9',
} as const;
export const ALL_COLOURS: Record<string, string> = { ...HIVE, ...PATH, ...ZONE7, ...ZONE7_SHADE, ...ORGANIC, ...OCHRE, ...FAUNA, ...ARMOURY, ...GRADE };
