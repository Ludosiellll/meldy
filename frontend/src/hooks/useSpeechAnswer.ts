import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The answer said aloud, recognised by the browser (Web Speech API, ru-RU, continuous, with interim
 * results). Meldy never receives the sound: only the recognised text leaves the page.
 *
 * - start() can be called at any time (the follow-up starts it only after the examiner's question
 *   has been heard); calling it while paused continues the same answer.
 * - The browser ends recognition by itself after silence or a time limit: it is restarted 150 ms
 *   after onend unless the answer was paused or stopped. Three restarts that end without a single
 *   result within 10 s give up: the error state sends the screen to the text field.
 * - no-speech is ignored; not-allowed, audio-capture, network and service-not-allowed become error
 *   states with their own words (oral spec 3.5).
 * - stop() waits for onend at most 800 ms and keeps the last interim words in the answer.
 * - Without the API the hook reports unsupported and the screen offers only the text answer.
 */

export type SpeechStatus = 'idle' | 'listening' | 'paused' | 'stopped' | 'error' | 'unsupported';
export type SpeechErrorKind = 'not-allowed' | 'audio-capture' | 'network' | 'service-not-allowed' | 'restart-failed' | 'other';

export const SPEECH_UNSUPPORTED_MESSAGE = 'В этом браузере голосовой ввод недоступен — ответьте текстом.';

export const SPEECH_ERROR_MESSAGES: Record<SpeechErrorKind, string> = {
  'not-allowed': 'Браузер не дал доступ к микрофону. Разрешите его в настройках сайта (значок замка слева от адреса) или ответьте текстом.',
  'audio-capture': 'Микрофон не найден. Подключите его или ответьте текстом.',
  network: 'Распознаванию речи нужен интернет. Сказанное сохранено — можно продолжить текстом.',
  'service-not-allowed': 'Браузер не разрешает распознавание речи на этой странице — ответьте текстом.',
  'restart-failed': 'Распознавание речи остановилось и не запускается снова. Сказанное сохранено — продолжите текстом.',
  other: 'Распознавание речи остановилось. Сказанное сохранено — продолжите текстом.',
};

export const RESTART_DELAY_MS = 150;
export const STOP_WAIT_MS = 800;
export const RESTART_WINDOW_MS = 10_000;
export const RESTART_FAILURES = 3;

interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}

interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}

export interface RecognitionResultEvent {
  resultIndex: number;
  results: RecognitionResultList;
}

export interface RecognitionErrorEvent {
  error: string;
}

/** The part of SpeechRecognition the hook uses (Chrome ships it as webkitSpeechRecognition). */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => RecognitionLike;

export function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

const KNOWN_ERRORS = new Set<string>(['not-allowed', 'audio-capture', 'network', 'service-not-allowed']);

/** Joins pieces of recognised text with single spaces (Chrome starts later results with a space). */
export function joinSpeech(...parts: string[]): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}

export interface SpeechAnswer {
  supported: boolean;
  status: SpeechStatus;
  error: SpeechErrorKind | null;
  /** Words the browser will not change any more. */
  finalText: string;
  /** Words still being recognised. */
  interimText: string;
  /** When the last result (or the start) happened, for the «Говорите — я слушаю» hint. */
  lastActivityAt: number | null;
  /** Begin or continue listening. False when there is no speech API. */
  start: () => boolean;
  /** Stop listening for now; the text stays and start() continues it. */
  pause: () => void;
  /** Finish: stop, wait for the last words (≤ 800 ms) and return the whole answer. */
  stop: () => Promise<string>;
  /** Replace the answer (a restored draft, a new follow-up answer) and stop listening. */
  reset: (text?: string) => void;
  /** final + interim right now, without waiting for a render. */
  snapshot: () => string;
}

