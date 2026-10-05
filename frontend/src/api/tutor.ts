/**
 * «Поговорить о лекции»: the two calls of the voice tutor (backend/tutor_api.py).
 *
 * POST /api/tutor/session {material_id} — free: the lecture's title and its cards as the targets of
 * the conversation, in the order of their fragments. POST /api/tutor/turn — one reply of the
 * student: 1 AI unit when the model answered (the server gives it back otherwise).
 *
 * The session's token is added by lib/apiAuth (every /api/* path), and a refusal by the daily limit
 * (429 ai_limit) opens the app's limit dialog there as well. Errors keep the status and the
 * server's code and carry the line for the screen: the server's own Russian detail for 400–422
 * (no text, no cards, an unknown card, a reply too long), plain words for the daily limit, a busy
 * service (429, 5xx, no answer in time) and a lost connection — never a provider's text.
 */
import { httpErrorFromResponse, STREAM_MESSAGES } from './sseStream';
import { notifyAIUsageChanged } from './limits';

/** The session reads the lecture and its cards: no model, a short wait. */
export const SESSION_TIMEOUT_MS = 15_000;
/** One turn: past this the room says the service is busy (the server's own budget is 25 s). */
export const TURN_TIMEOUT_MS = 20_000;

export const TUTOR_LIMIT_MESSAGE = 'Дневной лимит ИИ на сегодня исчерпан. Сказанное сохранено.';
export const TUTOR_BUSY_MESSAGE = 'Сервис ИИ занят. Подождите минуту — ответ сохранён.';
export const TUTOR_OFFLINE_MESSAGE = 'Нет интернета. Разговор на паузе, сказанное сохранено.';
export const TUTOR_LOAD_FAILED_MESSAGE = 'Не удалось начать разговор: сервер не ответил. Повторите через минуту.';
/** A 200 without a single card (an old server, a broken proxy): the same words as the server's 409. */
export const TUTOR_NO_CARDS_MESSAGE = 'Сначала разберите лекцию: репетитор спрашивает по её карточкам.';

/**
 * limit — the day's AI units are spent (a repeat today will not help);
 * busy — the model or the server did not answer (429, 5xx, a timeout, an unusable body): «Повторить»;
 * offline — no connection at all;
 * http — the server refused the request with its own words (400, 401, 404, 409, 413, 422);
 * aborted — the room moved on.
 */
export type TutorErrorKind = 'limit' | 'busy' | 'offline' | 'http' | 'aborted';

export class TutorApiError extends Error {
  readonly kind: TutorErrorKind;
  readonly status: number | null;
  readonly code: string | null;

