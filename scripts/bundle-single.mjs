// Packs the Vite build in dist/ into ONE self-contained HTML file: release/biophage-<version>.html.
// That file is the playable build we ship: it opens from a hosted link (a claude.ai artifact or any
// static host) and also straight from disk (double-click, file://), because nothing loads from outside.
// Run after `vite build`: `npm run release`.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, extname } from 'node:path';

const DIST = 'dist';
const OUT_DIR = 'release';
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json',
};

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
let sha = 'local';
try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});
const rel = (p) => p.slice(DIST.length + 1).replaceAll('\\', '/');
const all = files(DIST).filter((p) => rel(p) !== 'index.html');
const code = new Map(all.filter((p) => ['.js', '.css'].includes(extname(p))).map((p) => [rel(p), readFileSync(p, 'utf8')]));
const binaries = all.filter((p) => !code.has(rel(p)));

// Every other asset becomes a data: URI. Vite gives assets hashed, unique file names, so swapping the
// name works whether code refers to it as "./assets/x.png", "assets/x.png" or new URL("x.png", import.meta.url).
for (const p of binaries) {
  const name = rel(p);
  const mime = MIME[extname(p).toLowerCase()];
  if (!mime) throw new Error(`bundle-single: no MIME type for ${name}; add it to MIME`);
  const uri = `data:${mime};base64,${readFileSync(p).toString('base64')}`;
  const base = name.split('/').pop();
  for (const [k, src] of code) code.set(k, src.replace(new RegExp(`(\\./)?(assets/)?${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), () => uri));
}

// A literal "</script" inside inlined JS would end the tag early; "<\/script" means the same to JS.
const safeJs = (s) => s.replace(/<\/script/gi, '<\\/script');
let html = readFileSync(join(DIST, 'index.html'), 'utf8');
const used = new Set();
html = html.replace(/<link rel="stylesheet"[^>]*href="\.?\/?([^"]+)"[^>]*>/g, (m, href) => {
  if (!code.has(href)) return m;
  used.add(href);
  return `<style>\n${code.get(href)}\n</style>`; // returned from a function, so `$&` in CSS is not a pattern
});
const scripts = [];
html = html.replace(/<script type="module"[^>]*src="\.?\/?([^"]+)"[^>]*><\/script>\s*/g, (m, src) => {
  if (!code.has(src)) throw new Error(`bundle-single: missing script ${src}`);
  used.add(src);
  scripts.push(`<script type="module">\n${safeJs(code.get(src))}\n</script>`);
  return '';
});
// Leftover JS files mean code splitting (dynamic import), which a single file cannot load.
const leftovers = [...code.keys()].filter((k) => !used.has(k) && k.endsWith('.js'));
if (leftovers.length) throw new Error(`bundle-single: split chunks not inlined: ${leftovers.join(', ')}. Avoid dynamic import() or inline them.`);
// Function replacements: minified JS is full of `$&` and `$'`, which a string replacement would expand.
html = html.replace('</body>', () => `${scripts.join('\n')}\n</body>`);
const stamp = `<meta name="biophage-build" content="${pkg.version}+${sha}" />`;
html = /<meta charset[^>]*>/i.test(html) ? html.replace(/(<meta charset[^>]*>)/i, `$1\n    ${stamp}`) : html.replace('<head>', `<head>\n    ${stamp}`);

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, `biophage-${pkg.version}.html`);
writeFileSync(out, html);
writeFileSync(join(OUT_DIR, 'index.html'), html);
console.log(`bundle-single: ${out} (${(Buffer.byteLength(html) / 1048576).toFixed(2)} MiB, build ${pkg.version}+${sha})`);
