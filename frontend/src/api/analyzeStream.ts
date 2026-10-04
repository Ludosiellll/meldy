/**
 * Поток анализа материала (/api/analyze, /api/analyze/media, /api/analyze/url)
 * поверх общего readSseStream.
 *
 * Исход — либо результат (событие results или частичный, если связь прервалась
 * после хотя бы одного годного основного раздела), либо AnalyzeError с русским
 * текстом и признаком, поможет ли повтор. Отмена пользователем — исход aborted.
 */
import { readSseStream, StreamError, STREAM_MESSAGES } from './sseStream';
import type { AnalysisErrorKind, AnalysisResults, SectionName } from '../types';
import {
  displayResults,
  isRunUsable,
  RunCollector,
  RUN_FAILURE_MESSAGES,
  runFailure,
  statusesFromResults,
  parseGrounding,
} from '../utils/analysisSections';

export type AnalyzeErrorKind = AnalysisErrorKind;

export class AnalyzeError extends Error {
  kind: AnalyzeErrorKind;
  retryable: boolean;

  constructor(kind: AnalyzeErrorKind, message: string, retryable: boolean) {
    super(message);
    this.name = 'AnalyzeError';
    this.kind = kind;
    this.retryable = retryable;
  }
}

export const ANALYZE_MESSAGES = {
  incomplete: 'Анализ прервался до конца. Материал не сохранён, лимит не списан. Повторите попытку.',
  network:
    'Связь с сервером прервалась. Материал не сохранён, лимит не списан. Проверьте интернет и повторите попытку.',
  timeout: 'Сервер слишком долго не отвечает. Материал не сохранён, лимит не списан. Повторите попытку через минуту.',
  server: 'Не удалось завершить анализ. Материал не сохранён, лимит не списан. Повторите попытку.',
  noText: 'В материале не найден текст для анализа.',
} as const;

/**
 * Пределы ожидания. Меняются в тестах; тишина считается только после заголовков
 * ответа, общий предел включает отправку файла.
 */
export const ANALYZE_TIMEOUTS = {
  idleMs: 45_000,
  textTotalMs: 6 * 60_000,
  mediaTotalMs: 10 * 60_000,
};

export type AnalyzeEndpoint = '/api/analyze' | '/api/analyze/media' | '/api/analyze/url';

export interface AnalyzeStreamOptions {
  endpoint: AnalyzeEndpoint;
  body: FormData;
  token: string;
  /** Разделы, которые запрошены в этом запуске. */
  requested: SectionName[];
  /** Каждое событие потока по порядку (для прогресса на экране). Исключение отсюда останавливает поток. */
  onEvent?: (event: Record<string, unknown>) => void;
  signal?: AbortSignal;
  idleMs?: number;
  totalMs?: number;
}

export interface AnalyzeRunResult {
  /** results — пришло событие results; partial — собрано из разделов, пришедших до обрыва. */
  kind: 'results' | 'partial';
  /** Для экрана: у неудавшихся разделов пустые контейнеры, статусы — в sections. */
  results: AnalysisResults;
  extractedText: string;
  textLength: number;
}

export type AnalyzeOutcome = AnalyzeRunResult | { kind: 'aborted' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serverMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= 300 && /[А-Яа-яЁё]/.test(text) ? text : null;
}

/** Событие error сервера → AnalyzeError по коду (§3 контрактов). */
export function analyzeErrorFromEvent(event: Record<string, unknown>): AnalyzeError {
  const message = serverMessage(event.message);
  switch (event.code) {
    case 'busy':
      return new AnalyzeError('busy', message ?? RUN_FAILURE_MESSAGES.busy, true);
    case 'empty':
      return new AnalyzeError('empty', message ?? RUN_FAILURE_MESSAGES.empty, true);
    case 'failed':
      return new AnalyzeError('server', message ?? RUN_FAILURE_MESSAGES.failed, true);
    case 'timeout':
      return new AnalyzeError('timeout', message ?? RUN_FAILURE_MESSAGES.failed, true);
    case 'no_text':
      return new AnalyzeError('bad_request', message ?? ANALYZE_MESSAGES.noText, false);
    case 'too_large':
      return new AnalyzeError('too_large', message ?? STREAM_MESSAGES.tooLarge, false);
    default:
      return new AnalyzeError('server', message ?? ANALYZE_MESSAGES.server, true);
  }
}

