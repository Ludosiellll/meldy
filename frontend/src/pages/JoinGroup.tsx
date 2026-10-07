import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { joinShare, previewShare, ShareApiError, type SharePreview } from '../api/examShares';
import { detectInAppBrowser } from '../lib/inAppBrowser';
import InAppNote from '../components/InAppNote';
import {
  forgetPendingJoin,
  joinPath,
  normalizeJoinCode,
  oauthRedirectTo,
  rememberPendingJoin,
  withReturn,
} from '../lib/returnTo';
import { deferGuideOnce } from '../components/guide/guideLater';
import { track } from '../lib/telemetry';
import { rememberGroupLink } from '../lib/groups/groupLinks';
import './JoinGroup.css';

/**
 * /join/<код> — the invitation of a group link (2026-10-07). Open without an account: «Вас пригласили
 * готовиться к экзамену «…» в Meldy», sign-in with Google first and by e-mail second; the way back to this page
 * travels in the address (lib/returnTo). Inside a real embedded WebView (lib/inAppBrowser: Telegram Mini Apps, the
 * browsers of Instagram and Facebook) Google usually refuses to sign in and the microphone may be missing, so there
 * the page first asks to open the link in Chrome or Safari («Скопировать ссылку», on Android a link straight into
 * Chrome, on iPhone where to tap). A link Telegram opens in a Custom Tab or SFSafariViewController gets Google.
 * Signed in, the page joins at once and opens the classmate's own copy on its cheat sheet; the mandatory guide
 * waits for a later visit (components/guide/guideLater). The author on their own open link: this device keeps its
 * code for «Вопрос дня» (lib/groups/groupLinks.ts), as the device where the link was made does.
 */

type PreviewState = { state: 'loading' } | { state: 'ready'; value: SharePreview } | { state: 'error'; message: string };
type JoinState = { state: 'idle' } | { state: 'joining' } | { state: 'failed'; message: string; retry: boolean };

const NBSP = '\u00a0';

// Refusals that another try does not change: the link itself says no.
const FINAL_CODES = new Set(['link_not_found', 'link_revoked', 'link_expired', 'link_full', 'own_link']);

const KIND_WORDS: Record<SharePreview['kind'], string> = {
  exam: 'экзамену',
  credit: 'зачёту',
  colloquium: 'коллоквиуму',
};

function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100;
  if (n >= 11 && n <= 14) return many;
  const last = n % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const moment = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(moment.getTime())) return null;
  return moment.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// The author on their own link (2026-10-07 live run: a closed link still read «Однокурсники, которые по ней войдут…»).
const OWN_HEADINGS: Record<NonNullable<SharePreview['link']> | 'unknown', string> = {
  active: 'Это ваша ссылка',
  revoked: 'Вы закрыли эту ссылку',
  expired: 'Срок вашей ссылки закончился',
  unknown: 'Это ваша ссылка',
};

const NEW_LINK = 'Новую ссылку можно сделать на странице экзамена — кнопка «Пригласить группу».';

function ownLede(value: SharePreview): string {
  switch (value.link) {
    case 'active':
      return `Однокурсники, которые по ней войдут, получат свою копию экзамена «${value.title}». Ваши ответы они не увидят.`;
    case 'revoked':
    case 'expired':
      return `По ней больше никто не войдёт. Кто уже вошёл, остался со своей копией экзамена «${value.title}». ${NEW_LINK}`;
    default:
      return `Однокурсники входят по ней в свою копию экзамена «${value.title}», пока ссылка открыта. Закрыть её или сделать новую можно на странице экзамена — кнопка «Пригласить группу».`;
  }
}

function statusMessage(status: SharePreview['status']): string | null {
  switch (status) {
    case 'not_found':
      return 'Ссылка не найдена. Проверьте, что она скопирована целиком.';
    case 'revoked':
      return 'Автор закрыл эту ссылку. Попросите у него новую.';
    case 'expired':
      return 'Срок действия ссылки закончился. Попросите у автора новую.';
    case 'full':
      return 'По этой ссылке мест больше нет: все места заняты.';
    default:
      return null;
  }
}

