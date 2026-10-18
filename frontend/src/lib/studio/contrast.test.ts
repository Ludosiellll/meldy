import { beforeAll, describe, expect, it } from 'vitest';
import { QUIZ_ACCENTS, type QuizAccent } from '../../types/quiz';
import type { DocBackground, DocTheme } from '../../types/testDoc';
import {
  accentPalette,
  ACCENTS,
  contrast,
  customPalette,
  hexRgb,
  isHex,
  luminance,
  mix,
  readableAccent,
  rgbHex,
  SCRIM_MIN,
  softTop,
  SURFACES,
  themeTokens,
} from './contrast';

const THEME: DocTheme = { accent: 'blue', background: { kind: 'plain' }, font: 'onest', radius: 'soft', density: 'airy', answers: 'list', buttons: 'pill' };
const norm = (hex: string) => rgbHex(hexRgb(hex));

// The stylesheets are read from disk: Vitest turns every CSS import into an empty module, `?raw` included.
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const SRC = HERE.slice(0, HERE.lastIndexOf('/src/') + '/src/'.length);
let quizCss = '';
let sfLight: Record<string, string> = {};
let sfDark: Record<string, string> = {};
beforeAll(async () => {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
  quizCss = fs.readFileSync(`${SRC}components/quiz/quizTake.css`, 'utf8');
  const indexCss = fs.readFileSync(`${SRC}index.css`, 'utf8');
  sfLight = declarations(indexCss, ':root');
  sfDark = declarations(indexCss, '.dark');
});

/** The custom properties of the first rule with exactly this selector. */
function declarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return {};
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const resolve = (value: string, dark: boolean) => value.replace(/var\((--[a-z-]+)\)/, (_, name: string) => (dark ? sfDark[name] ?? sfLight[name] : sfLight[name]));

/** What quizTake.css gives a quiz page of this colour: the base rule, the dark base rule, the colour's rules. */
function quizVars(accent: QuizAccent, dark: boolean): Record<string, string> {
  const sel = `.qt-accent:is([data-accent='${accent}'], .qt-accent-${accent})`;
  const merged = {
    ...declarations(quizCss, '.qt-accent'),
    ...(dark ? declarations(quizCss, '.dark .qt-accent') : {}),
    ...declarations(quizCss, sel),
    ...(dark ? declarations(quizCss, `.dark ${sel}`) : {}),
  };
  return Object.fromEntries(Object.entries(merged).map(([name, value]) => [name, norm(resolve(value, dark))]));
}

describe('colour arithmetic', () => {
  it('reads and writes hex', () => {
    expect(hexRgb('#2869dd')).toEqual([40, 105, 221]);
    expect(hexRgb('ABC')).toEqual([170, 187, 204]);
    expect(hexRgb('nope')).toEqual([0, 0, 0]);
    expect(rgbHex([300, -5, 15.6])).toBe('#ff0010');
    expect(isHex('#abcdef')).toBe(true);
    expect(isHex('#abcd')).toBe(false);
  });

  it('WCAG luminance and contrast', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#050505')).toBeCloseTo(0.0015, 4);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#2869dd')).toBeCloseTo(contrast('#2869dd', '#ffffff'), 10);
    expect(contrast('#2869dd', '#ffffff')).toBeCloseTo(5.05, 2);
  });

  it('mixes channel by channel', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#2869dd', '#ffffff', 1)).toBe('#2869dd');
  });
});

