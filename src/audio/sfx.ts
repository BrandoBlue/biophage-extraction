/**
 * Code-generated sound (Web Audio, no files): the living guns' shots, reloads, swaps and the thwack of hits.
 * Every sound is synthesised from noise and oscillators, shaped per weapon class so a shotgun booms, a sidearm
 * snaps, a sniper cracks and a launcher thumps, with a wet organic tail on all of them (they are alive).
 * Listens on the raid bus; volume comes from Settings. The context starts on the first click or key press
 * (browsers block audio before a gesture), so headless tests stay silent.
 */
import { weaponSpec, type WeaponClass } from '../../data';
import type { EventBus } from '../game/events';
import { getSettings } from '../ui/settings';

interface ShotVoice {
  /** Noise burst band centre (Hz), its Q, and how long it rings (s). */
  band: number; q: number; decay: number;
  /** A pitched body under the noise: start and end frequency (Hz) and length (s). */
  body: [number, number, number];
  /** Low thump for heavy guns (0..1). */
  thump: number;
  gain: number;
}

/** Shot voices per weapon class. Sound design numbers, not balance. */
const SHOT: Record<WeaponClass, ShotVoice> = {
  carbine: { band: 1500, q: 0.9, decay: 0.12, body: [320, 110, 0.09], thump: 0.25, gain: 0.55 },
  sidearm: { band: 2200, q: 1.1, decay: 0.08, body: [520, 180, 0.06], thump: 0.15, gain: 0.5 },
  smg: { band: 2600, q: 1.0, decay: 0.06, body: [440, 200, 0.05], thump: 0.1, gain: 0.42 },
  rifle: { band: 1200, q: 0.8, decay: 0.16, body: [260, 80, 0.12], thump: 0.4, gain: 0.6 },
  shotgun: { band: 650, q: 0.6, decay: 0.32, body: [160, 45, 0.25], thump: 0.9, gain: 0.8 },
  marksman: { band: 1000, q: 1.2, decay: 0.26, body: [300, 70, 0.18], thump: 0.5, gain: 0.7 },
  sniper: { band: 850, q: 1.4, decay: 0.45, body: [240, 50, 0.3], thump: 0.7, gain: 0.85 },
  launcher: { band: 380, q: 0.7, decay: 0.3, body: [120, 40, 0.35], thump: 1, gain: 0.8 },
  beam: { band: 3200, q: 3, decay: 0.35, body: [1400, 220, 0.4], thump: 0.3, gain: 0.6 },
  relic: { band: 1800, q: 2, decay: 0.4, body: [700, 140, 0.35], thump: 0.6, gain: 0.7 },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastShot = 0;
  private classOf = new Map<string, WeaponClass>();

  constructor(bus: EventBus) {
    const start = () => this.start();
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);
    addEventListener('biophage:settings', () => this.applyVolume());
    bus.on('shot', (e) => this.shot(e.weapon, e.ego));
    bus.on('reloadBeat', (e) => this.cue(e.cue));
    bus.on('ammoFed', () => this.gulp());
    bus.on('reloaded', () => this.click(900, 0.35));
    bus.on('weaponSwap', () => this.whoosh());
    bus.on('weaponPickup', () => { this.whoosh(); this.click(600, 0.3); });
    bus.on('hit', (e) => this.hit(e.weakPoint, e.kill));
  }

  private start(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.connect(comp).connect(this.ctx.destination);
    this.applyVolume();
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private applyVolume(): void { if (this.master) this.master.gain.value = getSettings().volume * 0.7; }

  private ready(): AudioContext | null { return this.ctx && this.master && this.noise && this.ctx.state === 'running' ? this.ctx : null; }

  private cls(weapon: string): WeaponClass {
    let c = this.classOf.get(weapon);
    if (!c) { try { c = weaponSpec(weapon).class; } catch { c = 'carbine'; } this.classOf.set(weapon, c); }
    return c;
  }

  /** A noise burst through a band-pass filter. */
  private burst(t: number, band: number, q: number, decay: number, gain: number, sweep = 0.6): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(band * (1.1 + Math.random() * 0.15), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, band * sweep), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5, decay + 0.05);
  }

  /** A pitched tone gliding from f0 to f1. */
  private tone(t: number, f0: number, f1: number, len: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(this.master!);
    o.start(t); o.stop(t + len + 0.02);
  }

  shot(weapon: string, ego = false): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Fast automatics would stack dozens of voices; keep at most one every 25 ms.
    if (t - this.lastShot < 0.025) return;
    this.lastShot = t;
    const v = SHOT[this.cls(weapon)] ?? SHOT.carbine;
    const k = ego ? 1.3 : 1;
    this.burst(t, v.band, v.q, v.decay * k, v.gain * k);
    this.tone(t, v.body[0] * (0.95 + Math.random() * 0.1), v.body[1], v.body[2] * k, v.gain * 0.5, 'triangle');
    if (v.thump > 0) this.tone(t, 110, 38, 0.12 + v.thump * 0.12, v.gain * v.thump * 0.9);
    // The wet tail: something alive just spat.
    this.burst(t + 0.02, 500, 4, 0.1 + v.decay * 0.4, v.gain * 0.18, 0.3);
    if (ego) this.tone(t, 1800, 300, 0.4, 0.25, 'sawtooth');
  }

  /** Reload: a slick, sucking squelch. */
  private squelch(gain: number, pitch: number, len: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.burst(t, 700 * pitch, 5, len, gain, 0.25);
    this.tone(t, 260 * pitch, 90 * pitch, len * 0.8, gain * 0.5);
  }

  /** A reload beat's sound cue (weapon-feel.json), matched by its words: wet, tearing, hard or breathing sounds. */
  private cue(cue: string): void {
    const c = cue.toLowerCase();
    if (/rip|tear/.test(c)) { const ctx = this.ready(); if (ctx) this.burst(ctx.currentTime, 1600, 0.8, 0.18, 0.35, 0.4); }
    else if (/click|clack|chitin|snap/.test(c)) this.click(/soft/.test(c) ? 600 : 900, 0.3);
    else if (/gulp/.test(c)) this.gulp();
    else if (/hum|heart|exhale|breath/.test(c)) { const ctx = this.ready(); if (ctx) this.tone(ctx.currentTime, /heart/.test(c) ? 70 : 140, /exhale/.test(c) ? 60 : 90, 0.35, 0.3); }
    else if (/creak/.test(c)) { const ctx = this.ready(); if (ctx) this.tone(ctx.currentTime, 220, 120, 0.25, 0.2, 'sawtooth'); }
    else this.squelch(0.35, /suck/.test(c) ? 1.3 : 1.0, 0.3); // squelch, suck and anything wet
  }

  /** One round gulped down a per-shell feed. */
  private gulp(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 180, 420, 0.07, 0.3);
    this.burst(t, 900, 6, 0.06, 0.15);
  }

  private click(freq: number, gain: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, freq, freq * 0.6, 0.05, gain, 'square');
    this.burst(t, freq * 2, 3, 0.04, gain * 0.5);
  }

  private whoosh(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.burst(ctx.currentTime, 1200, 0.7, 0.22, 0.2, 0.3);
  }

  /** Hit feedback: a dull thwack, a bright ping on a weak point, a heavy crunch on a kill. */
  private hit(weak: boolean, kill: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    this.burst(t, weak ? 2400 : 900, 2, 0.05, 0.22);
    if (weak) this.tone(t, 1900, 1500, 0.08, 0.16, 'sine');
    if (kill) { this.tone(t, 140, 50, 0.2, 0.4); this.burst(t, 400, 1, 0.2, 0.3, 0.3); }
  }
}
