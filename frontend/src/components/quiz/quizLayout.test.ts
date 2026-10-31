import { describe, expect, it } from 'vitest';
import { SURFACES } from '../../lib/studio/contrast';

/**
 * The quiz author's pages (release 47.1, the live check of release 47): on a phone the sticky bar («Отмена» and
 * «Создать», «Сохранить», «Новая контрольная») stood under the fixed tab bar; on a laptop of 734 px «Ещё настройки»
 * stood behind the bar; a quiz of one attempt drew an empty «Попытки» column.
 *
 * The styles and the pages are read from disk: Vitest turns every CSS import into an empty module, `?raw` included.
 */
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string): string[];
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
// src/, as a path from this file's own (jsdom's URL is not the one Node's fs takes).
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const SRC = HERE.slice(0, HERE.lastIndexOf('/src/') + '/src/'.length);
const read = async (path: string) => (await nodeFs()).readFileSync(`${SRC}${path}`, 'utf8');

interface Rule {
  /** The @media the rule stands in (one level), or null. */
  media: string | null;
  selector: string;
  body: string;
}

/** The rules of a stylesheet with the @media each stands in; comments left out, spaces made single. */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let media: string | null = null;
  let selector: string | null = null;
  for (const match of text.matchAll(/([^{}]*)([{}])/g)) {
    const before = match[1].trim().replace(/\s+/g, ' ');
    if (match[2] === '{') {
      if (before.startsWith('@')) media = before;
      else selector = before;
    } else if (selector !== null) {
      out.push({ media, selector, body: before });
      selector = null;
    } else {
      media = null;
    }
  }
  return out;
}

function declaration(body: string, property: string): string | null {
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return match ? match[1].trim().replace(/\s+/g, ' ') : null;
}

const find = (list: Rule[], selector: string, media: string | null = null) => list.find((rule) => rule.selector === selector && rule.media === media);
const PHONES = '@media (max-width: 1023px)';

describe('the quiz pages’ bar and the tab bar (release 47.1)', () => {
  it('every quiz page with the sticky bar is a qa-page, so the rule below reaches it', async () => {
    const fs = await nodeFs();
    const withBar: string[] = [];
    for (const dir of ['pages/quiz/', 'components/quiz/']) {
      for (const name of fs.readdirSync(`${SRC}${dir}`)) {
        if (!name.endsWith('.tsx') || name.includes('.test.')) continue;
        const source = fs.readFileSync(`${SRC}${dir}${name}`, 'utf8');
        if (!/className="ex-cta\b/.test(source)) continue;
        withBar.push(`${dir}${name}`);
        // The bar is the page root's own child: `.sf-page.qa-page > .ex-cta`.
        expect(source, name).toMatch(/className="sf-page qa-page"/);
      }
    }
    // «Новая контрольная» on the list, «Создать» / «Сохранить» on the settings.
    expect(withBar.sort()).toEqual(['pages/quiz/QuizListPage.tsx', 'pages/quiz/QuizSetupPage.tsx']);
  });

  it('with the tab bar the bar stands on it: its height and the safe area, as the tab bar is drawn', async () => {
    const quiz = rules(await read('components/quiz/quizAuthor.css'));
    const lifted = find(quiz, '.sf-shell[data-tabs] .sf-page.qa-page > .ex-cta', PHONES);
    expect(lifted).toBeDefined();
    expect(declaration(lifted!.body, 'bottom')).toBe('calc(var(--sf-tabs-h, 62px) + var(--tg-bottom, var(--sf-safe-b)))');
    // The tab bar holds the safe area; the bar does not add it twice.
    expect(declaration(lifted!.body, 'padding-bottom')).toBe('12px');
    // The tab bar: that height, at the bottom of the window, over the page's bars.
    const layout = rules(await read('components/layout.css'));
    expect(declaration(find(layout, '.sf-shell', PHONES)!.body, '--sf-tabs-h')).toBe('62px');
    expect(declaration(find(layout, '.sf-shell .sf-tabbar', PHONES)!.body, 'height')).toBe('calc(var(--sf-tabs-h) + var(--sf-safe-b))');
    const telegram = rules(await read('styles/telegram.css'));
    expect(declaration(find(telegram, 'html.tg-mode .sf-shell .sf-tabbar', PHONES)!.body, 'height')).toBe('calc(var(--sf-tabs-h) + var(--tg-bottom))');
  });

  it('a phone with little on the page: the bar at the bottom of what the tab bar leaves', async () => {
    const quiz = rules(await read('components/quiz/quizAuthor.css'));
    const tall = find(quiz, ".sf-shell[data-tabs] .sf-page.qa-page[data-frame='s']:has(> .ex-cta)");
    expect(declaration(tall!.body, 'min-height')).toBe(
      'calc(100dvh - var(--sf-bar-h, 52px) - var(--sf-tabs-h, 62px) - var(--tg-bottom, var(--sf-safe-b)))',
    );
  });
});

describe('«Ещё настройки» on a computer and the one-attempt table (release 47.1)', () => {
  it('?all=1 from 1024 px: «Ещё настройки» on top of the right column, «Оформление» under it', async () => {
    const quiz = rules(await read('components/quiz/quizAuthor.css'));
    const at = (part: string) => find(quiz, `.sf-page.qa-page .qa-parts[data-side][data-compact] > ${part}`)!.body;
    expect(declaration(at('.qa-part-m'), 'grid-column')).toBe('1');
    expect(declaration(at('.qa-part-m'), 'grid-row')).toBe('1 / span 2');
    expect(declaration(at('.qa-more'), 'grid-column')).toBe('2');
    expect(declaration(at('.qa-more'), 'grid-row')).toBe('1');
    expect(declaration(at('.qa-part-l'), 'grid-column')).toBe('2');
    expect(declaration(at('.qa-part-l'), 'grid-row')).toBe('2');
  });

  it('the table without «Попытки» has as many tracks as cells: four and the arrow', async () => {
    const quiz = rules(await read('components/quiz/quizAuthor.css'));
    const tracks = (selector: string) => (declaration(find(quiz, selector)!.body, 'grid-template-columns') ?? '').match(/minmax\([^)]*\)|\d+px/g) ?? [];
    expect(tracks('.sf-page.qa-page .qa-people[data-wide] .qa-person')).toHaveLength(6);
    expect(tracks('.sf-page.qa-page .qa-people[data-wide][data-one] .qa-person')).toHaveLength(5);
  });
});

