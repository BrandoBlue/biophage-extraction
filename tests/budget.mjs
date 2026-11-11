// Release budgets, checked on every PR after `npm run release` and the smoke tests.
// Load budget in CLAUDE.md is 15 s on a real machine; the shipped file size is what we can hold the line on in CI.
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const MiB = 1048576;
const BUDGET = {
  releaseMiB: 15,        // claude.ai artifact pages cap at 16 MiB; keep headroom
  releaseGzipMiB: 6,     // ~6 s on a 10 Mbit link, inside the 15 s load budget
  firstFrameMs: 15000,   // software-rendered first frame in CI; a real GPU is much faster
};

const problems = [];
const html = readFileSync('release/index.html');
const raw = html.length / MiB;
const gz = gzipSync(html).length / MiB;
if (raw > BUDGET.releaseMiB) problems.push(`release is ${raw.toFixed(2)} MiB (budget ${BUDGET.releaseMiB})`);
if (gz > BUDGET.releaseGzipMiB) problems.push(`release gzips to ${gz.toFixed(2)} MiB (budget ${BUDGET.releaseGzipMiB})`);
for (const t of ['preview', 'release']) {
  const f = `tests/out/smoke-${t}.json`;
  if (!existsSync(f)) continue;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  if (r.firstFrameMs > BUDGET.firstFrameMs) problems.push(`${t} first frame took ${r.firstFrameMs} ms (budget ${BUDGET.firstFrameMs})`);
}
const line = `release ${raw.toFixed(2)} MiB raw, ${gz.toFixed(2)} MiB gzip`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Budget ${problems.length ? 'FAILED' : 'OK'}\n${line}\n${problems.map((p) => `- ${p}`).join('\n')}\n`);
if (problems.length) { console.error(`BUDGET FAIL:\n${problems.join('\n')}`); process.exit(1); }
console.log(`BUDGET OK: ${line}`);
