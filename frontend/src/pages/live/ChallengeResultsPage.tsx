/**
 * /live/challenge/<id> — the author's page of one «Соревнование по ссылке» (docs/live/CHALLENGE.md): the link for the
 * class with its QR code (drawn here, lib/quizzes/qr), «Скопировать», «Открыть как участник» and «Закрыть досрочно»;
 * then the results as they come (`challenge_results`, read every 5 s while the challenge is open): every person with
 * the place, points, right answers and time, those under way, «Убрать» for a name that should not be there; and each
 * question with how many got it right, the hardest marked.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { challengeApi } from '../../lib/challenge/api';
import type { ChallengeResults, ResultRun } from '../../lib/challenge/types';
import { LiveError } from '../../lib/live/types';
import { liveFakeWanted } from '../../lib/live/api';
import { loginFor } from '../../lib/returnTo';
import { qrCode, shortLink } from '../../lib/quizzes/qr';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Character } from '../../components/live/art/Character';
import { nb } from '../../components/live/host/copy';
import { QrScreen } from '../../components/quiz/QuizShare';
import { CPAGE } from '../../components/challenge/copyAuthor';
import { dateText, timeText } from '../../components/challenge/copy';
import '../../components/live/host/host.css';
import '../../components/challenge/challengeAuthor.css';

const POLL_MS = 5000;
const QUIET = 2;

function Qr({ url }: { url: string }) {
  const code = useMemo(() => qrCode(url), [url]);
  const outer = code.size + QUIET * 2;
  return (
    <svg className="lcp-qr" viewBox={`${-QUIET} ${-QUIET} ${outer} ${outer}`} role="img" aria-label="QR-код ссылки" shapeRendering="crispEdges">
      <rect x={-QUIET} y={-QUIET} width={outer} height={outer} fill="#fff" />
      <path d={code.path} fill="#0b121c" />
    </svg>
  );
}

function stateLine(r: ChallengeResults): string {
  if (r.state === 'open') return CPAGE.state.open(dateText(r.deadline));
  if (r.over === 'closed' && r.closed_at) return CPAGE.state.closed(dateText(r.closed_at));
  return CPAGE.state.deadline(dateText(r.deadline));
}

function RunRow({ run, n, onRemove }: { run: ResultRun; n: number; onRemove: (run: ResultRun) => void }) {
  const status = run.removed ? CPAGE.removed : run.finished_at ? null : run.answered > 0 ? CPAGE.underway(run.answered, n) : CPAGE.notStarted;
  return (
    <tr data-removed={run.removed ? 'true' : undefined} data-under={!run.finished_at && !run.removed ? 'true' : undefined}>
      <td className="lcp-place">{run.place ?? '—'}</td>
      <td>
        <div className="lcp-name">
          <Character look={run.look} size={32} move="none" />
          <span>
            {run.name}
            {status ? <small>{status}</small> : null}
          </span>
        </div>
      </td>
      <td className="lcp-n">{nb(run.dmg)}</td>
      <td className="lcp-n">
        {run.right}
        <small> из {n}</small>
      </td>
      <td className="lcp-n">{run.finished_at || run.answered > 0 ? timeText(run.time_ms) : '—'}</td>
      <td className="lcp-act">
        {run.removed ? null : (
          <button type="button" className="lcp-remove" onClick={() => onRemove(run)}>
            {CPAGE.remove}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function ChallengeResultsPage() {
  const { id = '' } = useParams();
  const { pathname, search } = useLocation();
  const fake = liveFakeWanted();
  const { user, loading, requestSession } = useAuth();
  const api = useMemo(() => challengeApi(), []);
  const [r, setR] = useState<ChallengeResults | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState<'close' | ResultRun | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!fake) requestSession?.();
  }, [fake, requestSession]);

  const load = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const got = await api.results(id);
      setR(got);
      setFailed(null);
      if (got.state === 'open' || got.playing > 0) timer.current = setTimeout(() => void load(), POLL_MS);
    } catch (e) {
      setFailed(e instanceof LiveError && e.code === '42501' ? CPAGE.notMine : CPAGE.failed);
    }
  }, [api, id]);
  useEffect(() => {
    if (fake || user) void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fake, user, load]);

  useDocumentTitle(r ? `${r.title} · ${CPAGE.top}` : CPAGE.top);
  if (!fake && !loading && !user) return <Navigate to={loginFor(pathname, search)} replace />;

  const url = r ? `${window.location.origin}${r.path}` : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // the browser refused: the link is on the screen to copy by hand
    }
  };
  const confirmClose = async () => {
    setBusy(true);
    try {
      await api.close(id);
    } finally {
      setAsking(null);
      setBusy(false);
      void load();
    }
  };
  const confirmRemove = async (run: ResultRun) => {
    setBusy(true);
    try {
      await api.remove(id, run.run_id);
    } finally {
      setAsking(null);
      setBusy(false);
      void load();
    }
  };
  const hardest = r && r.questions.some((q) => q.answered > 0)
    ? r.questions.filter((q) => q.answered > 0).reduce((a, b) => (b.right / b.answered < a.right / a.answered ? b : a)).qi
    : null;

  return (
    <div className="lvs lcp">
      <header className="lvs-top">
        <Link to={r ? `/exams/c/${r.container_id}` : '/games'} className="lvh-logo" aria-label="Meldy">
          Meldy<i />
        </Link>
        <span>{CPAGE.top}</span>
        <span className="lvh-grow" />
        <Link className="lcp-toplink" to="/games">
          {CPAGE.games}
        </Link>
      </header>
      <main className="lvs-main">
        {failed && !r ? (
          <p className="lvs-state" role="alert">
            {failed}{' '}
            <button type="button" onClick={() => void load()}>
              {CPAGE.retry}
            </button>
          </p>
        ) : !r ? (
          <p className="lvs-state" role="status">
            {CPAGE.loading}
          </p>
        ) : (
          <>
            <h1>{r.title}</h1>
            <p className="lvs-lead">
              {CPAGE.meta(r.q_count, r.time_s, !!r.calm, r.reveal === 'end')} · <b data-state={r.state}>{stateLine(r)}</b>
            </p>
            <section className="lcp-share" aria-label={CPAGE.link}>
              <button type="button" className="lcp-qr-b" onClick={() => setQr(true)} aria-label={CPAGE.qr}>
                <Qr url={url} />
              </button>
              <div className="lcp-share-text">
                <span className="lcp-label">{CPAGE.link}</span>
                <a className="lcp-link" href={r.path} target="_blank" rel="noopener noreferrer">
                  {shortLink(url)}
                </a>
                <div className="lcp-actions">
                  <button type="button" className="lvh-btn lvh-btn--small" onClick={() => void copy()}>
                    {copied ? CPAGE.copied : CPAGE.copy}
                  </button>
                  <button type="button" className="lvh-btn lvh-btn--small lvh-btn--white" onClick={() => setQr(true)}>
                    {CPAGE.qr}
                  </button>
                  <a className="lvh-btn lvh-btn--small lvh-btn--white" href={r.path} target="_blank" rel="noopener noreferrer">
                    {CPAGE.open}
                  </a>
                  {r.state === 'open' ? (
                    <button type="button" className="lvh-btn lvh-btn--small lvh-btn--white lcp-close" onClick={() => setAsking('close')}>
                      {CPAGE.close}
                    </button>
                  ) : null}
                </div>
                {asking === 'close' ? (
                  <div className="lcp-ask" role="alertdialog" aria-label={CPAGE.close}>
                    <p>{CPAGE.closeAsk}</p>
                    <div className="lcp-actions">
                      <button type="button" className="lvh-btn lvh-btn--small lvh-btn--red" disabled={busy} onClick={() => void confirmClose()}>
                        {busy ? CPAGE.closing : CPAGE.closeYes}
                      </button>
                      <button type="button" className="lvh-btn lvh-btn--small lvh-btn--white" onClick={() => setAsking(null)}>
                        {CPAGE.closeNo}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
            <section className="lcp-results" aria-labelledby="lcp-results-h">
              <div className="lcp-results-head">
                <h2 id="lcp-results-h">{CPAGE.table}</h2>
                <span>
                  {CPAGE.finished(r.finished)}
                  {r.playing > 0 ? ` · ${CPAGE.playing(r.playing)}` : ''}
                </span>
              </div>
              {asking && asking !== 'close' ? (
                <div className="lcp-ask" role="alertdialog" aria-label={CPAGE.remove}>
                  <p>{CPAGE.removeAsk(asking.name)}</p>
                  <div className="lcp-actions">
                    <button type="button" className="lvh-btn lvh-btn--small lvh-btn--red" disabled={busy} onClick={() => void confirmRemove(asking)}>
                      {CPAGE.removeYes}
                    </button>
                    <button type="button" className="lvh-btn lvh-btn--small lvh-btn--white" onClick={() => setAsking(null)}>
                      {CPAGE.closeNo}
                    </button>
                  </div>
                </div>
              ) : null}
              {r.runs.length === 0 ? (
                <p className="lcp-empty">{CPAGE.empty}</p>
              ) : (
                <div className="lcp-table-wrap">
                  <table className="lcp-table">
                    <thead>
                      <tr>
                        <th scope="col">{CPAGE.head.place}</th>
                        <th scope="col">{CPAGE.head.name}</th>
                        <th scope="col" className="lcp-n">
                          {CPAGE.head.points}
                        </th>
                        <th scope="col" className="lcp-n">
                          {CPAGE.head.right}
                        </th>
                        <th scope="col" className="lcp-n">
                          {CPAGE.head.time}
                        </th>
                        <th scope="col">
                          <span className="lvh-sr">Действия</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.runs.map((run) => (
                        <RunRow key={run.run_id} run={run} n={r.q_count} onRemove={setAsking} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="lcp-questions" aria-labelledby="lcp-q-h">
              <h2 id="lcp-q-h">{CPAGE.questions}</h2>
              <ol>
                {r.questions.map((q) => (
                  <li key={q.qi} data-hard={q.qi === hardest && q.right < q.answered ? 'true' : undefined}>
                    <span className="lcp-qn">{q.qi + 1}</span>
                    <span className="lcp-qt">{q.text}</span>
                    <span className="lcp-qbar" aria-hidden="true">
                      <i style={{ transform: `scaleX(${q.answered > 0 ? q.right / q.answered : 0})` }} />
                    </span>
                    <span className="lcp-qs">
                      {CPAGE.questionLine(q.right, q.answered)}
                      {q.qi === hardest && q.right < q.answered ? <b> · {CPAGE.hard}</b> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </main>
      {qr && r ? <QrScreen url={url} title={CPAGE.qrTitle(r.title)} onClose={() => setQr(false)} /> : null}
    </div>
  );
}
