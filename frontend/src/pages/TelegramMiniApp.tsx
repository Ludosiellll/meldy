import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { track } from '../lib/telemetry';
import { validateEmail } from '../utils/validators';
import { browserZone } from '../lib/telegram/links';
import {
  bootMiniApp, launchData, markSignedThisLaunch, markUnlinkedThisLaunch, openOutside, signedThisLaunch, unlinkedThisLaunch,
  useMiniApp,
} from '../lib/telegram/miniApp';
import { miniAppLink, miniAppSession, signInWithTelegram, type MiniAppLinkStatus } from '../api/telegramMiniApp';
import { useContainerData } from '../lib/containers/hooks';
import { usePlan } from '../components/containers/PageState';
import { startTarget } from '../components/containers/actions';
import { loadSession, resumable } from '../components/containers/sessionStore';
import '../components/telegram/miniApp.css';

/**
 * /tg — Meldy as a Telegram Mini App (meldy-notes 10_Project/Telegram_Mini_App_Spec_2026-10-10.md §3, §5). The bot's
 * menu button opens /tg, the day card and the record after a batch open /tg?c=<exam>; a direct link may name the exam
 * in `startapp`.
 *
 * Inside Telegram (lib/telegram/miniApp: the script, initData): the signed initData goes to the bot's function.
 * - Linked: a one-time sign-in (verifyOtp) — or none, when this WebView is already signed in as that account — then
 *   «Сегодня», and with an exam its session of today on top (the exam page's own «Начать»: a session to continue, else
 *   the plan's next one). «Назад» from the session is «Сегодня».
 * - Not linked: sign-in by e-mail and password here (Google refuses embedded WebViews: its way is the profile in the
 *   browser, «Подключить Telegram»), then one call links this Telegram to the account — no six-digit code.
 * Outside Telegram nothing of this runs: the page leaves for «Сегодня».
 */
export const WORDS = {
  opening: 'Открываем Meldy…',
  signingIn: 'Входим через Telegram…',
  linking: 'Подключаем Telegram…',
  landing: 'Открываем занятие…',
  formTitle: 'Войдите в Meldy',
  formLede: 'Один раз по почте и паролю. Потом Meldy будет открываться из Telegram сразу.',
  email: 'Почта',
  password: 'Пароль',
  submit: 'Войти',
  submitting: 'Входим…',
  emailMissing: 'Введите почту.',
  passwordMissing: 'Введите пароль.',
  forgot: 'Забыли пароль?',
  noAccount: 'Нет аккаунта?',
  register: 'Создать на сайте',
  googleNote: 'Входите через Google? Внутри Telegram он не работает. Откройте профиль Meldy в браузере, нажмите «Подключить Telegram» и вернитесь сюда.',
  googleButton: 'Открыть профиль в браузере',
  confirmTitle: 'Подключить этот Telegram?',
  confirmLede: (email: string) => `Вы вошли в Meldy как ${email}. Telegram будет открывать этот аккаунт сразу, а бот — присылать в него план на день.`,
  confirm: 'Подключить',
  otherAccount: 'Войти в другой аккаунт',
  badCredentials: 'Неверная почта или пароль.',
  notConfirmed: 'Почта не подтверждена: откройте ссылку из письма Meldy.',
  signInFailed: 'Не получилось войти. Попробуйте ещё раз.',
  signedOut: 'Вход не сохранился. Войдите ещё раз.',
  retry: 'Повторить',
  openSite: 'Открыть сайт в браузере',
  problems: {
    stale: { title: 'Откройте Meldy заново', text: 'Данные входа из Telegram устарели. Закройте Meldy и откройте снова из чата с ботом.' },
    invalid: { title: 'Не получилось войти через Telegram', text: 'Откройте Meldy из чата с ботом @Meldyteach_bot.' },
    slow_down: { title: 'Слишком много попыток', text: 'Попробуйте позже.' },
    unavailable: { title: 'Meldy сейчас не отвечает', text: 'Попробуйте ещё раз через минуту.' },
    network: { title: 'Нет связи с сервером', text: 'Проверьте интернет и попробуйте ещё раз.' },
    linked_elsewhere: {
      title: 'Этот Telegram подключён к другому аккаунту',
      text: 'Чтобы подключить его к этому, сначала отключите его командой /stop в чате с ботом.',
    },
  },
} as const;