export function useSpeechAnswer(options: { lang?: string } = {}): SpeechAnswer {
  const lang = options.lang ?? 'ru-RU';
  const Ctor = useMemo(() => recognitionConstructor(), []);
  const supported = Ctor !== null;

  const [status, setStatus] = useState<SpeechStatus>(supported ? 'idle' : 'unsupported');
  const [error, setError] = useState<SpeechErrorKind | null>(null);
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);

  const recRef = useRef<RecognitionLike | null>(null);
  const statusRef = useRef<SpeechStatus>(supported ? 'idle' : 'unsupported');
  /** Text of earlier recognition sessions (and of a restored draft). */
  const baseRef = useRef('');
  /** Final results of the current session by result index. */
  const sessionFinalsRef = useRef(new Map<number, string>());
  const interimRef = useRef('');
  const runningRef = useRef(false);
  const acceptingRef = useRef(false);
  const sessionHadResultRef = useRef(false);
  const sessionIsRestartRef = useRef(false);
  const failuresRef = useRef<number[]>([]);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAfterEndRef = useRef(false);
  const stopWaitersRef = useRef<Array<() => void>>([]);
  const mountedRef = useRef(true);

  const setStatusBoth = useCallback((next: SpeechStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const sessionText = () =>
    joinSpeech(
      ...Array.from(sessionFinalsRef.current.entries())
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]),
    );

  const publish = useCallback(() => {
    if (!mountedRef.current) return;
    setFinalText(joinSpeech(baseRef.current, sessionText()));
    setInterimText(interimRef.current);
  }, []);

  /** Moves the session's words (with the last interim ones) into the base text. */
  const fold = useCallback(() => {
    baseRef.current = joinSpeech(baseRef.current, sessionText(), interimRef.current);
    sessionFinalsRef.current = new Map();
    interimRef.current = '';
    publish();
  }, [publish]);

  const clearRestart = () => {
    if (restartTimerRef.current !== null) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  };

  const releaseWaiters = () => {
    const waiters = stopWaitersRef.current;
    stopWaitersRef.current = [];
    for (const resolve of waiters) resolve();
  };

  const fail = useCallback(
    (kind: SpeechErrorKind) => {
      clearRestart();
      if (mountedRef.current) setError(kind);
      setStatusBoth('error');
    },
    [setStatusBoth],
  );

  // begin() and the handlers refer to each other; a ref keeps the latest begin for the timers.
  const beginRef = useRef<(restart: boolean) => void>(() => undefined);

  const noteFailedRestart = useCallback((): boolean => {
    const now = Date.now();
    failuresRef.current = [...failuresRef.current.filter((at) => now - at < RESTART_WINDOW_MS), now];
    if (failuresRef.current.length >= RESTART_FAILURES) {
      fail('restart-failed');
      return true;
    }
    return false;
  }, [fail]);

  const scheduleRestart = useCallback(() => {
    clearRestart();
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (statusRef.current === 'listening') beginRef.current(true);
    }, RESTART_DELAY_MS);
  }, []);

  const ensureRecognition = useCallback((): RecognitionLike | null => {
    if (recRef.current) return recRef.current;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      if (!acceptingRef.current) return;
      const results = event.results;
      for (let i = event.resultIndex; i < results.length; i += 1) {
        const result = results[i];
        if (result?.isFinal) sessionFinalsRef.current.set(i, result[0]?.transcript ?? '');
      }
      const interim: string[] = [];
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        if (result && !result.isFinal) interim.push(result[0]?.transcript ?? '');
      }
      interimRef.current = joinSpeech(...interim);
      sessionHadResultRef.current = true;
      if (mountedRef.current) setLastActivityAt(Date.now());
      publish();
    };
    rec.onerror = (event) => {
      const code = event?.error ?? '';
      if (code === 'no-speech' || code === 'aborted') return;
      fail(KNOWN_ERRORS.has(code) ? (code as SpeechErrorKind) : 'other');
    };
    rec.onend = () => {
      runningRef.current = false;
      fold();
      releaseWaiters();
      if (resumeAfterEndRef.current && statusRef.current === 'listening') {
        resumeAfterEndRef.current = false;
        beginRef.current(false);
        return;
      }
      resumeAfterEndRef.current = false;
      if (statusRef.current !== 'listening') return;
      if (sessionIsRestartRef.current && !sessionHadResultRef.current) {
        if (noteFailedRestart()) return;
      } else if (sessionHadResultRef.current) {
        failuresRef.current = [];
      }
      scheduleRestart();
    };
    recRef.current = rec;
    return rec;
  }, [Ctor, lang, fail, fold, noteFailedRestart, publish, scheduleRestart]);

  const begin = useCallback(
    (restart: boolean) => {
      const rec = ensureRecognition();
      if (!rec) return;
      sessionFinalsRef.current = new Map();
      interimRef.current = '';
      sessionHadResultRef.current = false;
      sessionIsRestartRef.current = restart;
      acceptingRef.current = true;
      try {
        rec.start();
        runningRef.current = true;
      } catch (caught) {
        const name = caught && typeof caught === 'object' && 'name' in caught ? String((caught as { name: unknown }).name) : '';
        if (name === 'InvalidStateError') {
          // Still running from before: let it end and start again then.
          resumeAfterEndRef.current = true;
          return;
        }
        if (restart) {
          if (!noteFailedRestart()) scheduleRestart();
          return;
        }
        fail('other');
      }
    },
    [ensureRecognition, fail, noteFailedRestart, scheduleRestart],
  );
  beginRef.current = begin;

  const start = useCallback((): boolean => {
    if (!Ctor) {
      setStatusBoth('unsupported');
      return false;
    }
    if (statusRef.current === 'listening') return true;
    clearRestart();
    failuresRef.current = [];
    if (mountedRef.current) {
      setError(null);
      setLastActivityAt(Date.now());
    }
    setStatusBoth('listening');
    if (runningRef.current) {
      // A pause is still finishing its last words: continue as soon as it has ended.
      resumeAfterEndRef.current = true;
      acceptingRef.current = true;
      return true;
    }
    begin(false);
    return true;
  }, [Ctor, begin, setStatusBoth]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'listening') return;
    clearRestart();
    resumeAfterEndRef.current = false;
    setStatusBoth('paused');
    if (runningRef.current) {
      try {
        recRef.current?.stop();
      } catch {
        runningRef.current = false;
      }
    }
  }, [setStatusBoth]);

  const stop = useCallback(async (): Promise<string> => {
    clearRestart();
    resumeAfterEndRef.current = false;
    if (statusRef.current !== 'unsupported') setStatusBoth('stopped');
    if (runningRef.current && recRef.current) {
      const rec = recRef.current;
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, STOP_WAIT_MS);
        stopWaitersRef.current.push(finish);
        try {
          rec.stop();
        } catch {
          finish();
        }
      });
      if (runningRef.current) {
        // No onend within 800 ms: keep what was heard and drop the rest of the session.
        acceptingRef.current = false;
        try {
          rec.abort();
        } catch {
          // already ended
        }
        runningRef.current = false;
      }
    }
    acceptingRef.current = false;
    fold();
    return baseRef.current;
  }, [fold, setStatusBoth]);

  const reset = useCallback(
    (text = '') => {
      clearRestart();
      resumeAfterEndRef.current = false;
      acceptingRef.current = false;
      if (runningRef.current) {
        try {
          recRef.current?.abort();
        } catch {
          // already ended
        }
        runningRef.current = false;
      }
      releaseWaiters();
      failuresRef.current = [];
      baseRef.current = joinSpeech(text);
      sessionFinalsRef.current = new Map();
      interimRef.current = '';
      if (mountedRef.current) setError(null);
      setStatusBoth(Ctor ? 'idle' : 'unsupported');
      publish();
    },
    [Ctor, publish, setStatusBoth],
  );

  const snapshot = useCallback(() => joinSpeech(baseRef.current, sessionText(), interimRef.current), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRestart();
      acceptingRef.current = false;
      releaseWaiters();
      const rec = recRef.current;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          // already ended
        }
      }
      recRef.current = null;
      runningRef.current = false;
    };
  }, []);

  return { supported, status, error, finalText, interimText, lastActivityAt, start, pause, stop, reset, snapshot };
}
