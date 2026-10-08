import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import '../styles/paper.css';
import '../components/oral/oral.css';
import './LectureTalk.css';
import { useVoiceAnswer } from '../hooks/useVoiceAnswer';
import LiveTranscript from '../components/oral/LiveTranscript';
import MicLevel from '../components/oral/MicLevel';
import { seedFrom } from '../components/marks';
import { forgetTTSFailures, isTTSReady, playTTS, prefetchTTS, prefetchTTSInOrder, stopTTS, type VoiceRole } from '../utils/tts';
import { TUTOR_BUSY_MESSAGE, TUTOR_LOAD_FAILED_MESSAGE, isTutorApiError, startTutor, tutorTurn, type TutorTurnBody } from '../api/tutor';
import {
  BACK_LINE,
  FILLER_LINE,
  LAST_LINE,
  NEXT_LINE,
  NOTICE_TEXT,
  NOT_HEARD_LINE,
  RECOGNISING_LINE,
  SERVER_LINES,
  SLOW_LINE,
  VOICE_UNAVAILABLE_LINE,
  currentCard,
  inTurn,
  initialTutorState,
  lineSize,
  lineText,
  questionsWord,
  sentences,
  slipCaption,
  summaryOf,
  tally,
  tutorReducer,
  voiceActive,
  type CardState,
  type EndReason,
  type InputMode,
  type ProtocolRow,
  type Slip,
  type TurnError,
  type TutorLine,
  type TutorState,
} from '../lib/tutor/tutorMachine';
import { displayMaterialTitle } from '../utils/materialTitle';
import { glue } from '../lib/oral/format';
import { minutesBucket, track, waitBucket } from '../lib/telemetry';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * «Поговорить о лекции» (notes: 10_Project/Voice_Tutor_Spec_2026-10-05): Meldy asks the lecture's
 * cards one by one, the student answers aloud by turns, and the server's code picks each move.
 *
 * The room of «Ответ вслух»: no menu, its own top line with «‹ К лекции». On the left the lecture's
 * paper — its title and the conversation as protocol rows (on a phone behind «Текст разговора»); on
 * the right the desk — Meldy's card (the line set large, «Повторить» · «Без звука»), the lecture's
 * own words when the server sent them, «Ваш ответ», the pill «Отвечать» ↔ «Готово» and «Текстом»,
 * «Не знаю», «Спросить», «Закончить».
 *
 * The conversation is lib/tutor/tutorMachine (pure); this page runs its effects: the session, the
 * voice (sentence by sentence, the tutor's own voice only), the microphone (it opens 300 ms after
 * the voice, never while it speaks), the turn request with «Так…» at 700 ms and «Отвечаю дольше
 * обычного» at 6 s, Space and Esc, the statistics. Nothing is saved: the conversation counts toward
 * neither mastery nor readiness.
 */

/** The tutor's voice (Светлана); the examiner of «Ответ вслух» keeps the professor's. */
export const TUTOR_VOICE: VoiceRole = 'female';
/** «Без звука» is remembered on this device. */
export const VOICE_KEY = 'meldy_tutor_voice';
/** The microphone opens this long after the tutor's voice ended or stopped (as in «Ответ вслух»). */
export const LISTEN_AFTER_AUDIO_MS = 300;
/** «Так…» from the cache once the wait for the server is this long. */
export const FILLER_AFTER_MS = 700;
/** «Отвечаю дольше обычного.» */
export const SLOW_AFTER_MS = 6_000;
/** A new line waits for «Так…» to end, never longer than this. */
const FILLER_WAIT_MS = 1_500;
/** «Так…» that never reports its end is let go after this. */
const FILLER_MAX_MS = 3_000;
/** A longer fragment on the desk opens with «Показать целиком»; in the protocol it is cut. */
const SLIP_LIMIT = 420;
const ROW_SLIP_LIMIT = 220;
const NO_MARKS: ReadonlySet<number> = new Set();

export const LOAD_OFFLINE_MESSAGE = 'Нет интернета — разговор не начался. Проверьте подключение и нажмите «Повторить».';
export const KEYS_LINE = 'Пробел — «Отвечать» и «Готово», Esc — остановить голос.';

// ── Small helpers ─────────────────────────────────────────────────────────────────

