import { glue } from '../sheetModel';

/**
 * The sheet's rule with what it does to a line, shown (EX-17): a rubbed line is broken ink on purpose —
 * unreadable — and to a newcomer it looked like a page in a broken encoding. The rule (copy.SHEET_RULE,
 * word for word) carries a piece of the paper after «наполовину» and after «совсем», each with a line in
 * that state drawn by the paper's own masks (sheet.css), so the eye learns what the hatched lines are.
 * The pieces are for the eye only and hold no text (their handwriting is CSS content): the rule reads and
 * copies as the sentence it is.
 */

/** A piece of the paper with one handwritten line in `state` (for the eye only). */
export function SheetSwatch({ state }: { state: 'rubbed' | 'erased' }) {
  return (
    <span className="cs-swatch" data-state={state} aria-hidden="true">
      <span className="cs-line" data-state={state}>
        <span className="cs-body">
          <span className="cs-patch" data-whole="" />
          <span className="cs-ink" />
        </span>
      </span>
    </span>
  );
}

/** «Строки стирают только ответы: назвали пункт — наполовину [▒], назвали снова в другой день — совсем [░].» */
export function SheetRule() {
  return (
    <p className="cs-rule">
      {/* A dash may end a line, never start one; the word, its piece of paper and the mark after it never part. */}
      {glue('Строки стирают только ответы: назвали пункт —')}{' '}
      <span className="cs-key">
        наполовину
        <SheetSwatch state="rubbed" />,
      </span>
      {glue(' назвали снова в другой день —')}{' '}
      <span className="cs-key">
        совсем
        <SheetSwatch state="erased" />.
      </span>
    </p>
  );
}
