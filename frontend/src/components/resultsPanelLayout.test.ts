import { describe, expect, it } from 'vitest';

/**
 * The result screen's layout rules that the QA of release 44 found broken (2026-10-11, live, 390×844 and 1532×734).
 * The page itself is checked by screenshots; these tests keep the rules from going away.
 *
 * The styles are read from disk: Vitest turns every CSS import into an empty module, `?raw` included.
 */
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const SRC = HERE.slice(0, HERE.lastIndexOf('/src/') + '/src/'.length);

/** The rules of a stylesheet with the media query each one sits in ('' outside any), comments left out. */
function rules(css: string): Array<{ media: string; selector: string; body: string }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<{ media: string; selector: string; body: string }> = [];
  let depth = 0;
  let media = '';
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      const head = text.slice(start, i).trim().replace(/\s+/g, ' ');
      if (head.startsWith('@media')) {
        media = head;
        depth += 1;
        start = i + 1;
        continue;
      }
      const end = text.indexOf('}', i);
      out.push({ media: depth > 0 ? media : '', selector: head, body: text.slice(i + 1, end) });
      i = end;
      start = i + 1;
    } else if (text[i] === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) media = '';
      start = i + 1;
    }
  }
  return out;
}

async function resultsCss() {
  return rules((await nodeFs()).readFileSync(`${SRC}components/ResultsPanel.css`, 'utf8'));
}

describe('the result screen on a phone: every section in sight (QA 2026-10-11: «Подкаст» only by a sideways scroll)', () => {
  it('lets the pills of the section row go to a second line below 640 px instead of scrolling', async () => {
    const phone = (await resultsCss()).filter(rule => rule.media === '@media (max-width: 639px)');
    const row = phone.find(rule => rule.selector === '.rp-tabsrow .sf-sectabs');
    expect(row?.body).toMatch(/flex-wrap:\s*wrap/);
    expect(row?.body).toMatch(/overflow:\s*visible/);
  });
});

describe('«Выжимка» on the result screen as wide as the other tabs (QA 2026-10-11: 56 px narrower at 1532×734)', () => {
  it('lifts the sheet’s own 920 px inside the result panel only', async () => {
    const css = await resultsCss();
    expect(css.find(rule => rule.media === '' && rule.selector === '.rp-body .xp-sheet')?.body).toMatch(/max-width:\s*none/);
    const sheet = rules((await nodeFs()).readFileSync(`${SRC}components/CheatsheetSheet.css`, 'utf8'));
    // The lecture page, where the выжимка stands alone, keeps its measure.
    expect(sheet.find(rule => rule.media === '' && rule.selector === '.xp-sheet')?.body).toMatch(/max-width:\s*920px/);
  });
});
