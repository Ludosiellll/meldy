/**
 * The example's AI check (/try): one POST /api/try/evaluate per answer — the question's id and the answer,
 * nothing else; the server keeps the example's points itself (backend/try_api.py) and returns the protocol
 * a real ticket gets (the same prompt and checks as /api/oral/evaluate).
 *
 * When there is no AI check — no key on the server, the day's checks spent, the model busy, failed or slow,
 * too many checks from one address, no connection, an answer over 4000 characters — the result says why,
 * and the page checks the answer by its key words, as the example always did (exampleFlow.ts); the
 * protocol says which way the answer was checked. «Не знаю» as the whole answer is the button's answer:
 * nothing named, with no request (as lib/oral/oralApi.evaluateAnswer). This module never throws.
 */
import { DONT_KNOW_VERDICT, parseEvaluation, type Evaluation } from '../../lib/oral/oralApi';
import { saysDontKnow } from '../../lib/oral/followup';

export const TRY_EVALUATE_PATH = '/api/try/evaluate';
/** The server gives the model 8 s and then answers «key words» itself: this leaves room for the way there and back. */
export const TRY_CHECK_TIMEOUT_MS = 9_500;
/** The longest answer the server checks (backend try_api.TRANSCRIPT_CHARS). */
export const TRY_TRANSCRIPT_CHARS = 4000;

/** Why an answer was checked by key words: the server's reasons, then the browser's own. */
export type TryFallbackReason = 'no_key' | 'day_cap' | 'busy' | 'timeout' | 'failed' | 'client_limit' | 'offline' | 'too_long';

const SERVER_REASONS: ReadonlySet<string> = new Set(['no_key', 'day_cap', 'busy', 'timeout', 'failed']);
const ALL_REASONS: ReadonlySet<string> = new Set([...SERVER_REASONS, 'client_limit', 'offline', 'too_long']);

export type TryCheck =
  | { by: 'ai'; evaluation: Evaluation }
  | { by: 'dont_know' }
  | { by: 'keywords'; reason: TryFallbackReason };

/** How an answer was checked, as the tab keeps it (trySheet.TryAnswer.check); no reason — yesterday's seeded answers. */
export type TryCheckSummary = { by: 'ai' } | { by: 'dont_know' } | { by: 'keywords'; reason?: TryFallbackReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The server's answer: the protocol (checked as /api/oral/evaluate's is) or key words with a known reason. */
export function parseTryResponse(value: unknown, pointIds: readonly string[]): TryCheck {
  if (isRecord(value) && value.mode === 'ai') {
    try {
      return { by: 'ai', evaluation: parseEvaluation(value.evaluation, pointIds) };
    } catch {
      return { by: 'keywords', reason: 'failed' };
    }
  }
  if (isRecord(value) && value.mode === 'keywords' && typeof value.reason === 'string' && SERVER_REASONS.has(value.reason)) {
    return { by: 'keywords', reason: value.reason as TryFallbackReason };
  }
  return { by: 'keywords', reason: 'failed' };
}

/** The answer to the example's question, checked on the server — or why it is to be checked by key words. */
export async function checkTryAnswer(
  questionId: string,
  transcript: string,
  pointIds: readonly string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<TryCheck> {
  if (saysDontKnow(transcript)) return { by: 'dont_know' };
  if (transcript.length > TRY_TRANSCRIPT_CHARS) return { by: 'keywords', reason: 'too_long' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { by: 'keywords', reason: 'offline' };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(0, options.timeoutMs ?? TRY_CHECK_TIMEOUT_MS));
  const onOuterAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(TRY_EVALUATE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: questionId, transcript }),
        signal: controller.signal,
      });
    } catch {
      return { by: 'keywords', reason: timedOut ? 'timeout' : 'offline' };
    }
    // The server's limit per address (backend ratelimit.visitor_ip_key): 12 checks in 10 minutes, 40 a day.
    if (response.status === 429) return { by: 'keywords', reason: 'client_limit' };
    if (!response.ok) return { by: 'keywords', reason: 'failed' };
    try {
      return parseTryResponse(await response.json(), pointIds);
    } catch {
      return { by: 'keywords', reason: timedOut ? 'timeout' : 'failed' };
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** The protocol of a checked answer: the AI's, «не знаю» (nothing named), or the page's own key-word one. */
export function tryEvaluation(check: TryCheck, pointIds: readonly string[], keywords: Evaluation): Evaluation {
  if (check.by === 'ai') return check.evaluation;
  if (check.by === 'dont_know') {
    return { points: pointIds.map((id) => ({ id, status: 'missing', student_quote: '', comment: '' })), errors: [], verdict: DONT_KNOW_VERDICT };
  }
  return keywords;
}

export function checkSummary(check: TryCheck): TryCheckSummary {
  return check.by === 'keywords' ? { by: 'keywords', reason: check.reason } : { by: check.by };
}

/** A summary kept in the tab, as written by this page (anything else reads as key words). */
export function parseCheckSummary(value: unknown): TryCheckSummary | null {
  if (!isRecord(value)) return null;
  if (value.by === 'ai' || value.by === 'dont_know') return { by: value.by };
  if (value.by !== 'keywords') return null;
  return typeof value.reason === 'string' && ALL_REASONS.has(value.reason) ? { by: 'keywords', reason: value.reason as TryFallbackReason } : { by: 'keywords' };
}

export const CHECKED_BY_AI = 'Ответ проверил ИИ по пунктам из лекций примера.';
export const CHECKED_BY_KEYWORDS = 'Проверено по ключевым словам.';

const KEYWORD_REASONS: Record<TryFallbackReason, string> = {
  no_key: 'проверка ИИ в примере сейчас недоступна',
  busy: 'проверка ИИ в примере сейчас недоступна',
  failed: 'проверка ИИ в примере сейчас недоступна',
  timeout: 'ИИ не успел проверить ответ',
  day_cap: 'проверки ИИ в примере на сегодня закончились',
  client_limit: 'из вашей сети было слишком много проверок подряд',
  offline: 'нет связи с сервером',
  too_long: `ИИ в примере проверяет ответы до ${TRY_TRANSCRIPT_CHARS} знаков`,
};

/** The protocol's line about how this answer was checked, in plain words. */
export function checkLine(check: TryCheckSummary): string {
  if (check.by === 'ai') return CHECKED_BY_AI;
  if (check.by === 'dont_know') return DONT_KNOW_VERDICT;
  return check.reason ? `Проверено по ключевым словам: ${KEYWORD_REASONS[check.reason]}.` : CHECKED_BY_KEYWORDS;
}

/** The model's protocol as the tab keeps it with the answer (its quotes, comments and corrections), if it is one. */
export function keptEvaluation(value: unknown, pointIds: readonly string[]): Evaluation | null {
  try {
    return parseEvaluation(value, pointIds);
  } catch {
    return null;
  }
}

