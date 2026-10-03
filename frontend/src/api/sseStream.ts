/**
 * Общий читатель потоков Server-Sent Events от backend (анализ, разметка экзамена)
 * и единый разбор HTTP-ошибок.
 *
 * Правила:
 * - сторожевой таймер тишины сбрасывается любым пришедшим куском, включая
 *   служебные комментарии `: keepalive`; комментарии в onEvent не попадают;
 * - тишина дольше idleMs или работа дольше totalMs — запрос прерывается, ошибка timeout;
 * - обрыв чтения (TypeError из reader) — ошибка network;
 * - отмена снаружи (signal) — ошибка aborted;
 * - поток закончился без завершающего события — { terminal: null }, решает вызывающий;
 * - текст ошибки пользователю никогда не берётся из парсера или из ответа 5xx.
 */

export type StreamErrorKind = 'http' | 'network' | 'timeout' | 'aborted';

export const STREAM_MESSAGES = {
  tooLarge: 'Файл больше 15 МБ. Сожмите его или загрузите часть материала.',
  rateLimited: 'Слишком много запусков за минуту. Подождите минуту и повторите.',
  auth: 'Сессия истекла. Войдите снова.',
  unavailable: 'Сервер сейчас недоступен. Повторите попытку через минуту.',
  generic: 'Не удалось выполнить запрос. Повторите попытку.',
  network: 'Связь с сервером прервалась. Проверьте интернет и повторите попытку.',
  timeout: 'Сервер слишком долго не отвечает. Повторите попытку через минуту.',
  aborted: 'Запрос остановлен.',
} as const;

export class StreamError extends Error {
  kind: StreamErrorKind;
  status?: number;
  code?: string;
  retryable: boolean;

  constructor(
    kind: StreamErrorKind,
    message: string,
    options: { status?: number; code?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'StreamError';
    this.kind = kind;
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable ?? (kind === 'network' || kind === 'timeout');
  }
}

/** Тишина в теле ответа, после которой запрос считается зависшим. */
export const DEFAULT_IDLE_MS = 45_000;

/** Статусы, для которых понятный русский detail сервера показывается как есть. */
const DETAIL_STATUSES = new Set([400, 401, 403, 404, 409, 413, 415, 422]);
/** Из них повтор того же запроса может помочь только при 409 («уже идёт»). */
const RETRYABLE_DETAIL_STATUSES = new Set([409]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readableDetail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 200 || !/[А-Яа-яЁё]/.test(text)) return null;
  return text;
}

/**
 * Превращает неуспешный ответ в StreamError с текстом для человека.
 * Тело читается один раз как текст; JSON разбирается, только если получается.
 */
export async function httpErrorFromResponse(res: Response): Promise<StreamError> {
  const status = res.status;
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    raw = '';
  }
  const trimmed = raw.trim();
  let body: unknown = null;
  if (trimmed) {
    try {
      body = JSON.parse(trimmed);
    } catch {
      body = null;
    }
  }
  const record = isRecord(body) ? body : null;
  const code = typeof record?.code === 'string' && record.code.length <= 64 ? record.code : undefined;

  const detail = readableDetail(record?.detail);
  if (detail && DETAIL_STATUSES.has(status)) {
    return new StreamError('http', detail, { status, code, retryable: RETRYABLE_DETAIL_STATUSES.has(status) });
  }

  let contentType = '';
  try {
    contentType = res.headers?.get('content-type') ?? '';
  } catch {
    contentType = '';
  }
  const isHtml = /text\/html/i.test(contentType) || trimmed.startsWith('<');

  if (status === 413) return new StreamError('http', STREAM_MESSAGES.tooLarge, { status, code, retryable: false });
  if (status === 429) return new StreamError('http', STREAM_MESSAGES.rateLimited, { status, code, retryable: true });
  if (status === 401) return new StreamError('http', STREAM_MESSAGES.auth, { status, code, retryable: false });
  if (status >= 500 || isHtml || !trimmed) {
    return new StreamError('http', STREAM_MESSAGES.unavailable, { status, code, retryable: true });
  }
  return new StreamError('http', STREAM_MESSAGES.generic, { status, code, retryable: true });
}

export interface ReadSseStreamOptions {
  url: string;
  init: RequestInit;
  /** Каждое событие data: (JSON-объект) по порядку, включая завершающее. */
  onEvent: (data: Record<string, unknown>) => void;
  /** Завершающее событие: после него чтение прекращается. По умолчанию done и error. */
  isTerminal?: (data: Record<string, unknown>) => boolean;
  /** Сколько тела ответа может молчать, мс (по умолчанию 45 000). Ожидание заголовков не считается. */
  idleMs?: number;
  /** Предел всего запроса вместе с отправкой файла, мс. Без значения — без предела. */
  totalMs?: number;
  /** Отмена снаружи (как и init.signal): исход — StreamError aborted. */
  signal?: AbortSignal;
}

