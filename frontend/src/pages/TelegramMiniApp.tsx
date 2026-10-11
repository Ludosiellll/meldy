import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { track } from '../lib/telemetry';
import {
  bootMiniApp, launchData, markSignedThisLaunch, markUnlinkedThisLaunch, openOutside, signedThisLaunch, unlinkedThisLaunch,
  useMiniApp,
} from '../lib/telegram/miniApp';
import { miniAppSession, signInWithTelegram } from '../api/telegramMiniApp';
import { useContainerData } from '../lib/containers/hooks';
import { usePlan } from '../components/containers/PageState';
import { startTarget } from '../components/containers/actions';
import { loadSession, resumable } from '../components/containers/sessionStore';
import '../components/telegram/miniApp.css';

/**
 * /tg — Meldy as a Telegram Mini App (meldy-notes 10_Project/Telegram_Mini_App_Spec_2026-10-10.md §3, §5 and «Проверка
 * безопасности 2026-10-11»). The bot's menu button opens /tg, the day card and the record after a batch open
 * /tg?c=<exam>; a direct link may name the exam in `startapp`.
 *
 * Only inside a real Telegram client (lib/telegram/miniApp: hasTelegramBridge, then initData): the signed initData goes
 * to the bot's function, once per launch.
 * - Linked: a one-time sign-in (verifyOtp), or none when this WebView is already that account; then «Сегодня», and
 *   with an exam its session of today on top (the exam page's own «Начать»: a session to continue, else the plan's
 *   next one). «Назад» from the session is «Сегодня».
 * - Linked while another Meldy account is open here: one question, never a silent switch.
 * - Not linked: what to do, nothing more. A Telegram is linked only from the profile in the browser («Подключить
 *   Telegram» → the bot's /start L<code>): a launch's initData can be anyone's, put into this page by a link, so this
 *   page never links an account to it.
 * In a plain browser (no Telegram client around the page) nothing of this runs: the page leaves for «Сегодня».
 */
export const WORDS = {
  opening: 'Открываем Meldy…',
  signingIn: 'Входим через Telegram…',
  landing: 'Открываем занятие…',
  unlinkedTitle: (name: string | null) => (name ? `${name}, этот Telegram ещё не подключён к Meldy` : 'Этот Telegram ещё не подключён к Meldy'),
  unlinkedText:
    'Откройте Meldy в браузере, войдите и в профиле нажмите «Подключить Telegram». Потом вернитесь сюда: Meldy будет открываться из Telegram сразу.',
  openProfile: 'Открыть профиль в браузере',
  otherTitle: 'В Meldy уже открыт другой аккаунт',
  otherText: (email: string, current: string | null) =>
    current
      ? `Сейчас открыт аккаунт ${current}. Этот Telegram подключён к аккаунту ${email}.`
      : `Этот Telegram подключён к аккаунту ${email}.`,
  openOther: 'Открыть аккаунт Telegram',
  stay: 'Остаться в текущем',
  retry: 'Повторить',
  openSite: 'Открыть сайт в браузере',
  problems: {
    stale: { title: 'Откройте Meldy заново', text: 'Данные входа из Telegram устарели. Закройте Meldy и откройте снова из чата с ботом.' },
    invalid: { title: 'Не получилось войти через Telegram', text: 'Откройте Meldy из чата с ботом @Meldyteach_bot.' },
    slow_down: { title: 'Слишком много попыток', text: 'Попробуйте позже.' },
    unavailable: { title: 'Meldy сейчас не отвечает', text: 'Попробуйте ещё раз через минуту.' },
    network: { title: 'Нет связи с сервером', text: 'Проверьте интернет и попробуйте ещё раз.' },
  },
} as const;

