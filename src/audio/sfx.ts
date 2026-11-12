/**
 * Sound recipes (Audio): weapons, reload beats, impacts, the host's body, gear, extraction, footsteps and the Hive UI.
 * The palette from docs/PLAN.md: wet, chitinous, synthetic, choral. Every recipe draws a little randomness so no
 * two shots or steps are identical, and returns its length in seconds for the voice budget.
 */
import { fm, mtof, noise, tone, voice, type Synth } from './synth';
import type { Weight } from './config';

export type Recipe = (x: Synth, out: AudioNode, t: number) => number;

const max = (...v: number[]) => Math.max(...v);

// ------------------------------------------------------------------ weapons
/** The organic crack every gun shares: a chitin snap plus a wet spray. */
export function snap(x: Synth, out: AudioNode, t: number, freq: number, gain: number, d: number): number {
  return max(
    noise(x, out, t, { gain: gain * 1.5, d: d * 0.5, filters: [{ type: 'bandpass', freq: x.vary(freq), q: 0.8 }] }),
    // The crack: a few milliseconds of bright air.
    noise(x, out, t, { gain: gain * 0.9, d: 0.035, filters: [{ type: 'highpass', freq: 3200 }] }),
    noise(x, out, t, { colour: 'pink', gain: gain * 0.8, a: 0.004, d, filters: [{ type: 'lowpass', freq: freq * 1.5, to: freq * 0.3, over: d }] }),
  );
}
export function thump(x: Synth, out: AudioNode, t: number, from: number, to: number, gain: number, d: number): number {
  return tone(x, out, t, { freq: x.vary(from, 0.05), to: Math.max(to, 50), glide: d * 0.6, gain: gain * 0.6, d });
}

/** One shot per weapon class (data/weapon-feel.json `fire` keys). `ego` is the charged Ego shot. */
export const FIRE: Record<string, (x: Synth, out: AudioNode, t: number, ego: boolean) => number> = {
  // Quillet, Marrow Hand: a sharp, dry bone snap.
  sidearm: (x, o, t) => max(snap(x, o, t, 2600, 0.7, 0.14), thump(x, o, t, 180, 60, 0.6, 0.12), fm(x, o, t, { freq: x.vary(1900), ratio: 2.7, index: 3, gain: 0.08, d: 0.06 })),
  // Hive Spitter, Stinger Choir: rapid wet spits with an insect buzz.
  smg: (x, o, t) => max(snap(x, o, t, 3200, 0.45, 0.08), tone(x, o, t, { type: 'square', freq: x.vary(260, 0.1), to: 120, gain: 0.08, d: 0.05, filters: [{ type: 'lowpass', freq: 1800 }] }), thump(x, o, t, 140, 55, 0.35, 0.07)),
  // Synapse Burster: a neural zap riding on a chitin crack.
  carbine: (x, o, t, ego) => max(
    snap(x, o, t, 2200, ego ? 1 : 0.6, ego ? 0.35 : 0.13),
    tone(x, o, t, { type: 'sawtooth', freq: x.vary(ego ? 900 : 1500, 0.06), to: ego ? 80 : 180, gain: ego ? 0.3 : 0.14, d: ego ? 0.5 : 0.09, filters: [{ type: 'lowpass', freq: 4000, to: 600, over: 0.1 }] }),
    thump(x, o, t, ego ? 160 : 150, 45, ego ? 0.9 : 0.5, ego ? 0.4 : 0.1),
    ego ? voice(x, o, t, { freq: 110, to: 55, vowel: 'a', toVowel: 'u', gain: 0.35, a: 0.01, hold: 0.1, r: 0.8, breath: 0.2 }) : 0,
  ),
  // Vertebra Rifle, Cicadine: heavier crack with a rattle of vertebrae.
  rifle: (x, o, t) => max(snap(x, o, t, 1800, 0.8, 0.2), thump(x, o, t, 120, 40, 0.75, 0.16), noise(x, o, t + 0.02, { gain: 0.18, d: 0.12, filters: [{ type: 'bandpass', freq: 4200, q: 6 }] })),
  // Gullet Scatter, Bloomcannon: a wet gut-boom.
  shotgun: (x, o, t) => max(snap(x, o, t, 900, 0.9, 0.35), thump(x, o, t, 90, 30, 1, 0.3), noise(x, o, t, { colour: 'brown', gain: 0.5, a: 0.01, d: 0.4, filters: [{ type: 'lowpass', freq: 500 }] })),
  // Eyestalk Marksman: crack with a long glassy tail.
  marksman: (x, o, t) => max(snap(x, o, t, 2000, 0.9, 0.3), thump(x, o, t, 110, 35, 0.8, 0.2), fm(x, o, t, { freq: 620, ratio: 3.01, index: 2, gain: 0.07, d: 0.8 })),
  // Leviathan Quill: the biggest crack in the game, rolling off the hills.
  sniper: (x, o, t) => max(snap(x, o, t, 1500, 1, 0.5), thump(x, o, t, 90, 28, 1, 0.45), noise(x, o, t + 0.05, { colour: 'brown', gain: 0.35, a: 0.05, d: 1.4, filters: [{ type: 'lowpass', freq: 400, to: 120, over: 1.4 }] })),
  // Brood Mortar, Tumor Launcher: a hollow gloop.
  launcher: (x, o, t) => max(thump(x, o, t, 220, 50, 0.9, 0.3), noise(x, o, t, { colour: 'pink', gain: 0.5, a: 0.01, d: 0.25, filters: [{ type: 'bandpass', freq: 400, to: 180, q: 3, over: 0.25 }] }), tone(x, o, t + 0.05, { freq: 300, to: 700, gain: 0.12, d: 0.15, glide: 0.12 })),
  // Lumen Lance: charged light, a falling choir-whine.
  beam: (x, o, t, ego) => max(tone(x, o, t, { type: 'sawtooth', freq: 1400, to: 300, gain: 0.25, d: ego ? 0.9 : 0.5, filters: [{ type: 'bandpass', freq: 1800, q: 2 }] }), fm(x, o, t, { freq: 880, ratio: 1.5, index: 4, gain: 0.18, d: 0.6 }), snap(x, o, t, 3000, 0.4, 0.1)),
  // Reliquary Hymn, Coreburner: a sung blast.
  relic: (x, o, t) => max(voice(x, o, t, { freq: x.vary(147, 0.04), to: 98, vowel: 'o', toVowel: 'a', gain: 0.5, a: 0.01, hold: 0.05, r: 0.6 }), thump(x, o, t, 110, 40, 0.8, 0.3), snap(x, o, t, 1600, 0.6, 0.2)),
};

