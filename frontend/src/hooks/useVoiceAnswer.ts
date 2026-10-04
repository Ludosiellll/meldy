import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RecorderError, SegmentRecorder, recorderSupported, type RecordedSegment } from '../lib/oral/recorder';
import { transcribeAudio } from '../lib/oral/transcribe';
import { joinSpeech, useSpeechAnswer, type SpeechAnswer, type SpeechErrorKind, type SpeechStatus } from './useSpeechAnswer';

/**
 * Устный ответ двумя способами распознавания с одним интерфейсом (SpeechAnswer):
 *
 * - 'browser' — Web Speech API (как раньше): текст появляется на ходу, Meldy звук не получает.
 * - 'server' — запись кусками по паузам (lib/oral/recorder) и распознавание на сервере
 *   (/api/oral/transcribe, Groq Whisper → Gemini): текст появляется после каждой фразы.
 *
 * Браузерное распознавание часто молчит без ошибки (Яндекс Браузер, сеть до Google закрыта,
 * выбран не тот микрофон) или падает с network / service-not-allowed. Поэтому:
 * - ошибка браузерного распознавания (кроме запрета микрофона) сразу переводит ответ на сервер,
 *   сказанное сохраняется, а состояние 'error' наружу не выходит;
 * - NO_RESULT_MS без единого слова — тоже на сервер (так молчит Chromium без ключей Google и браузеры
 *   на его основе); без записи на сервере — `stuck`, и экран советует проверить микрофон;
 * - без Web Speech API (Firefox и др.) сразу работает сервер;
 * - выбор сервера запоминается на этом устройстве (meldy_voice_engine).
 */

export type VoiceEngine = 'browser' | 'server';
export type SwitchReason = SpeechErrorKind | 'silence' | 'chosen';

export const VOICE_ENGINE_KEY = 'meldy_voice_engine';
export const NO_RESULT_MS = 7000;
export const SETTLE_TIMEOUT_MS = 20_000;
/** Ошибки браузерного распознавания, после которых ответ уходит на сервер. */
const SWITCH_ON = new Set<SpeechErrorKind>(['network', 'service-not-allowed', 'restart-failed', 'other']);
/** Подряд не распознанных кусков, после которых это ошибка сети, а не случайность. */
const LOST_IN_A_ROW = 2;
const ACTIVITY_THROTTLE_MS = 400;

export interface LevelFeed {
  /** Громкость 0…1 примерно раз в 50 мс; возвращает отписку. Без React-состояния: полоска рисуется сама. */
  subscribe: (listener: (level: number) => void) => () => void;
}

export interface VoiceAnswer extends SpeechAnswer {
  engine: VoiceEngine;
  serverSupported: boolean;
  /** Куски записи, которые ещё распознаются на сервере. */
  pending: number;
  /** Куски, которые сервер не смог распознать. */
  lost: number;
  /** Браузер слушает дольше NO_RESULT_MS и не дал ни одного слова. */
  stuck: boolean;
  /** Почему распознаёт сервер: ошибка браузера, тишина, выбор студента; null — сервер с самого начала. */
  switchedBecause: SwitchReason | null;
  level: LevelFeed;
  /** Дождаться распознавания уже сказанного (≤ 20 с) и вернуть весь ответ; слушать дальше. */
  settle: () => Promise<string>;
  /** Перейти на распознавание сервером сейчас, сохранив сказанное. */
  switchToServer: (why?: SwitchReason) => boolean;
}

function readEngine(): VoiceEngine | null {
  try {
    const value = window.localStorage.getItem(VOICE_ENGINE_KEY);
    return value === 'server' || value === 'browser' ? value : null;
  } catch {
    return null;
  }
}

function writeEngine(engine: VoiceEngine) {
  try {
    window.localStorage.setItem(VOICE_ENGINE_KEY, engine);
  } catch {
    // приватный режим: выбор живёт до перезагрузки
  }
}

function recorderErrorKind(error: unknown): SpeechErrorKind {
  if (error instanceof RecorderError) {
    if (error.kind === 'not-allowed') return 'not-allowed';
    if (error.kind === 'audio-capture') return 'audio-capture';
  }
  return 'other';
}

