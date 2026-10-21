import { describe, expect, it } from 'vitest';

/**
 * A question's heading (QuestionCard, OralRun) and a session's last heading (SessionEnd, MockRun) take the focus when
 * they open, so a screen reader reads them first. They are not controls (tabIndex −1: Tab never reaches them), so they
 * draw no ring. After a reload the browser counts that programmatic focus as «visible» until the first tap, and the
 * paper's page-wide ring (styles/paper.css, «.dark .sf-page :focus-visible») outweighed room.css's «.ct-stem:focus»:
 * the question stood in a blue frame (live, phone, 2026-10-20). The options and buttons keep their ring.
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
const read = async (path: string) => (await nodeFs()).readFileSync(`${SRC}${path}`, 'utf8');

/** Each top-level rule as its selectors (one per comma) and its body; comments left out, spaces made single. */
function rules(css: string): Array<{ selectors: string[]; body: string }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(',').map((part) => part.trim().replace(/\s+/g, ' ')),
    body: match[2].replace(/\s+/g, ' ').trim(),
  }));
}

const ringless = (list: ReturnType<typeof rules>, selector: string) =>
  list.some((rule) => rule.selectors.includes(selector) && /(^|;)\s*outline:\s*none/.test(rule.body));

describe('the headings that take the focus in a session', () => {
  it('draw no ring in either theme, over the paper’s page-wide ring', async () => {
    const paper = rules(await read('styles/paper.css'));
    expect(paper.some((rule) => rule.selectors.includes('.dark .sf-page :focus-visible'))).toBe(true);
    const room = rules(await read('components/containers/room.css'));
    for (const heading of ['.ct-stem', '.ct-end-h']) {
      expect(ringless(room, `.sf-page ${heading}:focus-visible`), heading).toBe(true);
      expect(ringless(room, `.dark .sf-page ${heading}:focus-visible`), heading).toBe(true);
    }
  });
});