/** A far-off shot as heard by a creature or a rival (dull, with a long tail). */
export const distantShot: Recipe = (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.5, d: 0.5, filters: [{ type: 'lowpass', freq: 600, to: 150, over: 0.5 }] }), thump(x, o, t, 90, 35, 0.4, 0.3));

/** Dry click when the gun is empty or the trigger is denied. */
export const dryClick: Recipe = (x, o, t) => noise(x, o, t, { gain: 0.25, d: 0.03, filters: [{ type: 'bandpass', freq: 3000, q: 8 }] });

// ------------------------------------------------------------------ reload beats (weapon-feel.json `cue` strings)
export const RELOAD_CUES: Record<string, Recipe> = {
  'wet squelch': (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.35, a: 0.01, d: 0.18, filters: [{ type: 'bandpass', freq: 700, to: 1600, q: 4, over: 0.15 }] }), tone(x, o, t, { freq: 180, to: 320, gain: 0.08, d: 0.12 })),
  rip: (x, o, t) => max(noise(x, o, t, { gain: 0.4, a: 0.005, d: 0.22, filters: [{ type: 'highpass', freq: 900 }, { type: 'bandpass', freq: 2400, to: 1200, q: 1.5, over: 0.2 }] }), noise(x, o, t + 0.06, { colour: 'pink', gain: 0.25, d: 0.1, filters: [{ type: 'lowpass', freq: 800 }] })),
  suck: (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.3, a: 0.12, d: 0.08, filters: [{ type: 'bandpass', freq: 300, to: 1400, q: 5, over: 0.2 }] }), tone(x, o, t + 0.15, { freq: 400, to: 900, gain: 0.08, d: 0.06 })),
  'click of chitin': (x, o, t) => max(fm(x, o, t, { freq: 2100, ratio: 1.41, index: 3, gain: 0.18, d: 0.05 }), noise(x, o, t + 0.04, { gain: 0.2, d: 0.03, filters: [{ type: 'bandpass', freq: 3500, q: 6 }] })),
  'jaw creak': (x, o, t) => {
    let l = 0;
    for (let i = 0; i < 6; i++) l = max(l, noise(x, o, t + i * 0.035, { gain: 0.14, d: 0.02, filters: [{ type: 'bandpass', freq: x.vary(900 + i * 60), q: 12 }] }) + i * 0.035);
    return l;
  },
  gulp: (x, o, t) => max(tone(x, o, t, { freq: 140, to: 70, gain: 0.35, d: 0.14 }), noise(x, o, t, { colour: 'pink', gain: 0.2, a: 0.01, d: 0.1, filters: [{ type: 'bandpass', freq: 500, to: 250, q: 4 }] })),
  'soft clack': (x, o, t) => fm(x, o, t, { freq: 1300, ratio: 1.7, index: 2, gain: 0.15, d: 0.05 }),
  'low hum': (x, o, t) => tone(x, o, t, { type: 'triangle', freq: 82, to: 98, gain: 0.25, a: 0.15, hold: 0.35, d: 0.3, vibrato: { rate: 6, depth: 20 } }),
  heartbeat: (x, o, t) => max(heartbeat(x, o, t, 0.5), heartbeat(x, o, t + 0.55, 0.4)),
  exhale: (x, o, t) => noise(x, o, t, { colour: 'pink', gain: 0.25, a: 0.06, d: 0.45, filters: [{ type: 'bandpass', freq: 900, to: 500, q: 1.2, over: 0.5 }] }),
};

