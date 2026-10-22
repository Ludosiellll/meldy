#!/usr/bin/env node
/**
 * Cuts a screen recording into the parts a page plays as real footage (src/lib/footage.ts, components/film/Footage.tsx)
 * and prints its definition for lib/footage.ts.
 *
 *   node scripts/footage-parts.mjs <in.mp4> <poster.webp|jpg|png> <name>
 *
 * The Hugging Face Space refuses a pushed binary file over 100 KB (backend/tests/test_space_binaries.py), so the video
 * goes out in parts of 95 000 bytes; the page joins them into one Blob. What it does:
 *   1. the video's first H.264 stream is copied (never re-encoded) into an MP4 with its index first (faststart), with no
 *      sound and no metadata;
 *   2. the name gets the first ten hex digits of that file's SHA-256 (nginx keeps such names for a year, so a new cut
 *      must have new names); the older cuts of the same name in public/game/footage/ are removed;
 *   3. public/game/footage/<name>-<hash>-1.bin … -<n>.bin and <name>-<hash>-poster.webp are written: the poster at the
 *      video's own frame size (covered and cropped to it), WebP under 100 KB (a WebP already so is kept as it is);
 *   4. the definition is printed: width, height and duration from ffprobe, the codecs string from the stream's own
 *      avcC record (avc1.PPCCLL), the backdrop from the poster's top and bottom rows.
 *
 * Encode the video before (x264, yuv420p, a key frame every few seconds, the size it is shown at); this script keeps
 * its bytes as they are. Needs ffmpeg and ffprobe (with libwebp) on the PATH.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../public/game/footage');
const PART = 95_000;
const POSTER_LIMIT = 100 * 1024;

function fail(message) {
  console.error(`footage-parts: ${message}`);
  process.exit(1);
}

const [input, posterIn, name] = process.argv.slice(2);
if (!input || !posterIn || !name) fail('usage: node scripts/footage-parts.mjs <in.mp4> <poster.webp|jpg|png> <name>');
// The names nginx serves (nginx.conf, location ~ ^/game/…footage/[a-z_-]+-[0-9a-f]{10}-…).
if (!/^[a-z_-]+$/.test(name)) fail(`the name «${name}» may have only a–z, «-» and «_» (nginx serves no other)`);
for (const file of [input, posterIn]) if (!fs.existsSync(file)) fail(`no file ${file}`);

const run = (command, args) => execFileSync(command, args, { maxBuffer: 1 << 28 });

/* 1. the video, copied with its index first, no sound, no metadata */
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input]).toString());
const video = probe.streams.find((stream) => stream.codec_type === 'video');
if (!video) fail(`${input} has no video stream`);
if (video.codec_name !== 'h264') fail(`${input} is ${video.codec_name}; the page plays H.264 (encode it with libx264 first)`);
if (video.pix_fmt && video.pix_fmt !== 'yuv420p') console.warn(`footage-parts: ${video.pix_fmt}; yuv420p plays everywhere`);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-'));
const mp4 = path.join(temp, 'cut.mp4');
run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-map', '0:v:0', '-c', 'copy', '-an', '-map_metadata', '-1', '-movflags', '+faststart', '-f', 'mp4', mp4]);
const bytes = fs.readFileSync(mp4);
const ascii = (from, to) => bytes.subarray(from, to).toString('latin1');
if (ascii(4, 8) !== 'ftyp') fail('the copied file does not start with ftyp');
const moov = bytes.indexOf('moov', 0, 'latin1');
const mdat = bytes.indexOf('mdat', 0, 'latin1');
if (moov < 0 || (mdat >= 0 && moov > mdat)) fail('the copied file has its index after the video (no faststart)');

/* the codecs string: profile, constraint flags and level from the avcC record (after its version byte) */
const avcc = bytes.indexOf('avcC', 0, 'latin1');
if (avcc < 0) fail('no avcC record in the file');
const codecs = `avc1.${[5, 6, 7].map((at) => bytes[avcc + at].toString(16).padStart(2, '0')).join('')}`;

const width = Number(video.width);
const height = Number(video.height);
const duration = Math.round(Number(probe.format.duration ?? video.duration) * 100) / 100;
if (!width || !height || !duration) fail('ffprobe gave no size or length');

/* 2. the hash, and the older cuts of the name gone */
const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
fs.mkdirSync(OUT, { recursive: true });
const ours = new RegExp(`^${name}-[0-9a-f]{10}-([0-9]+\\.bin|poster\\.webp)$`);
const removed = [];
for (const file of fs.readdirSync(OUT)) {
  if (ours.test(file) && !file.startsWith(`${name}-${hash}-`)) {
    fs.rmSync(path.join(OUT, file));
    removed.push(file);
  }
}

/* 3. the parts and the poster */
const count = Math.ceil(bytes.length / PART);
for (let at = 0; at < count; at += 1) {
  fs.writeFileSync(path.join(OUT, `${name}-${hash}-${at + 1}.bin`), bytes.subarray(at * PART, (at + 1) * PART));
}

const poster = path.join(OUT, `${name}-${hash}-poster.webp`);
// A WebP already at the frame's size and under the limit is kept byte for byte (a chosen frame, encoded once).
const given = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', posterIn]).toString()).streams?.[0];
let quality = 'kept';
if (given?.codec_name === 'webp' && Number(given.width) === width && Number(given.height) === height && fs.statSync(posterIn).size <= POSTER_LIMIT) {
  fs.copyFileSync(posterIn, poster);
} else {
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`;
  for (quality = 82; ; quality -= 8) {
    run('ffmpeg', ['-v', 'error', '-y', '-i', posterIn, '-vf', fit, '-frames:v', '1', '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', poster]);
    if (fs.statSync(poster).size <= POSTER_LIMIT) break;
    if (quality <= 30) fail(`the poster is still over 100 KB at quality ${quality}`);
  }
}

/* 4. the backdrop: the poster's top row and bottom row, each as one colour */
function rowColour(y) {
  const rgb = run('ffmpeg', ['-v', 'error', '-i', poster, '-vf', `format=rgb24,crop=iw:1:0:${y},scale=1:1:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return `#${[...rgb.subarray(0, 3)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
const top = rowColour(0);
const bottom = rowColour('ih-1');
const backdrop = top === bottom ? top : `linear-gradient(${top} 50%, ${bottom} 50%)`;

fs.rmSync(temp, { recursive: true, force: true });

const constant = name.toUpperCase().replace(/[-]/g, '_');
const kb = (size) => Math.round(size / 1024);
console.error(
  `footage-parts: ${count} parts (${kb(bytes.length)} KB) and a poster (${kb(fs.statSync(poster).size)} KB, WebP ${quality === 'kept' ? 'as given' : `q${quality}`}) in public/game/footage/` +
    (removed.length ? `; removed the older cut: ${removed.join(', ')}` : ''),
);
console.log(`/** ${width} × ${height}, ${duration} s, ${kb(bytes.length)} KB in ${count} parts. */
export const ${constant}: Footage = {
  ...files('${name}', '${hash}', ${count}),
  width: ${width},
  height: ${height},
  duration: ${duration},
  type: 'video/mp4; codecs="${codecs}"',
  backdrop: '${backdrop}',
};`);
