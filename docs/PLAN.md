# Production Plan

The game is built as a chain of evolving playable builds. Ten department threads report to the project coordinator; Brandon deals only with the coordinator. Rules for every thread are in `/CLAUDE.md`; the look is in `ART_BIBLE.md`.

## The evolution chain
Every iteration ends with a build Brandon can play from a link. His feedback seeds the next one.

1. **Spore — first playable.** First-person Neuro-Infiltrator on a 300 m Zone 7 island; Synapse Burster spore gun; two Abomination types that attack and die with glowing gore; Biomass and Neural Overload HUD; one loot container; extract to win, die to lose. Exit: a 5-minute raid can be finished; smoke test green; look-dev screenshot beside reference 04.
2. **Larva — the full loop.** Hive main menu, class select, raid select; persistent stash; internal-cavity inventory; corpse harvesting; mid-raid virus injection that visibly mutates the host; procedural creature generator with five Abomination types and a wave-spawning nest. Exit: loot from raid N is usable in raid N+1; death loses the loadout.
3. **Host — three classes and rivals.** Venom-Wraith, Neuro-Infiltrator, Gore-Behemoth with base kits and first evolutions; rival host bots (single-player PvPvE); Genetic Synapse tree, Viral Lab, Flesh Market; 1 km map with shifting extracts and anomalies; full audio pass; art pass on every screen.
4. **Hive — real multiplayer.** Online raids of up to 12 hosts, Hive-Mind squads of 3, lobby, server-side stash. Exit: a 4-player raid over the internet.
5. **Apex — content and polish.** Advanced evolutions (Acid Parasite, Shadow-Stalker, Xenoflyer, Neuro-Hound, Spore-Caster, Psych-Warlock, Crustacean Grunt, Gore-Gorgon, Juggernaut-Titan), raid boss, more biomes, tuned economy, desktop build for a Steam playtest.

After Apex each new iteration is a themed mutation (new biome, class line, seasonal virus) planned from playtest data.

## Departments
| # | Department | Wave | Owns | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Build, QA & Release | 1 | CI, `tests/`, publishing | repo |
| 2 | Game Design | 1 | `docs/gdd/`, `data/` | this plan |
| 3 | Gameplay Engineering | 1 | `src/game/` | 1, 2 |
| 4 | Rendering & Tech Art | 1 | `src/render/` | 1, Art Bible |
| 5 | Creature & Mutation | 2 | `src/creatures/` | 3, 4 |
| 6 | PvE AI & Encounters | 2 | `src/ai/` | 3, 5 |
| 7 | World & Level | 2 | `src/world/` | 4 |
| 8 | UI & HUD | 2 | `src/ui/` | 2, 3 |
| 9 | Audio | 3 | `src/audio/`, `assets/audio/` | 3, 5 |
| 10 | Online & Backend | 3 | `server/` | 3 |

No more than four threads run at once. Wave 2 opens when Spore ships; wave 3 during Host.

### 1. Build, QA & Release
Own CI (build, Vitest, headless Playwright smoke with screenshots on every PR), publishing of each iteration as a playable web page, patch notes, the performance budget (60 fps at 1080p on RTX 3060 class, load under 15 s), and an end-of-iteration bug bash that files issues.

### 2. Game Design
Write the GDD as short living docs: core loop, three classes (resolve stat conflicts between the reference screens), Genetic Synapse tree, viruses and mutagens, loot tables, stash and extraction rules, economy and Flesh Market, enemy roster, PvP rules. All tunables as JSON in `data/`. Write each iteration's feature list with acceptance criteria; tune from playtests.

### 3. Gameplay Engineering
First-person controller on Rapier (sprint, slide, mantle, class speed and noise), third-person camera for the lab, weapon framework (first weapon: Synapse Burster), data-driven ability system for mutations and viruses with Neural Overload as resource, Biomass with limb damage, loot containers, corpse harvesting, internal-cavity inventory grid, mid-raid virus injection, extraction timer, win and loss. Emit events for UI, audio and AI.

### 4. Rendering & Tech Art
Own the look. Hive and Zone 7 lighting and grading presets. Shaders: wet chitin with subsurface, veined membrane, pulsing bioluminescent nodes, iridescent fungus, liquid light, gore decals and wounds, dissolve-mutate transition. Post FX: bloom, ambient occlusion, volumetric fog, chromatic aberration on Neural Overload, LUT grading. Evaluate the WebGPU renderer and move to it when stable in headless tests. Side-by-side screenshots against each reference every iteration.

### 5. Creature & Mutation
Procedural creature generator: body-plan graph, SDF skin meshed to skinned meshes, part library (blades, carapace, spines, frills, pustules, fungal and crystal growths), procedural IK locomotion (2, 4, 6 legs, flight, hover). Mutation as live graph change with dissolve-grow. Gore: wound decals, glowing fluid, dismemberment, harvestable organs. Three host classes plus eight Abominations. A creature-viewer page for review.

### 6. PvE AI & Encounters
Abomination behaviours (stalker, swarm, flyer, tank, spitter, boss), perception by noise and light, wave-spawning nests, rival host bots that loot, fight and extract.

### 7. World & Level
Zone 7: floating islands, fungal forests, liquid-light falls, crashed bio-tech, nests and nodes. 300 m pocket for Spore, 1 km with 3 to 5 biomes for Host. Shifting extracts and anomalies. Streaming and LOD. Data for the raid-select map.

### 8. UI & HUD
All screens to the Art Bible: main menu, class select, Genetic Evolution and Viral Lab, Genetic Synapse, stash and inventory, raid select, Flesh Market, Hive-Mind lobby, settings, in-raid HUD. Keyboard and controller. Mock as static pages and screenshot before wiring.

### 9. Audio
Wet, chitinous, synthetic, choral. Weapons, creatures, footsteps by class and surface, mutation, UI, ambience, adaptive music. Procedural synthesis and CC0 only, logged in `assets/audio/LICENSES.md`.

### 10. Online & Backend
Colyseus authoritative server, lobby and squads, 12-host raids, prediction and reconciliation, lag-compensated hits, server-side loot and stash (SQLite), server validation of movement, damage and inventory. One-command local run; hosting plan and cost.
