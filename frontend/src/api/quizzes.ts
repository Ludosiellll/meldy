/**
 * «Контрольная»: the quiz functions of the database (migration 20261016120000_quizzes.sql; contract in
 * docs/superpowers/plans/2026-10-16-quiz.md; guests, release 47: 20261018100000_test_builder.sql and
 * docs/superpowers/plans/2026-10-18-test-builder-r47.md). A taker without an account passes the device's token
 * (lib/quizzes/guestToken.ts) and the calls go to the quiz_guest_* functions. Errors come as ContainerApiError: MC010–MC018 with the quiz's own words
 * (components/quiz/copyQuiz.ts), everything else as the container API maps it (28000, P0002, 22023, network).
 */
import { supabase, supabaseAnonKey } from '../lib/supabase';
import { CONTAINER_ERROR_TEXT, ContainerApiError, containerError } from './containers';
import { QUIZ_ERRORS } from '../components/quiz/copyQuiz';
import type { Uuid } from '../types/container';
import type { GuardEvent } from '../lib/quizzes/guard';
import type {
  AttemptAnswer,
  EssayMark,
  ItemPercent,
  MistakesSent,
  QuizAnalysis,
  QuizNotice,
  QuizShareStatus,
  QuizTelegramState,
  EssayVerdict,
  QuizAnswerInput,
  QuizGuardEventRow,
  QuizAttempt,
  QuizListRow,
  QuizMark,
  QuizPreview,
  QuizResult,
  QuizResults,
  QuizRow,
  QuizSettings,
} from '../types/quiz';

const QUIZ_CODES = new Set(['MC010', 'MC011', 'MC012', 'MC013', 'MC014', 'MC015', 'MC016', 'MC017', 'MC018']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The Russian line of a quiz refusal, by its code and detail. */
export function quizErrorText(code: string, detail: string | null): string {
  const key = `${code}_${detail ?? ''}` as keyof typeof QUIZ_ERRORS;
  if (key in QUIZ_ERRORS) return QUIZ_ERRORS[key];
  if (code in QUIZ_ERRORS) return QUIZ_ERRORS[code as keyof typeof QUIZ_ERRORS];
  if (code === 'MC013') return QUIZ_ERRORS.MC013_closed;
  if (code === 'MC014') return QUIZ_ERRORS.MC014_attempts;
  if (code === '22023' && detail === 'unfinished') return QUIZ_ERRORS.unfinished;
  return CONTAINER_ERROR_TEXT.unknown;
}

function quizError(error: unknown, status: number): ContainerApiError {
  const code = isRecord(error) ? text(error.code) : '';
  const detail = (isRecord(error) ? text(error.details) : '') || null;
  if (QUIZ_CODES.has(code) || (code === '22023' && detail === 'unfinished')) {
    return new ContainerApiError(code, quizErrorText(code, detail), { status, detail });
  }
  return containerError(error, status);
}

/** `asGuest`: the call goes as a visitor without an account (the anon key as the bearer), whatever the session. */
async function rpc(name: string, args: Record<string, unknown>, asGuest = false): Promise<unknown> {
  let result: { data: unknown; error: unknown; status?: number };
  try {
    const call = supabase.rpc(name, args);
    result = await (asGuest ? call.setHeader('Authorization', `Bearer ${supabaseAnonKey}`) : call);
  } catch (error) {
    const kind = error instanceof Error ? error.name : '';
    if (kind === 'TypeError' || kind === 'AbortError') throw new ContainerApiError('network', CONTAINER_ERROR_TEXT.network, { status: 0 });
    throw new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown);
  }
  if (result.error) throw quizError(result.error, typeof result.status === 'number' ? result.status : 0);
  return result.data;
}

function shaped<T>(raw: unknown, what: string, key: string): T {
  if (!isRecord(raw) || !(key in raw)) throw new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { detail: `bad shape: ${what}` });
  return raw as T;
}

function rows<T>(raw: unknown, key: string): T[] {
  return Array.isArray(raw) ? (raw.filter((row) => isRecord(row) && key in row) as T[]) : [];
}

// ── the author ──

export async function createQuiz(containerId: Uuid, settings: Partial<QuizSettings>): Promise<QuizRow> {
  return shaped(await rpc('quiz_create', { p_container_id: containerId, p_settings: settings }), 'quiz_create', 'code');
}

export async function updateQuiz(quizId: Uuid, settings: Partial<QuizSettings>): Promise<QuizRow> {
  return shaped(await rpc('quiz_update', { p_quiz_id: quizId, p_settings: settings }), 'quiz_update', 'code');
}

