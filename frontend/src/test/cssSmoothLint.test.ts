import { describe, expect, it } from 'vitest';

/**
 * The smoothness lint of the app's CSS (scripts/css-smooth-lint.mjs) as part of the tests, so the gate runs it: no
 * endless animation of a property the compositor cannot animate, no :has() around a press, a hover or a focus, no new
 * transition of box-shadow, a size or a position (the baseline lists the ones there were on 20.10).
 */
interface Problem {
  kind: string;
  file: string;
  line: number;
  selector: string;
}
// A specifier TypeScript does not resolve (a script outside src/); the test runs in Node.
const LINT: string = '../../scripts/css-smooth-lint.mjs';

describe('CSS smoothness lint', () => {
  it('finds nothing new', async () => {
    const { check } = (await import(/* @vite-ignore */ LINT)) as { check: () => { problems: Problem[] } };
    const { problems } = check();
    expect(problems.map((p) => `${p.kind}: ${p.file}:${p.line} ${p.selector}`)).toEqual([]);
  });
});
