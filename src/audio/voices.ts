/**
 * Creature and boss voices (Audio). Each species has its own vocabulary so you can tell what is hunting you before
 * you see it: idle (unaware), hunt (alerted or chasing), attack, death. Unknown species (new zones) get the generic
 * set until they are given their own. Bosses: the Reliquary sings, the Pale Vigil is silent until it shrieks.
 */
import { fm, noise, tone, voice, type Synth } from './synth';
import { killBurst, membraneTear, heartbeat, type Recipe } from './sfx';

const max = (...v: number[]) => Math.max(...v);

export interface SpeciesVoice { idle: Recipe; hunt: Recipe; attack: Recipe; death: Recipe; step?: Recipe }

/** Rapid chitin ticks: the sound of something many-jointed. */
function chitter(x: Synth, o: AudioNode, t: number, n: number, freq: number, gain: number, gap = 0.028): number {
  let l = 0;
  for (let i = 0; i < n; i++) {
    const at = i * gap * x.vary(1, 0.35);
    l = max(l, noise(x, o, t + at, { gain: gain * x.vary(1, 0.3), d: 0.012, filters: [{ type: 'bandpass', freq: x.vary(freq, 0.25), q: 9 }] }) + at);
  }
  return l;
}
function hiss(x: Synth, o: AudioNode, t: number, gain: number, d: number, freq = 3500): number {
  return noise(x, o, t, { gain, a: d * 0.3, d: d * 0.7, filters: [{ type: 'highpass', freq }, { type: 'lowpass', freq: freq * 3 }] });
}
function growl(x: Synth, o: AudioNode, t: number, freq: number, gain: number, d: number, vowel: 'a' | 'o' | 'u' = 'o'): number {
  return voice(x, o, t, { freq: x.vary(freq, 0.08), to: freq * 0.7, vowel, toVowel: 'u', gain, a: 0.05, hold: d * 0.4, r: d * 0.6, vibrato: 40, breath: 0.5, formantShift: 0.6, type: 'sawtooth' });
}
/** Wind whistling through a ribcage the size of a building (the Reliquary's tell). */
export const ribWind: Recipe = (x, o, t) => max(...[310, 460, 690, 1030].map((f, i) => noise(x, o, t + i * 0.2, { colour: 'pink', gain: 0.12, a: 1.5, d: 2.5, filters: [{ type: 'bandpass', freq: x.vary(f, 0.05), to: x.vary(f * 1.12, 0.05), q: 35, over: 4 }] }) + i * 0.2));
function splash(x: Synth, o: AudioNode, t: number, gain: number): number {
  return max(noise(x, o, t, { gain, a: 0.005, d: 0.5, filters: [{ type: 'bandpass', freq: 1400, to: 600, q: 0.7, over: 0.4 }] }), ...[0.15, 0.3, 0.42].map((d) => tone(x, o, t + d, { freq: x.range(300, 600), to: x.range(800, 1200), gain: gain * 0.25, d: 0.05, glide: 0.04 }) + d));
}
const EMITTERS_CREAK: Recipe = (x, o, t) => { let l = 0; const f = x.range(200, 500); for (let i = 0; i < 10; i++) l = max(l, noise(x, o, t + i * 0.05, { gain: 0.12, d: 0.03, filters: [{ type: 'bandpass', freq: f * (1 + i * 0.03), q: 15 }] }) + i * 0.05); return l; };
function croak(x: Synth, o: AudioNode, t: number, gain: number): number {
  return max(tone(x, o, t, { type: 'sawtooth', freq: 42, to: 34, gain: gain * 0.5, d: 0.5, filters: [{ type: 'lowpass', freq: 400 }], vibrato: { rate: 28, depth: 60 } }), noise(x, o, t, { colour: 'brown', gain: gain * 0.4, a: 0.02, d: 0.4, filters: [{ type: 'bandpass', freq: 180, q: 2 }] }));
}
function splashBig(x: Synth, o: AudioNode, t: number): number {
  return max(splash(x, o, t, 0.9), noise(x, o, t, { colour: 'brown', gain: 0.7, d: 1.2, filters: [{ type: 'lowpass', freq: 500 }] }));
}
function heavyStep(x: Synth, o: AudioNode, t: number, gain: number): number {
  return max(tone(x, o, t, { freq: 55, to: 28, gain, d: 0.3 }), noise(x, o, t, { colour: 'brown', gain: gain * 0.6, d: 0.25, filters: [{ type: 'lowpass', freq: 300 }] }));
}

