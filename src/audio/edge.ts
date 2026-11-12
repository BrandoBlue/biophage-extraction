/**
 * The edge of the map (Audio, with Rendering's boundary murk in src/render/edgemurk.ts). Walking out toward the
 * murk, the world's own sound gives way to something else: a low, slow breathing drone, distant wet movement, now and
 * then something large shifting in the fog, and once in a while a far call with no source. Unsettling, not loud.
 * Silent inside `edge.from` x the playable radius, full at `edge.to` x (data/audio.json `edge`).
 */
import { AUDIO } from './config';
import type { AudioEngine } from './engine';
import { noise, tone, voice, type Synth } from './synth';

const max = Math.max;

/** 0..1: how far into the edge band the host is (smoothstep between from and to, by distance from the zone centre). */
export function edgeLevel(x: number, z: number, radius: number, E = AUDIO.edge): number {
  if (!(radius > 0)) return 0;
  const k = (Math.hypot(x, z) / radius - E.from) / Math.max(1e-3, E.to - E.from);
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
}

type R = (x: Synth, o: AudioNode, t: number) => number;

/** One-shots heard from inside the murk. */
export const MURK: Record<'shift' | 'wet' | 'call', R> = {
  // Something large shifting its weight: a slow swell of low mass with a groan of strain in it.
  shift: (x, o, t) => max(
    noise(x, o, t, { colour: 'brown', gain: 0.55, a: 1.4, d: 2.4, filters: [{ type: 'lowpass', freq: 140, to: 260, over: 2.5 }] }),
    tone(x, o, t + 0.6, { type: 'sawtooth', freq: x.range(38, 52), to: x.range(30, 40), glide: 2.5, gain: 0.05, a: 0.8, d: 2, filters: [{ type: 'lowpass', freq: 220 }] }) + 0.6,
  ),
  // Distant wet movement: a run of soft, heavy slaps and drags.
  wet: (x, o, t) => {
    let l = 0;
    const n = 2 + Math.floor(x.range(0, 4));
    for (let i = 0; i < n; i++) {
      const at = i * x.range(0.25, 0.6);
      l = max(l, noise(x, o, t + at, { colour: 'pink', gain: x.range(0.12, 0.22), a: 0.02, d: x.range(0.15, 0.35), filters: [{ type: 'bandpass', freq: x.range(300, 650), to: x.range(150, 300), q: 3, over: 0.3 }] }) + at);
    }
    return l;
  },
  // A far call with no source: a long, sung moan that bends down, as if something answered a question you didn't ask.
  call: (x, o, t) => {
    const f = x.range(70, 110);
    return max(
      voice(x, o, t, { freq: f, to: f * 0.7, glide: 3, vowel: 'o', toVowel: 'u', gain: 0.07, a: 1.2, hold: 1.2, r: 2.2, breath: 0.6, vibrato: 3, formantShift: 0.8 }),
      voice(x, o, t + 0.15, { freq: f * 1.498, to: f * 1.05, glide: 3, vowel: 'u', gain: 0.03, a: 1.4, hold: 0.8, r: 2.2, breath: 0.3, formantShift: 0.8 }) + 0.15,
    );
  },
};

export class EdgeMurk {
  private out: GainNode | null = null;
  private next = { shift: 0, wet: 0, call: 0 };
  /** Current 0..1 level (tests, stats). */
  level = 0;
  calls = 0;

  constructor(private e: AudioEngine) {}

  private wait(perMinute: number): number { return (-Math.log(1 - this.e.x.rand() * 0.98) * 60) / Math.max(0.01, perMinute); }

  /** The bed: two slow, detuned low tones that breathe, and a dark wash of air moving in fog. Built once, held silent. */
  private build(t: number): GainNode {
    const { ctx, x } = this.e;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.e.buses.ambience);
    const breath = ctx.createGain();
    breath.gain.value = 0.6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.09; lg.gain.value = 0.4;
    lfo.connect(lg).connect(breath.gain); lfo.start(t);
    breath.connect(out);
    for (const [f, g] of [[41.2, 0.18], [43.6, 0.14], [61.7, 0.06], [123.6 * 1.003, 0.025]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.value = f; og.gain.value = g;
      o.connect(og).connect(breath); o.start(t);
    }
    for (const side of [-0.8, 0.8]) {
      const s = ctx.createBufferSource();
      s.buffer = x.noise('brown'); s.loop = true; s.playbackRate.value = x.range(0.5, 0.7);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 260; f.Q.value = 0.8;
      const fl = ctx.createOscillator(), fg = ctx.createGain();
      fl.frequency.value = x.range(0.04, 0.07); fg.gain.value = 120;
      fl.connect(fg).connect(f.frequency); fl.start(t);
      const pan = ctx.createStereoPanner(); pan.pan.value = side;
      const g = ctx.createGain(); g.gain.value = 0.35;
      s.connect(f).connect(pan).connect(g).connect(out);
      s.start(t, x.range(0, 2));
    }
    return out;
  }

  /**
   * `level` 0..1 from edgeLevel; (px, pz) the host's position, so calls come from out in the murk (beyond the edge,
   * in the direction away from the zone centre).
   */
  update(now: number, level: number, px: number, pz: number): void {
    this.level = level;
    if (level <= 0.001 && !this.out) return;
    this.out ??= this.build(now);
    this.out.gain.setTargetAtTime(level * AUDIO.edge.level, now, 0.8);
    if (level <= 0.02) { for (const k of Object.keys(this.next) as (keyof typeof this.next)[]) this.next[k] = 0; return; }
    const E = AUDIO.edge, x = this.e.x, L = this.e.listener;
    const r = Math.hypot(px, pz) || 1, ox = px / r, oz = pz / r;
    for (const k of Object.keys(MURK) as (keyof typeof MURK)[]) {
      if (this.next[k] === 0) { this.next[k] = now + this.wait(E.perMinute[k] * level) * 0.5; continue; }
      if (now < this.next[k]) continue;
      this.next[k] = now + this.wait(E.perMinute[k] * level);
      if (!this.e.claim(3, 0)) continue;
      // Out in the murk: mostly ahead of the boundary, spread across a wide arc.
      const a = Math.atan2(oz, ox) + x.range(-1.1, 1.1), d = x.range(E.range[0], E.range[1]);
      const at = { x: L.x + Math.cos(a) * d, y: L.y + x.range(-2, 8), z: L.z + Math.sin(a) * d };
      const g = this.e.ctx.createGain();
      g.gain.value = 0.5 + level * 0.5;
      g.connect(this.e.at(at, 6, 'ambience', 3));
      MURK[k](x, g, now + 0.05);
      this.calls++;
    }
  }
}
