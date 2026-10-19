import { Fragment, type ReactNode } from 'react';

const ARROW = '→';

/**
 * Onest's own «→» (U+2192) at weight 400, drawn: the same outline, advance (0.701 em) and baseline as the font's glyph
 * (taken from @fontsource-variable/onest's symbols file with fontTools). The glyph lives in Onest's symbols subset, and
 * the arrows of the example's cheat-sheet lines were the only characters on the landing that fetched that 19 KB file.
 * The line's colour and size carry over (currentColor, em); it sits in the line as a letter (the base styles make an
 * svg a block).
 */
const GLYPH_STYLE = { display: 'inline', verticalAlign: 'baseline', width: '0.701em', height: '0.66em' } as const;

export function SheetArrow() {
  return (
    <svg className="hm-arrow-g" viewBox="0 -660 701 660" style={GLYPH_STYLE} aria-hidden="true">
      <path d="M337 -45 289 -102 535 -300H13V-374H535L289 -572L337 -628L687 -337Z" fill="currentColor" />
    </svg>
  );
}

/** A cheat-sheet line's words with every «→» drawn (SheetArrow); a line without one stays plain text. */
export function withArrows(text: string): ReactNode {
  if (!text.includes(ARROW)) return text;
  return text.split(ARROW).map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? <SheetArrow /> : null}
      {part}
    </Fragment>
  ));
}
