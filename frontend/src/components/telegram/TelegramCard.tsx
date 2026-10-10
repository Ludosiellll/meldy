import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import { Send } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { usePhone } from '../../lib/usePhone';
import {
  TelegramApiError, fetchTelegramState, isTelegramMissing, startTelegramLink, telegramErrorText, unlinkTelegram, updateTelegramSettings,
  type TelegramExam, type TelegramLinkCode, type TelegramState,
} from '../../api/telegram';
import { fetchOverview } from '../../api/containers';
import { browserZone, chatUrl, linkQr, onComputer, zoneWords } from '../../lib/telegram/links';
import { NBSP, dayText } from '../../lib/containers/words';
import { clockOf, isLocalDay, localDay, weekday } from '../../lib/containers/time';
import { ty } from '../landing/typo';
import './telegramCard.css';

/**
 * «Telegram» in «Профиль» → «Уведомления» (package T3; Telegram bot spec decisions 9, 31, 32, §4.1, §6.3 «Сайт», §6.4),
 * anchor `#telegram` (the bot's «Открыть профиль Meldy» leads here). A row like its neighbours:
 * - not linked: «Подключить Telegram» asks the server for a one-time code (15 minutes) and opens a window with the link:
 *   on a phone the blue «Открыть Telegram»; on a computer the link as a QR code for the phone, and «Открыть Telegram на
 *   компьютере». The state is read every 3 s until the bot links the account or the code ends.
 * - linked: the exam, «План на день — в 20:00», the pause, «Отключить» (asked once more in the row).
 * - a database without the functions: nothing at all, as the containers' old-client rule.
 * The line about the data (decision 31) is the spec's, word for word, in the window and on the linked card.
 *
 * `TelegramRemindLink` is the quiet «Напоминать в Telegram» at the end of the first session (bot spec §6.8, container
 * spec §10): the same link in a smaller window, and the calendar reminder in its place while the bot is not there.
 */

/** How often the window asks whether the bot has linked the account, and for how long (the code's life). */
export const POLL_MS = 3000;
export const LINK_MS = 15 * 60 * 1000;

/** Russian typesetting: one- and two-letter words and numbers hold on to the next word. */
function glue(text: string): string {
  return ty(text).replace(/(\d) (?=[а-яёА-ЯЁa-zA-Z%])/g, `$1${NBSP}`);
}

/** Every line of the card (spec §3: «ёлочки», « — », no «!»; the bot's own words where it has them). */
export const TELEGRAM_COPY = {
  title: 'План на день в Telegram',
  about: 'Раз в день — план на сегодня. Вопросы экзамена можно решать прямо в чате, по 20 за раз.',
  aboutPhone: 'План на день и вопросы — по 20 за раз.',
  connect: 'Подключить Telegram',
  openApp: 'Открыть Telegram',
  openHere: 'Открыть Telegram на компьютере',
  appStep: 'В Telegram откроется чат с Meldy — нажмите в нём «Запустить».',
  scanStep: 'Наведите камеру телефона на код и в Telegram нажмите «Запустить».',
  lifetime: 'Ссылка действует 15 минут.',
  expired: 'Ссылка устарела: она действует 15 минут.',
  cancel: 'Отмена',
  linked: 'Telegram подключён',
  linkedNow: 'Telegram подключён.',
  disconnect: 'Отключить',
  ask: 'Отключить Telegram от Meldy?',
  askText: 'План перестанет приходить в Telegram. Экзамен и счёт останутся в Meldy.',
  unlinked: 'Telegram отключён от Meldy.',
  noExam: 'В Meldy пока нет экзамена с планом на день.',
  off: 'План на день не приходит.',
  resume: 'Присылать снова',
  blocked: 'Бот остановлен в Telegram — план не приходит.',
  openChat: 'Открыть чат с ботом',
  settingsHint: 'Время и пауза — в боте: /settings.',
  readFailed: 'Не получилось узнать, подключён ли Telegram.',
  retry: 'Повторить',
  remind: 'Напоминать в Telegram',
  qr: 'QR-код ссылки на бота Meldy в Telegram',
  /** Spec §6.4, word for word. */
  data: 'Meldy хранит id вашего Telegram и чата с ботом и время напоминания — без имени и номера телефона. План и вопросы приходят через Telegram.',
} as const;

const WEEKDAYS_GENITIVE = ['понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы', 'воскресенья'];

