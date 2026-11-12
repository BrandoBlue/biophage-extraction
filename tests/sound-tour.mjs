// Renders the sound tour (src/audio/tour.ts) offline in headless Chromium and writes tests/out/sound-tour.wav,
// plus a level report. Not part of `npm run check`: run `npm run sound-tour` to listen to the game's audio.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = 'http://localhost:5199/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5199', '--strictPort'], { stdio: 'ignore' });
try {
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(URL)).ok; } catch { /* starting */ } if (!up) await new Promise((r) => setTimeout(r, 250)); }
  if (!up) throw new Error('vite did not start');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${URL}?creatures`);
  const out = await page.evaluate(async () => {
    const { renderTour } = await import('/src/audio/tour.ts');
    const buf = await renderTour(44100);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let peak = 0, sum = 0, nan = 0;
    const seconds = [];
    for (let s = 0; s < Math.floor(buf.duration); s++) {
      let m = 0;
      for (let i = s * buf.sampleRate; i < (s + 1) * buf.sampleRate; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
      seconds.push(+m.toFixed(3));
    }
    const pcm = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) {
      for (const [k, v] of [[0, L[i]], [1, R[i]]]) {
        if (!Number.isFinite(v)) nan++;
        const c = Math.max(-1, Math.min(1, v || 0));
        peak = Math.max(peak, Math.abs(c)); sum += c * c;
        pcm[i * 2 + k] = c * 32767;
      }
    }
    const bytes = new Uint8Array(pcm.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin), rate: buf.sampleRate, peak, rms: Math.sqrt(sum / (L.length * 2)), nan, seconds };
  });
  const pcm = Buffer.from(out.b64, 'base64');
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(out.rate, 24);
  head.writeUInt32LE(out.rate * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  mkdirSync('tests/out', { recursive: true });
  writeFileSync('tests/out/sound-tour.wav', Buffer.concat([head, pcm]));
  console.log(JSON.stringify({ peak: out.peak, rms: out.rms, nan: out.nan, perSecondPeak: out.seconds }));
  await browser.close();
} finally { server.kill(); }
