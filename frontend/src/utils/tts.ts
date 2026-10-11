export type VoiceRole = 'professor' | 'male' | 'female';

/**
 * Звук не удалось включить: сервер не ответил, а у браузера нет синтеза речи
 * или голосов ('no-synthesis', 'no-voices'); реплика так и не зазвучала за
 * START_TIMEOUT_MS ('timeout'); или реплике нельзя звучать другим голосом
 * (fallback: 'none'), а сервер не отдал озвучку и после повторных попыток ('server').
 */
export class TTSUnavailableError extends Error {
  readonly code = 'unavailable';
  constructor(readonly reason: 'no-synthesis' | 'no-voices' | 'timeout' | 'server') {
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
/**
 * Реплика без запасного голоса (fallback: 'none'): после неудачной загрузки ещё
 * столько попыток, с такими паузами, и только потом ошибка.
 */
const STRICT_RETRY_DELAYS_MS = [1000, 3000];

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentPlaybackRate = 1.0;
let currentGenerationId = 0;
let startWatchdog: ReturnType<typeof setTimeout> | null = null;

/** Реплика, которая сейчас играет или загружается: зазвучала ли она и как сообщить об ошибке. */
interface PlaybackRun {
  started: boolean;
  /**
   * Звук ещё загружается со своими попытками (fallback: 'none'): часы
   * START_TIMEOUT_MS пойдут, когда звук будет готов, а не во время загрузки.
   */
  loading: boolean;
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
  if (!run || run.started || run.loading) return;
  startWatchdog = setTimeout(() => {
    if (currentRun === run && !run.started) run.fail(new TTSUnavailableError('timeout'));
  }, START_TIMEOUT_MS);
};

// ── Озвучка с сервера и её кэш ──────────────────────────────────────────────
// Кэш в памяти хранит до PREFETCH_LIMIT готовых object URL (ключ — роль + текст).
// И предзагрузка следующей реплики, и обычное воспроизведение идут через него,
// поэтому каждый URL рано или поздно освобождается при вытеснении.
//
// Неудачная загрузка запоминается ненадолго: временная ошибка (429 от
// ограничителя, 502, обрыв сети) — на минуту, а реплика, которую надо сыграть
// сейчас, получает ещё одну попытку, если не удалась только её предзагрузка.
// Если сервер отказал несколько раз подряд, полминуты звучит голос браузера.
// forgetTTSFailures() («Повторить») забывает всё это сразу.
//
// Реплика без запасного голоса (playTTS с fallback: 'none', «Разговор»)
// голос не меняет никогда: она не смотрит на паузу сервера и временные
// неудачи, делает до трёх попыток с паузами и только потом сообщает об ошибке.
// Фоновая предзагрузка (prefetchTTSInOrder) идёт по одной реплике и сервер,
// который только что отказал, не дёргает: реплика, на которой сервер сейчас
// отказал, заканчивает очередь. Пока грузится реплика, которую ждут (playTTS),
// очередь новых запросов не начинает: сначала звук текущей реплики, потом
// остальные (QA 2026-10-11: на экране результата предзагрузка второй реплики
// шла рядом с повтором первой, и первое ▶ молчало 14–17 секунд).
//
// Сохранённая озвучка (persist, контракт §6.9): реплики лежат в Cache API
// 'meldy-tts-v1' под ключом /__tts/<роль>/<sha256(текст)> и переживают
// перезагрузку страницы (не больше PERSIST_LIMIT, старые уходят первыми); без
// Cache API — в памяти до закрытия вкладки. Сохраняемые предзагрузки идут по
// одной, в порядке вызова. Готовая реплика (в памяти или сохранённая) играет
// без запроса к серверу; звук, который не играет, выбрасывается отовсюду.

export const PREFETCH_LIMIT = 10;
export const TTS_PERSIST_CACHE = 'meldy-tts-v1';
/** Сколько ждём ответа /api/tts: зависший запрос не должен держать очередь предзагрузки. */
const FETCH_TIMEOUT_MS = 20_000;
/** Запасное хранилище без Cache API: не больше стольких реплик. */
const MEMORY_PERSIST_LIMIT = 48;
/** Сохранённых реплик в Cache API не больше стольких (около 30 МБ): старые уходят первыми. */
const PERSIST_LIMIT = 300;

const prefetchCache = new Map<string, string>();
/** Звук тех же реплик, что в prefetchCache: его можно сохранить, не скачивая заново. */
const clipBlobs = new Map<string, Blob>();

/**
 * Почему звук не пришёл: 'server' — сервер ответил, но ошибкой (502, 429, пустой звук); 'network' — ответа не было
 * вовсе (нет связи, обрыв, FETCH_TIMEOUT_MS). Экран по этому решает, кого назвать: сервер, а не интернет.
 */
export type TTSFailureCause = 'server' | 'network';

interface LineFailure {
  until: number;
  byPlayback: boolean;
  cause: TTSFailureCause;
  /** Номер неудачи по порядку (failureCount): так видно, что неудача случилась только что, а не раньше. */
  seq: number;
}
const failedLines = new Map<string, LineFailure>();
let failureCount = 0;
const prefetchPending = new Map<string, Promise<string | null>>();
const memoryPersisted = new Map<string, Blob>();
/** Реплики, которые точно сохранены (прочитаны из хранилища или записаны туда): их не проверяем снова. */
const persistedKeys = new Set<string>();
let persistQueue: Promise<unknown> = Promise.resolve();
let serverFailuresInRow = 0;
let serverPausedUntil = 0;

/**
 * Кто просит звук: 'prefetch' — фоновая предзагрузка; 'play' — реплика, у
 * которой есть голос браузера про запас; 'insist' — реплика без запасного голоса.
 */
type LoadMode = 'prefetch' | 'play' | 'insist';

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
    clipBlobs.delete(victim);
    if (url) URL.revokeObjectURL(url);
  }
};

