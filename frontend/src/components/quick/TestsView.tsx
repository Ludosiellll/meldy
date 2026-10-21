import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { listQuizzes } from '../../api/quizzes';
import { quizStateWords } from '../../lib/quizzes/quizModel';
import type { OverviewContainer } from '../../types/container';
import type { QuizListRow } from '../../types/quiz';
import { nb } from '../containers/copyImport';
import { LIVE_ENTRY, keyCounts, liveGameOpen, liveGamePath, liveGameWhy } from '../test/gameEntry';
import { TESTS_VIEW } from './copyQuick';
import { QUICK_PATH, quickLinkPath } from './paths';
import './tests.css';

/** The контрольные a test row shows; the rest are on the test's page. */
export const ROW_QUIZZES = 2;

type Quizzes = Record<string, QuizListRow[] | 'failed'>;

/** The two ways to make a test, each with one line of what it makes (mockup m1): the quick one is the blue pill. */
export function TestDoors() {
  return (
    <div className="ex-draw tv-doors" data-pair="">
      <div className="tb-door">
        <Link className="sf-primary tv-quick" to={QUICK_PATH} aria-describedby="tv-door-quick">
          {TESTS_VIEW.quick}
        </Link>
        <p id="tv-door-quick" className="tb-door-note">
          {TESTS_VIEW.quickNote}
        </p>
      </div>
      <div className="tb-door">
        <Link className="ex-secondary ex-new" to="/tests/new" aria-describedby="tv-door-studio">
          {TESTS_VIEW.studio}
          <span className="ex-new-dot" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
        </Link>
        <p id="tv-door-studio" className="tb-door-note">
          {TESTS_VIEW.studioNote}
        </p>
      </div>
    </div>
  );
}

function QuizLine({ row, containerId }: { row: QuizListRow; containerId: string }) {
  const stats = `/exams/c/${encodeURIComponent(containerId)}/quizzes/${encodeURIComponent(row.id)}`;
  return (
    <li className="tv-quiz" data-state={row.state}>
      <div className="tv-quiz-text">
        <Link className="tv-quiz-t" to={stats}>
          {row.title}
        </Link>
        <p className="tv-quiz-m">
          <span className="tv-state" data-state={row.state}>
            {nb(quizStateWords(row))}
          </span>
          {row.writing > 0 ? <span>{TESTS_VIEW.writing(row.writing)}</span> : null}
          <span>{TESTS_VIEW.finished(row.finished)}</span>
        </p>
      </div>
      <div className="tv-quiz-acts">
        {row.state === 'closed' ? null : (
          <Link className="tv-pill" to={quickLinkPath(containerId, row.id)}>
            {TESTS_VIEW.link}
          </Link>
        )}
        <Link className="tv-pill" to={stats}>
          {TESTS_VIEW.results}
        </Link>
      </div>
    </li>
  );
}

/**
 * «Провести игру» for one test, by the test's page's rule (test/gameEntry): a link to the game's setup, or shut with the
 * page's reason under the card while no question has its key; nothing while the game is shut for everyone.
 */
function GameAction({ test }: { test: OverviewContainer }) {
  const whyId = useId();
  if (!liveGameOpen()) return null;
  const why = liveGameWhy(keyCounts(test.subjects));
  if (!why) {
    return (
      <Link className="tv-pill tv-game" to={liveGamePath(test.id)}>
        {LIVE_ENTRY.host}
      </Link>
    );
  }
  return (
    <>
      <button type="button" className="tv-pill tv-game" disabled aria-describedby={whyId}>
        {LIVE_ENTRY.host}
      </button>
      <span id={whyId} className="tv-why">
        {nb(why)}
      </span>
    </>
  );
}

