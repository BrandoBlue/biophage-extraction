# Audio

Owner: Audio department (`src/audio/`, `data/audio.json`). Brief in `docs/PLAN.md`: wet, chitinous, synthetic, choral.

Every sound is synthesised in the browser at runtime with Web Audio: shaped noise, oscillators, FM bells, formant
(sung-vowel) voices and a generated reverb. There are no sample files, so nothing to license, nothing to download and
nothing added to the release size beyond the code.

Listen without playing: `npm run sound-tour` renders an 85-second walk through the game's sound offline
(`src/audio/tour.ts`) to `tests/out/sound-tour.wav`.

## How it fits together

| File | What |
| --- | --- |
| `game-audio.ts` | Binds to the raid's event bus and reads the raid each frame. Starts the AudioContext on the first click or key press (browser autoplay rules). |
| `engine.ts` | Mixer: music, ambience, sfx and UI buses, open and enclosed reverbs, low-health muffle, limiter, HRTF 3D placement with air absorption, voice budget. |
| `synth.ts` | Primitives: `noise`, `tone`, `fm`, `voice` (formants), `impulse`, `shaper`. |
| `sfx.ts` | Weapons per class, reload beats (keyed by the `cue` strings in `data/weapon-feel.json`), impacts, the host's body, gear, extraction, footsteps per surface and class weight, Hive UI. |
| `voices.ts` | A vocabulary per creature species (idle, hunt, attack, death, heavy steps) and per boss (wake, phase, enrage, attacks, hurt, defeated). Ambience one-shots. |
| `ambience.ts` | Zone beds (wind with gusts, hum, the zone's texture) and 3D one-shots around the listener. |
| `music.ts` | Adaptive score: drone, choir, bells (explore), heartbeat pulse (tension), 3-3-2 drums and gritty bass (combat), brass stabs (boss). |
| `director.ts` | Pure logic (unit-tested): threat to intensity, stride counting, surface, what is behind you. |

## Design rules

- Creatures are heard before they are seen. Each species has its own tell; an engaged creature closing in behind you
  gets one faint chitter (fair warning). Unknown species fall back to a generic set: add an entry in `SPECIES`.
- The Pale Vigil is silence: when it stalks, music and ambience duck almost to nothing and the host's heartbeat is all
  that is left. Its shriek is the loudest thing in the game.
- Music intensity rises fast and drains slowly. Thresholds, tempos and levels are in `data/audio.json`.
- Below 30% Biomass the world muffles and the heartbeat takes over.
- Zone ambience: `data/audio.json` `zones` (profiles) and `aliases` (zone id to profile). A new zone with no entry
  falls back by keyword (desert, pit, fen, cave, wreck) then to `default`.

## Adding sound for something new

1. A creature: add `SPECIES.<id>` in `voices.ts`. `tests/audio.test.ts` fails until every id in
   `data/abominations.json` and `data/bosses.json` has a voice.
2. A gameplay event: add it to `src/game/events.ts` (Gameplay) and a `bus.on` line in `game-audio.ts`.
3. A reload cue: any new `cue` string in `data/weapon-feel.json` needs a recipe in `RELOAD_CUES` (tested).