  constructor(kind: TutorErrorKind, message: string, options: { status?: number | null; code?: string | null } = {}) {
    super(message);
    this.name = 'TutorApiError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

export const isTutorApiError = (error: unknown): error is TutorApiError => error instanceof TutorApiError;

// ── Shapes ──────────────────────────────────────────────────────────────────────

export interface TutorFragment {
  /** «S04» */
  source_id: string;
  text: string;
}

export interface TutorTarget {
  /** «c3» */
  id: string;
  question: string;
  fragments: TutorFragment[];
}

export interface TutorSession {
  title: string;
  targets: TutorTarget[];
}

export type AnswerMove = 'confirm' | 'nudge' | 'quote' | 'explain' | 'redirect';
export type QuestionMove = 'answer' | 'not_in_lecture';
export type TutorMove = AnswerMove | QuestionMove;

export interface TutorTurnResponse {
  move: TutorMove;
  /** What the tutor says (the server's code cut it and checked it). */
  say: string;
  /** The lecture's own words, chosen or verified by the server's code. */
  quote: TutorFragment | null;
  /** «В лекции об этом не сказано»: the fragment nearest to the student's question. */
  nearest: TutorFragment | null;
  /** covered | partial | missing | wrong; null for a question of the student's own. */
  status: string | null;
  /** answer | dont_know | asks_answer | off_topic | question. */
  intent: string | null;
  /** The card is closed. */
  done: boolean;
  /** The rung to send with the next answer to this card. */
  rung: 0 | 1 | 2;
  /** The card was closed (or will be) with help. */
  assisted: boolean;
}

export interface TutorHistoryLine {
  role: 'student' | 'tutor';
  text: string;
}

export type TutorTurnBody =
  | { material_id: string; kind: 'answer'; target_id: string; rung: 0 | 1 | 2; utterance: string; history: TutorHistoryLine[] }
  | { material_id: string; kind: 'question'; utterance: string; history: TutorHistoryLine[] };

// ── Validation (the server is trusted, a broken proxy or an old build is not) ──────

const TARGET_ID = /^c\d{1,3}$/;
const SOURCE_ID = /^S\d{1,4}$/;
const MOVES = new Set<string>(['confirm', 'nudge', 'quote', 'explain', 'redirect', 'answer', 'not_in_lecture']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function fragment(value: unknown): TutorFragment | null {
  if (!isRecord(value)) return null;
  const sourceId = text(value.source_id, 8);
  const body = text(value.text, 1200);
  return SOURCE_ID.test(sourceId) && body ? { source_id: sourceId, text: body } : null;
}

function invalid(): TutorApiError {
  return new TutorApiError('busy', TUTOR_BUSY_MESSAGE);
}

export function parseTutorSession(value: unknown): TutorSession {
  if (!isRecord(value) || !Array.isArray(value.targets)) throw invalid();
  const seen = new Set<string>();
  const targets: TutorTarget[] = [];
  for (const item of value.targets) {
    if (!isRecord(item)) continue;
    const id = text(item.id, 8);
    const question = text(item.question, 400);
    if (!TARGET_ID.test(id) || !question || seen.has(id)) continue;
    seen.add(id);
    const fragments = (Array.isArray(item.fragments) ? item.fragments : []).map(fragment).filter((entry): entry is TutorFragment => entry !== null);
    targets.push({ id, question, fragments: fragments.slice(0, 3) });
  }
  if (targets.length === 0) throw new TutorApiError('http', TUTOR_NO_CARDS_MESSAGE, { status: 409 });
  return { title: text(value.title, 300), targets };
}

export function parseTutorTurn(value: unknown): TutorTurnResponse {
  if (!isRecord(value) || typeof value.move !== 'string' || !MOVES.has(value.move)) throw invalid();
  const rung = Number(value.rung);
  return {
    move: value.move as TutorMove,
    say: text(value.say, 1200),
    quote: fragment(value.quote),
    nearest: fragment(value.nearest),
    status: typeof value.status === 'string' ? value.status.slice(0, 24) : null,
    intent: typeof value.intent === 'string' ? value.intent.slice(0, 24) : null,
    done: value.done === true,
    rung: rung === 1 || rung === 2 ? rung : 0,
    assisted: value.assisted === true,
  };
}

// ── Transport ───────────────────────────────────────────────────────────────────

async function failureOf(response: Response): Promise<TutorApiError> {
  const error = await httpErrorFromResponse(response);
  const status = response.status;
  const code = error.code ?? null;
  if (status === 429 && code === 'ai_limit') return new TutorApiError('limit', TUTOR_LIMIT_MESSAGE, { status, code });
  if (status === 429 || status >= 500) return new TutorApiError('busy', TUTOR_BUSY_MESSAGE, { status, code });
  if (status === 401) return new TutorApiError('http', STREAM_MESSAGES.auth, { status, code });
  return new TutorApiError('http', error.message, { status, code });
}

/**
 * POSTs JSON with a deadline over the whole exchange, body included. An outside signal (the room
 * moving on) ends with kind 'aborted'; no connection at all with 'offline'.
 */
async function post(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(0, timeoutMs));
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const failure = (error: unknown): TutorApiError => {
    if (error instanceof TutorApiError) return error;
    if (signal?.aborted) return new TutorApiError('aborted', 'Запрос остановлен.');
    if (timedOut) return new TutorApiError('busy', TUTOR_BUSY_MESSAGE);
    // fetch rejects only when no answer came at all: the connection is gone (the browser may not know yet).
    return new TutorApiError('offline', TUTOR_OFFLINE_MESSAGE);
  };
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw failure(error);
    }
    if (!response.ok) throw await failureOf(response);
    try {
      return await response.json();
    } catch (error) {
      if (timedOut || signal?.aborted) throw failure(error);
      throw invalid();
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

// ── Calls ───────────────────────────────────────────────────────────────────────

/** The conversation's cards and the lecture's title (free). 404 / 409 / 422 carry the server's words. */
export async function startTutor(materialId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<TutorSession> {
  try {
    const json = await post('/api/tutor/session', { material_id: materialId }, options.timeoutMs ?? SESSION_TIMEOUT_MS, options.signal);
    return parseTutorSession(json);
  } catch (error) {
    // Starting costs nothing and says nothing was said yet: a busy server is «не удалось начать».
    if (isTutorApiError(error) && error.kind === 'busy') throw new TutorApiError('busy', TUTOR_LOAD_FAILED_MESSAGE, { status: error.status, code: error.code });
    throw error;
  }
}

/** One reply of the student: the tutor's move. The meter of the day's units is refreshed after it. */
export async function tutorTurn(body: TutorTurnBody, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<TutorTurnResponse> {
  const json = await post('/api/tutor/turn', body, options.timeoutMs ?? TURN_TIMEOUT_MS, options.signal);
  const response = parseTutorTurn(json);
  notifyAIUsageChanged();
  return response;
}
