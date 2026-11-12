/**
 * Gun voices (Audio): one signature sound per living weapon in data/weapons.json, and how each graft in
 * data/mods.json changes it. Every gun is built from three layers so it reads in a fight: the crack (a hard transient
 * that cuts through), the body (what the gun is made of: bone, quill, throat, glass, wasp nest) and the aftermath (what
 * the organism does after the shot: quills re-sprout, wing-cases snap shut, a jaw clamps, a throat swallows).
 */
import { fm, mtof, noise, shaper, tone, voice, type Synth } from './synth';
import { RELOAD_CUES, snap } from './sfx';

export type Gun = (x: Synth, o: AudioNode, t: number, ego: boolean) => number;
const max = (...v: number[]) => Math.max(...v);

/** A short, saturated low punch: the chest-hit every good gun sound has. */
function punch(x: Synth, o: AudioNode, t: number, freq: number, gain: number, d: number): number {
  const sh = shaper(x.ctx, 4);
  const g = x.ctx.createGain(); g.gain.value = 0.8;
  sh.connect(g).connect(o);
  return tone(x, sh, t, { freq: x.vary(freq, 0.04), to: freq * 0.35, glide: d * 0.5, gain, d });
}
function ticks(x: Synth, o: AudioNode, t: number, n: number, freq: number, gain: number, gap: number, q = 9): number {
  let l = 0;
  for (let i = 0; i < n; i++) { const at = i * gap * x.vary(1, 0.3); l = max(l, noise(x, o, t + at, { gain: gain * x.vary(1, 0.3), d: 0.012, filters: [{ type: 'bandpass', freq: x.vary(freq, 0.2), q }] }) + at); }
  return l;
}
/** The shot's echo rolling off the land: a dull, delayed copy. */
function rollOff(x: Synth, o: AudioNode, t: number, gain: number, d = 0.9): number {
  return noise(x, o, t + 0.06, { colour: 'brown', gain, a: 0.04, d, filters: [{ type: 'lowpass', freq: 380, to: 110, over: d }] }) + 0.06;
}

