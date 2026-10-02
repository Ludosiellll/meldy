export type VoiceRole = 'professor' | 'male' | 'female';

/**
 * Звук не удалось включить: сервер не ответил, а у браузера нет синтеза речи
 * или голосов, либо реплика так и не зазвучала за START_TIMEOUT_MS.
 */
export class TTSUnavailableError extends Error {
  readonly code = 'unavailable';
  constructor(readonly reason: 'no-synthesis' | 'no-voices' | 'timeout') {
    super(`Speech is unavailable: ${reason}`);
    this.name = 'TTSUnavailableError';
  }
}

export const isTTSUnavailable = (error: unknown): error is TTSUnavailableError =>
  error instanceof TTSUnavailableError;

/** Сколько ждём начала звука, прежде чем сказать, что он недоступен. */
const START_TIMEOUT_MS = 8000;
/** Сколько ждём, пока браузер загрузит голоса (Chrome и Android отдают их не сразу). */
const VOICES_TIMEOUT_MS = 2000;
/** Сколько не просим сервер снова озвучить реплику после временной ошибки (429, 5xx, нет сети). */
const LINE_RETRY_MS = 60_000;
/** Сервер отказал на нескольких репликах подряд: на это время все реплики звучат голосом браузера. */
const SERVER_PAUSE_MS = 30_000;
const SERVER_PAUSE_AFTER = 2;
/** Ответы, после которых повторять запрос бессмысленно: тот же текст снова не озвучится. */
const PERMANENT_STATUSES = new Set([400, 413, 422]);

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentPlaybackRate = 1.0;
let currentGenerationId = 0;
let startWatchdog: ReturnType<typeof setTimeout> | null = null;

/** Реплика, которая сейчас играет или загружается: зазвучала ли она и как сообщить об ошибке. */
interface PlaybackRun {
  started: boolean;
  fail: (error: unknown) => void;
}
let currentRun: PlaybackRun | null = null;

const clearWatchdog = () => {
  if (startWatchdog !== null) clearTimeout(startWatchdog);
  startWatchdog = null;
};

/**
 * Через START_TIMEOUT_MS без звука реплика считается несостоявшейся. На паузе
 * часы стоят: пауза до начала звука — это не ошибка загрузки.
 */
const armWatchdog = () => {
  clearWatchdog();
  const run = currentRun;
  if (!run || run.started) return;
  startWatchdog = setTimeout(() => {
    if (currentRun === run && !run.started) run.fail(new TTSUnavailableError('timeout'));
  }, START_TIMEOUT_MS);
};

// ── Озвучка с сервера и её кэш ──────────────────────────────────────────────
// Кэш хранит до 4 готовых object URL (ключ — роль + текст). И предзагрузка
// следующей реплики, и обычное воспроизведение идут через него, поэтому каждый
// URL рано или поздно освобождается при вытеснении.
//
// Неудачная загрузка запоминается ненадолго: временная ошибка (429 от
// ограничителя, 502, обрыв сети) — на минуту, а реплика, которую надо сыграть
// сейчас, получает ещё одну попытку, если не удалась только её предзагрузка.
// Если сервер отказал несколько раз подряд, полминуты звучит голос браузера.
// forgetTTSFailures() («Повторить») забывает всё это сразу.

const PREFETCH_LIMIT = 4;
const prefetchCache = new Map<string, string>();
const failedLines = new Map<string, { until: number; byPlayback: boolean }>();
const prefetchPending = new Map<string, Promise<string | null>>();
let serverFailuresInRow = 0;
let serverPausedUntil = 0;

const prefetchKey = (text: string, role: VoiceRole) => `${role}\u0000${text}`;

const evictPrefetched = () => {
  while (prefetchCache.size > PREFETCH_LIMIT) {
    let victim: string | null = null;
    for (const [key, url] of prefetchCache) {
      if (url !== currentAudioUrl) {
        victim = key;
        break;
      }
    }
    if (!victim) return;
    const url = prefetchCache.get(victim);
    prefetchCache.delete(victim);
    if (url) URL.revokeObjectURL(url);
  }
};