type Problem = keyof typeof WORDS.problems;
type Phase =
  | { kind: 'wait'; text: string }
  | { kind: 'unlinked' }
  | { kind: 'other'; email: string; tokenHash: string }
  /** retry: the launch may still be unused (no answer, or the server could not answer); never after a sign-in failed. */
  | { kind: 'problem'; problem: Problem; retry: boolean }
  | { kind: 'land' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The exam to open: ?c= of the bot's buttons, else the direct link's `startapp`; only an exam id. */
export function examOfLaunch(search: string, startParam: string | null): string | null {
  let fromAddress: string | null = null;
  try {
    fromAddress = new URLSearchParams(search).get('c');
  } catch {
    fromAddress = null;
  }
  const candidate = fromAddress ?? startParam;
  return candidate && UUID.test(candidate) ? candidate.toLowerCase() : null;
}

const siteUrl = (path: string) => `${window.location.origin}${path}`;

function problemOf(status: string): Problem {
  if (status === 'replayed' || status === 'stale') return 'stale';
  if (status === 'invalid' || status === 'slow_down' || status === 'network') return status;
  return 'unavailable';
}

export default function TelegramMiniApp() {
  useDocumentTitle('Вход через Telegram');
  const mini = useMiniApp();
  const { user, loading } = useAuth();
  const location = useLocation();
  const [phase, setPhase] = useState<Phase>({ kind: 'wait', text: WORDS.opening });
  const started = useRef(false);
  // The launch's signed data: fixed for the page's life (the state object changes only with Telegram's theme).
  const launch = useMemo(() => (mini.status === 'on' ? launchData() : null), [mini.status]);
  const exam = examOfLaunch(location.search, launch?.startParam ?? null);

  // main.tsx boots the Mini App as the app starts; a page that got here first (or a test) starts it the same way.
  useEffect(() => {
    if (mini.status === 'off') void bootMiniApp(location.pathname);
  }, [mini.status, location.pathname]);

  const signIn = useCallback(async (initData: string, have: string | null) => {
    setPhase({ kind: 'wait', text: WORDS.signingIn });
    const result = await miniAppSession(initData, have);
    if (result.status === 'same') {
      markSignedThisLaunch(initData);
      setPhase({ kind: 'land' });
      return;
    }
    if (result.status === 'other') {
      // Another account is open in this WebView: it stays until the student chooses.
      markSignedThisLaunch(initData);
      setPhase({ kind: 'other', email: result.email, tokenHash: result.tokenHash });
      return;
    }
    if (result.status === 'linked') {
      if (await signInWithTelegram(result.tokenHash)) {
        track('login_done', { method: 'telegram' });
        markSignedThisLaunch(initData);
        setPhase({ kind: 'land' });
      } else setPhase({ kind: 'problem', problem: 'unavailable', retry: false });
      return;
    }
    if (result.status === 'unlinked') {
      markUnlinkedThisLaunch(initData);
      setPhase({ kind: 'unlinked' });
      return;
    }
    setPhase({ kind: 'problem', problem: problemOf(result.status), retry: result.status === 'unavailable' || result.status === 'network' });
  }, []);

  // One sign-in per launch, never more: a reload of a launch this tab already used goes straight on (or back to its
  // «not linked»); the server would answer «replayed» anyway.
  useEffect(() => {
    if (started.current || mini.status !== 'on' || loading || !launch) return;
    started.current = true;
    if (user && signedThisLaunch(launch.initData)) {
      setPhase({ kind: 'land' });
      return;
    }
    if (unlinkedThisLaunch(launch.initData)) {
      setPhase({ kind: 'unlinked' });
      return;
    }
    void signIn(launch.initData, user?.id ?? null);
  }, [mini.status, loading, user, launch, signIn]);

  const switchAccount = useCallback(async (tokenHash: string) => {
    setPhase({ kind: 'wait', text: WORDS.signingIn });
    if (await signInWithTelegram(tokenHash)) {
      track('login_done', { method: 'telegram' });
      setPhase({ kind: 'land' });
    } else setPhase({ kind: 'problem', problem: 'unavailable', retry: false });
  }, []);

  if (mini.status === 'outside') return <Navigate to="/dashboard" replace />;

  let body;
  if (phase.kind === 'land') {
    body = user ? <Lander exam={exam} /> : <Waiting text={WORDS.signingIn} />;
  } else if (phase.kind === 'unlinked') {
    body = <Unlinked name={launch?.firstName ?? null} />;
  } else if (phase.kind === 'other') {
    body = (
      <OtherAccount
        email={phase.email}
        current={user?.email ?? null}
        onOpen={() => void switchAccount(phase.tokenHash)}
        onStay={() => setPhase({ kind: 'land' })}
      />
    );
  } else if (phase.kind === 'problem') {
    // «Повторить» only while the launch may be unused: after a failed sign-in the server would say «replayed».
    body = <ProblemView problem={phase.problem} onRetry={phase.retry && launch ? () => void signIn(launch.initData, user?.id ?? null) : null} />;
  } else {
    body = <Waiting text={phase.text} />;
  }

  return (
    <div className="au tg-app">
      <main className="tg-app-main">
        <section className="au-card tg-app-card" aria-live="polite">
          <div className="au-in">{body}</div>
        </section>
      </main>
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <p className="tg-app-wait" role="status">
      {text}
    </p>
  );
}

/** «Сегодня» underneath, and the exam's session of today on top when the launch names an exam. */
function Lander({ exam }: { exam: string | null }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!exam) navigate('/dashboard', { replace: true });
  }, [exam, navigate]);
  return exam ? <ExamLander exam={exam} /> : <Waiting text={WORDS.opening} />;
}

