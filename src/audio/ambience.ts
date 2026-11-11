/**
 * Zone ambience (Audio): a continuous bed (wind, hum, the zone's own texture) and scattered one-shots placed in 3D
 * around the listener (distant calls, drips, creaks, whispers, things moving under the sand). Profiles come from
 * data/audio.json; changing profile (walking into a cave, the Hive opening) crossfades over a few seconds.
 */
import type { AmbienceProfile, BedKind } from './config';
import type { AudioEngine } from './engine';
import { EMITTERS } from './voices';

interface Bed { out: GainNode; stop(t: number): void }

export class Ambience {
  private bed: Bed | null = null;
  private profile: AmbienceProfile | null = null;
  private next: number[] = [];
  private gustAt = 0;
  private windGain: GainNode | null = null;
  /** One-shots played (tests). */
  calls = 0;

  constructor(private e: AudioEngine) {}

  get current(): AmbienceProfile | null { return this.profile; }

  set(p: AmbienceProfile, fade = 3, t = this.e.now): void {
    if (p === this.profile) return;
    if (this.bed) {
      const old = this.bed;
      old.out.gain.setTargetAtTime(0.0001, t, fade / 3);
      old.stop(t + fade * 1.5);
    }
    this.profile = p;
    this.bed = this.build(p, t, fade);
    this.next = p.emitters.map((em) => t + this.wait(em.perMinute) * 0.5);
    this.e.setSpace(p.reverb, fade, t);
  }

  stop(fade = 2): void {
    if (!this.bed) return;
    const t = this.e.now;
    this.bed.out.gain.setTargetAtTime(0.0001, t, fade / 3);
    this.bed.stop(t + fade * 1.5);
    this.bed = null; this.profile = null; this.windGain = null;
  }

  private wait(perMinute: number): number { return (-Math.log(1 - this.e.x.rand() * 0.98) * 60) / Math.max(0.01, perMinute); }

  update(now: number): void {
    const p = this.profile;
    if (!p) return;
    // Gusts: the wind breathes rather than hissing flat.
    if (this.windGain && now >= this.gustAt) {
      const x = this.e.x;
      this.windGain.gain.setTargetAtTime(p.wind * x.range(0.45, 1.25), now, x.range(0.8, 2.5));
      this.gustAt = now + x.range(2, 6);
    }
    const L = this.e.listener;
    p.emitters.forEach((em, i) => {
      if (now < this.next[i]) return;
      this.next[i] = now + this.wait(em.perMinute);
      const recipe = EMITTERS[em.kind];
      if (!recipe || !this.e.claim(3, 0)) return;
      const x = this.e.x, a = x.range(0, Math.PI * 2), d = x.range(em.range[0], em.range[1]);
      const at = { x: L.x + Math.cos(a) * d, y: L.y + x.range(-1, 6), z: L.z + Math.sin(a) * d };
      const g = this.e.ctx.createGain();
      g.gain.value = em.level;
      g.connect(this.e.at(at, 4, 'ambience', 2));
      recipe(x, g, now + 0.05);
      this.calls++;
    });
  }

  private build(p: AmbienceProfile, t: number, fade: number): Bed {
    const { ctx, x } = this.e;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.setTargetAtTime(1, t, fade / 3);
    out.connect(this.e.buses.ambience);
    const sources: AudioScheduledSourceNode[] = [];
    const loop = (colour: 'white' | 'pink' | 'brown', rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = x.noise(colour); s.loop = true; s.playbackRate.value = rate;
      s.start(t, x.range(0, 2)); sources.push(s);
      return s;
    };
    const chain = (src: AudioNode, ...nodes: AudioNode[]) => { let n = src; for (const m of nodes) { n.connect(m); n = m; } return n; };
    const bq = (type: BiquadFilterType, freq: number, q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
    const gain = (v: number) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const lfo = (rate: number, depth: number, param: AudioParam) => { const o = ctx.createOscillator(), g = gain(depth); o.frequency.value = rate; o.connect(g).connect(param); o.start(t); sources.push(o); };

    // Wind, stereo-ish: two decorrelated loops panned apart.
    if (p.wind > 0) {
      this.windGain = gain(p.wind);
      for (const side of [-0.7, 0.7]) {
        const pan = ctx.createStereoPanner(); pan.pan.value = side;
        const f = bq('lowpass', p.windCutoff, 0.5);
        lfo(x.range(0.03, 0.08), p.windCutoff * 0.4, f.frequency);
        chain(loop('pink', x.range(0.9, 1.1)), f, bq('highpass', 120), pan, this.windGain);
      }
      this.windGain.connect(out);
    }
    if (p.hum > 0) {
      const g = gain(p.hum);
      for (const [k, v] of [[1, 1], [2.01, 0.4], [3.03, 0.15]]) {
        const o = ctx.createOscillator(); o.frequency.value = p.humFreq * k; o.start(t); sources.push(o);
        const og = gain(v); o.connect(og).connect(g);
      }
      lfo(0.13, p.hum * 0.4, g.gain);
      g.connect(out);
    }
    bedTexture(p.bed, { loop, chain, bq, gain, lfo, out, ctx });
    return { out, stop: (at) => { for (const s of sources) { try { s.stop(at); } catch { /* already stopped */ } } } };
  }
}

interface BedKit {
  loop(c: 'white' | 'pink' | 'brown', rate?: number): AudioBufferSourceNode;
  chain(src: AudioNode, ...n: AudioNode[]): AudioNode;
  bq(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode;
  gain(v: number): GainNode;
  lfo(rate: number, depth: number, p: AudioParam): void;
  out: GainNode; ctx: BaseAudioContext;
}

function bedTexture(kind: BedKind, k: BedKit): void {
  switch (kind) {
    case 'marsh': {
      // Slow water lapping and a far, low wash.
      const g = k.gain(0.1);
      k.lfo(0.21, 0.06, g.gain);
      k.chain(k.loop('brown'), k.bq('bandpass', 160, 1.2), g, k.out);
      break;
    }
    case 'cave': {
      const g = k.gain(0.1);
      k.chain(k.loop('brown', 0.6), k.bq('lowpass', 140), g, k.out);
      break;
    }
    case 'hull': {
      // The Wreck's hull rings faintly: three inharmonic resonances fed by air.
      for (const [f, v] of [[87, 0.5], [211, 0.3], [347, 0.2]]) {
        const g = k.gain(v * 0.5);
        k.lfo(0.05 + f / 4000, v * 0.3, g.gain);
        k.chain(k.loop('pink'), k.bq('bandpass', f, 30), g, k.out);
      }
      break;
    }
    case 'dunes': {
      const g = k.gain(0.12);
      k.lfo(0.09, 0.08, g.gain);
      k.chain(k.loop('white'), k.bq('highpass', 4000), k.bq('lowpass', 9000), g, k.out);
      break;
    }
    case 'hive': {
      const g = k.gain(0.08);
      k.chain(k.loop('brown', 0.8), k.bq('lowpass', 260), g, k.out);
      break;
    }
  }
}
