/**
 * Adaptive score (Audio). Generated live, never looped: a drone that glides between roots, a choir that breathes
 * through slow chords, glass bells while you explore, a heartbeat pulse when something is near, and organic drums
 * with a gritty bass when you are fighting. Bosses add brass-like stabs and a dissonant cluster.
 * Intensity (0..1) comes from the director (src/audio/director.ts); thresholds and tempos from data/audio.json.
 */
import { AUDIO } from './config';
import type { AudioEngine } from './engine';
import { fm, mtof, noise, shaper, tone, voice, type Vowel } from './synth';

export type MusicMode = 'off' | 'hive' | 'raid';
interface Chord { root: number; notes: number[]; vowel: Vowel }

/** Explore: D minor with a Neapolitan E♭ shadow: beautiful, and wrong in a way you feel more than hear. */
const RAID: Chord[] = [
  { root: 38, notes: [57, 62, 65, 76], vowel: 'a' },
  { root: 34, notes: [58, 62, 69, 76], vowel: 'o' },
  { root: 31, notes: [55, 62, 65, 70], vowel: 'a' },
  { root: 39, notes: [58, 63, 67, 74], vowel: 'u' },
];
/** Combat: the same roots crushed into semitone clusters. */
const COMBAT: Chord[] = [
  { root: 38, notes: [57, 62, 63, 69], vowel: 'a' },
  { root: 39, notes: [58, 63, 64, 70], vowel: 'o' },
  { root: 36, notes: [55, 60, 63, 67], vowel: 'a' },
  { root: 37, notes: [56, 61, 64, 68], vowel: 'e' },
];
/** The Hive: warm, slow, a little holy. Home, but not a safe one. */
const HIVE: Chord[] = [
  { root: 38, notes: [62, 66, 69, 73], vowel: 'o' },
  { root: 35, notes: [59, 62, 66, 69], vowel: 'a' },
  { root: 31, notes: [59, 62, 66, 71], vowel: 'o' },
  { root: 33, notes: [57, 61, 64, 71], vowel: 'u' },
];

const smooth = (a: number, b: number, v: number) => { const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return k * k * (3 - 2 * k); };

/** Layer levels for an intensity: what plays, how loud. Pure (tests). */
export function layerLevels(intensity: number, boss: boolean, mode: MusicMode): { choir: number; bells: number; pulse: number; drums: number; brass: number; drone: number } {
  const M = AUDIO.music;
  if (mode === 'off') return { choir: 0, bells: 0, pulse: 0, drums: 0, brass: 0, drone: 0 };
  if (mode === 'hive') return { choir: 0.9, bells: 1, pulse: 0, drums: 0, brass: 0, drone: 0.35 };
  const i = boss ? Math.max(intensity, M.bossFloor) : intensity;
  return {
    drone: 0.4 + 0.25 * i,
    choir: 1 - 0.35 * smooth(M.combat, 1, i),
    bells: 1 - smooth(M.tension - 0.1, M.combat, i),
    pulse: smooth(M.tension - 0.05, M.tension + 0.15, i),
    drums: smooth(M.combat - 0.05, M.combat + 0.15, i),
    brass: boss ? smooth(M.combat, 1, i) : 0,
  };
}

/** Tempo for an intensity (beats per minute). */
export function tempo(intensity: number, boss: boolean): number {
  const M = AUDIO.music;
  if (boss) return M.bpmBoss;
  return M.bpmCalm + (M.bpmCombat - M.bpmCalm) * smooth(M.tension, 1, intensity);
}

export class Music {
  mode: MusicMode = 'off';
  private out: GainNode;
  private layers: Record<'choir' | 'bells' | 'pulse' | 'drums' | 'brass' | 'drone', GainNode>;
  private drone: { oscs: OscillatorNode[]; filter: BiquadFilterNode } | null = null;
  private chordAt = 0;
  private chordIndex = 0;
  private step = 0;
  private stepAt = 0;
  private level = { choir: 0, bells: 0, pulse: 0, drums: 0, brass: 0, drone: 0 };
  /** Gritty bass: one soft-clipper shared by every note. */
  private bass: AudioNode;
  /** Notes played (tests). */
  notes = 0;

