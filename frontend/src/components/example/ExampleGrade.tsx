import { useId, useState, type ReactNode } from 'react';
import { HowGraded } from '../oral/OralProtocol';
import { countsSentence, gradeWord, type GradeResult } from '../../lib/oral/oralGrade';
import { glue } from '../../lib/oral/format';

/** The example's one honest line under the grade (the owner's brief, word for word). */
export const EXAMPLE_GRADE_NOTE =
  'В примере ответ проверяется по ключевым словам на этом устройстве. В вашем экзамене его проверяет ИИ по пунктам из ваших лекций.';

/**
 * The grade on the example's desk: the markup of the real protocol's grade card
 * (components/oral/OralProtocol.tsx ProtocolGrade, copied: its fine line speaks of «ваших лекций»,
 * which the example's lectures are not) — «Оценка», the digit and its word, the counts in a sentence,
 * «Как считается» with the app's own formula, and the example's honest line in place of that note.
 */
export default function ExampleGrade({ result, children }: { result: GradeResult; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const howId = useId();
  const word = gradeWord(result.grade);
  return (
    <div className="or-grade">
      <p className="or-grade-label" aria-hidden="true">
        Оценка
      </p>
      <p className="or-grade-g">
        <span className="sr-only">{word ? `Оценка ${result.grade} · ${word}` : 'Оценки нет'}</span>
        <span className="or-grade-digit" aria-hidden="true">
          {result.grade ?? '—'}
        </span>
        {word ? (
          <span className="or-grade-word" aria-hidden="true" data-long={word.length > 8 ? '' : undefined}>
            {word}
          </span>
        ) : null}
      </p>
      <p className="or-grade-why">{glue(countsSentence(result.counts))}</p>
      <p className="or-how-row">
        <button type="button" className="sf-link" aria-expanded={open} aria-controls={howId} onClick={() => setOpen((value) => !value)}>
          Как считается
        </button>
      </p>
      {open ? (
        <div id={howId}>
          <HowGraded result={result} />
        </div>
      ) : null}
      <p className="or-grade-fine tx-grade-note">{EXAMPLE_GRADE_NOTE}</p>
      {children}
    </div>
  );
}
