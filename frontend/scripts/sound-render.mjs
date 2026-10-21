#!/usr/bin/env node
/**
 * The live games' sound rendered offline to files and measured (LOCAL ONLY), run from frontend/:
 *
 *   node scripts/sound-render.mjs cues <dir>                 every cue and every music loop to <dir>/*.wav, measured
 *   node scripts/sound-render.mjs soundtrack <calls.json> <out.wav> [seconds] [offsetMs]
 *                                                            a game's sound calls (stand-local.mjs replay with
 *                                                            SOUNDLOG) rendered to one file, measured
 *
 * The real sound.ts runs in Chromium (through Vite) on an OfflineAudioContext: its scheduler's timers are driven
 * from the render's suspend points every 10 ms, so the notes land where they would live. Measured with ffmpeg:
 * sample peak and true peak (dBFS), integrated loudness and the loudest momentary (LUFS), and clicks (a sample that
 * jumps far out of its neighbourhood). Playwright: the project's own package if installed, else one on NODE_PATH.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);
const RATE = 48000;

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return require('playwright');
  }
}

async function startVite() {
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    cacheDir: process.env.VITE_CACHE ?? join(tmpdir(), 'meldy-sound-vite'),
    logLevel: 'error',
    // the sound needs no npm package: no dependency scan of the whole app (and no reload after it)
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 3100, strictPort: false, fs: { allow: [root, realpathSync(join(root, 'node_modules'))] }, hmr: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  return { server, base: `http://127.0.0.1:${server.httpServer.address().port}` };
}

/** In the page: renders `script` ([seconds, method, args][]) for `seconds`; returns 16-bit stereo PCM (base64) and peaks. */
async function renderInPage(page, seconds, script) {
  return page.evaluate(
    async ({ seconds, script, rate }) => {
      const { createHostSound } = await import('/src/components/live/host/sound.ts');
      const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
      const T = { now: 0, id: 1, list: new Map() };
      const timers = {
        setInterval: (fn, ms) => (T.list.set(T.id, { fn, ms, at: T.now + ms }), T.id++),
        clearInterval: (id) => T.list.delete(id),
        setTimeout: (fn, ms) => (T.list.set(T.id, { fn, ms: 0, at: T.now + ms }), T.id++),
        clearTimeout: (id) => T.list.delete(id),
      };
      const advance = (to) => {
        for (;;) {
          let best = null;
          for (const [id, t] of T.list) if (t.at <= to && (!best || t.at < best[1].at)) best = [id, t];
          if (!best) break;
          const [id, t] = best;
          T.now = t.at;
          if (t.ms > 0) t.at += t.ms;
          else T.list.delete(id);
          t.fn();
        }
        T.now = to;
      };
      const sound = createHostSound(window, { context: ctx, timers });
      sound.unlock();
      await sound.ready();
      advance(0);
      const calls = script.slice().sort((a, b) => a[0] - b[0]);
      let k = 0;
      const run = (t) => {
        while (k < calls.length && calls[k][0] <= t + 1e-6) {
          const [, name, args] = calls[k++];
          sound[name](...(args ?? []));
        }
      };
      run(0);
      const step = 0.01;
      for (let i = 1; i * step < seconds - 0.005; i++) {
        const t = i * step;
        ctx.suspend(t).then(() => {
          run(t);
          advance(t * 1000);
          ctx.resume();
        });
      }
      const buf = await ctx.startRendering();
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      let peak = 0;
      const pcm = new Int16Array(L.length * 2);
      for (let i = 0; i < L.length; i++) {
        const l = L[i];
        const r = R[i];
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
        pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
      }
      // clicks: a second difference far above its neighbourhood's (a step in the wave)
      const clicks = [];
      const W = 240;
      for (const ch of [L, R]) {
        let sum = 0;
        const d = new Float32Array(ch.length);
        for (let i = 2; i < ch.length; i++) d[i] = ch[i] - 2 * ch[i - 1] + ch[i - 2];
        for (let i = 0; i < Math.min(ch.length, 2 * W); i++) sum += d[i] * d[i];
        for (let i = W; i < ch.length - W; i++) {
          sum += d[i + W] * d[i + W] - d[i - W] * d[i - W];
          const rms = Math.sqrt(Math.max(0, sum) / (2 * W));
          if (Math.abs(d[i]) > 0.05 && Math.abs(d[i]) > 14 * rms) {
            clicks.push(+(i / rate).toFixed(3));
            i += W;
          }
        }
      }
      let bin = '';
      const bytes = new Uint8Array(pcm.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { pcm: btoa(bin), peak, clicks: clicks.slice(0, 20), nClicks: clicks.length };
    },
    { seconds, script, rate: RATE },
  );
}

function wav(pcmB64) {
  const data = Buffer.from(pcmB64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** ffmpeg's EBU R128: integrated loudness, the loudest momentary (400 ms) and short-term (3 s), true peak. */
function measure(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'verbose', '-i', file, '-af', 'ebur128=peak=true:framelog=verbose', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 256 << 20 });
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  let maxM = -Infinity;
  let maxS = -Infinity;
  for (const m of log.matchAll(/M:\s*(-?[\d.]+)\s+S:\s*(-?[\d.]+)/g)) {
    maxM = Math.max(maxM, Number(m[1]));
    maxS = Math.max(maxS, Number(m[2]));
  }
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const I = Number(/I:\s*(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const tp = Number(/Peak:\s*(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  return { I, maxM: +maxM.toFixed(1), maxS: +maxS.toFixed(1), truePeak: tp };
}

const dB = (x) => +(20 * Math.log10(Math.max(1e-9, x))).toFixed(2);

/** Every cue alone (the music off), each music loop alone, and two mixes (a big cue over the music). */
const CUES = [
  ['join-x8', 2.5, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((t) => [0.05 + t, 'join', []])],
  ['count-3-2-1-go', 4.5, [3, 2, 1, 0].map((n, i) => [0.05 + i, 'count', [n]])],
  ['tick-5-to-1', 5.5, [5, 4, 3, 2, 1].map((n, i) => [0.05 + i, 'tick', [n === 1]])],
  ['slam', 3, [[0.05, 'slam', []]]],
  ['roll-2s', 2.6, [[0.05, 'roll', [true, 2000]]]],
  ['reveal', 2, [[0.05, 'reveal', []]]],
  ['land-x8', 2, Array.from({ length: 8 }, (_, i) => [0.05 + i * 0.06, 'land', [i]])],
  ['hit', 3, [[0.05, 'hit', []]]],
  ['freeze-3', 2, [[0.05, 'freeze', [3]]]],
  ['heal', 2.2, [[0.05, 'heal', []]]],
  ['growl', 3, [[0.05, 'growl', []]]],
  ['boom', 4, [[0.05, 'boom', []]]],
  ['podium-3-2-1', 3, [3, 2, 1].map((p, i) => [0.05 + i * 0.25, 'podium', [p]])],
  ['cheer', 4, [[0.05, 'cheer', [10]]]],
  ['fanfare', 5, [[0.05, 'fanfare', []]]],
  ['sting', 3.5, [[0.05, 'sting', []]]],
  ['alarm', 2.2, [[0.05, 'alarm', []]]],
  ['stomp', 2, [[0.05, 'stomp', []]]],
  ['collapse', 4, [[0.05, 'collapse', []]]],
  ['rise', 2.2, [[0.05, 'rise', []]]],
  ['restore', 2, [[0.05, 'restore', []]]],
  ['whoosh-x3', 1.2, [0, 1, 2].map((i) => [0.05 + i * 0.12, 'whoosh', [i]])],
  ['shatter-x3', 1.4, [0, 1, 2].map((i) => [0.05 + i * 0.1, 'shatter', [i]])],
  ['roar', 1.5, [[0.05, 'roar', []]]],
];

const LOOPS = { lobby: (64 * 15) / 112, question: (32 * 15) / 120, board: (32 * 15) / 116, podium: (32 * 15) / 124 };

async function cues(page, dir) {
  const rows = [];
  const one = async (name, seconds, script, extra = {}) => {
    const r = await renderInPage(page, seconds, script);
    const file = join(dir, `${name}.wav`);
    writeFileSync(file, wav(r.pcm));
    const m = measure(file);
    const row = { name, seconds, peak: dB(r.peak), truePeak: m.truePeak, I: m.I, maxM: m.maxM, maxS: m.maxS, clicks: r.nClicks, clickAt: r.clicks.slice(0, 5), ...extra };
    rows.push(row);
    console.log(JSON.stringify(row));
  };
  for (const [name, seconds, script] of CUES) await one(`cue-${name}`, seconds, script);
  for (const [track, loop] of Object.entries(LOOPS)) {
    // two loops after the fade-in; the question also hurried (its last seconds)
    await one(`music-${track}`, 0.1 + loop * 3, [[0, 'music', [track]]], { loop: +loop.toFixed(3) });
  }
  await one('music-question-hurry', 0.1 + LOOPS.question * 2, [
    [0, 'music', ['question']],
    [0.01, 'hurry', [true]],
  ]);
  // big moments over the music: the ducking, and the limiter's ceiling
  await one('mix-question-stomp-collapse', 7, [
    [0, 'music', ['question']],
    [2.0, 'hurry', [true]],
    [3.0, 'stomp', []],
    [3.85, 'collapse', []],
    [4.3, 'cheer', [12]],
    [5.0, 'rise', []],
  ]);
  await one('mix-board-fanfare', 7, [
    [0, 'music', ['board']],
    [2.0, 'fanfare', []],
    [2.1, 'hit', []],
    [2.2, 'boom', []],
  ]);
  writeFileSync(join(dir, 'levels.json'), JSON.stringify(rows, null, 1));
  return rows;
}

async function main() {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  if (cmd !== 'cues' && cmd !== 'soundtrack') {
    console.log('usage: node scripts/sound-render.mjs cues <dir> | soundtrack <calls.json> <out.wav> [seconds] [offsetMs]');
    process.exit(2);
  }
  const { server, base } = await startVite();
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text().slice(0, 300)));
    // a blank page of Vite's origin (the app's own pages register a service worker and redirect)
    await page.route(`${base}/__sound.html`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>sound</title>' }));
    await page.goto(`${base}/__sound.html`, { waitUntil: 'load' });
    if (cmd === 'cues') {
      mkdirSync(a, { recursive: true });
      await cues(page, a);
    } else {
      const log = JSON.parse(readFileSync(a, 'utf8'));
      const offset = Number(d ?? 0) / 1000;
      const script = log.calls.map(([ms, name, args]) => [Math.max(0, ms / 1000 - offset), name, args]);
      const seconds = Number(c ?? Math.ceil(Math.max(...script.map((s) => s[0])) + 4));
      const r = await renderInPage(page, seconds, script);
      mkdirSync(dirname(b), { recursive: true });
      writeFileSync(b, wav(r.pcm));
      console.log(JSON.stringify({ file: b, seconds, calls: script.length, peak: dB(r.peak), clicks: r.nClicks, clickAt: r.clicks, ...measure(b) }));
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
