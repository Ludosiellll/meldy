// Writes the header band (the strip of ten sections, the counter, the corner wordmark) into every slide,
// between <!-- header:start --> and <!-- header:end -->, from the table in deck.mjs.
// Usage: node deck/cf11/design/stamp.mjs        (rewrites the slides in place; prints what changed)
import fs from 'node:fs';
import path from 'node:path';
import { SLIDES, SLIDES_DIR, STRIP, MARK, MARK_TEXT_WIDTH, squareState, counterText } from './deck.mjs';

const START = '<!-- header:start · written by design/stamp.mjs from design/deck.mjs; do not edit by hand -->';
const END = '<!-- header:end -->';

const html = (s) => s.replace(/\u00a0/g, '&nbsp;');

function header(slide, source) {
  const out = [START];
  const gather = /data-gather="(\d+),(\d+),(\d+)"/.exec(source);
  for (let i = 1; i <= 10; i += 1) {
    const name = `!!s${String(i).padStart(2, '0')}`;
    const state = squareState(slide, i);
    if (state === 'gather') {
      if (!gather) throw new Error(`${slide.file}: the finale needs data-gather="x,y,size" on .slide`);
      const [, x, y, s] = gather.map(Number);
      out.push(`<div class="sq now" data-pptx="shape" data-name="${name}" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;border-radius:${s / 2}px"></div>`);
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
  if (slide.finale) {
    if (!at) throw new Error(`${slide.file}: the finale needs data-counter-at="x,y" on .slide`);
    out.push(`<div class="left fin" data-pptx="text" data-name="!!left" style="left:${at[1]}px;top:${at[2]}px">${html(counterText(slide))}</div>`);
  } else {
    out.push(`<div class="left" data-pptx="text" data-name="!!left">${html(counterText(slide))}</div>`);
  }
  if (slide.corner === 'mark') {
    const dotLeft = MARK.right - MARK.dot;
    const textLeft = dotLeft - MARK.gap - MARK_TEXT_WIDTH;
    out.push(`<div class="mark" data-pptx="text" data-name="!!word" style="left:${textLeft}px;width:${MARK_TEXT_WIDTH + 2}px">Meldy</div>`);
    out.push(`<div class="mark-dot" data-pptx="shape" data-name="!!dot" style="left:${dotLeft}px;top:${MARK.dotTop}px"></div>`);
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
