import { glue } from '../sheetModel';
import { SHEET_RULE } from './copy';

/**
 * The words that explain the sheet's look. The rule under the counter (copy.SHEET_RULE, word for word), and the
 * key of the map of lines: a square of each state with its word. Since the sheet is in the app's own look
 * (2026-10-10) a line's state is its marker — a dot, a yellow dot, a struck-through line — and the key says
 * what each one means once, beside the map, instead of a piece of the old paper in the rule.
 */

/** «Строки стирают только ответы: назвали пункт — наполовину, назвали снова в другой день — совсем.» */
export function SheetRule() {
  return <p className="cs-rule">{glue(SHEET_RULE)}</p>;
}

/** The map's key: «осталось · названо один раз · стёрто», and «пора проверить» while a line is due. For the eye only. */
export function MapLegend({ due = false }: { due?: boolean }) {
  return (
    <p className="cs-legend" aria-hidden="true">
      <span>
        <i data-s="left" />
        осталось
      </span>
      <span>
        <i data-s="half" />
        названо один раз
      </span>
      <span>
        <i data-s="gone" />
        стёрто
      </span>
      {due ? (
        <span>
          <i data-s="due" />
          пора проверить
        </span>
      ) : null}
    </p>
  );
}