// ------------------------------------------------------------------ impacts and the host
export function heartbeat(x: Synth, o: AudioNode, t: number, gain: number): number {
  // Low enough to feel, with a muffled 'lub-dub' body small speakers can still play.
  const beat = (at: number, g: number, f: number) => max(
    tone(x, o, at, { freq: f, to: f * 0.6, gain: g, d: 0.16, glide: 0.1 }),
    noise(x, o, at, { colour: 'pink', gain: g * 0.5, a: 0.01, d: 0.1, filters: [{ type: 'bandpass', freq: 170, q: 1.5 }] }),
  );
  return max(beat(t, gain, 90), beat(t + 0.17, gain * 0.7, 80) + 0.17);
}

export const fleshHit: Recipe = (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.55, d: 0.12, filters: [{ type: 'bandpass', freq: x.vary(600, 0.2), q: 1.5 }] }), tone(x, o, t, { freq: 160, to: 70, gain: 0.25, d: 0.08 }));
export const weakHit: Recipe = (x, o, t) => max(fleshHit(x, o, t), noise(x, o, t, { gain: 0.35, d: 0.09, filters: [{ type: 'highpass', freq: 2500 }] }), tone(x, o, t + 0.01, { freq: 900, to: 300, gain: 0.12, d: 0.12 }));
export const killBurst: Recipe = (x, o, t) => max(
  noise(x, o, t, { colour: 'pink', gain: 0.75, a: 0.004, d: 0.5, filters: [{ type: 'lowpass', freq: 1800, to: 300, over: 0.5 }] }),
  tone(x, o, t, { freq: 110, to: 35, gain: 0.6, d: 0.35 }),
  // Gristle pattering down after the burst.
  ...[0.12, 0.2, 0.31, 0.45].map((d) => noise(x, o, t + d * x.vary(1, 0.2), { colour: 'pink', gain: 0.12, d: 0.05, filters: [{ type: 'bandpass', freq: x.range(500, 1400), q: 3 }] }) + d),
);
/** Non-positional hit confirmation (the hit-marker's sound). */
export const hitTick = (weak: boolean): Recipe => (x, o, t) => weak
  ? max(fm(x, o, t, { freq: 1760, ratio: 2, index: 1.5, gain: 0.22, d: 0.12 }), fm(x, o, t + 0.03, { freq: 2637, ratio: 2, index: 1, gain: 0.12, d: 0.1 }) + 0.03)
  : fm(x, o, t, { freq: 1320, ratio: 2, index: 1.2, gain: 0.12, d: 0.06 });