/** Кладёт звук в кэш памяти и возвращает его object URL (или null, если вытеснен сразу). */
const rememberClip = (key: string, blob: Blob): string | null => {
  const existing = prefetchCache.get(key);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  prefetchCache.set(key, url);
  clipBlobs.set(key, blob);
  evictPrefetched();
  return prefetchCache.get(key) ?? null;
};

const sha256Hex = async (text: string): Promise<string | null> => {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle || typeof TextEncoder === 'undefined') return null;
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
};

const persistedUrl = async (text: string, role: VoiceRole): Promise<string | null> => {
  const hash = await sha256Hex(text);
  return hash ? `/__tts/${role}/${hash}` : null;
};

const openPersistStore = async (): Promise<Cache | null> => {
  try {
    const storage = (globalThis as { caches?: CacheStorage }).caches;
    if (!storage || typeof storage.open !== 'function') return null;
    return await storage.open(TTS_PERSIST_CACHE);
  } catch {
    // Закрытый режим, заблокированное хранилище: остаётся память.
    return null;
  }
};

/** Сохранённый звук реплики: из памяти вкладки или из Cache API. */
const readPersisted = async (key: string, text: string, role: VoiceRole): Promise<Blob | null> => {
  const inMemory = memoryPersisted.get(key);
  if (inMemory) {
    persistedKeys.add(key);
    return inMemory;
  }
  const store = await openPersistStore();
  if (!store) return null;
  const url = await persistedUrl(text, role);
  if (!url) return null;
  try {
    const response = await store.match(url);
    if (!response) return null;
    const blob = await response.blob();
    if (blob.size === 0) return null;
    persistedKeys.add(key);
    return blob;
  } catch {
    return null;
  }
};

const hasPersisted = async (key: string, text: string, role: VoiceRole): Promise<boolean> => {
  if (memoryPersisted.has(key)) return true;
  const store = await openPersistStore();
  if (!store) return false;
  const url = await persistedUrl(text, role);
  if (!url) return false;
  try {
    return Boolean(await store.match(url));
  } catch {
    return false;
  }
};

/** Cache API отдаёт ключи в порядке записи: лишние самые старые удаляем. */
const prunePersisted = async (store: Cache) => {
  if (typeof store.keys !== 'function' || typeof store.delete !== 'function') return;
  const keys = await store.keys();
  const extra = keys.slice(0, Math.max(0, keys.length - PERSIST_LIMIT));
  if (extra.length === 0) return;
  // Что именно ушло, по адресу не понять: про остальные реплики снова спросим хранилище.
  persistedKeys.clear();
  for (const request of extra) await store.delete(request);
};

