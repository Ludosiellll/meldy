// Checks every slide against CONTRACT.md and the deck's own rules, in Chromium (computed styles, real boxes).
//
//   node deck/cf11/design/preview/lint.mjs            exit 1 if anything is an error
//
// Errors: the title (one, the exact mandatory name), data-pptx / data-anim / data-anim-dir / data-morph /
// data-transition(-dur) / data-fill / data-play / data-shadow values, Morph names (unique on a slide, one kind across slides, never
// animated where they morph in — titles included: the compiler names every title !!title), the strip and counter of
// each slide (gathered under the dot on 01 and 15, light on the dark stage slides), text under 28 px, colours outside
// the slide's token set (light, or the app's dark theme on 05 and 12), the round-2 scale (claim 72–80 px and two lines
// at most, statement 96–112, hero number 360–440, wordmark 280–320), missing media, native objects crossing the
// slide's edge, text outside its card, missing notes, Russian typography that breaks (a hanging short word at a line
// end, " - " for a dash, straight quotes, a full stop after a heading). Warnings: a regular space where a non-breaking
// one belongs, more than about 35 words outside the reading layer (02, 13, 14 excepted), a picture or video that
// crosses the edge (the compiler crops it).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SLIDES, SLIDES_DIR, STRIP, squareState, counterText, loadPlaywright } from '../deck.mjs';