export const GUNS: Record<string, Gun> = {
  // The starter spore gun: a neural zap riding a chitin crack; the three eyes blink after each shot.
  synapseBurster: (x, o, t, ego) => max(
    snap(x, o, t, 2200, ego ? 1 : 0.65, ego ? 0.35 : 0.12),
    punch(x, o, t, ego ? 150 : 165, ego ? 0.9 : 0.55, ego ? 0.3 : 0.1),
    tone(x, o, t, { type: 'sawtooth', freq: x.vary(ego ? 900 : 1500, 0.06), to: ego ? 80 : 180, gain: ego ? 0.3 : 0.15, d: ego ? 0.5 : 0.09, filters: [{ type: 'lowpass', freq: 4000, to: 600, over: 0.1 }] }),
    noise(x, o, t + 0.06, { gain: 0.05, d: 0.02, filters: [{ type: 'bandpass', freq: 3500, q: 6 }] }) + 0.06,
    ego ? voice(x, o, t, { freq: 110, to: 55, vowel: 'a', toVowel: 'u', gain: 0.35, a: 0.01, hold: 0.1, r: 0.8, breath: 0.2 }) : 0,
    rollOff(x, o, t, ego ? 0.35 : 0.12),
  ),
  // Quill pistol: a whip-crack 'thwip' as the quill leaves, then the fan rattles as a new one sprouts.
  quillet: (x, o, t) => max(
    noise(x, o, t, { gain: 0.9, d: 0.035, filters: [{ type: 'bandpass', freq: 4200, q: 1.5 }] }),
    tone(x, o, t, { freq: 1900, to: 3600, glide: 0.06, gain: 0.12, d: 0.07 }),
    punch(x, o, t, 190, 0.45, 0.08),
    ticks(x, o, t + 0.12, 5, 3200, 0.12, 0.03) + 0.12,
    rollOff(x, o, t, 0.1, 0.5),
  ),
  // Bone hand-cannon: a joint cracking at the size of a door, then a heavy roll.
  marrowHand: (x, o, t) => max(
    snap(x, o, t, 1400, 1, 0.3),
    punch(x, o, t, 130, 1, 0.28),
    fm(x, o, t, { freq: 900, ratio: 1.41, index: 7, indexDecay: 0.04, gain: 0.3, d: 0.08 }),
    noise(x, o, t + 0.015, { gain: 0.35, d: 0.04, filters: [{ type: 'bandpass', freq: 1700, q: 3 }] }) + 0.015,
    rollOff(x, o, t, 0.45, 1.3),
  ),
  // Wasp-comb spray: an angry buzz with a hot spit on top. Point and hold.
  hiveSpitter: (x, o, t) => max(
    tone(x, o, t, { type: 'square', freq: x.vary(170, 0.08), to: 140, gain: 0.12, d: 0.07, filters: [{ type: 'bandpass', freq: 900, q: 1.2 }], vibrato: { rate: 90, depth: 120 } }),
    noise(x, o, t, { colour: 'pink', gain: 0.55, d: 0.05, filters: [{ type: 'bandpass', freq: x.vary(3000, 0.15), q: 1.4 }] }),
    punch(x, o, t, 180, 0.35, 0.05),
  ),
  // Cicada stingers: three needles fire as one ringing chord.
  stingerChoir: (x, o, t) => max(
    ...[0, 4, 7].map((k, i) => fm(x, o, t + i * 0.004, { freq: mtof(84 + k) * x.vary(1, 0.004), ratio: 2.0, index: 0.7, gain: 0.09, d: 0.45 }) + i * 0.004),
    noise(x, o, t, { gain: 0.5, d: 0.03, filters: [{ type: 'highpass', freq: 3000 }] }),
    punch(x, o, t, 200, 0.35, 0.06),
  ),
  // Vertebra rifle: each disc cracks forward along the spine, three clicks rising, then a heavy shove.
  vertebraRifle: (x, o, t) => max(
    snap(x, o, t, 1800, 0.85, 0.18),
    punch(x, o, t, 120, 0.8, 0.16),
    ...[0, 0.012, 0.024].map((d, i) => fm(x, o, t + d, { freq: 700 + i * 260, ratio: 1.41, index: 4, gain: 0.14, d: 0.03 }) + d),
    rollOff(x, o, t, 0.25),
  ),
  // Beetle burst rifle: the wing-cases clap open and shut round every round.
  cicadine: (x, o, t) => max(
    snap(x, o, t, 2000, 0.75, 0.14),
    punch(x, o, t, 140, 0.6, 0.12),
    noise(x, o, t + 0.03, { gain: 0.3, d: 0.025, filters: [{ type: 'bandpass', freq: 2400, q: 4 }] }) + 0.03,
    noise(x, o, t + 0.07, { gain: 0.22, d: 0.025, filters: [{ type: 'bandpass', freq: 2000, q: 4 }] }) + 0.07,
    noise(x, o, t, { colour: 'pink', gain: 0.1, a: 0.01, d: 0.12, rate: 0.6, filters: [{ type: 'bandpass', freq: 400, q: 1 }] }),
  ),
  // Toothed throat: a retching gag-boom and a spray of teeth pattering away.
  gulletScatter: (x, o, t) => max(
    snap(x, o, t, 900, 1, 0.3),
    punch(x, o, t, 95, 1, 0.3),
    voice(x, o, t, { freq: 140, to: 70, vowel: 'a', toVowel: 'u', gain: 0.25, a: 0.005, r: 0.25, breath: 0.6, formantShift: 0.7 }),
    ticks(x, o, t + 0.05, 10, 2600, 0.12, 0.022, 5) + 0.05,
    rollOff(x, o, t, 0.5, 1.2),
  ),
  // Flower-drum seed cannon: thick sticky 'thup's and the petals fluttering.
  bloomcannon: (x, o, t) => max(
    punch(x, o, t, 210, 0.75, 0.14),
    noise(x, o, t, { colour: 'pink', gain: 0.55, a: 0.005, d: 0.16, filters: [{ type: 'bandpass', freq: 520, to: 260, q: 3, over: 0.15 }] }),
    tone(x, o, t + 0.02, { freq: 320, to: 650, gain: 0.08, d: 0.08, glide: 0.06 }) + 0.02,
    noise(x, o, t + 0.05, { colour: 'pink', gain: 0.12, a: 0.02, d: 0.15, rate: 0.5, filters: [{ type: 'bandpass', freq: 1500, q: 2 }] }) + 0.05,
  ),
  // Eye-stalk marksman: a clean, cold crack, a glassy ring and the eye blinking wet.
  eyestalkMarksman: (x, o, t) => max(
    snap(x, o, t, 2100, 0.95, 0.28),
    punch(x, o, t, 115, 0.8, 0.2),
    fm(x, o, t, { freq: 620, ratio: 3.01, index: 2, gain: 0.08, d: 0.9 }),
    RELOAD_CUES['wet squelch'](x, o, t + 0.3) + 0.3,
    rollOff(x, o, t, 0.35, 1.4),
  ),
  // Harpoon quill: a deep jaw-slam, the quill shrieking away, a long ring off the hills.
  leviathanQuill: (x, o, t) => max(
    snap(x, o, t, 1500, 1, 0.45),
    punch(x, o, t, 85, 1, 0.45),
    fm(x, o, t, { freq: 110, ratio: 2.41, index: 5, indexDecay: 0.3, gain: 0.2, d: 1.6 }),
    tone(x, o, t + 0.03, { freq: 3200, to: 900, glide: 0.6, gain: 0.05, d: 0.6 }) + 0.03,
    rollOff(x, o, t, 0.5, 2),
  ),
  // Egg-sac mortar: a hollow 'bloomp' and the slosh of the next egg settling.
  broodMortar: (x, o, t) => max(
    punch(x, o, t, 230, 0.9, 0.3),
    noise(x, o, t, { colour: 'pink', gain: 0.45, a: 0.01, d: 0.25, filters: [{ type: 'bandpass', freq: 380, to: 170, q: 3, over: 0.25 }] }),
    tone(x, o, t + 0.25, { freq: 280, to: 160, gain: 0.08, d: 0.25 }) + 0.25,
  ),
  // Tumor launcher: a wet thunk and a gurgle as the bolt swells.
  tumorLauncher: (x, o, t) => max(
    punch(x, o, t, 180, 0.85, 0.22),
    noise(x, o, t, { colour: 'brown', gain: 0.5, d: 0.2, filters: [{ type: 'lowpass', freq: 600 }] }),
    ...[0.1, 0.17, 0.26, 0.33].map((d) => tone(x, o, t + d, { freq: x.range(180, 320), to: x.range(450, 700), gain: 0.07, d: 0.05, glide: 0.04 }) + d),
  ),
  // Glass-bone lance: light gathered and let go, a falling choir-whine and shattering shimmer.
  lumenLance: (x, o, t, ego) => max(
    tone(x, o, t, { type: 'sawtooth', freq: 1400, to: 300, gain: 0.22, d: ego ? 0.9 : 0.5, filters: [{ type: 'bandpass', freq: 1800, q: 2 }] }),
    ...[0, 0.02, 0.05].map((d) => fm(x, o, t + d, { freq: x.range(2400, 4200), ratio: 2.76, index: 1.5, gain: 0.08, d: 0.8 }) + d),
    snap(x, o, t, 3000, 0.5, 0.1),
    punch(x, o, t, 160, 0.5, 0.15),
  ),
  // The Reliquary's ribcage: three sung bolts, a chord of throats.
  reliquaryHymn: (x, o, t) => max(
    ...[50, 57, 62].map((m, i) => voice(x, o, t + i * 0.03, { freq: mtof(m) * x.vary(1, 0.01), to: mtof(m - 5), vowel: 'o', toVowel: 'a', gain: 0.25, a: 0.01, hold: 0.06, r: 0.7 }) + i * 0.03),
    punch(x, o, t, 120, 0.8, 0.25),
    snap(x, o, t, 1600, 0.6, 0.2),
  ),
  // The Warden's reactor heart: molten bolts, each a heavy beat with a sizzle and a furnace breath.
  coreburner: (x, o, t) => max(
    punch(x, o, t, 100, 0.8, 0.12),
    noise(x, o, t, { gain: 0.3, a: 0.005, d: 0.25, filters: [{ type: 'highpass', freq: 4000 }] }),
    noise(x, o, t, { colour: 'brown', gain: 0.4, a: 0.01, d: 0.18, filters: [{ type: 'bandpass', freq: 300, q: 1 }] }),
    snap(x, o, t, 1300, 0.5, 0.1),
  ),
};

