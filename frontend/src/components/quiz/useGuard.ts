import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { sendGuardEvents } from '../../api/quizzes';
import {
  Episodes,
  GuardQueue,
  guardRetryDelay,
  HIDDEN_SEND_MS,
  looksSplit,
  overLimit,
  SEND_DELAY_MS,
  SEND_GAP_MS,
  splitQueries,
  type AwayKind,
  type GuardEvent,
  type GuardLevel,
  type Size,
} from '../../lib/quizzes/guard';

/**
 * «Защита от списывания» on the participant's page (20261020120000_quiz_protection; the rules in lib/quizzes/guard.ts).
 * QuizRun runs it for a quiz with protection; it does nothing for 'off'.
 *
 * - The cover: the moment the page loses the focus (window blur with document.hasFocus() false), is hidden
 *   (visibilitychange, pagehide, freeze), shrinks like a split screen (two media queries against the window's size at
 *   the start) or leaves the strict level's fullscreen, the handler turns on the cover (GuardLayer's opaque card, its
 *   opacity on its own compositor layer) and hides the question from the page (html[data-qg-away]: visibility, so an
 *   assistant reading the screen's text finds none). Both are attribute writes in the same task: the next frame has
 *   them. Nothing reads a size or a layout in a handler; the media queries are checked by the engine, and the window's
 *   size is read once at the start (and once after a turn of the phone), in an animation frame.
 * - The focus coming back (and the page visible, not split, in fullscreen when the strict level had it) takes the cover
 *   off and closes the episode with its duration. A focus moved into the page's own frame (a video of a studio page)
 *   is not a loss: document.hasFocus() stays true, and a light poll watches it while the frame has the focus.
 * - Events: an episode once (Episodes), copies and pastes; kept on the device (GuardQueue) and sent in batches: a new
 *   event waits SEND_DELAY_MS for others, two sends at least SEND_GAP_MS apart, a second after the page is hidden (a
 *   reload never gets there: its own hiding is the reload, which the server records, not a time away), again after a
 *   failure (sooner and sooner apart, at once when the network comes back), and on the next load of the attempt — when a
 *   time away the unloaded page left open is settled (GuardQueue.settleUnload: the reload itself goes, an older one stays
 *   with its duration).
 * - A turn of the phone is not a split screen: the screen's own orientation changed and its sides swapped (or, as
 *   Safari keeps them, stayed); then the size is read again.
 * - The strict level: no selecting, copying, dragging or context menu of the question (inputs keep theirs); fullscreen
 *   (asked for by «Начать» / «Продолжить», a gesture) — its end is an event and the card asks to go back; at the limit
 *   (the server's count or this page's, whichever is higher) the waiting events go first, then onLimit ends the attempt.
 * - Both levels keep the screen on while the attempt is open (Screen Wake Lock, where there is one), so a phone left
 *   still does not lock itself into an event; the context menu of the run (a long press on a picture opens a window
 *   that takes the focus on Android) is off.
 * Listeners that only observe are passive; copy / contextmenu / dragstart / selectstart of the strict level cancel and
 * so cannot be (they are not scroll or touch events).
 */

export type CoverReason = 'away' | 'split' | 'fullscreen';

export interface GuardOptions {
  attemptId: string;
  token: string | null;
  level: GuardLevel;
  limit: number;
  /** The server's count of the attempt when the page got it. */
  initialCount: number;
  /** false once the attempt is ending: no cover, no new events (the waiting ones still go). */
  active: boolean;
  /** The strict level reached its limit (once). */
  onLimit: (count: number) => void;
}

export interface GuardView {
  level: GuardLevel;
  count: number;
  /** The duration of the last time away (ms). */
  lastMs: number | null;
  /** The strict level refused a copy (a quiet line says why). */
  copyRefused: boolean;
  coverRef: RefObject<HTMLDivElement>;
  /** The question on screen now (1-based): the run sets it, the events carry it. */
  qRef: MutableRefObject<number | null>;
  /** The card's button after fullscreen ended: back to fullscreen (a gesture), the cover off either way. */
  resumeFullscreen: () => void;
}

