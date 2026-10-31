import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useUrlState } from '../../lib/urlState';
import { closeQuiz, deleteQuiz, quizMarks, quizResults } from '../../api/quizzes';
import { copyText } from '../../lib/clipboard';
import { useContainerData } from '../../lib/containers/hooks';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { clockOffset, csvOf, peopleRows, quizStateWords, statsSubjects, summaryOf } from '../../lib/quizzes/quizModel';
import { useFrame } from '../../components/exams/useFrame';
import { errorText, GONE, nb } from '../../components/containers/copyImport';
import { TO_EXAMS } from '../../components/containers/copy';
import { useFocusAfter } from '../../components/containers/useFocusAfter';
import QuizPeople from '../../components/quiz/QuizPeople';
import QuizQuestions from '../../components/quiz/QuizQuestions';
import QuizShare from '../../components/quiz/QuizShare';
import QuizRepeat from '../../components/quiz/QuizRepeat';
import QuizTelegram from '../../components/quiz/QuizTelegram';
import { analysisStamp, useQuizAnalysis } from '../../components/quiz/useQuizAnalysis';
import { fastSigns } from '../../lib/quizzes/analysis';
import { QA_ERRORS, QA_LIST, QA_STATS } from '../../components/quiz/copyAuthor';
import { QUIZ } from '../../components/quiz/copyQuiz';
import type { TestItem, Uuid } from '../../types/container';
import type { QuizResults } from '../../types/quiz';
import '../../components/exams/exams.css';
import '../../components/containers/import/import.css';
import '../../components/quiz/quizAuthor.css';

/**
 * /exams/c/:id/quizzes/:quizId — the author's stats of a «Контрольная» (spec 2026-10-16 §2.3): the head (name, state,
 * the link /k/<code> with «Скопировать», «Показать QR», «Поделиться», «Открыть как ученик» (QuizShare), «Изменить
 * настройки», «Закрыть сейчас», «Удалить» after asking), the line of
 * totals («Пишут сейчас: 3 · Сдали: 12 · Средний результат: 71 % · Прошли порог: 9 из 12», the author's own tries left
 * out), «Участники» and «Вопросы», and «Скачать таблицу» (CSV for Excel).
 *
 * The results are polled (no realtime, spec §2.3): every 5 s while somebody writes, every 30 s otherwise, never on a
 * hidden tab (a tab that comes back reads at once), one request at a time.
 */

export const POLL_WRITING_MS = 5000;
export const POLL_IDLE_MS = 30000;

type Tab = 'people' | 'questions' | 'repeat';
const STATS_TABS: readonly Tab[] = ['people', 'questions', 'repeat'];
const TAB_WORDS: Record<Tab, string> = { people: QA_STATS.tabPeople, questions: QA_STATS.tabQuestions, repeat: QA_STATS.tabRepeat };
type Ask = 'close' | 'remove' | null;

const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
const pad = (n: number) => String(n).padStart(2, '0');
const timeOf = (ms: number) => {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** A name a file may carry on every system. */
function fileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || QUIZ.name;
}

