import { useId, useState } from 'react';
import type { DayPlan, LocalDay } from '../../types/container';
import { DUE_DAYS } from '../../lib/containers/rule';
import { RULE_LINE } from '../../lib/containers/words';
import { figureWords } from './planLines';
import * as copy from './copy';
import type { Figure } from './model';

/**
 * The one figure (decision 8, 46) in the plan's words (lib/containers/words.ts figureLines): «143» large with «из 960 /
 * выучено» in two lines beside it, and «Видели 410 · 37 ошибок · Как считается» under it.
 * - Before any answer: no zeros — the rule in one line (phone rule 9).
 * - Answered, nothing counts yet: no big zero — the dated line («Ответьте верно ещё раз завтра после 17:00, и первые
 *   вопросы будут выучены», decision 40, its time from the plan's `first_count` line) in ink, and the seen line.
 */
export default function FigureBlock({ figure, plan, today }: { figure: Figure; plan: DayPlan | null; today: LocalDay }) {
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
  const words = figureWords(figure, plan, today);

  if (figure.seen === 0 || !words || (!words.big && !words.under)) {
    return (
      <section className="ct-figure" aria-label={copy.FIGURE_LABEL}>
        <p className="ct-fig-rule">
          {words?.label || RULE_LINE} {how}
        </p>
        {panel}
      </section>
    );
  }
  // «Видели 410 · ошибок сейчас 37»: a number stays with its word, the dot with the part before it.
  const under = (words.under ?? '').replace(/ · /g, copy.SEP).replace(/ (?=\d)/g, copy.NBSP).replace('ошибок сейчас', `ошибок${copy.NBSP}сейчас`);
  if (!words.big) {
    return (
      <section className="ct-figure" aria-label={copy.FIGURE_LABEL}>
        <p className="ct-fig-first">{copy.glue(words.label)}</p>
        <p className="ct-fig-sub">
          {under}
          {copy.SEP}
          {how}
        </p>
        {panel}
      </section>
    );
  }
  // «из 960» + «верно в два разных дня» → «из 960 верно» / «в два разных дня».
  const cut = words.label.indexOf(' ');
  const first = cut > 0 ? `${words.of} ${words.label.slice(0, cut)}` : words.of;
  const second = cut > 0 ? words.label.slice(cut + 1) : words.label;
  return (
    <section className="ct-figure" aria-label={copy.FIGURE_LABEL}>
      <p className="ct-fig">
        <span className="ct-fig-n" aria-hidden="true">
          {words.big}
        </span>
        <span className="ct-fig-l" aria-hidden="true">
          <span>{copy.glue(first)}</span>
          <span>{second}</span>
        </span>
        <span className="sr-only">{copy.glue(`${words.big} ${words.of} ${words.label}`)}</span>
      </p>
      <p className="ct-fig-sub">
        {under}
        {copy.SEP}
        {how}
      </p>
      {panel}
    </section>
  );
}
