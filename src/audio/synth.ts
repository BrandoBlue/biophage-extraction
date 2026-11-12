/**
 * Synthesis primitives (Audio). Every sound in the game is built from these at runtime: shaped noise, oscillators,
 * FM bells, formant voices and a generated reverb. No sample files, so nothing to license and nothing to download.
 * All functions take an explicit start time so the same recipes render live or offline.
 */

export type NoiseColour = 'white' | 'pink' | 'brown';

export interface Synth {
  readonly ctx: BaseAudioContext;
  noise(colour: NoiseColour): AudioBuffer;
  rand(): number;
  /** Uniform in [a, b). */
  range(a: number, b: number): number;
  /** Multiplies by a random factor in [1 - k, 1 + k]. */
  vary(v: number, k?: number): number;
}

const noiseCache = new WeakMap<BaseAudioContext, Map<NoiseColour, AudioBuffer>>();

export function createSynth(ctx: BaseAudioContext, seed = 0x51f3): Synth {
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    ctx,
    noise: (c) => noiseBuffer(ctx, c),
    rand,
    range: (a, b) => a + (b - a) * rand(),
    vary: (v, k = 0.08) => v * (1 + (rand() * 2 - 1) * k),
  };
}

function noiseBuffer(ctx: BaseAudioContext, colour: NoiseColour): AudioBuffer {
  let m = noiseCache.get(ctx);
  if (!m) noiseCache.set(ctx, (m = new Map()));
  const hit = m.get(colour);
  if (hit) return hit;
  const len = Math.floor(ctx.sampleRate * 2.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 1234567, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let i = 0; i < len; i++) {
    const w = r();
    if (colour === 'white') d[i] = w;
    else if (colour === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  }
  m.set(colour, buf);
  return buf;
}

/** Attack-decay envelope on a gain param: 0 → peak over `a`, then exponential fall to silence over `d`. */
export function ad(p: AudioParam, t: number, peak: number, a: number, d: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, a));
  p.exponentialRampToValueAtTime(0.0001, t + Math.max(0.001, a) + Math.max(0.005, d));
}

/** Attack-hold-release envelope (for sustained layers). */
export function ahr(p: AudioParam, t: number, peak: number, a: number, h: number, r: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(Math.max(0.0002, peak), t + a);
  p.setValueAtTime(Math.max(0.0002, peak), t + a + h);
  p.exponentialRampToValueAtTime(0.0001, t + a + h + r);
}

export interface FilterSpec { type: BiquadFilterType; freq: number; to?: number; q?: number; over?: number }

function filter(x: Synth, f: FilterSpec, t: number): BiquadFilterNode {
  const n = x.ctx.createBiquadFilter();
  n.type = f.type;
  n.frequency.setValueAtTime(f.freq, t);
  if (f.to !== undefined) n.frequency.exponentialRampToValueAtTime(Math.max(20, f.to), t + (f.over ?? 0.2));
  if (f.q !== undefined) n.Q.value = f.q;
  return n;
}

export interface NoiseSpec {
  colour?: NoiseColour; gain: number; a?: number; d: number; filters?: FilterSpec[]; rate?: number; offset?: number;
}

/** A shaped burst of noise through a chain of filters. Returns its length in seconds. */
export function noise(x: Synth, out: AudioNode, t: number, s: NoiseSpec): number {
  const src = x.ctx.createBufferSource();
  src.buffer = x.noise(s.colour ?? 'white');
  src.loop = true;
  if (s.rate) src.playbackRate.value = s.rate;
  let node: AudioNode = src;
  for (const f of s.filters ?? []) { const n = filter(x, f, t); node.connect(n); node = n; }
  const g = x.ctx.createGain();
  const a = s.a ?? 0.002;
  ad(g.gain, t, s.gain, a, s.d);
  node.connect(g).connect(out);
  const len = a + s.d + 0.05;
  src.start(t, s.offset ?? x.range(0, 2));
  src.stop(t + len);
  return len;
}

export interface ToneSpec {
  type?: OscillatorType; freq: number; to?: number; glide?: number; gain: number; a?: number; d: number;
  filters?: FilterSpec[]; detune?: number; vibrato?: { rate: number; depth: number }; hold?: number;
}

/** An oscillator with pitch glide, optional vibrato, filters and an AD (or AHR when `hold`) envelope. */
export function tone(x: Synth, out: AudioNode, t: number, s: ToneSpec): number {
  const o = x.ctx.createOscillator();
  o.type = s.type ?? 'sine';
  o.frequency.setValueAtTime(s.freq, t);
  if (s.to !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, s.to), t + (s.glide ?? s.d));
  if (s.detune) o.detune.value = s.detune;
  const a = s.a ?? 0.003;
  const len = a + (s.hold ?? 0) + s.d + 0.05;
  if (s.vibrato) {
    const l = x.ctx.createOscillator(), lg = x.ctx.createGain();
    l.frequency.value = s.vibrato.rate; lg.gain.value = s.vibrato.depth;
    l.connect(lg).connect(o.detune);
    l.start(t); l.stop(t + len);
  }
  let node: AudioNode = o;
  for (const f of s.filters ?? []) { const n = filter(x, f, t); node.connect(n); node = n; }
  const g = x.ctx.createGain();
  if (s.hold !== undefined) ahr(g.gain, t, s.gain, a, s.hold, s.d); else ad(g.gain, t, s.gain, a, s.d);
  node.connect(g).connect(out);
  o.start(t); o.stop(t + len);
  return len;
}

