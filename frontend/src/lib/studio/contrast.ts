/**
 * Colour of the studio's page: WCAG 2 contrast, an author's own accent nudged until it reads, and the theme as CSS
 * custom properties for DocView (one renderer for the canvas and the participant).
 *
 * The six accents are Meldy's own and come out exactly as the quiz page has them (components/quiz/quizTake.css,
 * `.qt-accent` and its `data-accent` rules — fill, hover, hover circle, link, time strip, in both themes), under the
 * same names (`--qt-*`), so QuestionCard inside DocView takes the colour with no extra rules. The base surfaces are the
 * design language's (meldy-notes 10_Project/Design_Language_2026-10-04, index.css `--sf-*`).
 *
 * A custom accent keeps its hue: only its lightness moves, as little as needed — white text on the fill 4.5:1, the
 * fill 3:1 to the dark canvas (a control), a link 4.5:1 to every surface it sits on.
 */
import { QUIZ_ACCENTS, type QuizAccent } from '../../types/quiz';
import { HEX_RE, type DocTheme } from '../../types/testDoc';

export type Rgb = [number, number, number];

const HEX_ANY = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

export function isHex(value: string): boolean {
  return HEX_ANY.test(value);
}

/** «#2869dd», «2869DD» or «#fff» → [r, g, b] 0..255; anything else → black. */
export function hexRgb(hex: string): Rgb {
  const match = HEX_ANY.exec(hex.trim());
  if (!match) return [0, 0, 0];
  const digits = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as Rgb;
}