const writePersisted = async (key: string, text: string, role: VoiceRole, blob: Blob): Promise<void> => {
  const store = await openPersistStore();
  const url = store ? await persistedUrl(text, role) : null;
  if (store && url) {
    try {
      await store.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }));
      await prunePersisted(store);
      persistedKeys.add(key);
      return;
    } catch {
      // Квота или запрет записи: сохраним в памяти вкладки.
    }
  }
  memoryPersisted.delete(key);
  memoryPersisted.set(key, blob);
  persistedKeys.add(key);
  while (memoryPersisted.size > MEMORY_PERSIST_LIMIT) {
    const oldest = memoryPersisted.keys().next().value;
    if (oldest === undefined) break;
    memoryPersisted.delete(oldest);
    persistedKeys.delete(oldest);
  }
};

/** Работа с сохранённой озвучкой — строго по одной, в порядке вызова. */
const inPersistQueue = <T>(task: () => Promise<T>): Promise<T> => {
  const next = persistQueue.then(task, task);
  persistQueue = next.catch(() => null);
  return next;
};

/** Сохранить надолго звук, который уже в памяти (если он ещё не сохранён). */
const keepClip = (key: string, text: string, role: VoiceRole) => {
  const blob = clipBlobs.get(key);
  if (!blob || persistedKeys.has(key)) return;
  void inPersistQueue(async () => {
    if (!(await hasPersisted(key, text, role))) await writePersisted(key, text, role, blob);
  }).catch(() => undefined);
};

/** Звук реплики не играет: забываем его везде, «Повторить» возьмёт его с сервера заново. */
const dropClip = (key: string, text: string, role: VoiceRole) => {
  const url = prefetchCache.get(key);
  prefetchCache.delete(key);
  clipBlobs.delete(key);
  persistedKeys.delete(key);
  if (url && url !== currentAudioUrl) URL.revokeObjectURL(url);
  void inPersistQueue(async () => {
    persistedKeys.delete(key);
    memoryPersisted.delete(key);
    const store = await openPersistStore();
    const address = store ? await persistedUrl(text, role) : null;
    if (store && address && typeof store.delete === 'function') await store.delete(address);
  }).catch(() => undefined);
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

const rememberFailure = (key: string, delay: number, byPlayback: boolean, cause: TTSFailureCause) => {
  failureCount += 1;
  failedLines.set(key, { until: Date.now() + delay, byPlayback, cause, seq: failureCount });
  if (delay === Infinity) return;
  serverFailuresInRow += 1;
  if (serverFailuresInRow >= SERVER_PAUSE_AFTER) serverPausedUntil = Date.now() + SERVER_PAUSE_MS;
};

/** Сервер уже ответил, что этот текст не озвучит никогда (400, 413, 422). */
const failedForGood = (key: string): boolean => failedLines.get(key)?.until === Infinity;

/** Реплика не получила звук из-за временной неудачи, случившейся после неудачи номер `since`. */
const failedSince = (key: string, since: number): boolean => {
  const failure = failedLines.get(key);
  return Boolean(failure && failure.seq > since && failure.until !== Infinity);
};

// ── Сначала реплика, которую ждут ───────────────────────────────────────────
/** Сколько загрузок звука для playTTS идёт сейчас (вместе с их повторами). */
let foregroundLoads = 0;
let foregroundWaiters: Array<() => void> = [];

/** Ждать, пока не грузится ни одна реплика, которую играют: фоновая очередь не отнимает у неё сервер. */
const foregroundIdle = (): Promise<void> =>
  foregroundLoads === 0 ? Promise.resolve() : new Promise(resolve => foregroundWaiters.push(resolve));

const endForegroundLoad = () => {
  foregroundLoads = Math.max(0, foregroundLoads - 1);
  if (foregroundLoads > 0) return;
  const waiters = foregroundWaiters;
  foregroundWaiters = [];
  waiters.forEach(resolve => resolve());
};

const skipServer = (key: string, mode: LoadMode): boolean => {
  const now = Date.now();
  const failure = failedLines.get(key);
  if (failure && failure.until <= now) {
    failedLines.delete(key);
  } else if (failure) {
    if (failure.until === Infinity) return true;
    if (mode === 'prefetch' || (mode === 'play' && failure.byPlayback)) return true;
  }
  // Пауза после отказов подряд переключает на голос браузера; без него просим сервер всё равно.
  return mode !== 'insist' && serverPausedUntil > now;
};

/** Один запрос звука: из памяти, из сохранённого или с сервера. Ошибки тихие: null. */
const loadClip = (text: string, role: VoiceRole, mode: LoadMode): Promise<string | null> => {
  const key = prefetchKey(text, role);
  const cached = prefetchCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = prefetchPending.get(key);
  if (pending) return pending;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);

  const byPlayback = mode !== 'prefetch';
  const request = (async () => {
    try {
      const stored = await readPersisted(key, text, role);
      if (stored) return rememberClip(key, stored);
      if (skipServer(key, mode) || typeof fetch !== 'function') return null;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
      try {
        const resp = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, role }),
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!resp.ok) {
          rememberFailure(key, retryDelay(resp), byPlayback, 'server');
          return null;
        }
        const blob = await resp.blob();
        if (blob.size === 0) {
          rememberFailure(key, LINE_RETRY_MS, byPlayback, 'server');
          return null;
        }
        failedLines.delete(key);
        serverFailuresInRow = 0;
        return rememberClip(key, blob);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    } catch {
      // Ни ответа, ни звука: нет связи, обрыв или FETCH_TIMEOUT_MS.
      rememberFailure(key, LINE_RETRY_MS, byPlayback, 'network');
      return null;
    } finally {
      prefetchPending.delete(key);
    }
  })();
  prefetchPending.set(key, request);
  return request;
};

