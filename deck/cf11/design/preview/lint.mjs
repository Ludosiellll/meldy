// Checks every slide against CONTRACT.md and the deck's own rules, in Chromium (computed styles, real boxes).
//
//   node deck/cf11/design/preview/lint.mjs            exit 1 if anything is an error
//
// Errors: the title (one, the exact mandatory name), data-pptx / data-anim values, Morph names (unique on a
// slide, one kind across slides, never animated where they morph), the strip and counter of each slide, text under
// 28 px, colours outside the tokens, missing media, text outside the slide or its card, missing notes, Russian
// typography that breaks (a hanging short word at a line end, " - " for a dash, straight quotes, a full stop after
// a heading). Warnings: a regular space where a non-breaking one belongs.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SLIDES, SLIDES_DIR, STRIP, squareState, counterText, loadPlaywright } from '../deck.mjs';

const TOKENS = {
  canvas: '243,243,240', surface: '255,255,255', ink: '11,18,28', muted: '75,81,91', faint: '138,143,151',
  line: '227,227,221', blue: '40,105,221', blueFg: '31,91,198', yellow: '244,196,91', named: '233,177,60', pink: '245,182,205',
};
const TOKEN_RGB = new Set(Object.values(TOKENS));
const PPTX = new Set(['title', 'text', 'shape', 'image', 'video', 'gif', 'notes']);
const ANIM = new Set(['fade', 'rise', 'wipe', 'zoom', 'appear']);
const TRIG = new Set(['after', 'with', 'click']);
// Short words that must not end a line and should be glued to the next word.
// (Particles «же», «ли», «бы» bind to the word before them, so they are not here.)
const SHORT = ['в', 'и', 'к', 'с', 'у', 'о', 'а', 'я', 'на', 'по', 'за', 'из', 'от', 'до', 'не', 'ни', 'во', 'со', 'ко', 'об', 'для', 'без', 'при', 'про', 'над', 'под', 'или', 'но', 'что', 'как'];

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
const warns = [];
const err = (n, m) => errors.push(`${String(n).padStart(2, '0')}  ${m}`);
const warn = (n, m) => warns.push(`${String(n).padStart(2, '0')}  ${m}`);
const names = new Map(); // name -> { kind, slides: [] }
const perSlideNames = [];