export function rgbHex(rgb: Rgb): string {
  return `#${rgb.map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexRgb(hex).map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `a` laid over `b` with `weight` of a (0..1), channel by channel. */
export function mix(a: string, b: string, weight: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return rgbHex([0, 1, 2].map((at) => x[at] * weight + y[at] * (1 - weight)) as Rgb);
}

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = hexRgb(hex).map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number) => {
    const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbHex([channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]);
}

/** The lightness of `hex` moved toward `target` (0 black, 1 white) just until `passes`; its hue and saturation kept. */
function moveLightness(hex: string, target: 0 | 1, passes: (color: string) => boolean): string {
  const [h, s, l] = hsl(hex);
  let fail = l;
  let pass: number = target;
  for (let step = 0; step < 32; step += 1) {
    const mid = (fail + pass) / 2;
    if (passes(hslHex(h, s, mid))) pass = mid;
    else fail = mid;
  }
  return hslHex(h, s, pass);
}

export interface Readable {
  color: string;
  /** The colour had to move: the author sees «цвет чуть поправлен для читаемости». */
  nudged: boolean;
}

/**
 * `hex` as a colour that reads on `bg` (text on it, or it on text: the ratio is the same), at least `min`:1 (4.5 for
 * text, 3 for large text and controls). It goes darker on a light background and lighter on a dark one, only as far
 * as needed; when even black or white cannot reach `min` (a mid-grey background) the extreme is given.
 */
export function readableAccent(hex: string, bg: string, min = 4.5): Readable {
  const base = rgbHex(hexRgb(hex));
  if (contrast(base, bg) >= min) return { color: base, nudged: false };
  const target = contrast('#000000', bg) >= contrast('#ffffff', bg) ? 0 : 1;
  const extreme = target === 0 ? '#000000' : '#ffffff';
  if (contrast(extreme, bg) < min) return { color: extreme, nudged: true };
  return { color: moveLightness(base, target, (color) => contrast(color, bg) >= min), nudged: true };
}

// ─────────────────────────────────────────────── the theme

export interface Surfaces {
  canvas: string;
  surface: string;
  surfaceSoft: string;
  ink: string;
  muted: string;
  line: string;
}
/** index.css `--sf-*`: the design language's light and dark surfaces. */
export const SURFACES: { light: Surfaces; dark: Surfaces } = {
  light: { canvas: '#f3f3f0', surface: '#ffffff', surfaceSoft: '#f7f7f3', ink: '#0b121c', muted: '#4b515b', line: '#e3e3dd' },
  dark: { canvas: '#0b0f16', surface: '#141a24', surfaceSoft: '#1b2230', ink: '#f3f3f0', muted: '#a7adb7', line: '#262e3b' },
};

export interface AccentPalette {
  /** The pill and a chosen option's box (white text on it). */
  fill: string;
  /** Hover of the pill and its circle. */
  fillDeep: string;
  /** The circle on hover. */
  fillDeeper: string;
  onFill: string;
  /** Quiet links and small accent text. */
  link: string;
  /** The time strip (not text: 3:1). */
  bar: string;
  /** A soft tint behind chosen and highlighted things. */
  soft: string;
  /** A custom colour had to move (always false for the six). */
  nudged: boolean;
}
type Six = Omit<AccentPalette, 'nudged'>;

const blueSoft = { light: '#e8effc', dark: '#1a2a47' };
const sixOf = (fill: string, deep: string, deeper: string, link: string, darkLink: string, dark?: Partial<Six>) => ({
  light: { fill, fillDeep: deep, fillDeeper: deeper, onFill: '#ffffff', link, bar: fill, soft: mix(fill, SURFACES.light.surface, 0.1) },
  dark: {
    fill,
    fillDeep: deep,
    fillDeeper: deeper,
    onFill: '#ffffff',
    link: darkLink,
    bar: darkLink,
    soft: mix(dark?.fill ?? fill, SURFACES.dark.surface, 0.24),
    ...dark,
  },
});

/** quizTake.css, measured there (WCAG 2): the pill, its hover and circle, the link and the strip of each colour. */
export const ACCENTS: Record<QuizAccent, { light: Six; dark: Six }> = {
  blue: {
    light: { fill: '#2869dd', fillDeep: '#1c4db1', fillDeeper: '#163f93', onFill: '#ffffff', link: SURFACES.light.ink, bar: '#2869dd', soft: blueSoft.light },
    dark: { fill: '#2869dd', fillDeep: '#1c4db1', fillDeeper: '#163f93', onFill: '#ffffff', link: SURFACES.dark.ink, bar: '#8db2f5', soft: blueSoft.dark },
  },
  green: sixOf('#1f7a3d', '#165c2e', '#10471f', '#1d6b36', '#8fd4a0'),
  orange: sixOf('#b45309', '#8f400a', '#6f3208', '#a2480c', '#f5a660'),
  violet: sixOf('#6d3fd6', '#5530ac', '#432689', '#5f37c4', '#c0a8f7'),
  pink: sixOf('#c0306b', '#9c2556', '#7c1d44', '#b02a62', '#f6a8c8'),
  graphite: sixOf('#3b4250', '#2a303b', '#1d222a', '#3b4250', '#c3c8d0', { fill: '#5b6475', fillDeep: '#454d5c', fillDeeper: '#343a46' }),
};

/** The colour of a «мягкий» background's top: the tone's fill laid thinly over the canvas. */
export function softTop(tone: QuizAccent, dark: boolean): string {
  return dark ? mix(ACCENTS[tone].dark.fill, SURFACES.dark.canvas, 0.16) : mix(ACCENTS[tone].light.fill, SURFACES.light.canvas, 0.1);
}

const pickWorst = (backgrounds: readonly string[], dark: boolean) =>
  [...backgrounds].sort((a, b) => (dark ? luminance(b) - luminance(a) : luminance(a) - luminance(b)))[0];

/**
 * An author's colour as a palette: the fill nudged for white text (and, in the dark theme, lifted to 3:1 against the
 * canvas while white text keeps 4.5:1), hover shades darker, the link nudged for 4.5:1 against the least readable of
 * `backgrounds` (the theme's surfaces by default).
 */
export function customPalette(hex: string, dark: boolean, backgrounds?: readonly string[]): AccentPalette {
  const base = rgbHex(hexRgb(hex));
  const surfaces = dark ? SURFACES.dark : SURFACES.light;
  let fill = readableAccent(base, '#ffffff').color;
  // Lifted only as far as 3:1 to the dark canvas (luminance ≈ 0.115): white text still reads 6:1 on it.
  if (dark && contrast(fill, surfaces.canvas) < 3) fill = moveLightness(fill, 1, (color) => contrast(color, surfaces.canvas) >= 3);
  const worst = pickWorst(backgrounds ?? [surfaces.canvas, surfaces.surface, surfaces.surfaceSoft], dark);
  const link = readableAccent(base, worst).color;
  return {
    fill,
    fillDeep: mix(fill, '#000000', 0.78),
    fillDeeper: mix(fill, '#000000', 0.6),
    onFill: '#ffffff',
    link,
    bar: dark ? link : fill,
    soft: dark ? mix(fill, surfaces.surface, 0.24) : mix(fill, surfaces.surface, 0.1),
    nudged: fill !== base,
  };
}

/** The palette of a theme's accent: one of the six as the quiz page has it, or the author's own, nudged. */
export function accentPalette(accent: DocTheme['accent'], dark: boolean, backgrounds?: readonly string[]): AccentPalette {
  if (typeof accent === 'string') {
    const six = ACCENTS[QUIZ_ACCENTS.includes(accent) ? accent : 'blue'];
    return { ...(dark ? six.dark : six.light), nudged: false };
  }
  return customPalette(HEX_RE.test(accent.custom) ? accent.custom : ACCENTS.blue.light.fill, dark, backgrounds);
}

export const FONT_STACKS: Record<DocTheme['font'], string> = {
  onest: "'Onest Variable', 'Onest Fallback', system-ui, -apple-system, 'Segoe UI', sans-serif",
  // System faces only: the production CSP keeps fonts on our own host. All of them have Cyrillic.
  serif: "Georgia, 'Noto Serif', 'PT Serif', 'Times New Roman', serif",
  mono: "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas, monospace",
};
export const RADIUS: Record<DocTheme['radius'], { card: string; field: string }> = {
  soft: { card: '24px', field: '16px' },
  round: { card: '36px', field: '22px' },
  square: { card: '6px', field: '4px' },
};
export const BUTTON_RADIUS: Record<DocTheme['buttons'], string> = { pill: '999px', rounded: '14px', square: '4px' };
export const DENSITY: Record<DocTheme['density'], { gap: string; pad: string }> = {
  airy: { gap: '28px', pad: '32px' },
  compact: { gap: '14px', pad: '20px' },
};
/** Over a picture, text sits on at least this much black: white text then reads 4.5:1 over any picture. */
export const SCRIM_MIN = 55;

/**
 * The theme as CSS custom properties for DocView's root (`style={themeTokens(doc.theme, dark)}`):
 * `--qt-fill`, `--qt-fill-deep`, `--qt-fill-deeper`, `--qt-on-fill`, `--qt-link`, `--qt-bar` (the quiz page's names);
 * `--doc-canvas`, `--doc-surface`, `--doc-surface-soft`, `--doc-ink`, `--doc-muted`, `--doc-line`, `--doc-accent-soft`;
 * `--doc-bg` (the page's background: a colour or a gradient; a picture is DocView's, under `--doc-bg-dim`),
 * `--doc-bg-dim` (the author's darkening of the picture), `--doc-bg-scrim` (behind text laid straight on the picture),
 * `--doc-on-bg` (text straight on the background); `--doc-font`, `--doc-radius-card`, `--doc-radius-field`,
 * `--doc-radius-button`, `--doc-gap`, `--doc-pad`, `--doc-answer-columns`.
 */
export function themeTokens(theme: DocTheme, dark: boolean): Record<string, string> {
  const surfaces = dark ? SURFACES.dark : SURFACES.light;
  const background = theme.background;
  const top = background.kind === 'soft' ? softTop(background.tone, dark) : null;
  const palette = accentPalette(theme.accent, dark, [surfaces.canvas, surfaces.surface, surfaces.surfaceSoft, ...(top ? [top] : [])]);
  const image = background.kind === 'image';
  const dim = image ? Math.min(80, Math.max(0, background.dim)) : 0;
  return {
    '--qt-fill': palette.fill,
    '--qt-fill-deep': palette.fillDeep,
    '--qt-fill-deeper': palette.fillDeeper,
    '--qt-on-fill': palette.onFill,
    '--qt-link': palette.link,
    '--qt-bar': palette.bar,
    '--doc-canvas': surfaces.canvas,
    '--doc-surface': surfaces.surface,
    '--doc-surface-soft': surfaces.surfaceSoft,
    '--doc-ink': surfaces.ink,
    '--doc-muted': surfaces.muted,
    '--doc-line': surfaces.line,
    '--doc-accent-soft': palette.soft,
    '--doc-bg': top ? `linear-gradient(180deg, ${top} 0%, ${surfaces.canvas} 70%)` : surfaces.canvas,
    '--doc-bg-dim': image ? `rgba(0, 0, 0, ${dim / 100})` : 'transparent',
    '--doc-bg-scrim': image ? `rgba(0, 0, 0, ${Math.max(dim, SCRIM_MIN) / 100})` : 'transparent',
    '--doc-on-bg': image ? '#ffffff' : surfaces.ink,
    '--doc-font': FONT_STACKS[theme.font],
    '--doc-radius-card': RADIUS[theme.radius].card,
    '--doc-radius-field': RADIUS[theme.radius].field,
    '--doc-radius-button': BUTTON_RADIUS[theme.buttons],
    '--doc-gap': DENSITY[theme.density].gap,
    '--doc-pad': DENSITY[theme.density].pad,
    '--doc-answer-columns': theme.answers === 'grid' ? '2' : '1',
  };
}
