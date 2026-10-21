import { useId, useState } from 'react';
import { QUICK } from './copyQuick';
import type { QuickQuestion } from './quickModel';

const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'];

/** One question as it will be in the контрольная: a variant pressed becomes the right one. */
function QuestionCard({ question, onTap }: { question: QuickQuestion; onTap: (question: QuickQuestion, index: number) => void }) {
  const headId = useId();
  const kind = question.kind === 'none' ? null : QUICK.kinds[question.kind];
  return (
    <li className="qk-q" data-state={question.state} aria-labelledby={headId}>
      <p className="qk-q-top" id={headId}>
        <span className="qk-q-no">{QUICK.number(question.number)}</span>
        {kind ? <span className="qk-q-kind">{kind}</span> : null}
      </p>
      {question.state === 'no_key' ? <p className="qk-q-ask">{QUICK.tapRight}</p> : null}
      <p className="qk-q-stem">{question.stem}</p>
      {question.kind === 'short' ? (
        <p className="qk-q-short">{QUICK.shortAnswer(question.answers)}</p>
      ) : question.state === 'blocked' ? (
        <p className="qk-q-blocked">{QUICK.blocked}</p>
      ) : (
        <ul className="qk-opts" role="list">
          {question.options.map((option, index) => {
            const right = question.correct.includes(index);
            return (
              <li key={index}>
                <button
                  type="button"
                  className="qk-opt"
                  aria-pressed={right}
                  onClick={() => onTap(question, index)}
                >
                  <span className="qk-opt-l" aria-hidden="true">
                    {LETTERS[index] ?? index + 1}
                  </span>
                  <span className="qk-opt-t">{option}</span>
                  {right ? <span className="qk-opt-ok">{QUICK.right}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export interface QuickPreviewProps {
  questions: QuickQuestion[];
  /** The text is empty: what to do first. */
  empty: boolean;
  reading: boolean;
  failed: boolean;
  skipped: string[];
  /** Where the questions stand: beside the text on a computer, below it on a phone. */
  side: 'right' | 'below';
  onTap: (question: QuickQuestion, index: number) => void;
  onRetry: () => void;
}

/**
 * The questions found in the pasted text («Нашли 4 вопроса»): a card each, as the контрольная will have it. A question
 * without its answer stands out and asks for a tap on the right variant; one that cannot be saved says what to add. The
 * lines that are not questions are counted, and shown on request.
 */
export default function QuickPreview({ questions, empty, reading, failed, skipped, side, onTap, onRetry }: QuickPreviewProps) {
  const headId = useId();
  const [showSkipped, setShowSkipped] = useState(false);
  const missing = questions.filter((question) => question.state !== 'ok').length;
  let body;
  if (failed && questions.length === 0) {
    body = (
      <p className="qk-found-note" role="alert">
        {QUICK.readFailed}{' '}
        <button type="button" className="sf-link" onClick={onRetry}>
          {QUICK.retry}
        </button>
      </p>
    );
  } else if (questions.length === 0) {
    body = (
      <>
        <p className="qk-found-note">{empty ? QUICK.waiting(side) : reading ? QUICK.reading : QUICK.nothing}</p>
        {empty ? (
          <div className="qk-ghosts" aria-hidden="true">
            {[1, 0].map((right) => (
              <div key={right} className="qk-ghost">
                <i />
                <i />
                {[0, 1, 2].map((at) => (
                  <b key={at} data-right={at === right ? '' : undefined} />
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </>
    );
  } else {
    body = (
      <ol className="qk-qs" aria-labelledby={headId}>
        {questions.map((question) => (
          <QuestionCard key={question.key} question={question} onTap={onTap} />
        ))}
      </ol>
    );
  }
  return (
    <section className="qk-card qk-found" aria-labelledby={headId} aria-busy={reading || undefined}>
      <div className="qk-found-head">
        <h2 className="qk-h2" id={headId}>
          {QUICK.found(questions.length)}
        </h2>
        {missing > 0 ? <p className="qk-badge">{QUICK.noKey(missing)}</p> : null}
        {reading && questions.length > 0 ? (
          <p className="qk-reading" role="status">
            {QUICK.reading}
          </p>
        ) : null}
      </div>
      {failed && questions.length > 0 ? (
        <p className="qk-found-note" role="alert">
          {QUICK.readFailed}{' '}
          <button type="button" className="sf-link" onClick={onRetry}>
            {QUICK.retry}
          </button>
        </p>
      ) : null}
      {body}
      {skipped.length > 0 && questions.length > 0 ? (
        <div className="qk-skipped">
          <p>
            {QUICK.skipped(skipped.length)}{' '}
            <button type="button" className="sf-link" aria-expanded={showSkipped} onClick={() => setShowSkipped((open) => !open)}>
              {showSkipped ? QUICK.skippedHide : QUICK.skippedShow}
            </button>
          </p>
          {showSkipped ? (
            <ul>
              {skipped.map((line, at) => (
                <li key={at}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