const PASSIVE: AddEventListenerOptions = { passive: true };
const FOCUS_POLL_MS = 500;
const ROTATE_SETTLE_MS = 350;

type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as FullscreenDoc;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** The browser can put an element on the whole screen (Android Chrome yes, iPhone Safari no). */
export function fullscreenAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as FullscreenEl;
  return Boolean((document.fullscreenEnabled && typeof el.requestFullscreen === 'function') || typeof el.webkitRequestFullscreen === 'function');
}

/** Ask for fullscreen; must run inside a gesture (a press). Resolves whether the page is on the whole screen. */
export function enterFullscreen(): Promise<boolean> {
  if (!fullscreenAvailable()) return Promise.resolve(false);
  const el = document.documentElement as FullscreenEl;
  try {
    const asked = typeof el.requestFullscreen === 'function' ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    return Promise.resolve(asked).then(
      () => fullscreenElement() !== null,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

export function leaveFullscreen(): void {
  const doc = document as FullscreenDoc;
  if (!fullscreenElement()) return;
  try {
    const left = typeof doc.exitFullscreen === 'function' ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
    Promise.resolve(left).catch(() => undefined);
  } catch {
    // Not in fullscreen after all.
  }
}

function typingIn(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

function orientation(): string {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.type === 'string') return screen.orientation.type.split('-')[0];
  const legacy = (window as Window & { orientation?: unknown }).orientation;
  return typeof legacy === 'number' ? (Math.abs(legacy) === 90 ? 'landscape' : 'portrait') : 'any';
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
}

export function useGuard({ attemptId, token, level, limit, initialCount, active, onLimit }: GuardOptions): GuardView {
  const coverRef = useRef<HTMLDivElement>(null);
  const qRef = useRef<number | null>(null);
  const [count, setCount] = useState(initialCount);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [copyRefused, setCopyRefused] = useState(false);
  const live = useRef({ active, onLimit, limit, level });
  live.current = { active, onLimit, limit, level };
  const resume = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (level === 'off' || typeof window === 'undefined') return undefined;
    const strict = level === 'strict';
    const root = document.documentElement;
    const episodes = new Episodes();
    const queue = new GuardQueue(attemptId);
    let known = initialCount;
    let limited = false;
    let split = false;
    let fullscreenSeen = fullscreenElement() !== null;
    let fullscreenLost = false;
    let base: Size | null = null;
    let baseTurn = orientation();
    let baseScreen = { width: screen.width, height: screen.height };
    let rotating = false;
    let queries: MediaQueryList[] = [];
    let splitFrame = 0;
    let poll = 0;
    let sendTimer = 0;
    let lastSend = 0;
    let failures = 0;
    let sending: Promise<void> | null = null;
    let stopped = false;
    let wake: { release: () => Promise<void> } | null = null;

    root.setAttribute('data-qg', level);

    // ── the cover: attribute writes only ──
    const reason = (): CoverReason | null => (fullscreenLost ? 'fullscreen' : split ? 'split' : episodes.isAway ? 'away' : null);
    const render = () => {
      const why = live.current.active ? reason() : null;
      const el = coverRef.current;
      if (el) {
        if (why) {
          el.dataset.reason = why;
          el.setAttribute('data-on', '');
          el.removeAttribute('aria-hidden');
        } else {
          el.removeAttribute('data-on');
          el.setAttribute('aria-hidden', 'true');
        }
      }
      if (why) root.setAttribute('data-qg-away', '');
      else root.removeAttribute('data-qg-away');
    };

    // ── sending ──
    const raise = (next: number) => {
      if (next > known) {
        known = next;
        setCount(next);
      }
      // At the limit the waiting events go first, then the end — once the page is in front: a page hidden right now
      // may be on its way to a reload, whose own hiding is not a time away (the next load drops it).
      if (!limited && overLimit(live.current.level, known, live.current.limit) && document.visibilityState !== 'hidden') {
        limited = true;
        void flush(true).finally(() => live.current.onLimit(known));
      }
    };
    // One timer; a sooner send replaces a later one.
    let sendAt = 0;
    const schedule = (delay: number) => {
      if (stopped) return;
      const at = Date.now() + delay;
      if (sendTimer && sendAt <= at) return;
      if (sendTimer) window.clearTimeout(sendTimer);
      sendAt = at;
      sendTimer = window.setTimeout(() => {
        sendTimer = 0;
        void flush(false);
      }, delay);
    };
    const flush = (now: boolean): Promise<void> => {
      if (sending) return sending.then(() => (queue.size > 0 && now ? flush(true) : undefined));
      if (queue.size === 0) return Promise.resolve();
      const wait = lastSend + SEND_GAP_MS - Date.now();
      if (!now && wait > 0) {
        schedule(wait);
        return Promise.resolve();
      }
      if (sendTimer) {
        window.clearTimeout(sendTimer);
        sendTimer = 0;
      }
      const batch = queue.batch();
      lastSend = Date.now();
      sending = sendGuardEvents(attemptId, batch.events, token)
        .then(
          (answer) => {
            queue.ack(batch.versions);
            failures = 0;
            raise(answer.count);
            if (answer.finished && answer.reason === 'protection' && !limited) {
              limited = true;
              live.current.onLimit(Math.max(known, answer.count));
            }
            if (queue.size > 0) schedule(SEND_GAP_MS);
          },
          (error: unknown) => {
            const code = codeOf(error);
            // A batch the server refuses, or an attempt it no longer has: these events will never go.
            if (code === '22023' || code === 'P0002') {
              queue.drop(batch.versions);
              return;
            }
            failures += 1;
            schedule(guardRetryDelay(failures));
          },
        )
        .finally(() => {
          sending = null;
        });
      return sending;
    };
    /** Keeps the event on the device; sends it after `delay` (null: not from this page — it is going away). */
    const record = (event: GuardEvent | null, delay: number | null = SEND_DELAY_MS) => {
      if (!event) return;
      queue.put(event);
      if (delay !== null) schedule(delay);
    };

    // ── away and back ──
    const away = (kind: AwayKind, delay: number | null = SEND_DELAY_MS) => {
      if (!live.current.active || stopped) return;
      const before = episodes.opened;
      record(episodes.away(kind, Date.now(), qRef.current), delay);
      render();
      if (episodes.opened > before) raise(Math.max(known + 1, initialCount + episodes.opened));
    };
    const back = () => {
      if (stopped || split || fullscreenLost || !episodes.isAway) {
        render();
        return;
      }
      if (document.visibilityState === 'hidden' || !document.hasFocus()) return;
      const closed = episodes.back(Date.now());
      record(closed);
      if (closed?.ms !== null && closed?.ms !== undefined) setLastMs(closed.ms);
      render();
      raise(known);
    };

    const stopPoll = () => {
      if (poll) window.clearInterval(poll);
      poll = 0;
    };
    // The window's own blur and focus (an element's do not reach a window listener outside the capture phase; a Node
    // target would be one).
    const onBlur = (event: FocusEvent) => {
      if (event.target instanceof Node) return;
      // The focus went into the page's own frame (a video block): the page is still in front. Watch it from here.
      if (document.hasFocus()) {
        if (!poll) {
          poll = window.setInterval(() => {
            if (!document.hasFocus()) {
              stopPoll();
              away('blur');
            } else if (!(document.activeElement instanceof HTMLIFrameElement)) stopPoll();
          }, FOCUS_POLL_MS);
        }
        return;
      }
      away('blur');
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node) return;
      stopPoll();
      back();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        away('hidden', HIDDEN_SEND_MS);
        return;
      }
      if (wake === null) void keepAwake();
      if (document.hasFocus()) back();
      // A browser that sends no focus after the return: look again in a moment.
      else window.setTimeout(back, 400);
    };
    // The page is being unloaded or frozen: kept on the device, settled by the next load.
    const onHide = () => away('hidden', null);
    const onFullscreen = () => {
      if (!strict) return;
      if (fullscreenElement()) {
        fullscreenSeen = true;
        if (fullscreenLost) {
          fullscreenLost = false;
          back();
        }
        return;
      }
      if (!fullscreenSeen || stopped) return;
      fullscreenLost = true;
      away('fullscreen');
    };
    resume.current = () => {
      // The press is the gesture fullscreen needs; the cover goes either way (a browser that refuses is not asked again).
      void enterFullscreen().then((on) => {
        if (!on) fullscreenSeen = false;
        fullscreenLost = false;
        back();
      });
    };

    // ── split screen and floating windows: the engine checks two media queries ──
    const typing = () => typingIn(document.activeElement);
    // A turn: the screen's own orientation changed, and its sides swapped (or stayed, as Safari keeps them). A window
    // that only shrank (a split screen; an emulator that shrinks its «screen» with it) is no turn.
    const turned = () => {
      if (orientation() === baseTurn) return false;
      const swapped = screen.width === baseScreen.height && screen.height === baseScreen.width;
      const same = screen.width === baseScreen.width && screen.height === baseScreen.height;
      return swapped || same;
    };
    const checkSplit = () => {
      splitFrame = 0;
      if (!base || rotating) return;
      if (turned()) {
        rebase();
        return;
      }
      const now = queries.length === 2 && (queries[0].matches || (queries[1].matches && !typing()));
      if (now === split) return;
      split = now;
      if (split) away('split');
      else back();
      render();
    };
    const onQuery = () => {
      if (!splitFrame) splitFrame = window.requestAnimationFrame(checkSplit);
    };
    const listen = () => {
      for (const query of queries) query.removeEventListener('change', onQuery);
      if (!base || typeof window.matchMedia !== 'function') return;
      const q = splitQueries(base);
      queries = [window.matchMedia(q.width), window.matchMedia(q.height)];
      for (const query of queries) query.addEventListener('change', onQuery);
    };
    // The window's size at the start, and again after a turn of the phone: read once, in an animation frame.
    const rebase = () => {
      rotating = true;
      window.setTimeout(() => {
        window.requestAnimationFrame(() => {
          if (stopped) return;
          base = { width: window.innerWidth, height: window.innerHeight };
          baseTurn = orientation();
          baseScreen = { width: screen.width, height: screen.height };
          rotating = false;
          listen();
          if (split && !looksSplit(base, base, false)) {
            split = false;
            back();
            render();
          }
        });
      }, ROTATE_SETTLE_MS);
    };
    const firstFrame = window.requestAnimationFrame(() => {
      if (stopped) return;
      base = { width: window.innerWidth, height: window.innerHeight };
      baseTurn = orientation();
      baseScreen = { width: screen.width, height: screen.height };
      listen();
    });
    const onTurn = () => {
      if (turned()) rebase();
      else onQuery();
    };

    // ── copy, paste, the context menu ──
    const inField = (target: EventTarget | null) => target instanceof Element && typingIn(target);
    const onCopy = (event: ClipboardEvent) => {
      if (!live.current.active || inField(event.target)) return;
      if (strict) {
        event.preventDefault();
        setCopyRefused(true);
      }
      record(episodes.signal('copy', Date.now(), qRef.current));
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!live.current.active || !inField(event.target)) return;
      record(episodes.signal('paste', Date.now(), qRef.current));
    };
    const onMenu = (event: MouseEvent) => {
      if (!live.current.active || inField(event.target)) return;
      event.preventDefault();
    };
    const onBlock = (event: Event) => {
      if (!live.current.active || inField(event.target)) return;
      event.preventDefault();
    };
    const onOnline = () => {
      failures = 0;
      void flush(true);
    };

    // ── the screen stays on while the attempt is open ──
    const keepAwake = async () => {
      const lock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void>; addEventListener?: (type: string, fn: () => void) => void }> } }).wakeLock;
      if (!lock || document.visibilityState !== 'visible' || stopped) return;
      try {
        const sentinel = await lock.request('screen');
        if (stopped) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        wake = sentinel;
        sentinel.addEventListener?.('release', () => {
          if (wake === sentinel) wake = null;
        });
      } catch {
        wake = null;
      }
    };
    void keepAwake();

    window.addEventListener('blur', onBlur, PASSIVE);
    window.addEventListener('focus', onFocus, PASSIVE);
    document.addEventListener('visibilitychange', onVisibility, PASSIVE);
    window.addEventListener('pagehide', onHide, PASSIVE);
    document.addEventListener('freeze', onHide, PASSIVE);
    document.addEventListener('fullscreenchange', onFullscreen, PASSIVE);
    document.addEventListener('webkitfullscreenchange', onFullscreen, PASSIVE);
    window.addEventListener('online', onOnline, PASSIVE);
    screen.orientation?.addEventListener?.('change', onTurn, PASSIVE);
    window.addEventListener('orientationchange', onTurn, PASSIVE);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste, PASSIVE);
    document.addEventListener('contextmenu', onMenu);
    if (strict) {
      document.addEventListener('dragstart', onBlock);
      document.addEventListener('selectstart', onBlock);
    }
    // What waited on this device from before a reload goes now; a time away the last page left open is settled first.
    const loadedAt = typeof performance !== 'undefined' && performance.timeOrigin > 0 ? performance.timeOrigin : Date.now();
    queue.settleUnload(loadedAt);
    if (queue.size > 0) void flush(true);
    render();

    return () => {
      stopped = true;
      window.cancelAnimationFrame(firstFrame);
      if (splitFrame) window.cancelAnimationFrame(splitFrame);
      stopPoll();
      if (sendTimer) window.clearTimeout(sendTimer);
      for (const query of queries) query.removeEventListener('change', onQuery);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('freeze', onHide);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
      window.removeEventListener('online', onOnline);
      screen.orientation?.removeEventListener?.('change', onTurn);
      window.removeEventListener('orientationchange', onTurn);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onMenu);
      document.removeEventListener('dragstart', onBlock);
      document.removeEventListener('selectstart', onBlock);
      root.removeAttribute('data-qg');
      root.removeAttribute('data-qg-away');
      if (wake) void wake.release().catch(() => undefined);
      // Out of fullscreen once the attempt's page is gone (not when React only runs the effect again: data-qg is back).
      if (strict) window.setTimeout(() => {
        if (!root.hasAttribute('data-qg')) leaveFullscreen();
      }, 0);
      // The last events still go (an attempt that just ended takes them for ten minutes) — unless the page is hidden on
      // its way out: the next load settles them.
      if (queue.size > 0 && document.visibilityState !== 'hidden') {
        const batch = queue.batch();
        sendGuardEvents(attemptId, batch.events, token).then(
          () => queue.ack(batch.versions),
          () => undefined,
        );
      }
    };
    // One machine an attempt; the rest is read through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, level]);

  // The end began: the cover goes, nothing new is recorded.
  useEffect(() => {
    if (active || level === 'off') return;
    coverRef.current?.removeAttribute('data-on');
    coverRef.current?.setAttribute('aria-hidden', 'true');
    document.documentElement.removeAttribute('data-qg-away');
  }, [active, level]);

  return { level, count, lastMs, copyRefused, coverRef, qRef, resumeFullscreen: () => resume.current() };
}
