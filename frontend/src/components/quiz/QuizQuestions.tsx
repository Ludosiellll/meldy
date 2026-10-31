import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { questionRows } from '../../lib/quizzes/quizModel';
import { compareWith, itemInsights, MIN_FOR_VERDICT, needsRewrite, retakesOf, secondsText, trapOf, type ItemInsight } from '../../lib/quizzes/analysis';
import PaperSelect from '../ui/PaperSelect';
import { letter, nb } from '../containers/copyImport';
import { QA_ANALYSIS, QA_PEOPLE, QA_QUESTIONS } from './copyAuthor';
import type { TestItem } from '../../types/container';
import type { QuizAnalysis, QuizAttemptRow, QuizItemStat } from '../../types/quiz';
import './quizAuthor.css';

/**
 * «Вопросы» of a quiz's stats (spec 2026-10-16 §2.3): the questions people got, the hardest first — «Вариант 2 · № 37 —
 * верно 4 из 11 (36 %)» — each with its options' picks as thin bars (the key said in words, «ключ», beside its green
 * bar: never colour alone), the most common wrong short answers, and «Изменить», which opens it in «Вопросы и ключи».
 * The author's own attempts are not counted (quiz_results leaves them out of `items`).
 *
 * Release 49 (quiz_analysis, lib/quizzes/analysis.ts): how well each question tells those who know from those who do
 * not, in words and with «этот вопрос стоит переписать» (from MIN_FOR_VERDICT attempts; under that the page says when
 * it will tell), the trap option (its bar says «ловушка»), the usual time, the retakes, and another quiz of the same
 * exam beside each question.
 */

export interface QuizQuestionsProps {
  containerId: string;
  stats: readonly QuizItemStat[];
  /** The exam's questions (useContainerData): text, options, key, number in the file. */
  items: ReadonlyMap<string, TestItem>;
  subjects: ReadonlyArray<{ id: string; title: string }>;
  /** quiz_analysis; null while it is read or when nobody has finished. */
  analysis?: QuizAnalysis | null;
  /** quiz_results' attempts, for the retakes. */
  attempts?: readonly QuizAttemptRow[];
  /** The analysis could not be read: a quiet line with «Повторить». */
  analysisFailed?: boolean;
  onAnalysisRetry?: () => void;
}

export function keysHref(containerId: string, item: Pick<TestItem, 'subject_id' | 'file_no'>): string {
  const query = new URLSearchParams({ s: item.subject_id, no: item.file_no });
  return `/exams/c/${containerId}/keys?${query.toString()}`;
}

const pct = (share: number) => Math.round(share * 100);

function VerdictLine({ insight }: { insight: ItemInsight }) {
  if (!insight.verdict) return null;
  const tone = insight.verdict === 'good' ? 'good' : insight.verdict === 'weak' ? 'weak' : 'bad';
  return (
    <p className="qa-q-verdict" data-tone={tone}>
      {QA_ANALYSIS.verdict[insight.verdict]}
      {insight.upper !== null && insight.lower !== null ? <span className="qa-q-groups"> {nb(QA_ANALYSIS.groups(pct(insight.upper), pct(insight.lower)))}</span> : null}
    </p>
  );
}