/** Через сколько миллисекунд можно снова просить сервер об этой реплике. */
const retryDelay = (response: Response | null): number => {
  if (!response) return LINE_RETRY_MS;
  if (PERMANENT_STATUSES.has(response.status)) return Infinity;
  const header = typeof response.headers?.get === 'function' ? response.headers.get('Retry-After') : null;
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 5 * 60_000);
  return LINE_RETRY_MS;
};

const rememberFailure = (key: string, delay: number, byPlayback: boolean) => {
  failedLines.set(key, { until: Date.now() + delay, byPlayback });
  if (delay === Infinity) return;
  serverFailuresInRow += 1;
  if (serverFailuresInRow >= SERVER_PAUSE_AFTER) serverPausedUntil = Date.now() + SERVER_PAUSE_MS;
};

const skipServer = (key: string, forPlayback: boolean): boolean => {
  const now = Date.now();
  const failure = failedLines.get(key);
  if (failure && failure.until <= now) failedLines.delete(key);
  else if (failure && (failure.until === Infinity || failure.byPlayback || !forPlayback)) return true;
  return serverPausedUntil > now;
};

/**
 * Загружает озвучку реплики с сервера (или берёт из кэша). Возвращает object URL
 * или null, если сервер не смог озвучить текст. Ошибки тихие. forPlayback —
 * реплику играют прямо сейчас: неудачная предзагрузка не мешает попробовать ещё раз.
 */
export const prefetchTTS = (
  text: string,
  role: VoiceRole,
  options: { forPlayback?: boolean } = {},
): Promise<string | null> => {
  const key = prefetchKey(text, role);
  const forPlayback = Boolean(options.forPlayback);
  const cached = prefetchCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = prefetchPending.get(key);
  if (pending) return pending;
  if (skipServer(key, forPlayback)) return Promise.resolve(null);
  if (typeof fetch !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null);
  }

  const request = (async () => {
    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, role }),
      });
      if (!resp.ok) {
        rememberFailure(key, retryDelay(resp), forPlayback);
        return null;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      failedLines.delete(key);
      serverFailuresInRow = 0;
      prefetchCache.set(key, url);
      evictPrefetched();
      return prefetchCache.get(key) ?? null;
    } catch {
      rememberFailure(key, LINE_RETRY_MS, forPlayback);
      return null;
    } finally {
      prefetchPending.delete(key);
    }
  })();
  prefetchPending.set(key, request);
  return request;
};

/** Забыть неудачные загрузки (например, перед ручным «Повторить»). */
export const forgetTTSFailures = () => {
  failedLines.clear();
  serverFailuresInRow = 0;
  serverPausedUntil = 0;
};

/** true, когда звук реально идёт (а не загружается и не стоит на паузе). */
export const isTTSSounding = (): boolean => {
  if (currentAudio) return !currentAudio.paused;
  return browserLine !== null && !browserPaused;
};

export const setTTSPlaybackRate = (rate: number) => {
  currentPlaybackRate = rate;
  if (currentAudio) {
    currentAudio.playbackRate = rate;
    return;
  }
  // Браузерный голос меняет скорость только у новой фразы: продолжаем с последнего слова.
  if (browserLine && !browserPaused) {
    browserLine.offset += browserLine.lastCharIndex;
    browserLine.lastCharIndex = 0;
    void speakBrowserSegment();
  }
};

export const getTTSPlaybackRate = () => currentPlaybackRate;

const errorName = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';

/**
 * Озвучивает текст голосом с сервера (Edge-TTS), а если сервер не ответил —
 * голосом браузера. onStart вызывается, когда звук реально пошёл; onError —
 * если звук включить не удалось (TTSUnavailableError, если его нет вовсе).
 * Без onError неудача завершает реплику через onEnd, чтобы экран не остался в
 * состоянии «играет». Колбэки устаревшей реплики (после stopTTS или нового
 * playTTS) не вызываются.
 */
