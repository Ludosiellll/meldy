// The deck's table of slides and the rules of its header band, shared by stamp.mjs (writes the header into
// every slide), preview/shoot.mjs and preview/lint.mjs (check it). One place to change the order.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESIGN = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(DESIGN); // deck/cf11
export const SLIDES_DIR = path.join(ROOT, 'slides');

/** The ten mandatory sections of Приложение 2, verbatim and in order. */
export const SECTIONS = [
  'Титульный',
  'Автор проекта',
  'Актуальность',
  'Цель, задачи',
  'Новизна и инновационность',
  'Содержание',
  'Представление блоков проекта',
  'Используемые источники',
  'Технические требования',
  'Заключение',
];

/**
 * The 15 slides. `section` is the mandatory section (1–10) the slide belongs to; an own slide has none and
 * sits between `after` and the next one. `corner`: what the top right shows — the wordmark with its dot
 * (the dot is at home), the contest's name (the title), or nothing (the dot is out: 06–11; 15 has the big one).
 * `dark`: a stage slide in the app's dark theme (05, 12). `opening`: the strip is not out yet — its ten squares are
 * seeds hidden in the wordmark's dot and unroll out of it into the strip on 02 (no counter on 01); on the `finale`
 * they fly back into the dot. `dotAway`: the chain's dot (!!dot) is not in the corner (12: the chat of 11 fades out
 * while its «Пригласить группу» button travels into the path), so the corner wordmark's dot gets a name that pairs
 * with nothing.
 */
export const SLIDES = [
  // Deck v2 (19.10.2026, direction A «Сцена»): every slide dark, no strip (see CONTRACT.md, The deck-wide parts).
  { n: 1, file: '01-title.html', title: 'Титульный', section: 1, corner: 'runner', dark: true },
  { n: 2, file: '02-author.html', title: 'Автор проекта', section: 2, corner: 'mark', dark: true },
  { n: 3, file: '03-relevance.html', title: 'Актуальность', section: 3, corner: 'mark', dark: true },
  { n: 4, file: '04-goal.html', title: 'Цель, задачи', section: 4, corner: 'mark', dark: true },
  { n: 5, file: '05-novelty.html', title: 'Новизна и инновационность', section: 5, corner: 'mark', dark: true },
  { n: 6, file: '06-contents.html', title: 'Содержание', section: 6, corner: 'none', dark: true },
  { n: 7, file: '07-lectures.html', title: 'Представление блоков проекта', section: 7, corner: 'none', dark: true },
  { n: 8, file: '08-lecture-talk.html', title: 'Представление блоков проекта', section: 7, corner: 'none', dark: true },
  { n: 9, file: '09-exam-plan.html', title: 'Представление блоков проекта', section: 7, corner: 'none', dark: true },
  { n: 10, file: '10-oral-sheet.html', title: 'Представление блоков проекта', section: 7, corner: 'none', dark: true },
  { n: 11, file: '11-studio.html', title: 'Представление блоков проекта', section: 7, corner: 'none', dark: true },
  { n: 12, file: '12-jury-test.html', title: 'Представление блоков проекта', section: 7, corner: 'none', dark: true },
  { n: 13, file: '13-sources.html', title: 'Используемые источники', section: 8, corner: 'mark', dark: true },
  { n: 14, file: '14-tech.html', title: 'Технические требования', section: 9, corner: 'mark', dark: true },
  { n: 15, file: '15-conclusion.html', title: 'Заключение', section: 10, corner: 'none', finale: true, dark: true },
];

/** Geometry of the header band (CONTRACT.md): squares at x 128 + 34·i, y 56, 22 px. */
export const STRIP = { x: 128, y: 56, size: 22, step: 34 };
/** The corner wordmark: «Meldy» 32 px, its 10 px dot ends at the right margin, both on the counter's baseline. */
export const MARK = { right: 1792, dot: 10, gap: 3, textTop: 46, dotTop: 66 };
export const MARK_TEXT_WIDTH = 87; // «Meldy» in Onest 600 32 px −0.045em, measured (preview/lint checks it)

/** How many mandatory sections are passed when this slide is on screen. */
export function passed(slide) {
  if (slide.finale) return 10;
  if (slide.section == null) return slide.after;
  return slide.section - 1;
}

/** The state of square i (1–10) on this slide: 'now' (yellow), 'done' (an outline), 'next' (ink), or 'seed'
 *  (hidden in the wordmark's dot on the opening and the finale; stamp.mjs draws it). */
export function squareState(slide, i) {
  if (slide.finale || slide.opening) return 'seed';
  if (slide.section === i) return 'now';
  return i <= passed(slide) ? 'done' : 'next';
}

/** The line under the wordmark on the finale (null elsewhere: the strip carries no counter, the squares say it). */
export function counterText(slide) {
  return slide.finale ? 'Шпаргалка этой защиты пуста' : null;
}

/** Load Playwright from a local install or from the global node_modules next to this Node. */
export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules');
    const require = createRequire(path.join(globalRoot, 'noop.js'));
    return require('playwright');
  }
}