export const hurt = (heavy: boolean): Recipe => (x, o, t) => max(
  noise(x, o, t, { colour: 'brown', gain: heavy ? 0.9 : 0.6, a: 0.002, d: heavy ? 0.4 : 0.22, filters: [{ type: 'lowpass', freq: 700 }] }),
  tone(x, o, t, { freq: 90, to: 40, gain: heavy ? 0.7 : 0.45, d: 0.25 }),
  // A wet gasp from the host's throat.
  voice(x, o, t + 0.05, { freq: x.vary(heavy ? 120 : 150, 0.08), to: 95, vowel: 'a', toVowel: 'o', gain: 0.12, a: 0.01, r: 0.25, breath: 0.6, formantShift: 0.85 }) + 0.05,
);
export const overloadHit: Recipe = (x, o, t) => max(tone(x, o, t, { freq: 6200, gain: 0.08, a: 0.05, hold: 1.2, d: 1.6 }), noise(x, o, t, { gain: 0.3, d: 0.6, filters: [{ type: 'bandpass', freq: 2000, to: 300, q: 2, over: 0.6 }] }));
export const heal: Recipe = (x, o, t) => max(...[0, 0.08, 0.16].map((d, i) => fm(x, o, t + d, { freq: mtof(74 + [0, 5, 9][i]), ratio: 2.0, index: 0.6, gain: 0.07, a: 0.04, d: 0.9 }) + d), noise(x, o, t, { colour: 'pink', gain: 0.08, a: 0.2, d: 0.6, filters: [{ type: 'bandpass', freq: 2500, q: 1 }] }));
export const pickup: Recipe = (x, o, t) => max(tone(x, o, t, { freq: x.vary(300, 0.1), to: 520, gain: 0.2, d: 0.09, glide: 0.06 }), noise(x, o, t, { colour: 'pink', gain: 0.15, d: 0.08, filters: [{ type: 'bandpass', freq: 900, q: 3 }] }));
export const dnaChime: Recipe = (x, o, t) => max(...[0, 0.06, 0.12].map((d, i) => fm(x, o, t + d, { freq: mtof(86 + [0, 3, 7][i]), ratio: 3.5, index: 0.8, gain: 0.08, d: 0.5 }) + d));
export const cavityFull: Recipe = (x, o, t) => max(tone(x, o, t, { type: 'triangle', freq: 220, to: 160, gain: 0.18, d: 0.18 }), tone(x, o, t + 0.12, { type: 'triangle', freq: 165, to: 120, gain: 0.15, d: 0.2 }) + 0.12);
export const membraneTear: Recipe = (x, o, t) => max(RELOAD_CUES.rip(x, o, t), RELOAD_CUES['wet squelch'](x, o, t + 0.12) + 0.12, noise(x, o, t + 0.1, { colour: 'pink', gain: 0.18, a: 0.2, d: 0.6, filters: [{ type: 'bandpass', freq: 400, q: 2 }] }) + 0.1);
export const harvest: Recipe = (x, o, t) => {
  let l = 0;
  for (let i = 0; i < 5; i++) l = max(l, RELOAD_CUES['wet squelch'](x, o, t + i * x.range(0.18, 0.3)) + i * 0.3);
  return l;
};
export const injectStart: Recipe = (x, o, t) => max(noise(x, o, t, { gain: 0.25, a: 0.02, d: 0.35, filters: [{ type: 'highpass', freq: 5000 }] }), tone(x, o, t + 0.1, { type: 'sawtooth', freq: 110, to: 330, gain: 0.08, a: 0.3, d: 0.8, glide: 1.1, filters: [{ type: 'lowpass', freq: 1200 }] }) + 0.1);
export const injectCancel: Recipe = (x, o, t) => tone(x, o, t, { type: 'sawtooth', freq: 300, to: 80, gain: 0.1, d: 0.4, filters: [{ type: 'lowpass', freq: 900 }] });
/** The virus takes hold: a choir swells while the arm grows. */
export const mutation: Recipe = (x, o, t) => max(
  ...[50, 57, 62, 65].map((m, i) => voice(x, o, t + i * 0.05, { freq: mtof(m), vowel: 'u', toVowel: 'a', gain: 0.12, a: 0.6, hold: 0.4, r: 1.6, vibrato: 14 }) + i * 0.05),
  RELOAD_CUES.heartbeat(x, o, t + 0.3) + 0.3,
  noise(x, o, t, { colour: 'pink', gain: 0.2, a: 0.5, d: 1, filters: [{ type: 'bandpass', freq: 300, to: 1200, q: 2, over: 1.4 }] }),
);
export const ability: Recipe = (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.35, a: 0.06, d: 0.4, filters: [{ type: 'bandpass', freq: 400, to: 2400, q: 2, over: 0.35 }] }), fm(x, o, t + 0.05, { freq: 330, ratio: 1.5, index: 3, gain: 0.12, d: 0.6 }) + 0.05);
export const denied: Recipe = (x, o, t) => tone(x, o, t, { type: 'square', freq: 140, gain: 0.08, d: 0.12, filters: [{ type: 'lowpass', freq: 800 }] });
export const meleeSwing: Recipe = (x, o, t) => noise(x, o, t, { gain: 0.3, a: 0.04, d: 0.18, filters: [{ type: 'bandpass', freq: 600, to: 2400, q: 1.5, over: 0.18 }] });
export const meleeHit: Recipe = (x, o, t) => max(meleeSwing(x, o, t), fleshHit(x, o, t + 0.08) + 0.08, tone(x, o, t + 0.08, { freq: 120, to: 45, gain: 0.6, d: 0.2 }) + 0.08);
export const throwGear: Recipe = (x, o, t) => noise(x, o, t, { gain: 0.22, a: 0.08, d: 0.25, filters: [{ type: 'bandpass', freq: 500, to: 1500, q: 2, over: 0.3 }] });
export const explosion: Recipe = (x, o, t) => max(
  noise(x, o, t, { colour: 'brown', gain: 1, a: 0.003, d: 1.6, filters: [{ type: 'lowpass', freq: 1400, to: 90, over: 1.4 }] }),
  noise(x, o, t, { gain: 0.6, d: 0.25, filters: [{ type: 'highpass', freq: 1500 }] }),
  tone(x, o, t, { freq: 70, to: 24, gain: 1, d: 1 }),
  ...[0.3, 0.5, 0.75, 1].map((d) => noise(x, o, t + d, { colour: 'pink', gain: 0.1, d: 0.08, filters: [{ type: 'bandpass', freq: x.range(400, 1200), q: 2 }] }) + d),
);
export const revive: Recipe = (x, o, t) => max(RELOAD_CUES.heartbeat(x, o, t), RELOAD_CUES.heartbeat(x, o, t + 1.1) + 1.1, voice(x, o, t + 0.5, { freq: 98, to: 196, vowel: 'o', toVowel: 'a', gain: 0.2, a: 1, r: 1, breath: 0.4 }) + 0.5);

