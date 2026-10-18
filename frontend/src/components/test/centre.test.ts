import { describe, expect, it } from 'vitest';

/**
 * «Конструктор» in the middle of the page (release 47.3; owner, 18.10: the content stood on the left with the right half
 * empty — Meldy's rule is centred blocks). The header, the cards and the bar at the bottom are one column of 880 px with
 * auto margins; the page keeps its width, so useFrame still measures the window's frame (the bar stays a row beside the
 * content on a computer). The studio, which shares .tb-page and .tb-body, is left as it is (.tb-build only).
 *
 * The styles are read from disk: Vitest turns every CSS import into an empty module, `?raw` included.
 */
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
const NODE_FS: string = 'node:fs';
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const SRC = HERE.slice(0, HERE.lastIndexOf('/src/') + '/src/'.length);

/** The rules of a stylesheet (comments left out) whose selector list names `selector`. */
function rulesFor(css: string, selector: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((rule) => rule[1].split(',').map((part) => part.trim().replace(/\s+/g, ' ')).includes(selector))
    .map((rule) => rule[2]);
}
const declaration = (body: string, property: string) => body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))?.[1].trim() ?? null;

describe('«Конструктор» stands in the middle of the page (release 47.3)', () => {
  it('the header, the cards and the bar share one column of 880 px with auto margins', async () => {
    const css = (await nodeFs()).readFileSync(`${SRC}components/test/build.css`, 'utf8');
    for (const selector of ['.sf-page.tb-page.tb-build > .tb-head', '.sf-page.tb-page.tb-build > .tb-body', '.sf-page.tb-page.tb-build > .ex-cta[data-row]']) {
      const [body] = rulesFor(css, selector);
      expect(body, selector).toBeTruthy();
      expect(declaration(body, 'max-width'), selector).toBe('880px');
      expect(declaration(body, 'margin-left'), selector).toBe('auto');
      expect(declaration(body, 'margin-right'), selector).toBe('auto');
    }
    // «Контрольные · Настройки» end at the column's right edge: the row's last part pushes itself there.
    expect(declaration(rulesFor(css, '.sf-page.tb-page .tb-head-links')[0], 'margin')).toBe('0 0 0 auto');
  });

  it('«Новый тест» is one column of 640 px in the middle too', async () => {
    const css = (await nodeFs()).readFileSync(`${SRC}components/test/build.css`, 'utf8');
    for (const selector of ['.sf-page.tb-page.tb-new-page > .tb-head', '.sf-page.tb-page.tb-new-page > .tb-new-form']) {
      const [body] = rulesFor(css, selector);
      expect(declaration(body, 'max-width'), selector).toBe('640px');
      expect(declaration(body, 'margin-left'), selector).toBe('auto');
    }
  });
});