/** «20:00», «7:30» (the bot's buttons write the hour without a leading zero). */
export function clockWords(at: string): string {
  const [h, m] = at.split(':');
  return `${Number(h)}:${m}`;
}

/** «Экзамен — «Осенняя сессия», 3 ноября.»; without a date «…, дата не указана.» (bot S1). */
export function examLine(exam: TelegramExam): string {
  const when = exam.date && isLocalDay(exam.date) ? dayText(exam.date) : 'дата не указана';
  return `Экзамен — «${exam.title}», ${when}.`;
}

/** «План на день — в 20:00.», with the zone when its clock is not the browser's: «… в 20:00 по Минску.» */
export function timeLine(at: string, zone: string | null): string {
  return `План на день — в ${clockWords(at)}${zone ? ` ${zoneWords(zone)}` : ''}.`;
}

/** «Пауза до понедельника, 19 октября.» — `until` is the first day the plan comes again (bot S1, S3). */
export function pauseLine(until: string): string {
  return `Пауза до ${WEEKDAYS_GENITIVE[weekday(until)]}, ${dayText(until)}.`;
}

/** True when two zones show the same day and time now (Minsk and Moscow do: the zone need not be named). */
function sameClock(a: string, b: string, now: number): boolean {
  if (a === b) return true;
  try {
    const x = clockOf(now, a);
    const y = clockOf(now, b);
    return localDay(now, a) === localDay(now, b) && x.h === y.h && x.m === y.m;
  } catch {
    return false;
  }
}

/**
 * The exam the bot plans for, from the exams list when the server's state does not name it: the nearest date still
 * ahead, else an exam without a date; an exam whose dates have all passed is over for the bot (spec K3).
 */
export function leadingExam(
  containers: ReadonlyArray<{ title: string; exam_date: string | null; subjects?: ReadonlyArray<{ exam_date: string | null }> }>,
  today: string,
): TelegramExam | null {
  let best: TelegramExam | null = null;
  let bestKey = '';
  for (const container of containers) {
    const dates = [...(container.subjects ?? []).map((subject) => subject.exam_date), container.exam_date].filter(
      (date): date is string => isLocalDay(date),
    );
    const ahead = dates.filter((date) => date >= today).sort();
    let key: string;
    let candidate: TelegramExam;
    if (ahead.length > 0) {
      key = `0${ahead[0]}`;
      candidate = { title: container.title, date: ahead[0] };
    } else if (dates.length === 0) {
      key = '1';
      candidate = { title: container.title, date: null };
    } else {
      continue;
    }
    if (!best || key < bestKey) {
      best = candidate;
      bestKey = key;
    }
  }
  return best;
}

// ── The link's life ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The server's moment of the code: its end less its 15 minutes (T1's contract: «linked now» is `linked_at` after the
 * moment the code was requested; both on the server's clock, so the device's clock does not matter). Null when unknown.
 */
export function codeMoment(expiresAt: string | null): number | null {
  const end = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(end) ? end - LINK_MS : null;
}

