#!/usr/bin/env node
// HTML slides -> slides.json + pictures, per deck/cf11/CONTRACT.md.
//
//   node extract.mjs [--slides <dir>] [--out <dir>] [--only 01,03] [--no-opt] [--fill <private/fill.json>]
//
// For every <dir>/NN-*.html: open at 1920x1080 (device scale 1), put the private values into [data-fill] elements
// (--fill, default <slides>/../private/fill.json, git-ignored; a missing file or key keeps the placeholder and warns
// once per key), wait for fonts, window.__ready and finished CSS animations, read every [data-pptx] element
// (extract_page.js), then render
//   img/NN/ref.png  the slide as authored (for render comparison)
//   img/NN/bg.png   the slide with every marked element invisible (layout kept) -> the PPTX background picture
//   img/NN/eK*.png  2x transparent renders: data-pptx="image", SVG fallbacks, the under-layer of a text (inline
//                   highlights, decorations) and the over-layer of a shape (its unmarked content; its shadow only
//                   when that cannot be a native one)
//   img/NN/eK-text.png  the glyphs of each live text box alone (for the motion preview only)
// Finally imgopt.py trims the layers and picks PNG8 or PNG24 for each picture (skip with --no-opt).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadChromium } from './pw.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECK = path.resolve(HERE, '..');

function parseArgs(argv) {
  const a = { slides: path.join(DECK, 'slides'), out: path.join(DECK, 'out', 'build'), only: null, opt: true, fill: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--slides') a.slides = path.resolve(argv[++i]);
    else if (k === '--out') a.out = path.resolve(argv[++i]);
    else if (k === '--only') a.only = new Set(argv[++i].split(',').map((s) => s.trim().padStart(2, '0')));
    else if (k === '--no-opt') a.opt = false;
    else if (k === '--fill') a.fill = path.resolve(argv[++i]);
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n')); process.exit(0); }
    else throw new Error('unknown argument ' + k);
  }
  // the private values live next to the slides' folder: deck/cf11/private/fill.json (git-ignored)
  if (!a.fill) a.fill = path.join(path.dirname(a.slides), 'private', 'fill.json');
  return a;
}

// data-fill="key" -> the value from the private fill file (personal data stays out of git; only the PPTX gets it)
function loadFill(file) {
  if (!fs.existsSync(file)) return { map: null, file };
  let map;
  try { map = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw Object.assign(new Error(`${file}: not valid JSON (${e.message})`), { friendly: true });
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw Object.assign(new Error(`${file}: expected an object {"key": "text", ...}`), { friendly: true });
  }
  return { map, file };
}

const HIDE_MARKED_CSS = `
  [data-pptx]:not(template) { opacity: 0 !important; }
  *, *::before, *::after { transition: none !important; caret-color: transparent !important; }
`;

async function settle(page) {
  await page.evaluate(async () => {
    document.documentElement.setAttribute('data-export', 'pptx');
    await document.fonts.ready;
    if (window.__ready && typeof window.__ready.then === 'function') {
      await Promise.race([window.__ready, new Promise((r) => setTimeout(r, 15000))]);
    }
    await Promise.all([...document.images].map((im) => (im.complete ? null : im.decode().catch(() => null))));
    for (const a of document.getAnimations()) {
      try {
        const end = a.effect && a.effect.getComputedTiming().endTime;
        if (end !== Infinity) a.finish(); else { a.pause(); a.currentTime = 0; }
      } catch (e) { try { a.pause(); a.currentTime = 0; } catch (e2) { /* ignore */ } }
    }
    for (const v of document.querySelectorAll('video')) { try { v.pause(); } catch (e) { /* ignore */ } }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

async function openSlide(ctx, file, fill) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn(`  page error in ${path.basename(file)}: ${e.message}`));
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 60000 });
  await page.addScriptTag({ path: path.join(HERE, 'extract_page.js') });
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  const filled = await page.evaluate((m) => window.__pptxFill(m), fill ? fill.map : null);
  await settle(page);
  page.__fill = filled;
  return page;
}

const urlToPath = (u) => (u && u.startsWith('file:') ? fileURLToPath(u) : u);

