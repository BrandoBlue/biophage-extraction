/**
 * Typed access to data/audio.json (Audio department tunables). Zone ambience profiles resolve here so a zone that
 * World adds later (a desert, the pit) still sounds right before it gets its own entry.
 */
import audioJson from '../../data/audio.json';

export type EmitterKind =
  | 'distantCall' | 'insect' | 'bubble' | 'sporeSigh' | 'chime' | 'drip' | 'creak' | 'whisper'
  | 'clank' | 'embryo' | 'sandHiss' | 'rumble' | 'croak' | 'splash'
  | 'duneRace' | 'herdHum' | 'heatShimmer' | 'mistHum' | 'swarm' | 'pitBreath' | 'ropeCreak' | 'boneClack' | 'lanternHum';
export type BedKind = 'marsh' | 'cave' | 'hull' | 'dunes' | 'hive' | 'fen';

/** `dread`: calls more often the deeper the host is (Marrow Pit). */
export interface Emitter { kind: EmitterKind; perMinute: number; level: number; range: [number, number]; dread?: boolean }
export interface AmbienceProfile {
  wind: number; windCutoff: number; hum: number; humFreq: number; bed: BedKind; reverb: 'open' | 'enclosed';
  emitters: Emitter[];
}
export type Weight = 'light' | 'medium' | 'heavy';

interface AudioData {
  mix: {
    master: number; music: number; ambience: number; sfx: number; ui: number; reverbOpen: number; reverbEnclosed: number;
    lowHealthMuffleAt: number; lowHealthCutoff: number; maxVoices: number;
  };
  spatial: { refDistance: number; maxDistance: number; rolloff: number; airAbsorbFrom: number; airAbsorbCutoffFar: number };
  music: {
    tension: number; combat: number; rise: number; fall: number; bpmCalm: number; bpmCombat: number; bpmBoss: number;
    chordSeconds: number; bellChance: number; hiveChordSeconds: number; threatRadius: number; damageBump: number;
    bossFloor: number; hushDuck: number;
  };
  footsteps: {
    stride: Record<Weight, number>; sprintStride: number; level: Record<Weight, number>; crouchLevel: number; landMinFall: number;
  };
  creatures: { hearing: number; nearest: number; idle: [number, number]; hunt: [number, number]; stalkWarnRadius: number; heavyStepEvery: number };
  aliases: Record<string, string>;
  pitDepth: { floorY: number; extra: number; intensityFloor: number; heartbeatFrom: number };
  edge: { from: number; to: number; level: number; musicDuck: number; perMinute: { shift: number; wet: number; call: number }; range: [number, number] };
  zones: Record<string, AmbienceProfile>;
}

function strip<T>(o: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (k !== '_note') out[k] = v && typeof v === 'object' && !Array.isArray(v) ? strip(v as Record<string, unknown>) : v;
  return out as T;
}

export const AUDIO = strip<AudioData>(audioJson as unknown as Record<string, unknown>);

/** Ambience profile for a zone id or an environment ('cave', 'hive'): exact id, then keyword, then default. */
export function ambienceFor(id: string): AmbienceProfile {
  const z = AUDIO.zones;
  if (z[id]) return z[id];
  const alias = AUDIO.aliases[id];
  if (alias && z[alias]) return z[alias];
  const k = id.toLowerCase();
  if (/fen$|fen[^a-z]|swamp|bog|weeping/.test(k)) return z.fen;
  if (/desert|sand|dune|savann?ah?|waste/.test(k)) return z.desert;
  if (/pit|abyss|maw|depth/.test(k)) return z.pit;
  if (/cave|grotto|hollow|warren/.test(k)) return z.cave;
  if (/wreck|hull|ship/.test(k)) return z.longSeedWreck;
  return z.default;
}
