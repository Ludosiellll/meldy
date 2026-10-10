import { useMemo } from 'react';
import { EXAM_TITLE, FIGURE, ORAL_SHEET_ROW, START_LABEL, SUBJECTS, exampleWords, localToday, subjectRow } from '../../data/containerExample';

/**
 * The example exam's page on the landing (data/containerExample.ts): «Осенняя сессия» — its meta line, today's step
 * with the blue pill, the figure that counts only answers right on two different days, and its five subjects as rows
 * of one card, the oral one with its cheat sheet. The exam page's own words; the dates move with the calendar (the exam
 * is always 18 days ahead). A picture of the app: a short description says the same for a screen reader.
 */
export default function HomeExam() {
  const words = useMemo(() => exampleWords(localToday()), []);
  const description = `Пример экзамена «${EXAM_TITLE}»: ${words.meta}. ${words.planTitle}. ${FIGURE.big} ${FIGURE.of} — ${FIGURE.label}.`;
  return (
    <figure className="hx">
      <figcaption className="sr-only">{description}</figcaption>
      <div className="hx-pic" aria-hidden="true">
        <p className="hx-h">{EXAM_TITLE}</p>
        <p className="hx-meta">{words.meta}</p>
        <div className="hx-plan">
          <p className="hx-plan-t">{words.planTitle}</p>
          <p className="hx-plan-d">{words.planDetail}</p>
          <span className="hx-pill">
            {START_LABEL}
            <span className="hx-pill-dot">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </span>
        </div>
        <div className="hx-fig">
          <p className="hx-fig-n">
            <b>{FIGURE.big}</b>
            <span>{`${FIGURE.of} — ${FIGURE.label}`}</span>
          </p>
          <p className="hx-fig-u">{FIGURE.under}</p>
        </div>
        <ul className="hx-rows">
          {SUBJECTS.map((subject) => (
            <li key={subject.title} data-oral={subject.oral ? '' : undefined}>
              <b>{subject.title}</b>
              <span>{subjectRow(subject)}</span>
              {subject.oral ? <span className="hx-sheet">{ORAL_SHEET_ROW}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
