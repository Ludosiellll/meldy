'use strict';
// The lecture's slides as pictures: each <section class="slide"> of slides.html, shot by Chromium at 1280 × 720 CSS px
// (× --scale) into <out>/sN.png; with --pdf, also the whole deck as a PDF, one slide a page (the input of the site's
// «Файл» tab, should a video or a recording not go through). make.py calls it; it can run alone to look at the slides.
//
//   node deck/cf11/tools/record/lecture/render.cjs <slides.html> <out dir> [--scale 1] [--pdf <file.pdf>]
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const [src, out] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const SCALE = Number(arg('scale', 1));

(async () => {
  if (!src || !out) {
    console.error('usage: render.cjs <slides.html> <out dir> [--scale 1]');
    process.exit(2);
  }
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: SCALE });
    await page.goto('file://' + path.resolve(src), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const slides = page.locator('section.slide');
    const n = await slides.count();
    for (let i = 0; i < n; i += 1) {
      const file = path.join(out, `s${i + 1}.png`);
      await slides.nth(i).screenshot({ path: file });
      console.log(file);
    }
    const pdf = arg('pdf', null);
    if (pdf) {
      await page.pdf({ path: pdf, width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
      console.log(pdf);
    }
  } finally {
    await browser.close();
  }
})();