const TOKENS = {
  canvas: '243,243,240', surface: '255,255,255', ink: '11,18,28', muted: '75,81,91', faint: '138,143,151',
  line: '227,227,221', blue: '40,105,221', blueFg: '31,91,198', blueSoft: '232,239,252', yellow: '244,196,91',
  named: '233,177,60', pink: '245,182,205',
};
// The stage slides (05, 12): the app's dark theme (frontend/src/index.css .dark), plus the yellow dot.
const DARK = {
  canvas: '11,15,22', surface: '20,26,36', surfaceSoft: '27,34,48', ink: '243,243,240', muted: '167,173,183',
  line: '38,46,59', labels: '141,178,245', yellow: '244,196,91', named: '233,177,60',
};
const TOKEN_RGB = new Set(Object.values(TOKENS));
const DARK_RGB = new Set(Object.values(DARK));
const PPTX = new Set(['title', 'text', 'shape', 'image', 'video', 'gif', 'notes']);
const ANIM = new Set(['fade', 'rise', 'wipe', 'zoom', 'appear', 'settle']);
const DIRS = new Set(['left', 'right', 'up', 'down']);
const MORPH = new Set(['object', 'word', 'char']);
const FILL = /^author[12]\.(name|role|initials)$/;
// The round-2 scale: one hero per slide at a size nothing else comes near.
const SCALE = { claim: [72, 80], statement: [96, 112], hero: [360, 440], word: [280, 320] };
const WORDY_OK = new Set([2, 13, 14]); // list slides: the authors, the sources, the requirements
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
      dur: el.dataset.animDur ?? null, order: el.dataset.animOrder ?? null, dir: el.dataset.animDir ?? null,
      fill: el.dataset.fill ?? null, play: el.dataset.play ?? null,
      shadow: el.dataset.shadow ?? null, boxShadow: getComputedStyle(el).boxShadow,
      size: parseFloat(getComputedStyle(el).fontSize), lh: parseFloat(getComputedStyle(el).lineHeight),
      words: el.dataset.pptx === 'text' || el.dataset.pptx === 'title' ? el.innerText.split(/\s+/).filter((w) => /[A-Za-zА-Яа-яЁё0-9]/.test(w)).length : 0,
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
    // A baked shadow under a shape that fades in would show alone before its shape arrives.
    const ghost = [];
    layers.forEach((el) => {
      if (!el.classList.contains('shadow')) return;
      const e = el.getBoundingClientRect();
      for (const s of layers) {
        if (s.dataset.pptx !== 'shape' || !s.dataset.anim) continue;
        const r = s.getBoundingClientRect();
        if (Math.abs(r.left - e.left) < 2 && Math.abs(r.top - e.top) < 2 && Math.abs(r.width - e.width) < 2) ghost.push(s.className);
      }
    });
    const cards = [...document.querySelectorAll('.card[data-pptx="shape"]')].map((el) => box(el));
    const notes = document.querySelector('template[data-pptx="notes"]');
    const slideEl = document.querySelector('.slide');
    const strayShadow = [...document.querySelectorAll('[data-shadow]:not([data-pptx])')].map((el) => el.className || el.tagName);
    return { marked, texts, colours, cards, buried, ghost, strayShadow, notes: notes ? notes.innerHTML.trim() : null, transition: slideEl.dataset.transition || 'morph',
      tdur: slideEl.dataset.transitionDur ?? null, morph: slideEl.dataset.morph ?? null, dark: slideEl.classList.contains('dark') };
  });

  // ---- the title
  const titles = R.marked.filter((m) => m.kind === 'title');
  if (titles.length !== 1) err(slide.n, `${titles.length} title elements (need exactly one)`);
  else if (titles[0].text.trim().toLowerCase() !== slide.title.toLowerCase()) err(slide.n, `title «${titles[0].text.trim()}» ≠ «${slide.title}»`);
  if (!['morph', 'fade', 'none'].includes(R.transition)) err(slide.n, `data-transition="${R.transition}"`);
  if (R.tdur != null && (!/^\d+$/.test(R.tdur) || Number(R.tdur) < 300 || Number(R.tdur) > 3000)) err(slide.n, `data-transition-dur="${R.tdur}" (300–3000 ms)`);
  if (R.morph != null && !MORPH.has(R.morph)) err(slide.n, `data-morph="${R.morph}"`);
  if (Boolean(slide.dark) !== R.dark) err(slide.n, slide.dark ? 'a stage slide must be <main class="slide dark">' : 'class "dark" on a light slide');
  if (slide.n > 1 && titles.length === 1 && titles[0].anim) err(slide.n, 'the title morphs in from the previous slide (!!title): no entrance animation');

  // ---- markup values
  for (const c of R.strayShadow) err(slide.n, `data-shadow on an unmarked element (${c}): only a marked object has its own shadow`);
  const slideNames = new Map();
  for (const m of R.marked) {
    if (!PPTX.has(m.kind)) err(slide.n, `data-pptx="${m.kind}"`);
    if (m.anim != null) {
      if (!ANIM.has(m.anim)) err(slide.n, `data-anim="${m.anim}" on ${m.cls}`);
      if (m.trig != null && !TRIG.has(m.trig)) err(slide.n, `data-anim-trigger="${m.trig}"`);
      for (const [k, v] of [['delay', m.delay], ['dur', m.dur], ['order', m.order]]) if (v != null && !/^\d+$/.test(v)) err(slide.n, `data-anim-${k}="${v}"`);
      if (m.delay != null && Number(m.delay) > 600 && m.trig !== 'with') warn(slide.n, `long delay ${m.delay} ms`);
      if (m.dur != null && (Number(m.dur) < 200 || Number(m.dur) > 1200)) warn(slide.n, `duration ${m.dur} ms`);
      if (m.dir != null && (m.anim !== 'wipe' || !DIRS.has(m.dir))) err(slide.n, `data-anim-dir="${m.dir}" (wipe only: left|right|up|down)`);
    } else if (m.trig || m.delay || m.dur || m.dir) err(slide.n, `animation attributes without data-anim on ${m.cls}`);
    if (m.fill != null && (!FILL.test(m.fill) || m.kind !== 'text')) err(slide.n, `data-fill="${m.fill}" (author1|author2 .name|.role|.initials, on text)`);
    if (m.play != null && (!['with', 'after'].includes(m.play) || m.kind !== 'video')) err(slide.n, `data-play="${m.play}" (with|after, on a video)`);
    // data-shadow (tools/README.md note 21): «native» is the default, «bake» keeps the shadow in the object's layer
    if (m.shadow != null && !['bake', 'native'].includes(m.shadow)) err(slide.n, `data-shadow="${m.shadow}" (bake|native)`);
    if (m.shadow != null && m.boxShadow === 'none') warn(slide.n, `data-shadow="${m.shadow}" on ${m.cls || m.kind} without a box-shadow`);
    // the round-2 scale
    const cl = String(m.cls).split(/\s+/);
    for (const [k, [a, b]] of Object.entries(SCALE)) {
      if (!cl.includes(k) || (m.kind !== 'text')) continue;
      if (m.size < a - 0.01 || m.size > b + 0.01) err(slide.n, `${k} at ${m.size}px (${a}–${b}): «${m.text.slice(0, 30)}»`);
      if ((k === 'claim' || k === 'statement') && Math.round(m.box.h / m.lh) > 2) err(slide.n, `${k} on ${Math.round(m.box.h / m.lh)} lines (two at most)`);
    }
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
    if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > 1920.5 || b.y + b.h > 1080.5) {
      const where = `(${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`;
      // A picture or video may bleed (the compiler crops it); a native shape or text never crosses the edge.
      if (['image', 'video', 'gif'].includes(m.kind)) warn(slide.n, `${m.kind} crosses the slide's edge ${where}: the compiler crops it`);
      else err(slide.n, `${m.kind} ${m.cls} crosses the slide's edge ${where}`);
    }
    if ((m.kind === 'text' || m.kind === 'title') && m.hasExplicitWidth && m.sw > m.cw + 1) err(slide.n, `text overflows its box: «${m.text.slice(0, 40)}» (${m.sw} > ${m.cw})`);
  }
  perSlideNames.push(slideNames);
  if (R.marked.filter((m) => m.anim).length < 2) err(slide.n, 'fewer than 2 animation steps');
  // About 35 words outside the reading layer (text over 32 px), the header band and the title not counted.
  const loud = R.marked.filter((m) => m.kind === 'text' && m.size > 32 && !/^!!(left|word)$/.test(m.name || '')).reduce((n, m) => n + m.words, 0);
  if (loud > 40 && !WORDY_OK.has(slide.n)) warn(slide.n, `${loud} words outside the reading layer (about 35 at most)`);

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
    if (state !== 'seed') {
      if (!sq.cls.split(/\s+/).includes(state)) err(slide.n, `${name} should be «${state}», is «${sq.cls}»`);
      if (Math.round(sq.box.x) !== STRIP.x + STRIP.step * (i - 1) || Math.round(sq.box.y) !== STRIP.y || Math.round(sq.box.w) !== STRIP.size) err(slide.n, `${name} not at its place in the strip`);
    } else {
      const dot = slideNames.get('!!dot');
      const b = sq.box, d = dot && dot.box;
      if (!d || b.x < d.x || b.y < d.y || b.x + b.w > d.x + d.w || b.y + b.h > d.y + d.h) err(slide.n, `${name} is not a seed inside the wordmark's dot`);
    }
    if (sq.anim && !slide.opening) err(slide.n, `${name} must not be animated (it morphs)`);
  }
  const left = slideNames.get('!!left');
  if (counterText(slide) == null) { if (left) err(slide.n, 'no counter on this slide: the strip is still gathered in the dot'); }
  else if (!left) err(slide.n, 'counter !!left missing');
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
    const set = slide.dark ? DARK_RGB : TOKEN_RGB;
    if (!set.has(rgb)) err(slide.n, `colour ${c.v} (${c.prop}) on ${String(c.cls).slice(0, 40)} is not a ${slide.dark ? 'dark-stage' : 'light'} token`);
  }

  for (const x of R.buried) err(slide.n, `baked layer drawn above a native object would be hidden under it in PowerPoint: ${x}`);

  for (const x of R.ghost) err(slide.n, `a shape with an entrance animation has a baked shadow, which would show before it: ${x}`);

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
  for (const [name, m] of cur) if (prev.has(name) && m.anim) err(SLIDES[k].n, `${name} morphs from slide ${SLIDES[k - 1].n} but has an entrance animation`);
}
const chains = [...names.entries()].map(([n, r]) => `${n.padEnd(8)} ${r.kind.padEnd(6)} ${r.slides.join(' ')}`);

await browser.close();
console.log('Morph names (name, kind, slides):');
console.log(chains.filter((c) => !/^!!s\d\d/.test(c) && !/^!!x\d/.test(c)).map((c) => `  ${c}`).join('\n'));
console.log(`  !!x…    ${chains.filter((c) => /^!!x\d/.test(c)).length} built objects named only so that PowerPoint cannot match them automatically`);
console.log(`  !!s01…!!s10 shape on every slide`);
if (warns.length) { console.log(`\n${warns.length} warning(s):`); console.log(warns.map((w) => `  ${w}`).join('\n')); }
if (errors.length) { console.log(`\n${errors.length} error(s):`); console.log(errors.map((e) => `  ${e}`).join('\n')); process.exit(1); }
console.log('\nlint: no errors');
