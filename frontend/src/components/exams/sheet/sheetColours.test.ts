import { describe, expect, it } from 'vitest';

/**
 * The sheet's yellow at night (third live check: «названо один раз» and the highlighter read olive on the dark card).
 * A translucent yellow over the dark card mixes into olive (#574d35 from rgba(244, 196, 91, .3)): every yellow of the
 * sheet and of the landing's sheet example is opaque in the dark theme, the highlighter is the logo dot's hue at a
 * depth the title's ink stays readable on, and the light theme keeps its values.
 *
 * The styles are read from disk: Vitest turns every CSS import into an empty module, `?raw` included.
 */
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
// src/, as a path from this file's own (jsdom's URL is not the one Node's fs takes).
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const SRC = HERE.slice(0, HERE.lastIndexOf('/src/') + '/src/'.length);

/** The custom properties of the rule whose selector list is exactly `selector` (comments left out). */
async function tokens(file: string, selector: string): Promise<Record<string, string>> {
  const css = (await nodeFs()).readFileSync(SRC + file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) => match[1].trim().replace(/\s+/g, ' ') === selector);
  if (!rule) throw new Error(`${file}: no rule ${selector}`);
  return Object.fromEntries([...rule[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]));
}

const hex = (value: string): [number, number, number] | null => {
  const m = value.match(/^#([0-9a-f]{6})$/i);
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number] : null;
};
const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Hue in degrees and saturation 0..1 (HSL). */
function hueSat([r, g, b]: [number, number, number]): { hue: number; sat: number } {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { hue: 0, sat: 0 };
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === x ? ((y - z) / d + (y < z ? 6 : 0)) * 60 : max === y ? ((z - x) / d + 2) * 60 : ((x - y) / d + 4) * 60;
  return { hue, sat };
}

describe('the sheet’s yellow in the dark theme (third live check: olive on the dark card)', () => {
  it('every yellow of the sheet and of the landing’s example is opaque at night', async () => {
    const sheet = await tokens('components/exams/sheet/sheet.css', '.dark .sf-page, .dark .cs-wrap, .dark .cs-mapbox');
    const landing = await tokens('components/home/home.css', '.dark .hx, .dark .hs');
    for (const [name, value] of [['--cs-half', sheet['--cs-half']], ['--cs-mark', sheet['--cs-mark']], ['--hs-yellow', landing['--hs-yellow']]]) {
      expect(hex(value), `${name}: ${value}`).not.toBeNull();
    }
  });

  it('the highlighter is the logo dot’s yellow, deep enough for the title’s ink and still a band on the card', async () => {
    const sheet = await tokens('components/exams/sheet/sheet.css', '.dark .sf-page, .dark .cs-wrap, .dark .cs-mapbox');
    const app = await tokens('index.css', '.dark');
    const mark = hex(sheet['--cs-mark'])!;
    const logo = hueSat(hex(sheet['--cs-half'])!);
    const { hue, sat } = hueSat(mark);
    // Olive is the yellow without its saturation (#574d35: 24 %): this one keeps the logo dot's hue and saturation.
    expect(Math.abs(hue - logo.hue)).toBeLessThan(3);
    expect(sat).toBeGreaterThan(0.8);
    expect(contrast(mark, hex(app['--sf-ink'])!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mark, hex(app['--sf-surface'])!)).toBeGreaterThanOrEqual(3);
  });

  it('the light theme keeps its yellows', async () => {
    const sheet = await tokens('components/exams/sheet/sheet.css', '.sf-page, .cs-wrap, .cs-mapbox');
    expect(sheet['--cs-half']).toBe('#e9b13c');
    expect(sheet['--cs-mark']).toBe('rgba(244, 196, 91, .5)');
    expect((await tokens('components/home/home.css', '.hx, .hs'))['--hs-yellow']).toBe('#e9b13c');
  });
});

describe('the questions’ numbers read as text (phone audit 47.3: 3.25:1 light, 3.66:1 dark at 17 px)', () => {
  it('4.5:1 or more on the card, its soft rows and the canvas, in both themes', async () => {
    const light = await tokens('components/exams/sheet/sheet.css', '.sf-page, .cs-wrap, .cs-mapbox');
    const dark = await tokens('components/exams/sheet/sheet.css', '.dark .sf-page, .dark .cs-wrap, .dark .cs-mapbox');
    // index.css opens with the @tailwind lines, so its :root block is read on its own.
    const root = (await nodeFs()).readFileSync(SRC + 'index.css', 'utf8').match(/(?:^|\n):root\s*\{([^}]*)\}/)![1];
    const lightApp = Object.fromEntries([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]));
    const darkApp = await tokens('index.css', '.dark');
    for (const [num, app] of [
      [light['--cs-num'], lightApp],
      [dark['--cs-num'], darkApp],
    ] as const) {
      for (const ground of ['--sf-surface', '--sf-surface-soft', '--sf-canvas']) {
        expect(contrast(hex(num)!, hex(app[ground])!), `${num} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