export default function QuizStatsPage() {
  const params = useParams();
  const containerId = (params.id ?? '') as Uuid;
  const quizId = (params.quizId ?? '') as Uuid;
  const location = useLocation();
  const navigate = useNavigate();
  const frame = useFrame<HTMLDivElement>();
  const ids = useId();
  const data = useContainerData(containerId);
  const summary = data.data?.summary ?? null;
  // A test's quiz (containers.kind 'test', release 47.3): the words name the test, and its page is the way back.
  const ofTest = summary?.kind === 'test';
  useEffect(() => {
    if (summary) rememberContainerTitle(summary.id, summary.title);
  }, [summary]);
  const listPath = `/exams/c/${containerId}/quizzes`;

  // ── the results, polled ──
  const [results, setResults] = useState<QuizResults | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [failure, setFailure] = useState<{ text: string; missing: boolean } | null>(null);
  /** A poll failed after a good read: the time of that read, said in a quiet line. */
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const busy = useRef(false);
  const alive = useRef(true);
  const lastGood = useRef<number | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** A read asked for while one is out (after a reset or «Закрыть сейчас»): it goes once that one ends. */
  const again = useRef(false);
  const loadRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined);
  const load = useCallback(async (force = false) => {
    if (!quizId) return;
    if (busy.current) {
      if (force) again.current = true;
      return;
    }
    busy.current = true;
    try {
      const next = await quizResults(quizId);
      if (!alive.current) return;
      lastGood.current = Date.now();
      setResults(next);
      setOffsetMs(clockOffset(next.server_now, Date.now()));
      setFailure(null);
      setStaleSince(null);
    } catch (error) {
      if (!alive.current) return;
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'P0002') setFailure({ text: QA_STATS.notFound, missing: true });
      else if (lastGood.current === null) setFailure({ text: errorText(error, QA_ERRORS, QA_STATS.loadFailed), missing: false });
      else setStaleSince(lastGood.current);
    } finally {
      busy.current = false;
      if (alive.current) {
        if (again.current) {
          again.current = false;
          void loadRef.current();
        } else setRound((value) => value + 1);
      }
    }
  }, [quizId]);
  loadRef.current = load;

  useEffect(() => {
    void load();
  }, [load]);

  const [visible, setVisible] = useState(pageVisible);
  useEffect(() => {
    const onChange = () => {
      const now = pageVisible();
      setVisible(now);
      if (now) void load();
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [load]);
  const writing = results?.attempts.some((attempt) => !attempt.finished_at) ?? false;
  useEffect(() => {
    // The next read waits for the last one (round changes when it ends), so requests never overlap. A quiz that is
    // gone is not asked for again.
    if (!visible || round === 0 || failure?.missing) return undefined;
    const timer = window.setTimeout(() => void load(), writing ? POLL_WRITING_MS : POLL_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, writing, round, load, failure?.missing]);

  const quiz = results?.quiz ?? null;
  useDocumentTitle(quiz ? quiz.title : QA_LIST.title);
  const items: ReadonlyMap<string, TestItem> = useMemo(() => data.data?.items ?? new Map<string, TestItem>(), [data.data?.items]);
  // A test's questions are named by the test (statsSubjects), not by its subject «Вопросы» nobody named.
  const subjects = useMemo(() => statsSubjects(summary), [summary]);
  const rows = useMemo(() => (results && quiz ? peopleRows(results.attempts, quiz.grading) : []), [results, quiz]);
  const totals = useMemo(() => summaryOf(rows, quiz?.pass_percent ?? null), [rows, quiz?.pass_percent]);
  // Release 49: the analysis (quiz_analysis), read again only when the finished attempts change.
  const analysisState = useQuizAnalysis(quizId, analysisStamp(results?.attempts));
  const fast = useMemo(() => fastSigns(analysisState.analysis), [analysisState.analysis]);

  // ── the note a page left (created, saved): shown once; the history entry forgets it, so a reload does not repeat it ──
  const [note] = useState<string | null>(() => {
    const value = (location.state as { quizNote?: unknown } | null)?.quizNote;
    return value === 'created' ? QA_STATS.created : value === 'saved' ? QA_STATS.saved : null;
  });
  useEffect(() => {
    if ((location.state as { quizNote?: unknown } | null)?.quizNote === undefined) return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate]);

  // ── the link ──
  const linkRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const url = quiz ? `${window.location.origin}/k/${quiz.code}` : '';
  const copy = async () => {
    const done = await copyText(url, linkRef.current);
    setCopied(done);
    setAnnounce(done ? QA_STATS.copiedLine : QA_STATS.copyFailed);
  };

  // ── «Закрыть сейчас», «Удалить» ──
  const focusAfter = useFocusAfter();
  const [asking, setAsking] = useState<Ask>(null);
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const ask = (what: Ask) => {
    setActError(null);
    setAsking(what);
    focusAfter(() => noRef.current);
  };
  const unask = () => {
    const back = asking === 'close' ? closeRef : removeRef;
    setAsking(null);
    focusAfter(() => back.current);
  };
  const act = async () => {
    if (acting || !asking) return;
    setActing(true);
    setActError(null);
    try {
      if (asking === 'remove') {
        await deleteQuiz(quizId);
        // A test's quizzes live on the test's own page (TestHome, release 47.3): back there, not to the exam's list.
        navigate(ofTest ? `/exams/c/${containerId}` : listPath, { replace: true });
        return;
      }
      const row = await closeQuiz(quizId);
      setResults((current) => (current ? { ...current, quiz: row } : current));
      setAsking(null);
      void load(true);
    } catch (error) {
      setActError(errorText(error, QA_ERRORS));
    } finally {
      if (alive.current) setActing(false);
    }
  };

  // ── «Скачать таблицу» ──
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const download = async () => {
    if (!results || !quiz || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const marks = await quizMarks(quizId);
      const csv = csvOf(quiz, results.attempts, marks, [...items.values()], subjects);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `${fileName(quiz.title)}.csv`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (error) {
      setDownloadError(errorText(error, QA_ERRORS, QA_STATS.downloadFailed));
    } finally {
      if (alive.current) setDownloading(false);
    }
  };

  // ── the tabs ──
  // The tab lives in the address (?tab=questions; lib/urlState.ts): a reload and «Назад» keep it.
  const [tab, setTab] = useUrlState<Tab>('tab', 'people', STATS_TABS);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ people: null, questions: null, repeat: null });
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const at = STATS_TABS.indexOf(tab);
    const last = STATS_TABS.length - 1;
    const next: Tab =
      STATS_TABS[event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowRight' ? (at === last ? 0 : at + 1) : at === 0 ? last : at - 1];
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  // ───────────────────────────── render ─────────────────────────────

  const header = (
    <header className="ex-head qa-head">
      <div style={{ minWidth: 0 }}>
        {summary ? (
          <p className="ex-crumb">
            <Link to={`/exams/c/${containerId}`}>{summary.title}</Link>
            {' · '}
            <Link to={listPath}>{QA_LIST.title}</Link>
          </p>
        ) : null}
        <h1 className="ex-h1">{quiz ? quiz.title : QA_LIST.title}</h1>
        {quiz ? <p className="ex-meta qa-state">{nb(`${quizStateWords(quiz)} · ${QA_LIST.meta(quiz.item_count, quiz.time_limit_s)} · ${QUIZ.attempts(quiz.attempts)}`)}</p> : null}
      </div>
    </header>
  );
  const shell = (children: ReactNode) => (
    <div className="sf-page qa-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      {children}
    </div>
  );

  if (data.gone) {
    return shell(
      <p className="ex-note">
        {GONE.title}. {GONE.text}{' '}
        <Link className="sf-link" to="/exams">
          {TO_EXAMS}
        </Link>
      </p>,
    );
  }
  if (summary && summary.role !== 'owner') {
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
  if (failure) {
    return shell(
      <p className="ex-note" role="alert">
        {failure.text}{' '}
        {failure.missing ? (
          <Link className="sf-link" to={listPath}>
            {QA_STATS.toList}
          </Link>
        ) : (
          <button type="button" className="sf-link" onClick={() => void load()}>
            {QA_STATS.retry}
          </button>
        )}
      </p>,
    );
  }
  if (!results || !quiz) {
    return shell(
      <p className="qa-wait" role="status">
        {QA_STATS.loading}
      </p>,
    );
  }

  const nobody = totals.writing === 0 && totals.done === 0;
  const onlyOwn = nobody && rows.length > 0 && rows.every((row) => row.own);
  const tabId = (which: Tab) => `${ids}-${which}`;

  return (
    <div className="sf-page qa-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      {note ? (
        <p className="ex-note" data-quiet="" role="status">
          {note}
        </p>
      ) : null}

      <section className="qa-share">
        <label className="im-label" htmlFor={`${ids}-link`}>
          {QA_STATS.link}
        </label>
        <div className="qa-link-row">
          <input id={`${ids}-link`} ref={linkRef} className="qa-link-field" readOnly value={url} onFocus={(event) => event.target.select()} />
          <button type="button" className="qa-copy" onClick={() => void copy()}>
            <span className="qa-copy-w" aria-hidden={copied || undefined}>
              {QA_STATS.copy}
            </span>
            <span className="qa-copy-w" aria-hidden={!copied || undefined}>
              {QA_STATS.copied}
            </span>
          </button>
        </div>
        <p className="qa-announce" role="status">
          {announce}
        </p>
        <QuizShare url={url} title={quiz.title} />
        <QuizTelegram quizId={quizId} url={url} title={quiz.title} closed={quiz.state === 'closed'} />
        <p className="qa-acts">
          <Link className="sf-link" to={`${listPath}/${quizId}/edit`}>
            {QA_STATS.edit}
          </Link>
          {/* While a confirm is open its own buttons stand for these (one «Удалить» on the screen). */}
          {quiz.state !== 'closed' && !asking ? (
            <button ref={closeRef} type="button" className="sf-link" onClick={() => ask('close')}>
              {QA_STATS.close}
            </button>
          ) : null}
          {!asking ? (
            <button ref={removeRef} type="button" className="sf-link" data-muted="" onClick={() => ask('remove')}>
              {QA_STATS.remove}
            </button>
          ) : null}
        </p>
        {asking ? (
          <p className="qa-ask" role="group" aria-labelledby={`${ids}-ask`}>
            <span id={`${ids}-ask`}>{asking === 'remove' ? QA_STATS.removeAsk(quiz.title) : nb(QA_STATS.closeAsk(totals.writing))}</span>
            <button type="button" className="sf-link" disabled={acting} onClick={() => void act()}>
              {asking === 'remove' ? QA_STATS.removeYes : QA_STATS.closeYes}
            </button>
            <button ref={noRef} type="button" className="sf-link" data-muted="" disabled={acting} onClick={unask}>
              {QA_STATS.no}
            </button>
          </p>
        ) : null}
        {actError ? (
          <p className="qa-line" role="alert">
            {actError}
          </p>
        ) : null}
        {quiz.state === 'closed' ? <p className="qa-line" data-muted="">{QA_STATS.closedHint}</p> : null}
      </section>

      <p className="qa-summary" aria-live="polite">
        {onlyOwn ? QA_STATS.onlyOwn : nobody ? QA_STATS.nobody : nb(QA_STATS.summary(totals.writing, totals.done, totals.avgPercent, totals.passed))}
      </p>
      {staleSince !== null ? (
        <p className="qa-line" data-muted="" role="status">
          {QA_STATS.stale(timeOf(staleSince))}
        </p>
      ) : null}

      <div className="qa-tabbar">
        <div className="qa-tabs" role="tablist" aria-label={QA_STATS.tabs}>
          {STATS_TABS.map((which) => (
            <button
              key={which}
              ref={(node) => {
                tabRefs.current[which] = node;
              }}
              id={tabId(which)}
              type="button"
              role="tab"
              className="qa-tab"
              aria-selected={tab === which}
              aria-controls={`${tabId(which)}-panel`}
              tabIndex={tab === which ? 0 : -1}
              onKeyDown={onTabKey}
              onClick={() => setTab(which)}
            >
              {TAB_WORDS[which]}
            </button>
          ))}
        </div>
        <button type="button" className="sf-link qa-download" disabled={downloading || results.attempts.length === 0} onClick={() => void download()}>
          {downloading ? QA_STATS.downloading : QA_STATS.download}
        </button>
      </div>
      {downloadError ? (
        <p className="qa-line" role="alert">
          {downloadError}
        </p>
      ) : null}

      <div className="qa-panel" role="tabpanel" id={`${tabId(tab)}-panel`} aria-labelledby={tabId(tab)}>
        {tab === 'people' ? (
          <QuizPeople quiz={quiz} attempts={results.attempts} items={items} subjects={subjects} offsetMs={offsetMs} wide={frame.side} onChanged={() => void load(true)} fast={fast} />
        ) : tab === 'questions' ? (
          <QuizQuestions
            containerId={containerId}
            stats={results.items}
            items={items}
            subjects={subjects}
            analysis={analysisState.analysis}
            attempts={results.attempts}
            analysisFailed={analysisState.failed}
            onAnalysisRetry={analysisState.reload}
          />
        ) : (
          <QuizRepeat
            quizId={quizId}
            analysis={analysisState.analysis}
            analysisFailed={analysisState.failed}
            attempts={results.attempts}
            items={items}
            ofTest={ofTest}
            practice={quiz.offer_practice === true}
            onSent={analysisState.reload}
            onRetry={analysisState.reload}
          />
        )}
      </div>
    </div>
  );
}
