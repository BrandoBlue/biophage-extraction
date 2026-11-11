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
 * Zone 7 surface tones: the dark, desaturated bodies that the emissive palette above glows against.
 * Rock and fungus flesh stay deep so bloom and bioluminescence carry the frame (reference 04).
 */
export const ZONE7_SHADE = {
  rock: '#3A2768',
  rockDeep: '#0D0626',
  moss: '#12424A',
  stem: '#3B2457',
  flesh: '#5A2A55',
  planet: '#1A0B3A',
  skyHorizon: '#3A1466',
  skyZenith: '#07031A',
} as const;

/** Colour grading targets for the final post pass (split-tone shadows and highlights). */
export const GRADE = {
  zone7Shadow: '#1C0A3D',
  zone7Highlight: '#BFF6FF',
  hiveShadow: '#03120E',
  hiveHighlight: '#E6FFD9',
} as const;
export const ALL_COLOURS: Record<string, string> = { ...HIVE, ...PATH, ...ZONE7, ...ZONE7_SHADE, ...GRADE };
