/**
 * The mixer (Audio): music, ambience, sfx and UI buses into one master with a limiter, two generated reverbs
 * (open air and enclosed: caves, the Wreck's hull, the Hive) and 3D placement for anything in the world.
 * Works on a live AudioContext or an OfflineAudioContext (the sound-tour render in tests).
 */
import { AUDIO } from './config';
import { createSynth, impulse, type Synth } from './synth';

export interface V3 { x: number; y: number; z: number }
export type Bus = 'music' | 'ambience' | 'sfx' | 'ui';

export class AudioEngine {
  readonly x: Synth;
  readonly master: GainNode;
  readonly buses: Record<Bus, GainNode>;
  /** Pre-limiter low-pass on world sound (sfx + ambience): closes when the host is near death. */
  readonly muffle: BiquadFilterNode;
  private reverbs: { open: GainNode; enclosed: GainNode };
  /** Per-bus send into the current reverb. */
  readonly sends: Record<Bus, GainNode>;
  private voices: number[] = [];
  /** Sounds started (tests read it to prove the engine is alive). */
  played = 0;
  dropped = 0;
  readonly listener = { x: 0, y: 0, z: 0 };
  private meter: AnalyserNode;
  private meterBuf = new Float32Array(1024);

  constructor(readonly ctx: BaseAudioContext) {
    this.x = createSynth(ctx);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = AUDIO.mix.master;
    // Keep the sub-bass clean: below ~35 Hz is felt on big speakers and turns to mud on everything else.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 35; hp.Q.value = 0.7;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowshelf'; shelf.frequency.value = 110; shelf.gain.value = -4;
    // Brick-wall-ish limiter after the glue compressor: shrieks and explosions never clip.
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
    comp.connect(lim).connect(ctx.destination);
    this.master.connect(hp).connect(shelf).connect(comp);
    // Output meter (tests and the debug overlay read `level`).
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;
    lim.connect(this.meter);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.connect(this.master);

    const mk = (level: number, to: AudioNode) => { const g = ctx.createGain(); g.gain.value = level; g.connect(to); return g; };
    this.buses = {
      music: mk(AUDIO.mix.music, this.master),
      ambience: mk(AUDIO.mix.ambience, this.muffle),
      sfx: mk(AUDIO.mix.sfx, this.muffle),
      ui: mk(AUDIO.mix.ui, this.master),
    };
    const verb = (seconds: number, decay: number, bright: number, to: AudioNode) => {
      const c = ctx.createConvolver();
      c.buffer = impulse(ctx, seconds, decay, bright);
      const g = ctx.createGain();
      g.connect(c).connect(to);
      return g;
    };
    const verbIn = ctx.createGain();
    this.reverbs = { open: verb(2.6, 3.2, 0.35, this.muffle), enclosed: verb(4.8, 2.2, 0.55, this.muffle) };
    verbIn.connect(this.reverbs.open);
    verbIn.connect(this.reverbs.enclosed);
    this.setSpace('open', 0);
    this.sends = {
      music: mk(0.5, verbIn), ambience: mk(0.6, verbIn), sfx: mk(0.35, verbIn), ui: mk(0.15, verbIn),
    };
    for (const b of Object.keys(this.buses) as Bus[]) this.buses[b].connect(this.sends[b]);
  }

  get now(): number { return this.ctx.currentTime; }

  /** Crossfades the reverb between open air and an enclosed space. */
  setSpace(space: 'open' | 'enclosed', fade = 2, t = this.ctx.currentTime): void {
    const open = space === 'open' ? AUDIO.mix.reverbOpen : 0, enc = space === 'enclosed' ? AUDIO.mix.reverbEnclosed : 0;
    this.reverbs.open.gain.setTargetAtTime(open, t, Math.max(0.01, fade / 3));
    this.reverbs.enclosed.gain.setTargetAtTime(enc, t, Math.max(0.01, fade / 3));
  }

  /** Voice budget: false (and the sound is skipped) when too many are already playing and this one is optional. */
  claim(seconds: number, priority = 1, at = this.ctx.currentTime): boolean {
    const now = this.ctx.currentTime;
    if (this.voices.length > 8) this.voices = this.voices.filter((e) => e > now);
    const cap = AUDIO.mix.maxVoices;
    if (this.voices.length >= cap * (priority >= 2 ? 1.3 : priority >= 1 ? 1 : 0.6)) { this.dropped++; return false; }
    this.voices.push(at + seconds);
    this.played++;
    return true;
  }

  get active(): number { const now = this.ctx.currentTime; return this.voices.filter((e) => e > now).length; }

  /** Peak output level right now (0..1). */
  get level(): number {
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let m = 0;
    for (const v of this.meterBuf) m = Math.max(m, Math.abs(v));
    return m;
  }

  /** Moves the ears to the camera. */
  setListener(pos: V3, fwd: V3, up: V3): void {
    const l = this.ctx.listener, t = this.ctx.currentTime;
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02); l.forwardY.setTargetAtTime(fwd.y, t, 0.02); l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02); l.upY.setTargetAtTime(up.y, t, 0.02); l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /**
   * An input node placed at `p` in the world: HRTF panning, distance roll-off and air absorption (far sounds lose
   * their highs). Everything plugged in is heard from there for `seconds`.
   */
  at(p: V3, seconds: number, bus: Bus = 'sfx', near = 1): AudioNode {
    const ctx = this.ctx, S = AUDIO.spatial;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = S.refDistance * near;
    pan.maxDistance = S.maxDistance;
    pan.rolloffFactor = S.rolloff;
    if (pan.positionX) { pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z; }
    else (pan as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, p.z);
    const d = Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = airCutoff(d);
    lp.connect(pan).connect(this.buses[bus]);
    // Stopped sources release the chain behind them; `seconds` is kept for callers that budget voices.
    void seconds;
    return lp;
  }

  /** Ducks a bus (music and ambience go quiet for the Pale Vigil). 1 = full, 0 = silent. */
  duck(bus: Bus, amount: number, over = 0.4, t = this.ctx.currentTime): void {
    const base = AUDIO.mix[bus];
    this.buses[bus].gain.setTargetAtTime(base * Math.max(0, amount), t, over);
  }
}

/** Air absorption: full brightness close up, a dull thud far away. */
export function airCutoff(distance: number): number {
  const S = AUDIO.spatial;
  if (distance <= S.airAbsorbFrom) return 18000;
  const k = Math.min(1, (distance - S.airAbsorbFrom) / (S.maxDistance - S.airAbsorbFrom));
  return 18000 * Math.pow(S.airAbsorbCutoffFar / 18000, Math.sqrt(k));
}

/** Settings volume (0..1, linear slider) to a gain that sounds even across the range. */
export const volumeGain = (v: number) => Math.max(0, Math.min(1, v)) ** 2;
