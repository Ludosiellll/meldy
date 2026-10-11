import { describe, expect, it } from 'vitest';

/**
 * The layout rules of the result screen and the lecture page that the QA of release 44 and its recheck found broken
 * (2026-10-11, live, 390×844, 360×800 and 1532×734). The pages themselves are checked by screenshots; these tests keep
 * the rules from going away.
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

describe('the lecture page on a phone: every tab in sight (recheck of 44.1: «Подкаст» cut off at 390 and 360)', () => {
  it('lets the row of tabs go to a second row instead of scrolling sideways, each row on its own hairline', async () => {
    const css = rules((await nodeFs()).readFileSync(`${SRC}pages/MaterialDetail.css`, 'utf8'));
    const row = css.find(rule => rule.media === '' && rule.selector === '.md-ptabs');
    expect(row?.body).toMatch(/flex-wrap:\s*wrap/);
    expect(row?.body).not.toMatch(/overflow/);
    // The 46 px rows have no gap between them; the background draws a hairline under each.
    expect(row?.body).toMatch(/gap:\s*0 22px/);
    expect(row?.body).toMatch(/repeating-linear-gradient\(to bottom, transparent 0 45px, var\(--sf-line\) 45px 46px\)/);
    expect(css.find(rule => rule.selector === ".md-ptabs [role='tab']")?.body).toMatch(/height:\s*46px/);
    // Nothing is hidden past an edge any more, so no edge fades.
    expect(css.filter(rule => rule.selector.includes('data-more'))).toEqual([]);
  });
});

describe('the podcast player on a phone sticks above the bottom bar, not under it (recheck of 44.1, 390×844)', () => {
  it('keeps the bar’s own height under the player: 62 px, the last row of the player was under the bar at 56', async () => {
    const player = rules((await nodeFs()).readFileSync(`${SRC}components/conversation/conversation.css`, 'utf8'))
      .find(rule => rule.media === '@media (max-width: 639px)' && rule.selector === '.sf-shell[data-tabs] .cv-player');
    expect(player?.body).toMatch(/bottom:\s*calc\(var\(--sf-tabs-h, 62px\) \+ env\(safe-area-inset-bottom\)\)/);
    const layout = rules((await nodeFs()).readFileSync(`${SRC}components/layout.css`, 'utf8'));
    expect(layout.find(rule => rule.media === '@media (max-width: 1023px)' && rule.selector === '.sf-shell')?.body)
      .toMatch(/--sf-tabs-h:\s*62px/);
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
