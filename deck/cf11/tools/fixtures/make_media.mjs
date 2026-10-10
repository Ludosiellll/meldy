#!/usr/bin/env node
// Generate the fixture media (ignored by git) from the deterministic pages in fixtures/motion/:
//   media/clip.mp4 + media/clip-poster.png  (1280x720, 2 s seamless loop, H.264, BT.709-tagged, no audio)
//   media/dots.gif                           (360x120, 10 fps palette GIF)
//   media/photo.png                          (1200x800 still)
// Frames come from window.__clip.seek(ms), so the output does not depend on machine speed.
// Usage: node make_media.mjs [--force]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadChromium } from '../pw.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(HERE, 'media');
const force = process.argv.includes('--force');

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
}

async function frames(browser, page, w, h, fps, outDir) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.goto(pathToFileURL(path.join(HERE, 'motion', page)).href);
  await p.evaluate(() => document.fonts.ready);
  const T = await p.evaluate(() => window.__clip.T);
  const n = Math.round((T / 1000) * fps);
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => window.__clip.seek(t), (i * 1000) / fps);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await p.screenshot({ path: path.join(outDir, `f${String(i).padStart(4, '0')}.png`) });
  }
  await p.close();
  return n;
}

const chromium = await loadChromium();
fs.mkdirSync(MEDIA, { recursive: true });
const browser = await chromium.launch();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf11-fixture-frames-'));
try {
  const clip = path.join(MEDIA, 'clip.mp4');
  if (force || !fs.existsSync(clip)) {
    const dir = path.join(tmp, 'clip');
    const n = await frames(browser, 'clip.html', 1280, 720, 30, dir);
    ffmpeg(['-framerate', '30', '-i', path.join(dir, 'f%04d.png'), '-frames:v', String(n),
      '-vf', 'scale=1280:720:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-profile:v', 'high', '-level:v', '4.0',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart', '-an', clip]);
    fs.copyFileSync(path.join(dir, 'f0000.png'), path.join(MEDIA, 'clip-poster.png'));
    console.log(`clip.mp4: ${n} frames, ${fs.statSync(clip).size} bytes; poster = frame 0`);
  }
  const gif = path.join(MEDIA, 'dots.gif');
  if (force || !fs.existsSync(gif)) {
    const dir = path.join(tmp, 'dots');
    await frames(browser, 'dots.html', 360, 120, 10, dir);
    ffmpeg(['-framerate', '10', '-i', path.join(dir, 'f%04d.png'),
      '-vf', 'split[a][b];[a]palettegen=max_colors=16:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', gif]);
    console.log(`dots.gif: ${fs.statSync(gif).size} bytes`);
  }
  const photo = path.join(MEDIA, 'photo.png');
  if (force || !fs.existsSync(photo)) {
    const p = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    await p.goto(pathToFileURL(path.join(HERE, 'motion', 'photo.html')).href);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: photo });
    await p.close();
    console.log(`photo.png: ${fs.statSync(photo).size} bytes`);
  }
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