/**
 * Загружает озвучку реплики с сервера (или берёт из кэша). Возвращает object URL
 * или null, если сервер не смог озвучить текст. Ошибки тихие. forPlayback —
 * реплику играют прямо сейчас: неудачная предзагрузка не мешает попробовать ещё раз.
 * persist — сохранить звук надолго (Cache API, иначе память вкладки); такие
 * предзагрузки идут по одной в порядке вызова, а уже сохранённая реплика сервер
 * не трогает.
 */
export const prefetchTTS = (
  text: string,
  role: VoiceRole,
  options: { forPlayback?: boolean; persist?: boolean } = {},
): Promise<string | null> => {
  if (options.persist) return queuePersisted(text, role);
  return loadClip(text, role, options.forPlayback ? 'play' : 'prefetch');
};

/** Одна сохраняемая предзагрузка за раз, в порядке вызова (контракт §6.9). */
const queuePersisted = (text: string, role: VoiceRole): Promise<string | null> => {
  const key = prefetchKey(text, role);
  return inPersistQueue(async (): Promise<string | null> => {
    const inMemory = prefetchCache.get(key);
    const memoryBlob = clipBlobs.get(key);
    if (inMemory && memoryBlob) {
      if (!(await hasPersisted(key, text, role))) await writePersisted(key, text, role, memoryBlob);
      return inMemory;
    }
    const stored = await readPersisted(key, text, role);
    if (stored) return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? rememberClip(key, stored) : null;
    const url = await loadClip(text, role, 'prefetch');
    const blob = clipBlobs.get(key);
    if (url && blob) await writePersisted(key, text, role, blob);
    return url;
  });
};

let inOrderRun = 0;
let inOrderTail: Promise<unknown> = Promise.resolve();

/**
 * Предзагрузка нескольких реплик вперёд строго по одной: следующая реплика
 * запрашивается, когда предыдущая готова, так что сервер не получает пачку
 * запросов разом. Реплика, на которой сервер сейчас отказал (502, 429, нет
 * ответа), заканчивает очередь: остальные спросит плеер, когда до них дойдёт.
 * Пока грузится реплика, которую играют (playTTS), очередь ждёт и нового
 * запроса не начинает. Новый вызов заменяет прежний список: начатая загрузка
 * доживает, остальные прежние реплики уже не запрашиваются (пустой список
 * просто останавливает очередь). persist — как у prefetchTTS.
 */
export const prefetchTTSInOrder = (
  lines: ReadonlyArray<{ text: string; role: VoiceRole }>,
  options: { persist?: boolean } = {},
): Promise<void> => {
  const run = ++inOrderRun;
  const plan = lines.map(line => ({ text: line.text, role: line.role }));
  const work = async () => {
    for (const line of plan) {
      if (run !== inOrderRun) return;
      await foregroundIdle();
      if (run !== inOrderRun) return;
      const before = failureCount;
      const url = await prefetchTTS(line.text, line.role, { persist: options.persist });
      if (!url && failedSince(prefetchKey(line.text, line.role), before)) return;
    }
  };
  const next = inOrderTail.then(work, work);
  inOrderTail = next.catch(() => undefined);
  return next;
};

/**
 * Готова ли реплика: звук уже в памяти или сохранён. Готовую реплику playTTS
 * играет без запроса к серверу; неготовую экран может не играть вовсе («Так…»).
 */
