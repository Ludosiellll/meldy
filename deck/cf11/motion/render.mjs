// Renders a motion clip (motion/<name>.html with window.__clip = { T, seek(ms), width, height, poster, loop })
// frame by frame in Chromium and encodes it for PowerPoint.
//
//   node deck/cf11/motion/render.mjs <name> [--fps 30] [--gif] [--gif-fps 12.5] [--gif-colors 64] [--no-mp4]
//                                           [--crf 23] [--tune animation] [--zones a,b,b=0.5/c,d,b=0.5] [--scale 1]
//                                           [--ss 2]
//   --zones: x264 zones (frame ranges) — fewer bits while the camera moves, where motion hides them.
//   --ss: supersampling — frames are taken at ss× the output's pixels and averaged down (area filter), so fine
//         detail that moves (a field of small dots, tiny phones) does not shimmer. The poster is unaffected.
//
// Output in deck/cf11/media/gen/: <name>.mp4 (H.264 High, yuv420p, BT.709 tags, +faststart, no audio),
// <name>.png (the poster, 2×: the meaningful frame the PDF and a reader see), <name>.gif (with --gif).
// A looping clip is rendered over [0, T) so its last frame runs into its first without a seam.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadPlaywright } from '../design/deck.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(path.dirname(HERE), 'media', 'gen');
const args = process.argv.slice(2);
const name = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes(`--${k}`);
if (!name) { console.error('usage: render.mjs <name> [options]'); process.exit(2); }

const fps = Number(opt('fps', 30));
const crf = Number(opt('crf', 23));
const scale = Number(opt('scale', 1));
const ss = Number(opt('ss', 1));
const framesDir = path.join(GEN, 'frames', name);
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();

async function openClip(dpr) {
  const probe = await browser.newPage();
  await probe.goto(pathToFileURL(path.join(HERE, `${name}.html`)).href);
  await probe.waitForFunction(() => Boolean(window.__clip));
  const { width, height } = await probe.evaluate(() => ({ width: window.__clip.width, height: window.__clip.height }));
  await probe.close();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(pathToFileURL(path.join(HERE, `${name}.html`)).href);
  await page.waitForFunction(() => Boolean(window.__clip));
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight}`));
  if (fonts.length) console.log('fonts not loaded:', fonts.join(', '));
  const info = await page.evaluate(() => ({ T: window.__clip.T, poster: window.__clip.poster ?? 0, loop: Boolean(window.__clip.loop), width: window.__clip.width, height: window.__clip.height }));
  return { page, info };
}

async function shoot(page, t, file) {
  await page.evaluate((at) => window.__clip.seek(at), t);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: (await page.viewportSize()).width, height: (await page.viewportSize()).height } });
}

function encodeMp4(dir, rate, out, info) {
  const W = Math.round(info.width * scale / 2) * 2;
  const H = Math.round(info.height * scale / 2) * 2;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(rate), '-i', path.join(dir, 'f%04d.png'),
    '-vf', `scale=${W}:${H}:flags=${ss > 1 ? 'area' : 'lanczos'}:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), ...(opt('tune', '') ? ['-tune', opt('tune', '')] : []), ...(opt('zones', '') ? ['-x264-params', `zones=${opt('zones', '')}`] : []), '-profile:v', 'high', '-level:v', '4.0',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', '-an', out]);
}

const t0 = Date.now();
const { page, info } = await openClip(scale * ss);
const span = info.loop ? info.T : info.T + 1; // a loop excludes its end (= its start); a one-shot includes it
const n = Math.round((span * fps) / 1000 - (info.loop ? 0 : 0));
for (let i = 0; i < n; i += 1) await shoot(page, (i * 1000) / fps, path.join(framesDir, `f${String(i).padStart(4, '0')}.png`));
if (!info.loop) await shoot(page, info.T, path.join(framesDir, `f${String(n).padStart(4, '0')}.png`));
console.log(`${name}: ${n} frames at ${fps} fps (${info.width}×${info.height}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

if (!flag('no-mp4')) {
  const out = path.join(GEN, `${name}.mp4`);
  encodeMp4(framesDir, fps, out, info);
  console.log(`  ${path.basename(out)} ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

// The poster at 2×: the frame a reader, the PDF and a machine that cannot play video will show.
const poster = await openClip(2);
await shoot(poster.page, info.poster, path.join(GEN, `${name}.png`));
console.log(`  ${name}.png (poster at ${info.poster} ms, 2×)`);

if (flag('gif')) {
  const gfps = Number(opt('gif-fps', 12.5));
  const colors = Number(opt('gif-colors', 64));
  const gdir = path.join(GEN, 'frames', `${name}-gif`);
  fs.rmSync(gdir, { recursive: true, force: true });
  fs.mkdirSync(gdir, { recursive: true });
  const g1 = await openClip(1);
  const gn = Math.round((info.T * gfps) / 1000);
  for (let i = 0; i < gn; i += 1) await shoot(g1.page, (i * 1000) / gfps, path.join(gdir, `f${String(i).padStart(4, '0')}.png`));
  const pal = path.join(gdir, 'palette.png');
  const out = path.join(GEN, `${name}.gif`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(gfps), '-i', path.join(gdir, 'f%04d.png'),
    '-vf', `palettegen=max_colors=${colors}:stats_mode=full:reserve_transparent=1`, pal]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(gfps), '-i', path.join(gdir, 'f%04d.png'), '-i', pal,
    '-lavfi', 'paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', '-final_delay', '0', out]);
  console.log(`  ${path.basename(out)} ${(fs.statSync(out).size / 1024).toFixed(0)} KB (${gn} frames at ${gfps} fps, ${colors} colours)`);
}
await browser.close();
