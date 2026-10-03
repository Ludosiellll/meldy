/**
 * JSON calls of «Ответ вслух» (contracts §5): the rubric of a question, the quick check that picks
 * the examiner's follow-up, and the evaluation behind the protocol.
 *
 * Every call has its own client deadline and an AbortController: rubric 30 s; check 1.5 s for the
 * «Готово» decision and 2.5 s for the answer to the follow-up; evaluate 15 s. Errors keep the HTTP
 * status and the server's code (httpErrorFromResponse): 409 and 422 show the server's own Russian
 * detail, an outage of the model (429 busy, 502, 503, 504, a client timeout or an unusable body)
 * reads «ИИ-сервис сейчас не ответил. Попробуйте ещё раз.» — never a text that blames the lectures.
 * The auth header is added by lib/apiAuth (every /api/* path).
 */
import { httpErrorFromResponse } from '../../api/sseStream';

export const RUBRIC_TIMEOUT_MS = 30_000;
export const CHECK_CONFIRM_TIMEOUT_MS = 1_500;
export const CHECK_FOLLOWUP_TIMEOUT_MS = 2_500;
export const EVALUATE_TIMEOUT_MS = 15_000;

export const AI_UNAVAILABLE_MESSAGE = 'ИИ-сервис сейчас не ответил. Попробуйте ещё раз.';
/** The server's own limiter (no model involved): too many calls in a minute. */
export const RATE_LIMITED_MESSAGE = 'Слишком много запросов. Подождите минуту и повторите.';
export const NETWORK_MESSAGE = 'Связь с сервером прервалась. Проверьте интернет и повторите попытку.';

export type OralErrorKind = 'http' | 'timeout' | 'network' | 'aborted' | 'invalid';

export class OralApiError extends Error {
  readonly kind: OralErrorKind;
  readonly status: number | null;
  readonly code: string | null;