const defaultIsTerminal = (data: Record<string, unknown>) => data.type === 'done' || data.type === 'error';

type StopReason = 'idle' | 'total' | 'external';

class StopSignal extends Error {}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/**
 * Читает SSE-ответ POST/GET-запроса. Возвращает завершающее событие или null,
 * если поток закончился без него. Ошибки — StreamError; исключение из onEvent
 * пробрасывается как есть (чтение при этом останавливается).
 */
export async function readSseStream(opts: ReadSseStreamOptions): Promise<{ terminal: Record<string, unknown> | null }> {
  const { url, init, onEvent } = opts;
  const isTerminal = opts.isTerminal ?? defaultIsTerminal;
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const totalMs = opts.totalMs;
  // Отменить чтение можно и через opts.signal, и через init.signal.
  const signals = [opts.signal, init.signal ?? undefined].filter((item): item is AbortSignal => Boolean(item));

  if (signals.some(item => item.aborted)) throw new StreamError('aborted', STREAM_MESSAGES.aborted, { retryable: false });

  const controller = new AbortController();
  let stopReason: StopReason | null = null;
  let rejectStop: (error: unknown) => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  stopped.catch(() => undefined);

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let readerFinished = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = (reason: StopReason) => {
    if (stopReason) return;
    stopReason = reason;
    rejectStop(new StopSignal(reason));
    controller.abort();
    if (reader && !readerFinished) reader.cancel().catch(() => undefined);
  };
  const onExternalAbort = () => stop('external');
  signals.forEach(item => item.addEventListener('abort', onExternalAbort, { once: true }));
  if (totalMs !== undefined && totalMs > 0) totalTimer = setTimeout(() => stop('total'), totalMs);

  const armIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (idleMs > 0) idleTimer = setTimeout(() => stop('idle'), idleMs);
  };

  /** Чтение закончилось не на конце потока (завершающее событие, ошибка): закрываем соединение. */
  const cleanup = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (totalTimer !== undefined) clearTimeout(totalTimer);
    signals.forEach(item => item.removeEventListener('abort', onExternalAbort));
    if (!readerFinished) {
      readerFinished = true;
      reader?.cancel().catch(() => undefined);
      if (!controller.signal.aborted) controller.abort();
    }
  };

  /** Ошибка чтения или запроса → StreamError по причине остановки. */
  const transportFailure = (error: unknown): unknown => {
    if (stopReason === 'idle' || stopReason === 'total') {
      return new StreamError('timeout', STREAM_MESSAGES.timeout, { retryable: true });
    }
    if (stopReason === 'external') return new StreamError('aborted', STREAM_MESSAGES.aborted, { retryable: false });
    if (error instanceof StreamError) return error;
    if (isAbortError(error)) return new StreamError('aborted', STREAM_MESSAGES.aborted, { retryable: false });
    return new StreamError('network', STREAM_MESSAGES.network, { retryable: true });
  };

  try {
    let response: Response;
    try {
      response = await Promise.race([fetch(url, { ...init, signal: controller.signal }), stopped]);
    } catch (error) {
      throw transportFailure(error);
    }
    if (stopReason) throw transportFailure(null);
    if (!response.ok) throw await httpErrorFromResponse(response);
    if (!response.body) return { terminal: null };

    reader = response.body.getReader();
    armIdle();

    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let dataLines: string[] = [];
    let terminal: Record<string, unknown> | null = null;

    const dispatch = (): boolean => {
      if (dataLines.length === 0) return false;
      const payload = dataLines.join('\n');
      dataLines = [];
      if (!payload.trim()) return false;
      let data: unknown;
      try {
        data = JSON.parse(payload);
      } catch {
        console.warn('Пропущено повреждённое SSE-событие');
        return false;
      }
      if (!isRecord(data)) return false;
      onEvent(data);
      if (isTerminal(data)) {
        terminal = data;
        return true;
      }
      return false;
    };

    const processLine = (rawLine: string): boolean => {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '') return dispatch();
      if (line.startsWith(':')) return false; // комментарий, например keepalive
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') dataLines.push(value);
      return false;
    };

    const processText = (text: string, atEnd: boolean): boolean => {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (processLine(line)) return true;
      }
      if (atEnd) {
        const rest = buffer;
        buffer = '';
        if (rest && processLine(rest)) return true;
        return dispatch();
      }
      return false;
    };

    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), stopped]);
      } catch (error) {
        throw transportFailure(error);
      }
      if (stopReason) throw transportFailure(null);
      if (chunk.done) {
        readerFinished = true;
        processText(decoder.decode(), true);
        break;
      }
      armIdle();
      if (processText(decoder.decode(chunk.value, { stream: true }), false)) break;
    }
    return { terminal };
  } finally {
    cleanup();
  }
}
