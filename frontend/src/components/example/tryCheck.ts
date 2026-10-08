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
 *
 * The reply to the examiner's follow-up goes to the same path once more (checkTryFollowup): the question's
 * id, the point's id and the reply — the server judges it by the point as /api/oral/check judges a real
 * ticket's reply. The key words alone never count a reply as «назван» (PUB-2), so without this a correct
 * reply in the example could never be named after the examiner's question.
 */
import { DONT_KNOW_VERDICT, parseEvaluation, type CheckStatus, type Evaluation } from '../../lib/oral/oralApi';
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

type Posted = { ok: true; value: unknown } | { ok: false; reason: TryFallbackReason };

/**
 * One POST /api/try/evaluate: the server's JSON, or why there is none — no connection, the visitor's limit
 * (backend ratelimit.visitor_ip_key: 12 checks in 10 minutes, 40 a day), an error, or no answer in time.
 */
async function postTry(body: Record<string, string>, options: { signal?: AbortSignal; timeoutMs: number }): Promise<Posted> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(0, options.timeoutMs));
  const onOuterAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(TRY_EVALUATE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, reason: timedOut ? 'timeout' : 'offline' };
    }
    if (response.status === 429) return { ok: false, reason: 'client_limit' };
    if (!response.ok) return { ok: false, reason: 'failed' };
    try {
      return { ok: true, value: await response.json() };
    } catch {
      return { ok: false, reason: timedOut ? 'timeout' : 'failed' };
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
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
  const posted = await postTry({ question_id: questionId, transcript }, { signal: options.signal, timeoutMs: options.timeoutMs ?? TRY_CHECK_TIMEOUT_MS });
  return posted.ok ? parseTryResponse(posted.value, pointIds) : { by: 'keywords', reason: posted.reason };
}

// ── The reply to the examiner's follow-up ─────────────────────────────────────────

/** The server gives the reply's check 4.5 s (backend try_api.FOLLOWUP_TIMEOUT_SECONDS), as a real ticket's: this leaves the way there and back. */
export const TRY_FOLLOWUP_TIMEOUT_MS = 5_500;
/** The AI did not check the answer in time, or failed: no second long wait in the same answer (as lib/oral/oralApi.CHECK_AFTER_FAILED_CHECK_MS). */
export const TRY_FOLLOWUP_AFTER_FAILURE_MS = 2_500;

/** The reply judged by the AI (a point's status), or why the key words judge it. */
export type TryFollowupCheck = { by: 'ai'; status: CheckStatus } | { by: 'keywords'; reason: TryFallbackReason };

const REPLY_STATUSES: ReadonlySet<string> = new Set(['covered', 'partial', 'missing', 'wrong']);

/** The server's answer about a reply: {mode: ai, status} or key words with a known reason. */
export function parseTryFollowup(value: unknown): TryFollowupCheck {
  if (isRecord(value) && value.mode === 'ai' && typeof value.status === 'string' && REPLY_STATUSES.has(value.status)) {
    return { by: 'ai', status: value.status as CheckStatus };
  }
  if (isRecord(value) && value.mode === 'keywords' && typeof value.reason === 'string' && SERVER_REASONS.has(value.reason)) {
    return { by: 'keywords', reason: value.reason as TryFallbackReason };
  }
  return { by: 'keywords', reason: 'failed' };
}

/** Reasons that hold for the whole answer: the reply's check would end the same, so it is not asked. */
const NO_AI_NOW: ReadonlySet<TryFallbackReason> = new Set(['no_key', 'day_cap', 'busy', 'client_limit', 'offline']);

/**
 * Whether to ask the AI about the reply, and how long to wait, by what the answer's own check said: in full
 * when the AI checked the answer (or the answer was only too long); 2.5 s when the AI was slow or failed, or
 * has not answered yet; not at all — the key words, for the same reason — when no AI check can be had now.
 */
export function followupPlan(answerCheck: TryCheck | null): { ask: true; timeoutMs: number } | { ask: false; reason: TryFallbackReason } {
  if (answerCheck === null) return { ask: true, timeoutMs: TRY_FOLLOWUP_AFTER_FAILURE_MS };
  if (answerCheck.by !== 'keywords' || answerCheck.reason === 'too_long') return { ask: true, timeoutMs: TRY_FOLLOWUP_TIMEOUT_MS };
  if (NO_AI_NOW.has(answerCheck.reason)) return { ask: false, reason: answerCheck.reason };
  return { ask: true, timeoutMs: TRY_FOLLOWUP_AFTER_FAILURE_MS };
}

/**
 * The reply to the examiner's question about one point, judged on the server by that point (the prompt of a
 * real ticket's /api/oral/check with only) — or why the key words judge it. One request per reply; «не знаю»
 * never comes here (the page takes it as the button's answer).
 */
export async function checkTryFollowup(
  questionId: string,
  pointId: string,
  reply: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<TryFollowupCheck> {
  if (reply.length > TRY_TRANSCRIPT_CHARS) return { by: 'keywords', reason: 'too_long' };
  const posted = await postTry(
    { question_id: questionId, point_id: pointId, transcript: reply },
    { signal: options.signal, timeoutMs: options.timeoutMs ?? TRY_FOLLOWUP_TIMEOUT_MS },
  );
  return posted.ok ? parseTryFollowup(posted.value) : { by: 'keywords', reason: posted.reason };
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

