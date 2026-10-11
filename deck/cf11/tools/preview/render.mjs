#!/usr/bin/env node
// Motion preview, step 2: play every scene written by scene.py in Chromium, frame by frame, into MP4.
//
//   node preview/render.mjs [--motion out/preview/motion] [--only 06,07] [--no-label] [--quality 92]
//
// Per slide NN: NN-in.mp4 (the transition into NN, its builds with the click script, the hold), keyframes of the
// transition at 0/25/50/75/100 % and, for a Morph, a pair map (keys/NN-*.png); then deck.mp4 = all clips in order
// (H.264, the scenes' size and fps, BT.709 tags), and sheet.py turns the keyframes into keyframes/NN-in.png.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadChromium } from '../pw.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECK = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes(`--${k}`);
const MOTION = path.resolve(opt('motion', path.join(DECK, 'out', 'preview', 'motion')));
const ONLY = opt('only', null) ? new Set(opt('only').split(',').map((s) => s.trim().padStart(2, '0'))) : null;
const QUALITY = Number(opt('quality', 92));
const LABEL = !flag('no-label');

const manifest = JSON.parse(fs.readFileSync(path.join(MOTION, 'manifest.json'), 'utf8'));
const [W, H] = manifest.size;
const FPS = manifest.fps;
const KEYS = path.join(MOTION, 'keys');
fs.mkdirSync(KEYS, { recursive: true });

function encoder(out) {
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS),
    '-c:v', 'mjpeg', '-i', '-', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', '-an', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c} for ${out}`)))));
  const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));
  return { write, end: async () => { ff.stdin.end(); await done; } };
}

const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.warn('  player error:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.warn('  player:', m.text()); });
await page.goto(pathToFileURL(path.join(HERE, 'player.html')).href);
await page.waitForFunction(() => typeof window.__load === 'function');

const clips = [];
const t0 = Date.now();
let frames = 0;
for (const s of manifest.slides) {
  const scene = JSON.parse(fs.readFileSync(s.scene, 'utf8'));
  const out = path.join(MOTION, `${s.nn}-in.mp4`);
  clips.push(out);
  if (ONLY && !ONLY.has(s.nn)) { if (!fs.existsSync(out)) console.warn(`  ${s.nn}: skipped (--only) and no earlier clip`); continue; }
  const info = await page.evaluate((sc) => window.__load(sc), scene);
  const n = Math.max(1, Math.ceil((info.T / 1000) * FPS));
  const enc = encoder(out);
  const ts = Date.now();
  for (let f = 0; f < n; f++) {
    const t = (f * 1000) / FPS;
    await page.evaluate(([tt, lab]) => window.__seek(tt, { label: lab }), [t, LABEL]);
    await enc.write(await page.screenshot({ type: 'jpeg', quality: QUALITY }));
  }
  await enc.end();
  frames += n;
  // keyframes of the transition and the pair map (no label: the sheet captions them)
  const D = scene.transition.kind === 'cut' ? 0 : scene.transition.dur;
  for (const [k, frac] of [[0, 0], [1, 0.25], [2, 0.5], [3, 0.75], [4, 1]]) {
    await page.evaluate((tt) => window.__seek(tt, {}), D * frac);      // 100 % = the slide's start state
    await page.screenshot({ path: path.join(KEYS, `${s.nn}-k${k}.png`) });
  }
  if (scene.transition.kind === 'morph' && scene.prev) {
    await page.evaluate(() => window.__seek(0, { overlay: 'pairs' }));
    await page.screenshot({ path: path.join(KEYS, `${s.nn}-map.png`) });
  } else {
    fs.rmSync(path.join(KEYS, `${s.nn}-map.png`), { force: true });
  }
  console.log(`${s.nn}-in.mp4  ${(info.T / 1000).toFixed(1)} s, ${n} frames, ${scene.transition.kind}` +
    `${D ? ` ${D} ms` : ''}, ${scene.clicks.length} click(s), ${((Date.now() - ts) / 1000).toFixed(1)} s to render`);
}
await browser.close();

// the whole deck: the clips one after another (same encoder settings, so no re-encode)
const list = path.join(MOTION, 'clips.txt');
fs.writeFileSync(list, clips.filter((c) => fs.existsSync(c)).map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
const deck = path.join(MOTION, 'deck.mp4');
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy',
  '-movflags', '+faststart', deck], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('ffmpeg concat failed');
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', deck], { encoding: 'utf8' });
console.log(`deck.mp4  ${Number(probe.stdout).toFixed(1)} s, ${(fs.statSync(deck).size / 1e6).toFixed(1)} MB; ` +
  `${frames} frames rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// keyframe sheets
const py = process.env.PYTHON || path.join(DECK, 'tools', '.venv', 'bin', 'python');
const sh = spawnSync(fs.existsSync(py) ? py : 'python3', [path.join(HERE, 'sheet.py'), MOTION], { stdio: 'inherit' });
if (sh.status !== 0) throw new Error('sheet.py failed');