export const SPECIES: Record<string, SpeciesVoice> = {
  // Pack stalker: chitter and needle-teeth hiss. Fast clicking means it has your scent.
  needlemaw: {
    idle: (x, o, t) => chitter(x, o, t, 6, 2600, 0.25, 0.05),
    hunt: (x, o, t) => max(chitter(x, o, t, 14, 3000, 0.35), hiss(x, o, t + 0.3, 0.2, 0.5) + 0.3),
    attack: (x, o, t) => max(hiss(x, o, t, 0.45, 0.35, 2500), growl(x, o, t, 260, 0.25, 0.35, 'a')),
    death: (x, o, t) => max(killBurst(x, o, t), voice(x, o, t, { freq: 520, to: 140, vowel: 'i', toVowel: 'u', gain: 0.25, a: 0.01, r: 0.6, vibrato: 60, breath: 0.4 })),
  },
  // Bile Cantor: sings through its pustules, a wet warbling song.
  bilecantor: {
    idle: (x, o, t) => voice(x, o, t, { freq: x.range(180, 260), to: x.range(150, 300), vowel: 'u', toVowel: 'o', gain: 0.2, a: 0.4, hold: 0.6, r: 0.8, vibrato: 50, breath: 0.2 }),
    hunt: (x, o, t) => max(voice(x, o, t, { freq: 330, to: 220, vowel: 'o', toVowel: 'a', gain: 0.3, a: 0.2, hold: 0.5, r: 0.6, vibrato: 90 }), voice(x, o, t + 0.1, { freq: 349, to: 233, vowel: 'u', toVowel: 'a', gain: 0.2, a: 0.2, hold: 0.5, r: 0.6, vibrato: 70 }) + 0.1),
    attack: (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.5, a: 0.04, d: 0.35, filters: [{ type: 'bandpass', freq: 500, to: 1500, q: 3, over: 0.2 }] }), tone(x, o, t, { freq: 220, to: 600, gain: 0.15, d: 0.2 })),
    death: (x, o, t) => max(killBurst(x, o, t), voice(x, o, t, { freq: 300, to: 60, vowel: 'a', toVowel: 'u', gain: 0.3, a: 0.02, r: 1.6, vibrato: 30 })),
  },
  // Glasswalker: crystal legs that chime and grind as it walks.
  glasswalker: {
    idle: (x, o, t) => max(...[0, 0.2, 0.45].map((d) => fm(x, o, t + d, { freq: x.range(1800, 3400), ratio: 2.76, index: 1.5, gain: 0.08, d: 1.2 }) + d)),
    hunt: (x, o, t) => max(noise(x, o, t, { gain: 0.25, a: 0.05, d: 0.5, filters: [{ type: 'bandpass', freq: 5200, q: 10 }] }), ...[0, 0.1, 0.2, 0.3].map((d) => fm(x, o, t + d, { freq: x.range(2200, 4200), ratio: 3.17, index: 3, gain: 0.1, d: 0.5 }) + d)),
    attack: (x, o, t) => max(noise(x, o, t, { gain: 0.5, d: 0.25, filters: [{ type: 'highpass', freq: 3000 }] }), fm(x, o, t, { freq: 900, ratio: 3.5, index: 8, gain: 0.25, d: 0.4 })),
    death: (x, o, t) => max(...[0, 0.05, 0.12, 0.2, 0.33, 0.5].map((d) => fm(x, o, t + d, { freq: x.range(1500, 5000), ratio: 2.76, index: 4, gain: 0.18, d: 1.4 }) + d), noise(x, o, t, { gain: 0.5, d: 0.6, filters: [{ type: 'highpass', freq: 2500 }] })),
  },
  // Oculimoth: wingbeat flutter and a piercing screech.
  oculimoth: {
    idle: (x, o, t) => noise(x, o, t, { colour: 'pink', gain: 0.2, a: 0.3, d: 0.8, rate: 0.6, filters: [{ type: 'bandpass', freq: 180, q: 2 }] }),
    hunt: (x, o, t) => max(voice(x, o, t, { freq: 1100, to: 1600, vowel: 'i', toVowel: 'e', gain: 0.3, a: 0.05, hold: 0.4, r: 0.5, vibrato: 120, breath: 0.6, type: 'square' }), hiss(x, o, t, 0.2, 0.8, 5000)),
    attack: (x, o, t) => voice(x, o, t, { freq: 1500, to: 900, vowel: 'i', toVowel: 'a', gain: 0.35, a: 0.01, hold: 0.15, r: 0.3, vibrato: 200, breath: 0.8, type: 'square' }),
    death: (x, o, t) => max(killBurst(x, o, t), voice(x, o, t, { freq: 1600, to: 200, vowel: 'i', toVowel: 'u', gain: 0.3, a: 0.01, r: 0.9, vibrato: 150, type: 'square' })),
  },
  // Mournback: a whale-deep moan. You hear it long before you see it.
  mournback: {
    idle: (x, o, t) => voice(x, o, t, { freq: x.range(48, 62), to: x.range(40, 55), vowel: 'o', toVowel: 'u', gain: 0.45, a: 0.8, hold: 1, r: 1.8, vibrato: 18, breath: 0.3 }),
    hunt: (x, o, t) => max(growl(x, o, t, 75, 0.55, 1.4, 'a'), heavyStep(x, o, t + 0.2, 0.5) + 0.2),
    attack: (x, o, t) => max(growl(x, o, t, 90, 0.7, 0.8, 'a'), noise(x, o, t + 0.3, { colour: 'brown', gain: 0.8, d: 0.6, filters: [{ type: 'lowpass', freq: 400 }] }) + 0.3),
    death: (x, o, t) => max(killBurst(x, o, t), voice(x, o, t, { freq: 70, to: 30, vowel: 'o', toVowel: 'u', gain: 0.6, a: 0.1, hold: 0.6, r: 2.5, vibrato: 12, breath: 0.4 }), heavyStep(x, o, t + 1.2, 0.9) + 1.2),
    step: (x, o, t) => heavyStep(x, o, t, 0.45),
  },
  // Tithe-Weaver: skittering legs and silk pulled tight.
  titheWeaver: {
    idle: (x, o, t) => max(chitter(x, o, t, 10, 1400, 0.15, 0.04), tone(x, o, t + 0.2, { type: 'triangle', freq: x.range(500, 700), to: x.range(800, 1100), gain: 0.05, d: 0.6, glide: 0.5 }) + 0.2),
    hunt: (x, o, t) => max(chitter(x, o, t, 22, 1800, 0.22, 0.025), tone(x, o, t, { type: 'sawtooth', freq: 300, to: 1200, gain: 0.06, d: 0.5, filters: [{ type: 'bandpass', freq: 1500, q: 8 }] })),
    attack: (x, o, t) => max(chitter(x, o, t, 6, 1200, 0.4, 0.015), hiss(x, o, t, 0.3, 0.3)),
    death: (x, o, t) => max(killBurst(x, o, t), chitter(x, o, t, 18, 1000, 0.25, 0.05)),
  },
  // Husk Mimic: dry rattle, then a call that is almost a person.
  huskMimic: {
    idle: (x, o, t) => noise(x, o, t, { gain: 0.08, a: 0.2, d: 0.6, rate: 0.5, filters: [{ type: 'bandpass', freq: 900, q: 4 }] }),
    hunt: (x, o, t) => max(voice(x, o, t, { freq: x.range(150, 180), to: x.range(110, 130), vowel: 'e', toVowel: 'o', gain: 0.22, a: 0.3, hold: 0.4, r: 0.9, vibrato: 25, breath: 0.7, formantShift: 1.08 }), chitter(x, o, t + 0.9, 8, 700, 0.2, 0.06) + 0.9),
    attack: (x, o, t) => max(noise(x, o, t, { gain: 0.4, d: 0.2, filters: [{ type: 'bandpass', freq: 1200, q: 3 }] }), growl(x, o, t, 140, 0.3, 0.5, 'a')),
    death: (x, o, t) => max(killBurst(x, o, t), voice(x, o, t, { freq: 180, to: 90, vowel: 'a', toVowel: 'u', gain: 0.25, a: 0.02, r: 1.4, breath: 0.8, formantShift: 1.05 })),
  },
  // Lumen Grazer: gentle, breathy cooing. The only kind thing in Zone 7.
  lumenGrazer: {
    idle: (x, o, t) => voice(x, o, t, { freq: x.range(90, 120), to: x.range(110, 140), vowel: 'u', gain: 0.18, a: 0.5, hold: 0.4, r: 1, vibrato: 6, breath: 0.5, type: 'triangle' }),
    hunt: (x, o, t) => voice(x, o, t, { freq: 140, to: 220, vowel: 'u', toVowel: 'o', gain: 0.22, a: 0.1, hold: 0.3, r: 0.6, vibrato: 30, breath: 0.6, type: 'triangle' }),
    attack: (x, o, t) => noise(x, o, t, { colour: 'pink', gain: 0.4, a: 0.02, d: 0.3, filters: [{ type: 'lowpass', freq: 600 }] }),
    death: (x, o, t) => max(killBurst(x, o, t), voice(x, o, t, { freq: 160, to: 60, vowel: 'u', gain: 0.25, a: 0.05, r: 2, vibrato: 4, breath: 0.6, type: 'triangle' })),
  },
  // --- Design's new-zone species (dept/design/new-zones). Tells: hiss in the sand, a humming herd, a deep hum,
  // breathing that fills the pit, a choir.
  // Dunewake: a dry hiss racing through the sand towards you.
  dunewake: {
    idle: (x, o, t) => noise(x, o, t, { gain: 0.18, a: 0.4, d: 0.8, filters: [{ type: 'highpass', freq: 2500 }, { type: 'lowpass', freq: 7000 }] }),
    hunt: (x, o, t) => max(noise(x, o, t, { gain: 0.45, a: 0.08, d: 1.1, filters: [{ type: 'bandpass', freq: 2200, to: 6000, q: 1.2, over: 1 }] }), noise(x, o, t, { colour: 'brown', gain: 0.3, a: 0.1, d: 1, filters: [{ type: 'lowpass', freq: 200 }] })),
    attack: (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.55, a: 0.02, d: 1, filters: [{ type: 'bandpass', freq: 2200, to: 700, q: 0.8, over: 1 }] }), hiss(x, o, t, 0.4, 0.4, 2000)),
    death: (x, o, t) => max(killBurst(x, o, t), noise(x, o, t + 0.2, { gain: 0.3, a: 0.3, d: 1.5, filters: [{ type: 'highpass', freq: 3000 }] }) + 0.2),
  },
  // Bristleback: the herd hums a chord; quills whistle when it moves.
  bristleback: {
    idle: (x, o, t) => max(...[0, 4, 7].map((k) => voice(x, o, t, { freq: 98 * Math.pow(2, k / 12), vowel: 'u', gain: 0.1, a: 0.8, hold: 1, r: 1.2, vibrato: 5, type: 'triangle' })), tone(x, o, t + 0.4, { freq: x.range(1800, 2600), to: x.range(2600, 3200), gain: 0.04, d: 0.5, glide: 0.4 }) + 0.4),
    hunt: (x, o, t) => max(...[0, 1, 6].map((k) => voice(x, o, t, { freq: 110 * Math.pow(2, k / 12), vowel: 'o', toVowel: 'a', gain: 0.16, a: 0.2, hold: 0.6, r: 0.6, vibrato: 20 })), ...[0, 0.15, 0.3].map((d) => tone(x, o, t + d, { freq: x.range(2000, 3000), to: x.range(3500, 4500), gain: 0.07, d: 0.3 }) + d)),
    attack: (x, o, t) => max(growl(x, o, t, 120, 0.45, 0.5, 'a'), noise(x, o, t, { gain: 0.3, d: 0.3, filters: [{ type: 'bandpass', freq: 3500, q: 4 }] })),
    death: (x, o, t) => max(killBurst(x, o, t), voice(x, o, t, { freq: 110, to: 55, vowel: 'u', gain: 0.25, a: 0.05, r: 2, vibrato: 6 })),
  },
  // Mistwader: a hum so deep you feel it first.
  mistwader: {
    idle: (x, o, t) => tone(x, o, t, { freq: x.range(38, 46), gain: 0.4, a: 1, hold: 1.2, d: 1.5, vibrato: { rate: 0.8, depth: 25 } }),
    hunt: (x, o, t) => max(tone(x, o, t, { type: 'triangle', freq: 46, to: 58, gain: 0.5, a: 0.4, hold: 0.8, d: 1 }), growl(x, o, t + 0.3, 70, 0.4, 1, 'o') + 0.3),
    attack: (x, o, t) => max(growl(x, o, t, 85, 0.6, 0.7, 'a'), noise(x, o, t + 0.2, { colour: 'brown', gain: 0.6, d: 0.5, filters: [{ type: 'lowpass', freq: 350 }] }) + 0.2),
    death: (x, o, t) => max(killBurst(x, o, t), tone(x, o, t, { freq: 46, to: 20, gain: 0.6, d: 3 })),
    step: (x, o, t) => heavyStep(x, o, t, 0.35),
  },
  // --- Marrow Pit and Weeping Fen species (Design PR #74).
  // Shroudling: wears a dead host's skin. From far off it sounds like one of you: a cough, a step, a whispered word.
  shroudling: {
    idle: (x, o, t) => voice(x, o, t, { freq: x.range(110, 140), vowel: 'e', toVowel: 'a', gain: 0.08, a: 0.05, r: 0.35, breath: 1.4, formantShift: 1.1 }),
    hunt: (x, o, t) => max(voice(x, o, t, { freq: 130, to: 100, vowel: 'o', toVowel: 'e', gain: 0.14, a: 0.2, hold: 0.3, r: 0.6, breath: 1, formantShift: 1.1 }), noise(x, o, t + 0.8, { gain: 0.2, a: 0.1, d: 0.5, rate: 0.5, filters: [{ type: 'bandpass', freq: 800, q: 3 }] }) + 0.8),
    attack: (x, o, t) => max(noise(x, o, t, { gain: 0.45, d: 0.25, filters: [{ type: 'bandpass', freq: 1500, q: 2 }] }), growl(x, o, t, 170, 0.35, 0.45, 'a')),
    death: (x, o, t) => max(killBurst(x, o, t), voice(x, o, t, { freq: 140, to: 70, vowel: 'a', toVowel: 'u', gain: 0.2, a: 0.02, r: 1.2, breath: 1, formantShift: 1.1 })),
  },
  // Cablecrawler: shears snipping, hooked legs ticking along the pit walls.
  cablecrawler: {
    idle: (x, o, t) => chitter(x, o, t, 8, 1100, 0.16, 0.07),
    hunt: (x, o, t) => max(chitter(x, o, t, 16, 1500, 0.24, 0.035), ...[0.5, 0.75].map((d) => fm(x, o, t + d, { freq: 2600, ratio: 1.41, index: 4, gain: 0.14, d: 0.08 }) + d)),
    attack: (x, o, t) => max(...[0, 0.12, 0.24].map((d) => max(noise(x, o, t + d, { gain: 0.35, d: 0.06, filters: [{ type: 'bandpass', freq: 3800, q: 3 }] }), fm(x, o, t + d, { freq: 1900, ratio: 2.41, index: 5, gain: 0.15, d: 0.1 })) + d)),
    death: (x, o, t) => max(killBurst(x, o, t), chitter(x, o, t, 20, 900, 0.22, 0.05)),
  },
  // Veilwing: glides in silence; only the fold and drop make a sound, a sail snapping shut.
  veilwing: {
    idle: (x, o, t) => noise(x, o, t, { colour: 'pink', gain: 0.05, a: 0.8, d: 1, filters: [{ type: 'bandpass', freq: 350, q: 1 }] }),
    hunt: (x, o, t) => noise(x, o, t, { colour: 'pink', gain: 0.1, a: 0.5, d: 0.6, filters: [{ type: 'bandpass', freq: 500, to: 900, q: 1.5, over: 1 }] }),
    attack: (x, o, t) => max(noise(x, o, t, { gain: 0.5, a: 0.005, d: 0.12, filters: [{ type: 'bandpass', freq: 700, q: 1 }] }), noise(x, o, t + 0.1, { colour: 'pink', gain: 0.45, a: 0.3, d: 0.3, filters: [{ type: 'bandpass', freq: 300, to: 2500, q: 1, over: 0.5 }] }) + 0.1),
    death: (x, o, t) => max(killBurst(x, o, t), noise(x, o, t, { colour: 'pink', gain: 0.3, a: 0.05, d: 1.5, filters: [{ type: 'bandpass', freq: 600, to: 200, q: 1, over: 1.5 }] })),
  },
  // Hollowed: hosts who went too deep, worked from inside like a glove. A wrong voice, and roots creaking in the joints.
  hollowed: {
    idle: (x, o, t) => max(voice(x, o, t, { freq: x.range(85, 105), to: x.range(70, 90), vowel: 'o', toVowel: 'u', gain: 0.14, a: 0.6, hold: 0.4, r: 1, vibrato: 3, breath: 0.6 }), EMITTERS_CREAK(x, o, t + 0.6) + 0.6),
    hunt: (x, o, t) => max(voice(x, o, t, { freq: 120, to: 240, vowel: 'a', toVowel: 'i', gain: 0.2, a: 0.3, hold: 0.3, r: 0.5, vibrato: 40, breath: 0.6 }), EMITTERS_CREAK(x, o, t)),
    attack: (x, o, t) => max(growl(x, o, t, 150, 0.35, 0.5, 'a'), noise(x, o, t + 0.1, { gain: 0.6, d: 0.12, filters: [{ type: 'bandpass', freq: 2000, q: 0.8 }] }) + 0.1),
    death: (x, o, t) => max(killBurst(x, o, t), voice(x, o, t, { freq: 110, to: 45, vowel: 'a', toVowel: 'u', gain: 0.25, a: 0.02, r: 2, breath: 0.8 })),
  },
  // Fenstalker: lies under the surface. Bubbles, then the splash.
  fenstalker: {
    idle: (x, o, t) => max(...[0, 0.2, 0.35, 0.6].map((d) => tone(x, o, t + d, { freq: x.range(150, 300), to: x.range(400, 700), gain: 0.1, d: 0.05, glide: 0.04 }) + d)),
    hunt: (x, o, t) => max(splash(x, o, t, 0.5), growl(x, o, t + 0.2, 130, 0.3, 0.6, 'o') + 0.2),
    attack: (x, o, t) => max(splash(x, o, t, 0.8), hiss(x, o, t + 0.1, 0.35, 0.3, 2200) + 0.1),
    death: (x, o, t) => max(killBurst(x, o, t), splash(x, o, t + 0.2, 0.6) + 0.2),
  },
  // Mirebrood: hand-sized lantern spiders. Alone a tick; together a pouring hiss of legs.
  mirebrood: {
    idle: (x, o, t) => chitter(x, o, t, 5, 4200, 0.1, 0.05),
    hunt: (x, o, t) => max(chitter(x, o, t, 30, 4000, 0.16, 0.018), noise(x, o, t, { gain: 0.08, a: 0.2, d: 0.5, filters: [{ type: 'highpass', freq: 5000 }] })),
    attack: (x, o, t) => max(chitter(x, o, t, 4, 3000, 0.3, 0.02), hiss(x, o, t, 0.15, 0.2, 4000)),
    death: (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.3, d: 0.15, filters: [{ type: 'bandpass', freq: 1200, q: 2 }] }), fm(x, o, t, { freq: 2400, ratio: 1.5, index: 1, gain: 0.08, d: 0.3 })),
  },
};

