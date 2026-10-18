import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { listQuizzes } from '../../api/quizzes';
import { useContainerData } from '../../lib/containers/hooks';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { quizStateWords } from '../../lib/quizzes/quizModel';
import { useFrame } from '../../components/exams/useFrame';
import { errorText, GONE, nb } from '../../components/containers/copyImport';
import { TO_EXAMS } from '../../components/containers/copy';
import { QA_LIST } from '../../components/quiz/copyAuthor';
import type { QuizListRow } from '../../types/quiz';
import type { Uuid } from '../../types/container';
import '../../components/exams/exams.css';
import '../../components/quiz/quizAuthor.css';

/**
 * /exams/c/:id/quizzes — «Контрольные» of an exam (spec 2026-10-16 §2.1): the author's quizzes, newest first, each a
 * row of one card (its name, its state, «пишут N · сдали M · средний X %») that opens its stats; «Новая контрольная» is
 * the page's one blue pill. A member of the exam sees one line: quizzes are the author's. A test's list (its summary's
 * kind 'test') names the test in its words.
 */
export default function QuizListPage() {
  const params = useParams();
  const containerId = (params.id ?? '') as Uuid;
  const frame = useFrame<HTMLDivElement>();
  const data = useContainerData(containerId);
  const summary = data.data?.summary ?? null;
  const owner = summary?.role === 'owner';
  // A test's quizzes (containers.kind 'test', release 47.3): the words name the test.
  const ofTest = summary?.kind === 'test';
  useDocumentTitle(summary ? `${QA_LIST.title} · ${summary.title}` : QA_LIST.title);
  useEffect(() => {
    if (summary) rememberContainerTitle(summary.id, summary.title);
  }, [summary]);

  const [rows, setRows] = useState<QuizListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!containerId) return;
    setError(null);
    listQuizzes(containerId).then(
      (list) => setRows(list),
      (failure: unknown) => setError(errorText(failure, undefined, QA_LIST.loadFailed)),
    );
  }, [containerId]);
  useEffect(() => {
    if (owner) load();
  }, [owner, load]);

  const header = (
    <header className="ex-head qa-head">
      <div style={{ minWidth: 0 }}>
        {summary ? (
          <p className="ex-crumb">
            <Link to={`/exams/c/${containerId}`}>{summary.title}</Link>
          </p>
        ) : null}
        <h1 className="ex-h1">{QA_LIST.title}</h1>
      </div>
    </header>
  );

  const shell = (children: ReactNode) => (
    <div className="sf-page qa-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      {children}
    </div>
  );

  if (!summary) {
    if (data.loading) {
      return shell(
        <p className="qa-wait" role="status">
          {QA_LIST.loading}
        </p>,
      );
    }
    return shell(
      data.gone ? (
        <p className="ex-note">
          {GONE.title}. {GONE.text}{' '}
          <Link className="sf-link" to="/exams">
            {TO_EXAMS}
          </Link>
        </p>
      ) : (
        <p className="ex-note" role="alert">
          {data.error && /[а-яё]/i.test(data.error) ? data.error : QA_LIST.loadFailed}{' '}
          <button type="button" className="sf-link" onClick={data.reload}>
            {QA_LIST.retry}
          </button>
        </p>
      ),
    );
  }

  if (!owner) {
    return shell(
      <>
        <p className="qa-lede">{ofTest ? QA_LIST.authorOnlyTest : QA_LIST.authorOnly}</p>
        <p>
          <Link className="sf-link" to={`/exams/c/${containerId}`}>
            {ofTest ? QA_LIST.toTest : QA_LIST.toExam}
          </Link>
        </p>
      </>,
    );
  }

  const newHref = `/exams/c/${containerId}/quizzes/new`;
  return (
    <div className="sf-page qa-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      <div className="qa-body">
        {error ? (
          <p className="ex-note" role="alert">
            {error}{' '}
            <button type="button" className="sf-link" onClick={load}>
              {QA_LIST.retry}
            </button>
          </p>
        ) : rows === null ? (
          <p className="qa-wait" role="status">
            {QA_LIST.loading}
          </p>
        ) : rows.length === 0 ? (
          <p className="qa-lede">{ofTest ? QA_LIST.emptyTest : QA_LIST.empty}</p>
        ) : (
          <ul className="qa-rows" aria-label={QA_LIST.title}>
            {rows.map((row) => (
              <li key={row.id}>
                <Link className="qa-row" to={`/exams/c/${containerId}/quizzes/${row.id}`} data-state={row.state}>
                  <span className="qa-row-title">{row.title}</span>
                  <span className="qa-row-meta">{nb(`${quizStateWords(row)} · ${QA_LIST.meta(row.item_count, row.time_limit_s)}`)}</span>
                  <span className="qa-row-counts">{nb(QA_LIST.counts(row.writing, row.finished, row.avg_percent, row.people > 0))}</span>
                  <svg className="qa-row-go" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ex-cta qa-cta" data-row={frame.side ? '' : undefined}>
        <Link className="sf-primary" to={newHref}>
          {QA_LIST.newQuiz}
        </Link>
      </div>
    </div>
  );
}