// An SVG written for inline use (no xmlns, no size) is not a valid standalone file: <img> shows nothing and
// PowerPoint rejects the svgBlip. Add the namespace(s) and a size in px so every consumer can read it.
function normalizeSvg(text, w, h) {
  let s = text.replace(/^﻿/, '').trim();
  const m = s.match(/<svg\b[^>]*>/i);
  if (!m) throw new Error('not an SVG file');
  let tag = m[0];
  const add = (attr) => { tag = tag.replace(/^<svg\b/i, `<svg ${attr}`); };
  if (!/\sxmlns=/.test(tag)) add('xmlns="http://www.w3.org/2000/svg"');
  if (/\bxlink:/.test(s) && !/\sxmlns:xlink=/.test(tag)) add('xmlns:xlink="http://www.w3.org/1999/xlink"');
  if (!/\swidth=/.test(tag) && w) add(`width="${Math.round(w)}"`);
  if (!/\sheight=/.test(tag) && h) add(`height="${Math.round(h)}"`);
  s = s.replace(m[0], tag);
  if (!/^<\?xml/.test(s)) s = '<?xml version="1.0" encoding="UTF-8"?>\n' + s;
  return s;
}
const relOut = (out, p) => path.relative(out, p).split(path.sep).join('/');

async function renderSvg(ctx, svgPath, w, h, fit, dest) {
  // PNG stand-in for an SVG picture (PowerPoint 2016, LibreOffice and the PDF show it), drawn at 2x by Chromium
  const page = await ctx.newPage({ viewport: { width: Math.ceil(w), height: Math.ceil(h) } });
  await page.setViewportSize({ width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h)) });
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <img src="${pathToFileURL(svgPath).href}" style="display:block;width:${w}px;height:${h}px;object-fit:${fit || 'contain'}"></body></html>`;
  const tmp = dest.replace(/\.png$/, '.html');
  fs.writeFileSync(tmp, html);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null))));
  await page.screenshot({ path: dest, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  fs.rmSync(tmp);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = fs.readdirSync(args.slides).filter((f) => /^\d{2}-.+\.html$/.test(f)).sort()
    .filter((f) => !args.only || args.only.has(f.slice(0, 2)));
  if (!files.length) throw Object.assign(new Error(`no NN-*.html slides in ${args.slides} (nothing to extract yet)`), { friendly: true });
  fs.mkdirSync(args.out, { recursive: true });
  const imgRoot = path.join(args.out, 'img');
  if (!args.only) fs.rmSync(imgRoot, { recursive: true, force: true });

  const fill = loadFill(args.fill);
  const missingFill = new Map();     // key -> slides that keep their placeholder
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const init = () => { window.__PPTX_EXPORT__ = true; };
  const ctx1 = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const ctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  await ctx1.addInitScript(init);
  await ctx2.addInitScript(init);

  const prevPath = path.join(args.out, 'slides.json');
  const prev = args.only && fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : null;
  const slides = [];
  let warnCount = 0;
  const t0 = Date.now();
  for (const file of files) {
    const nn = file.slice(0, 2);
    const abs = path.join(args.slides, file);
    const dir = path.join(imgRoot, nn);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const page = await openSlide(ctx1, abs, fill);
    for (const key of page.__fill.missing) missingFill.set(key, [...(missingFill.get(key) || []), nn]);
    const data = await page.evaluate(() => window.__pptxCollect());
    if (data.error) throw new Error(`${file}: ${data.error}`);
    data.filled = page.__fill.filled;
    const clip = { x: data.root.x, y: data.root.y, width: data.root.w, height: data.root.h };
    await page.screenshot({ path: path.join(dir, 'ref.png'), clip });
    await page.addStyleTag({ content: HIDE_MARKED_CSS });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(dir, 'bg.png'), clip });
    await page.close();

    const page2 = await openSlide(ctx2, abs, fill);
    await page2.evaluate(() => window.__pptxAssignIds());
    for (const e of data.elements) {
      if (e.src) {
        for (const k of ['url', 'poster']) if (e.src[k]) e.src[k] = urlToPath(e.src[k]);
        e.src.path = e.src.url; delete e.src.url;
        if (e.src.path && !fs.existsSync(e.src.path)) { data.warnings.push(`${e.id}: missing file ${e.src.path}`); }
        if (e.src.poster && !fs.existsSync(e.src.poster)) { data.warnings.push(`${e.id}: missing poster ${e.src.poster}`); e.src.poster = null; }
      }
      if (!e.render) continue;
      const out = path.join(dir, `${e.id}-${e.render.mode}.png`);
      if (e.render.mode === 'svg') {
        if (!e.src.path || !fs.existsSync(e.src.path)) { delete e.render; continue; }
        const fixed = out.replace(/\.png$/, '.svg');
        fs.writeFileSync(fixed, normalizeSvg(fs.readFileSync(e.src.path, 'utf8'), e.box.w, e.box.h));
        await renderSvg(ctx2, fixed, e.box.w, e.box.h, e.src.fit, out);
        e.render = { mode: 'svg', png: relOut(args.out, out), svg: relOut(args.out, fixed), rect: { ...e.box }, scale: 2 };
        continue;
      }
      let hide = '';
      if (e.render.mode !== 'image' && e.style) {
        const parts = [];
        if (e.style.fill) parts.push('bg');
        if (e.style.line && e.style.lineUniform) parts.push('border');
        if (e.style.shadowNative) parts.push('shadow');     // the PPTX object draws it (a:outerShdw)
        hide = parts.join(' ');
      }
      const r = await page2.evaluate(([id, mode, h]) => window.__pptxRenderPrep(id, mode, h), [e.id, e.render.mode, hide]);
      await page2.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      if (r) {
        await page2.screenshot({ path: out, omitBackground: true, clip: { x: r.page.x, y: r.page.y, width: r.page.w, height: r.page.h } });
        e.render = { mode: e.render.mode, png: relOut(args.out, out), rect: r.slide, scale: 2 };
      } else {
        delete e.render;
      }
      await page2.evaluate(() => window.__pptxRenderClear());
    }
    // the glyphs of every live text box alone, 2x: not used by the PPTX, but the motion preview animates them
    for (const e of data.elements) {
      if (e.type !== 'text' && e.type !== 'title') continue;
      const out = path.join(dir, `${e.id}-text.png`);
      const r = await page2.evaluate(([id]) => window.__pptxRenderPrep(id, 'text', ''), [e.id]);
      await page2.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      if (r) {
        await page2.screenshot({ path: out, omitBackground: true, clip: { x: r.page.x, y: r.page.y, width: r.page.w, height: r.page.h } });
        e.textLayer = { png: relOut(args.out, out), rect: r.slide, scale: 2 };
      }
      await page2.evaluate(() => window.__pptxRenderClear());
    }
    await page2.close();

    for (const w of data.warnings) console.warn(`  ! ${file}: ${w}`);
    warnCount += data.warnings.length;
    const counts = data.elements.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
    console.log(`${file}: ${data.elements.length} objects ${JSON.stringify(counts)}, transition ${data.transition.type}, ` +
      `${data.notes.length} notes paragraph(s), ${data.elements.filter((e) => e.render).length} picture render(s)`);
    slides.push({ nn, file, source: abs, background: relOut(args.out, path.join(dir, 'bg.png')),
                  reference: relOut(args.out, path.join(dir, 'ref.png')), ...data });
  }
  await browser.close();
  for (const [key, nns] of missingFill) {
    const where = `slide${nns.length > 1 ? 's' : ''} ${[...new Set(nns)].join(', ')}`;
    console.warn(fill.map
      ? `  ! fill: no "${key}" in ${fill.file} (${where}): the authored placeholder stays`
      : `  ! fill: ${fill.file} not found, "${key}" keeps the authored placeholder (${where})`);
    warnCount += 1;
  }

  let all = slides;
  if (prev) {
    const byNn = new Map(prev.slides.map((s) => [s.nn, s]));
    for (const s of slides) byNn.set(s.nn, s);
    all = [...byNn.values()].sort((a, b) => a.nn.localeCompare(b.nn));
  }
  const doc = { format: 'cf11-slides/1', generated: new Date().toISOString(), slidesDir: args.slides,
                slide: { w: 1920, h: 1080 }, slides: all };
  fs.writeFileSync(prevPath, JSON.stringify(doc, null, 1));
  console.log(`wrote ${prevPath}: ${all.length} slide(s), ${warnCount} warning(s), ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  if (args.opt) {
    const py = process.env.PYTHON || path.join(HERE, '.venv', 'bin', 'python');
    const r = spawnSync(fs.existsSync(py) ? py : 'python3', [path.join(HERE, 'imgopt.py'), prevPath], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('imgopt.py failed');
  }
}

main().catch((e) => { console.error(e.friendly ? e.message : (e.stack || String(e))); process.exit(1); });
