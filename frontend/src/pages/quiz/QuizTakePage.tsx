import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { previewQuiz, quizResult, startQuiz } from '../../api/quizzes';
import { CONTAINER_ERROR_TEXT } from '../../api/containers';
import InAppNote from '../../components/InAppNote';
import QuizRun from '../../components/quiz/QuizRun';
import QuizResultView from '../../components/quiz/QuizResult';
import { TAKE } from '../../components/quiz/copyTake';
import { detectInAppBrowser } from '../../lib/inAppBrowser';
import { dateTimeText } from '../../lib/quizzes/quizModel';
import { normalizeJoinCode, withReturn } from '../../lib/returnTo';
import { track } from '../../lib/telemetry';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import type { QuizAttempt, QuizPreview, QuizPreviewMe, QuizResult } from '../../types/quiz';
import '../../components/containers/room.css';
import '../../components/quiz/quizTake.css';

/**
 * /k/<код> — «Контрольная» for the one who writes it (spec 2026-10-16 §2.2; plan Task 4), outside the app's frame as
 * /g/<код>. Before anything can be pressed the page says what this is (the title, the author, the exam, «20 вопросов ·
 * 30 минут · открыта до 24 окт., 18:00 · 1 попытка», the rules) and that the author sees the name, the answers and the
 * result. Signed out: «Войти, чтобы начать», coming back here (?next=/k/<код>). Signed in: «Ваше имя для автора» (from
 * the profile) and «Начать» — or «Продолжить» for an attempt in progress (quiz_start gives the same attempt back), or
 * the words why not (no attempts left, members only, not open yet, closed); the person's earlier results open from here.
 * The attempt (QuizRun) and the result (QuizResult) take the whole screen, as the exam's rooms do.
 */

type PreviewState = { state: 'loading' } | { state: 'ready'; value: QuizPreview } | { state: 'error'; message: string };
type Stage = { kind: 'preview' } | { kind: 'run'; attempt: QuizAttempt } | { kind: 'result'; result: QuizResult };

const NAME_MIN = 2;
const NAME_MAX = 80;

/** Signed out on the way (the session ended): the call answers 42501 or 28000. */
const SIGNED_OUT = new Set(['42501', '28000']);

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
}

function messageOf(error: unknown): string {
  const code = codeOf(error);
  if (code === 'P0002') return TAKE.notFound;
  if (SIGNED_OUT.has(code)) return TAKE.signInAgain;
  if (error instanceof Error && error.message) return error.message;
  return CONTAINER_ERROR_TEXT.unknown;
}

function windowWords(value: QuizPreview): string | null {
  if (value.status === 'closed') return TAKE.closedWord;
  if (value.status === 'not_yet' && value.opens_at) return TAKE.opensAt(dateTimeText(value.opens_at));
  if (value.closes_at) return TAKE.openUntil(dateTimeText(value.closes_at));
  return null;
}

function reasonWords(value: QuizPreview, reason: QuizPreviewMe['reason']): string | null {
  if (reason === 'no_attempts') return TAKE.reason.no_attempts;
  if (reason === 'members_only') return TAKE.reason.members_only;
  if (reason === 'not_yet') return TAKE.reason.not_yet(value.opens_at ? dateTimeText(value.opens_at) : null);
  if (reason === 'closed') return TAKE.reason.closed;
  return null;
}

