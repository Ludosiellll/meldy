/**
 * Text widths for the knowledge map's layout, without measuring the DOM.
 *
 * The layout must be the same on every device, in tests and before the fonts arrive, so it does not
 * read the browser's text metrics. Instead it uses the advance widths of Literata Variable and Onest
 * Variable (the fonts the app ships, @fontsource-variable), measured once in Chromium at 100 px and
 * stored here in thousandths of an em. Kerning and optical sizing move a line by about 1 %, so every
 * width gets a small safety margin: a box is never narrower than its text.
 */

export type FontKey = 'serif400' | 'serif500' | 'serif600' | 'sans400' | 'sans500';

const CHARS = "0123456789АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяЁёABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -–—.,:;«»()/?!'\"№%+&*=<>[]_…";

/** Advance widths (1/1000 em) of CHARS, one comma-separated list per font. */
const TABLES: Record<FontKey, string> = {
  serif400: "600,410,530,540,560,520,560,510,560,550,660,650,640,580,720,600,1030,570,820,820,720,730,990,820,750,830,610,690,660,690,810,680,840,760,1160,1160,760,970,650,660,1100,700,530,570,550,490,580,510,850,480,670,670,600,610,760,680,580,670,620,490,560,540,820,560,690,620,960,980,640,810,540,510,860,600,600,510,660,640,690,760,600,580,750,820,400,560,740,590,990,770,750,610,750,680,590,660,760,680,980,680,630,620,530,620,490,620,510,360,560,630,320,300,570,320,930,630,580,620,610,470,450,380,620,530,790,560,540,480,200,350,500,1000,330,330,330,330,460,460,340,340,390,530,320,240,380,1200,800,580,800,450,580,580,580,320,320,470,950",
  serif500: "610,420,540,550,580,520,570,520,570,560,680,660,660,580,730,610,1060,580,830,830,740,740,980,830,760,830,620,690,670,700,830,700,850,780,1170,1180,780,990,660,670,1110,720,540,580,560,500,590,520,870,500,680,680,610,630,770,680,600,680,640,510,580,550,840,570,700,630,980,1000,660,840,560,520,870,610,610,520,680,660,690,770,610,580,750,830,400,570,750,600,980,760,760,620,760,700,590,670,760,690,1000,700,650,630,540,630,510,640,520,370,580,650,330,310,600,330,950,650,600,640,620,490,460,390,630,550,820,570,550,490,200,350,500,1000,330,320,330,320,480,480,350,350,400,540,340,240,400,1220,820,580,810,450,580,580,580,340,340,470,930",
  serif600: "620,430,550,560,590,530,580,530,580,570,700,670,670,590,730,610,1080,600,840,840,760,750,980,830,760,840,630,690,680,700,850,720,850,790,1180,1200,790,1000,670,680,1120,740,550,590,570,510,600,540,890,510,690,690,630,640,770,690,610,690,650,520,590,560,850,590,710,650,990,1010,670,860,570,530,890,620,610,540,700,670,690,780,610,590,750,830,410,570,770,610,980,760,760,630,760,720,600,680,750,700,1010,720,670,640,550,640,520,650,540,390,590,660,340,320,620,340,960,660,610,650,630,500,470,390,640,570,840,590,560,500,210,360,500,1000,320,320,320,320,490,490,370,370,400,550,350,250,410,1240,830,580,820,460,580,580,580,350,350,470,920",
  sans400: "670,360,570,600,630,620,620,510,620,620,670,650,660,570,710,610,860,630,730,730,630,690,860,730,760,730,630,710,570,610,840,590,720,660,970,980,730,840,630,710,990,660,560,580,550,450,590,570,760,510,600,600,520,560,700,570,600,570,600,550,470,550,720,520,580,530,790,810,590,680,520,550,790,530,610,570,670,660,700,720,610,600,720,730,260,560,630,570,860,740,760,630,760,660,650,570,730,680,980,590,610,600,560,600,550,600,570,370,600,590,220,250,520,220,820,590,600,600,600,370,510,370,580,540,840,520,600,520,270,460,580,760,250,260,250,260,480,480,310,310,480,510,270,220,360,1060,800,550,680,410,550,550,550,320,320,460,700",
  sans500: "660,370,560,600,630,620,620,510,620,620,680,660,660,580,720,610,890,640,740,740,640,700,870,730,770,730,630,710,580,630,850,620,730,670,980,990,740,860,640,710,1000,670,560,590,550,450,600,570,780,520,600,600,540,570,710,580,600,580,610,560,480,560,740,530,590,540,800,830,590,700,530,550,800,550,610,570,680,660,710,720,610,600,720,730,270,570,640,580,870,750,770,640,770,670,660,580,730,690,990,620,640,600,560,610,560,610,570,370,610,600,230,260,530,230,830,600,600,610,610,380,510,370,580,540,850,530,600,520,270,460,590,780,260,270,260,270,510,510,320,320,490,520,280,230,380,1070,830,560,690,430,560,560,560,330,330,460,720",
};