export interface FmSpec { freq: number; ratio: number; index: number; gain: number; d: number; a?: number; indexDecay?: number; to?: number }

/** Two-operator FM: bells, glass, chitin and metal depending on the ratio. */
export function fm(x: Synth, out: AudioNode, t: number, s: FmSpec): number {
  const c = x.ctx.createOscillator(), m = x.ctx.createOscillator(), mg = x.ctx.createGain(), g = x.ctx.createGain();
  c.frequency.setValueAtTime(s.freq, t);
  m.frequency.setValueAtTime(s.freq * s.ratio, t);
  if (s.to) { c.frequency.exponentialRampToValueAtTime(s.to, t + s.d); m.frequency.exponentialRampToValueAtTime(s.to * s.ratio, t + s.d); }
  const depth = s.freq * s.index;
  mg.gain.setValueAtTime(depth, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(1, depth * 0.02), t + (s.indexDecay ?? s.d));
  m.connect(mg).connect(c.frequency);
  ad(g.gain, t, s.gain, s.a ?? 0.002, s.d);
  c.connect(g).connect(out);
  const len = (s.a ?? 0.002) + s.d + 0.05;
  c.start(t); m.start(t); c.stop(t + len); m.stop(t + len);
  return len;
}

/** Formant centre frequencies and gains (F1, F2, F3) for sung vowels. */
export const VOWELS = {
  a: [[800, 1], [1150, 0.5], [2900, 0.25]],
  o: [[450, 1], [800, 0.4], [2830, 0.15]],
  u: [[325, 1], [700, 0.25], [2530, 0.1]],
  e: [[400, 1], [1700, 0.35], [2600, 0.25]],
  i: [[270, 1], [2140, 0.3], [2950, 0.2]],
} as const;
export type Vowel = keyof typeof VOWELS;

export interface VoiceSpec {
  freq: number; to?: number; glide?: number; vowel: Vowel; toVowel?: Vowel; gain: number; a: number; hold?: number; r: number;
  vibrato?: number; breath?: number; detune?: number; formantShift?: number; type?: OscillatorType;
}

/**
 * A formant-filtered voice: choir pads, Reliquary's hymn, Mournback's moan, the Husk Mimic's not-quite-human call.
 * Two detuned sources, vibrato, three vowel formants (optionally morphing), breath noise.
 */
export function voice(x: Synth, out: AudioNode, t: number, s: VoiceSpec): number {
  const ctx = x.ctx;
  const hold = s.hold ?? 0;
  const len = s.a + hold + s.r + 0.05;
  const sum = ctx.createGain();
  sum.gain.value = 0.5;
  const vib = ctx.createOscillator(), vg = ctx.createGain();
  vib.frequency.value = x.vary(5.2, 0.15);
  vg.gain.value = s.vibrato ?? 9;
  vib.connect(vg);
  for (const det of [-(s.detune ?? 7), s.detune ?? 7]) {
    const o = ctx.createOscillator();
    o.type = s.type ?? 'sawtooth';
    o.frequency.setValueAtTime(s.freq, t);
    if (s.to) o.frequency.exponentialRampToValueAtTime(s.to, t + (s.glide ?? s.a + hold + s.r));
    o.detune.value = det;
    vg.connect(o.detune);
    o.connect(sum);
    o.start(t); o.stop(t + len);
  }
  vib.start(t); vib.stop(t + len);
  if (s.breath) noise(x, sum, t, { colour: 'pink', gain: s.breath, a: s.a, d: hold + s.r, filters: [{ type: 'bandpass', freq: 1800, q: 0.7 }] });
  const env = ctx.createGain();
  ahr(env.gain, t, s.gain, s.a, hold, s.r);
  const shift = s.formantShift ?? 1;
  const from = VOWELS[s.vowel], to = s.toVowel ? VOWELS[s.toVowel] : null;
  for (let i = 0; i < 3; i++) {
    const bp = ctx.createBiquadFilter(), fg = ctx.createGain();
    bp.type = 'bandpass';
    bp.Q.value = 9 + i * 3;
    bp.frequency.setValueAtTime(from[i][0] * shift, t);
    if (to) bp.frequency.linearRampToValueAtTime(to[i][0] * shift, t + s.a + hold + s.r * 0.5);
    fg.gain.value = from[i][1] * 2.4;
    sum.connect(bp).connect(fg).connect(env);
  }
  env.connect(out);
  return len;
}

/** Stereo decaying-noise impulse response: a cheap, convincing room or cave. */
export function impulse(ctx: BaseAudioContext, seconds: number, decay: number, brightness = 0.5): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 98765;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // Darker as it decays (air and soft walls eat the highs).
      const a = brightness * (1 - k) + 0.04;
      lp += a * (r() - lp);
      d[i] = lp * Math.pow(1 - k, decay) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
    }
  }
  return buf;
}

/** Soft clipper for bass grit and creature throats. */
export function shaper(ctx: BaseAudioContext, amount: number): WaveShaperNode {
  const n = ctx.createWaveShaper();
  const k = amount, c = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const v = (i / 1023) * 2 - 1; c[i] = ((1 + k) * v) / (1 + k * Math.abs(v)); }
  n.curve = c;
  n.oversample = '2x';
  return n;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
