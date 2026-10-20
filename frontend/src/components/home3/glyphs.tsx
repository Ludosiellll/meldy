import { Fragment, type CSSProperties, type ReactNode } from 'react';

/**
 * Onest's arrows, drawn. «→», «↑» and «↓» live in Onest's symbols subset (17.9 KB): on the landing they were the only
 * characters that fetched it (release 47.5 drew «→» for the same reason, components/home/SheetArrow). The «→» outline
 * is the font's own at weight 400 (from @fontsource-variable/onest's symbols file); «↑» and «↓» are the same outline
 * turned. The colour and size of the text carry over (currentColor, em); each sits in the line as a letter.
 */
const RIGHT = 'M337 -45 289 -102 535 -300H13V-374H535L289 -572L337 -628L687 -337Z';
const UP = 'M641 -323 L584 -275 L386 -521 L386 1 L312 1 L312 -521 L114 -275 L58 -323 L349 -673Z';
const DOWN = 'M59 -349 L116 -397 L314 -151 L314 -673 L388 -673 L388 -151 L586 -397 L642 -349 L351 1Z';

const WIDE: CSSProperties = { display: 'inline', verticalAlign: 'baseline', width: '0.701em', height: '0.66em' };
const TALL: CSSProperties = { display: 'inline', verticalAlign: 'baseline', width: '0.62em', height: '0.69em' };

const GLYPHS: Record<string, { box: string; d: string; style: CSSProperties }> = {
  '→': { box: '0 -660 701 660', d: RIGHT, style: WIDE },
  '↑': { box: '40 -680 620 690', d: UP, style: TALL },
  '↓': { box: '40 -680 620 690', d: DOWN, style: TALL },
};

export function Glyph({ char }: { char: '→' | '↑' | '↓' }) {
  const glyph = GLYPHS[char];
  return (
    <svg viewBox={glyph.box} style={glyph.style} role="img" aria-label={char}>
      <path d={glyph.d} fill="currentColor" />
    </svg>
  );
}

/**
 * Words with every «→», «↑» and «↓» drawn (Glyph); a screen reader reads the character from the label, which is never
 * laid out as text (a visually hidden copy would still fetch the font). Other text stays plain.
 */
export function withGlyphs(text: string): ReactNode {
  if (!/[→↑↓]/.test(text)) return text;
  return text.split(/([→↑↓])/).map((part, index) =>
    part in GLYPHS ? <Glyph key={index} char={part as '→' | '↑' | '↓'} /> : <Fragment key={index}>{part}</Fragment>,
  );
}
