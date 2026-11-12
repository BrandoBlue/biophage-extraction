import { GRADE, HIVE, ZONE7 } from './palette';

/** Lighting and grading presets for the two Art Bible registers. Tuned against docs/reference/. */
export interface GradePreset {
  exposure: number;
  /** Image-based light strength from the baked sky. */
  environment: number;
  bloom: { strength: number; radius: number; threshold: number };
  aberration: number;
  vignette: number;
  saturation: number;
  contrast: number;
  grain: number;
  split: number;
  /** Shadow floor in display space: dark areas keep readable form instead of going black. */
  lift: number;
  shadow: string;
  highlight: string;
  hit: string;
}

export const GRADE_PRESETS = {
  /** Grounded and eerie (Brandon, 2026-11-11 evening), lifted for visibility (2026-11-12: "a bit too dark now"): a cold, low-saturation night where shapes stay readable, film grain, bloom only on true highlights. */
  zone7: {
    exposure: 1.72,
    environment: 0.9,
    bloom: { strength: 0.26, radius: 0.45, threshold: 1.45 },
    aberration: 0.0007,
    vignette: 0.42,
    saturation: 0.74,
    contrast: 1.06,
    grain: 0.05,
    split: 0.22,
    lift: 0.03,
    shadow: GRADE.zone7Shadow,
    highlight: GRADE.zone7Highlight,
    hit: ZONE7.magenta,
  },
  /** References 01 to 03: low-key clinical black-teal, acid-green rim, light haze. */
  hive: {
    exposure: 0.85,
    environment: 0.4,
    bloom: { strength: 0.7, radius: 0.4, threshold: 0.6 },
    aberration: 0.001,
    vignette: 0.6,
    saturation: 1.0,
    contrast: 1.12,
    grain: 0.025,
    split: 0.25,
    lift: 0,
    shadow: GRADE.hiveShadow,
    highlight: GRADE.hiveHighlight,
    hit: HIVE.danger,
  },
} satisfies Record<string, GradePreset>;

/**
 * Exposure scale per zone on top of the raid grade: the night zones use the grade as tuned, the Ochre Reach is a
 * daylight desert and would wash out at night exposure.
 */
export const ZONE_EXPOSURE: Record<string, number> = { ochreReach: 0.86 };