for (const slide of SLIDES) {
  const file = path.join(SLIDES_DIR, slide.file);
  if (!fs.existsSync(file)) { err(slide.n, `missing ${slide.file}`); perSlideNames.push(new Map()); continue; }
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const fontErr = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight}`));
  if (fontErr.length) err(slide.n, `fonts failed: ${fontErr.join(', ')}`);

  const R = await page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const marked = [...document.querySelectorAll('[data-pptx]')].map((el, i) => ({
      i, kind: el.dataset.pptx, name: el.dataset.name || null, cls: el.className || '', tag: el.tagName,
      text: el.dataset.pptx === 'text' || el.dataset.pptx === 'title' ? el.innerText : '',
      anim: el.dataset.anim || null, trig: el.dataset.animTrigger || null, delay: el.dataset.animDelay ?? null,
      dur: el.dataset.animDur ?? null, order: el.dataset.animOrder ?? null,
      src: el.dataset.src || null, poster: el.dataset.poster || null, imgsrc: el.tagName === 'IMG' ? el.getAttribute('src') : null,
      innerImgs: [...el.querySelectorAll('img')].map((im) => im.getAttribute('src')),
      box: box(el), sw: el.scrollWidth, cw: el.clientWidth, ws: getComputedStyle(el).whiteSpace,
      hasExplicitWidth: Boolean(el.style.width),
    }));
    // Every text node that will be visible (live or baked), with its computed size.
    const texts = [];
    const walker = document.createTreeWalker(document.querySelector('.slide'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const el = n.parentElement;
      if (el.closest('template')) continue;
      const media = el.closest('[data-pptx="image"],[data-pptx="gif"],[data-pptx="video"]');
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      texts.push({ t, size: parseFloat(cs.fontSize), media: Boolean(media) });
    }
    // Colours in use, outside pictures and video (those are the product's own pixels).
    const colours = [];
    for (const el of document.querySelectorAll('.slide *')) {
      if (el.closest('[data-pptx="gif"],[data-pptx="video"]') || el.tagName === 'IMG' || el.tagName === 'svg' || el.closest('svg') || el.tagName === 'TEMPLATE') continue;
      const cs = getComputedStyle(el);
      const add = (prop, v) => { if (v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent') colours.push({ prop, v, cls: el.className || el.tagName }); };
      if (el.childNodes.length && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) add('color', cs.color);
      add('background', cs.backgroundColor);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') add('border', cs[`border${side}Color`]);
      if (cs.boxShadow && cs.boxShadow !== 'none') (cs.boxShadow.match(/rgba?\([^)]*\)/g) || []).forEach((c) => add('shadow', c));
    }
    // In PowerPoint the baked background lies under every native object: a baked layer drawn above a marked one
    // in the HTML would end up hidden beneath it. Shadows are meant to be under their cards.
    const layers = [...document.querySelector('.slide').children].filter((el) => el.tagName !== 'TEMPLATE');
    const buried = [];
    layers.forEach((el, k) => {
      if (el.dataset.pptx || el.classList.contains('shadow')) return;
      const cs = getComputedStyle(el);
      const paints = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') || parseFloat(cs.borderTopWidth) > 0 || el.innerText.trim();
      if (!paints) return;
      const e = el.getBoundingClientRect();
      for (const below of layers.slice(0, k)) {
        if (!['shape', 'image', 'video', 'gif'].includes(below.dataset.pptx)) continue;
        const s = below.getBoundingClientRect();
        const ox = Math.min(e.right, s.right) - Math.max(e.left, s.left), oy = Math.min(e.bottom, s.bottom) - Math.max(e.top, s.top);
        if (ox > 1 && oy > 1) { buried.push(`${el.className || el.tagName} under ${below.dataset.pptx} ${below.dataset.name || below.className}`); break; }
      }
    });
    const cards = [...document.querySelectorAll('.card[data-pptx="shape"]')].map((el) => box(el));
    const notes = document.querySelector('template[data-pptx="notes"]');
    const slideEl = document.querySelector('.slide');
    return { marked, texts, colours, cards, buried, notes: notes ? notes.innerHTML.trim() : null, transition: slideEl.dataset.transition || 'morph' };
  });

  // ---- the title
  const titles = R.marked.filter((m) => m.kind === 'title');
  if (titles.length !== 1) err(slide.n, `${titles.length} title elements (need exactly one)`);
  else if (titles[0].text.trim().toLowerCase() !== slide.title.toLowerCase()) err(slide.n, `title «${titles[0].text.trim()}» ≠ «${slide.title}»`);
  if (!['morph', 'fade', 'none'].includes(R.transition)) err(slide.n, `data-transition="${R.transition}"`);

  // ---- markup values
  const slideNames = new Map();
  for (const m of R.marked) {
    if (!PPTX.has(m.kind)) err(slide.n, `data-pptx="${m.kind}"`);
    if (m.anim != null) {
      if (!ANIM.has(m.anim)) err(slide.n, `data-anim="${m.anim}" on ${m.cls}`);
      if (m.trig != null && !TRIG.has(m.trig)) err(slide.n, `data-anim-trigger="${m.trig}"`);
      for (const [k, v] of [['delay', m.delay], ['dur', m.dur], ['order', m.order]]) if (v != null && !/^\d+$/.test(v)) err(slide.n, `data-anim-${k}="${v}"`);
      if (m.delay != null && Number(m.delay) > 400) warn(slide.n, `long delay ${m.delay} ms`);
      if (m.dur != null && (Number(m.dur) < 200 || Number(m.dur) > 1200)) warn(slide.n, `duration ${m.dur} ms`);
    } else if (m.trig || m.delay || m.dur) err(slide.n, `animation attributes without data-anim on ${m.cls}`);
    if (m.name) {
      if (!m.name.startsWith('!!')) err(slide.n, `Morph name «${m.name}» must start with !!`);
      if (slideNames.has(m.name)) err(slide.n, `Morph name ${m.name} used twice`);
      slideNames.set(m.name, m);
      const kind = m.kind === 'title' ? 'text' : m.kind;
      if (!names.has(m.name)) names.set(m.name, { kind, slides: [] });
      const rec = names.get(m.name);
      if (rec.kind !== kind) err(slide.n, `Morph name ${m.name} is a ${kind} here but a ${rec.kind} elsewhere`);
      rec.slides.push(slide.n);
    }
    // media
    for (const ref of [m.src, m.poster, m.imgsrc, ...m.innerImgs]) {
      if (!ref || ref.startsWith('data:')) continue;
      if (!fs.existsSync(path.resolve(SLIDES_DIR, ref))) err(slide.n, `missing file ${ref}`);
    }
    if ((m.kind === 'video') && (!m.src || !m.poster)) err(slide.n, 'video without data-src or data-poster');
    if (m.kind === 'gif' && !m.src) err(slide.n, 'gif without data-src');
    // inside the slide
    const b = m.box;
    if (b.x < -1 || b.y < -1 || b.x + b.w > 1921 || b.y + b.h > 1081) err(slide.n, `${m.kind} ${m.cls} outside the slide (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`);
    if ((m.kind === 'text' || m.kind === 'title') && m.hasExplicitWidth && m.sw > m.cw + 1) err(slide.n, `text overflows its box: «${m.text.slice(0, 40)}» (${m.sw} > ${m.cw})`);
  }
  perSlideNames.push(slideNames);
  if (R.marked.filter((m) => m.anim).length < 2) err(slide.n, 'fewer than 2 animation steps');

  // ---- text inside its card: a live text whose middle is on a card stays 24 px inside the card's edges
  for (const m of R.marked.filter((x) => x.kind === 'text')) {
    const cx = m.box.x + m.box.w / 2, cy = m.box.y + m.box.h / 2;
    const card = R.cards.find((c) => cx > c.x && cx < c.x + c.w && cy > c.y && cy < c.y + c.h);
    if (!card) continue;
    const pad = 20;
    if (m.box.x < card.x + pad - 1 || m.box.x + m.box.w > card.x + card.w - pad + 1 || m.box.y < card.y + pad - 1 || m.box.y + m.box.h > card.y + card.h - pad + 1) {
      err(slide.n, `text crowds or leaves its card: «${m.text.replace(/\n/g, ' / ').slice(0, 50)}»`);
    }
  }

  // ---- the strip, the counter, the corner
  for (let i = 1; i <= 10; i += 1) {
    const name = `!!s${String(i).padStart(2, '0')}`;
    const sq = slideNames.get(name);
    const state = squareState(slide, i);
    if (!sq) { err(slide.n, `strip square ${name} missing`); continue; }
    if (sq.kind !== 'shape') err(slide.n, `${name} is not a shape`);
    if (state !== 'gather') {
      if (!sq.cls.split(/\s+/).includes(state)) err(slide.n, `${name} should be «${state}», is «${sq.cls}»`);
      if (Math.round(sq.box.x) !== STRIP.x + STRIP.step * (i - 1) || Math.round(sq.box.y) !== STRIP.y || Math.round(sq.box.w) !== STRIP.size) err(slide.n, `${name} not at its place in the strip`);
    } else {
      const dot = slideNames.get('!!dot');
      if (!dot || Math.abs(dot.box.x - sq.box.x) > 1 || Math.abs(dot.box.y - sq.box.y) > 1) err(slide.n, `${name} has not gathered into the dot`);
    }
    if (sq.anim) err(slide.n, `${name} must not be animated (it morphs)`);
  }
  const left = slideNames.get('!!left');
  if (!left) err(slide.n, 'counter !!left missing');
  else if (left.text.trim() !== counterText(slide)) err(slide.n, `counter «${left.text.trim()}» ≠ «${counterText(slide)}»`);
  if (slide.corner === 'mark' && (!slideNames.get('!!word') || !slideNames.get('!!dot'))) err(slide.n, 'the corner wordmark or its dot is missing');

  // ---- type size, colours
  for (const t of R.texts) if (!t.media && t.size < 28 - 0.01) err(slide.n, `text under 28 px (${t.size}px): «${t.t.slice(0, 40)}»`);
  for (const c of R.colours) {
    const m = /rgba?\(([^)]*)\)/.exec(c.v);
    if (!m) continue;
    const parts = m[1].split(',').map((s) => s.trim());
    const rgb = parts.slice(0, 3).map(Number).join(',');
    const a = parts[3] != null ? Number(parts[3]) : 1;
    if (a === 0) continue;
    if (!TOKEN_RGB.has(rgb)) err(slide.n, `colour ${c.v} (${c.prop}) on ${String(c.cls).slice(0, 40)} is not a token`);
  }

  for (const x of R.buried) err(slide.n, `baked layer drawn above a native object would be hidden under it in PowerPoint: ${x}`);

  // ---- notes
  if (!R.notes) err(slide.n, 'no speaker notes');

  // ---- Russian typography on live text
  for (const m of R.marked.filter((x) => x.kind === 'text' || x.kind === 'title' || x.kind === 'notes')) {
    if (m.kind === 'notes') continue;
    const lines = m.text.split('\n');
    lines.forEach((line, k) => {
      const words = line.trim().split(/[  ]+/);
      const last = (words[words.length - 1] || '').toLowerCase().replace(/[«(]/g, '');
      if (k < lines.length - 1 && SHORT.includes(last)) err(slide.n, `hanging «${last}» at a line end: «${line.trim().slice(-30)}»`);
    });
    const t = m.text;
    if (/ - /.test(t)) err(slide.n, `« - » instead of a dash: «${t.slice(0, 40)}»`);
    if (/"/.test(t)) err(slide.n, `straight quotes: «${t.slice(0, 40)}»`);
    if (/ —/.test(t.replace(/\n/g, ' '))) warn(slide.n, `regular space before a dash: «${t.slice(0, 40)}»`);
    if (/  /.test(t)) err(slide.n, `double space: «${t.slice(0, 40)}»`);
    const isHeading = m.kind === 'title' || /\b(claim|h|h56|label)\b/.test(m.cls);
    if (isHeading && /\.$/.test(t.trim()) && !/\b(тыс|г|др)\.$/.test(t.trim())) err(slide.n, `full stop after a heading: «${t.trim().slice(-30)}»`);
    // The mandatory names stay exactly as Приложение 2 spells them, with plain spaces.
    for (const w of m.kind === 'title' ? [] : SHORT.filter((s) => s.length <= 2)) {
      const re = new RegExp(`(^|[\\s«(])${w} (?=\\S)`, 'iu');
      if (re.test(t)) { warn(slide.n, `regular space after «${w}»: «${t.replace(/\n/g, ' / ').slice(0, 50)}»`); break; }
    }
    if (/\d [а-яё]{3,}/iu.test(t)) warn(slide.n, `regular space between a number and its word: «${t.slice(0, 40)}»`);
  }
}

// ---- Morph names across slides: report each name's chain; a name that morphs must not be animated on arrival
for (let k = 1; k < SLIDES.length; k += 1) {
  const prev = perSlideNames[k - 1], cur = perSlideNames[k];
  for (const [name, m] of cur) if (prev.has(name) && m.anim && name !== '!!t07') err(SLIDES[k].n, `${name} morphs from slide ${SLIDES[k - 1].n} but has an entrance animation`);
}
const chains = [...names.entries()].map(([n, r]) => `${n.padEnd(8)} ${r.kind.padEnd(6)} ${r.slides.join(' ')}`);

await browser.close();
console.log('Morph names (name, kind, slides):');
console.log(chains.filter((c) => !/^!!s\d\d/.test(c)).map((c) => `  ${c}`).join('\n'));
console.log(`  !!s01…!!s10 shape on every slide`);
if (warns.length) { console.log(`\n${warns.length} warning(s):`); console.log(warns.map((w) => `  ${w}`).join('\n')); }
if (errors.length) { console.log(`\n${errors.length} error(s):`); console.log(errors.map((e) => `  ${e}`).join('\n')); process.exit(1); }
console.log('\nlint: no errors');