  constructor(kind: OralErrorKind, message: string, options: { status?: number | null; code?: string | null } = {}) {
    super(message);
    this.name = 'OralApiError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }

  /** The model or the service did not answer: «Повторить» may help; the lectures are not to blame. */
  get outage(): boolean {
    if (this.kind === 'timeout' || this.kind === 'network' || this.kind === 'invalid') return true;
    return this.status !== null && (this.status === 429 || this.status >= 500);
  }
}

export const isOralApiError = (error: unknown): error is OralApiError => error instanceof OralApiError;

// ── Shapes ──────────────────────────────────────────────────────────────────────

export type CheckStatus = 'covered' | 'partial' | 'missing' | 'wrong';
export type EvaluationStatus = CheckStatus | 'unrated';

export interface RubricPoint {
  id: string;
  title: string;
  essential: boolean;
  /** A continuous quote from the lecture, cut by the server's code (never model text). */
  source_quote: string;
  /** «M1:S12» — material key and fragment id. */
  source_ids: string[];
  anchors: string[][];
  followup: { question: string; expected: string };
}

export interface RubricMaterial {
  key: string;
  material_id: string;
  title: string;
}

export interface RubricNearest {
  source_id: string;
  material_id: string;
  text: string;
}

export interface Rubric {
  v: number;
  question: string;
  coverage: 'full' | 'partial' | 'none';
  coverage_note: string;
  fragments_considered: number;
  fragments_total: number;
  materials: RubricMaterial[];
  points: RubricPoint[];
  nearest: RubricNearest[];
}

export interface RubricResponse {
  rubric_id: string | null;
  cached: boolean;
  saved: boolean;
  question_hash: string;
  question: string;
  rubric: Rubric;
}

export interface CheckResponse {
  statuses: Record<string, CheckStatus>;
  ask: string | null;
}

export interface EvaluatedPoint {
  id: string;
  status: EvaluationStatus;
  student_quote: string;
  comment: string;
}

export interface EvaluationError {
  point_id: string;
  student_quote: string;
  correction: string;
}

export interface Evaluation {
  points: EvaluatedPoint[];
  errors: EvaluationError[];
  verdict: string;
}

// ── Transport ───────────────────────────────────────────────────────────────────

function messageFor(status: number, code: string | undefined, fallback: string): string {
  if (status === 429) return code ? AI_UNAVAILABLE_MESSAGE : RATE_LIMITED_MESSAGE;
  if (status === 502 || status === 503 || status === 504) return AI_UNAVAILABLE_MESSAGE;
  return fallback;
}

/**
 * POSTs JSON and returns the parsed body. The deadline covers the whole exchange, body included.
 * An outside signal (the screen moving on) aborts with kind 'aborted'.
 */
export async function postOral<T = unknown>(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
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
  const failure = (error: unknown): OralApiError => {
    if (error instanceof OralApiError) return error;
    if (timedOut) return new OralApiError('timeout', AI_UNAVAILABLE_MESSAGE);
    if (signal?.aborted) return new OralApiError('aborted', 'Запрос остановлен.');
    return new OralApiError('network', NETWORK_MESSAGE);
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
    if (!response.ok) {
      const error = await httpErrorFromResponse(response);
      throw new OralApiError('http', messageFor(response.status, error.code, error.message), {
        status: response.status,
        code: error.code ?? null,
      });
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      if (timedOut || signal?.aborted) throw failure(error);
      throw new OralApiError('invalid', AI_UNAVAILABLE_MESSAGE, { status: response.status });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

// ── Validation (the server is trusted, a broken proxy or an old build is not) ──────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

const CHECK_STATUSES = new Set<string>(['covered', 'partial', 'missing', 'wrong']);
const EVALUATION_STATUSES = new Set<string>(['covered', 'partial', 'missing', 'wrong', 'unrated']);
const POINT_ID = /^p[1-6]$/;

function anchorsOf(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value
    .map((group) => (Array.isArray(group) ? group.filter((variant): variant is string => typeof variant === 'string' && variant.trim() !== '') : []))
    .filter((group) => group.length > 0);
}

function rubricPoint(value: unknown): RubricPoint | null {
  if (!isRecord(value)) return null;
  const id = str(value.id, 4);
  if (!POINT_ID.test(id)) return null;
  const followup = isRecord(value.followup) ? value.followup : {};
  return {
    id,
    title: str(value.title, 200).trim(),
    essential: value.essential === true,
    source_quote: str(value.source_quote, 400).trim(),
    source_ids: Array.isArray(value.source_ids) ? value.source_ids.filter((id): id is string => typeof id === 'string').slice(0, 6) : [],
    anchors: anchorsOf(value.anchors),
    followup: { question: str(followup.question, 300).trim(), expected: str(followup.expected, 400).trim() },
  };
}

export function parseRubricResponse(value: unknown): RubricResponse {
  if (!isRecord(value) || !isRecord(value.rubric)) throw new OralApiError('invalid', AI_UNAVAILABLE_MESSAGE);
  const raw = value.rubric;
  const coverage = raw.coverage === 'partial' || raw.coverage === 'none' ? raw.coverage : 'full';
  const seen = new Set<string>();
  const points: RubricPoint[] = [];
  for (const item of Array.isArray(raw.points) ? raw.points : []) {
    const point = rubricPoint(item);
    if (point && !seen.has(point.id)) {
      seen.add(point.id);
      points.push(point);
    }
  }
  const materials: RubricMaterial[] = (Array.isArray(raw.materials) ? raw.materials : [])
    .filter(isRecord)
    .map((item) => ({ key: str(item.key, 8), material_id: str(item.material_id, 64), title: str(item.title, 200) }))
    .filter((item) => item.key && item.material_id);
  const nearest: RubricNearest[] = (Array.isArray(raw.nearest) ? raw.nearest : [])
    .filter(isRecord)
    .map((item) => ({ source_id: str(item.source_id, 16), material_id: str(item.material_id, 64), text: str(item.text, 400) }))
    .filter((item) => item.text.trim() !== '');
  return {
    rubric_id: typeof value.rubric_id === 'string' && value.rubric_id ? value.rubric_id : null,
    cached: value.cached === true,
    saved: value.saved === true,
    question_hash: str(value.question_hash, 64),
    question: str(value.question, 1000),
    rubric: {
      v: typeof raw.v === 'number' ? raw.v : 1,
      question: str(raw.question, 1000),
      coverage,
      coverage_note: str(raw.coverage_note, 400),
      fragments_considered: typeof raw.fragments_considered === 'number' ? raw.fragments_considered : 0,
      fragments_total: typeof raw.fragments_total === 'number' ? raw.fragments_total : 0,
      materials,
      points: coverage === 'none' ? [] : points,
      nearest,
    },
  };
}

export function parseCheckResponse(value: unknown, pointIds: readonly string[]): CheckResponse {
  if (!isRecord(value) || !isRecord(value.statuses)) throw new OralApiError('invalid', AI_UNAVAILABLE_MESSAGE);
  const statuses: Record<string, CheckStatus> = {};
  for (const [id, status] of Object.entries(value.statuses)) {
    if (pointIds.includes(id) && typeof status === 'string' && CHECK_STATUSES.has(status)) statuses[id] = status as CheckStatus;
  }
  const ask = typeof value.ask === 'string' && pointIds.includes(value.ask) ? value.ask : null;
  return { statuses, ask };
}

export function parseEvaluation(value: unknown, pointIds: readonly string[]): Evaluation {
  if (!isRecord(value) || !Array.isArray(value.points)) throw new OralApiError('invalid', AI_UNAVAILABLE_MESSAGE);
  const byId = new Map<string, EvaluatedPoint>();
  for (const item of value.points) {
    if (!isRecord(item)) continue;
    const id = str(item.id, 4);
    if (!pointIds.includes(id) || byId.has(id)) continue;
    const status = typeof item.status === 'string' && EVALUATION_STATUSES.has(item.status) ? (item.status as EvaluationStatus) : 'unrated';
    byId.set(id, { id, status, student_quote: str(item.student_quote, 160), comment: str(item.comment, 200) });
  }
  if (byId.size === 0) throw new OralApiError('invalid', AI_UNAVAILABLE_MESSAGE);
  const errors: EvaluationError[] = (Array.isArray(value.errors) ? value.errors : [])
    .filter(isRecord)
    .map((item) => ({ point_id: str(item.point_id, 4), student_quote: str(item.student_quote, 160), correction: str(item.correction, 160) }))
    .filter((item) => pointIds.includes(item.point_id) && item.correction.trim() !== '')
    .slice(0, 10);
  return {
    points: pointIds.map((id) => byId.get(id) ?? { id, status: 'unrated', student_quote: '', comment: '' }),
    errors,
    verdict: str(value.verdict, 600),
  };
}

// ── Calls ───────────────────────────────────────────────────────────────────────

/** The rubric of an exam question: cached in oral_rubrics, or built by the model and checked by code. */
export async function fetchRubric(
  input: { examId: string; questionId: string; force?: boolean },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RubricResponse> {
  const body = { exam_id: input.examId, question_id: input.questionId, force: input.force === true };
  const json = await postOral('/api/oral/rubric', body, options.timeoutMs ?? RUBRIC_TIMEOUT_MS, options.signal);
  return parseRubricResponse(json);
}

export interface CheckInput {
  question: string;
  points: ReadonlyArray<{ id: string; title: string; essential: boolean }>;
  transcript: string;
  /** Only this point (the answer to the follow-up): one status back and ask null. */
  only?: string | null;
  followupQuestion?: string | null;
}

/** The quick check: statuses per point and the server's ask. Never shown on screen (spec 6.1). */
export async function checkAnswer(input: CheckInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CheckResponse> {
  const body = {
    question: input.question.slice(0, 1000),
    points: input.points.map((point) => ({ id: point.id, title: point.title.slice(0, 200), essential: point.essential })),
    transcript: input.transcript.slice(0, 4000),
    only: input.only ?? null,
    followup_question: input.followupQuestion ? input.followupQuestion.slice(0, 200) : null,
  };
  const timeoutMs = options.timeoutMs ?? (input.only ? CHECK_FOLLOWUP_TIMEOUT_MS : CHECK_CONFIRM_TIMEOUT_MS);
  const json = await postOral('/api/oral/check', body, timeoutMs, options.signal);
  return parseCheckResponse(
    json,
    input.points.map((point) => point.id),
  );
}

export interface EvaluateInput {
  question: string;
  points: ReadonlyArray<{ id: string; title: string; essential: boolean; source_quote: string }>;
  transcript: string;
}

/** The evaluation behind the protocol: a status, a quote of the answer and a comment per point. */
export async function evaluateAnswer(input: EvaluateInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Evaluation> {
  const body = {
    question: input.question.slice(0, 1000),
    points: input.points.map((point) => ({
      id: point.id,
      title: point.title.slice(0, 200),
      essential: point.essential,
      source_quote: point.source_quote.slice(0, 300),
    })),
    transcript: input.transcript.slice(0, 6000),
  };
  const json = await postOral('/api/oral/evaluate', body, options.timeoutMs ?? EVALUATE_TIMEOUT_MS, options.signal);
  return parseEvaluation(
    json,
    input.points.map((point) => point.id),
  );
}