export default function QuizQuestions({ containerId, stats, items, subjects, analysis = null, attempts = [], analysisFailed = false, onAnalysisRetry }: QuizQuestionsProps) {
  const rows = useMemo(() => questionRows(stats, items), [stats, items]);
  const titles = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject.title])), [subjects]);
  const insights = useMemo(() => (analysis ? itemInsights(analysis) : new Map<string, ItemInsight>()), [analysis]);
  const retakes = useMemo(() => retakesOf(attempts), [attempts]);
  const [compareId, setCompareId] = useState('');
  const others = useMemo(() => (analysis?.others ?? []).filter((other) => other.attempts > 0), [analysis]);
  const other = others.find((entry) => entry.id === compareId) ?? null;
  const compare = useMemo(() => (analysis && other ? compareWith(analysis, other) : null), [analysis, other]);

  if (rows.length === 0) return <p className="qa-empty">{QA_QUESTIONS.empty}</p>;

  const counted = analysis?.attempts.length ?? 0;
  const numberOf = (itemId: string) => {
    const item = items.get(itemId);
    return item ? `№ ${item.file_no}` : null;
  };
  const rewrite = rows
    .filter((row) => needsRewrite(insights.get(row.itemId)?.verdict ?? null))
    .map((row) => numberOf(row.itemId))
    .filter((n): n is string => n !== null);

  return (
    <>
      <p className="qa-hint qa-hint-top">{QA_QUESTIONS.hint}</p>
      {analysis || analysisFailed ? (
        <div className="qa-insight">
          {analysisFailed && !analysis ? (
            <p className="qa-insight-line" data-muted="">
              {QA_ANALYSIS.failed}{' '}
              {onAnalysisRetry ? (
                <button type="button" className="sf-link" onClick={onAnalysisRetry}>
                  {QA_ANALYSIS.retry}
                </button>
              ) : null}
            </p>
          ) : null}
          {analysis && counted < MIN_FOR_VERDICT ? <p className="qa-insight-line" data-muted="">{nb(QA_ANALYSIS.wait(MIN_FOR_VERDICT, counted))}</p> : null}
          {analysis && counted >= MIN_FOR_VERDICT ? (
            <p className="qa-insight-line" data-muted="">
              {rewrite.length > 0 ? <strong className="qa-insight-strong">{nb(QA_ANALYSIS.rewrite(rewrite.join(', ')))} </strong> : null}
              {QA_ANALYSIS.how}
            </p>
          ) : null}
          {retakes ? <p className="qa-insight-line">{nb(QA_ANALYSIS.retakes(retakes.people, Math.round(retakes.first), Math.round(retakes.last)))}</p> : null}
          {others.length > 0 ? (
            <div className="qa-compare">
              <span className="qa-sort-label" aria-hidden="true">
                {QA_ANALYSIS.compare}
              </span>
              <PaperSelect
                ariaLabel={QA_ANALYSIS.compare}
                value={compareId}
                options={[{ value: '', label: QA_ANALYSIS.compareNone }, ...others.map((entry) => ({ value: entry.id, label: QA_ANALYSIS.compareOption(entry.title, entry.attempts) }))]}
                onChange={setCompareId}
              />
            </div>
          ) : null}
          {compare ? (
            <p className="qa-insight-line" role="status">
              {compare.common > 0 && compare.here !== null && compare.there !== null
                ? nb(QA_ANALYSIS.compareLine(compare.other.title, compare.common, pct(compare.here), pct(compare.there)))
                : QA_ANALYSIS.compareNoCommon(compare.other.title)}
            </p>
          ) : others.length > 0 ? (
            <p className="qa-insight-line" data-muted="">
              {QA_ANALYSIS.compareHint}
            </p>
          ) : null}
        </div>
      ) : null}
      <ol className="qa-qs" aria-label={QA_QUESTIONS.title}>
        {rows.map((row) => {
          const item = row.item;
          const context = item ? QA_PEOPLE.context(titles.get(item.subject_id) ?? '', item.file_no) : QA_QUESTIONS.gone;
          // per-option picks for single / multiple only (release 48: order and match have none, spec «без выбора по вариантам»)
          const choice = item && (item.kind === 'single' || item.kind === 'multiple') && item.options.length > 0;
          const scale = Math.max(1, row.answered, ...row.picks);
          const skipped = Math.max(0, row.shown - row.answered);
          const insight = insights.get(row.itemId) ?? null;
          const trap = item && choice ? trapOf({ picks: row.picks, answered: row.answered }, item) : null;
          const there = compare?.perItem.get(row.itemId) ?? null;
          return (
            <li key={row.itemId} className="qa-q" data-rewrite={needsRewrite(insight?.verdict ?? null) ? '' : undefined}>
              <p className="qa-q-line">{nb(QA_QUESTIONS.line(context, row.correct, row.shown, row.percent))}</p>
              {item ? <p className="qa-q-stem">{item.stem}</p> : null}
              {insight ? <VerdictLine insight={insight} /> : null}
              {choice ? (
                <ul className="qa-picks" aria-label={QA_QUESTIONS.picks}>
                  {item.options.map((_, index) => {
                    const n = row.picks[index] ?? 0;
                    const key = item.correct.includes(index);
                    const trapped = trap?.index === index;
                    return (
                      <li key={index} className="qa-pick" data-key={key ? '' : undefined} data-trap={trapped ? '' : undefined}>
                        <span className="qa-pick-letter">{letter(index)}</span>
                        <span className="qa-pick-track" aria-hidden="true">
                          <span className="qa-pick-bar" style={{ width: `${Math.round((n / scale) * 100)}%` }} />
                        </span>
                        <span className="qa-pick-n">{n}</span>
                        <span className="qa-pick-key">{key ? QA_QUESTIONS.keyWord : trapped ? QA_ANALYSIS.trapWord : ''}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {trap ? <p className="qa-q-note">{nb(QA_ANALYSIS.trap(letter(trap.index), trap.n, trap.answered))}</p> : null}
              {item && item.kind === 'essay' && (row.pending ?? 0) > 0 ? (
                <p className="qa-q-foot">{nb(QA_QUESTIONS.essaysWaiting(row.pending ?? 0))}</p>
              ) : null}
              {item && (item.kind === 'order' || item.kind === 'match' || item.kind === 'cloze' || item.partial) && typeof row.credit === 'number' && row.shown > 0 ? (
                <p className="qa-q-foot">{nb(QA_QUESTIONS.creditLine(row.credit, row.shown))}</p>
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
              {insight?.medianSec != null || there ? (
                <p className="qa-q-note">
                  {insight?.medianSec != null ? nb(QA_ANALYSIS.time(secondsText(insight.medianSec))) : null}
                  {insight?.medianSec != null && there ? ' ' : null}
                  {there && compare ? nb(QA_ANALYSIS.compareItem(compare.other.title, pct(there.share), there.shown)) : null}
                </p>
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
