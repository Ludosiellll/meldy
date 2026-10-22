import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import indexHtml from '../../../index.html?raw';
import themeInit from '../../../public/theme-init.js?raw';
import HeroTop from './HeroTop';
import { LANDING_ORAL } from '../../lib/footage';
import { TILES, bind } from './copy3';

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
    const markup = renderToStaticMarkup(<HeroTop />);
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

  it('shows the blue tile’s phone as its poster, an <img> of the video’s own size: no video, nothing moves when it comes', () => {
    const html = staticHero();
    expect(html).toContain(`<h2 class="h3-oral-h">${bind(TILES.oral)}</h2>`);
    const img = html.match(/<img class="h3-oral-poster"[^>]*>/)?.[0] ?? '';
    expect(img).toContain(`src="${LANDING_ORAL.poster}"`);
    expect(img).toContain(`width="${LANDING_ORAL.width}"`);
    expect(img).toContain(`height="${LANDING_ORAL.height}"`);
    expect(img).toContain('alt=""');
    expect(img).not.toContain('loading="lazy"');
    // the phone is decoration (the tile's heading says what it shows), and the 48 s reel is no longer on the page
    expect(html).toContain(`<div class="h3-oral-phone" aria-hidden="true" style="--oral-ar:${LANDING_ORAL.width} / ${LANDING_ORAL.height}"><img`);
    expect(html).not.toMatch(/<video|h3-reel/);
    expect(indexHtml).not.toMatch(/reel/i);
  });

  it('has no shadow, blur or backdrop filter in the first screen’s styles', async () => {
    expect((await heroCss()).replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/box-shadow:(?!inset 0 0 0 1px)|filter|blur/);
  });

  it('works without the app: real links to the example, the test, sign-in and sign-up', () => {
    const html = staticHero();
    for (const href of ['/try', '/k/kb0dxmwb21fb', '/login', '/register', '#builder']) expect(html).toContain(`href="${href}"`);
  });
});
