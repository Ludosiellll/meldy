import { describe, expect, it } from 'vitest';

/**
 * «Экзамены» on a phone (release 47.1, the live check of release 47 at 390 px): the quiet line under «Новый экзамен»
 * broke in two and the one under «Новый тест» did not. Both now have one measure, balanced, as on a computer.
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

/** The declarations of one selector in a stylesheet (comments left out). */
function bodyOf(css: string, selector: string): string {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const match = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((rule) => rule[1].trim().replace(/\s+/g, ' ') === selector);
  return match ? match[2] : '';
}
const declaration = (body: string, property: string) => body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))?.[1].trim() ?? null;

describe('the doors’ quiet lines on «Экзамены» (release 47.1)', () => {
  it('a phone gives both lines one measure, balanced: they break alike', async () => {
    const css = (await nodeFs()).readFileSync(`${SRC}components/test/entry.css`, 'utf8');
    expect(declaration(bodyOf(css, '.sf-page .ex-draw[data-pair] .tb-door-note'), 'text-wrap')).toBe('balance');
    // The door itself is as wide as the screen; the line under it is not.
    expect(declaration(bodyOf(css, ".sf-page[data-frame='s'] .ex-draw[data-pair] .tb-door"), 'max-width')).toBe('none');
    expect(declaration(bodyOf(css, ".sf-page[data-frame='s'] .ex-draw[data-pair] .tb-door-note"), 'max-width')).toBe('260px');
  });
});