const GENERIC: SpeciesVoice = {
  idle: (x, o, t) => max(chitter(x, o, t, 5, 1600, 0.15, 0.06), growl(x, o, t, 120, 0.12, 0.6, 'u')),
  hunt: (x, o, t) => max(growl(x, o, t, 140, 0.35, 0.8, 'a'), chitter(x, o, t + 0.4, 10, 2000, 0.2) + 0.4),
  attack: (x, o, t) => max(growl(x, o, t, 180, 0.4, 0.4, 'a'), hiss(x, o, t, 0.3, 0.3)),
  death: (x, o, t) => max(killBurst(x, o, t), growl(x, o, t, 160, 0.3, 1, 'a')),
};

export const speciesVoice = (kind: string): SpeciesVoice => SPECIES[kind] ?? GENERIC;

/** Faint fair warning: something is closing in behind you. Very quiet, very close. */
export const stalkWarn: Recipe = (x, o, t) => max(chitter(x, o, t, 4, 2200, 0.1, 0.09), hiss(x, o, t + 0.2, 0.05, 0.6, 4000) + 0.2);

// ------------------------------------------------------------------ bosses
export interface BossVoice { wake: Recipe; phase: Recipe; enrage: Recipe; defeated: Recipe; attacks: Record<string, Recipe>; hurt: Recipe }