// ------------------------------------------------------------------ extraction and raid beats
/** A Seed Spire opens somewhere: a far choir call. */
export const spireCall: Recipe = (x, o, t) => max(...[62, 69, 74].map((m, i) => voice(x, o, t + i * 0.4, { freq: mtof(m), vowel: 'o', toVowel: 'a', gain: 0.25, a: 0.8, hold: 0.8, r: 2.4, vibrato: 10 }) + i * 0.4));
/** The extraction channel: rising light over `seconds`. */
export const extractRiser = (seconds: number): Recipe => (x, o, t) => max(
  noise(x, o, t, { colour: 'pink', gain: 0.3, a: seconds * 0.9, d: 0.3, filters: [{ type: 'bandpass', freq: 200, to: 3500, q: 3, over: seconds }] }),
  tone(x, o, t, { type: 'sawtooth', freq: 55, to: 220, glide: seconds, gain: 0.12, a: seconds * 0.8, d: 0.4, filters: [{ type: 'lowpass', freq: 900 }] }),
  tone(x, o, t, { freq: 440, to: 880, glide: seconds, gain: 0.05, a: seconds * 0.9, d: 0.3, vibrato: { rate: 7, depth: 30 } }),
);
export const extractDone: Recipe = (x, o, t) => max(...[50, 57, 62, 66, 69, 74].map((m, i) => voice(x, o, t + i * 0.03, { freq: mtof(m), vowel: 'a', gain: 0.13, a: 0.08, hold: 0.8, r: 3, vibrato: 8 }) + i * 0.03), noise(x, o, t, { gain: 0.3, d: 1.5, filters: [{ type: 'highpass', freq: 3000 }] }));
export const death: Recipe = (x, o, t) => max(
  hurt(true)(x, o, t),
  ...[45, 46, 52].map((m) => voice(x, o, t + 0.3, { freq: mtof(m), to: mtof(m - 12), vowel: 'a', toVowel: 'u', gain: 0.15, a: 0.3, hold: 1, r: 3, vibrato: 4 }) + 0.3),
  tone(x, o, t + 0.2, { freq: 50, to: 20, gain: 0.7, d: 3 }) + 0.2,
);
export const dropIn: Recipe = (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.5, a: 1.5, d: 1.2, filters: [{ type: 'bandpass', freq: 300, to: 1500, q: 0.8, over: 2.5 }] }), tone(x, o, t, { freq: 40, to: 60, gain: 0.4, a: 1.5, d: 1.5 }));
export const collapseHorn: Recipe = (x, o, t) => max(
  ...[38, 39, 45].map((m) => voice(x, o, t, { freq: mtof(m), vowel: 'o', toVowel: 'u', gain: 0.3, a: 1.2, hold: 1.5, r: 2.5, vibrato: 3, type: 'sawtooth' })),
  noise(x, o, t, { colour: 'brown', gain: 0.4, a: 1, d: 3, filters: [{ type: 'lowpass', freq: 200 }] }),
);
export const nestPulse: Recipe = (x, o, t) => max(heartbeat(x, o, t, 0.8), heartbeat(x, o, t + 0.8, 0.7) + 0.8, noise(x, o, t, { colour: 'pink', gain: 0.35, a: 0.4, d: 1.4, filters: [{ type: 'bandpass', freq: 250, q: 3 }] }));
export const nestCollapse: Recipe = (x, o, t) => max(killBurst(x, o, t), noise(x, o, t + 0.2, { colour: 'brown', gain: 0.7, a: 0.1, d: 2, filters: [{ type: 'lowpass', freq: 500, to: 80, over: 2 }] }) + 0.2, tone(x, o, t, { freq: 80, to: 25, gain: 0.7, d: 1.5 }));
/** A creature bursting out (tank, disguise or out of the ground). */
export const burst = (how: 'hatch' | 'disguise' | 'ambush'): Recipe => (x, o, t) => max(
  how === 'hatch' ? fm(x, o, t, { freq: 1900, ratio: 2.76, index: 5, gain: 0.35, d: 0.6 }) : 0,
  how === 'disguise' ? noise(x, o, t, { gain: 0.4, d: 0.25, filters: [{ type: 'bandpass', freq: 1800, q: 4 }] }) : 0,
  // Earth or sand pouring off the body.
  how === 'ambush' ? noise(x, o, t, { colour: 'pink', gain: 0.55, a: 0.02, d: 1.1, filters: [{ type: 'bandpass', freq: 2200, to: 700, q: 0.8, over: 1 }] }) : 0,
  noise(x, o, t, { colour: 'brown', gain: 0.6, a: 0.005, d: 0.5, filters: [{ type: 'lowpass', freq: 600 }] }),
  membraneTear(x, o, t + 0.05) + 0.05,
);

