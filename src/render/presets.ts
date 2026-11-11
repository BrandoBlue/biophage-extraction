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
  shadow: string;
  highlight: string;
  hit: string;
}

export const GRADE_PRESETS = {
  /** Reference 04: saturated cosmic wasteland, heavy bloom on emissives, shadows kept dark. */
  zone7: {
    exposure: 1.0,
    environment: 0.45,
    bloom: { strength: 0.6, radius: 0.35, threshold: 0.95 },
    aberration: 0.0018,
    vignette: 0.45,
    saturation: 1.18,
    contrast: 1.06,
    grain: 0.03,
    split: 0.2,
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
    shadow: GRADE.hiveShadow,
    highlight: GRADE.hiveHighlight,
    hit: HIVE.danger,
  },
} satisfies Record<string, GradePreset>;