function ExamLander({ exam }: { exam: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const state = useContainerData(exam);
  const plan = usePlan(state.data?.planInput);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || state.loading) return;
    done.current = true;
    navigate('/dashboard', { replace: true });
    if (!state.data || !plan) return;
    const saved = user?.id ? resumable(loadSession(user.id, exam), plan.day) : null;
    const target = startTarget({ containerId: exam, summary: state.data.summary, plan, saved, wide: false });
    // An AI check is an answer aloud (voice stays off here): «Сегодня» offers it as the site does.
    if (target && target.href.startsWith(`/exams/c/${exam}/study`)) navigate(target.href);
  }, [state.loading, state.data, plan, user?.id, exam, navigate]);
  return <Waiting text={WORDS.landing} />;
}

/** Not linked: how to link it on the site, and the way there. Nothing here links an account. */
function Unlinked({ name }: { name: string | null }) {
  return (
    <>
      <h1 className="au-h1">{WORDS.unlinkedTitle(name)}</h1>
      <p className="au-lede">{WORDS.unlinkedText}</p>
      <div className="tg-app-acts">
        <button type="button" className="sf-primary au-submit" onClick={() => openOutside(siteUrl('/profile#telegram'))}>
          {WORDS.openProfile}
        </button>
      </div>
    </>
  );
}

/** Another account is open in this WebView: switch only when asked (the e-mail is the linked account's). */
function OtherAccount({ email, current, onOpen, onStay }: { email: string; current: string | null; onOpen: () => void; onStay: () => void }) {
  return (
    <>
      <h1 className="au-h1">{WORDS.otherTitle}</h1>
      <p className="au-lede">{WORDS.otherText(email, current)}</p>
      <div className="tg-app-acts">
        <button type="button" className="sf-primary au-submit" onClick={onOpen}>
          {WORDS.openOther}
        </button>
        <button type="button" className="au-link" onClick={onStay}>
          {WORDS.stay}
        </button>
      </div>
    </>
  );
}

function ProblemView({ problem, onRetry }: { problem: Problem; onRetry: (() => void) | null }) {
  const words = WORDS.problems[problem];
  return (
    <>
      <h1 className="au-h1">{words.title}</h1>
      <p className="au-lede">{words.text}</p>
      <div className="tg-app-acts">
        {onRetry ? (
          <button type="button" className="sf-primary au-submit" onClick={onRetry}>
            {WORDS.retry}
          </button>
        ) : null}
        <button type="button" className="au-link" onClick={() => openOutside(siteUrl('/dashboard'))}>
          {WORDS.openSite}
        </button>
      </div>
    </>
  );
}
