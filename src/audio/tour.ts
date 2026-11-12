/**
 * Sound tour (Audio tooling, not shipped): renders a scripted 85-second walk through the game's sound offline so
 * people can listen without playing: the Hive, exploring Glowmire, a fight, the Pale Vigil's silence, the
 * Reliquary, extraction. tests/sound-tour.mjs runs it in headless Chromium and writes an audio file.
 */
import { AudioEngine, type V3 } from './engine';
import { Ambience } from './ambience';
import { Music } from './music';
import { ambienceFor } from './config';
import * as S from './sfx';
import { bossVoice, ribWind, speciesVoice, stalkWarn } from './voices';

export const TOUR_SECONDS = 86;

export async function renderTour(sampleRate = 44100): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(TOUR_SECONDS * sampleRate), sampleRate);
  const e = new AudioEngine(ctx);
  const music = new Music(e), amb = new Ambience(e);
  const x = e.x;
  e.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  const at = (p: V3, near = 1) => e.at(p, 3, 'sfx', near);
  const fx = (r: S.Recipe, t: number, p: V3 | null = null, level = 1) => { const g = ctx.createGain(); g.gain.value = level; g.connect(p ? at(p) : e.buses.sfx); r(x, g, t); };
  const ui = (r: S.Recipe, t: number) => r(x, e.buses.ui, t);
  const L = (dx: number, dz: number, dy = 0.8): V3 => ({ x: dx, y: 1.7 + dy, z: dz });

  // --- The Hive (0-12 s)
  music.start('hive', 0);
  amb.set(ambienceFor('hive'), 1, 0);
  for (const t of [2.5, 3.1, 3.6, 5.2, 6]) ui(S.uiHover, t);
  ui(S.uiClick, 4); ui(S.uiTab, 7.5); ui(S.uiClick, 9); ui(S.uiDeploy, 11);
  // --- Drop into Glowmire (12-30 s)
  amb.set(ambienceFor('glowmireIsle'), 3, 12.5);
  fx(S.dropIn, 12.2);
  fx((a, o, t) => S.land(a, o, t, 'moss', 'medium', 8), 15);
  for (let t = 16; t < 24; t += 0.55) fx((a, o, tt) => S.footstep(a, o, tt, 'moss', 'medium', 0.65), t);
  fx(speciesVoice('lumenGrazer').idle, 17, L(-14, -6));
  fx(speciesVoice('mournback').idle, 19.5, L(30, -35, 4));
  fx(speciesVoice('bilecantor').idle, 22.5, L(12, -10));
  fx(S.membraneTear, 25); fx(S.pickup, 26.3); fx(S.dnaChime, 26.4);
  fx(stalkWarn, 28.6, L(2, 5, 0));
  // --- A fight (30-48 s)
  fx(speciesVoice('needlemaw').hunt, 30, L(6, 6));
  fx(speciesVoice('needlemaw').hunt, 30.6, L(-7, -4));
  for (let t = 31; t < 33.6; t += 0.11) { fx((a, o, tt) => S.FIRE.carbine(a, o, tt, false), t); if (x.rand() < 0.5) fx(S.fleshHit, t + 0.05, L(5, -6), 0.8); }
  fx(S.hitTick(true), 32.2);
  fx(speciesVoice('needlemaw').attack, 33.8, L(1.5, -2));
  fx(S.hurt(true), 34.1);
  for (const b of [[0, 'low hum'], [0.5, 'heartbeat'], [0.95, 'exhale']] as const) fx(S.RELOAD_CUES[b[1]], 35 + b[0] * 2.2);
  fx((a, o, t) => S.FIRE.shotgun(a, o, t, false), 38); fx(S.killBurst, 38.05, L(3, -4));
  fx(speciesVoice('needlemaw').death, 38.1, L(3, -4));
  fx((a, o, t) => S.FIRE.shotgun(a, o, t, false), 39.2);
  fx(speciesVoice('oculimoth').hunt, 40.5, L(-6, -12, 6));
  for (let t = 41.5; t < 43.5; t += 0.16) fx((a, o, tt) => S.FIRE.rifle(a, o, tt, false), t);
  fx(speciesVoice('oculimoth').death, 43.6, L(-6, -12, 5));
  fx((a, o, t) => S.FIRE.carbine(a, o, t, true), 45);
  fx(speciesVoice('glasswalker').death, 45.2, L(4, -15));
  // --- The Pale Vigil's cave (48-60 s): the world goes quiet, then it shrieks.
  amb.set(ambienceFor('cave'), 3, 48);
  for (let t = 49; t < 56; t += 0.7) fx((a, o, tt) => S.footstep(a, o, tt, 'stone', 'medium', 0.4), t);
  for (const b of ['music', 'ambience'] as const) { e.duck(b, 0.08, 1.2, 51); e.duck(b, 1, 1.5, 58.5); }
  for (let t = 52; t < 57; t += 60 / 64) fx((a, o, tt) => S.heartbeat(a, o, tt, 0.55), t);
  fx(bossVoice('paleVigil').attacks.reappear, 55.6, L(0.5, 3, 0.5));
  fx(bossVoice('paleVigil').attacks.shriek, 57, L(0, 3, 1.5));
  fx(bossVoice('paleVigil').attacks.lunge, 57.9, L(0, 2, 0));
  fx(S.hurt(true), 58.2);
  // --- The Reliquary (60-72 s)
  amb.set(ambienceFor('glowmireIsle'), 3, 60);
  fx(ribWind, 60, L(10, -40, 10));
  fx(bossVoice('reliquary').wake, 62.5, L(5, -30, 6));
  fx(bossVoice('reliquary').attacks.stamp, 66, L(3, -14));
  fx(bossVoice('reliquary').attacks.hymn, 68, L(0, -18, 5));
  fx(S.explosion, 70.5, L(2, -12));
  // --- Extraction (72-86 s)
  fx(S.spireCall, 72, L(-20, -40, 8));
  fx(S.extractRiser(6), 73.5);
  fx(S.extractDone, 79.6);

  const intensity = (t: number) => t < 29 ? 0.05 : t < 30 ? 0.3 : t < 46 ? 0.85 : t < 50 ? 0.5 : t < 57 ? 0.35 : t < 62 ? 0.8 : t < 72 ? 1 : 0.5;
  for (let t = 0; t < TOUR_SECONDS; t += 0.05) {
    if (t >= 12 && music.mode === 'hive') music.start('raid', t);
    if (t >= 79.6 && music.mode === 'raid') music.start('off', t);
    music.update(t, intensity(t), t >= 62.5 && t < 72);
    amb.update(t);
  }
  return ctx.startRendering();
}