// ------------------------------------------------------------------ footsteps
export type Surface = 'moss' | 'stone' | 'metal' | 'sand' | 'flesh' | 'water';

export function footstep(x: Synth, o: AudioNode, t: number, surface: Surface, weight: Weight, level: number): number {
  const deep = weight === 'heavy' ? 0.7 : weight === 'light' ? 1.35 : 1;
  const g = level;
  const body = tone(x, o, t, { freq: x.vary(95 * deep, 0.1), to: 45 * deep, gain: 0.35 * g * (weight === 'heavy' ? 1.6 : 1), d: 0.09 });
  let top = 0;
  switch (surface) {
    case 'moss': top = noise(x, o, t, { colour: 'pink', gain: 0.22 * g, a: 0.008, d: 0.12, filters: [{ type: 'bandpass', freq: x.vary(700 * deep, 0.2), q: 1.4 }] }); break;
    case 'flesh': top = max(noise(x, o, t, { colour: 'pink', gain: 0.25 * g, a: 0.01, d: 0.16, filters: [{ type: 'bandpass', freq: x.vary(500, 0.2), to: 900, q: 3 }] }), tone(x, o, t + 0.03, { freq: 200, to: 320, gain: 0.04 * g, d: 0.08 })); break;
    case 'stone': top = noise(x, o, t, { gain: 0.22 * g, d: 0.06, filters: [{ type: 'bandpass', freq: x.vary(2200 * deep, 0.15), q: 2 }] }); break;
    case 'metal': top = max(noise(x, o, t, { gain: 0.15 * g, d: 0.05, filters: [{ type: 'bandpass', freq: 1800, q: 3 }] }), fm(x, o, t, { freq: x.vary(310 * deep, 0.08), ratio: 2.41, index: 2, gain: 0.08 * g, d: 0.35 })); break;
    // Wading: a slosh and a few drops falling back.
    case 'water': top = max(noise(x, o, t, { gain: 0.28 * g, a: 0.02, d: 0.28, filters: [{ type: 'bandpass', freq: x.vary(1100, 0.2), to: 600, q: 0.9, over: 0.25 }] }), tone(x, o, t + 0.12, { freq: x.range(400, 700), to: x.range(900, 1300), gain: 0.05 * g, d: 0.04, glide: 0.03 }) + 0.12); break;
    case 'sand': top = noise(x, o, t, { gain: 0.2 * g, a: 0.02, d: 0.16, filters: [{ type: 'highpass', freq: 2500 }, { type: 'lowpass', freq: 7000 }] }); break;
  }
  // Heavy hosts clatter: armour plates knock together.
  const plates = weight === 'heavy' ? noise(x, o, t + 0.02, { gain: 0.12 * g, d: 0.05, filters: [{ type: 'bandpass', freq: 3200, q: 5 }] }) : 0;
  return max(body, top, plates);
}

