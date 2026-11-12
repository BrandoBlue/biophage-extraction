// Loads a small TypeScript module (and what it imports) into a Node script, by bundling it with esbuild (a Vite
// dependency). Used by the app-shell scripts so the manifest and icon read colours from src/render/palette.ts.
import { build } from 'esbuild';

export async function loadTs(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}
