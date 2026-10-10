// Render selected elements of an HTML page to transparent PNGs at 2x (for crisp titles in a deck).
// Usage: node render_elements.js <page.html> <outDir> <selector=name> ...
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const [html, outDir, ...pairs] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  await p.goto('file://' + path.resolve(html)); await p.evaluate(() => document.fonts.ready);
  for (const pr of pairs) { const [sel, name] = pr.split('=');
    await p.locator(sel).screenshot({ path: path.join(outDir, name + '.png'), omitBackground: true }); console.log('rendered', name); }
  await b.close(); })().catch(e => { console.error(e); process.exit(1); });