export async function closeQuiz(quizId: Uuid): Promise<QuizRow> {
  return shaped(await rpc('quiz_close', { p_quiz_id: quizId }), 'quiz_close', 'code');
}

export async function deleteQuiz(quizId: Uuid): Promise<void> {
  await rpc('quiz_delete', { p_quiz_id: quizId });
}

export async function listQuizzes(containerId: Uuid): Promise<QuizListRow[]> {
  return rows(await rpc('quiz_list', { p_container_id: containerId }), 'code');
}

export async function quizResults(quizId: Uuid): Promise<QuizResults> {
  const raw = shaped<Record<string, unknown>>(await rpc('quiz_results', { p_quiz_id: quizId }), 'quiz_results', 'quiz');
  return {
    quiz: shaped(raw.quiz, 'quiz_results.quiz', 'code'),
    server_now: text(raw.server_now),
    attempts: rows(raw.attempts, 'id'),
    items: rows(raw.items, 'item_id'),
  };
}

export async function quizMarks(quizId: Uuid): Promise<QuizMark[]> {
  return rows(await rpc('quiz_marks', { p_quiz_id: quizId }), 'attempt_id');
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
/** A number, null, or null for anything else: a cell's credit and seconds. */
const numOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Release 49 (20261105090000_quiz_stats): the finished attempts of others with their cells, and the other quizzes. */
export async function quizAnalysis(quizId: Uuid): Promise<QuizAnalysis> {
  const raw = shaped<Record<string, unknown>>(await rpc('quiz_analysis', { p_quiz_id: quizId }), 'quiz_analysis', 'attempts');
  const items = Array.isArray(raw.items) ? raw.items.filter((id): id is string => typeof id === 'string') : [];
  const cellsOf = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .filter((cell): cell is unknown[] => Array.isArray(cell) && typeof cell[0] === 'number' && cell[0] >= 0 && cell[0] < items.length)
      .map((cell) => [cell[0] as number, numOrNull(cell[1]), numOrNull(cell[2])] as [number, number | null, number | null]);
  return {
    quiz_id: text(raw.quiz_id),
    server_now: text(raw.server_now),
    items,
    attempts: rows<Record<string, unknown>>(raw.attempts, 'id').map((a) => ({
      id: text(a.id),
      person: text(a.person),
      n: num(a.n),
      guest: a.guest === true,
      member: a.member === true,
      sent: a.sent === true,
      started_at: text(a.started_at),
      finished_at: text(a.finished_at),
      cells: cellsOf(a.cells),
    })),
    others: rows<Record<string, unknown>>(raw.others, 'id').map((o) => ({
      id: text(o.id),
      title: text(o.title),
      created_at: text(o.created_at),
      closed: o.closed === true,
      attempts: num(o.attempts),
      items: (Array.isArray(o.items) ? o.items : [])
        .filter((cell): cell is unknown[] => Array.isArray(cell) && typeof cell[0] === 'number' && cell[0] >= 0 && cell[0] < items.length)
        .map((cell) => [cell[0] as number, num(cell[1]), num(cell[2])] as [number, number, number]),
    })),
  };
}

/** Each member's mistakes of their latest attempt into their training; a second press writes nothing. */
export async function sendMistakes(quizId: Uuid): Promise<MistakesSent> {
  const raw = shaped<Record<string, unknown>>(await rpc('quiz_send_mistakes', { p_quiz_id: quizId }), 'quiz_send_mistakes', 'people');
  return {
    people: num(raw.people),
    answers: num(raw.answers),
    again: num(raw.again),
    clean: num(raw.clean),
    outside: num(raw.outside),
    guests: num(raw.guests),
    practice: raw.practice === true,
  };
}

function telegramState(raw: unknown): QuizTelegramState {
  const r = shaped<Record<string, unknown>>(raw, 'telegram_quiz_state', 'linked');
  const notice = r.notice === 'each' || r.notice === 'digest' ? r.notice : 'off';
  return {
    linked: r.linked === true,
    blocked: r.blocked === true,
    notice,
    groups: rows<Record<string, unknown>>(r.groups, 'chat_id')
      .filter((g) => typeof g.chat_id === 'number')
      .map((g) => ({ chat_id: g.chat_id as number, title: typeof g.title === 'string' ? g.title : null, shared_at: typeof g.shared_at === 'string' ? g.shared_at : null })),
  };
}

/** Release 49: the author's Telegram for this quiz — linked, the notices chosen, the group chats of the exam. */
export async function quizTelegramState(quizId: Uuid): Promise<QuizTelegramState> {
  return telegramState(await rpc('telegram_quiz_state', { p_quiz_id: quizId }));
}

/** Each finish, a digest an hour, or nothing; → the state after the change. */
export async function setQuizNotice(quizId: Uuid, mode: QuizNotice): Promise<QuizTelegramState> {
  return telegramState(await rpc('telegram_quiz_notice', { p_quiz_id: quizId, p_mode: mode }));
}

/** The quiz's link into a group chat of the exam, once a day per chat; the bot posts it within a minute. */
export async function shareQuizToGroup(quizId: Uuid, chatId: number): Promise<{ status: QuizShareStatus; title: string | null }> {
  const r = shaped<Record<string, unknown>>(await rpc('telegram_quiz_share', { p_quiz_id: quizId, p_chat_id: chatId }), 'telegram_quiz_share', 'status');
  const status = (['queued', 'already', 'closed', 'no_group', 'no_link'] as const).find((s) => s === r.status) ?? 'no_group';
  return { status, title: typeof r.title === 'string' ? r.title : null };
}

/** The studio's canvas: per question of the exam or test, the finished quiz attempts of others and their credit. */
export async function itemPercents(containerId: Uuid): Promise<ItemPercent[]> {
  const raw = shaped<Record<string, unknown>>(await rpc('test_item_percents', { p_container_id: containerId }), 'test_item_percents', 'items');
  return rows<Record<string, unknown>>(raw.items, 'item_id').map((row) => ({ item_id: text(row.item_id), shown: num(row.shown), credit: num(row.credit) }));
}

export async function attemptAnswers(attemptId: Uuid): Promise<AttemptAnswer[]> {
  return rows(await rpc('quiz_attempt_answers', { p_attempt_id: attemptId }), 'item_id');
}

export async function resetAttempt(attemptId: Uuid): Promise<void> {
  await rpc('quiz_attempt_reset', { p_attempt_id: attemptId });
}

/** One attempt's timeline of «Защита от списывания» (20261020120000_quiz_protection), by time. */
export async function attemptEvents(attemptId: Uuid): Promise<{ count: number; events: QuizGuardEventRow[] }> {
  const raw = shaped<{ count: unknown; events: unknown }>(await rpc('quiz_attempt_events', { p_attempt_id: attemptId }), 'quiz_attempt_events', 'events');
  return { count: typeof raw.count === 'number' ? raw.count : 0, events: rows(raw.events, 'kind') };
}

// ── the participant ──

/** The card of /k/<code>; with a guest's token, «me» is that device's (attempts, the open one, the results). */
export async function previewQuiz(code: string, token: string | null = null): Promise<QuizPreview> {
  return shaped(await rpc('quiz_preview', token ? { p_code: code, p_token: token } : { p_code: code }), 'quiz_preview', 'status');
}

/**
 * The card of /k/<code> as this device's guest sees it, also while someone is signed in: quiz_preview answers a
 * signed-in caller with the account's «me» and ignores the token, so this read goes without the session. Its «me» holds
 * the device's attempts (how many, the open one, the finished ones with their time; a guest's name is not in it), or null
 * when the quiz takes no guests. Used on a shared computer to ask whose those attempts are before they move.
 */
export async function previewAsGuest(code: string, token: string): Promise<QuizPreview> {
  return shaped(await rpc('quiz_preview', { p_code: code, p_token: token }, true), 'quiz_preview', 'status');
}

/** «Начать»: signed in — quiz_start; without an account (a token) — quiz_guest_start. */
export async function startQuiz(code: string, name: string, token: string | null = null): Promise<QuizAttempt> {
  const raw = shaped<QuizAttempt>(
    token
      ? await rpc('quiz_guest_start', { p_code: code, p_name: name, p_token: token })
      : await rpc('quiz_start', { p_code: code, p_name: name }),
    token ? 'quiz_guest_start' : 'quiz_start',
    'attempt_id',
  );
  return { ...raw, items: rows(raw.items, 'id'), answers: rows(raw.answers, 'item_id') };
}

export async function sendAnswers(
  attemptId: Uuid,
  answers: QuizAnswerInput[],
  token: string | null = null,
): Promise<{ saved: number; server_now: string; deadline_at: string | null }> {
  return token
    ? shaped(await rpc('quiz_guest_answer', { p_attempt_id: attemptId, p_token: token, p_answers: answers }), 'quiz_guest_answer', 'saved')
    : shaped(await rpc('quiz_answer', { p_attempt_id: attemptId, p_answers: answers }), 'quiz_answer', 'saved');
}

/** What quiz_events_add answers: the counted events of the attempt, the strict limit, and whether the attempt ended. */
export interface GuardAnswer {
  accepted: number;
  count: number;
  limit: number | null;
  finished: boolean;
  reason: string | null;
}

/**
 * Events of «Защита от списывания» (20261020120000_quiz_protection): signed in — quiz_events_add; without an account —
 * quiz_guest_events_add with the device's token. At most 50 a call; the same id sent again changes nothing.
 */
export async function sendGuardEvents(attemptId: Uuid, events: GuardEvent[], token: string | null = null): Promise<GuardAnswer> {
  const raw = shaped<Record<string, unknown>>(
    token
      ? await rpc('quiz_guest_events_add', { p_attempt_id: attemptId, p_token: token, p_events: events })
      : await rpc('quiz_events_add', { p_attempt_id: attemptId, p_events: events }),
    token ? 'quiz_guest_events_add' : 'quiz_events_add',
    'count',
  );
  return {
    accepted: typeof raw.accepted === 'number' ? raw.accepted : 0,
    count: typeof raw.count === 'number' ? raw.count : 0,
    limit: typeof raw.limit === 'number' ? raw.limit : null,
    finished: raw.finished === true,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
  };
}

function result(raw: unknown, what: string): QuizResult {
  const value = shaped<QuizResult>(raw, what, 'attempt_id');
  return { ...value, items: rows(value.items, 'id') };
}

export async function finishQuiz(attemptId: Uuid, token: string | null = null): Promise<QuizResult> {
  return token
    ? result(await rpc('quiz_guest_finish', { p_attempt_id: attemptId, p_token: token }), 'quiz_guest_finish')
    : result(await rpc('quiz_finish', { p_attempt_id: attemptId }), 'quiz_finish');
}

export async function quizResult(attemptId: Uuid, token: string | null = null): Promise<QuizResult> {
  return token
    ? result(await rpc('quiz_guest_result', { p_attempt_id: attemptId, p_token: token }), 'quiz_guest_result')
    : result(await rpc('quiz_result', { p_attempt_id: attemptId }), 'quiz_result');
}

/**
 * The device's attempts become the account's (none taken when it has its own there): after «Это я — перенести в
 * аккаунт», or on the way back from making an account to train (?practice=1).
 */
export async function claimGuestAttempts(code: string, token: string): Promise<{ claimed: number }> {
  return shaped(await rpc('quiz_guest_claim', { p_code: code, p_token: token }), 'quiz_guest_claim', 'claimed');
}

/** «Тренировать эти вопросы»: the taker joins the quiz's exam as a member (the author offers it). */
export async function joinPractice(code: string): Promise<{ container_id: Uuid }> {
  return shaped(await rpc('quiz_practice_join', { p_code: code }), 'quiz_practice_join', 'container_id');
}

// ── Release 48: essays (docs/kinds/CONTRACT.md §3.4) ────────────────────────────────────────────────────────────────

/** The author's mark of an essay (null takes it back). The server keeps the author's word over the check's. */
export async function essayMark(attemptId: Uuid, itemId: Uuid, verdict: EssayVerdict | null, quote: string | null = null): Promise<EssayMark | null> {
  const raw = await rpc('quiz_essay_mark', { p_attempt_id: attemptId, p_item_id: itemId, p_verdict: verdict, p_quote: quote });
  return isRecord(raw) ? (raw as unknown as EssayMark) : null;
}

export interface EssayCheck {
  verdict: EssayVerdict;
  quote: string | null;
  mark: EssayMark | null;
  points: Array<{ title: string; essential: boolean; status: string }>;
}

/** An error of the check: its code (no_lectures, not_in_lectures, unanswered, ai_limit…) and the server's words. */
export class EssayCheckError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

/** «Проверить по лекциям»: the backend checks the essay by the question's lectures and saves the mark (source ai). */
export async function essayCheck(attemptId: Uuid, itemId: Uuid): Promise<EssayCheck> {
  let response: Response;
  try {
    response = await fetch('/api/quiz/essay-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempt_id: attemptId, item_id: itemId }),
    });
  } catch {
    throw new EssayCheckError('network', 'Нет связи. Повторите, когда интернет вернётся.', 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : 'Проверка не получилась. Повторите через минуту.';
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : String(response.status);
    throw new EssayCheckError(code, detail, response.status);
  }
  return body as EssayCheck;
}
