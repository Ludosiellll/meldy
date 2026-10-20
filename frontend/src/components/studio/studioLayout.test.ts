import { describe, expect, it } from 'vitest';

/**
 * Layout rules of the studio on a phone that the live check of 47.8 found short (2026-10-20, 390 × 844 and 844 × 390).
 * The pages themselves are checked by screenshots; these tests keep the rules from going away.
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
const DIR = HERE.slice(0, HERE.lastIndexOf('/') + 1);

interface Rule {
  /** The at-rules it sits in, outermost first ('@media (max-height: 500px)'…). */
  within: string[];
  selector: string;
  body: string;
}

/** The style rules of a stylesheet with the at-rules around each, comments left out. */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      const head = text.slice(start, i).trim().replace(/\s+/g, ' ');
      if (head.startsWith('@')) {
        stack.push(head);
        start = i + 1;
        continue;
      }
      const end = text.indexOf('}', i);
      out.push({ within: [...stack], selector: head, body: text.slice(i + 1, end) });
      i = end;
      start = i + 1;
    } else if (text[i] === '}') {
      stack.pop();
      start = i + 1;
    }
  }
  return out;
}

const studioCss = async () => rules((await nodeFs()).readFileSync(`${DIR}studio.css`, 'utf8'));
const px = (body: string, property: string): number | null => {
  const match = new RegExp(`(?:^|[;\\s])${property}:\\s*(-?\\d+)px`).exec(body);
  return match ? Number(match[1]) : null;
};

describe('the block’s bar on a touch screen (live check of 47.8: «Блок», «Копия», «Удалить» were 44 × 36)', () => {
  it('its buttons are 44 px high themselves, and do not make the bar taller (they reach past its edge)', async () => {
    const touch = (await studioCss()).filter((rule) => rule.within.includes('@media (hover: none), (pointer: coarse)'));
    const act = touch.find((rule) => rule.selector === '.st-act');
    expect(px(act?.body ?? '', 'height')).toBe(44);
    // The bar is drawn for 36 px buttons (3 px of padding around them): the 8 px more go into negative margins.
    expect(act?.body).toMatch(/margin-block:\s*-4px/);
    expect(px(touch.find((rule) => rule.selector === '.st-act-icon')?.body ?? '', 'width')).toBe(44);
  });
});

describe('the studio in a phone held sideways (live check of 47.8: about 70 px of the page between the bars)', () => {
  it('in a window at most 500 px high the app’s bar goes up with the page and the bars are slimmer: over 200 px of page', async () => {
    const all = await studioCss();
    const short = all.filter((rule) => rule.within.includes('@media (max-height: 500px)'));
    const appBar = short.find((rule) => rule.selector.endsWith('> .sf-bar'));
    expect(appBar?.selector).toContain(':has(.st-page');
    expect(appBar?.body).toMatch(/position:\s*relative/);

    const page = short.find((rule) => rule.selector === ".st-page:is([data-frame='s'], [data-frame='m'])");
    expect(page?.body).toMatch(/--sf-bar-h:\s*0px/);
    const bottomBar = Number(/--st-bottom-bar:\s*calc\((\d+)px/.exec(page?.body ?? '')?.[1]);
    const studioBar = short.find((rule) => rule.selector.endsWith(' .st-bar'));
    expect(studioBar?.body).toMatch(/min-height:\s*0/);
    const barPadding = px(studioBar?.body ?? '', 'padding-block') ?? 99;
    const controls = short.find((rule) => rule.selector.endsWith('.st-phonebar :is(.st-tool, .st-send)'));
    expect(px(controls?.body ?? '', 'height')).toBe(44);
    const margin = px(short.find((rule) => rule.selector.endsWith(' .st-canvas'))?.body ?? '', 'padding') ?? 99;

    // At the top of an 844 × 390 window: the app's bar (60), the studio's bar (its 44 px controls, padding, a line),
    // the page's margin and the bottom bar — what is left is the page's.
    const left = 390 - 60 - (44 + 2 * barPadding + 1) - margin - bottomBar;
    expect(left).toBeGreaterThanOrEqual(200);
  });
});
