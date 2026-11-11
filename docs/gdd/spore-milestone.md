# Spore milestone: feature list and acceptance criteria

**Goal:** a first playable Brandon opens from a link: drop onto a Zone 7 island as the Neuro-Infiltrator, fight two Abomination types with the Synapse Burster, loot a Bio-Pod, and extract or die. A full raid takes about 2 to 4 minutes.

**Exit criteria (whole milestone):**
- [ ] A 5-minute raid can be finished both ways (EXTRACTED and HOST LOST) by a person with keyboard and mouse.
- [ ] `npm run check` green, including smoke test.
- [ ] Look-dev screenshot of combat beside `docs/reference/04-in-raid-combat.webp` in the release PR.
- [ ] Every balance number read from `data/` through `data/index.ts`.

## Gameplay Engineering (`src/game/`)
| Feature | Accept when |
| --- | --- |
| Controller: walk, sprint, jump, class speed | Infiltrator walks 5.2 m/s, sprints ×1.5; values from `CLASSES.neuroInfiltrator` |
| Neural Overload heat meter | Fills and decays per `HOST.neuralOverload`; at max: 2.5 s no sprint/abilities, resets to 60; a Vitest proves sprinting from 0 Overloads in about 11 s |
| Biomass and hit zones | Host dies at 0; damage events carry zone and source |
| Synapse Burster primary | Projectiles, not hitscan; rate, magazine, regrow reload, falloff, spread from `WEAPONS.synapseBurster`; no fire while sprinting |
| Ego Charge | Fills per hit/weak-point hit; at 30, alt fire launches 6 seeking spores and fills Overload 30 |
| Psych-Wave Pulse, Clot Gel | Slot 1 and 2, costs and effects from `ABILITIES` |
| Bio-Pod | Hold 1.5 s to open, roll with `rollContainer('bioPod', rng)`, add to carried list, emit noise |
| Seed Spire extraction | 4 m zone, 10 s channel via `extractTimeFor`, resets on leave, emits 40 m noise; at end: EXTRACTED |
| Raid timer and collapse | 10:00, warning at 2:00 left, 25/s after 0:00 |
| Results | EXTRACTED shows `haulValue(items, killDna)`; HOST LOST shows what was lost; "Deploy again" restarts |
| Events | Emits `shot`, `hit {weakPoint, kill}`, `damaged {direction}`, `overload`, `pickup`, `extractStart/Progress/Done`, `death`, `noise {pos, radius}` for UI, AI, audio |
| Creature AI (interim, until PvE AI dept in wave 2) | Needlemaw pack chase and lunge with wind-up; Cantor hover, keep range, arcing glob and acid pool; perception from `ABOMINATIONS.*.perception` and noise events; spawns and reinforcements from `RAID` |

## Rendering & Tech Art (`src/render/`)
| Feature | Accept when |
| --- | --- |
| Zone 7 grade | Screenshot reads as reference 04: void-indigo sky with nebula and a ringed planet, magenta/cyan/violet/lime emissives, dark shadows |
| Bioluminescent materials | Fungi, falls of liquid light, creature nodes glow with bloom; weak points are the brightest thing on each creature |
| Gore | Hit spurts of glowing fluid (cyan Needlemaw, violet Cantor), wound decals, death burst; no red except player damage |
| Synapse Burster view model | Fleshy gun with eyes, tentacle feeds, crystal that glows with Ego Charge; matches reference 04 bottom right |
| Overload FX | Chromatic aberration and vignette scale with Overload; strong distortion when Overloaded |
| Performance | 60 fps target, smoke test stays green in software rendering |

## Build, QA & Release
| Feature | Accept when |
| --- | --- |
| Playable link | Each merged Spore build published to a URL Brandon can open |
| Smoke | Loads, renders N frames, screenshot attached; asserts the HUD shows Biomass and Overload |
| Raid script test | A scripted run (test hooks on `window.__biophage`) can trigger extract and death and see each result screen |
| Patch notes | One short list per published build |

## Game Design (this department)
| Feature | Accept when |
| --- | --- |
| Data and docs | This folder and `data/*.json` with typed loader and integrity tests (done in this PR) |
| Playtest tune | After the first playable, play-test from a recorded run and tune the tables; log changes in `data/CHANGELOG.md` |
| Larva spec | Larva feature list with acceptance criteria ready before wave 2 opens |

## HUD (built by Gameplay or Rendering in Spore; UI & HUD dept rebuilds it in wave 2)
Biomass bar with value, Neural Overload bar, eyeball portrait reacting to Overload and damage, Psych-Wave Scanner (round, shows extract bearing and pulse pings), five ability slots (1 and 2 live), weapon panel with spores in magazine and Ego Charge ring, raid timer, carried-loot icons, extract progress ring. Hit-markers only, no damage numbers.

## Out of scope for Spore
Other classes, inventory grid, persistence, corpse harvesting, viruses, Synapse tree, menus beyond the result screen, multiplayer, audio beyond placeholder.
