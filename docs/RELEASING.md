# Releasing a playable build

Owner: Build, QA & Release. Every iteration (Spore, Larva, Host, Hive, Apex) ends with a build Brandon plays from a link.

## What we ship
`npm run release` type-checks, builds with Vite, and packs everything into one self-contained file,
`release/biophage-<version>.html` (also copied to `release/index.html`). Nothing loads from outside it, so the
same file works:

- as the **play link**: a claude.ai artifact page that the Build thread republishes for every build;
- **from disk**: download and double-click, it runs in Chrome or Edge with no install or server;
- on any static host later (itch.io, GitHub Pages, our own domain) with no changes.

Rule for every department: no dynamic `import()` and no runtime `fetch` of files. Import assets through Vite
(`import url from './x.png'`) and `scripts/bundle-single.mjs` inlines them. The bundler fails loudly if it cannot.

## Gates (all in `npm run check`, all run in CI on every PR)
| Gate | Command | Fails when |
| --- | --- | --- |
| Types and build | `npm run release` | tsc error, Vite error, a split chunk or unknown asset type |
| Logic | `npm test` | a Vitest test fails |
| Smoke, served | `npm run smoke` | no frames, a console error, or the host cannot walk |
| Smoke, shipped file | `npm run smoke:release` | same, on the single file opened from `file://` |
| Budget | `npm run budget` | file over 15 MiB, gzip over 6 MiB, or software-rendered first frame over 40 s in CI (a tripwire; the 15 s player budget is checked on real hardware) |

Headless tests take screenshots with `freezeAndScreenshot` from `tests/lib/harness.mjs`, which pauses the game
loop first; a plain `page.screenshot` can time out on slow CI runners.

CI builds once, then runs unit tests and each browser suite (smoke, raid, raid-release, creatures) as parallel jobs with
their own 35 min limit; add a new browser suite as one more `matrix` entry in `.github/workflows/ci.yml`.

CI also uploads, per PR, the smoke screenshots and a **playable build** zip (`biophage-playable-<sha>`).

The 60 fps at 1080p target needs a real GPU, so CI cannot measure it. CI logs software-rendered fps in
`tests/out/smoke-*.json` to spot large regressions; a real-GPU check is part of each iteration's bug bash.

## Cutting an iteration release
1. All iteration PRs merged to `main`, CI green.
2. Bump `version` in `package.json` (Spore 0.1.0, Larva 0.2.0, Host 0.3.0, Hive 0.4.0, Apex 0.5.0; previews `0.1.0-preview.1`).
3. Write patch notes in `docs/releases/v<version>.md` from `docs/releases/TEMPLATE.md`.
4. Merge. The Release workflow sees the new version on `main`, re-runs every gate, creates tag `v<version>` and
   publishes a GitHub release with the file and screenshots attached. (Threads cannot push tags from their
   sandbox, so the workflow tags; it can also be started by hand from the Actions tab.)
5. The Build thread republishes the play link from the same file and reports it to the coordinator.

## Bug bash
At the end of each iteration the Build thread plays the release end to end against the iteration's exit criteria
in `docs/PLAN.md`, and files one GitHub issue per bug, labelled with the owning department.
