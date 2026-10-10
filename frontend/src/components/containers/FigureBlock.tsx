import { useId, useState } from 'react';
import { DUE_DAYS } from '../../lib/containers/rule';
import * as copy from './copy';
import type { Figure } from './model';

/**
 * The one figure (decision 8, 46): «143» large with «из 960 верно / в два разных дня» in two lines beside it, and
 * «Видели 410 · ошибок сейчас 37 · Как считается» under it.
 * - Before any answer: no zeros — the rule in one line (phone rule 9).
 * - Answered, nothing counts yet: no big zero — the dated line of the plan («Первые войдут в счёт завтра после 17:00 —
 *   если снова ответите верно», decision 40) in ink, and the seen line.
 */
export default function FigureBlock({ figure, firstLine }: { figure: Figure; firstLine: string | null }) {
  const [open, setOpen] = useState(false);
  const howId = useId();
  const how = (
    <button type="button" className="sf-link" data-muted="" aria-expanded={open} aria-controls={open ? howId : undefined} onClick={() => setOpen((value) => !value)}>
      {copy.HOW_COUNTED}
    </button>
  );
  const panel = open ? (
    <div className="ct-how" id={howId}>
      {copy.howCounted(DUE_DAYS).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  ) : null;

  if (figure.seen === 0) {
    return (
      <section className="ct-figure" aria-label={copy.TWO_DAYS}>
        <p className="ct-fig-rule">
          {copy.RULE_LINE} {how}
        </p>
        {panel}
      </section>
    );
  }
  const seen = copy.seenLine(figure.seen, figure.errors);
  if (figure.twoDays === 0) {
    return (
      <section className="ct-figure" aria-label={copy.TWO_DAYS}>
        <p className="ct-fig-first">{copy.glue(firstLine ?? copy.FIRST_COUNT_FALLBACK)}</p>
        <p className="ct-fig-sub">
          {seen}
          {copy.SEP}
          {how}
        </p>
        {panel}
      </section>
    );
  }
  return (
    <section className="ct-figure" aria-label={copy.TWO_DAYS}>
      <p className="ct-fig">
        <span className="ct-fig-n" aria-hidden="true">
          {figure.twoDays}
        </span>
        <span className="ct-fig-l" aria-hidden="true">
          <span>{copy.figureOf(figure.total)}</span>
          <span>{copy.FIGURE_TAIL}</span>
        </span>
        <span className="sr-only">{copy.glue(`${figure.twoDays} из ${figure.total} — ${copy.TWO_DAYS}`)}</span>
      </p>
      <p className="ct-fig-sub">
        {seen}
        {copy.SEP}
        {how}
      </p>
      {panel}
    </section>
  );
}