export function useVoiceAnswer(options: { lang?: string; hint?: string; server?: boolean } = {}): VoiceAnswer {
  const browser = useSpeechAnswer({ lang: options.lang });
  const serverSupported = useMemo(() => options.server !== false && recorderSupported(), [options.server]);
  const [engine, setEngine] = useState<VoiceEngine>(() => {
    if (!serverSupported) return 'browser';
    if (!browser.supported) return 'server';
    return readEngine() === 'server' ? 'server' : 'browser';
  });
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const [switchedBecause, setSwitchedBecause] = useState<SwitchReason | null>(null);

  // ── Сервер ──
  const [serverStatus, setServerStatus] = useState<SpeechStatus>('idle');
  const [serverError, setServerError] = useState<SpeechErrorKind | null>(null);
  const [serverText, setServerText] = useState('');
  const [pending, setPending] = useState(0);
  const [lost, setLost] = useState(0);
  const [serverActivity, setServerActivity] = useState<number | null>(null);
  const statusRef = useRef<SpeechStatus>('idle');
  const baseRef = useRef('');
  const partsRef = useRef(new Map<number, string>());
  const pendingRef = useRef(0);
  const lostRunRef = useRef(0);
  const generationRef = useRef(0);
  const recorderRef = useRef<SegmentRecorder | null>(null);
  const waitersRef = useRef<Array<() => void>>([]);
  const listenersRef = useRef(new Set<(level: number) => void>());
  const activityRef = useRef(0);
  const hintRef = useRef(options.hint ?? '');
  hintRef.current = options.hint ?? '';
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const setStatus = useCallback((next: SpeechStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setServerStatus(next);
  }, []);

  const serverSnapshot = useCallback(
    () =>
      joinSpeech(
        baseRef.current,
        ...Array.from(partsRef.current.entries())
          .sort((a, b) => a[0] - b[0])
          .map((entry) => entry[1]),
      ),
    [],
  );

  const publish = useCallback(() => {
    if (!mountedRef.current) return;
    setServerText(serverSnapshot());
    setPending(pendingRef.current);
  }, [serverSnapshot]);

  const releaseWaiters = useCallback(() => {
    if (pendingRef.current > 0) return;
    const waiters = waitersRef.current;
    waitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  const failServer = useCallback(
    (kind: SpeechErrorKind) => {
      recorderRef.current?.release();
      recorderRef.current = null;
      if (mountedRef.current) setServerError(kind);
      setStatus('error');
    },
    [setStatus],
  );

  const onSegment = useCallback(
    (segment: RecordedSegment) => {
      const generation = generationRef.current;
      pendingRef.current += 1;
      publish();
      const controller = abortRef.current ?? new AbortController();
      abortRef.current = controller;
      void transcribeAudio(segment.blob, { hint: hintRef.current, signal: controller.signal })
        .then(
          (text) => {
            if (generation !== generationRef.current) return;
            lostRunRef.current = 0;
            if (text.trim()) partsRef.current.set(segment.index, text.trim());
          },
          () => {
            if (generation !== generationRef.current) return;
            lostRunRef.current += 1;
            if (mountedRef.current) setLost((value) => value + 1);
            if (lostRunRef.current >= LOST_IN_A_ROW && partsRef.current.size === 0 && statusRef.current === 'listening') failServer('network');
          },
        )
        .finally(() => {
          if (generation !== generationRef.current) return;
          pendingRef.current = Math.max(0, pendingRef.current - 1);
          publish();
          releaseWaiters();
        });
    },
    [failServer, publish, releaseWaiters],
  );

  const startServer = useCallback((): boolean => {
    if (!serverSupported) return false;
    if (statusRef.current === 'listening' && recorderRef.current?.active) return true;
    if (mountedRef.current) {
      setServerError(null);
      setServerActivity(Date.now());
    }
    setStatus('listening');
    const recorder = new SegmentRecorder({
      onSegment,
      onLevel: (level) => listenersRef.current.forEach((listener) => listener(level)),
      onSpeech: (at) => {
        if (at - activityRef.current < ACTIVITY_THROTTLE_MS) return;
        activityRef.current = at;
        if (mountedRef.current) setServerActivity(at);
      },
    });
    recorderRef.current = recorder;
    const generation = generationRef.current;
    recorder.start().catch((error: unknown) => {
      if (generation !== generationRef.current || recorderRef.current !== recorder) return;
      failServer(recorderErrorKind(error));
    });
    return true;
  }, [failServer, onSegment, serverSupported, setStatus]);

  const waitPending = useCallback(
    (): Promise<void> =>
      pendingRef.current === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              waitersRef.current = waitersRef.current.filter((item) => item !== done);
              resolve();
            }, SETTLE_TIMEOUT_MS);
            const done = () => {
              clearTimeout(timer);
              resolve();
            };
            waitersRef.current.push(done);
          }),
    [],
  );

  const resetServer = useCallback(
    (text: string) => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      recorderRef.current?.release();
      recorderRef.current = null;
      baseRef.current = joinSpeech(text);
      partsRef.current = new Map();
      pendingRef.current = 0;
      lostRunRef.current = 0;
      const waiters = waitersRef.current;
      waitersRef.current = [];
      waiters.forEach((resolve) => resolve());
      if (mountedRef.current) {
        setServerError(null);
        setLost(0);
      }
      setStatus('idle');
      publish();
    },
    [publish, setStatus],
  );

  // ── Переход на сервер ──
  const switchToServer = useCallback(
    (why: SwitchReason = 'chosen'): boolean => {
      if (!serverSupported) return false;
      if (engineRef.current === 'server') return true;
      const listening = browser.status === 'listening' || why !== 'chosen';
      const carried = browser.snapshot();
      browser.reset(carried);
      engineRef.current = 'server';
      setEngine('server');
      setSwitchedBecause(why);
      writeEngine('server');
      resetServer(carried);
      if (listening) startServer();
      return true;
    },
    [browser, resetServer, serverSupported, startServer],
  );

  // Ошибка браузерного распознавания — дальше слушает сервер (если он есть).
  const browserSwitchable = engine === 'browser' && browser.status === 'error' && browser.error !== null && SWITCH_ON.has(browser.error) && serverSupported;
  useEffect(() => {
    if (browserSwitchable && browser.error) switchToServer(browser.error);
  }, [browserSwitchable, browser.error, switchToServer]);

  // Браузер слушает и молчит: ни одного нового слова за NO_RESULT_MS.
  const [stuck, setStuck] = useState(false);
  const startedTextRef = useRef('');
  const browserSnapshotRef = useRef(browser.snapshot);
  browserSnapshotRef.current = browser.snapshot;
  useEffect(() => {
    if (engine !== 'browser' || browser.status !== 'listening') {
      setStuck(false);
      return undefined;
    }
    startedTextRef.current = browserSnapshotRef.current();
    const timer = setTimeout(() => {
      if (browserSnapshotRef.current() === startedTextRef.current) setStuck(true);
    }, NO_RESULT_MS);
    return () => clearTimeout(timer);
  }, [engine, browser.status]);
  useEffect(() => {
    if (stuck && joinSpeech(browser.finalText, browser.interimText) !== startedTextRef.current) setStuck(false);
  }, [stuck, browser.finalText, browser.interimText]);
  // Silence from the browser with a microphone that works for the recorder: the server listens instead.
  useEffect(() => {
    if (stuck && serverSupported && engineRef.current === 'browser') switchToServer('silence');
  }, [stuck, serverSupported, switchToServer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      abortRef.current?.abort();
      recorderRef.current?.release();
      recorderRef.current = null;
    };
  }, []);

  const level = useMemo<LevelFeed>(
    () => ({
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [],
  );

  // ── Единый интерфейс ──
  const onServer = engine === 'server';

  const start = useCallback((): boolean => {
    if (engineRef.current === 'server') return startServer();
    if (browser.supported) return browser.start();
    return switchToServer('chosen') && startServer();
  }, [browser, startServer, switchToServer]);

  const pause = useCallback(() => {
    if (engineRef.current !== 'server') {
      browser.pause();
      return;
    }
    if (statusRef.current !== 'listening') return;
    setStatus('paused');
    const recorder = recorderRef.current;
    recorderRef.current = null;
    void recorder?.stop();
  }, [browser, setStatus]);

  const stop = useCallback(async (): Promise<string> => {
    if (engineRef.current !== 'server') return browser.stop();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (statusRef.current !== 'error') setStatus('stopped');
    if (recorder) await recorder.stop();
    await waitPending();
    return serverSnapshot();
  }, [browser, serverSnapshot, setStatus, waitPending]);

  const settle = useCallback(async (): Promise<string> => {
    if (engineRef.current !== 'server') return browser.snapshot();
    const recorder = recorderRef.current;
    if (recorder?.active) await recorder.flush();
    await waitPending();
    return serverSnapshot();
  }, [browser, serverSnapshot, waitPending]);

  const reset = useCallback(
    (text = '') => {
      if (engineRef.current !== 'server') {
        browser.reset(text);
        return;
      }
      resetServer(text);
    },
    [browser, resetServer],
  );

  const snapshot = useCallback(() => (engineRef.current === 'server' ? serverSnapshot() : browser.snapshot()), [browser, serverSnapshot]);

  // A browser error that is about to move the answer to the server is not shown as an error.
  const status: SpeechStatus = onServer ? serverStatus : browserSwitchable ? 'listening' : browser.status;
  const error: SpeechErrorKind | null = onServer ? serverError : browserSwitchable ? null : browser.error;

  return {
    supported: browser.supported || serverSupported,
    status: !browser.supported && !serverSupported ? 'unsupported' : status,
    error,
    finalText: onServer ? serverText : browser.finalText,
    interimText: onServer ? '' : browser.interimText,
    lastActivityAt: onServer ? serverActivity : browser.lastActivityAt,
    start,
    pause,
    stop,
    reset,
    snapshot,
    engine,
    serverSupported,
    pending: onServer ? pending : 0,
    lost: onServer ? lost : 0,
    stuck: !onServer && stuck,
    switchedBecause,
    level,
    settle,
    switchToServer,
  };
}
