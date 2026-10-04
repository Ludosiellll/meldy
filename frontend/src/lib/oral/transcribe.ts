/**
 * POST /api/oral/transcribe: кусок записи устного ответа → текст. Запись идёт телом запроса,
 * формат — в Content-Type, текст вопроса — в ?hint= (чтобы термины писались правильно).
 * Токен сессии добавляет lib/apiAuth. Один повтор через 800 мс при сбое сети, 429 или 5xx.
 */
export const TRANSCRIBE_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 800;
const HINT_CHARS = 300;

export class TranscribeError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = 'TranscribeError';
    this.status = status;
    this.code = code;
  }
}

function retryable(error: unknown): boolean {
  if (!(error instanceof TranscribeError)) return true; // сеть, таймаут
  return error.status === null || error.status === 429 || error.status >= 500;
}

async function once(blob: Blob, hint: string, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const query = hint ? `?hint=${encodeURIComponent(hint.slice(0, HINT_CHARS))}` : '';
    const type = (blob.type || 'audio/webm').split(';', 1)[0];
    const response = await fetch(`/api/oral/transcribe${query}`, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: blob,
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (!response.ok) {
      const detail = typeof record.detail === 'string' ? record.detail : 'Не удалось распознать речь.';
      throw new TranscribeError(detail, response.status, typeof record.code === 'string' ? record.code : null);
    }
    return typeof record.text === 'string' ? record.text : '';
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Текст куска записи ('' — речи не было). Бросает TranscribeError или ошибку сети после повтора. */
export async function transcribeAudio(blob: Blob, options: { hint?: string; signal?: AbortSignal } = {}): Promise<string> {
  const hint = (options.hint ?? '').replace(/\s+/g, ' ').trim();
  try {
    return await once(blob, hint, options.signal);
  } catch (error) {
    if (options.signal?.aborted || !retryable(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    if (options.signal?.aborted) throw error;
    return once(blob, hint, options.signal);
  }
}
