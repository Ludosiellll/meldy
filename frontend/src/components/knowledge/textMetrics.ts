/**
 * Text widths for the knowledge map's layout, without measuring the DOM.
 *
 * The layout must be the same on every device, in tests and before the fonts arrive, so it does not
 * read the browser's text metrics. Instead it uses the advance widths of Onest Variable (the face the
 * app ships, @fontsource-variable/onest; since 2026-10-04 the map, like the rest of Meldy, has no
 * serif), measured once in Chromium at 100 px and stored here in thousandths of an em, at the three
 * weights the map draws: 400, 500 and 600. Kerning moves a line by about 1 %, so every width gets a
 * small safety margin: a box is never narrower than its text.
 */

export type FontKey = 'sans400' | 'sans500' | 'sans600';

const CHARS = "0123456789АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяЁёABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -–—.,:;«»()/?!'\"№%+&*=<>[]_…";

/** Advance widths (1/1000 em) of CHARS, one comma-separated list per font. */
const TABLES: Record<FontKey, string> = {
  sans400: "670,360,570,600,630,620,620,510,620,620,670,650,660,570,710,610,860,630,730,730,630,690,860,730,760,730,630,710,570,610,840,590,720,660,970,980,730,840,630,710,990,660,560,580,550,450,590,570,760,510,600,600,520,560,700,570,600,570,600,550,470,550,720,520,580,530,790,810,590,680,520,550,790,530,610,570,670,660,700,720,610,600,720,730,260,560,630,570,860,740,760,630,760,660,650,570,730,680,980,590,610,600,560,600,550,600,570,370,600,590,220,250,520,220,820,590,600,600,600,370,510,370,580,540,840,520,600,520,270,460,580,760,250,260,250,260,480,480,310,310,480,510,270,220,360,1060,800,550,680,410,550,550,550,320,320,460,700",
  sans500: "660,370,560,600,630,620,620,510,620,620,680,660,660,580,720,610,890,640,740,740,640,700,870,730,770,730,630,710,580,630,850,620,730,670,980,990,740,860,640,710,1000,670,560,590,550,450,600,570,780,520,600,600,540,570,710,580,600,580,610,560,480,560,740,530,590,540,800,830,590,700,530,550,800,550,610,570,680,660,710,720,610,600,720,730,270,570,640,580,870,750,770,640,770,670,660,580,730,690,990,620,640,600,560,610,560,610,570,370,610,600,230,260,530,230,830,600,600,610,610,380,510,370,580,540,850,530,600,520,270,460,590,780,260,270,260,270,510,510,320,320,490,520,280,230,380,1070,830,560,690,430,560,560,560,330,330,460,720",
  sans600: "660,380,560,610,640,620,620,510,620,620,700,670,670,580,730,620,920,650,750,750,660,700,890,740,770,740,640,720,590,640,860,640,740,680,990,1000,750,880,650,710,1010,690,560,600,560,450,610,570,790,530,610,610,550,570,720,580,600,580,610,560,490,560,760,550,600,540,820,840,590,720,540,550,810,560,620,570,700,670,710,730,620,600,730,740,280,580,660,590,890,760,770,650,770,680,660,590,730,700,1000,640,660,610,560,620,560,620,570,380,620,600,240,260,550,240,840,600,600,620,620,390,510,370,580,550,860,550,610,510,280,460,600,800,270,290,270,290,530,530,340,340,500,520,290,240,390,1080,860,580,700,450,580,580,580,340,340,450,740",
};

/** Width of a tabular lining digit (1/1000 em): 670 at every weight of Onest. */
export const TABULAR_DIGIT: Record<FontKey, number> = { sans400: 670, sans500: 670, sans600: 670 };

/** A box is never narrower than its text: kerning and hinting stay inside this margin. */
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