/** Grafts that change the shot (data/mods.json). `filter` shapes the whole gun; `layer` adds to it. */
export interface ModSound { filter?: { type: BiquadFilterType; freq: number; q?: number; gain: number }; layer?: (x: Synth, o: AudioNode, t: number) => number }

export const MOD_SOUNDS: Record<string, ModSound> = {
  // Gill slits swallow the shot: a muffled 'phht' instead of a crack.
  hushGill: { filter: { type: 'lowpass', freq: 1100, q: 0.5, gain: 0.45 }, layer: (x, o, t) => noise(x, o, t, { colour: 'pink', gain: 0.18, a: 0.004, d: 0.12, filters: [{ type: 'bandpass', freq: 1300, q: 0.8 }] }) },
  // Tiny teeth gripping the muzzle chatter after every shot.
  lampreyMouth: { layer: (x, o, t) => ticks(x, o, t + 0.04, 4, 4200, 0.06, 0.018) + 0.04 },
  // Hooked barbs tear the round on the way out: a ripping edge and a louder bark.
  barbCrown: { filter: { type: 'peaking', freq: 2600, q: 1, gain: 1.2 }, layer: (x, o, t) => noise(x, o, t, { gain: 0.25, a: 0.002, d: 0.07, filters: [{ type: 'bandpass', freq: 5200, to: 2500, q: 2, over: 0.07 }] }) },
  // The tendon brace hums like a plucked cord with every kick.
  tendonBrace: { layer: (x, o, t) => tone(x, o, t + 0.02, { type: 'triangle', freq: x.vary(98, 0.03), gain: 0.06, d: 0.25, vibrato: { rate: 14, depth: 20 } }) + 0.02 },
  // A fast gullet swallows the next round: a tight gulp right behind the shot.
  quickGullet: { layer: (x, o, t) => noise(x, o, t + 0.05, { colour: 'pink', gain: 0.1, a: 0.01, d: 0.06, filters: [{ type: 'bandpass', freq: 900, to: 450, q: 6, over: 0.06 }] }) + 0.05 },
  // The oversized sac deepens every shot with a heavy gloop.
  swollenSac: { layer: (x, o, t) => tone(x, o, t + 0.01, { freq: 90, to: 50, gain: 0.25, d: 0.18 }) + 0.01 },
  // Acid veins: every shot leaves a sizzle.
  acidStrain: { layer: (x, o, t) => noise(x, o, t + 0.05, { gain: 0.1, a: 0.04, d: 0.45, filters: [{ type: 'highpass', freq: 4500 }] }) + 0.05 },
  // A nerve knot steers the round: a thin rising whistle that bends.
  seekerStrain: { layer: (x, o, t) => tone(x, o, t + 0.03, { freq: 1700, to: 2600, glide: 0.25, gain: 0.04, d: 0.3, vibrato: { rate: 7, depth: 40 } }) + 0.03 },
  // The leech in the chamber drinks: a wet slurp.
  leechStrain: { layer: (x, o, t) => noise(x, o, t + 0.06, { colour: 'pink', gain: 0.12, a: 0.05, d: 0.12, filters: [{ type: 'bandpass', freq: 500, to: 1400, q: 5, over: 0.15 }] }) + 0.06 },
  // Bone spurs packed in the feed rattle out with the shot.
  splinterStrain: { layer: (x, o, t) => ticks(x, o, t + 0.02, 6, 1800, 0.1, 0.015, 6) + 0.02 },
};