export default function JoinGroup() {
  const params = useParams();
  const code = normalizeJoinCode(params.code);
  const navigate = useNavigate();
  const { user, loading, requestSession } = useAuth();
  const browser = useMemo(() => detectInAppBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent), []);
  const [preview, setPreview] = useState<PreviewState>({ state: 'loading' });
  const [join, setJoin] = useState<JoinState>({ state: 'idle' });
  const started = useRef<string | null>(null);
  const pageUrl = code ? `${window.location.origin}${joinPath(code)}` : window.location.href;

  useEffect(() => {
    requestSession?.();
    track('group_join_view', { inapp: browser.app ?? 'none' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed in on the invitation itself: the code waiting on this device (App.tsx PendingJoin) has brought the
  // visitor here. Whatever the link says now (closed, own, a failed try), «Сегодня» must not send them back again.
  useEffect(() => {
    if (user) forgetPendingJoin();
  }, [user]);

  // The preview waits for the session: a signed-in visitor's token tells «own» and «joined» apart.
  useEffect(() => {
    if (!code || loading) return undefined;
    let live = true;
    setPreview({ state: 'loading' });
    previewShare(code).then(
      (value) => {
        if (live) setPreview({ state: 'ready', value });
      },
      (error: unknown) => {
        if (live) setPreview({ state: 'error', message: error instanceof Error ? error.message : 'Не получилось открыть приглашение.' });
      },
    );
    return () => {
      live = false;
    };
  }, [code, loading, user?.id]);

  const runJoin = useCallback(async () => {
    if (!code) return;
    setJoin({ state: 'joining' });
    try {
      const result = await joinShare(code);
      deferGuideOnce();
      track('group_join_done', { again: !result.joined, without_points: result.withoutPoints > 0 });
      navigate(`/exams/${result.examId}?view=sheet`, { replace: true });
    } catch (error) {
      const failure = error instanceof ShareApiError ? error : null;
      const retry = !failure?.code || !FINAL_CODES.has(failure.code);
      track('group_join_failed', { code: failure?.code ?? 'unknown' });
      setJoin({
        state: 'failed',
        message: error instanceof Error ? error.message : 'Не получилось открыть экзамен. Попробуйте ещё раз.',
        retry,
      });
    }
  }, [code, navigate]);

  // The author's own open link opened here (say, from the group's chat): «Вопрос дня» can carry it from this device.
  const [kept, setKept] = useState(false);
  useEffect(() => {
    if (!code || preview.state !== 'ready') return;
    const { status, link, examId } = preview.value;
    if (status === 'own' && link === 'active' && examId) setKept(rememberGroupLink(examId, code));
  }, [code, preview]);

  // Signed in and the link is live (or already joined): straight to the copy.
  useEffect(() => {
    if (!code || !user || preview.state !== 'ready') return;
    const { status } = preview.value;
    if (status !== 'active' && status !== 'joined') return;
    const key = `${user.id}:${code}`;
    if (started.current === key) return;
    started.current = key;
    void runJoin();
  }, [code, user, preview, runJoin]);

  const google = async () => {
    if (!code) return;
    rememberPendingJoin(code);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: oauthRedirectTo(window.location.origin, joinPath(code)) },
    });
  };

  const back = code ? joinPath(code) : null;
  const value = preview.state === 'ready' ? preview.value : null;
  const live = value && (value.status === 'active' || value.status === 'joined');
  const problem = !code
    ? 'Ссылка неполная. Проверьте, что она скопирована целиком.'
    : preview.state === 'error'
      ? preview.message
      : value
        ? statusMessage(value.status)
        : null;
  // «20 вопросов · 3 лекции · экзамен 21 октября»: each part holds together, a row breaks only after a dot (on a
  // phone «экзамен 21 / октября» split the date, live run of 2026-10-07).
  const meta = value && live
    ? [
        value.questions > 0 ? `${value.questions} ${plural(value.questions, 'вопрос', 'вопроса', 'вопросов')}` : null,
        value.lectures > 0 ? `${value.lectures} ${plural(value.lectures, 'лекция', 'лекции', 'лекций')}` : null,
        dayOf(value.examDate) ? `${value.kind === 'credit' ? 'зачёт' : value.kind === 'colloquium' ? 'коллоквиум' : 'экзамен'} ${dayOf(value.examDate)}` : null,
      ]
        .filter((part): part is string => Boolean(part))
        .map((part) => part.replace(/\s/g, NBSP))
        .join(`${NBSP}· `)
    : '';

  return (
    <div className="au jg">
      <header className="au-bar">
        <Link to="/" className="au-logo">
          Meldy
        </Link>
      </header>
      <main className="jg-main">
        <section className="au-card jg-card" aria-labelledby="join-title">
          <div className="au-in">
            {value && live ? (
              <>
                <h1 id="join-title" className="au-h1 jg-h1">
                  Вас пригласили готовиться к {KIND_WORDS[value.kind]} «{value.title}» в Meldy
                </h1>
                {meta && <p className="jg-meta">{meta}</p>}
                <p className="au-lede">
                  У вас будет своя копия: вопросы, текст лекций и шпаргалка с пунктами ответа. Отвечаете вслух — строки
                  стираются. Ваши ответы видите только вы.
                </p>
              </>
            ) : value && value.status === 'own' ? (
              <>
                <h1 id="join-title" className="au-h1 jg-h1">
                  {OWN_HEADINGS[value.link ?? 'unknown']}
                </h1>
                <p className="au-lede">{ownLede(value)}</p>
                {kept && value.link === 'active' && (
                  <p className="jg-kept">На этом устройстве Meldy запомнил ссылку: «Вопрос дня» теперь копируется вместе с ней.</p>
                )}
                {value.examId && (
                  <p className="jg-actions">
                    <Link className="sf-primary" to={`/exams/${value.examId}`}>
                      Открыть экзамен
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <h1 id="join-title" className="au-h1 jg-h1">
                {problem ? 'Приглашение не открылось' : 'Открываем приглашение…'}
              </h1>
            )}

            {problem && (
              <div role="alert" className="au-alert">
                {problem}
              </div>
            )}

            {browser.app && code && !problem && <InAppNote browser={browser} url={pageUrl} />}

            {live && !user && !loading && back && (
              <div className="jg-signin">
                {!browser.app && (
                  <>
                    <button type="button" onClick={() => void google()} className="au-oauth">
                      <GoogleMark />
                      Войти через Google
                    </button>
                    <div className="au-or">или</div>
                  </>
                )}
                <p className="jg-mail">
                  <Link className="au-link" to={withReturn('/login', back)} onClick={() => rememberPendingJoin(code!)}>
                    {browser.app ? 'Войти по почте здесь' : 'Войти по почте'}
                  </Link>
                  <span aria-hidden="true"> · </span>
                  <Link className="au-link" to={withReturn('/register', back)} onClick={() => rememberPendingJoin(code!)}>
                    Создать аккаунт
                  </Link>
                </p>
              </div>
            )}

            {live && user && join.state !== 'failed' && (
              <p className="jg-wait" role="status">
                Готовим вашу копию экзамена…
              </p>
            )}

            {join.state === 'failed' && (
              <div className="jg-failed">
                <div role="alert" className="au-alert">
                  {join.message}
                </div>
                {join.retry && (
                  <button type="button" className="sf-primary jg-retry" onClick={() => void runJoin()}>
                    Попробовать ещё раз
                  </button>
                )}
              </div>
            )}

            {(problem || join.state === 'failed') && (
              <p className="au-foot">
                <Link className="au-link" to={user ? '/dashboard' : '/'}>
                  {user ? 'На «Сегодня»' : 'Что такое Meldy'}
                </Link>
              </p>
            )}
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
