// Slide 10's clip: the app's own Telegram tip («План на день в Telegram», components/tips/scenes), the bot's chat
// drawn as Telegram for Android, rendered from the credential-free harness that mounts the app's components with
// fakes (Vite on 127.0.0.1:5199, see the deck's PLAN.md). Until the real recording of the live site replaces it.
//
//   node deck/cf11/motion/telegram.mjs [--from 2550] [--to 8400] [--poster 3900] [--size 640]
//
// Writes media/gen/telegram.mp4 (640 × 640, the chat sharp: the day's card, «Начать», a question, «Верно.»),
// looping through a short crossfade, and media/gen/telegram.jpg (the poster: the day's card with «Начать»).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../design/deck.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(path.dirname(HERE), 'media', 'gen');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : Number(args[i + 1]); };
const FROM = opt('from', 2550), TO = opt('to', 8400), POSTER = opt('poster', 3900), SIZE = opt('size', 640);
const FPS = 30, XFADE = 15, RADIUS = 24;
const raw = path.join(GEN, 'frames', 'telegram-raw');
const out = path.join(GEN, 'frames', 'telegram');
fs.rmSync(raw, { recursive: true, force: true });
fs.mkdirSync(raw, { recursive: true });

const HARNESS = `http://127.0.0.1:5199/clip.html?kind=tip&id=telegram&w=${SIZE}&theme=light`;
try {
  const res = await fetch(HARNESS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(`The app harness is not answering at 127.0.0.1:5199 (${e.message}).
Start it first: a Vite server that mounts frontend/src/components/tips with fakes for Supabase, auth and the
Telegram API (see PLAN.md, «Tools»), then run this script again.`);
  process.exit(2);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE + 48, height: SIZE + 160 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(HARNESS);
await page.waitForFunction(() => Boolean(window.__meldyTipClip), null, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.addStyleTag({ content: '.tp-play, .tp-start { display: none !important; }' });
await page.waitForTimeout(300);
const box = page.locator('.tp-box');
const step = 1000 / FPS;
let n = 0;
for (let t = FROM; t < TO + XFADE * step; t += step) {
  await page.evaluate((at) => window.__meldyTipClip.seek(at), Math.round(t));
  await page.waitForTimeout(20);
  await box.screenshot({ path: path.join(raw, `f${String(n).padStart(4, '0')}.png`) });
  n += 1;
}
await page.evaluate((at) => window.__meldyTipClip.seek(at), POSTER);
await page.waitForTimeout(60);
const posterRaw = path.join(raw, 'poster.png');
await box.screenshot({ path: posterRaw });
await browser.close();
console.log(`telegram: ${n} frames ${FROM}–${TO} ms (+${XFADE} for the loop)`);

execFileSync('python3', ['-I', path.join(HERE, 'loopmask.py'), raw, out, String(SIZE), String(SIZE), '--radius', String(RADIUS), '--xfade', String(XFADE)], { stdio: 'inherit' });
// The poster at 2×, with the same corners.
const pdir = path.join(GEN, 'frames', 'telegram-poster');
fs.rmSync(pdir, { recursive: true, force: true });
fs.mkdirSync(pdir, { recursive: true });
fs.copyFileSync(posterRaw, path.join(pdir, 'f0000.png'));
const pout = path.join(GEN, 'frames', 'telegram-poster-out');
execFileSync('python3', ['-I', path.join(HERE, 'loopmask.py'), pdir, pout, String(SIZE * 2), String(SIZE * 2), '--radius', String(RADIUS * 2)], { stdio: 'inherit' });
// Telegram's wallpaper makes a heavy PNG: the poster is a JPEG of high quality (≈ a third of the size).
execFileSync('python3', ['-I', '-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], quality=90, subsampling=0)', path.join(pout, 'f0000.png'), path.join(GEN, 'telegram.jpg')]);

const mp4 = path.join(GEN, 'telegram.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(out, 'f%04d.png'),
  '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-profile:v', 'high', '-level:v', '4.0',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-movflags', '+faststart', '-an', mp4]);
console.log(`  telegram.mp4 ${(fs.statSync(mp4).size / 1024).toFixed(0)} KB, telegram.jpg ${(fs.statSync(path.join(GEN, 'telegram.jpg')).size / 1024).toFixed(0)} KB (poster at ${POSTER} ms, 2×)`);