/** Linked by this code: `linked_at` at or after the code's moment (2 s for rounding); unknown moments count as now. */
export function linkedByCode(linkedAt: string | null, moment: number | null): boolean {
  if (moment === null || !linkedAt) return true;
  const at = Date.parse(linkedAt);
  return !Number.isFinite(at) || at >= moment - 2000;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed' }
  | { kind: 'idle'; note: 'expired' | 'unlinked' | null }
  | { kind: 'starting' }
  | { kind: 'waiting'; link: TelegramLinkCode; until: number }
  | { kind: 'linked'; now: boolean };

interface TelegramLink {
  phase: Phase;
  state: TelegramState | null;
  error: string | null;
  busy: boolean;
  read: () => void;
  connect: () => void;
  cancel: () => void;
  unlink: () => Promise<boolean>;
  change: (patch: { remindOn?: boolean; zone?: string }) => void;
}

function useTelegramLink(userId: string | null): TelegramLink {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [state, setState] = useState<TelegramState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One controller for the component's life: no answer lands after it is gone.
  const life = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, []);

  /** Reads the state; `again` (after a failure) keeps the row on screen and busy instead of hiding it. */
  const read = useCallback(async (again = false) => {
    const signal = life.current?.signal;
    if (!userId || !signal) return;
    if (again) setBusy(true);
    else setPhase({ kind: 'loading' });
    setError(null);
    try {
      const next = await fetchTelegramState(signal);
      if (signal.aborted) return;
      if (next === null) {
        setPhase({ kind: 'missing' });
        return;
      }
      setState(next);
      setPhase(next.linked ? { kind: 'linked', now: false } : { kind: 'idle', note: null });
    } catch {
      if (!signal.aborted) setPhase({ kind: 'failed' });
    } finally {
      if (again && !signal.aborted) setBusy(false);
    }
  }, [userId]);

  useEffect(() => {
    void read();
  }, [read]);

  const connect = useCallback(async () => {
    const signal = life.current?.signal;
    if (!signal) return;
    setPhase({ kind: 'starting' });
    setError(null);
    try {
      const link = await startTelegramLink(browserZone(), signal);
      if (signal.aborted) return;
      setPhase({ kind: 'waiting', link, until: Date.now() + LINK_MS });
    } catch (err) {
      if (signal.aborted) return;
      if (isTelegramMissing(err)) {
        setPhase({ kind: 'missing' });
        return;
      }
      setError(telegramErrorText(err));
      setPhase({ kind: 'idle', note: null });
    }
  }, []);

  const cancel = useCallback(() => setPhase({ kind: 'idle', note: null }), []);

  // While a code waits: the state every 3 s (and at once when the tab comes back from Telegram), until the bot has
  // linked the account or the code has ended. One request at a time; a failed one is asked again on the next tick.
  const waitingCode = phase.kind === 'waiting' ? phase.link.code : null;
  const until = phase.kind === 'waiting' ? phase.until : 0;
  const moment = phase.kind === 'waiting' ? codeMoment(phase.link.expiresAt) : null;
  useEffect(() => {
    if (!waitingCode) return undefined;
    const controller = new AbortController();
    const parent = life.current?.signal;
    const stop = () => controller.abort();
    parent?.addEventListener('abort', stop);
    let timer: number | undefined;
    let flying = false;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), Math.max(0, Math.min(POLL_MS, until - Date.now())));
    };
    const poll = async () => {
      if (controller.signal.aborted || flying) return;
      flying = true;
      window.clearTimeout(timer);
      let next: TelegramState | null | undefined;
      try {
        next = await fetchTelegramState(controller.signal);
      } catch {
        next = undefined;
      }
      flying = false;
      if (controller.signal.aborted) return;
      if (next === null) {
        setPhase({ kind: 'missing' });
        return;
      }
      if (next?.linked) {
        setState(next);
        setPhase({ kind: 'linked', now: linkedByCode(next.linkedAt, moment) });
        return;
      }
      if (Date.now() >= until) {
        setPhase({ kind: 'idle', note: 'expired' });
        return;
      }
      schedule();
    };
    const onShow = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    schedule();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
      parent?.removeEventListener('abort', stop);
    };
  }, [waitingCode, until, moment]);

  const unlink = useCallback(async (): Promise<boolean> => {
    const signal = life.current?.signal;
    if (!signal) return false;
    setBusy(true);
    setError(null);
    try {
      const next = await unlinkTelegram(signal);
      if (signal.aborted) return false;
      setState(next);
      setPhase(next.linked ? { kind: 'linked', now: false } : { kind: 'idle', note: 'unlinked' });
      return !next.linked;
    } catch (err) {
      if (signal.aborted) return false;
      if (isTelegramMissing(err)) setPhase({ kind: 'missing' });
      else setError(telegramErrorText(err));
      return false;
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }, []);

  const change = useCallback(
    async (patch: { remindOn?: boolean; zone?: string }) => {
      const signal = life.current?.signal;
      if (!signal || !state) return;
      setBusy(true);
      setError(null);
      try {
        // Null keeps a value (T1's contract): only what the student changed is sent.
        const next = await updateTelegramSettings({ remindOn: patch.remindOn ?? null, zone: patch.zone ?? null }, signal);
        if (signal.aborted) return;
        setState(next);
        if (!next.linked) setPhase({ kind: 'idle', note: null });
      } catch (err) {
        if (signal.aborted) return;
        if (isTelegramMissing(err)) setPhase({ kind: 'missing' });
        else if (err instanceof TelegramApiError && err.code === 'not_linked') void read(true);
        else setError(telegramErrorText(err));
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    },
    [state, read],
  );

  return {
    phase,
    state,
    error,
    busy,
    read: () => void read(true),
    connect: () => void connect(),
    cancel,
    unlink,
    change: (patch) => void change(patch),
  };
}

/** The exam line: the server's, else read from the exams list once (undefined while unknown: no line). */
function useExam(state: TelegramState | null, linked: boolean): TelegramExam | null | undefined {
  const [found, setFound] = useState<TelegramExam | null | undefined>(undefined);
  const needed = linked && state !== null && state.exam === undefined;
  useEffect(() => {
    if (!needed) return undefined;
    let alive = true;
    const today = localDay(Date.now(), browserZone());
    fetchOverview(today).then(
      (overview) => {
        if (alive) setFound(overview ? leadingExam(overview.containers, today) : undefined);
      },
      () => {
        if (alive) setFound(undefined);
      },
    );
    return () => {
      alive = false;
    };
  }, [needed]);
  if (!state || !linked) return undefined;
  return state.exam !== undefined ? state.exam : found;
}

// ── Parts ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The QR code: dark modules on a white plate in both themes (a camera reads a light-on-dark code badly). */
function LinkQr({ url }: { url: string }) {
  const { d, box } = useMemo(() => linkQr(url), [url]);
  return (
    <svg className="tg-qr" viewBox={`0 0 ${box} ${box}`} role="img" aria-label={TELEGRAM_COPY.qr} shapeRendering="crispEdges" focusable="false">
      <rect width={box} height={box} fill="#fff" />
      <path d={d} fill="#0b121c" />
    </svg>
  );
}

/** The window while a code waits: the link (and its QR code on a computer), its life, the data line, «Отмена». */
function WaitPanel({
  link,
  computer,
  blue,
  openRef,
  onCancel,
}: {
  link: TelegramLinkCode;
  computer: boolean;
  /** The page's one blue action (the profile); at the end of a session the blue pill is the session's. */
  blue: boolean;
  openRef: RefObject<HTMLAnchorElement>;
  onCancel: () => void;
}) {
  const ids = useId();
  const stepId = `${ids}-step`;
  const lifeId = `${ids}-life`;
  return (
    <div className="tg-panel" role="group" aria-labelledby={stepId} data-qr={computer ? '' : undefined}>
      {computer ? <LinkQr url={link.url} /> : null}
      <div className="tg-panel-body">
        <p className="tg-step" id={stepId}>
          {glue(computer ? TELEGRAM_COPY.scanStep : TELEGRAM_COPY.appStep)}
        </p>
        <div className="tg-acts">
          {computer ? (
            <a ref={openRef} className="sf-link" href={link.url} target="_blank" rel="noopener noreferrer" aria-describedby={lifeId}>
              {TELEGRAM_COPY.openHere}
            </a>
          ) : (
            <a
              ref={openRef}
              className={blue ? 'sf-primary tg-open' : 'ac-btn tg-open'}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={`${stepId} ${lifeId}`}
            >
              {TELEGRAM_COPY.openApp}
            </a>
          )}
          <button type="button" className="sf-link" data-muted="" onClick={onCancel}>
            {TELEGRAM_COPY.cancel}
          </button>
        </div>
        <p className="tg-fine" id={lifeId}>
          {glue(TELEGRAM_COPY.lifetime)}
        </p>
        <p className="tg-fine" data-line="data">
          {TELEGRAM_COPY.data}
        </p>
      </div>
    </div>
  );
}

/** Moves focus as the phase changes, only when it was inside the card (never pulls it from elsewhere on the page). */
function useFocusMoves(
  phase: Phase,
  root: RefObject<HTMLElement>,
  targets: { open: RefObject<HTMLElement>; title: RefObject<HTMLElement>; connect: RefObject<HTMLElement> },
) {
  const before = useRef(phase.kind);
  const inside = useRef(false);
  // Where the focus was before this render's change (a removed element takes it to <body>).
  inside.current = root.current?.contains(document.activeElement) ?? false;
  useEffect(() => {
    const was = before.current;
    before.current = phase.kind;
    if (was === phase.kind) return;
    if (!inside.current) return;
    if (phase.kind === 'waiting') targets.open.current?.focus();
    else if (phase.kind === 'linked' && was === 'waiting') targets.title.current?.focus();
    else if (phase.kind === 'idle' && was !== 'loading' && was !== 'failed') targets.connect.current?.focus();
  }, [phase.kind, targets.open, targets.title, targets.connect]);
}

// ── «Профиль» → «Уведомления» ──────────────────────────────────────────────────────────────────────────────

export default function TelegramCard() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const phone = usePhone();
  const computer = useMemo(() => onComputer(), []);
  const location = useLocation();
  const link = useTelegramLink(userId);
  const { phase, state, error, busy } = link;
  const exam = useExam(state, phase.kind === 'linked');
  const ids = useId();
  const titleId = `${ids}-title`;
  const askId = `${ids}-ask`;
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const connectRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLParagraphElement>(null);
  const [asking, setAsking] = useState(false);
  useFocusMoves(phase, rootRef, { open: openRef, title: titleRef, connect: connectRef });

  const shown = Boolean(userId) && phase.kind !== 'loading' && phase.kind !== 'missing';
  // `/profile#telegram` (the bot's «Открыть профиль Meldy»): the card comes into view once it has something to show.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!shown || scrolled.current || location.hash !== '#telegram') return;
    scrolled.current = true;
    rootRef.current?.scrollIntoView?.({ block: 'start' });
  }, [shown, location.hash]);

  useEffect(() => {
    if (phase.kind !== 'linked') setAsking(false);
  }, [phase.kind]);
  useEffect(() => {
    if (asking) askRef.current?.focus();
  }, [asking]);

  if (!shown) return null;

  const linked = phase.kind === 'linked' && state !== null;
  const starting = phase.kind === 'starting';
  const zone = browserZone();
  const now = Date.now();

  let lines: ReactNode;
  if (linked && state) {
    const linkZone = state.zone ?? zone;
    const otherClock = !sameClock(linkZone, zone, now);
    const today = localDay(now, linkZone);
    const paused = state.pausedUntil !== null && isLocalDay(state.pausedUntil) && state.pausedUntil > today;
    let time: ReactNode;
    if (state.blocked) {
      time = (
        <>
          {glue(TELEGRAM_COPY.blocked)}{' '}
          <a className="sf-link tg-inline" href={chatUrl(state.bot)} target="_blank" rel="noopener noreferrer">
            {TELEGRAM_COPY.openChat}
          </a>
        </>
      );
    } else if (!state.remindOn) {
      time = (
        <>
          {glue(TELEGRAM_COPY.off)}{' '}
          <button type="button" className="sf-link tg-inline" aria-disabled={busy || undefined} onClick={() => !busy && link.change({ remindOn: true })}>
            {TELEGRAM_COPY.resume}
          </button>
        </>
      );
    } else {
      time = (
        <>
          {glue(timeLine(state.remindAt, otherClock ? linkZone : null))}
          {otherClock ? (
            <>
              {' '}
              <button type="button" className="sf-link tg-inline" aria-disabled={busy || undefined} onClick={() => !busy && link.change({ zone })}>
                {glue(`Присылать в ${clockWords(state.remindAt)} ${zoneWords(zone)}`)}
              </button>
            </>
          ) : null}
        </>
      );
    }
    lines = (
      <>
        {exam !== undefined ? <p className="ac-row-d">{glue(exam ? examLine(exam) : TELEGRAM_COPY.noExam)}</p> : null}
        <p className="ac-row-d">{time}</p>
        {paused && state.pausedUntil ? <p className="ac-row-d">{glue(pauseLine(state.pausedUntil))}</p> : null}
        {phone ? null : <p className="ac-row-d">{glue(TELEGRAM_COPY.settingsHint)}</p>}
        <p className="tg-fine" data-line="data">
          {TELEGRAM_COPY.data}
        </p>
      </>
    );
  } else if (phase.kind === 'failed') {
    lines = <p className="ac-row-d">{glue(TELEGRAM_COPY.readFailed)}</p>;
  } else {
    lines = <p className="ac-row-d">{glue(phone ? TELEGRAM_COPY.aboutPhone : TELEGRAM_COPY.about)}</p>;
  }

  let action: ReactNode = null;
  if (phase.kind === 'failed') {
    action = (
      <button
        type="button"
        className="ac-btn ac-row-btn"
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onClick={() => !busy && link.read()}
      >
        {TELEGRAM_COPY.retry}
      </button>
    );
  } else if (phase.kind === 'idle' || starting) {
    action = (
      <button
        type="button"
        ref={connectRef}
        className="ac-btn ac-row-btn"
        aria-describedby={titleId}
        // Busy, it keeps the focus (a disabled button would drop it to the page).
        aria-disabled={starting || undefined}
        aria-busy={starting || undefined}
        onClick={() => !starting && link.connect()}
      >
        {TELEGRAM_COPY.connect}
      </button>
    );
  } else if (linked && !asking) {
    action = (
      <button type="button" ref={disconnectRef} className="ac-btn ac-row-btn" onClick={() => setAsking(true)}>
        {TELEGRAM_COPY.disconnect}
      </button>
    );
  }

  const note =
    phase.kind === 'idle' && phase.note === 'expired'
      ? TELEGRAM_COPY.expired
      : phase.kind === 'idle' && phase.note === 'unlinked'
        ? TELEGRAM_COPY.unlinked
        : phase.kind === 'linked' && phase.now
          ? TELEGRAM_COPY.linkedNow
          : '';

  return (
    <div className="tg" id="telegram" ref={rootRef} data-state={phase.kind}>
      <div className="ac-row">
        <span className={`ac-row-i ${linked ? 'ac-row-i--on' : ''}`} aria-hidden="true">
          <Send />
        </span>
        <div className="ac-row-text">
          <p className="ac-row-t" id={titleId} ref={titleRef} tabIndex={-1}>
            {linked ? TELEGRAM_COPY.linked : TELEGRAM_COPY.title}
          </p>
          {lines}
        </div>
        {action}
      </div>

      {phase.kind === 'waiting' ? <WaitPanel link={phase.link} computer={computer} blue openRef={openRef} onCancel={link.cancel} /> : null}

      {linked && asking ? (
        <div className="tg-panel tg-ask" role="group" aria-labelledby={askId}>
          <p className="tg-step" id={askId} ref={askRef} tabIndex={-1}>
            {TELEGRAM_COPY.ask}
          </p>
          <p className="tg-fine">{glue(TELEGRAM_COPY.askText)}</p>
          <div className="tg-acts">
            <button
              type="button"
              className="ac-btn ac-btn--danger"
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              onClick={() => {
                if (!busy) void link.unlink();
              }}
            >
              {TELEGRAM_COPY.disconnect}
            </button>
            <button
              type="button"
              className="sf-link"
              data-muted=""
              onClick={() => {
                setAsking(false);
                window.setTimeout(() => disconnectRef.current?.focus(), 0);
              }}
            >
              {TELEGRAM_COPY.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {/* Rendered from the start so a reader hears what changes in it. */}
      <p className="tg-note" role="status">
        {note ? glue(note) : null}
      </p>
      {error ? (
        <p className="tg-note" data-tone="warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── The end of the first session ───────────────────────────────────────────────────────────────────────────

/**
 * «Напоминать в Telegram» after the first session (bot spec decision 9, §6.8; container spec §10): a quiet line that
 * opens the same window as the profile, with a white «Открыть Telegram» (the session's pill stays the one blue). Already
 * linked: nothing (the bot reminds). No Telegram functions on the server, or the state cannot be read: `fallback`
 * (the calendar reminder), as before the bot.
 */
export function TelegramRemindLink({ fallback = null }: { fallback?: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const computer = useMemo(() => onComputer(), []);
  const link = useTelegramLink(userId);
  const { phase, error } = link;
  const rootRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const connectRef = useRef<HTMLButtonElement>(null);
  useFocusMoves(phase, rootRef, { open: openRef, title: titleRef, connect: connectRef });

  if (!userId || phase.kind === 'missing' || phase.kind === 'failed') return <>{fallback}</>;
  if (phase.kind === 'loading') return null;
  if (phase.kind === 'linked') {
    return phase.now ? (
      <div className="tg-remind" ref={rootRef}>
        <p className="tg-remind-done" role="status" ref={titleRef} tabIndex={-1}>
          {TELEGRAM_COPY.linkedNow}
        </p>
      </div>
    ) : null;
  }
  const starting = phase.kind === 'starting';
  return (
    <div className="tg-remind" ref={rootRef}>
      {phase.kind === 'waiting' ? (
        <WaitPanel link={phase.link} computer={computer} blue={false} openRef={openRef} onCancel={link.cancel} />
      ) : (
        <button
          type="button"
          ref={connectRef}
          className="tg-remind-open"
          aria-disabled={starting || undefined}
          aria-busy={starting || undefined}
          onClick={() => !starting && link.connect()}
        >
          <Send aria-hidden="true" className="tg-remind-ic" />
          <span>{TELEGRAM_COPY.remind}</span>
        </button>
      )}
      <p className="tg-note" role="status">
        {phase.kind === 'idle' && phase.note === 'expired' ? glue(TELEGRAM_COPY.expired) : null}
      </p>
      {error ? (
        <p className="tg-note" data-tone="warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