function TestCard({ test, quizzes, onRetry }: { test: OverviewContainer; quizzes: QuizListRow[] | 'failed' | undefined; onRetry: () => void }) {
  const page = `/exams/c/${encodeURIComponent(test.id)}`;
  const rows = Array.isArray(quizzes) ? quizzes : null;
  const meta = TESTS_VIEW.meta(test.items, rows ? rows.length : null);
  // The test's own actions: «Отправить по ссылке» while nothing is sent, and «Провести игру» (after the read, so the row
  // does not jump when the контрольные arrive).
  const game = quizzes === undefined ? null : <GameAction test={test} />;
  let body;
  if (quizzes === 'failed') {
    body = (
      <p className="tv-note" role="alert">
        {TESTS_VIEW.failed}{' '}
        <button type="button" className="sf-link" onClick={onRetry}>
          {TESTS_VIEW.retry}
        </button>
      </p>
    );
  } else if (!rows) {
    body = <p className="tv-note">{TESTS_VIEW.loading}</p>;
  } else if (rows.length === 0) {
    body = (
      <div className="tv-none">
        <p className="tv-note">{TESTS_VIEW.notSent}</p>
        <div className="tv-acts">
          {test.items > 0 ? (
            <Link className="tv-pill" to={`${page}/quizzes/new?all=1&design=1`}>
              {TESTS_VIEW.send}
            </Link>
          ) : null}
          {game}
        </div>
      </div>
    );
  } else {
    const shown = rows.slice(0, ROW_QUIZZES);
    body = (
      <>
        <ul className="tv-quizzes">
          {shown.map((row) => (
            <QuizLine key={row.id} row={row} containerId={test.id} />
          ))}
        </ul>
        <div className="tv-foot">
          {rows.length > shown.length ? (
            <p className="tv-more">
              <Link className="sf-link" to={page}>
                {TESTS_VIEW.more(rows.length - shown.length)}
              </Link>
            </p>
          ) : null}
          <div className="tv-acts">{game}</div>
        </div>
      </>
    );
  }
  return (
    <li className="tv-card">
      <h2 className="tv-card-t">
        <Link to={page}>{test.title}</Link>
      </h2>
      <p className="tv-tags">
        {meta.map((tag) => (
          <span key={tag} className="tv-tag">
            {tag}
          </span>
        ))}
      </p>
      {body}
      {quizzes === 'failed' ? <div className="tv-foot tv-acts">{game}</div> : null}
    </li>
  );
}

/**
 * «Тесты» on «Экзамены» (UX audit of 21.10, P2; mockups m1, m4): what a контрольная is in one line, the two ways to
 * make a test («Быстрая контрольная» first), then the author's tests as cards, each with its latest контрольные — their
 * state, how many write and finished, «Показать ссылку» (the link with its QR code) and «Открыть результаты» — or
 * «Отправить по ссылке» while it has none.
 */
export default function TestsView({ tests }: { tests: OverviewContainer[] }) {
  const [quizzes, setQuizzes] = useState<Quizzes>({});
  const ids = tests.map((test) => test.id).join(',');
  const load = useCallback((id: string) => {
    listQuizzes(id).then(
      (rows) => setQuizzes((current) => ({ ...current, [id]: rows })),
      () => setQuizzes((current) => ({ ...current, [id]: 'failed' })),
    );
  }, []);
  useEffect(() => {
    if (!ids) return;
    for (const id of ids.split(',')) load(id);
  }, [ids, load]);

  return (
    <section className="tv" data-guide-chapter="tests" aria-label={TESTS_VIEW.title}>
      {tests.length === 0 ? (
        <p className="tv-empty">{TESTS_VIEW.empty}</p>
      ) : (
        <ul className="tv-list" aria-label={TESTS_VIEW.listLabel}>
          {tests.map((test) => (
            <TestCard key={test.id} test={test} quizzes={quizzes[test.id]} onRetry={() => load(test.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** «Экзамены 3 | Тесты 2»: which list the page shows. */
export function ViewSwitch({
  view,
  exams,
  tests,
  onChange,
}: {
  view: 'exams' | 'tests';
  /** null — not read yet. */
  exams: number | null;
  tests: number;
  onChange: (view: 'exams' | 'tests') => void;
}) {
  return (
    <div className="tv-switch" role="group" aria-label={TESTS_VIEW.switchLabel}>
      {(['exams', 'tests'] as const).map((name) => (
        <button key={name} type="button" className="tv-switch-b" aria-pressed={view === name} onClick={() => onChange(name)}>
          {name === 'exams' ? TESTS_VIEW.exams : TESTS_VIEW.tests}{' '}
          {name === 'tests' || exams !== null ? <span className="tv-switch-n">{name === 'exams' ? exams : tests}</span> : null}
        </button>
      ))}
    </div>
  );
}