export default function QuizTakePage() {
  const params = useParams();
  const code = normalizeJoinCode(params.code);
  const { user, loading, requestSession } = useAuth();
  const browser = useMemo(() => detectInAppBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent), []);
  const [preview, setPreview] = useState<PreviewState>({ state: 'loading' });
  const [reload, setReload] = useState(0);
  const [stage, setStage] = useState<Stage>({ kind: 'preview' });
  const [name, setName] = useState<string | null>(null);
  const [nameBad, setNameBad] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<{ text: string; signIn: boolean } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const nameId = useId();
  const hintId = useId();
  const back = code ? `/k/${code}` : null;
  const pageUrl = back ? `${window.location.origin}${back}` : window.location.href;

  const value = preview.state === 'ready' ? preview.value : null;
  useDocumentTitle(value?.title || TAKE.docTitle);

  useEffect(() => {
    requestSession?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The preview waits for the session: a signed-in visitor's token brings «me» (the name, the attempts, the reason).
  useEffect(() => {
    if (!code || loading) return undefined;
    let live = true;
    previewQuiz(code).then(
      (next) => {
        if (live) setPreview({ state: 'ready', value: next });
      },
      (error: unknown) => {
        if (live) setPreview({ state: 'error', message: messageOf(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [code, loading, user?.id, reload]);

  const me = value?.me ?? null;
  const typedName = name ?? me?.name_hint ?? '';

  const toStart = (message: string | null = null) => {
    setStage({ kind: 'preview' });
    setProblem(message ? { text: message, signIn: false } : null);
    setReload((n) => n + 1);
  };
  const say = (error: unknown) => setProblem({ text: messageOf(error), signIn: SIGNED_OUT.has(codeOf(error)) });

  const begin = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!code || !me || starting) return;
    const resume = Boolean(me.open_attempt);
    const trimmed = typedName.trim();
    if (!resume && (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX)) {
      setNameBad(true);
      return;
    }
    setNameBad(false);
    setProblem(null);
    setStarting(true);
    try {
      // Going on with an attempt the server keeps its name; the one typed here only names a new attempt.
      const attempt = await startQuiz(code, trimmed || me.name_hint || '');
      track('quiz.started', { resumed: resume || attempt.answers.length > 0 });
      setStage({ kind: 'run', attempt });
    } catch (error) {
      say(error);
      setReload((n) => n + 1);
    } finally {
      setStarting(false);
    }
  };

  const openResult = async (attemptId: string) => {
    if (opening) return;
    setOpening(attemptId);
    setProblem(null);
    try {
      const result = await quizResult(attemptId);
      setStage({ kind: 'result', result });
    } catch (error) {
      say(error);
    } finally {
      setOpening(null);
    }
  };

  if (stage.kind === 'run') {
    return (
      <div className="ct-roomshell">
        <QuizRun key={stage.attempt.attempt_id} attempt={stage.attempt} onResult={(result) => setStage({ kind: 'result', result })} onLost={(message) => toStart(message)} />
      </div>
    );
  }
  if (stage.kind === 'result') {
    return (
      <div className="ct-roomshell">
        <QuizResultView result={stage.result} onRetry={() => toStart()} onClose={() => toStart()} />
      </div>
    );
  }

  const notFound = !code || (value !== null && value.status === 'not_found');
  const failed = preview.state === 'error' ? preview.message : null;
  const ready = value !== null && !notFound;
  const minutes = value && typeof value.time_limit_s === 'number' ? Math.max(1, Math.round(value.time_limit_s / 60)) : null;
  const meta = value && ready ? TAKE.meta({ items: value.item_count ?? 0, minutes, window: windowWords(value), attempts: value.attempts ?? null }) : '';
  // The server names why not; a refusal without a name falls back on the quiz's state.
  const byState: QuizPreviewMe['reason'] = value?.status === 'not_yet' ? 'not_yet' : value?.status === 'closed' ? 'closed' : null;
  const reason = value && me && !me.open_attempt ? reasonWords(value, me.reason ?? (me.can_start ? null : byState)) : null;
  const guestReason = value && !me ? reasonWords(value, byState) : null;
  const results = me?.results ?? [];

  return (
    <div className="au qt">
      <header className="au-bar">
        <Link to="/" className="au-logo">
          Meldy
        </Link>
      </header>
      <main className="qt-main">
        <section className="au-card qt-card" aria-labelledby="qt-title">
          <div className="au-in qt-in">
            {ready && value ? (
              <>
                <p className="qt-kicker">{TAKE.kicker}</p>
                <h1 id="qt-title" className="au-h1 qt-h1">
                  {value.title}
                </h1>
                <p className="qt-by">
                  {value.author_name ? <span>{TAKE.author(value.author_name)}</span> : null}
                  {value.author_name && value.exam_title ? <span aria-hidden="true"> · </span> : null}
                  {value.exam_title ? <span>{TAKE.exam(value.exam_title)}</span> : null}
                </p>
                <p className="qt-meta">{meta}</p>
                <ul className="qt-rules">
                  <li>{value.allow_back === false ? TAKE.forwardOnly : TAKE.backAllowed}</li>
                  {typeof value.pass_percent === 'number' ? <li>{TAKE.passMark(value.pass_percent)}</li> : null}
                  {value.attempts !== 1 && value.grading ? <li>{TAKE.grading[value.grading]}</li> : null}
                  {value.review ? <li>{TAKE.review[value.review]}</li> : null}
                  {value.members_only ? <li>{TAKE.membersOnly}</li> : null}
                </ul>
                <p className="qt-privacy">{TAKE.privacy}</p>
              </>
            ) : (
              <h1 id="qt-title" className="au-h1 qt-h1">
                {notFound || failed ? TAKE.kicker : TAKE.loading}
              </h1>
            )}

            {notFound ? (
              <p role="alert" className="qt-alert">
                {TAKE.notFound}
              </p>
            ) : failed ? (
              <div className="qt-failed">
                <p role="alert" className="au-alert qt-alert-box">
                  {failed}
                </p>
                <button type="button" className="sf-primary" onClick={() => setReload((n) => n + 1)}>
                  {TAKE.retry}
                </button>
              </div>
            ) : null}

            {problem ? (
              <p role="alert" className="au-alert qt-alert-box">
                {problem.text}
              </p>
            ) : null}
            {problem?.signIn && back ? (
              <p className="qt-next">
                <Link className="sf-primary qt-go" to={withReturn('/login', back)}>
                  {TAKE.signInShort}
                </Link>
              </p>
            ) : null}

            {ready && value && !user && !loading && back ? (
              <>
                {browser.app ? <InAppNote browser={browser} url={pageUrl} /> : null}
                {guestReason ? <p className="qt-reason">{guestReason}</p> : null}
                <div className="qt-actions">
                  <Link className="sf-primary qt-go" to={withReturn('/login', back)}>
                    {value.status === 'closed' ? TAKE.signInToSee : TAKE.signIn}
                  </Link>
                  <Link className="sf-link" to={withReturn('/register', back)}>
                    {TAKE.register}
                  </Link>
                </div>
              </>
            ) : null}

            {ready && value && user && me ? (
              <>
                {me.is_author ? <p className="qt-note">{TAKE.authorNote}</p> : null}
                {me.open_attempt ? (
                  <div className="qt-actions">
                    <p className="qt-note">{TAKE.resumeNote}</p>
                    <button type="button" className="sf-primary qt-go" aria-busy={starting || undefined} disabled={starting} onClick={() => void begin()}>
                      {TAKE.resume}
                    </button>
                  </div>
                ) : reason ? (
                  <p className="qt-reason">{reason}</p>
                ) : (
                  <form className="qt-start" onSubmit={(event) => void begin(event)} noValidate>
                    <div className="au-field">
                      <label className="au-label" htmlFor={nameId}>
                        {TAKE.nameLabel}
                      </label>
                      <input
                        id={nameId}
                        className="au-input"
                        type="text"
                        autoComplete="name"
                        maxLength={NAME_MAX}
                        value={typedName}
                        aria-invalid={nameBad || undefined}
                        aria-describedby={hintId}
                        onChange={(event) => {
                          setName(event.target.value);
                          if (nameBad) setNameBad(false);
                        }}
                      />
                      <p id={hintId} className="qt-hint" data-bad={nameBad ? '' : undefined}>
                        {nameBad ? TAKE.nameBad : TAKE.nameHint}
                      </p>
                    </div>
                    <button type="submit" className="sf-primary qt-go" aria-busy={starting || undefined} disabled={starting}>
                      {TAKE.start}
                    </button>
                  </form>
                )}
                {results.length > 0 ? (
                  <section className="qt-past" aria-labelledby="qt-past-title">
                    <h2 id="qt-past-title" className="qt-past-h">
                      {TAKE.pastTitle}
                    </h2>
                    <ul className="qt-past-list">
                      {results.map((row) => (
                        <li key={row.attempt_id}>
                          <span>{TAKE.pastRow(row.n, row.correct, row.total, row.finished_at ? dateTimeText(row.finished_at) : '')}</span>
                          <button
                            type="button"
                            className="sf-link"
                            aria-label={TAKE.seeLabel(row.n)}
                            aria-busy={opening === row.attempt_id || undefined}
                            onClick={() => void openResult(row.attempt_id)}
                          >
                            {TAKE.see}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}

            {notFound ? (
              <p className="qt-next">
                <Link className="sf-link" to={user ? '/dashboard' : '/'}>
                  {TAKE.home}
                </Link>
              </p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