export function readVoicePreference(): boolean {
  try {
    return window.localStorage.getItem(VOICE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeVoicePreference(on: boolean) {
  try {
    window.localStorage.setItem(VOICE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

/** The outcome of a promise that never rejects, or nothing once ms have passed. */
function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Where the turn's error leads: the daily limit, a busy service, no connection, a lost card, words to fix. */
function turnErrorOf(error: unknown): TurnError {
  if (!isTutorApiError(error)) return { kind: 'busy', message: TUTOR_BUSY_MESSAGE };
  if (error.kind === 'limit' || error.kind === 'busy' || error.kind === 'offline') return { kind: error.kind, message: error.message };
  if (error.status === 409) return { kind: 'restart', message: error.message };
  if (error.status === 400 || error.status === 413) return { kind: 'fix', message: error.message };
  return { kind: 'other', message: error.message };
}

/** What the server's recognition is doing under «Готово» (as in «Ответ вслух»). */
function serverVoiceLine(pending: number, lost: number): string {
  if (pending > 0) return 'Распознаём сказанное…';
  if (lost > 0) return 'Часть сказанного не распознана — можно повторить или дописать текстом.';
  return 'Слушаю. Текст появляется после каждой паузы.';
}

/** The sentences the session will say for sure, first things first: the first question, the code's own lines, the rest. */
function linesAhead(cards: readonly CardState[]): string[] {
  const [first, ...rest] = cards;
  const ordered = [
    ...(first ? sentences(first.target.question) : []),
    FILLER_LINE,
    NEXT_LINE,
    ...sentences(NOT_HEARD_LINE),
    BACK_LINE,
    LAST_LINE,
    ...SERVER_LINES.flatMap((line) => sentences(line)),
    ...rest.flatMap((card) => sentences(card.target.question)),
  ];
  return Array.from(new Set(ordered));
}

/**
 * Scrolls the block clear of the sticky top line and the fixed bar (its CSS scroll margins). Not
 * scrollIntoView({ block: 'nearest' }): Chromium takes a block under the fixed bar for a visible one.
 */
function bringIntoView(block: HTMLElement) {
  if (typeof block.scrollIntoView !== 'function' || typeof window === 'undefined') return;
  const rect = block.getBoundingClientRect();
  const style = window.getComputedStyle(block);
  const above = parseFloat(style.scrollMarginTop) || 0;
  const below = parseFloat(style.scrollMarginBottom) || 0;
  const room = window.innerHeight;
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = still ? 'auto' : 'smooth';
  if (rect.top - above < 0 || rect.height + above + below > room) {
    if (rect.top - above !== 0) block.scrollIntoView({ block: 'start', behavior });
  } else if (rect.bottom + below > room) {
    block.scrollIntoView({ block: 'end', behavior });
  }
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** A focused button or link answers Space by itself (its own click); a focused list scrolls with it. */
function onControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('button, a[href], [role="button"], summary, [tabindex]:not([tabindex="-1"])'));
}

interface SpeakCallbacks {
  onEnd: (played: boolean) => void;
  onFail: () => void;
}

/**
 * Says the parts sentence by sentence in the tutor's voice: the first sentence sounds sooner, the next
 * ones load one after another meanwhile. The voice never changes midway (no browser voice): a sentence
 * that does not sound ends the line with onFail. Returns the stop.
 */
export function speakParts(parts: readonly string[], callbacks: SpeakCallbacks): () => void {
  const lines = parts.flatMap((part) => sentences(part));
  let index = 0;
  let live = true;
  let played = false;
  let ahead: Promise<unknown> = Promise.resolve();
  for (const line of lines.slice(1)) ahead = ahead.then(() => (live ? prefetchTTS(line, TUTOR_VOICE) : null));
  const next = () => {
    if (!live) return;
    if (index >= lines.length) {
      live = false;
      callbacks.onEnd(played);
      return;
    }
    const text = lines[index];
    index += 1;
    void playTTS(
      text,
      TUTOR_VOICE,
      next,
      () => {
        if (!live) return;
        live = false;
        callbacks.onFail();
      },
      () => {
        played = true;
      },
      { fallback: 'none' },
    );
  };
  next();
  return () => {
    if (!live) return;
    live = false;
    stopTTS();
  };
}

// ── Pieces of the room ────────────────────────────────────────────────────────────

function TalkBar({ materialId, title }: { materialId: string; title: string }) {
  return (
    <header className="sf-room-bar">
      <div className="or-bar-left">
        <Link className="or-wordmark" to="/dashboard">
          Meldy
        </Link>
        <span className="or-where">
          {/* The pill's own name (decision 1 of 2026-10-08): «Разговор» is no longer a second name for it. */}
          <span className="or-long">{title ? glue(`Поговорить о лекции · ${title}`) : 'Поговорить о лекции'}</span>
          <span className="or-short">Поговорить о лекции</span>
        </span>
      </div>
      <div className="or-bar-right">
        <Link className="sf-link or-sheet-link" data-muted="" to={`/library/${materialId}`}>
          <ArrowLeft className="or-back-icon" aria-hidden="true" strokeWidth={1.75} />
          К лекции
        </Link>
      </div>
    </header>
  );
}

/** Consecutive lead pieces make one paragraph; the main piece (the question to answer now) is its own, set large. */
function paragraphsOf(line: TutorLine): Array<{ text: string; main: boolean }> {
  const out: Array<{ text: string; main: boolean }> = [];
  for (const segment of line.segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (!segment.main && last && !last.main) last.text = `${last.text} ${text}`;
    else out.push({ text, main: segment.main });
  }
  return out;
}

function TutorCard({ line, links }: { line: TutorLine; links: ReactNode }) {
  return (
    <section className="lt-tutor" aria-label="Meldy">
      <p className="lt-tutor-who">Meldy</p>
      {paragraphsOf(line).map((paragraph, index) =>
        paragraph.main ? (
          <p key={index} className="lt-tutor-main" data-size={lineSize(paragraph.text)}>
            {glue(paragraph.text)}
          </p>
        ) : (
          <p key={index} className="lt-tutor-lead">
            {glue(paragraph.text)}
          </p>
        ),
      )}
      <p className="lt-tutor-links">{links}</p>
    </section>
  );
}

/** The lecture's own words: the caption on the desk, the words on the paper card. */
function TutorSlip({ slip }: { slip: Slip }) {
  const [whole, setWhole] = useState(false);
  const long = slip.text.length > SLIP_LIMIT;
  const shown = long && !whole ? `${slip.text.slice(0, SLIP_LIMIT).replace(/\s+\S*$/, '')}…` : slip.text;
  return (
    <figure className="lt-slip" data-kind={slip.kind}>
      <figcaption className="lt-slip-cap">{slipCaption(slip)}</figcaption>
      <blockquote className="sf-slip lt-slip-text">{shown}</blockquote>
      {long ? (
        <button type="button" className="sf-link" data-muted="" onClick={() => setWhole((value) => !value)}>
          {whole ? 'Свернуть' : 'Показать целиком'}
        </button>
      ) : null}
    </figure>
  );
}

function ProtocolLine({ row }: { row: ProtocolRow }) {
  const slip = row.slip;
  const slipText = slip && slip.text.length > ROW_SLIP_LIMIT ? `${slip.text.slice(0, ROW_SLIP_LIMIT).replace(/\s+\S*$/, '')}…` : slip?.text;
  return (
    <li className="lt-row" data-role={row.role}>
      <span className="lt-who">{row.role === 'tutor' ? 'Meldy' : 'Вы'}</span>
      <div className="lt-said">
        <p className="lt-said-text">
          {row.question ? <span className="lt-said-tag">Вопрос — </span> : null}
          {glue(row.text)}
        </p>
        {slip ? (
          <p className="lt-said-slip">
            <span className="lt-said-cap">{`${slipCaption(slip)}: `}</span>«{slipText}»
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** The conversation as protocol rows; the box follows the newest row unless the student scrolled up to reread. */
function Protocol({ rows }: { rows: readonly ProtocolRow[] }) {
  const ref = useRef<HTMLOListElement | null>(null);
  const followRef = useRef(true);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    if (followRef.current && list.scrollHeight > list.clientHeight) list.scrollTop = list.scrollHeight;
    list.toggleAttribute('data-scrolled', list.scrollTop > 4);
  }, [rows.length]);
  const onScroll = () => {
    const list = ref.current;
    if (!list) return;
    followRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 32;
    // Older rows above: the top edge fades, as in the answer's transcript of «Ответ вслух».
    list.toggleAttribute('data-scrolled', list.scrollTop > 4);
  };
  return (
    <ol ref={ref} className="lt-proto" aria-label="Текст разговора" tabIndex={0} onScroll={onScroll}>
      {rows.map((row) => (
        <ProtocolLine key={row.id} row={row} />
      ))}
    </ol>
  );
}

/**
 * «Текст разговора» on a phone: the protocol in a bottom sheet, as «Кто видит ответ» in «Ответ вслух».
 * Esc, the scrim and «Закрыть» close it; the focus stays inside and returns to the link.
 */
function TalkSheet({ rows, onClose }: { rows: readonly ProtocolRow[]; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The newest rows first; the head with «Закрыть» stays on top.
    const sheet = sheetRef.current;
    if (sheet) sheet.scrollTop = sheet.scrollHeight;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      root.style.overflow = previous;
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const trap = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]') ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="or-psh-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={sheetRef} className="or-psh lt-psh" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trap}>
        <div className="lt-psh-head">
          <p id={titleId} className="or-psh-t">
            Текст разговора
          </p>
          <button ref={closeRef} type="button" className="sf-link" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {rows.length > 0 ? <Protocol rows={rows} /> : <p className="or-psh-text">Разговор ещё не начался.</p>}
      </div>
    </>
  );
}

// ── The room ──────────────────────────────────────────────────────────────────────

export default function LectureTalk() {
  const { id = '' } = useParams();
  useDocumentTitle('Поговорить о лекции');
  return <TalkRoom key={id} materialId={id} />;
}

function TalkRoom({ materialId }: { materialId: string }) {
  const [state, dispatch] = useReducer(tutorReducer, undefined, () => initialTutorState({ voiceOn: readVoicePreference() }));
  const stateRef = useRef<TutorState>(state);
  stateRef.current = state;
  const card = currentCard(state);
  // The card's words help the server's recognition spell its terms.
  const speech = useVoiceAnswer({ hint: card?.target.question });
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = sheetOpen;
  const [announcement, setAnnouncement] = useState('');
  /** When the tutor's voice last went quiet: the microphone waits LISTEN_AFTER_AUDIO_MS after it. */
  const quietSinceRef = useRef(0);
  const fillerRef = useRef<{ done: Promise<void>; stop: () => void } | null>(null);
  /** «Готово», «Текстом», «Не знаю»: a late recognition result of an earlier press is dropped. */
  const hearTokenRef = useRef(0);
  /** The session (its start time) whose tutor_finished was sent. */
  const reportedRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const roomRef = useRef<HTMLDivElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const focusTextRef = useRef(false);
  const voice = voiceActive(state);
  const back = `/library/${materialId}`;

  /** tutor_finished, once per session: done | left | limit | error. */
  const report = useCallback((current: TutorState, reason?: EndReason) => {
    if (!current.startedAt || reportedRef.current === current.startedAt) return;
    reportedRef.current = current.startedAt;
    const counts = tally(current);
    const why: EndReason =
      reason ?? (current.phase === 'ended' ? current.endReason ?? 'left' : current.phase === 'error' ? (current.error?.kind === 'limit' ? 'limit' : 'error') : 'left');
    track('tutor_finished', {
      cards: counts.cards,
      self: counts.self,
      assisted: counts.assisted,
      minutes: minutesBucket((current.endedAt ?? Date.now()) - current.startedAt),
      reason: why,
    });
  }, []);

  const stopFiller = () => {
    fillerRef.current?.stop();
    fillerRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fillerRef.current?.stop();
      stopTTS();
      // Left in the middle (the way back, another page): the session ends here.
      report(stateRef.current);
    };
  }, [report]);

  // ── The session: the lecture's cards (free) ──
  useEffect(() => {
    if (stateRef.current.phase !== 'loading') return undefined;
    const controller = new AbortController();
    startTutor(materialId, { signal: controller.signal }).then(
      (session) => dispatch({ type: 'loaded', title: displayMaterialTitle(session.title, 'Лекция'), targets: session.targets }),
      (error: unknown) => {
        if (controller.signal.aborted || (isTutorApiError(error) && error.kind === 'aborted')) return;
        if (isTutorApiError(error) && error.kind === 'offline') {
          dispatch({ type: 'load_failed', message: LOAD_OFFLINE_MESSAGE, retry: true });
          return;
        }
        // No text, no cards, not found: the server's words and the way back; a busy server: «Повторить».
        const retry = !isTutorApiError(error) || error.kind === 'busy' || error.status === 401;
        dispatch({ type: 'load_failed', message: error instanceof Error && error.message ? error.message : TUTOR_LOAD_FAILED_MESSAGE, retry });
      },
    );
    return () => controller.abort();
  }, [materialId, state.loads]);

  // ── The lines said for sure go into the lasting cache, the first question first ──
  const cardIds = state.cards.map((item) => item.target.id).join(',');
  useEffect(() => {
    const current = stateRef.current;
    if (!cardIds || !voiceActive(current)) return;
    void prefetchTTSInOrder(
      linesAhead(current.cards).map((text) => ({ text, role: TUTOR_VOICE })),
      { persist: true },
    );
  }, [cardIds]);

  // ── The voice: whatever the machine says now. A tap on «Начать» starts it within the tap ──
  const speechId = state.speech?.id ?? null;
  useEffect(() => {
    if (speechId === null) return undefined;
    const parts = stateRef.current.speech?.parts ?? [];
    let cancelled = false;
    let stop: (() => void) | null = null;
    const go = () => {
      if (cancelled) return;
      stop = speakParts(parts, {
        onEnd: (played) => {
          quietSinceRef.current = Date.now();
          dispatch({ type: 'spoken', speech: speechId, played });
        },
        onFail: () => {
          quietSinceRef.current = Date.now();
          dispatch({ type: 'speech_failed', speech: speechId });
        },
      });
    };
    // «Так…» is not cut off: the line waits for it (≤ 1.5 s).
    const filler = fillerRef.current;
    if (filler) void within(filler.done, FILLER_WAIT_MS).then(go);
    else go();
    return () => {
      cancelled = true;
      if (stop) stop();
      else if (fillerRef.current === filler) stopFiller();
      quietSinceRef.current = Date.now();
    };
  }, [speechId]);

  // ── The turn: the server, «Так…» at 700 ms, «Отвечаю дольше обычного» at 6 s, 20 s at most ──
  const thinkingTurn = state.phase === 'thinking' ? state.turn : null;
  useEffect(() => {
    if (thinkingTurn === null) return undefined;
    const pending = stateRef.current.pending;
    if (!pending) return undefined;
    const controller = new AbortController();
    const sentAt = Date.now();
    let live = true;
    const current = () => live && stateRef.current.phase === 'thinking' && stateRef.current.turn === thinkingTurn;
    const fillerTimer = window.setTimeout(() => {
      if (!current() || stateRef.current.fillerPlayed || !voiceActive(stateRef.current)) return;
      // Only from the cache: a live request would come after the answer it is meant to fill.
      void isTTSReady(FILLER_LINE, TUTOR_VOICE).then((ready) => {
        if (!ready || !current() || stateRef.current.fillerPlayed) return;
        dispatch({ type: 'filler', turn: thinkingTurn });
        let finish: () => void = () => undefined;
        const done = new Promise<void>((resolve) => {
          const timer = window.setTimeout(() => finish(), FILLER_MAX_MS);
          finish = () => {
            window.clearTimeout(timer);
            if (fillerRef.current?.done === done) fillerRef.current = null;
            quietSinceRef.current = Date.now();
            resolve();
          };
        });
        fillerRef.current = {
          done,
          stop: () => {
            stopTTS();
            finish();
          },
        };
        void playTTS(FILLER_LINE, TUTOR_VOICE, () => finish(), () => finish(), undefined, { fallback: 'none' });
      });
    }, FILLER_AFTER_MS);
    const slowTimer = window.setTimeout(() => {
      if (current()) dispatch({ type: 'slow', turn: thinkingTurn });
    }, SLOW_AFTER_MS);
    const history = pending.history;
    const body: TutorTurnBody =
      pending.kind === 'answer'
        ? { material_id: materialId, kind: 'answer', target_id: pending.targetId, rung: pending.rung, utterance: pending.utterance, history }
        : { material_id: materialId, kind: 'question', utterance: pending.utterance, history };
    tutorTurn(body, { signal: controller.signal }).then(
      (response) => {
        if (!live) return;
        track('tutor_turn', { move: response.move, status: response.status ?? 'none', wait: waitBucket(Date.now() - sentAt) });
        dispatch({ type: 'reply', turn: thinkingTurn, response, now: Date.now() });
      },
      (error: unknown) => {
        if (!live || (isTutorApiError(error) && error.kind === 'aborted')) return;
        dispatch({ type: 'failed', turn: thinkingTurn, error: turnErrorOf(error) });
      },
    );
    return () => {
      live = false;
      controller.abort();
      window.clearTimeout(fillerTimer);
      window.clearTimeout(slowTimer);
    };
  }, [materialId, thinkingTurn]);

  // ── The microphone: open LISTEN_AFTER_AUDIO_MS after the voice went quiet, closed in any other phase ──
  const listening = state.phase === 'listening';
  useEffect(() => {
    if (!listening) return undefined;
    const wait = Math.max(0, LISTEN_AFTER_AUDIO_MS - (Date.now() - quietSinceRef.current));
    const timer = window.setTimeout(() => {
      if (stateRef.current.phase !== 'listening') return;
      const voiceInput = speechRef.current;
      if (!voiceInput.start()) dispatch({ type: 'mic_failed', kind: 'unsupported', text: voiceInput.snapshot() });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [listening]);

  useEffect(() => {
    if (state.phase === 'listening' || state.phase === 'recognising') return;
    // Never while the tutor speaks: whatever left listening without «Готово» pauses the microphone.
    if (speechRef.current.status === 'listening') speechRef.current.pause();
  }, [state.phase]);

  // A new line of the tutor: a new answer starts empty.
  const lineId = state.line?.id ?? null;
  useEffect(() => {
    speechRef.current.reset('');
  }, [lineId]);

  // ── Recognition failed: the microphone forbidden or missing — writing; anything else — repeat ──
  useEffect(() => {
    if (speech.status !== 'error' || !speech.error) return;
    const current = stateRef.current;
    if (current.phase !== 'listening' && current.phase !== 'recognising') return;
    const said = speechRef.current.snapshot();
    if (speech.error === 'not-allowed') {
      focusTextRef.current = true;
      dispatch({ type: 'mic_failed', kind: 'denied', text: said });
    } else if (speech.error === 'audio-capture') {
      focusTextRef.current = true;
      dispatch({ type: 'mic_failed', kind: 'missing', text: said });
    } else {
      dispatch({ type: 'mic_failed', kind: 'failed' });
    }
  }, [speech.status, speech.error]);

  // ── Screen readers: the line once, only when it is not said aloud; nothing while the microphone is open ──
  useEffect(() => {
    const current = stateRef.current;
    setAnnouncement(current.line && !voiceActive(current) ? `Meldy: ${lineText(current.line)}` : '');
  }, [lineId]);
  const voiceFailed = state.notice?.kind === 'voice_failed' || state.voiceBroken;
  useEffect(() => {
    const current = stateRef.current;
    if (voiceFailed && current.line) setAnnouncement(`Meldy: ${lineText(current.line)}`);
  }, [voiceFailed]);
  useEffect(() => {
    if (listening) setAnnouncement('');
  }, [listening]);

  // ── The statistics: a session starts («Начать», «Продолжить разговор») and ends ──
  useEffect(() => {
    const current = stateRef.current;
    if (current.startedAt) track('tutor_started', { cards: current.cards.length, mode: current.mode });
  }, [state.startedAt]);
  useEffect(() => {
    if (state.phase === 'ended') report(stateRef.current);
  }, [report, state.phase]);

  // ── No connection: the turn goes again as soon as the browser is back online ──
  const offline = state.phase === 'error' && state.error?.kind === 'offline';
  useEffect(() => {
    if (!offline) return undefined;
    const onOnline = () => dispatch({ type: 'retry' });
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [offline]);

  // ── Actions ──
  const begin = (mode: InputMode) => {
    const current = stateRef.current;
    if (current.phase !== 'start') return;
    const chosen: InputMode = speechRef.current.supported ? mode : 'text';
    if (chosen === 'text') focusTextRef.current = true;
    // The first line's voice starts within this tap (the effect runs before the click returns): it unlocks the sound.
    dispatch({ type: 'begin', mode: chosen, now: Date.now() });
    if (!speechRef.current.supported) dispatch({ type: 'notice', notice: { kind: 'no_voice_input', text: NOTICE_TEXT.no_voice_input } });
  };

  /** «Отвечать» or Space: the voice stops, the microphone opens after it. */
  const answer = () => {
    const current = stateRef.current;
    if (!(current.phase === 'speaking' || current.phase === 'idle' || current.phase === 'typing')) return;
    if (!speechRef.current.supported) return;
    // From writing: the words typed so far stay in the answer.
    if (current.mode === 'text') speechRef.current.reset(current.typed);
    dispatch({ type: 'listen' });
  };

  /** The phase now (read again after an await: the state may have moved on meanwhile). */
  const phaseNow = (): TutorState['phase'] => stateRef.current.phase;

  /** «Готово» aloud: the last words are recognised, then the reply goes. */
  const done = async () => {
    if (phaseNow() !== 'listening') return;
    const token = (hearTokenRef.current += 1);
    dispatch({ type: 'recognise' });
    const text = await speechRef.current.stop();
    if (!mountedRef.current || token !== hearTokenRef.current || phaseNow() !== 'recognising') return;
    dispatch({ type: 'heard', text });
  };

  const submit = () => dispatch({ type: 'submit' });

  /** «Текстом»: the words said so far go into the field. */
  const toText = async () => {
    const current = stateRef.current;
    if (!inTurn(current)) return;
    focusTextRef.current = true;
    if (current.phase === 'listening') {
      const token = (hearTokenRef.current += 1);
      dispatch({ type: 'recognise' });
      const text = await speechRef.current.stop();
      if (!mountedRef.current || token !== hearTokenRef.current || phaseNow() !== 'recognising') return;
      dispatch({ type: 'mode', mode: 'text', text });
      return;
    }
    dispatch({ type: 'mode', mode: 'text', text: speechRef.current.snapshot() || current.typed });
  };

  /** «Голосом» from writing: the typed words stay and the microphone opens. */
  const toVoice = () => answer();

  const dontKnow = () => {
    if (!inTurn(stateRef.current)) return;
    hearTokenRef.current += 1;
    speechRef.current.reset('');
    dispatch({ type: 'dont_know' });
  };

  const ask = () => {
    const current = stateRef.current;
    if (!inTurn(current)) return;
    if (current.asking) {
      dispatch({ type: 'ask', on: false });
      return;
    }
    dispatch({ type: 'ask', on: true });
    if (current.mode === 'text') focusTextRef.current = true;
    // Aloud: the question is said right away.
    else if (current.phase === 'speaking' || current.phase === 'idle') answer();
  };

  const repeat = () => {
    if (stateRef.current.phase === 'listening') speechRef.current.pause();
    // «Повторить звук»: the server is asked again at once, without waiting out earlier failures.
    forgetTTSFailures();
    dispatch({ type: 'repeat' });
  };

  const toggleVoice = () => {
    const on = !voiceActive(stateRef.current);
    writeVoicePreference(on);
    if (!on) stopFiller();
    dispatch({ type: 'voice', on });
  };

  /** Esc: the voice stops, the turn is the student's. */
  const stopVoice = () => {
    const current = stateRef.current;
    stopFiller();
    if (current.speech) dispatch({ type: 'spoken', speech: current.speech.id, played: true });
    else stopTTS();
  };

  const finish = () => {
    hearTokenRef.current += 1;
    speechRef.current.reset('');
    stopFiller();
    stopTTS();
    dispatch({ type: 'finish', now: Date.now() });
  };

  const retry = () => dispatch({ type: 'retry' });

  /** A lost card (409): the session is read again from the server, from the start card. */
  const startOver = () => {
    report(stateRef.current, 'error');
    dispatch({ type: 'reload' });
  };

  const reload = () => dispatch({ type: 'reload' });

  const continueTalk = () => {
    const current = stateRef.current;
    if (current.phase !== 'ended') return;
    stopFiller();
    dispatch({ type: 'continue', now: Date.now() });
  };

  // ── Space and Esc ──
  const keysRef = useRef({ answer, done, stopVoice });
  keysRef.current = { answer, done, stopVoice };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || sheetOpenRef.current) return;
      const current = stateRef.current;
      if (event.key === 'Escape') {
        if (current.speech || fillerRef.current) {
          event.preventDefault();
          keysRef.current.stopVoice();
        }
        return;
      }
      if (event.key !== ' ' && event.code !== 'Space') return;
      if (typingInto(event.target) || onControl(event.target)) return;
      if (current.phase === 'listening') {
        event.preventDefault();
        if (!event.repeat) void keysRef.current.done();
        return;
      }
      if ((current.phase === 'speaking' && current.mode === 'voice') || current.phase === 'idle') {
        event.preventDefault();
        if (!event.repeat) keysRef.current.answer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── What matters now comes into view: on a phone the desk is taller than the window, and the fixed
  //    bar covers its bottom (the CSS scroll margins keep the block clear of both bars) ──
  const view =
    state.phase === 'error'
      ? 'lt-error'
      : state.phase === 'listening' || state.phase === 'recognising'
        ? 'lt-answer'
        : state.notice
          ? 'lt-notice'
          : state.phase === 'thinking'
            ? state.slow
              ? 'lt-wait'
              : null
            : state.phase === 'ended'
              ? null
              : 'lt-tutor';
  // While listening the card grows with the words (up to three lines): it is kept in view as it does.
  const heardLines = view === 'lt-answer' ? Math.min(4, Math.ceil((speech.finalText.length + speech.interimText.length) / 32)) : 0;
  const viewKey = view ? `${view}|${state.line?.id ?? ''}|${state.notice?.kind ?? ''}|${state.phase}|${heardLines}` : null;
  useEffect(() => {
    if (!view || !viewKey) return;
    const block = roomRef.current?.querySelector<HTMLElement>(`.${view}`);
    if (block) bringIntoView(block);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  // ── Focus: a control removed by a state change hands the focus to the state's main control ──
  const rememberFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement) lastFocusRef.current = event.target;
  }, []);

  useLayoutEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    if (focusTextRef.current) {
      const field = room.querySelector<HTMLTextAreaElement>('textarea.or-text-field');
      if (field) {
        focusTextRef.current = false;
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
        return;
      }
    }
    const lost = lastFocusRef.current;
    const active = document.activeElement;
    if (!lost || lost.isConnected || (active && active !== document.body)) return;
    room.querySelector<HTMLElement>('[data-anchor]')?.focus();
  });

  // ── What the screen says ──
  const title = state.title;

  if (state.phase === 'loading' || state.phase === 'load_error' || state.phase === 'start') {
    let body: ReactNode;
    if (state.phase === 'loading') {
      body = (
        <p className="or-message or-message-muted" role="status">
          Загружаем лекцию…
        </p>
      );
    } else if (state.phase === 'load_error') {
      body = (
        <div className="or-state">
          <h1 className="or-state-title">Разговор не начался</h1>
          <p className="or-state-text" role="alert">
            {state.loadError}
          </p>
          <div className="or-acts">
            {state.loadRetry ? (
              <button type="button" className="sf-primary" onClick={reload} data-anchor="">
                Повторить
              </button>
            ) : null}
            <Link className={state.loadRetry ? 'sf-link' : 'sf-primary'} to={back}>
              К лекции
            </Link>
          </div>
        </div>
      );
    } else {
      body = (
        <section className="lt-start" aria-labelledby="lt-start-title">
          {title ? <p className="lt-start-lecture">{glue(`Лекция «${title}»`)}</p> : null}
          <h1 id="lt-start-title" className="lt-start-title">
            Поговорить о лекции
          </h1>
          <p className="lt-start-lede">{glue(`Meldy задаст ${questionsWord(state.cards.length)} по карточкам этой лекции.`)}</p>
          <div className="lt-start-steps">
            <p>Включите звук. Браузер спросит про микрофон — разрешите.</p>
            <p>Микрофон слушает, только пока на кнопке написано «Готово».</p>
          </div>
          <p className="lt-start-fine">Реплики пишет ИИ только по тексту этой лекции. Слова лекции — на карточках с номером фрагмента, остальное — пояснения Meldy.</p>
          {!speech.supported ? <p className="or-message or-message-muted">{NOTICE_TEXT.no_voice_input}</p> : null}
          <div className="or-acts">
            <button type="button" className="sf-primary" onClick={() => begin('voice')} data-anchor="">
              Начать
            </button>
            {speech.supported ? (
              <button type="button" className="sf-link" onClick={() => begin('text')}>
                Текстом, без микрофона
              </button>
            ) : null}
          </div>
        </section>
      );
    }
    return (
      <div className="or-shell lt-shell" ref={roomRef} onFocus={rememberFocus}>
        <TalkBar materialId={materialId} title={title} />
        <main className="sf-page or-room or-room-single lt-room" data-phase={state.phase}>
          {body}
        </main>
      </div>
    );
  }

  const ended = state.phase === 'ended';
  const thinking = state.phase === 'thinking';
  const recognising = state.phase === 'recognising';
  const errored = state.phase === 'error';
  const turnOpen = inTurn(state);
  const writing = state.mode === 'text' && (state.phase === 'typing' || state.phase === 'speaking');
  const asking = state.asking || (state.pending?.kind === 'question' && (thinking || errored));
  const answerLabel = asking ? 'Ваш вопрос' : 'Ваш ответ';
  const progress = ended ? 'Разговор окончен' : `Вопрос ${state.index + 1} из ${state.cards.length}`;

  const voiceLinks = (
    <>
      {voice && !thinking && !errored ? (
        <>
          <button type="button" className="sf-link" data-muted="" onClick={repeat}>
            Повторить
          </button>
          <span className="lt-dot" aria-hidden="true">
            ·
          </span>
        </>
      ) : null}
      <button type="button" className="sf-link" data-muted="" onClick={toggleVoice}>
        {voice ? 'Без звука' : 'Включить голос'}
      </button>
    </>
  );
  const tutorCard = state.line ? <TutorCard key={`line-${state.line.id}`} line={state.line} links={voiceLinks} /> : null;
  const slip = state.line?.slip ? <TutorSlip key={`slip-${state.line.id}`} slip={state.line.slip} /> : null;

  // ── The answer block ──
  let answerBlock: ReactNode = null;
  if (!ended) {
    const sent = thinking || errored ? state.pending?.utterance ?? '' : '';
    const voiceTurn = state.mode === 'voice' && !thinking && !errored;
    const emptyText = listening
      ? 'Говорите — я слушаю.'
      : voiceTurn && !recognising
        ? asking
          ? 'Нажмите «Отвечать» и задайте вопрос по лекции.'
          : 'Нажмите «Отвечать», когда будете готовы.'
        : undefined;
    let voiceLine: ReactNode = null;
    if (recognising) {
      voiceLine = <p className="or-voice">{RECOGNISING_LINE}</p>;
    } else if (listening && speech.engine === 'server') {
      // No live region while the microphone is open: a screen reader's voice would be heard as the answer.
      voiceLine = (
        <p className="or-voice">
          {speech.status === 'listening' ? <MicLevel feed={speech.level} /> : null}
          <span>{serverVoiceLine(speech.pending, speech.lost)}</span>
        </p>
      );
    } else if (listening && speech.stuck) {
      voiceLine = <p className="or-stuck">Текст не появляется? Проверьте, что браузеру разрешён нужный микрофон, или ответьте текстом.</p>;
    }
    answerBlock = (
      <section className="lt-answer" aria-label={answerLabel} data-listening={listening ? '' : undefined}>
        {writing ? (
          <div className="or-said">
            <label className="or-said-label" htmlFor="lt-answer-text">
              {answerLabel}
            </label>
            <textarea
              id="lt-answer-text"
              className="or-text-field"
              placeholder={asking ? 'Спросите о том, что есть в лекции' : 'Напишите ответ своими словами'}
              value={state.typed}
              maxLength={1500}
              onChange={(event) => dispatch({ type: 'typed', text: event.target.value })}
              data-anchor=""
            />
          </div>
        ) : (
          <LiveTranscript
            label={answerLabel}
            finalText={sent || (state.mode === 'voice' ? speech.finalText : state.typed)}
            interimText={listening ? speech.interimText : ''}
            underlined={NO_MARKS}
            seed={seedFrom(materialId, 'tutor')}
            emptyText={emptyText}
          />
        )}
        {voiceLine}
      </section>
    );
  }

  // ── Lines under the answer ──
  const notice = state.notice;
  const noticeLine = notice ? (
    // «Не расслышала» said aloud is not read out again.
    <p className="or-message lt-notice" role={notice.kind === 'not_heard' && voice ? undefined : 'status'}>
      {notice.text}
      {notice.kind === 'voice_failed' ? (
        <>
          {' '}
          <button type="button" className="sf-link lt-inline" onClick={repeat}>
            Повторить звук
          </button>
        </>
      ) : null}
    </p>
  ) : null;
  const voiceGone =
    state.voiceOn && state.voiceBroken && !ended ? (
      <p className="or-message or-message-muted" role="status">
        {VOICE_UNAVAILABLE_LINE}
      </p>
    ) : null;
  const slowLine = thinking && state.slow ? (
    <p className="lt-wait" role="status">
      {SLOW_LINE}
    </p>
  ) : null;
  const errorLine =
    errored && state.error ? (
      <p className="or-message lt-error" role="alert">
        {state.error.message}
      </p>
    ) : null;

  // ── The bar: one blue pill and the quiet words ──
  let acts: ReactNode = null;
  if (errored && state.error) {
    const kind = state.error.kind;
    acts = (
      <div className="or-acts lt-acts" data-wide="">
        {kind === 'limit' || kind === 'other' ? (
          <Link className="sf-primary" to={back} data-anchor="">
            К лекции
          </Link>
        ) : kind === 'restart' ? (
          <button type="button" className="sf-primary" onClick={startOver} data-anchor="">
            Начать заново
          </button>
        ) : (
          <button type="button" className="sf-primary" onClick={retry} data-anchor="">
            Повторить
          </button>
        )}
        {kind === 'other' ? (
          <button type="button" className="sf-link" onClick={retry}>
            Повторить
          </button>
        ) : null}
        <button type="button" className="sf-link" data-muted="" onClick={finish}>
          Закончить
        </button>
      </div>
    );
  } else if (!ended) {
    const pill = listening
      ? { label: 'Готово', onClick: () => void done(), off: false }
      : recognising
        ? { label: 'Готово', onClick: undefined, off: true }
        : writing
          ? { label: 'Готово', onClick: submit, off: false }
          : thinking
            ? { label: 'Отвечать', onClick: undefined, off: true }
            : { label: 'Отвечать', onClick: answer, off: false };
    const quiet = !turnOpen;
    acts = (
      <div className="or-acts lt-acts" data-wide="">
        <button
          type="button"
          className="sf-primary"
          onClick={pill.onClick}
          aria-disabled={pill.off || undefined}
          aria-busy={recognising || undefined}
          data-anchor={writing ? undefined : ''}
        >
          {pill.label}
        </button>
        {!speech.supported ? null : state.mode === 'voice' ? (
          <button type="button" className="sf-link" onClick={() => void toText()} aria-disabled={quiet || undefined}>
            Текстом
          </button>
        ) : (
          <button type="button" className="sf-link" onClick={toVoice} aria-disabled={quiet || undefined}>
            Голосом
          </button>
        )}
        <button type="button" className="sf-link" onClick={dontKnow} aria-disabled={quiet || undefined}>
          Не знаю
        </button>
        <button type="button" className="sf-link" onClick={ask} aria-disabled={quiet || undefined}>
          {state.asking ? 'Не спрашивать' : 'Спросить'}
        </button>
        <button type="button" className="sf-link" data-muted="" onClick={finish}>
          Закончить
        </button>
      </div>
    );
  }

  // ── The summary ──
  const summary = ended ? summaryOf(state, Date.now()) : null;
  const endCard = summary ? (
    <section className="lt-end" aria-labelledby="lt-end-title">
      <h2 id="lt-end-title" className="lt-end-title" tabIndex={-1} data-anchor="">
        {glue(summary.title)}
      </h2>
      <p className="lt-end-line">{glue(summary.counts)}</p>
      {summary.reread ? <p className="lt-end-line">{glue(summary.reread)}</p> : null}
      <div className="or-acts lt-acts" data-wide="">
        <button type="button" className="sf-primary" onClick={continueTalk}>
          Продолжить разговор
        </button>
        <Link className="sf-link" to={back}>
          К лекции
        </Link>
      </div>
    </section>
  ) : null;

  return (
    <div className="or-shell lt-shell" ref={roomRef} onFocus={rememberFocus}>
      <TalkBar materialId={materialId} title={title} />
      <main className="sf-page or-room lt-room" data-phase={state.phase}>
        <section className="or-left lt-left" aria-label="Лекция и текст разговора">
          <div className="sf-sheet lt-paper">
            <h1 className="lt-title">
              <span className="sr-only">Поговорить о лекции: </span>
              {title}
            </h1>
            <p className="lt-meta">
              <span>{progress}</span>
              <button type="button" className="sf-link lt-sheet-open" onClick={() => setSheetOpen(true)}>
                Текст разговора
              </button>
            </p>
            <Protocol rows={state.protocol} />
          </div>
        </section>
        <section className="or-side lt-desk" aria-label="Разговор">
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {announcement}
          </p>
          {tutorCard}
          {slip}
          {answerBlock}
          {errorLine}
          {noticeLine}
          {voiceGone}
          {slowLine}
          {acts}
          {endCard}
          {!ended && !errored && state.mode === 'voice' && speech.supported ? <p className="lt-keys">{KEYS_LINE}</p> : null}
        </section>
        {sheetOpen ? <TalkSheet rows={state.protocol} onClose={() => setSheetOpen(false)} /> : null}
      </main>
    </div>
  );
}
