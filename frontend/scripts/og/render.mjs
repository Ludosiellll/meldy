#!/usr/bin/env node
/**
 * Renders the pictures a newcomer meets before signing in, from sources kept in the repository:
 *
 *   og.html               → public/og-image-2.jpg          the link preview (og:image), 1200 × 630, JPEG
 *   public/pwa-512x512.svg → public/pwa-192x192.png         icon, 192 × 192
 *                          → public/pwa-512x512.png         icon, 512 × 512
 *                          → public/pwa-maskable-512x512.png  maskable icon: full-bleed blue, the mark
 *                                                            inside the safe zone (a circle of 40 %)
 *                          → public/apple-touch-icon.png    180 × 180, full-bleed (iOS rounds it)
 *
 * Run from frontend/:   npm run og   (the same as node scripts/og/render.mjs)
 * It needs Playwright with Chromium: the project's own package if one is installed, else a global
 * one (npm i -g playwright && npx playwright install chromium). PLAYWRIGHT_BROWSERS_PATH is honoured.
 * After a run, look at the files: the link preview must still read at 300 px wide.
 *
 * The Space refuses a pushed binary file over 100 KB unless it is stored with Xet (release 29, run 36:
 * «Your push was rejected because it contains binary files», og-image.png at 143 KB). The preview is
 * therefore a JPEG, the highest quality that stays under OG_MAX_BYTES; a palette PNG turned the yellow
 * dot beige.
 *
 * Telegram keeps a link preview's picture by its address, for weeks: after 2026-10-10 the invite links still showed
 * the paper sheet of og-image.jpg. A new look of the preview therefore takes a new file name (OG_FILE here and
 * og:image in index.html), never the old one overwritten.
 */
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Under the Space's 100 KB limit for binary files pushed without Xet, with room to spare. */
const OG_MAX_BYTES = 95 * 1024;
const publicDir = resolve(here, '../../public');
/** The preview's file in public/; a new look takes a new name (see above). */
const OG_FILE = 'og-image-2.jpg';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(join(globalRoot, 'noop.js'))('playwright');
  }
}

/** The mark of public/pwa-512x512.svg on a full-bleed square, scaled about the centre. */
function fullBleed(svg, scale) {
  const mark = svg
    .replace(/^[\s\S]*?<rect[^>]*\/>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
  const group = scale === 1 ? mark : `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${mark}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#2869dd" />${group}</svg>`;
}

const iconSvg = readFileSync(join(publicDir, 'pwa-512x512.svg'), 'utf8');
if (!/<rect[^>]*rx=/.test(iconSvg)) throw new Error('pwa-512x512.svg: expected the rounded square first');

const ICONS = [
  { file: 'pwa-192x192.png', size: 192, svg: iconSvg },
  { file: 'pwa-512x512.png', size: 512, svg: iconSvg },
  // The mark reaches 183 of 256 px from the centre; at 0.8 it is 146 px, well inside the 205 px circle.
  { file: 'pwa-maskable-512x512.png', size: 512, svg: fullBleed(iconSvg, 0.8) },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed(iconSvg, 1) },
];

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

  await page.goto(pathToFileURL(join(here, 'og.html')).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const og = join(publicDir, OG_FILE);
  let written = 0;
  for (const quality of [92, 90, 88, 86, 84, 82, 80, 78, 75]) {
    await page.locator('.og').screenshot({ path: og, type: 'jpeg', quality });
    written = statSync(og).size;
    if (written <= OG_MAX_BYTES) {
      console.log(`${OG_FILE}  ${Math.round(written / 1024)} KB (quality ${quality})`);
      break;
    }
  }
  if (written > OG_MAX_BYTES) throw new Error(`${OG_FILE} is ${written} bytes even at quality 75`);

  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    const sized = icon.svg.replace('<svg ', `<svg width="${icon.size}" height="${icon.size}" `);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`);
    const out = join(publicDir, icon.file);
    await page.locator('svg').screenshot({ path: out, omitBackground: true });
    console.log(`${icon.file}  ${Math.round(statSync(out).size / 1024)} KB`);
  }
} finally {
  await browser.close();
}