describe('readableAccent', () => {
  it('leaves a colour that already reads', () => {
    expect(readableAccent('#1F7A3D', '#ffffff')).toEqual({ color: '#1f7a3d', nudged: false });
  });

  it.each(['#ffee00', '#00ff00', '#ff0000', '#ffffff', '#88ccff', '#999999'])('nudges %s darker on a light background, as little as needed', (hex) => {
    const { color, nudged } = readableAccent(hex, '#f3f3f0');
    expect(nudged).toBe(true);
    expect(contrast(color, '#f3f3f0')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color, '#f3f3f0')).toBeLessThan(4.75);
    expect(luminance(color)).toBeLessThan(luminance(hex));
  });

  it.each(['#000000', '#2869dd', '#6d3fd6', '#3b4250'])('nudges %s lighter on a dark background', (hex) => {
    const { color, nudged } = readableAccent(hex, '#1b2230');
    expect(nudged).toBe(true);
    expect(contrast(color, '#1b2230')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(color)).toBeGreaterThan(luminance(hex));
  });

  it('keeps the hue', () => {
    const [r, g, b] = hexRgb(readableAccent('#ff8800', '#ffffff').color);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('takes another minimum (3:1 for controls)', () => {
    const { color } = readableAccent('#88ccff', '#ffffff', 3);
    expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(contrast(color, '#ffffff')).toBeLessThan(3.3);
  });

  it('gives the extreme when nothing reaches the minimum (a mid-grey background)', () => {
    expect(readableAccent('#777777', '#777777', 7)).toEqual({ color: '#000000', nudged: true });
    expect(readableAccent('#777777', '#595959', 8)).toEqual({ color: '#ffffff', nudged: true });
  });
});

describe('the six accents are the quiz page own', () => {
  it('the surfaces are index.css', () => {
    for (const dark of [false, true]) {
      const vars = dark ? sfDark : sfLight;
      const surfaces = dark ? SURFACES.dark : SURFACES.light;
      expect(surfaces).toEqual({
        canvas: vars['--sf-canvas'],
        surface: vars['--sf-surface'],
        surfaceSoft: vars['--sf-surface-soft'],
        ink: vars['--sf-ink'],
        muted: vars['--sf-muted'],
        line: vars['--sf-line'],
      });
    }
  });

  it.each(QUIZ_ACCENTS.flatMap((accent) => [[accent, false] as const, [accent, true] as const]))('%s (dark %s): fill, hover, circle, link, strip as quizTake.css', (accent, dark) => {
    const css = quizVars(accent, dark);
    expect(Object.keys(css).sort()).toEqual(['--qt-bar', '--qt-fill', '--qt-fill-deep', '--qt-fill-deeper', '--qt-link', '--qt-on-fill']);
    const tokens = themeTokens({ ...THEME, accent }, dark);
    for (const [name, value] of Object.entries(css)) expect([name, norm(tokens[name])]).toEqual([name, value]);
    expect(accentPalette(accent, dark).nudged).toBe(false);
  });
});

const BACKGROUNDS: DocBackground[] = [{ kind: 'plain' }, ...QUIZ_ACCENTS.map((tone): DocBackground => ({ kind: 'soft', tone }))];
const CUSTOM = ['#ffee00', '#00ff00', '#ff0000', '#0000ff', '#000000', '#ffffff', '#888888', '#40e0d0', '#2869dd', '#f6a8c8'];

describe('every theme stays readable', () => {
  const cases = [...QUIZ_ACCENTS, ...CUSTOM.map((custom) => ({ custom }))].flatMap((accent) =>
    BACKGROUNDS.flatMap((background) => [false, true].map((dark) => ({ accent, background, dark }))),
  );

  it.each(cases)('$accent on $background, dark $dark', ({ accent, background, dark }) => {
    const tokens = themeTokens({ ...THEME, accent, background }, dark);
    const surfaces = dark ? SURFACES.dark : SURFACES.light;
    const places = [surfaces.canvas, surfaces.surface, surfaces.surfaceSoft, ...(background.kind === 'soft' ? [softTop(background.tone, dark)] : [])];
    for (const place of places) {
      expect(contrast(tokens['--qt-link'], place)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['--doc-ink'], place)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['--doc-muted'], place)).toBeGreaterThanOrEqual(4.5);
    }
    for (const fill of [tokens['--qt-fill'], tokens['--qt-fill-deep'], tokens['--qt-fill-deeper']]) expect(contrast(fill, tokens['--qt-on-fill'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens['--qt-fill'], surfaces.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast(tokens['--qt-bar'], surfaces.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast(tokens['--doc-ink'], tokens['--doc-accent-soft'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('a custom accent', () => {
  it('is nudged and says so', () => {
    expect(customPalette('#ffee00', false).nudged).toBe(true);
    expect(customPalette('#1f7a3d', false)).toMatchObject({ fill: '#1f7a3d', nudged: false, bar: '#1f7a3d' });
    expect(accentPalette({ custom: '#ffee00' }, false).nudged).toBe(true);
  });

  it('in the dark theme is lifted to 3:1 against the canvas with white text still readable', () => {
    const palette = customPalette('#000000', true);
    expect(palette.nudged).toBe(true);
    expect(contrast(palette.fill, SURFACES.dark.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast(palette.fill, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(palette.bar).toBe(palette.link);
  });

  it('checks the link against the backgrounds given', () => {
    const dark = '#c9c9c9';
    const palette = customPalette('#2869dd', false, [dark]);
    expect(contrast(palette.link, dark)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(customPalette('#2869dd', false).link, dark)).toBeLessThan(4.5);
  });

  it('a broken custom value falls back to Meldy blue', () => {
    expect(accentPalette({ custom: 'red' }, false).fill).toBe('#2869dd');
  });

  it('an unknown name falls back to blue', () => {
    expect(accentPalette('red' as QuizAccent, false)).toEqual({ ...ACCENTS.blue.light, nudged: false });
  });
});

describe('themeTokens', () => {
  it('the page: plain, fonts, radius, buttons, density, answers', () => {
    const tokens = themeTokens({ ...THEME, font: 'serif', radius: 'square', buttons: 'rounded', density: 'compact', answers: 'grid' }, false);
    expect(tokens).toMatchObject({
      '--doc-bg': SURFACES.light.canvas,
      '--doc-bg-dim': 'transparent',
      '--doc-bg-scrim': 'transparent',
      '--doc-on-bg': SURFACES.light.ink,
      '--doc-radius-card': '6px',
      '--doc-radius-field': '4px',
      '--doc-radius-button': '14px',
      '--doc-gap': '14px',
      '--doc-pad': '20px',
      '--doc-answer-columns': '2',
    });
    expect(tokens['--doc-font']).toMatch(/^Georgia/);
    expect(themeTokens({ ...THEME, font: 'mono' }, true)['--doc-font']).toMatch(/monospace$/);
    expect(themeTokens(THEME, true)).toMatchObject({ '--doc-canvas': '#0b0f16', '--doc-answer-columns': '1', '--doc-radius-button': '999px', '--doc-font': expect.stringContaining('Onest') });
  });

  it('a soft background is a gradient from the tone to the canvas', () => {
    const tokens = themeTokens({ ...THEME, background: { kind: 'soft', tone: 'pink' } }, false);
    expect(tokens['--doc-bg']).toBe(`linear-gradient(180deg, ${softTop('pink', false)} 0%, #f3f3f0 70%)`);
    expect(softTop('pink', true)).not.toBe(softTop('pink', false));
  });

  it('a picture: the author dim, a scrim of at least 55 % behind text, white text on it', () => {
    const tokens = themeTokens({ ...THEME, background: { kind: 'image', path: 'x', dim: 20 } }, false);
    expect(tokens).toMatchObject({ '--doc-bg-dim': 'rgba(0, 0, 0, 0.2)', '--doc-bg-scrim': `rgba(0, 0, 0, ${SCRIM_MIN / 100})`, '--doc-on-bg': '#ffffff' });
    expect(themeTokens({ ...THEME, background: { kind: 'image', path: 'x', dim: 95 } }, true)).toMatchObject({ '--doc-bg-dim': 'rgba(0, 0, 0, 0.8)', '--doc-bg-scrim': 'rgba(0, 0, 0, 0.8)' });
    // White text over the brightest picture under the least scrim: 4.5:1.
    const worst = mix('#000000', '#ffffff', SCRIM_MIN / 100);
    expect(contrast('#ffffff', worst)).toBeGreaterThanOrEqual(4.5);
  });
});
