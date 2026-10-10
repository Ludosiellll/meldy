// Deterministic frame capture of a CSS-animated HTML scene.
// Usage: node render_frames.js <scene.html> <outDir> <fps> <seconds> <width> <height> [dpr]
// Pauses every Web Animation and seeks it to i/fps for each frame, so output does not
// depend on machine speed. Renders frames 0..N inclusive (frame N = t=seconds, for loop checks).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const [html, outDir, fpsS, durS, wS, hS, dprS] = process.argv.slice(2);
  const fps = Number(fpsS), dur = Number(durS), w = Number(wS), h = Number(hS), dpr = Number(dprS || 1);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await page.goto('file://' + path.resolve(html));
  await page.evaluate(() => document.fonts.ready);
  const fontsOk = await page.evaluate(() => [...document.fonts].map(f => f.family + ' ' + f.weight + ' ' + f.status));
  console.log('fonts:', fontsOk.join(', '));
  const nAnim = await page.evaluate(() => { const a = document.getAnimations(); a.forEach(x => x.pause()); return a.length; });
  console.log('animations paused:', nAnim);
  const n = Math.round(fps * dur);
  const t0 = Date.now();
  // warm-up: the very first seek+screenshot after pausing can show an unseeked compositor state
  // seek somewhere else first, so the seek to t=0 below is a real state change
  await page.evaluate((t) => { document.getAnimations().forEach(a => { a.currentTime = t; }); }, (dur * 1000) / 2);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: path.join(outDir, 'warmup.png') });
  for (let i = 0; i <= n; i++) {
    const t = (i * 1000) / fps;
    await page.evaluate((t) => { document.getAnimations().forEach(a => { a.currentTime = t; }); }, t);
    // let the compositor commit the seeked state (otherwise transform/opacity layers can lag a frame)
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(outDir, 'f' + String(i).padStart(4, '0') + '.png') });
  }
  console.log(`rendered ${n + 1} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
