import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { joinByCode, oralSync, previewLink } from '../../api/containers';
import { deferGuideOnce } from '../../components/guide/guideLater';
import InAppNote from '../../components/InAppNote';
import { detectInAppBrowser } from '../../lib/inAppBrowser';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { normalizeJoinCode, oauthRedirectTo, withReturn } from '../../lib/returnTo';
import { track } from '../../lib/telemetry';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { dayText, errorText, JOIN, nb } from '../../components/containers/copyImport';
import type { LinkPreview } from '../../types/container';
import './JoinContainerPage.css';

/**
 * /g/<код> — the group link of an exam (spec §9, decisions 24, 25 and 52; Concept 1 §3.12 with the design critique
 * I10). Open without an account: what the exam holds and the date, and that the questions and keys come from the
 * author's files, the member's answers are seen by no one, and the author sees the member's name. Sign-in comes back
 * here through ?next=/g/<код> (lib/returnTo; not the /join device memory, which leads to /join). Signed in, the page
 * joins at once, asks the backend for the copies of the oral subjects (oral-sync) and opens the exam. The mandatory
 * guide waits (deferGuideOnce), as on /join.
 */

if (typeof window !== 'undefined' && /^\/g\//.test(window.location.pathname)) deferGuideOnce();

type PreviewState = { state: 'loading' } | { state: 'ready'; value: LinkPreview } | { state: 'error'; message: string };
type JoinState = { state: 'idle' } | { state: 'joining' } | { state: 'failed'; message: string; retry: boolean };

/** Refusals that another try does not change. */
const FINAL = new Set(['MC001', 'MC002', 'MC003', 'MC004', 'MC005', 'MC006']);
/** The oral copies are made by the backend; the exam opens without waiting longer than this for them. */
export const ORAL_SYNC_WAIT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export default function JoinContainerPage() {
  useState(() => {
    deferGuideOnce();
    return null;
  });
  useDocumentTitle(JOIN.docTitle);
  const params = useParams();
  const code = normalizeJoinCode(params.code);
  const navigate = useNavigate();
  const { user, loading, requestSession } = useAuth();
  const browser = useMemo(() => detectInAppBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent), []);
  const [preview, setPreview] = useState<PreviewState>({ state: 'loading' });
  const [join, setJoin] = useState<JoinState>({ state: 'idle' });
  const started = useRef<string | null>(null);
  const back = code ? `/g/${code}` : null;
  const pageUrl = back ? `${window.location.origin}${back}` : window.location.href;

  useEffect(() => {
    requestSession?.();
    track('container.join_opened', { inapp: browser.app ?? 'none' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The preview waits for the session: a signed-in visitor's token tells «own» and «joined» apart.
  useEffect(() => {
    if (!code || loading) return undefined;
    let live = true;
    setPreview({ state: 'loading' });
    previewLink(code).then(
      (value) => {
        if (live) setPreview({ state: 'ready', value });
      },
      (error: unknown) => {
        if (live) setPreview({ state: 'error', message: errorText(error, JOIN.errors, JOIN.failed) });
      },
    );
    return () => {
      live = false;
    };
  }, [code, loading, user?.id]);

  const value = preview.state === 'ready' ? preview.value : null;

  const runJoin = useCallback(async () => {
    if (!code) return;
    setJoin({ state: 'joining' });
    try {
      const result = await joinByCode(code);
      const oral = (result.oral_subjects ?? 0) > 0 || Boolean(value?.subjects?.some((subject) => subject.oral));
      if (oral) await withTimeout(oralSync(result.container_id), ORAL_SYNC_WAIT_MS);
      if (value?.title) rememberContainerTitle(result.container_id, value.title);
      deferGuideOnce();
      track('container.joined', { again: !result.joined, oral });
      navigate(`/exams/c/${result.container_id}`, { replace: true });
    } catch (error) {
      const failure = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : '';
      setJoin({ state: 'failed', message: errorText(error, JOIN.errors, JOIN.failed), retry: !FINAL.has(failure) });
    }
  }, [code, navigate, value]);

  // Signed in and the link is live (or the member is already in): straight into the exam.
  useEffect(() => {
    if (!code || !user || !value) return;
    if (value.status !== 'active' && value.status !== 'joined') return;
    const key = `${user.id}:${code}`;
    if (started.current === key) return;
    started.current = key;
    void runJoin();
  }, [code, user, value, runJoin]);

  const google = async () => {
    if (!back) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: oauthRedirectTo(window.location.origin, back) },
    });
  };

  const live = value && (value.status === 'active' || value.status === 'joined');
  const problem = !code
    ? JOIN.unreadable
    : preview.state === 'error'
      ? preview.message
      : value && !live && value.status !== 'own'
        ? JOIN.status[value.status] ?? JOIN.status.not_found
        : null;
  const subjects = value?.subjects ?? [];
  const questions = subjects.reduce((sum, subject) => sum + (subject.items || 0), 0);
  const meta = value && live ? JOIN.meta(subjects.length, questions, value.exam_date ? dayText(value.exam_date) : null) : '';
  const hasOral = subjects.some((subject) => subject.oral);

  return (
    <div className="au gj">
      <header className="au-bar">
        <Link to="/" className="au-logo">
          Meldy
        </Link>
      </header>
      <main className="gj-main">
        <section className="au-card gj-card" aria-labelledby="gj-title">
          <div className="au-in">
            {value && live ? (
              <>
                <h1 id="gj-title" className="au-h1 gj-h1">
                  {JOIN.title(value.title ?? '')}
                </h1>
                {meta ? <p className="gj-meta">{nb(meta)}</p> : null}
                <p className="au-lede">{JOIN.lede}</p>
                {hasOral ? <p className="gj-oral">{JOIN.oral}</p> : null}
              </>
            ) : value && value.status === 'own' ? (
              <>
                <h1 id="gj-title" className="au-h1 gj-h1">
                  {JOIN.own}
                </h1>
                <p className="au-lede">{JOIN.ownLede}</p>
                {value.container_id ? (
                  <p className="gj-actions">
                    <Link className="sf-primary" to={`/exams/c/${value.container_id}`}>
                      {JOIN.openExam}
                    </Link>
                  </p>
                ) : null}
              </>
            ) : (
              <h1 id="gj-title" className="au-h1 gj-h1">
                {problem ? JOIN.failedTitle : JOIN.loading}
              </h1>
            )}

            {problem ? (
              <div role="alert" className="au-alert gj-alert">
                {problem}
              </div>
            ) : null}

            {browser.app && code && live && !user ? <InAppNote browser={browser} url={pageUrl} /> : null}

            {live && !user && !loading && back ? (
              <div className="gj-signin">
                {!browser.app ? (
                  <>
                    <button type="button" onClick={() => void google()} className="au-oauth">
                      <GoogleMark />
                      {JOIN.google}
                    </button>
                    <div className="au-or">{JOIN.or}</div>
                  </>
                ) : null}
                <p className="gj-mail">
                  <Link className="au-link" to={withReturn('/login', back)}>
                    {browser.app ? JOIN.mailHere : JOIN.mail}
                  </Link>
                  <span aria-hidden="true"> · </span>
                  <Link className="au-link" to={withReturn('/register', back)}>
                    {JOIN.register}
                  </Link>
                </p>
              </div>
            ) : null}

            {live && user && join.state !== 'failed' ? (
              <p className="gj-wait" role="status">
                {JOIN.opening}
              </p>
            ) : null}

            {join.state === 'failed' ? (
              <div className="gj-failed">
                <div role="alert" className="au-alert gj-alert">
                  {join.message}
                </div>
                {join.retry ? (
                  <button type="button" className="sf-primary gj-retry" onClick={() => void runJoin()}>
                    {JOIN.retry}
                  </button>
                ) : null}
              </div>
            ) : null}

            {problem || join.state === 'failed' ? (
              user ? (
                <p className="gj-next">
                  <Link className="au-link" to="/dashboard">
                    {JOIN.today}
                  </Link>
                </p>
              ) : (
                <div className="gj-next">
                  <Link className="sf-primary" to="/try">
                    {JOIN.example}
                  </Link>
                  <Link className="au-link" to="/">
                    {JOIN.what}
                  </Link>
                </div>
              )
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" fill="#4285F4" />
      <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853" />
      <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29V4.95818H0.957275C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05" />
      <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" fill="#EA4335" />
    </svg>
  );
}
