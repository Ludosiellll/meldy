import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { claimGuestAttempts, joinPractice, previewAsGuest, previewQuiz, quizResult, startQuiz } from '../../api/quizzes';
import { CONTAINER_ERROR_TEXT } from '../../api/containers';
import { coverUrl } from '../../api/itemPictures';
import InAppNote from '../../components/InAppNote';
import QuizRun from '../../components/quiz/QuizRun';
import QuizResultView from '../../components/quiz/QuizResult';
import { RESULT, TAKE } from '../../components/quiz/copyTake';
import { useDark } from '../../components/studio/useDark';
import { detectInAppBrowser } from '../../lib/inAppBrowser';
import { dropGuestToken, ensureGuestToken, guestToken } from '../../lib/quizzes/guestToken';
import { designDoc, startCover } from '../../lib/quizzes/design';
import { dateTimeText, pointsOf } from '../../lib/quizzes/quizModel';
import { themeTokens } from '../../lib/studio/contrast';
import { normalizeJoinCode, withReturn } from '../../lib/returnTo';
import { track } from '../../lib/telemetry';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { QUIZ_ACCENTS, type QuizAccent, type QuizAttempt, type QuizPreview, type QuizPreviewMe, type QuizResult } from '../../types/quiz';
import type { TestDoc } from '../../types/testDoc';
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
 *
 * Release 47 (spec 2026-10-18 §47.1, §47.4, §47.5; plan docs/superpowers/plans/2026-10-18-test-builder-r47.md):
 * - a quiz open to guests (preview.guests) is written without signing in: the name and «Начать»; the device's token
 *   (lib/quizzes/guestToken.ts) is made at the start and goes with every call, the preview with it brings that
 *   device's «me» (the attempt in progress, the earlier results). The line about the author says the attempts live in
 *   this browser; «Войти» stays for those with an account;
 * - signed in with a token of this quiz on the device (not the quiz's author): nothing moves by itself — a computer may
 *   be shared. A card above the start says the device holds an attempt without an account, with the time of the last
 *   one (the guest's «me» has no name), and asks: «Это я — перенести в аккаунт» (quiz_guest_claim, then the token goes)
 *   or «Это не я» (the token goes). The device's attempts are read as its guest reads them (previewAsGuest);
 * - a guest whose device holds attempts: «Я другой человек» forgets the token here and opens a fresh start;
 * - back from making an account for «Тренироваться» (?practice=1): that person has just pressed the button on their own
 *   result, so the claim runs by itself, then quiz_practice_join, then the exam;
 * - the author's cover on top of the card and the quiz's colour on the page's root (data-accent, quizTake.css).
 *
 * The start fits a laptop's 734 px and a phone's 844 px with «Начать» in view: a low cover band, the title, the author,
 * the facts on one line (dates kept whole), then the name («Имя и фамилия — их увидит <автор>»; the author on their own
 * page — «Имя и фамилия») and the button; the rules and the line about what the author sees come under the button. The
 * line under the title leaves out the exam when its title is the quiz's own (release 47.1).
 *
 * A quiz «как в студии» (release 47.2: the preview, the attempt and the result carry the studio's page as `design`): the
 * page's theme is the page's colours everywhere — the start, the attempt (QuizRun draws the page: QuizDocRun) and the
 * result (lib/studio/contrast.ts themeTokens on each root: the accent nudged for contrast, the font, the corners, the
 * background) — and the quiz's own cover and colour give way to it. The page's cover (its first cover block) is the
 * start: its title, the line under it and its picture. A picture background (the author's own photo or a ready one)
 * stands behind the start's card and behind the result, which then sits on the page's surface as a card (owner,
 * 2026-10-19: «на фон тоже почему нельзя своё»).
 */

type PreviewState = { state: 'loading' } | { state: 'ready'; value: QuizPreview } | { state: 'error'; message: string };
/** Attempts written on this device without an account, seen while signed in: the token and the last one's time. */
type Device = { token: string; when: string | null };
/** `token` — the device's token of a guest's attempt, null when signed in. */
type Stage = { kind: 'preview' } | { kind: 'run'; attempt: QuizAttempt; token: string | null } | { kind: 'result'; result: QuizResult; token: string | null };

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

/** The quiz's colour as the server names it; anything else is Meldy's blue. */
function accentOf(value: unknown): QuizAccent {
  return QUIZ_ACCENTS.find((accent) => accent === value) ?? 'blue';
}

/**
 * The root of a screen of a quiz «как в студии»: the page's theme as custom properties (the quiz page's --qt-* names and
 * the page's --doc-*), and the colour named for the rules that go by name (graphite's dark arrow). Any other quiz: its
 * own colour.
 */
function lookOf(doc: TestDoc | null, accent: QuizAccent, dark: boolean): { 'data-accent': QuizAccent; 'data-design'?: ''; 'data-bg'?: string; style?: CSSProperties } {
  if (!doc) return { 'data-accent': accent };
  const named = typeof doc.theme.accent === 'string' ? accentOf(doc.theme.accent) : 'blue';
  return { 'data-accent': named, 'data-design': '', 'data-bg': doc.theme.background.kind, style: themeTokens(doc.theme, dark) as CSSProperties };
}

/** «2 из 3», or the page's points when they differ from the count («6 баллов из 8»). */
function pastScore(row: { correct: number; total: number; score?: number; max_score?: number }): string {
  const points = pointsOf(row);
  return points.weighted ? RESULT.points(points.score, points.max) : RESULT.score(row.correct, row.total);
}

/**
 * The page's own picture behind a screen of a quiz «как в студии» (the start and the result; the attempt is the page
 * itself, DocView draws it): fixed under its darkening, so the card scrolls over it. Nothing for any other background.
 */
function Backdrop({ doc }: { doc: TestDoc | null }) {
  if (!doc || doc.theme.background.kind !== 'image') return null;
  return (
    <div className="qt-bg" aria-hidden="true">
      <img src={coverUrl(doc.theme.background.path)} alt="" decoding="async" />
      <span className="qt-bg-dim" />
    </div>
  );
}

/** The author's cover: a band of a fixed height (nothing moves when it arrives); a picture that fails goes away. */
function Cover({ path }: { path: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="qt-cover">
      <img src={coverUrl(path)} alt="" decoding="async" onError={() => setFailed(true)} />
    </div>
  );
}

/** Two titles that differ only in case and spaces («Проверка  выпуска» and «проверка выпуска») are the same one. */
function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const plain = (text: string | null | undefined) => (text ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  return plain(a) !== '' && plain(a) === plain(b);
}

function windowWords(value: QuizPreview): string | null {
  if (value.status === 'closed') return TAKE.closedWord;
  if (value.status === 'not_yet' && value.opens_at) return TAKE.opensAt(dateTimeText(value.opens_at));
  if (value.closes_at) return TAKE.openUntil(dateTimeText(value.closes_at));
  return null;
}

/** The device's guest attempts as its guest «me» lists them: none — null; else the time of the last finished one. */
function deviceOf(token: string, guest: QuizPreview | null): Device | null {
  const me = guest?.me;
  if (!me || !(me.attempts_used > 0)) return null;
  const times = (me.results ?? []).map((row) => row.finished_at).filter((at) => typeof at === 'string' && !Number.isNaN(Date.parse(at)));
  const when = times.length > 0 ? times.reduce((last, at) => (Date.parse(at) > Date.parse(last) ? at : last)) : null;
  return { token, when };
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
  const location = useLocation();
  const navigate = useNavigate();
  const code = normalizeJoinCode(params.code);
  const { user, loading, requestSession } = useAuth();
  const dark = useDark();
  const browser = useMemo(() => detectInAppBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent), []);
  const [preview, setPreview] = useState<PreviewState>({ state: 'loading' });
  const [reload, setReload] = useState(0);
  const [stage, setStage] = useState<Stage>({ kind: 'preview' });
  const [name, setName] = useState<string | null>(null);
  const [nameBad, setNameBad] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<{ text: string; signIn: boolean } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  // A token whose attempts stayed (the account writes this quiz itself): not asked about again on this page.
  const deviceKept = useRef<string | null>(null);
  const nameId = useId();
  const hintId = useId();
  const deviceId = useId();
  // Back from making an account for «Тренироваться» (QuizResult): the address says so once, at the arrival.
  const practiceAsked = useRef(new URLSearchParams(location.search).get('practice') === '1');
  const practiceDone = useRef(false);
  const practiceJoin = useRef<Promise<{ container_id: string }> | null>(null);
  const claim = useRef<{ key: string; done: Promise<void> } | null>(null);
  const back = code ? `/k/${code}` : null;
  const pageUrl = back ? `${window.location.origin}${back}` : window.location.href;

  const value = preview.state === 'ready' ? preview.value : null;
  useDocumentTitle(value?.title || TAKE.docTitle);

  useEffect(() => {
    requestSession?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The preview waits for the session: a signed-in visitor's token brings «me» (the name, the attempts, the reason); a
  // visitor without one passes the device's token of this quiz, if it holds one.
  useEffect(() => {
    if (!code || loading) return undefined;
    let live = true;
    const load = async (): Promise<{ preview: QuizPreview; device: Device | null } | null> => {
      if (!user) return { preview: await previewQuiz(code, guestToken(code)), device: null };
      if (practiceAsked.current && !practiceDone.current) {
        // Back from making an account to train: the device's attempts become this account's at once, once per sign-in
        // (the promise is kept, so a second run of this effect waits for the same claim instead of asking again).
        const key = `${user.id}:${code}`;
        const held = guestToken(code);
        if (held && claim.current?.key !== key) {
          claim.current = {
            key,
            done: claimGuestAttempts(code, held).then(
              (taken) => {
                if (taken.claimed > 0) dropGuestToken(code);
              },
              () => undefined,
            ),
          };
        }
        if (claim.current?.key === key) await claim.current.done;
        practiceJoin.current ??= joinPractice(code);
        try {
          const joined = await practiceJoin.current;
          if (!live) return null;
          practiceDone.current = true;
          navigate(`/exams/c/${joined.container_id}`, { replace: true });
          return null;
        } catch (error) {
          if (!live) return null;
          practiceDone.current = true;
          setProblem({ text: messageOf(error), signIn: SIGNED_OUT.has(codeOf(error)) });
        }
      }
      // Attempts written here without an account stay where they are until the person says they are theirs (a computer
      // may be shared); a failed read of them only leaves the question out.
      const held = guestToken(code);
      const asked = held && held !== deviceKept.current ? held : null;
      const [preview, guestView] = await Promise.all([
        previewQuiz(code),
        asked ? previewAsGuest(code, asked).catch(() => null) : Promise.resolve(null),
      ]);
      return { preview, device: asked ? deviceOf(asked, guestView) : null };
    };
    load().then(
      (next) => {
        if (live && next) {
          setPreview({ state: 'ready', value: next.preview });
          setDevice(next.device);
        }
      },
      (error: unknown) => {
        if (live) setPreview({ state: 'error', message: messageOf(error) });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, loading, user?.id, reload]);

  const me = value?.me ?? null;
  // Signed out on a quiz open to guests: the server gives this device's «me» (none when the quiz wants an account).
  const guest = !user && !loading && value?.guests === true && me !== null;
  const typedName = name ?? me?.name_hint ?? '';
  const accent = accentOf(value?.accent);
  const design = useMemo(() => designDoc(value?.design), [value?.design]);
  const cover = design ? startCover(design) : null;
  // A quiz «как в студии» shows the page's cover picture (or none), never the quiz's own.
  const coverPath = design ? cover?.image ?? null : value?.cover_path ?? null;
  const runDesign = useMemo(() => (stage.kind === 'run' ? designDoc(stage.attempt.design) : stage.kind === 'result' ? designDoc(stage.result.design) : null), [stage]);

  const toStart = (message: string | null = null) => {
    setStage({ kind: 'preview' });
    setProblem(message ? { text: message, signIn: false } : null);
    setReload((n) => n + 1);
  };
  const say = (error: unknown) => setProblem({ text: messageOf(error), signIn: SIGNED_OUT.has(codeOf(error)) });

  // «Это я — перенести в аккаунт»: the device's attempts become the account's; the token goes once something moved.
  const claimDevice = async () => {
    if (!code || !device || claiming) return;
    setClaiming(true);
    setProblem(null);
    try {
      const taken = await claimGuestAttempts(code, device.token);
      if (taken.claimed > 0) {
        dropGuestToken(code);
        setDeviceNote(null);
      } else {
        deviceKept.current = device.token;
        setDeviceNote(TAKE.deviceKept);
      }
      setDevice(null);
      setReload((n) => n + 1);
    } catch (error) {
      say(error);
    } finally {
      setClaiming(false);
    }
  };
  // «Это не я»: the device forgets those attempts' token; the account keeps nothing of them.
  const notMine = () => {
    if (!code || claiming) return;
    dropGuestToken(code);
    setDevice(null);
    setDeviceNote(null);
  };
  // «Я другой человек» (a guest): the device forgets its token for this quiz; a fresh start, the name field empty.
  const otherPerson = () => {
    if (!code || starting) return;
    dropGuestToken(code);
    setName(null);
    setNameBad(false);
    setProblem(null);
    setReload((n) => n + 1);
  };

  const begin = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!code || !me || starting || (!user && !guest)) return;
    const resume = Boolean(me.open_attempt);
    const trimmed = typedName.trim();
    if (!resume && (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX)) {
      setNameBad(true);
      return;
    }
    setNameBad(false);
    setProblem(null);
    setStarting(true);
    // A guest's token is made at the first start and kept on the device for this quiz.
    const token = user ? null : ensureGuestToken(code);
    try {
      // Going on with an attempt the server keeps its name; the one typed here only names a new attempt.
      const attempt = await startQuiz(code, trimmed || me.name_hint || '', token);
      track('quiz.started', { resumed: resume || attempt.answers.length > 0, guest: token !== null });
      setStage({ kind: 'run', attempt, token });
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
    const token = user || !code ? null : guestToken(code);
    try {
      const result = await quizResult(attemptId, token);
      setStage({ kind: 'result', result, token });
    } catch (error) {
      say(error);
    } finally {
      setOpening(null);
    }
  };

  if (stage.kind === 'run') {
    const token = stage.token;
    return (
      <div className="ct-roomshell qt-accent" {...lookOf(runDesign, accent, dark)}>
        <QuizRun
          key={stage.attempt.attempt_id}
          attempt={stage.attempt}
          token={token}
          accent={accent}
          dark={dark}
          onResult={(result) => setStage({ kind: 'result', result, token })}
          onLost={(message) => toStart(message)}
        />
      </div>
    );
  }
  if (stage.kind === 'result') {
    return (
      <div className="ct-roomshell qt-accent" {...lookOf(runDesign, accentOf(stage.result.accent ?? value?.accent), dark)}>
        <Backdrop doc={runDesign} />
        <QuizResultView result={stage.result} guest={stage.token !== null} token={stage.token} onRetry={() => toStart()} onClose={() => toStart()} />
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
  // The exam's title only when it says something the quiz's own does not (a test of «Новый тест» bears its exam's).
  const examTitle = value?.exam_title && !sameTitle(value.exam_title, value.title) ? value.exam_title : null;
  const deviceCard = user && device && me && !me.is_author ? device : null;
  // A guest whose device already holds attempts of this quiz may be someone else at a shared computer.
  const otherHere = guest && me !== null && (Boolean(me.open_attempt) || me.attempts_used > 0);
  // The rules and what the author sees: under the button, so the start stays in view.
  const facts =
    ready && value && !failed ? (
      <div className="qt-facts">
        <ul className="qt-rules">
          <li>{value.allow_back === false ? TAKE.forwardOnly : TAKE.backAllowed}</li>
          {typeof value.pass_percent === 'number' ? <li>{TAKE.passMark(value.pass_percent)}</li> : null}
          {value.attempts !== 1 && value.grading ? <li>{TAKE.grading[value.grading]}</li> : null}
          {value.review ? <li>{TAKE.review[value.review]}</li> : null}
          {value.members_only ? <li>{TAKE.membersOnly}</li> : null}
        </ul>
        <p className="qt-privacy">{guest ? TAKE.guestPrivacy : TAKE.privacy}</p>
      </div>
    ) : null;
  const otherButton = (
    <button type="button" className="sf-link qt-other" disabled={starting} onClick={otherPerson}>
      {TAKE.otherPerson}
    </button>
  );

  return (
    <div className="au qt qt-accent" {...lookOf(design, accent, dark)}>
      <Backdrop doc={design} />
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
                {coverPath ? <Cover path={coverPath} /> : null}
                <h1 id="qt-title" className="au-h1 qt-h1">
                  {cover ? cover.title : value.title}
                </h1>
                {cover && cover.subtitle.trim() ? <p className="qt-sub">{cover.subtitle}</p> : null}
                {value.author_name || examTitle ? (
                  <p className="qt-by">
                    {value.author_name ? <span>{TAKE.author(value.author_name)}</span> : null}
                    {value.author_name && examTitle ? <span aria-hidden="true"> · </span> : null}
                    {examTitle ? <span>{TAKE.exam(examTitle)}</span> : null}
                  </p>
                ) : null}
                <p className="qt-meta">{meta}</p>
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

            {ready && value && !user && !loading && !guest && back ? (
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

            {ready && value && me && (user || guest) ? (
              <>
                {me.is_author ? <p className="qt-note">{TAKE.authorNote}</p> : null}
                {deviceCard ? (
                  <section className="qt-device" aria-labelledby={deviceId}>
                    <p id={deviceId} className="qt-device-t">
                      {TAKE.deviceAttempt(deviceCard.when ? dateTimeText(deviceCard.when) : null)}
                    </p>
                    <div className="qt-device-acts">
                      <button type="button" className="sf-secondary" aria-busy={claiming || undefined} disabled={claiming} onClick={() => void claimDevice()}>
                        {TAKE.deviceMine}
                      </button>
                      <button type="button" className="sf-link" disabled={claiming} onClick={notMine}>
                        {TAKE.deviceNotMine}
                      </button>
                    </div>
                  </section>
                ) : null}
                {user && deviceNote ? <p className="qt-note">{deviceNote}</p> : null}
                {me.open_attempt ? (
                  <div className="qt-actions">
                    <p className="qt-note">{TAKE.resumeNote}</p>
                    <button type="button" className="sf-primary qt-go" aria-busy={starting || undefined} disabled={starting} onClick={() => void begin()}>
                      {TAKE.resume}
                    </button>
                    {otherHere ? otherButton : null}
                  </div>
                ) : reason ? (
                  <p className="qt-reason">{reason}</p>
                ) : (
                  <form className="qt-start" onSubmit={(event) => void begin(event)} noValidate>
                    <div className="au-field">
                      <label className="au-label" htmlFor={nameId}>
                        {me.is_author ? TAKE.nameLabelOwn : TAKE.nameLabel(value.author_name)}
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
                {otherHere && !me.open_attempt ? <p className="qt-other-line">{otherButton}</p> : null}
                {guest && back && !problem?.signIn ? (
                  <p className="qt-account">
                    {TAKE.haveAccount}{' '}
                    <Link className="sf-link" to={withReturn('/login', back)}>
                      {TAKE.signInShort}
                    </Link>
                  </p>
                ) : null}
              </>
            ) : null}

            {facts}

            {ready && value && me && (user || guest) ? (
              <>
                {results.length > 0 ? (
                  <section className="qt-past" aria-labelledby="qt-past-title">
                    <h2 id="qt-past-title" className="qt-past-h">
                      {TAKE.pastTitle}
                    </h2>
                    <ul className="qt-past-list">
                      {results.map((row) => (
                        <li key={row.attempt_id}>
                          <span>{TAKE.pastRow(row.n, pastScore(row), row.finished_at ? dateTimeText(row.finished_at) : '')}</span>
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
