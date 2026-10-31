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

describe('the lecture page on a phone: one row of tabs that says it goes on (phone audit 47.3; recheck of 44.1: «Подкаст» cut off)', () => {
  it('scrolls the row sideways on one hairline, and fades the hidden end with an arrow', async () => {
    const css = rules((await nodeFs()).readFileSync(`${SRC}pages/MaterialDetail.css`, 'utf8'));
    const row = css.find(rule => rule.media === '' && rule.selector === '.md-ptabs');
    // One row (wrapped, the second row held «Подкаст» alone), scrolled sideways without a scrollbar.
    expect(row?.body).toMatch(/flex-wrap:\s*nowrap/);
    expect(row?.body).toMatch(/overflow-x:\s*auto/);
    expect(row?.body).toMatch(/scrollbar-width:\s*none/);
    expect(css.find(rule => rule.media === '' && rule.selector === '.md-ptabs-wrap')?.body).toMatch(/box-shadow:\s*inset 0 -1px 0 var\(--sf-line\)/);
    expect(css.find(rule => rule.selector === ".md-ptabs [role='tab']")?.body).toMatch(/height:\s*46px/);
    // QA 2026-10-11 found «Подкаст» cut with no sign of more: the hidden end fades into the page, an arrow on it, and
    // only while there is more (MaterialDetail useStripEdges sets data-more-start / data-more-end).
    const after = css.find(rule => rule.media === '' && rule.selector === '.md-ptabs-wrap::after')?.body;
    expect(after).toMatch(/linear-gradient\(to left, var\(--sf-canvas\)/);
    expect(after).toMatch(/data:image\/svg\+xml/);
    expect(css.find(rule => rule.selector.includes('[data-more-end]::after'))?.body).toMatch(/opacity:\s*1/);
  });
});

describe('the podcast player on a phone sticks above the bottom bar, not under it (recheck of 44.1, 390×844)', () => {
  it('keeps the bar’s own height under the player: 62 px, the last row of the player was under the bar at 56', async () => {
    const player = rules((await nodeFs()).readFileSync(`${SRC}components/conversation/conversation.css`, 'utf8'))
      .find(rule => rule.media === '@media (max-width: 639px)' && rule.selector === '.sf-shell[data-tabs] .cv-player');
    expect(player?.body).toMatch(/bottom:\s*calc\(var\(--sf-tabs-h, 62px\) \+ var\(--sf-safe-b\)\)/);
    const layout = rules((await nodeFs()).readFileSync(`${SRC}components/layout.css`, 'utf8'));
    expect(layout.find(rule => rule.media === '@media (max-width: 1023px)' && rule.selector === '.sf-shell')?.body)
      .toMatch(/--sf-tabs-h:\s*62px/);
  });
});

describe('the podcast’s line on a phone holds the room of the tallest line (live check of 44.5: the sheet moved 36 px at 390×844)', () => {
  it('measures the lines in a copy of the line inside the subtitle, out of the flow and out of sight', async () => {
    const phone = rules((await nodeFs()).readFileSync(`${SRC}components/conversation/conversation.css`, 'utf8'))
      .filter(rule => rule.media === '@media (max-width: 639px)');
    expect(phone.find(rule => rule.selector === '.cv-sub')?.body).toMatch(/position:\s*relative/);
    const probe = phone.find(rule => rule.selector === '.cv-line[data-probe]')?.body;
    expect(probe).toMatch(/position:\s*absolute/);
    // As wide as the line it stands for.
    expect(probe).toMatch(/left:\s*0;\s*right:\s*0/);
    expect(probe).toMatch(/visibility:\s*hidden/);
    // The least room: the four rows a phone gives a line.
    expect(phone.find(rule => rule.selector === '.cv-line')?.body).toMatch(/min-height:\s*108px/);
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
