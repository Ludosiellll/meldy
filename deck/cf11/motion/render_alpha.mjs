// Frames of a motion clip with a transparent ground, for a GIF (tools/dot_gif.py).
//   node deck/cf11/motion/render_alpha.mjs <name> [--fps 25]  ->  media/gen/frames/<name>-alpha/f0000.png …
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadPlaywright } from '../design/deck.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const name = args[0];
const fps = Number(args.includes('--fps') ? args[args.indexOf('--fps') + 1] : 25);
const dir = path.join(path.dirname(HERE), 'media', 'gen', 'frames', `${name}-alpha`);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const url = pathToFileURL(path.join(HERE, `${name}.html`)).href;
const probe = await browser.newPage();
await probe.goto(url);
await probe.waitForFunction(() => Boolean(window.__clip));
const info = await probe.evaluate(() => ({ T: window.__clip.T, width: window.__clip.width, height: window.__clip.height }));
const page = await browser.newPage({ viewport: { width: info.width, height: info.height }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => Boolean(window.__clip));
await page.evaluate(() => document.fonts.ready);
const n = Math.round((info.T * fps) / 1000);
for (let i = 0; i < n; i += 1) {
  await page.evaluate((at) => window.__clip.seek(at), (i * 1000) / fps);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`), omitBackground: true });
}
console.log(`${name}: ${n} frames at ${fps} fps (${info.width}×${info.height}) -> ${dir}`);
await browser.close();
