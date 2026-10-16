import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { questionRows } from '../../lib/quizzes/quizModel';
import { letter, nb } from '../containers/copyImport';
import { QA_PEOPLE, QA_QUESTIONS } from './copyAuthor';
import type { TestItem } from '../../types/container';
import type { QuizItemStat } from '../../types/quiz';
import './quizAuthor.css';

/**
 * «Вопросы» of a quiz's stats (spec 2026-10-16 §2.3): the questions people got, the hardest first — «Вариант 2 · № 37 —
 * верно 4 из 11 (36 %)» — each with its options' picks as thin bars (the key said in words, «ключ», beside its green
 * bar: never colour alone), the most common wrong short answers, and «Изменить», which opens it in «Вопросы и ключи».
 * The author's own attempts are not counted (quiz_results leaves them out of `items`).
 */

export interface QuizQuestionsProps {
  containerId: string;
  stats: readonly QuizItemStat[];
  /** The exam's questions (useContainerData): text, options, key, number in the file. */
  items: ReadonlyMap<string, TestItem>;
  subjects: ReadonlyArray<{ id: string; title: string }>;
}

export function keysHref(containerId: string, item: Pick<TestItem, 'subject_id' | 'file_no'>): string {
  const query = new URLSearchParams({ s: item.subject_id, no: item.file_no });
  return `/exams/c/${containerId}/keys?${query.toString()}`;
}

export default function QuizQuestions({ containerId, stats, items, subjects }: QuizQuestionsProps) {
  const rows = useMemo(() => questionRows(stats, items), [stats, items]);
  const titles = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject.title])), [subjects]);

  if (rows.length === 0) return <p className="qa-empty">{QA_QUESTIONS.empty}</p>;

  return (
    <>
      <p className="qa-hint qa-hint-top">{QA_QUESTIONS.hint}</p>
      <ol className="qa-qs" aria-label={QA_QUESTIONS.title}>
        {rows.map((row) => {
          const item = row.item;
          const context = item ? QA_PEOPLE.context(titles.get(item.subject_id) ?? '', item.file_no) : QA_QUESTIONS.gone;
          const choice = item && item.kind !== 'short' && item.options.length > 0;
          const scale = Math.max(1, row.answered, ...row.picks);
          const skipped = Math.max(0, row.shown - row.answered);
          return (
            <li key={row.itemId} className="qa-q">
              <p className="qa-q-line">{nb(QA_QUESTIONS.line(context, row.correct, row.shown, row.percent))}</p>
              {item ? <p className="qa-q-stem">{item.stem}</p> : null}
              {choice ? (
                <ul className="qa-picks" aria-label={QA_QUESTIONS.picks}>
                  {item.options.map((_, index) => {
                    const n = row.picks[index] ?? 0;
                    const key = item.correct.includes(index);
                    return (
                      <li key={index} className="qa-pick" data-key={key ? '' : undefined}>
                        <span className="qa-pick-letter">{letter(index)}</span>
                        <span className="qa-pick-track" aria-hidden="true">
                          <span className="qa-pick-bar" style={{ width: `${Math.round((n / scale) * 100)}%` }} />
                        </span>
                        <span className="qa-pick-n">{n}</span>
                        <span className="qa-pick-key">{key ? QA_QUESTIONS.keyWord : ''}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {row.wrongTexts.length > 0 ? (
                <div className="qa-wrong">
                  <p className="qa-wrong-h">{QA_QUESTIONS.wrongTexts}</p>
                  <ul className="qa-wrong-list">
                    {row.wrongTexts.slice(0, 3).map((entry) => (
                      <li key={entry.text}>{QA_QUESTIONS.wrongText(entry.text, entry.n)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="qa-q-foot">
                {skipped > 0 ? <span className="qa-q-skip">{nb(QA_QUESTIONS.noAnswer(skipped))}</span> : null}
                {item ? (
                  <Link className="sf-link" to={keysHref(containerId, item)}>
                    {QA_QUESTIONS.edit}
                  </Link>
                ) : null}
              </p>
            </li>
          );
        })}
      </ol>
    </>
  );
}