type Problem = keyof typeof WORDS.problems;
type Phase =
  | { kind: 'wait'; text: string }
  | { kind: 'form'; error: string | null }
  | { kind: 'confirm'; error: string | null }
  | { kind: 'problem'; problem: Problem }
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
  if (status === 'invalid' || status === 'slow_down' || status === 'network' || status === 'linked_elsewhere') return status;
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
    if (result.status === 'linked') {
      if (await signInWithTelegram(result.tokenHash)) {
        track('login_done', { method: 'telegram' });
        markSignedThisLaunch(initData);
        setPhase({ kind: 'land' });
      } else setPhase({ kind: 'problem', problem: 'unavailable' });
      return;
    }
    if (result.status === 'unlinked') {
      markUnlinkedThisLaunch(initData);
      setPhase(have ? { kind: 'confirm', error: null } : { kind: 'form', error: null });
      return;
    }
    setPhase({ kind: 'problem', problem: problemOf(result.status) });
  }, []);

  // One sign-in per launch: a reload of this launch, already signed in here, goes straight on; a reload of the sign-in
  // form goes back to it (the server spent this initData on «not linked»; linking takes it once more).
  useEffect(() => {
    if (started.current || mini.status !== 'on' || loading || !launch) return;
    started.current = true;
    if (user && signedThisLaunch(launch.initData)) {
      setPhase({ kind: 'land' });
      return;
    }
    if (unlinkedThisLaunch(launch.initData)) {
      setPhase(user ? { kind: 'confirm', error: null } : { kind: 'form', error: null });
      return;
    }
    void signIn(launch.initData, user?.id ?? null);
  }, [mini.status, loading, user, launch, signIn]);

  const link = useCallback(async () => {
    if (!launch) return;
    setPhase({ kind: 'wait', text: WORDS.linking });
    const status: MiniAppLinkStatus = await miniAppLink(launch.initData, browserZone());
    if (status === 'linked') {
      markSignedThisLaunch(launch.initData);
      setPhase({ kind: 'land' });
    } else if (status === 'signed_out') setPhase({ kind: 'form', error: WORDS.signedOut });
    else setPhase({ kind: 'problem', problem: problemOf(status) });
  }, [launch]);

  if (mini.status === 'outside') return <Navigate to="/dashboard" replace />;

  let body;
  if (phase.kind === 'land') {
    body = user ? <Lander exam={exam} /> : <Waiting text={WORDS.signingIn} />;
  } else if (phase.kind === 'form') {
    body = <SignInForm error={phase.error} onSignedIn={link} />;
  } else if (phase.kind === 'confirm') {
    body = (
      <Confirm
        email={user?.email ?? ''}
        onConfirm={link}
        onOther={async () => {
          await supabase.auth.signOut({ scope: 'local' });
          setPhase({ kind: 'form', error: null });
        }}
      />
    );
  } else if (phase.kind === 'problem') {
    body = (
      <ProblemView
        problem={phase.problem}
        onRetry={launch && (phase.problem === 'unavailable' || phase.problem === 'network') ? () => void signIn(launch.initData, user?.id ?? null) : null}
      />
    );
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

function SignInForm({ error, onSignedIn }: { error: string | null; onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(error);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    const wrong = address ? validateEmail(address) : WORDS.emailMissing;
    if (wrong) {
      setEmailError(wrong);
      return;
    }
    setEmailError(null);
    if (!password) {
      setProblem(WORDS.passwordMissing);
      return;
    }
    setProblem(null);
    setBusy(true);
    let failure: { message?: string } | null = null;
    try {
      ({ error: failure } = await supabase.auth.signInWithPassword({ email: address, password }));
    } catch {
      failure = { message: '' };
    }
    setBusy(false);
    if (failure) {
      const message = failure.message ?? '';
      setProblem(/invalid login credentials/i.test(message) ? WORDS.badCredentials : /not confirmed/i.test(message) ? WORDS.notConfirmed : WORDS.signInFailed);
      return;
    }
    track('login_done', { method: 'email' });
    await onSignedIn();
  };

  return (
    <>
      <h1 className="au-h1">{WORDS.formTitle}</h1>
      <p className="au-lede">{WORDS.formLede}</p>
      {problem ? (
        <div role="alert" className="au-alert">
          {problem}
        </div>
      ) : null}
      <form className="au-form" onSubmit={submit} noValidate>
        <div className="au-field">
          <label htmlFor="tg-email" className="au-label">
            {WORDS.email}
          </label>
          <input
            id="tg-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            className="au-input"
            value={email}
            aria-invalid={emailError ? 'true' : undefined}
            aria-describedby={emailError ? 'tg-email-error' : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setEmailError(validateEmail(event.target.value.trim()) || null);
            }}
          />
          {emailError ? (
            <p id="tg-email-error" role="alert" className="au-hint au-hint--error">
              {emailError}
            </p>
          ) : null}
        </div>
        <div className="au-field">
          <label htmlFor="tg-password" className="au-label">
            {WORDS.password}
          </label>
          <input
            id="tg-password"
            type="password"
            autoComplete="current-password"
            required
            className="au-input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" className="sf-primary au-submit" disabled={busy} data-busy={busy ? '' : undefined}>
          {busy ? WORDS.submitting : WORDS.submit}
        </button>
      </form>
      <p className="au-foot tg-app-links">
        <button type="button" className="au-link" onClick={() => openOutside(siteUrl('/forgot-password'))}>
          {WORDS.forgot}
        </button>
        <span>
          {WORDS.noAccount}{' '}
          <button type="button" className="au-link" onClick={() => openOutside(siteUrl('/register'))}>
            {WORDS.register}
          </button>
        </span>
      </p>
      <div className="tg-app-google">
        <p className="tg-app-note">{WORDS.googleNote}</p>
        <button type="button" className="sf-secondary tg-app-out" onClick={() => openOutside(siteUrl('/profile#telegram'))}>
          {WORDS.googleButton}
        </button>
      </div>
    </>
  );
}

function Confirm({ email, onConfirm, onOther }: { email: string; onConfirm: () => Promise<void>; onOther: () => Promise<void> }) {
  return (
    <>
      <h1 className="au-h1">{WORDS.confirmTitle}</h1>
      <p className="au-lede">{WORDS.confirmLede(email)}</p>
      <div className="tg-app-acts">
        <button type="button" className="sf-primary au-submit" onClick={() => void onConfirm()}>
          {WORDS.confirm}
        </button>
        <button type="button" className="au-link" onClick={() => void onOther()}>
          {WORDS.otherAccount}
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