describe('the participant’s top line (live check of release 47.2: text scrolled under it showed through)', () => {
  const OPAQUE = /^#[0-9a-f]{6}$/i;

  it('the room line is see-through by itself, so the run’s line sets its own opaque colour, in both themes', async () => {
    const paper = rules(await read('styles/paper.css'));
    expect(declaration(find(paper, '.sf-bar, .sf-room-bar')!.body, 'background')).toMatch(/transparent/);
    const run = rules(await read('components/quiz/quizTake.css'));
    const line = find(run, '.qt-roombar.sf-room-bar');
    expect(line).toBeDefined();
    expect(declaration(line!.body, 'background')).toBe('var(--sf-canvas)');
    expect(declaration(line!.body, 'backdrop-filter')).toBe('none');
    // Meldy's canvas is a solid colour in the light theme and in the dark one, and nothing on the way redefines it.
    // (The @tailwind lines are statements, not rules: left out for the reader above.)
    const index = rules((await read('index.css')).replace(/^@tailwind[^;]*;/gm, ''));
    expect(declaration(find(index, ':root')!.body, '--sf-canvas')).toMatch(OPAQUE);
    expect(declaration(find(index, '.dark')!.body, '--sf-canvas')).toMatch(OPAQUE);
    for (const sheet of ['styles/paper.css', 'components/containers/room.css', 'components/quiz/quizTake.css']) {
      expect(rules(await read(sheet)).filter((rule) => declaration(rule.body, '--sf-canvas') !== null), sheet).toEqual([]);
    }
  });

  it('a run «как в студии»: the page theme’s surface, solid in both themes', async () => {
    const run = rules(await read('components/quiz/quizTake.css'));
    const line = find(run, '[data-design] .qt-roombar.sf-room-bar');
    expect(line).toBeDefined();
    expect(declaration(line!.body, 'background')).toBe('var(--doc-surface)');
    expect(SURFACES.light.surface).toMatch(OPAQUE);
    expect(SURFACES.dark.surface).toMatch(OPAQUE);
  });
});

describe('the bar on a computer (owner, 21.10: «почему блок снизу всегда прикреплен?»)', () => {
  it('is a card at the bottom right that keeps the action in reach, not a band across the page over the form', async () => {
    const bar = find(rules(await read('components/exams/exams.css')), '.sf-page .ex-cta[data-row]');
    expect(bar).toBeDefined();
    // Still in reach on a long form (audit 2026-10-08), resting under the form at its end.
    expect(declaration(bar!.body, 'width')).toBe('fit-content');
    expect(declaration(bar!.body, 'margin')).toBe('28px 0 -72px auto');
    expect(declaration(bar!.body, 'bottom')).toBe('24px');
    // A card of its own: solid surface, rounded, no see-through band edge to edge.
    expect(declaration(bar!.body, 'background')).toBe('var(--sf-surface)');
    expect(declaration(bar!.body, 'border-radius')).toBe('32px');
    expect(declaration(bar!.body, 'backdrop-filter')).toBe('none');
  });
});
