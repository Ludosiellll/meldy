import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import indexHtml from '../../../index.html?raw';
import themeInit from '../../../public/theme-init.js?raw';
import HeroTop from './HeroTop';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));

/** The first screen's stylesheet as text (a CSS import gives no text under the test runner, `?raw` included). */
async function heroCss(): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
  return fs.readFileSync(HERE.slice(0, HERE.lastIndexOf('/')) + '/hero3.css', 'utf8');
}

/** The static first screen in index.html, between its own div and #root. */
function staticHero(): string {
  const match = indexHtml.match(/<div id="static-hero" class="h3">([\s\S]*?)<\/div>\n\s*<div id="root"><\/div>/);
  expect(match, 'index.html has no #static-hero before #root').toBeTruthy();
  return match![1];
}

describe('the static first screen (index.html #static-hero)', () => {
  it('is the React first screen as plain HTML, so the page takes its place without a change', () => {
    const markup = renderToStaticMarkup(<HeroTop reel={<div className="h3-reel-wait" aria-hidden="true" />} />);
    // When this fails, copy `markup` into index.html's #static-hero (the landing's words or markup changed).
    expect(staticHero()).toBe(markup);
  });

  it('carries hero3.css inline, the same rules', async () => {
    const inline = indexHtml.match(/<style id="hero3-css">\n([\s\S]*?)\n\s*<\/style>/)?.[1] ?? '';
    expect(inline.trim()).toBe((await heroCss()).trim());
  });

  it('is hidden off «/» and for a signed-in visitor before any app script (theme-init.js sets sh-off)', async () => {
    expect(await heroCss()).toContain('.sh-off #static-hero{display:none}');
    expect(themeInit).toContain("window.location.pathname !== '/'");
    expect(themeInit).toMatch(/sb-\.\+-auth-token/);
    expect(themeInit).toContain("classList.add('sh-off')");
  });

  it('works without the app: real links to the example, the test, sign-in and sign-up', () => {
    const html = staticHero();
    for (const href of ['/try', '/k/kb0dxmwb21fb', '/login', '/register', '#builder']) expect(html).toContain(`href="${href}"`);
  });
});
