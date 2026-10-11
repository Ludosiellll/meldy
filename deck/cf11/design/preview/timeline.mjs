// The build of every slide as PowerPoint schedules it (the compiler's rules, tools/deckpptx/timing.py): effects in
// (data-anim-order, DOM) order; a click opens a click group; «after» opens a sub-group that starts when the previous
// one ends (its longest delay + duration); «with» joins the sub-group; a slide's first group starts by itself unless
// its first effect waits for a click.
//
//   node deck/cf11/design/preview/timeline.mjs [NN ...]
//
// Prints, per slide: the transition, then each effect with its start and end in ms from the end of the transition
// (click groups restart the clock), and the length of the automatic build. Warns when the automatic build runs
// past 3.5 s.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SLIDES, SLIDES_DIR, loadPlaywright } from '../deck.mjs';

const want = new Set(process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const warns = [];
for (const slide of SLIDES) {
  if (want.size && !want.has(slide.n)) continue;
  await page.goto(pathToFileURL(path.join(SLIDES_DIR, slide.file)).href);
  const R = await page.evaluate(() => {
    const root = document.querySelector('.slide');
    const marked = [...document.querySelectorAll('[data-pptx]')].filter((el) => el.dataset.pptx !== 'notes');
    const effects = marked.map((el, i) => ({ el, i })).filter((x) => x.el.dataset.anim).map(({ el, i }) => ({
      i,
      order: el.dataset.animOrder != null ? Number(el.dataset.animOrder) : i,
      trig: el.dataset.animTrigger || 'after',
      anim: el.dataset.anim,
      dir: el.dataset.animDir || '',
      delay: Number(el.dataset.animDelay || 0),
      dur: Number(el.dataset.animDur || 500),
      what: (el.dataset.name ? el.dataset.name + ' ' : '') + (el.dataset.pptx === 'text' || el.dataset.pptx === 'title' ? `«${el.innerText.replace(/\s+/g, ' ').slice(0, 28)}»` : el.dataset.pptx),
    }));
    effects.sort((a, b) => a.order - b.order || a.i - b.i);
    return { effects, transition: root.dataset.transition || 'morph', tdur: root.dataset.transitionDur || null, morph: root.dataset.morph || 'object',
      video: Boolean(document.querySelector('[data-pptx="video"]')) };
  });
  // schedule
  const groups = [];
  for (const e of R.effects) {
    if (e.trig === 'click' || !groups.length) groups.push({ click: e.trig === 'click', subs: [[e]] });
    else if (e.trig === 'with') groups[groups.length - 1].subs[groups[groups.length - 1].subs.length - 1].push(e);
    else groups[groups.length - 1].subs.push([e]);
  }
  const nn = String(slide.n).padStart(2, '0');
  const tdur = R.tdur || (R.transition === 'morph' ? 1500 : R.transition === 'fade' ? 700 : 0);
  console.log(`\n${nn} ${slide.title} — ${R.transition} ${tdur} ms${R.morph !== 'object' ? `, morph by ${R.morph}` : ''}`);
  groups.forEach((g, gi) => {
    let start = 0;
    console.log(`  ${g.click ? '⏵ click' : gi === 0 ? '▶ after the transition' : '▶ (auto)'}`);
    for (const sg of g.subs) {
      let longest = 0;
      for (const e of sg) {
        const a = start + e.delay, b = a + e.dur;
        longest = Math.max(longest, e.delay + e.dur);
        console.log(`    ${String(a).padStart(5)}–${String(b).padEnd(5)} ${(e.anim + (e.dir ? `(${e.dir})` : '')).padEnd(12)} ${e.what}`);
      }
      start += longest;
    }
    console.log(`    = ${start} ms`);
    // a slide with a clip times its steps to the clip's moments (07–09, 12): its build is as long as the story
    if (!g.click && start > 3500 && !R.video) warns.push(`${nn} automatic build ${start} ms`);
  });
}
await browser.close();
if (warns.length) { console.log(`\nlong builds:\n  ${warns.join('\n  ')}`); }
