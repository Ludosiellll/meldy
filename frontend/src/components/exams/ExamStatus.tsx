import { forwardRef, type ReactNode } from 'react';
import { glue } from './sheetModel';
import { useShownAfter } from './SheetSummary';
import type { ExamStatus } from './examStatus';

/** A quiet line under the status: what a run left behind, a journal that did not load (with «Повторить»). */
export interface StatusNote {
  key: string;
  text: string;
  action?: { label: string; run: () => void };
  /** Heard by a screen reader when it appears. */
  live?: boolean;
}

interface ExamStatusCardProps {
  status: ExamStatus;
  /** The block's own id: the heading is `${id}-t`. */
  id: string;
  /** The action and the quiet link beside it: the page renders them (they need its handlers and its menu). */
  actions?: ReactNode;
  notes?: StatusNote[];
  /** A phone: the heading and one line (`status.brief`), the flag left out (10_Project/Phone_Declutter_2026-10-08). */
  brief?: boolean;
}

/**
 * The status block at the top of the exam page (components/exams/examStatus.ts picks it): a flag with the step
 * of the way, the headline — what Meldy did or found, its key words kept on one line — one or two sentences, and the
 * one action. The headline is a live region: a screen reader hears the new state
 * (a mapping that ended, a sheet written), not every number of a run going on.
 */
const ExamStatusCard = forwardRef<HTMLHeadingElement, ExamStatusCardProps>(function ExamStatusCard({ status, id, actions, notes = [], brief = false }, headingRef) {
  const loading = status.key === 'loading';
  // The first 300 ms show nothing: a quick read does not flash a word that is gone at once.
  const showLoading = useShownAfter(loading);
  const { lead, mark, tail } = status.title;
  const text = brief ? status.brief ?? status.text : status.text;
  return (
    <section
      className="ex-st"
      id={id}
      data-tone={status.tone}
      data-state={status.key}
      data-brief={brief ? '' : undefined}
      aria-labelledby={loading ? undefined : `${id}-t`}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <>
          <p className="ex-st-wait" role="status">
            {showLoading ? 'Загружаем темы и ответы…' : ''}
          </p>
          {actions ? <div className="ex-st-acts">{actions}</div> : null}
        </>
      ) : (
        <>
          {brief ? null : <p className="ex-st-flag">{status.flag}</p>}
          <div className="ex-st-body">
            <h2 className="ex-st-title" id={`${id}-t`} ref={headingRef} tabIndex={-1} aria-live="polite" aria-atomic="true">
              {glue(lead)}
              {mark ? <span className="ex-st-mark">{glue(mark)}</span> : null}
              {glue(tail)}
            </h2>
            {text ? <p className="ex-st-text">{glue(text)}</p> : null}
            {status.blocked ? (
              <p className="ex-st-blocked" role="status">
                {glue(status.blocked)}
              </p>
            ) : null}
            {notes.map((note) => (
              <p key={note.key} className="ex-st-note" role={note.live ? 'status' : undefined}>
                {glue(note.text)}
                {note.action ? (
                  <>
                    {' '}
                    <button type="button" className="sf-link" onClick={note.action.run}>
                      {note.action.label}
                    </button>
                  </>
                ) : null}
              </p>
            ))}
          </div>
          {actions ? <div className="ex-st-acts">{actions}</div> : null}
        </>
      )}
    </section>
  );
});

export default ExamStatusCard;