/** Width of a tabular lining digit (1/1000 em): serif400: 580, serif500: 580, serif600: 580, sans400: 670, sans500: 670. */
export const TABULAR_DIGIT: Record<FontKey, number> = { serif400: 580, serif500: 580, serif600: 580, sans400: 670, sans500: 670 };

/** A box is never narrower than its text: kerning, hinting and optical sizing stay inside this margin. */
const SAFETY = 1.04;

const INDEX = new Map<string, number>();
Array.from(CHARS).forEach((ch, index) => INDEX.set(ch, index));

const parsed = new Map<FontKey, number[]>();

function table(font: FontKey): number[] {
  let values = parsed.get(font);
  if (!values) {
    values = TABLES[font].split(',').map(Number);
    parsed.set(font, values);
  }
  return values;
}

/** A character outside the table: wide for capitals, CJK and symbols, average for the rest. */
function fallbackWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x2e80) return 1000;
  if (ch !== ch.toLocaleLowerCase('ru-RU')) return 760;
  return 640;
}

/** Width in px of a line of text set in `font` at `size` px. */
export function textWidth(text: string, font: FontKey, size: number): number {
  const values = table(font);
  let total = 0;
  for (const ch of text) {
    const index = INDEX.get(ch);
    total += index === undefined ? fallbackWidth(ch) : values[index];
  }
  return (total * size * SAFETY) / 1000;
}

/** Width in px of `count` tabular lining digits. */
export function digitsWidth(count: number, font: FontKey, size: number): number {
  return (Math.max(0, count) * TABULAR_DIGIT[font] * size * SAFETY) / 1000;
}

/**
 * Greedy line breaking as the browser does it for a block with overflow-wrap: anywhere: lines break
 * at spaces and after a hyphen inside a word; a word longer than the line is cut where it no longer
 * fits. Returns the lines (at least one).
 */
export function wrapLines(text: string, maxWidth: number, font: FontKey, size: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  // Break opportunities after a hyphen: «денежно-кредитная» may wrap as «денежно-» + «кредитная».
  // (No regex lookbehind: Safari before 16.4 cannot parse it.)
  const pieces: Array<{ text: string; space: boolean }> = [];
  words.forEach((word, wordIndex) => {
    let start = 0;
    let first = true;
    for (let i = 1; i < word.length; i += 1) {
      if (word[i - 1] === '-' && word[i] !== '-' && i - 1 > start) {
        pieces.push({ text: word.slice(start, i), space: wordIndex > 0 && first });
        first = false;
        start = i;
      }
    }
    pieces.push({ text: word.slice(start), space: wordIndex > 0 && first });
  });
  const lines: string[] = [];
  let line = '';
  const fits = (value: string) => textWidth(value, font, size) <= maxWidth;
  for (const piece of pieces) {
    const candidate = line ? `${line}${piece.space ? ' ' : ''}${piece.text}` : piece.text;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // A piece wider than the line is cut by characters.
    let rest = piece.text;
    while (!fits(rest)) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** The text cut with «…» so that it fits `maxWidth` (unchanged when it already fits). */
export function fitText(text: string, maxWidth: number, font: FontKey, size: number): string {
  if (textWidth(text, font, size) <= maxWidth) return text;
  let cut = text.length - 1;
  while (cut > 1 && textWidth(`${text.slice(0, cut).trimEnd()}…`, font, size) > maxWidth) cut -= 1;
  return `${text.slice(0, cut).trimEnd()}…`;
}
