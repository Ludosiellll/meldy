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

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentPlaybackRate = 1.0;
let currentGenerationId = 0;
let startWatchdog: ReturnType<typeof setTimeout> | null = null;

const clearWatchdog = () => {
  if (startWatchdog !== null) clearTimeout(startWatchdog);
  startWatchdog = null;
};

// ── Озвучка с сервера и её кэш ──────────────────────────────────────────────
// Кэш хранит до 4 готовых object URL (ключ — роль + текст). И предзагрузка
// следующей реплики, и обычное воспроизведение идут через него, поэтому каждый
// URL рано или поздно освобождается при вытеснении. Неудачная загрузка тоже
// запоминается: повторно на сервер за этой репликой не ходим, пока не вызван
// forgetTTSFailures().

const PREFETCH_LIMIT = 4;
const prefetchCache = new Map<string, string>();
const prefetchFailed = new Set<string>();
const prefetchPending = new Map<string, Promise<string | null>>();

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

/**
 * Загружает озвучку реплики с сервера (или берёт из кэша). Возвращает object URL
 * или null, если сервер не смог озвучить текст. Ошибки тихие.
 */
export const prefetchTTS = (text: string, role: VoiceRole): Promise<string | null> => {
  const key = prefetchKey(text, role);
  const cached = prefetchCache.get(key);
  if (cached) return Promise.resolve(cached);
  if (prefetchFailed.has(key)) return Promise.resolve(null);
  const pending = prefetchPending.get(key);
  if (pending) return pending;
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
        prefetchFailed.add(key);
        return null;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      prefetchCache.set(key, url);
      evictPrefetched();
      return prefetchCache.get(key) ?? null;
    } catch {
      prefetchFailed.add(key);
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
  prefetchFailed.clear();
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
 * Колбэки устаревшей реплики (после stopTTS или нового playTTS) не вызываются.
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
  let started = false;
  let fellBack = false;

  const start = () => {
    if (started || !isCurrent()) return;
    started = true;
    clearWatchdog();
    onStart?.();
  };
  const finish = () => {
    if (!isCurrent()) return;
    clearWatchdog();
    onEnd?.();
  };
  const fail = (error: unknown) => {
    if (!isCurrent()) return;
    stopTTS();
    onError?.(error);
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
    playBrowserTTS(text, role, { onEnd: finish, onError: fail, onStart: start });
  };

  clearWatchdog();
  startWatchdog = setTimeout(() => {
    if (isCurrent() && !started) fail(new TTSUnavailableError('timeout'));
  }, START_TIMEOUT_MS);

  const url = await prefetchTTS(text, role);
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
      fail(err);
      return;
    }
    console.warn('Server speech failed, switching to browser speech:', err);
    fallBack();
  }
};

export const pauseTTS = () => {
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
    return;
  }
  resumeBrowserTTS();
};

export const stopTTS = () => {
  currentGenerationId++;
  clearWatchdog();
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