const quake = (gain: number): Recipe => (x, o, t) => max(noise(x, o, t, { colour: 'brown', gain, a: 0.005, d: 1.4, filters: [{ type: 'lowpass', freq: 600, to: 60, over: 1.2 }] }), tone(x, o, t, { freq: 55, to: 22, gain, d: 1.1 }));
const lash: Recipe = (x, o, t) => max(noise(x, o, t, { gain: 0.45, a: 0.06, d: 0.2, filters: [{ type: 'bandpass', freq: 800, to: 3200, q: 2, over: 0.2 }] }), membraneTear(x, o, t + 0.15) + 0.15);
/** A cathedral of throats: the Reliquary's hymn. */
const hymn = (gain: number, len: number): Recipe => (x, o, t) => max(...[38, 45, 50, 51, 57].map((m, i) => voice(x, o, t + i * 0.12, { freq: 440 * Math.pow(2, (m - 69) / 12), vowel: i % 2 ? 'o' : 'a', toVowel: 'u', gain: gain * (i === 3 ? 0.6 : 1), a: len * 0.3, hold: len * 0.3, r: len * 0.5, vibrato: 7, breath: 0.15 }) + i * 0.12));
/** The Pale Vigil's shriek: many throats at once, then the ears ring. */
export const shriek: Recipe = (x, o, t) => max(
  ...[1, 1.06, 1.5, 2.1].map((k, i) => voice(x, o, t + i * 0.02, { freq: 520 * k, to: 380 * k, vowel: 'i', toVowel: 'a', gain: 0.3, a: 0.02, hold: 0.7, r: 0.9, vibrato: 140, breath: 0.9, type: i % 2 ? 'square' : 'sawtooth' })),
  noise(x, o, t, { gain: 0.6, a: 0.02, d: 1.4, filters: [{ type: 'bandpass', freq: 3000, to: 1400, q: 1.5, over: 1.4 }] }),
  tone(x, o, t + 0.6, { freq: 7400, gain: 0.05, a: 0.1, hold: 1.5, d: 2.5 }) + 0.6,
);