export const ZONE_TOUR_SECONDS = 72;

/** The new zones: the Ochre Reach, the Weeping Fen, then down the Marrow Pit from rim to floor. */
export async function renderZoneTour(sampleRate = 44100): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(ZONE_TOUR_SECONDS * sampleRate), sampleRate);
  const e = new AudioEngine(ctx);
  const music = new Music(e), amb = new Ambience(e);
  const x = e.x;
  e.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  const fx = (r: S.Recipe, t: number, p: V3 | null = null, level = 1) => { const g = ctx.createGain(); g.gain.value = level; g.connect(p ? e.at(p, 3) : e.buses.sfx); r(x, g, t); };
  const L = (dx: number, dz: number, dy = 0.8): V3 => ({ x: dx, y: 1.7 + dy, z: dz });
  const steps = (from: number, to: number, surface: S.Surface, gap = 0.55, level = 0.6) => { for (let t = from; t < to; t += gap) fx((a, o, tt) => S.footstep(a, o, tt, surface, 'medium', level), t); };

  // Ochre Reach (0-22 s)
  music.flavour = 'desert'; music.start('raid', 0);
  amb.set(ambienceFor('ochreReach'), 1, 0);
  steps(1, 9, 'sand');
  fx(speciesVoice('bristleback').idle, 4, L(-30, -40, 2));
  fx(speciesVoice('dunewake').hunt, 10, L(8, -10, -0.5));
  fx(speciesVoice('dunewake').attack, 12.5, L(2, -3, -0.5));
  fx(S.burst('ambush'), 12.4, L(2, -3, -0.5));
  for (let t = 13.5; t < 15.5; t += 0.5) fx((a, o, tt) => S.FIRE.shotgun(a, o, tt, false), t);
  fx(speciesVoice('dunewake').death, 15.6, L(2, -4, 0));
  // Weeping Fen (22-44 s)
  amb.set(ambienceFor('weepingFen'), 3, 22);
  steps(23, 33, 'water', 0.7);
  fx(speciesVoice('mistwader').idle, 26, L(30, -50, 10));
  fx(speciesVoice('fenstalker').idle, 31, L(-6, -8, -0.5));
  fx(speciesVoice('fenstalker').hunt, 34, L(-4, -5, 0));
  fx(speciesVoice('fenstalker').attack, 35.5, L(-1.5, -2, 0));
  fx(speciesVoice('mirebrood').hunt, 38, L(6, 4, 0));
  // Marrow Pit, rim to floor (44-72 s)
  const pit: [number, string][] = [[44, 'pitRim'], [51, 'pitCables'], [58, 'pitWarrens'], [65, 'pitDeep']];
  for (const [t, id] of pit) amb.set(ambienceFor(id), 2.5, t);
  steps(45, 50, 'stone', 0.6);
  steps(51, 57, 'stone', 0.75, 0.4);
  steps(58, 64, 'stone', 0.8, 0.35);
  steps(65, 70, 'flesh', 0.85, 0.3);
  fx(speciesVoice('cablecrawler').hunt, 53, L(5, 4, 2));
  fx(speciesVoice('hollowed').idle, 60, L(-8, -6));
  fx(speciesVoice('shroudling').idle, 62, L(3, 6));
  for (let t = 66; t < 72; t += 60 / 56) fx((a, o, tt) => S.heartbeat(a, o, tt, 0.35), t);

  for (let t = 0; t < ZONE_TOUR_SECONDS; t += 0.05) {
    if (t >= 22 && music.flavour === 'desert') { music.flavour = 'fen'; }
    if (t >= 44 && music.flavour === 'fen') { music.flavour = 'pit'; }
    const dread = t < 44 ? 0 : Math.min(1, (t - 44) / 24);
    music.dread = dread; amb.dread = dread;
    const intensity = t >= 10 && t < 17 ? 0.85 : t >= 34 && t < 40 ? 0.8 : Math.max(0.05, dread * 0.38);
    music.update(t, intensity, false);
    amb.update(t);
  }
  return ctx.startRendering();
}