export const playTTS = async (
  text: string,
  role: VoiceRole,
  onEnd?: () => void,
  onError?: (e: unknown) => void,
  onStart?: () => void,
): Promise<void> => {
  stopTTS();
  const genId = ++currentGenerationId;
  const isCurrent = () => genId === currentGenerationId;
  let fellBack = false;
  const run: PlaybackRun = { started: false, fail: () => undefined };

  const start = () => {
    if (run.started || !isCurrent()) return;
    run.started = true;
    clearWatchdog();
    onStart?.();
  };
  const finish = () => {
    if (!isCurrent()) return;
    clearWatchdog();
    if (currentRun === run) currentRun = null;
    onEnd?.();
  };
  run.fail = (error: unknown) => {
    if (!isCurrent()) return;
    stopTTS();
    if (onError) onError(error);
    else onEnd?.();
  };
  const fallBack = () => {
    if (fellBack || !isCurrent()) return;
    fellBack = true;
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio = null;
    }
    currentAudioUrl = null;
    playBrowserTTS(text, role, { onEnd: finish, onError: run.fail, onStart: start });
  };

  currentRun = run;
  armWatchdog();

  const url = await prefetchTTS(text, role, { forPlayback: true });
  if (!isCurrent()) return;
  if (!url) {
    fallBack();
    return;
  }

  const audio = new Audio(url);
  currentAudio = audio;
  currentAudioUrl = url;
  audio.playbackRate = currentPlaybackRate;
  audio.addEventListener('playing', start);
  audio.onended = () => {
    if (currentAudio === audio) {
      currentAudio = null;
      currentAudioUrl = null;
    }
    finish();
  };
  audio.onerror = () => {
    if (!isCurrent()) return;
    console.warn('Audio playback error, switching to browser speech');
    fallBack();
  };
  try {
    await audio.play();
  } catch (err) {
    // Пауза или остановка во время загрузки: это не ошибка и не повод включать другой голос.
    if (!isCurrent() || errorName(err) === 'AbortError') return;
    if (errorName(err) === 'NotAllowedError') {
      run.fail(err);
      return;
    }
    console.warn('Server speech failed, switching to browser speech:', err);
    fallBack();
  }
};

export const pauseTTS = () => {
  // На паузе ожидание звука не идёт: иначе через 8 секунд пауза превратится в ошибку.
  clearWatchdog();
  if (currentAudio) {
    if (!currentAudio.paused) currentAudio.pause();
    return;
  }
  pauseBrowserTTS();
};

export const resumeTTS = () => {
  if (currentAudio) {
    if (currentAudio.paused) {
      currentAudio.play().catch(err => {
        if (errorName(err) !== 'AbortError') console.error(err);
      });
    }
  } else {
    resumeBrowserTTS();
  }
  // Реплика так и не зазвучала до паузы: снова ждём звук не дольше START_TIMEOUT_MS.
  if (currentRun && !currentRun.started) armWatchdog();
};

export const stopTTS = () => {
  currentGenerationId++;
  clearWatchdog();
  currentRun = null;
  if (currentAudio) {
    const audio = currentAudio;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      /* аудио ещё не загружено */
    }
    currentAudio = null;
  }
  currentAudioUrl = null;
  stopBrowserTTS();
};

// ── Браузерный синтез ───────────────────────────────────────────────────────
// Пауза в speechSynthesis ненадёжна, поэтому пауза — это cancel(), а продолжение —
// новая фраза с последнего произнесённого слова. Каждая фраза помнит свой номер:
// события отменённых фраз не трогают текущую реплику.

interface BrowserCallbacks {
  onEnd?: () => void;
  onError?: (e: unknown) => void;
  onStart?: () => void;
}

interface BrowserLine extends BrowserCallbacks {
  text: string;
  role: VoiceRole;
  offset: number;
  lastCharIndex: number;
}