/** A gun's shot with its grafts applied. Unknown guns fall back to `fallback` (the class sound). */
export function gunShot(id: string, mods: readonly string[], fallback: Gun): Gun {
  const base = GUNS[id] ?? fallback;
  const fx = mods.map((m) => MOD_SOUNDS[m]).filter((m): m is ModSound => !!m);
  if (!fx.length) return base;
  return (x, o, t, ego) => {
    let into: AudioNode = o;
    for (const m of fx) {
      if (!m.filter) continue;
      const f = x.ctx.createBiquadFilter(), g = x.ctx.createGain();
      f.type = m.filter.type; f.frequency.value = m.filter.freq; f.Q.value = m.filter.q ?? 0.7;
      if (m.filter.type === 'peaking') f.gain.value = 6;
      g.gain.value = m.filter.gain;
      f.connect(g).connect(into);
      into = f;
    }
    let l = base(x, into, t, ego);
    for (const m of fx) if (m.layer) l = max(l, m.layer(x, o, t));
    return l;
  };
}

/** Swapping guns: the arm lets go of one and the other's feed tentacles take hold. */
export const weaponSwap = (x: Synth, o: AudioNode, t: number): number => max(
  noise(x, o, t, { colour: 'pink', gain: 0.18, a: 0.03, d: 0.15, filters: [{ type: 'bandpass', freq: 700, to: 1400, q: 3, over: 0.15 }] }),
  RELOAD_CUES['click of chitin'](x, o, t + 0.22) + 0.22,
);