export const jump: Recipe = (x, o, t) => noise(x, o, t, { colour: 'pink', gain: 0.12, a: 0.03, d: 0.15, filters: [{ type: 'bandpass', freq: 1200, q: 1 }] });
export function land(x: Synth, o: AudioNode, t: number, surface: Surface, weight: Weight, fall: number): number {
  const k = Math.min(1.6, 0.5 + fall / 8);
  return max(footstep(x, o, t, surface, weight, k), footstep(x, o, t + 0.04, surface, weight, k * 0.7) + 0.04, tone(x, o, t, { freq: 70, to: 30, gain: 0.3 * k, d: 0.2 }));
}

// ------------------------------------------------------------------ Hive UI
export const uiHover: Recipe = (x, o, t) => max(tone(x, o, t, { freq: x.vary(1800, 0.03), gain: 0.05, d: 0.05 }), noise(x, o, t, { colour: 'pink', gain: 0.03, d: 0.03, filters: [{ type: 'bandpass', freq: 3000, q: 2 }] }));
export const uiClick: Recipe = (x, o, t) => max(tone(x, o, t, { freq: 420, to: 700, gain: 0.18, d: 0.07, glide: 0.04 }), fm(x, o, t + 0.01, { freq: 1240, ratio: 2, index: 0.8, gain: 0.07, d: 0.18 }) + 0.01, noise(x, o, t, { colour: 'pink', gain: 0.08, d: 0.05, filters: [{ type: 'bandpass', freq: 900, q: 3 }] }));
export const uiTab: Recipe = (x, o, t) => max(noise(x, o, t, { colour: 'pink', gain: 0.14, a: 0.04, d: 0.18, filters: [{ type: 'bandpass', freq: 600, to: 1800, q: 1.6, over: 0.2 }] }), fm(x, o, t + 0.04, { freq: 660, ratio: 1.5, index: 1, gain: 0.05, d: 0.3 }) + 0.04);
export const uiDeploy: Recipe = (x, o, t) => max(spireCall(x, o, t), dropIn(x, o, t + 0.4) + 0.4, heartbeat(x, o, t, 0.5));
export const uiError: Recipe = (x, o, t) => max(denied(x, o, t), denied(x, o, t + 0.1) + 0.1);
