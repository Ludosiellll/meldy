// Preview of the deck as the jury sees it before anything moves, plus how each slide builds.
//
//   node deck/cf11/design/preview/shoot.mjs [NN ...] [--build] [--bg] [--no-sheet]
//
// Writes, under deck/cf11/out/preview/:
//   NN.png            the slide at 1920×1080 (the still: every object at its final place)
//   contact.png       all slides on one labelled sheet
//   build/NN.png      (--build) the slide after each animation step, left to right, as a strip
//   bg/NN.png         (--bg) what the compiler bakes into the background (marked objects hidden)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SLIDES, SLIDES_DIR, ROOT, loadPlaywright } from '../deck.mjs';

const args = process.argv.slice(2);
const want = new Set(args.filter((a) => /^\d+$/.test(a)).map(Number));
const doBuild = args.includes('--build');
const doBg = args.includes('--bg');
const doSheet = !args.includes('--no-sheet');
const OUT = path.join(ROOT, 'out', 'preview');
fs.mkdirSync(path.join(OUT, 'build'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'bg'), { recursive: true });

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });

async function open(slide) {
  await page.goto(pathToFileURL(path.join(SLIDES_DIR, slide.file)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = r; im.onerror = r; })))));
  const bad = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight} ${f.status}`));
  if (bad.length) console.log(`  fonts not loaded: ${bad.join(', ')}`);
}

/** The build order of a slide: groups of elements that appear together, as PowerPoint plays them. */
async function steps() {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-anim]')].map((el, i) => ({
      el, i,
      order: el.dataset.animOrder != null ? Number(el.dataset.animOrder) : i,
      trigger: el.dataset.animTrigger || 'after',
      anim: el.dataset.anim,
      delay: Number(el.dataset.animDelay || 0),
    }));
    els.sort((a, b) => a.order - b.order || a.i - b.i);
    const groups = [];
    for (const e of els) {
      if (e.trigger === 'with' && groups.length) groups[groups.length - 1].push(e);
      else groups.push([e]);
    }
    els.forEach((e, k) => e.el.setAttribute('data-step-id', String(k)));
    const idx = new Map(els.map((e, k) => [e.el, k]));
    return groups.map((g) => ({ ids: g.map((e) => idx.get(e.el)), label: g.map((e) => `${e.trigger === 'click' ? '⏵click ' : ''}${e.anim}${e.delay ? ` +${e.delay}` : ''}`).join(' · ') }));
  });
}

const shots = [];
for (const slide of SLIDES) {
  if (want.size && !want.has(slide.n)) continue;
  const nn = String(slide.n).padStart(2, '0');
  if (!fs.existsSync(path.join(SLIDES_DIR, slide.file))) { console.log(`${nn} missing`); continue; }
  await open(slide);
  await page.screenshot({ path: path.join(OUT, `${nn}.png`) });
  shots.push(slide);
  console.log(`${nn} ${slide.title}`);

  if (doBg) {
    await page.addStyleTag({ content: '[data-pptx]{visibility:hidden!important}' });
    await page.screenshot({ path: path.join(OUT, 'bg', `${nn}.png`) });
    await open(slide);
  }

  if (doBuild) {
    const groups = await steps();
    const frames = [];
    const total = groups.length;
    for (let k = -1; k < total; k += 1) {
      await page.evaluate((shown) => {
        document.querySelectorAll('[data-step-id]').forEach((el) => {
          el.style.visibility = shown.includes(Number(el.dataset.stepId)) ? '' : 'hidden';
        });
      }, groups.slice(0, k + 1).flatMap((g) => g.ids));
      const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
      frames.push({ src: `data:image/jpeg;base64,${buf.toString('base64')}`, label: k < 0 ? 'после перехода' : `${k + 1}. ${groups[k].label}` });
    }
    const cols = Math.min(frames.length, 4);
    const rows = Math.ceil(frames.length / cols);
    const html = `<body style="margin:0;background:#e9e9e4;font:600 22px/1.3 sans-serif">
      <div style="padding:16px 20px 0">${nn} · ${slide.title} — ${total} шаг(ов)</div>
      <div style="display:grid;grid-template-columns:repeat(${cols},480px);gap:14px;padding:12px 20px 20px">
      ${frames.map((f) => `<figure style="margin:0"><img src="${f.src}" style="width:480px;height:270px;display:block;outline:1px solid #ccc"><figcaption style="font:500 15px/1.3 sans-serif;padding-top:4px">${f.label}</figcaption></figure>`).join('')}
      </div></body>`;
    const p2 = await browser.newPage({ viewport: { width: 40 + cols * 494, height: 60 + rows * 310 } });
    await p2.setContent(html);
    await p2.screenshot({ path: path.join(OUT, 'build', `${nn}.png`), fullPage: true });
    await p2.close();
  }
}

// --morph: for each slide change, where every named object comes from and goes to, drawn over the new slide.
if (args.includes('--morph')) {
  fs.mkdirSync(path.join(OUT, 'morph'), { recursive: true });
  const boxes = async () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-name]')].map((el) => {
    const r = el.getBoundingClientRect();
    return [el.dataset.name, [r.left, r.top, r.width, r.height]];
  })));
  let prev = null;
  for (const slide of SLIDES) {
    if (!fs.existsSync(path.join(SLIDES_DIR, slide.file))) { prev = null; continue; }
    await open(slide);
    const cur = await boxes();
    if (prev && (!want.size || want.has(slide.n))) {
      const svg = [];
      for (const [name, b] of Object.entries(cur)) {
        if (/^!!s\d\d$/.test(name)) continue;
        const a = prev[name];
        if (a) {
          svg.push(`<rect x="${a[0]}" y="${a[1]}" width="${a[2]}" height="${a[3]}" fill="none" stroke="#c0c" stroke-width="3" stroke-dasharray="10 8"/>`);
          svg.push(`<line x1="${a[0] + a[2] / 2}" y1="${a[1] + a[3] / 2}" x2="${b[0] + b[2] / 2}" y2="${b[1] + b[3] / 2}" stroke="#c0c" stroke-width="4" marker-end="url(#h)"/>`);
          svg.push(`<text x="${b[0] + 8}" y="${b[1] + 26}" font: 600 22px sans-serif fill="#c0c" style="font:600 22px sans-serif">${name}</text>`);
        } else svg.push(`<rect x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" fill="none" stroke="#0a0" stroke-width="3"/>`);
      }
      for (const [name, a] of Object.entries(prev)) if (!cur[name] && !/^!!s\d\d$/.test(name)) svg.push(`<rect x="${a[0]}" y="${a[1]}" width="${a[2]}" height="${a[3]}" fill="none" stroke="#e33" stroke-width="3" stroke-dasharray="4 6"/>`);
      await page.evaluate((inner) => {
        const d = document.createElement('div');
        d.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" style="position:absolute;left:0;top:0;z-index:99"><defs><marker id="h" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#c0c"/></marker></defs>${inner}</svg>`;
        document.querySelector('.slide').appendChild(d.firstChild);
      }, svg.join(''));
      await page.screenshot({ path: path.join(OUT, 'morph', `${String(slide.n).padStart(2, '0')}.png`) });
    }
    prev = cur;
  }
}

if (doSheet && !want.size) {
  const cells = SLIDES.filter((s) => fs.existsSync(path.join(OUT, `${String(s.n).padStart(2, '0')}.png`))).map((s) => {
    const nn = String(s.n).padStart(2, '0');
    const buf = fs.readFileSync(path.join(OUT, `${nn}.png`));
    return `<figure style="margin:0"><img src="data:image/png;base64,${buf.toString('base64')}" style="width:600px;height:338px;display:block;box-shadow:0 0 0 1px #d6d6d0"><figcaption style="padding-top:8px">${nn} · ${s.title}</figcaption></figure>`;
  });
  const html = `<body style="margin:0;background:#ffffff;font:500 20px/1.3 sans-serif;color:#0b121c">
    <div style="padding:24px 28px 4px;font-weight:700;font-size:26px">Meldy · CodingFest-11 — неподвижные кадры (как в PDF)</div>
    <div style="display:grid;grid-template-columns:repeat(3,600px);gap:26px 22px;padding:20px 28px 28px">${cells.join('')}</div></body>`;
  const p3 = await browser.newPage({ viewport: { width: 1900, height: 1200 } });
  await p3.setContent(html);
  await p3.screenshot({ path: path.join(OUT, 'contact.png'), fullPage: true });
  await p3.close();
  console.log(`contact sheet: ${path.join(OUT, 'contact.png')}`);
}
await browser.close();