/** Ошибка HTTP до начала потока → AnalyzeError. */
export function analyzeErrorFromHttp(error: StreamError): AnalyzeError {
  const status = error.status ?? 0;
  if (status === 401) return new AnalyzeError('auth', error.message, false);
  if (status === 413) return new AnalyzeError('too_large', error.message, false);
  // The daily AI limit: the server's words, no «повторить» today (the limit dialog opens too).
  if (status === 429 && error.code === 'ai_limit') return new AnalyzeError('rate_limited', error.message, false);
  if (status === 429) return new AnalyzeError('rate_limited', error.message, true);
  if (status >= 500 || error.message === STREAM_MESSAGES.unavailable) {
    return new AnalyzeError('unavailable', error.message, error.retryable);
  }
  if (status >= 400 && status < 500 && !error.retryable) return new AnalyzeError('bad_request', error.message, false);
  return new AnalyzeError('server', error.message, error.retryable);
}

function analyzeErrorFromTransport(error: StreamError): AnalyzeError {
  if (error.kind === 'timeout') return new AnalyzeError('timeout', ANALYZE_MESSAGES.timeout, true);
  return new AnalyzeError('network', ANALYZE_MESSAGES.network, true);
}

const ANALYZE_TERMINALS = new Set(['results', 'error', 'done']);

/**
 * Запускает анализ и читает поток до results/error/done или до обрыва.
 * results считается завершением: после него ждать done незачем.
 */
export async function runAnalyzeStream(opts: AnalyzeStreamOptions): Promise<AnalyzeOutcome> {
  const collector = new RunCollector();
  let resultsEvent: Record<string, unknown> | null = null;
  let errorEvent: Record<string, unknown> | null = null;
  let transportError: StreamError | null = null;

  const handle = (event: Record<string, unknown>) => {
    collector.add(event);
    if (event.type === 'results') resultsEvent = event;
    else if (event.type === 'error') errorEvent = event;
    opts.onEvent?.(event);
  };

  const totalMs =
    opts.totalMs ?? (opts.endpoint === '/api/analyze/media' ? ANALYZE_TIMEOUTS.mediaTotalMs : ANALYZE_TIMEOUTS.textTotalMs);

  try {
    await readSseStream({
      url: opts.endpoint,
      init: { method: 'POST', body: opts.body, headers: { Authorization: `Bearer ${opts.token}` } },
      onEvent: handle,
      isTerminal: event => typeof event.type === 'string' && ANALYZE_TERMINALS.has(event.type),
      idleMs: opts.idleMs ?? ANALYZE_TIMEOUTS.idleMs,
      totalMs,
      signal: opts.signal,
    });
  } catch (error) {
    if (!(error instanceof StreamError)) throw error;
    if (error.kind === 'aborted') return { kind: 'aborted' };
    if (error.kind === 'http') throw analyzeErrorFromHttp(error);
    transportError = error;
  }

  const finalResults = resultsEvent as Record<string, unknown> | null;
  if (finalResults) {
    const raw: Partial<AnalysisResults> = {
      summarizer: finalResults.summarizer as AnalysisResults['summarizer'],
      flashcards: finalResults.flashcards as AnalysisResults['flashcards'],
      quiz: finalResults.quiz as AnalysisResults['quiz'],
      cheatsheet: finalResults.cheatsheet as AnalysisResults['cheatsheet'],
      podcast: finalResults.podcast as AnalysisResults['podcast'],
      missions: finalResults.missions as AnalysisResults['missions'],
      warnings: Array.isArray(finalResults.warnings) ? (finalResults.warnings as AnalysisResults['warnings']) : [],
      grounding: parseGrounding(finalResults.grounding) ?? collector.grounding,
      sections: isRecord(finalResults.sections) ? (finalResults.sections as AnalysisResults['sections']) : undefined,
    };
    const statuses = statusesFromResults(raw, opts.requested);
    if (!isRunUsable(statuses, opts.requested)) {
      const failure = runFailure(statuses, opts.requested);
      throw new AnalyzeError(failure.kind, failure.message, true);
    }
    return {
      kind: 'results',
      results: displayResults(raw, statuses),
      extractedText: collector.text,
      textLength: collector.textLength,
    };
  }

  // Связь прервалась или сервер сообщил об ошибке, но годные разделы уже пришли.
  if (collector.hasUsableSection(opts.requested)) {
    return {
      kind: 'partial',
      results: collector.partialResults(opts.requested),
      extractedText: collector.text,
      textLength: collector.textLength,
    };
  }

  const failureEvent = errorEvent as Record<string, unknown> | null;
  if (failureEvent) throw analyzeErrorFromEvent(failureEvent);
  if (transportError) throw analyzeErrorFromTransport(transportError);
  throw new AnalyzeError('incomplete', ANALYZE_MESSAGES.incomplete, true);
}