let browserLine: BrowserLine | null = null;
let browserPaused = false;
let browserSegment = 0;

const getSynth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis ? window.speechSynthesis : null;

export const pauseBrowserTTS = () => {
  const synth = getSynth();
  if (!synth || !browserLine) return;
  browserPaused = true;
  browserSegment++;
  synth.cancel();
  browserLine.offset += browserLine.lastCharIndex;
  browserLine.lastCharIndex = 0;
};

export const resumeBrowserTTS = () => {
  if (!browserLine || !browserPaused) return;
  browserPaused = false;
  void speakBrowserSegment();
};

export const stopBrowserTTS = () => {
  browserSegment++;
  browserLine = null;
  browserPaused = false;
  getSynth()?.cancel();
};

const ensureVoicesLoaded = (synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> =>
  new Promise(resolve => {
    const voices = synth.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(finish, VOICES_TIMEOUT_MS);
    synth.addEventListener?.('voiceschanged', finish);
  });

const ROLE_VOICES: Record<VoiceRole, { names: string[]; pitch: number; rate: number }> = {
  professor: { names: ['male', 'dmitry'], pitch: 0.85, rate: 1.15 },
  male: { names: ['male', 'pavel'], pitch: 0.95, rate: 1.2 },
  female: { names: ['female', 'milena', 'svetlana'], pitch: 1.15, rate: 1.25 },
};

const speakBrowserSegment = async () => {
  const line = browserLine;
  if (!line) return;
  const segment = ++browserSegment;
  const synth = getSynth();
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    browserLine = null;
    line.onError?.(new TTSUnavailableError('no-synthesis'));
    return;
  }
  synth.cancel();

  const voices = await ensureVoicesLoaded(synth);
  const isLive = () => segment === browserSegment && browserLine === line;
  if (!isLive() || browserPaused) return;
  if (voices.length === 0) {
    browserLine = null;
    line.onError?.(new TTSUnavailableError('no-voices'));
    return;
  }

  // Продолжаем ровно с последнего произнесённого слова.
  const remainingText = line.text.slice(line.offset);
  if (remainingText.trim() === '') {
    browserLine = null;
    line.onEnd?.();
    return;
  }

  const ruVoices = voices.filter(v => v.lang.toLowerCase().startsWith('ru'));
  const naturalVoices = ruVoices.filter(v => /natural|google|siri/i.test(v.name));
  const pool = naturalVoices.length > 0 ? naturalVoices : ruVoices;
  const settings = ROLE_VOICES[line.role];

  const utterance = new SpeechSynthesisUtterance(remainingText);
  utterance.lang = 'ru-RU';
  const voice = pool.find(v => settings.names.some(name => v.name.toLowerCase().includes(name)));
  if (voice) utterance.voice = voice;
  utterance.pitch = settings.pitch;
  utterance.rate = Math.min(2, settings.rate * currentPlaybackRate);

  utterance.onstart = () => {
    if (isLive()) line.onStart?.();
  };
  utterance.onboundary = e => {
    if (isLive() && e.name === 'word') line.lastCharIndex = e.charIndex;
  };
  utterance.onend = () => {
    if (!isLive() || browserPaused) return;
    browserLine = null;
    line.onEnd?.();
  };
  utterance.onerror = e => {
    if (!isLive()) return;
    if (e.error === 'interrupted') {
      // Речь прервала система (блокировка экрана, фоновая вкладка): продолжим с этого места.
      line.offset += line.lastCharIndex;
      line.lastCharIndex = 0;
      browserPaused = true;
      return;
    }
    console.error('Browser TTS error:', e.error);
    browserLine = null;
    line.onError?.(e);
  };

  synth.speak(utterance);
};

const playBrowserTTS = (text: string, role: VoiceRole, callbacks: BrowserCallbacks) => {
  browserSegment++;
  browserLine = { text, role, offset: 0, lastCharIndex: 0, ...callbacks };
  browserPaused = false;
  void speakBrowserSegment();
};
