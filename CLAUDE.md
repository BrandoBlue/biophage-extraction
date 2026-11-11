# BIOPHAGE: EXTRACTION — rules for every department thread

Read `docs/PLAN.md` (your department brief and the current iteration) and `docs/ART_BIBLE.md` before you start.

## Non-negotiables
- `main` is always playable. Run `npm run check` before every push; it must pass.
- Work on a branch `dept/<department>/<topic>`, one PR per change, small PRs.
- Stay inside your department's paths (see README). To change another department's code, keep the change minimal and say so in the PR.
- Every colour comes from `src/render/palette.ts`. Every balance number comes from `data/*.json`. Never hard-code either.
- Visual work: compare against `docs/reference/` and attach a screenshot to the PR (`tests/out/smoke.png` or your own Playwright capture).
- Originality: the extraction genre is the model. Do not copy names, creatures, maps, UI or art from any existing game or franchise.
- Assets: only code-generated, CC0, or assets Brandon has provided. Log every third-party asset and its licence in `assets/LICENSES.md`.
- Performance budget: 60 fps at 1080p on an RTX 3060 class GPU, initial load under 15 s.
- Add a test for every system you add (Vitest for logic, extend `tests/smoke.mjs` for anything visible).
- The shipped build is one self-contained HTML file (`npm run release`, see `docs/RELEASING.md`): no dynamic `import()`, no runtime `fetch` of files; import assets through Vite.

## Stack
TypeScript, Vite, Three.js. HTML/CSS overlay for UI. Rapier for physics (add when needed). Colyseus server from the Hive iteration. Headless Chromium via Playwright for smoke tests (software rendering: wait on `window.__biophage.frames`, never on wall-clock time).

## Reporting
You report to the project coordinator, not to Brandon. End each work session with: what shipped (PR links), one screenshot, what is blocked.