export const BOSSES: Record<string, BossVoice> = {
  reliquary: {
    wake: (x, o, t) => max(hymn(0.35, 6)(x, o, t), quake(0.6)(x, o, t), ribWind(x, o, t + 1) + 1),
    phase: (x, o, t) => max(growl(x, o, t, 55, 0.9, 1.8, 'a'), quake(0.5)(x, o, t + 0.3) + 0.3),
    enrage: (x, o, t) => max(hymn(0.45, 3)(x, o, t), growl(x, o, t, 70, 0.9, 1.5, 'a')),
    defeated: (x, o, t) => max(hymn(0.3, 8)(x, o, t), voice(x, o, t, { freq: 60, to: 22, vowel: 'a', toVowel: 'u', gain: 0.8, a: 0.1, hold: 1.5, r: 4, breath: 0.4 }), quake(0.9)(x, o, t + 2) + 2),
    hurt: (x, o, t) => growl(x, o, t, 80, 0.35, 0.4, 'a'),
    attacks: {
      stamp: quake(1), sweep: (x, o, t) => max(noise(x, o, t, { gain: 0.5, a: 0.15, d: 0.4, filters: [{ type: 'bandpass', freq: 300, to: 1600, q: 1, over: 0.4 }] }), quake(0.4)(x, o, t + 0.4) + 0.4),
      brood: (x, o, t) => max(membraneTear(x, o, t), chitter(x, o, t + 0.4, 30, 2200, 0.25, 0.03) + 0.4),
      vent: (x, o, t) => noise(x, o, t, { gain: 0.45, a: 0.3, d: 3, filters: [{ type: 'bandpass', freq: 1500, q: 0.6 }] }),
      hymn: hymn(0.5, 2.5),
      coverBreak: (x, o, t) => max(quake(0.8)(x, o, t), ...[0.1, 0.25, 0.4, 0.6].map((d) => noise(x, o, t + d, { gain: 0.3, d: 0.15, filters: [{ type: 'bandpass', freq: x.range(800, 2500), q: 2 }] }) + d)),
      drag: lash, grab: lash,
    },
  },
  paleVigil: {
    // It wakes without a sound. The only tell is a single wet click in the dark.
    wake: (x, o, t) => fm(x, o, t, { freq: 480, ratio: 1.41, index: 2, gain: 0.1, d: 0.3 }),
    phase: shriek,
    enrage: shriek,
    defeated: (x, o, t) => max(shriek(x, o, t), quake(0.8)(x, o, t + 0.8) + 0.8, voice(x, o, t + 1, { freq: 300, to: 40, vowel: 'i', toVowel: 'u', gain: 0.3, a: 0.05, r: 3.5, breath: 0.8 }) + 1),
    hurt: (x, o, t) => hiss(x, o, t, 0.3, 0.4, 2500),
    attacks: {
      drop: (x, o, t) => max(quake(0.9)(x, o, t), membraneTear(x, o, t)),
      grab: (x, o, t) => max(lash(x, o, t), chitter(x, o, t + 0.2, 12, 900, 0.3, 0.04) + 0.2),
      lunge: (x, o, t) => max(hiss(x, o, t, 0.6, 0.3, 2000), growl(x, o, t + 0.15, 200, 0.4, 0.4, 'a') + 0.15),
      rake: (x, o, t) => max(...[0, 0.12].map((d) => noise(x, o, t + d, { gain: 0.5, a: 0.02, d: 0.15, filters: [{ type: 'bandpass', freq: 2400, to: 900, q: 2, over: 0.15 }] }) + d)),
      vanish: (x, o, t) => noise(x, o, t, { colour: 'pink', gain: 0.15, a: 0.4, d: 0.2, filters: [{ type: 'bandpass', freq: 600, to: 3000, q: 2, over: 0.5 }] }),
      // Reappearing behind you: a click and a breath, quiet enough that you have to be listening.
      reappear: (x, o, t) => max(chitter(x, o, t, 3, 1400, 0.18, 0.12), voice(x, o, t + 0.3, { freq: 90, vowel: 'u', gain: 0.06, a: 0.3, r: 0.8, breath: 1 }) + 0.3),
      shriek,
      collapseWarn: (x, o, t) => max(...[0, 0.3, 0.7].map((d) => noise(x, o, t + d, { colour: 'brown', gain: 0.4, a: 0.1, d: 0.5, filters: [{ type: 'lowpass', freq: 250 }] }) + d), chitter(x, o, t, 14, 600, 0.25, 0.08)),
      chunk: quake(0.9),
    },
  },
  // The Sand Widow: mother of the Dunewake. The crater floor heaves where she swims.
  sandwidow: {
    wake: (x, o, t) => max(quake(0.9)(x, o, t), noise(x, o, t, { gain: 0.5, a: 1, d: 2.5, filters: [{ type: 'bandpass', freq: 1500, to: 5000, q: 0.8, over: 3 }] }), growl(x, o, t + 1.5, 48, 0.8, 2.5, 'a') + 1.5),
    phase: (x, o, t) => max(growl(x, o, t, 55, 0.9, 1.6, 'a'), noise(x, o, t, { gain: 0.5, a: 0.3, d: 1.5, filters: [{ type: 'highpass', freq: 2500 }] })),
    enrage: (x, o, t) => growl(x, o, t, 70, 0.9, 1.8, 'a'),
    defeated: (x, o, t) => max(growl(x, o, t, 50, 0.8, 3, 'a'), quake(1)(x, o, t + 1) + 1, noise(x, o, t + 1, { gain: 0.4, a: 1, d: 4, filters: [{ type: 'highpass', freq: 2500 }] }) + 1),
    hurt: (x, o, t) => growl(x, o, t, 90, 0.35, 0.4, 'a'),
    attacks: {},
  },
  // The Nethermaw: breathing that fills the whole pit.
  nethermaw: {
    wake: (x, o, t) => max(noise(x, o, t, { colour: 'brown', gain: 0.8, a: 2, d: 2, filters: [{ type: 'bandpass', freq: 140, to: 260, q: 1, over: 3 }] }), voice(x, o, t + 2, { freq: 40, to: 30, vowel: 'o', toVowel: 'u', gain: 0.7, a: 1, hold: 1.5, r: 2.5, vibrato: 4, breath: 1 }) + 2),
    phase: (x, o, t) => max(...[0, 0.9, 1.8].map((d) => noise(x, o, t + d, { colour: 'brown', gain: 0.7, a: 0.3, d: 0.5, filters: [{ type: 'bandpass', freq: 220, q: 1.4 }] }) + d), growl(x, o, t + 2, 45, 0.8, 2, 'o') + 2),
    enrage: (x, o, t) => growl(x, o, t, 55, 1, 2.5, 'a'),
    defeated: (x, o, t) => max(voice(x, o, t, { freq: 45, to: 22, vowel: 'o', toVowel: 'u', gain: 0.8, a: 0.2, hold: 1, r: 5, breath: 0.8 }), quake(0.9)(x, o, t + 0.5) + 0.5),
    hurt: (x, o, t) => noise(x, o, t, { colour: 'brown', gain: 0.5, a: 0.05, d: 0.5, filters: [{ type: 'bandpass', freq: 260, q: 1.4 }] }),
    attacks: {},
  },
  // The Mire Regent: a barge-sized throat under the black pool. Croaks you feel in your chest.
  mireRegent: {
    wake: (x, o, t) => max(splashBig(x, o, t), ...[0.8, 1.6].map((d) => croak(x, o, t + d, 0.9) + d)),
    phase: (x, o, t) => max(croak(x, o, t, 1), splashBig(x, o, t + 0.4) + 0.4),
    enrage: (x, o, t) => max(croak(x, o, t, 1), croak(x, o, t + 0.5, 1) + 0.5, croak(x, o, t + 1, 1) + 1),
    defeated: (x, o, t) => max(voice(x, o, t, { freq: 50, to: 25, vowel: 'o', toVowel: 'u', gain: 0.8, a: 0.1, hold: 1, r: 3.5, vibrato: 20, breath: 0.6 }), splashBig(x, o, t + 2) + 2),
    hurt: (x, o, t) => croak(x, o, t, 0.4),
    attacks: {},
  },
  // The Hymnal: a cathedral-sized throat strung with vocal cords. Sound is light here, so it is always singing.
  hymnal: {
    wake: (x, o, t) => max(...[50, 57, 62, 66, 69, 74].map((m, i) => voice(x, o, t + i * 0.25, { freq: 440 * Math.pow(2, (m - 69) / 12), vowel: i % 2 ? 'o' : 'a', gain: 0.18, a: 1.5, hold: 2, r: 3, vibrato: 7, breath: 0.2 }) + i * 0.25)),
    phase: (x, o, t) => max(...[62, 63, 69, 70].map((m) => voice(x, o, t, { freq: 440 * Math.pow(2, (m - 69) / 12), to: 440 * Math.pow(2, (m - 64) / 12), vowel: 'a', toVowel: 'i', gain: 0.2, a: 0.6, hold: 0.6, r: 1.5, vibrato: 16 }))),
    enrage: (x, o, t) => max(...[57, 58, 63, 64, 69].map((m) => voice(x, o, t, { freq: 440 * Math.pow(2, (m - 69) / 12), vowel: 'i', toVowel: 'a', gain: 0.2, a: 0.05, hold: 1, r: 1.5, vibrato: 60, breath: 0.5 }))),
    defeated: (x, o, t) => max(...[50, 57, 62].map((m) => voice(x, o, t, { freq: 440 * Math.pow(2, (m - 69) / 12), to: 440 * Math.pow(2, (m - 81) / 12), vowel: 'a', toVowel: 'u', gain: 0.25, a: 0.05, hold: 0.6, r: 4, vibrato: 10 }))),
    hurt: (x, o, t) => voice(x, o, t, { freq: x.range(300, 700), vowel: 'i', gain: 0.15, a: 0.01, r: 0.4, vibrato: 30 }),
    attacks: {},
  },
  // The Bone Tide: a migrating reef. Coral clatter and a slow whale-song across the dry sea floor.
  boneTide: {
    wake: (x, o, t) => max(voice(x, o, t, { freq: 60, to: 90, vowel: 'u', toVowel: 'o', gain: 0.6, a: 1.5, hold: 1.5, r: 3, vibrato: 25, breath: 0.2 }), ...[0.5, 1, 1.5, 2].map((d) => EMITTERS_CREAK(x, o, t + d) + d)),
    phase: (x, o, t) => max(voice(x, o, t, { freq: 80, to: 50, vowel: 'o', toVowel: 'u', gain: 0.7, a: 0.5, hold: 1, r: 2, vibrato: 20 }), quake(0.6)(x, o, t)),
    enrage: (x, o, t) => growl(x, o, t, 60, 0.9, 2, 'a'),
    defeated: (x, o, t) => max(voice(x, o, t, { freq: 70, to: 28, vowel: 'o', toVowel: 'u', gain: 0.8, a: 0.5, hold: 2, r: 5, vibrato: 15 }), quake(1)(x, o, t + 1.5) + 1.5),
    hurt: (x, o, t) => EMITTERS_CREAK(x, o, t),
    attacks: {},
  },
  // Warden of the Long Seed: metal and root, a slow tolling.
  warden: {
    wake: (x, o, t) => max(...[0, 1.8, 3.6].map((d) => fm(x, o, t + d, { freq: 55, ratio: 2.41, index: 6, gain: 0.5, d: 3 }) + d), growl(x, o, t, 50, 0.6, 3, 'o')),
    phase: (x, o, t) => max(fm(x, o, t, { freq: 49, ratio: 3.5, index: 8, gain: 0.6, d: 2.5 }), quake(0.6)(x, o, t)),
    enrage: (x, o, t) => max(growl(x, o, t, 65, 0.8, 1.6, 'a'), fm(x, o, t, { freq: 73, ratio: 2.41, index: 9, gain: 0.5, d: 2 })),
    defeated: (x, o, t) => max(fm(x, o, t, { freq: 41, ratio: 2.41, index: 5, gain: 0.7, d: 6 }), quake(1)(x, o, t + 0.5) + 0.5),
    hurt: (x, o, t) => fm(x, o, t, { freq: x.range(110, 180), ratio: 2.41, index: 4, gain: 0.25, d: 0.6 }),
    attacks: {},
  },
};