export const isTTSReady = async (text: string, role: VoiceRole): Promise<boolean> => {
  const key = prefetchKey(text, role);
  if (prefetchCache.has(key)) return true;
  return hasPersisted(key, text, role);
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

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Звук для реплики без запасного голоса: попытка и ещё STRICT_RETRY_DELAYS_MS.length
 * с паузами. Без оглядки на паузу сервера и прошлые временные неудачи; текст,
 * который сервер не озвучит никогда, второй раз не просим. Перед каждым повтором
 * onRetry узнаёт, почему звук не пришёл.
 */
const loadInsisting = async (
  text: string,
  role: VoiceRole,
  isCurrent: () => boolean,
  onRetry?: (cause: TTSFailureCause) => void,
): Promise<string | null> => {
  const key = prefetchKey(text, role);
  for (let attempt = 0; ; attempt += 1) {
    const url = await loadClip(text, role, 'insist');
    if (url || !isCurrent()) return url;
    if (attempt >= STRICT_RETRY_DELAYS_MS.length || failedForGood(key)) return null;
    onRetry?.(failedLines.get(key)?.cause ?? 'network');
    await wait(STRICT_RETRY_DELAYS_MS[attempt]);
    if (!isCurrent()) return null;
  }
};

export interface PlayTTSOptions {
  /**
   * Чем читать реплику, если сервер не дал звук. 'browser' (по умолчанию) —
   * голосом браузера. 'none' — ничем: реплика получает ещё две попытки с
   * паузами, а потом onError (TTSUnavailableError 'server'); звук, который не
   * играет, — onError с ошибкой воспроизведения. Так голос ведущего не меняется
   * посреди разговора.
   */
  fallback?: 'browser' | 'none';
  /** Сохранить звук надолго (как prefetchTTS с persist): повтор и новый визит — без сервера. */
  persist?: boolean;
  /**
   * Только с fallback: 'none'. Звук этой попытки не пришёл, следующая будет после паузы: 'server' — сервер
   * ответил ошибкой (тогда винить интернет нечестно), 'network' — ответа не было вовсе.
   */
  onRetry?: (cause: TTSFailureCause) => void;
}

/**
 * Озвучивает текст голосом с сервера (Edge-TTS), а если сервер не ответил —
 * голосом браузера (или никаким, см. PlayTTSOptions.fallback). onStart
 * вызывается, когда звук реально пошёл; onError — если звук включить не удалось
 * (TTSUnavailableError, если его нет вовсе). Без onError неудача завершает
 * реплику через onEnd, чтобы экран не остался в состоянии «играет». Колбэки
 * устаревшей реплики (после stopTTS или нового playTTS) не вызываются.
 */
export const playTTS = async (
  text: string,
  role: VoiceRole,
  onEnd?: () => void,
  onError?: (e: unknown) => void,
  onStart?: () => void,
  options: PlayTTSOptions = {},
): Promise<void> => {
  stopTTS();
  const genId = ++currentGenerationId;
  const isCurrent = () => genId === currentGenerationId;
  const insist = options.fallback === 'none';
  const key = prefetchKey(text, role);
  let fellBack = false;
  const run: PlaybackRun = { started: false, loading: insist, fail: () => undefined };

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
  /** Без запасного голоса: звук, который не играет, выбрасываем и честно сообщаем об ошибке. */
  const giveUp = (error: unknown) => {
    if (!isCurrent()) return;
    run.fail(error);
    dropClip(key, text, role);
  };

  currentRun = run;
  armWatchdog();

  // Пока звук этой реплики грузится (с повторами), фоновая очередь новых запросов не начинает.
  foregroundLoads += 1;
  let url: string | null;
  try {
    url = insist
      ? await loadInsisting(text, role, isCurrent, cause => {
          if (isCurrent()) options.onRetry?.(cause);
        })
      : await loadClip(text, role, 'play');
  } finally {
    endForegroundLoad();
  }
  if (!isCurrent()) return;
  if (!url) {
    if (insist) run.fail(new TTSUnavailableError('server'));
    else fallBack();
    return;
  }
  if (options.persist) keepClip(key, text, role);
  if (run.loading) {
    // Звук готов: теперь ждём, что он зазвучит, не дольше START_TIMEOUT_MS.
    run.loading = false;
    armWatchdog();
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
    if (insist) {
      console.warn('Audio playback error');
      giveUp(new Error('Audio playback error'));
      return;
    }
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
    if (insist) {
      console.warn('Server speech failed:', err);
      giveUp(err);
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
