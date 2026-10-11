// Writes the header band (the strip of ten sections, the counter, the corner wordmark) into every slide,
// between <!-- header:start --> and <!-- header:end -->, from the table in deck.mjs.
// Usage: node deck/cf11/design/stamp.mjs        (rewrites the slides in place; prints what changed)
import fs from 'node:fs';
import path from 'node:path';
import { SLIDES, SLIDES_DIR, STRIP, MARK, MARK_TEXT_WIDTH, squareState, counterText } from './deck.mjs';

const START = '<!-- header:start · written by design/stamp.mjs from design/deck.mjs; do not edit by hand -->';
const END = '<!-- header:end -->';

const html = (s) => s.replace(/\u00a0/g, '&nbsp;');
/** A seed: one of the ten squares hidden in the wordmark's dot on 01 and 15 (data-gather = the dot's box). Ten 8 px
 *  rounds in a row across the dot's middle, in the colour the square has on the neighbouring slide (02 after the
 *  opening, 14 before the finale) at 1 % alpha: invisible in the still, and in the Morph a square only moves, grows
 *  or shrinks and comes up to colour or fades away. Nothing is mixed, so no muddy in-between colour. */
const SEED = { size: 8, step: 8 };
const SEED_COLOUR = { done: 'background:transparent;border:2px solid rgba(138,143,151,.01)', now: 'background:rgba(244,196,91,.01)', next: 'background:rgba(11,18,28,.01)' };
function seed(slide, i, gx, gy, gs) {
  const neighbour = SLIDES[SLIDES.indexOf(slide) + (slide.opening ? 1 : -1)];
  const state = squareState(neighbour, i);
  const x = gx + gs / 2 - (SEED.step * 9 + SEED.size) / 2 + SEED.step * (i - 1);
  const y = gy + gs / 2 - SEED.size / 2;
  return `left:${x}px;top:${y}px;width:${SEED.size}px;height:${SEED.size}px;border-radius:${SEED.size / 2 - 1}px;${SEED_COLOUR[state]}`;
}

function header(slide, source) {
  const out = [START];
  const gather = /data-gather="(\d+),(\d+),(\d+)"/.exec(source);
  for (let i = 1; i <= 10; i += 1) {
    const name = `!!s${String(i).padStart(2, '0')}`;
    const state = squareState(slide, i);
    if (state === 'seed') {
      if (!gather) throw new Error(`${slide.file}: the seeds need data-gather="x,y,size" (the dot's box) on .slide`);
      const [, x, y, s] = gather.map(Number);
      out.push(`<div class="sq seed" data-pptx="shape" data-name="${name}" style="${seed(slide, i, x, y, s)}"></div>`);
    } else {
      out.push(`<div class="sq ${state}" data-pptx="shape" data-name="${name}" style="left:${STRIP.x + STRIP.step * (i - 1)}px"></div>`);
    }
  }
  if (slide.section == null && !slide.finale) {
    // An own slide: a small yellow dot in the gap after the last passed section.
    const gapX = STRIP.x + STRIP.step * slide.after - (STRIP.step - STRIP.size) / 2 - 4;
    out.push(`<div class="sq-gap" data-pptx="shape" data-name="!!sx" style="left:${gapX}px"></div>`);
  }
  const at = /data-counter-at="(\d+),(\d+)"/.exec(source);
  if (counterText(slide) == null) {
    // no counter yet: it fades in on 02, when the squares have burst out into the strip
  } else if (slide.finale) {
    if (!at) throw new Error(`${slide.file}: the finale needs data-counter-at="x,y" on .slide`);
    out.push(`<div class="left fin" data-pptx="text" data-name="!!left" style="left:${at[1]}px;top:${at[2]}px">${html(counterText(slide))}</div>`);
  } else {
    // The first counter of the deck fades in as the first step, once the squares have burst out into the strip.
    const prev = SLIDES[SLIDES.indexOf(slide) - 1];
    const first = prev && counterText(prev) == null ? ' data-anim="fade" data-anim-dur="600" data-anim-order="0"' : '';
    out.push(`<div class="left" data-pptx="text" data-name="!!left"${first}>${html(counterText(slide))}</div>`);
  }
  if (slide.corner === 'mark') {
    const dotLeft = MARK.right - MARK.dot;
    const textLeft = dotLeft - MARK.gap - MARK_TEXT_WIDTH;
    out.push(`<div class="mark" data-pptx="text" data-name="!!word" style="left:${textLeft}px;width:${MARK_TEXT_WIDTH + 2}px">Meldy</div>`);
    const dotName = slide.dotAway ? `!!x${String(slide.n).padStart(2, '0')}dot` : '!!dot';
    out.push(`<div class="mark-dot" data-pptx="shape" data-name="${dotName}" style="left:${dotLeft}px;top:${MARK.dotTop}px"></div>`);
  } else if (slide.corner === 'runner') {
    out.push('<div class="runner" data-pptx="text" style="left:1392px;width:400px">CodingFest-11</div>');
  }
  out.push(END);
  return out.join('\n');
}

let changed = 0;
for (const slide of SLIDES) {
  const file = path.join(SLIDES_DIR, slide.file);
  if (!fs.existsSync(file)) { console.log(`skip  ${slide.file} (not written yet)`); continue; }
  const text = fs.readFileSync(file, 'utf8');
  const a = text.indexOf('<!-- header:start');
  const b = text.indexOf(END);
  if (a < 0 || b < 0) throw new Error(`${slide.file}: no header markers`);
  const next = text.slice(0, a) + header(slide, text) + text.slice(b + END.length);
  if (next !== text) { fs.writeFileSync(file, next); changed += 1; console.log(`stamp ${slide.file}`); }
  else console.log(`ok    ${slide.file}`);
}
console.log(`${changed} slide(s) rewritten`);