const GENERIC_BOSS: BossVoice = {
  wake: (x, o, t) => max(growl(x, o, t, 55, 0.8, 2.5, 'a'), quake(0.6)(x, o, t)),
  phase: (x, o, t) => growl(x, o, t, 65, 0.8, 1.5, 'a'),
  enrage: (x, o, t) => growl(x, o, t, 80, 0.9, 1.5, 'a'),
  defeated: (x, o, t) => max(growl(x, o, t, 60, 0.8, 3, 'a'), quake(0.9)(x, o, t + 1) + 1),
  hurt: (x, o, t) => growl(x, o, t, 90, 0.3, 0.4, 'a'),
  attacks: {},
};
export const bossVoice = (id: string): BossVoice => BOSSES[id] ?? GENERIC_BOSS;
export const bossAttack = (id: string, attack: string): Recipe => bossVoice(id).attacks[attack] ?? GENERIC_BOSS.phase;

// ------------------------------------------------------------------ ambience one-shots (data/audio.json emitters)
export const EMITTERS: Record<string, Recipe> = {
  distantCall: (x, o, t) => {
    const r = x.rand();
    if (r < 0.4) return SPECIES.mournback.idle(x, o, t);
    if (r < 0.7) return voice(x, o, t, { freq: x.range(300, 500), to: x.range(200, 700), vowel: 'u', toVowel: 'o', gain: 0.3, a: 0.4, hold: 0.5, r: 1.5, vibrato: 40, breath: 0.3 });
    return growl(x, o, t, x.range(80, 140), 0.4, 1.6, 'o');
  },
  insect: (x, o, t) => { let l = 0; const f = x.range(3800, 6200); for (let i = 0; i < 8; i++) l = max(l, tone(x, o, t + i * 0.07, { freq: f, gain: 0.08, d: 0.04 }) + i * 0.07); return l; },
  bubble: (x, o, t) => tone(x, o, t, { freq: x.range(180, 420), to: x.range(500, 900), gain: 0.15, d: 0.06, glide: 0.05 }),
  sporeSigh: (x, o, t) => noise(x, o, t, { colour: 'pink', gain: 0.25, a: 1.2, d: 2, filters: [{ type: 'bandpass', freq: x.range(300, 700), q: 2 }] }),
  chime: (x, o, t) => max(...[0, 0.25, 0.6].map((d) => fm(x, o, t + d, { freq: 440 * Math.pow(2, Math.floor(x.range(14, 30)) / 12), ratio: 3.01, index: 0.7, gain: 0.08, d: 2.5 }) + d)),
  drip: (x, o, t) => tone(x, o, t, { freq: x.range(1100, 2200), to: x.range(2400, 3600), gain: 0.18, d: 0.05, glide: 0.03 }),
  creak: (x, o, t) => { let l = 0; const f = x.range(200, 500); for (let i = 0; i < 12; i++) l = max(l, noise(x, o, t + i * 0.05, { gain: 0.15, d: 0.03, filters: [{ type: 'bandpass', freq: f * (1 + i * 0.03), q: 15 }] }) + i * 0.05); return l; },
  whisper: (x, o, t) => voice(x, o, t, { freq: x.range(100, 140), vowel: x.rand() < 0.5 ? 'e' : 'i', toVowel: 'o', gain: 0.04, a: 0.5, hold: 0.3, r: 0.8, breath: 1.4, formantShift: 1.2 }),
  clank: (x, o, t) => max(fm(x, o, t, { freq: x.range(120, 260), ratio: 2.41, index: 5, gain: 0.3, d: 1.8 }), noise(x, o, t, { gain: 0.3, d: 0.08, filters: [{ type: 'bandpass', freq: 1800, q: 2 }] })),
  embryo: (x, o, t) => max(heartbeat(x, o, t, 0.25), tone(x, o, t + 0.5, { freq: x.range(200, 300), to: x.range(500, 700), gain: 0.05, d: 0.25, glide: 0.2 }) + 0.5),
  sandHiss: (x, o, t) => noise(x, o, t, { gain: 0.3, a: 0.5, d: 1.2, filters: [{ type: 'highpass', freq: 3000 }, { type: 'lowpass', freq: 9000 }] }),
  // Something huge moving under the ground.
  croak: (x, o, t) => croak(x, o, t, x.range(0.3, 0.6)),
  splash: (x, o, t) => splash(x, o, t, x.range(0.3, 0.6)),
  rumble: (x, o, t) => max(noise(x, o, t, { colour: 'brown', gain: 0.6, a: 0.8, d: 2.2, filters: [{ type: 'lowpass', freq: 180 }] }), chitter(x, o, t + 1, 8, 500, 0.15, 0.1) + 1),
};
