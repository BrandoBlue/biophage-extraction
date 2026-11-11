# BIOPHAGE: EXTRACTION

A sci-fi bio-cybernetic PvPvE extraction shooter. You are a virus-ridden alien host dropped into Zone 7: loot, mutate, evolve, extract. Die and you lose what you carried.

## Play the current build

```bash
npm install
npm run dev      # then open the printed http://localhost:5173 link in Chrome or Edge
```

Click the screen to take control. WASD to move, Shift to sprint, Space to jump, Esc to release the mouse.

Or build the single-file release and open it straight from disk, no server needed:

```bash
npm run release  # writes release/biophage-<version>.html; double-click it
```

## Checks

```bash
npm run check    # type-check, build and pack the release, unit tests, smoke tests (served and single-file), size budget
```

Shipping and release steps: `docs/RELEASING.md`.

## Where things live

| Path | What | Owner department |
| --- | --- | --- |
| `docs/PLAN.md` | Production plan, departments, the evolution chain | Studio director |
| `docs/ART_BIBLE.md`, `docs/reference/` | The look every department must match | Rendering & Tech Art |
| `docs/gdd/`, `data/` | Game design and all balance numbers | Game Design |
| `src/game/` | Player, weapons, loot, extraction | Gameplay Engineering |
| `src/render/` | Renderer, shaders, post FX, palette | Rendering & Tech Art |
| `src/creatures/` | Procedural creatures, mutations, gore | Creature & Mutation |
| `src/ai/` | Abominations, encounters, rival host bots | PvE AI & Encounters |
| `src/world/` | Zone 7 | World & Level |
| `src/ui/` | Hive menus and in-raid HUD | UI & HUD |
| `src/audio/` | Sound and music | Audio |
| `server/` | Multiplayer and persistence | Online & Backend |
| `tests/`, `.github/`, `scripts/`, `docs/RELEASING.md`, `docs/releases/` | CI, smoke tests, release packaging, patch notes | Build, QA & Release |

## The evolution chain

Spore (first playable) → Larva (full loot-mutate-extract loop) → Host (three classes, rival bots) → Hive (online multiplayer) → Apex (content and polish). Every iteration ships a playable build. Details in `docs/PLAN.md`.