  constructor(private e: AudioEngine) {
    this.out = e.ctx.createGain();
    this.out.connect(e.buses.music);
    const mk = () => { const g = e.ctx.createGain(); g.gain.value = 0; g.connect(this.out); return g; };
    this.layers = { choir: mk(), bells: mk(), pulse: mk(), drums: mk(), brass: mk(), drone: mk() };
    const sh = shaper(e.ctx, 6), g = e.ctx.createGain();
    g.gain.value = 0.5;
    sh.connect(g).connect(this.layers.drums);
    this.bass = sh;
  }

  start(mode: MusicMode, now = this.e.now): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(mode === 'off' ? 0.0001 : 1, now, mode === 'off' ? 1.2 : 0.8);
    if (mode === 'off') return;
    this.chordAt = now;
    this.chordIndex = 0;
    this.stepAt = now + 0.1;
    this.step = 0;
    this.ensureDrone(now);
  }

  private ensureDrone(now: number): void {
    if (this.drone) return;
    const ctx = this.e.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 300; filter.Q.value = 2;
    const l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = 0.04; lg.gain.value = 140; l.connect(lg).connect(filter.frequency); l.start(now);
    const oscs: OscillatorNode[] = [l];
    for (const [type, det, k] of [['sawtooth', -6, 1], ['sawtooth', 6, 1.5], ['sine', 0, 0.5]] as const) {
      const o = ctx.createOscillator();
      o.type = type; o.detune.value = det; o.frequency.value = mtof(38) * k;
      const g = ctx.createGain(); g.gain.value = type === 'sine' ? 0.22 : 0.16;
      o.connect(g).connect(filter);
      o.start(now);
      oscs.push(o);
    }
    filter.connect(this.layers.drone);
    this.drone = { oscs, filter };
  }

  private chords(intensity: number): Chord[] {
    if (this.mode === 'hive') return HIVE;
    return intensity >= AUDIO.music.combat ? COMBAT : RAID;
  }

  update(now: number, intensity: number, boss: boolean): void {
    if (this.mode === 'off') return;
    const lv = layerLevels(intensity, boss, this.mode);
    for (const k of Object.keys(lv) as (keyof typeof lv)[]) {
      if (Math.abs(lv[k] - this.level[k]) > 0.01) this.layers[k].gain.setTargetAtTime(lv[k], now, k === 'drums' || k === 'pulse' ? 0.6 : 1.5);
      this.level[k] = lv[k];
    }
    const x = this.e.x;
    const set = this.chords(intensity);
    const chordLen = this.mode === 'hive' ? AUDIO.music.hiveChordSeconds : AUDIO.music.chordSeconds * (intensity >= AUDIO.music.combat ? 0.6 : 1);
    // Chord change: the drone glides to the new root and a new choir chord breathes in over the old one.
    if (now >= this.chordAt) {
      const c = set[this.chordIndex % set.length];
      this.chordIndex++;
      this.chordAt = now + chordLen;
      if (this.drone) {
        const [, a, b, sub] = this.drone.oscs;
        a.frequency.setTargetAtTime(mtof(c.root), now, 1.2);
        b.frequency.setTargetAtTime(mtof(c.root + 7), now, 1.4);
        sub.frequency.setTargetAtTime(mtof(c.root - 12), now, 1.2);
        this.drone.filter.frequency.setTargetAtTime(260 + intensity * 900, now, 2);
      }
      if (lv.choir > 0.02) {
        for (const n of c.notes) {
          voice(x, this.layers.choir, now + x.range(0, 0.6), {
            freq: mtof(n), vowel: c.vowel, toVowel: x.rand() < 0.5 ? 'o' : 'u', gain: 0.16, a: chordLen * 0.35, hold: chordLen * 0.4, r: chordLen * 0.7,
            vibrato: 6 + intensity * 14, detune: 9, breath: 0.12,
          });
          this.notes++;
        }
      }
    }
    // Beat grid in eighths.
    if (this.stepAt < now - 0.25) this.stepAt = now + 0.05;
    const bpm = tempo(intensity, boss);
    const eighth = 60 / bpm / 2;
    const c = set[(this.chordIndex + set.length - 1) % set.length];
    while (this.stepAt < now + 0.2) {
      const t = this.stepAt, s = this.step % 16;
      if (lv.bells > 0.02 && x.rand() < AUDIO.music.bellChance * (this.mode === 'hive' ? 0.22 : 0.12)) {
        const n = c.notes[Math.floor(x.rand() * c.notes.length)] + (x.rand() < 0.5 ? 12 : 24);
        fm(x, this.layers.bells, t, { freq: mtof(n), ratio: x.rand() < 0.3 ? 3.5 : 2.0, index: 0.9, gain: 0.11, a: 0.004, d: x.range(2.5, 5) });
        this.notes++;
      }
      if (lv.pulse > 0.02 && (s % 4 === 0)) {
        // A heartbeat that quickens with the tempo.
        tone(x, this.layers.pulse, t, { freq: 72, to: 48, gain: 0.4, d: 0.16 });
        tone(x, this.layers.pulse, t + eighth * 0.55, { freq: 64, to: 44, gain: 0.28, d: 0.18 });
        this.notes++;
      }
      if (lv.pulse > 0.2 && s % 2 === 1) noise(x, this.layers.pulse, t, { gain: 0.05 * lv.pulse, d: 0.02, filters: [{ type: 'bandpass', freq: x.range(3000, 5000), q: 8 }] });
      if (lv.drums > 0.02) this.drums(t, s, eighth, c, boss);
      if (lv.brass > 0.02 && s === 0 && (this.step / 16) % 2 < 1) this.brass(t, c, eighth);
      this.step++;
      this.stepAt += eighth;
    }
  }

  private drums(t: number, s: number, eighth: number, c: Chord, boss: boolean): void {
    const x = this.e.x, o = this.layers.drums;
    // 3-3-2 over each bar: an uneven, stalking gait.
    const bar = s % 8;
    if (bar === 0 || bar === 3 || bar === 6) {
      tone(x, o, t, { freq: bar === 0 ? 78 : 92, to: 38, gain: bar === 0 ? 0.8 : 0.6, d: 0.35 });
      noise(x, o, t, { colour: 'brown', gain: 0.35, d: 0.25, filters: [{ type: 'lowpass', freq: 400 }] });
      // Gritty bass on the root (and the flat second on the last hit of the bar).
      tone(x, this.bass, t, { type: 'sawtooth', freq: mtof(c.root + (bar === 6 && s >= 8 ? 1 : 0)), gain: 0.25, d: eighth * 2.2, filters: [{ type: 'lowpass', freq: 1200, to: 200, over: eighth * 2 }] });
    }
    // Chitin ticks on the off-beats, a metal ring on the backbeat.
    if (s % 2 === 1) noise(x, o, t, { gain: 0.12, d: 0.03, filters: [{ type: 'bandpass', freq: x.range(2500, 4500), q: 6 }] });
    if (bar === 4) fm(x, o, t, { freq: boss ? 147 : 196, ratio: 2.41, index: 4, gain: 0.12, d: 0.8 });
    this.notes++;
  }

  private brass(t: number, c: Chord, eighth: number): void {
    const x = this.e.x;
    for (const n of [c.root + 12, c.root + 13, c.root + 19]) {
      tone(x, this.layers.brass, t, { type: 'sawtooth', freq: mtof(n), gain: 0.12, a: 0.06, hold: eighth * 3, d: eighth * 4, filters: [{ type: 'lowpass', freq: 300, to: 1600, over: 0.25 }], vibrato: { rate: 5, depth: 8 } });
    }
    this.notes++;
  }
}
