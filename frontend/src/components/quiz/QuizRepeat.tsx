import { useMemo, useRef, useState } from 'react';
import { sendAllMistakes } from '../../api/quizzes';
import { repeatRows } from '../../lib/quizzes/analysis';
import { errorText, nb } from '../containers/copyImport';
import { QA_ANALYSIS, QA_ERRORS, QA_REPEAT } from './copyAuthor';
import type { TestItem } from '../../types/container';
import type { MistakesSent, QuizAnalysis, QuizAttemptRow } from '../../types/quiz';
import './quizAuthor.css';

/**
 * «Повторить» of a quiz's stats (release 49, spec «Выпуск 49»: «кому что повторить — и одной кнопкой отправить каждому
 * его ошибки в тренировку»). A row a person (their latest finished attempt): the questions not fully right by their
 * numbers, «в тренировке» once they went, «без входа» / «не в экзамене» for those the button cannot reach. The button
 * (quiz_send_mistakes) puts each member's mistakes into their own repetition through the study core, 50 people a call
 * with «Отправляем: 100 из 300…» meanwhile; a second press writes nothing; a question the person has answered in
 * training since the attempt is left as it is (said). Guests have no training: the page says so, and what people outside
 * the exam can do instead.
 */

export interface QuizRepeatProps {
  quizId: string;
  analysis: QuizAnalysis | null;
  analysisFailed: boolean;
  attempts: readonly QuizAttemptRow[];
  items: ReadonlyMap<string, TestItem>;
  /** A test (containers.kind 'test'): «не в тесте». */
  ofTest: boolean;
  /** The quiz offers «Тренировать эти вопросы» after it closes. */
  practice: boolean;
  onSent: () => void;
  onRetry: () => void;
}

export default function QuizRepeat({ quizId, analysis, analysisFailed, attempts, items, ofTest, practice, onSent, onRetry }: QuizRepeatProps) {
  const rows = useMemo(() => (analysis ? repeatRows(analysis, attempts) : []), [analysis, attempts]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<MistakesSent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  if (!analysis) {
    if (analysisFailed) {
      return (
        <p className="qa-empty">
          {QA_ANALYSIS.failed}{' '}
          <button type="button" className="sf-link" onClick={onRetry}>
            {QA_ANALYSIS.retry}
          </button>
        </p>
      );
    }
    return <p className="qa-empty">{attempts.some((a) => !a.own && a.finished_at) ? QA_ANALYSIS.loading : QA_REPEAT.empty}</p>;
  }
  if (rows.length === 0) return <p className="qa-empty">{QA_REPEAT.empty}</p>;

  const numbers = (ids: readonly string[]) =>
    ids
      .map((id) => items.get(id))
      .filter((item): item is TestItem => Boolean(item))
      .map((item) => `№ ${item.file_no}`)
      .join(', ');
  const members = rows.filter((row) => row.who === 'member');
  const guests = rows.filter((row) => row.who === 'guest').length;
  const outside = rows.filter((row) => row.who === 'outside').length;
  const anyToSend = members.some((row) => row.items.length > 0);

  const send = async () => {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const sent = await sendAllMistakes(quizId, (done, total) => setProgress({ done, total }));
      setResult(sent);
    } catch (failure) {
      setError(errorText(failure, QA_ERRORS, QA_REPEAT.failed));
    } finally {
      busy.current = false;
      setSending(false);
      setProgress(null);
      // what went before a failure went for good: the marks read again either way
      onSent();
    }
  };

  const resultLine = result
    ? result.answers > 0
      ? QA_REPEAT.done(result.people, result.answers)
      : result.again > 0
        ? QA_REPEAT.nothingNew
        : QA_REPEAT.nothing
    : null;

  return (
    <div className="qa-repeat-wrap">
      <p className="qa-hint qa-hint-top">{QA_REPEAT.hint}</p>
      {members.length > 0 ? (
        <section className="qa-send" aria-label={QA_REPEAT.send}>
          <button type="button" className="qa-send-b" disabled={sending || !anyToSend} onClick={() => void send()}>
            {sending ? QA_REPEAT.sending : QA_REPEAT.send}
          </button>
          <p className="qa-hint">{anyToSend ? QA_REPEAT.sendHow(ofTest) : QA_REPEAT.nothing}</p>
          <p className="qa-send-line" role="status" data-muted={progress ? '' : undefined}>
            {progress ? nb(QA_REPEAT.progress(progress.done, progress.total)) : resultLine ? nb(resultLine) : ''}
          </p>
          {result && result.learned > 0 ? <p className="qa-hint">{nb(QA_REPEAT.learned(result.learned))}</p> : null}
          {error ? (
            <p className="qa-line" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
      {guests > 0 ? <p className="qa-hint">{nb(QA_REPEAT.guests(guests))}</p> : null}
      {outside > 0 ? <p className="qa-hint">{nb(practice ? QA_REPEAT.outsidePractice(outside, ofTest) : QA_REPEAT.outsideNoPractice(outside, ofTest))}</p> : null}
      <h2 className="qa-repeat-h">{QA_REPEAT.title}</h2>
      <ul className="qa-repeat" aria-label={QA_REPEAT.title}>
        {rows.map((row) => {
          const list = numbers(row.items);
          return (
            <li key={row.person} className="qa-rep" data-done={row.items.length === 0 ? '' : undefined}>
              <span className="qa-rep-name">
                {row.name}
                {row.who === 'guest' ? (
                  <>
                    {' '}
                    <span className="qa-guest">{QA_REPEAT.guest}</span>
                  </>
                ) : row.who === 'outside' ? (
                  <>
                    {' '}
                    <span className="qa-guest">{QA_REPEAT.outside(ofTest)}</span>
                  </>
                ) : null}
              </span>
              <span className="qa-rep-items">
                {row.items.length === 0 ? QA_REPEAT.allRight : nb(`${QA_REPEAT.count(row.items.length)}: ${list}`)}
              </span>
              {row.sent && row.items.length > 0 ? <span className="qa-rep-sent">{QA_REPEAT.sent}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
