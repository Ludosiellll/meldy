/**
 * The learning journal (`public.learning_events`, contracts §1.2 and §6.5).
 *
 * One append-only journal for every answer: quiz answers and card reviews are written by RPCs
 * (record_quiz_attempt, review_flashcard), answers given aloud by record_oral_attempt, and the
 * self-rating «знаю · плаваю · не знаю» and «подсмотреть» of the cheat sheet (`sheet_peek`) by the
 * client here. A resent event is a no-op because
 * client_event_id is unique per user. Errors become LearningSaveError / LearningLoadError with a
 * short Russian message; raw database or network text never reaches the screen.
 */
import { supabase } from '../lib/supabase';
import { SELF_RATING_CONFIDENCE, compareEventTime } from '../lib/learning/readiness';
import type { LearningEvent, LearningKind, SelfRating } from '../types/learning';
import { localDateKey } from '../utils/streak';

// The journal's shapes live in types/learning.ts (the pure modules read them from there); every import from here works.
export type { LearningEvent, LearningKind, SelfRating } from '../types/learning';

export const SAVE_FAILED_MESSAGE = 'Результат не сохранён. Проверьте связь и повторите.';
export const SAVE_SIGNED_OUT_MESSAGE = 'Результат не сохранён: войдите в аккаунт и повторите.';
export const SAVE_UNAVAILABLE_MESSAGE = 'Результат не сохранён: сохранение пока недоступно на сервере.';
export const SAVE_INVALID_MESSAGE = 'Результат не сохранён: данные попытки не прошли проверку.';
export const SAVE_TOO_LARGE_MESSAGE = 'Результат не сохранён: попытка слишком большая.';
export const LOAD_FAILED_MESSAGE = 'Не удалось загрузить историю ответов. Повторите попытку.';
export const LOAD_SIGNED_OUT_MESSAGE = 'История ответов не загружена: войдите в аккаунт.';
export const LOAD_UNAVAILABLE_MESSAGE = 'История ответов пока недоступна на сервере.';

/** Saving to the journal failed. `code` is the database/PostgREST code when there was one. */
export class LearningSaveError extends Error {
  readonly code: string | null;

  constructor(message: string = SAVE_FAILED_MESSAGE, code: string | null = null) {
    super(message);
    this.name = 'LearningSaveError';
    this.code = code;
  }
}

/** Reading the journal failed. `code` is the database/PostgREST code when there was one. */
export class LearningLoadError extends Error {
  readonly code: string | null;

  constructor(message: string = LOAD_FAILED_MESSAGE, code: string | null = null) {
    super(message);
    this.name = 'LearningLoadError';
    this.code = code;
  }
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const QUESTION_HASH = /^[0-9a-f]{32}$/;
const SOURCE_ID = /^S\d{1,3}$/;
const EVENT_COLUMNS =
  'id, created_at, local_date, material_id, kind, item_key, correct, score, confidence, source_ids, session_id, payload';
const PAGE_SIZE = 1000;
const KEYS_PER_REQUEST = 100;
/** record_quiz_attempt rejects more than 65 536 bytes of jsonb text; compact JSON stays below this. */
const QUIZ_PAYLOAD_BUDGET = 56_000;

/** 'yyyy-MM-dd' in the browser time zone (default: now). */
export function localDate(d?: Date): string {
  return localDateKey(d);
}

function randomBase36(length: number): string {
  let out = '';
  while (out.length < length) out += Math.random().toString(36).slice(2);
  return out.slice(0, length);
}

/**
 * A fresh id for client_event_id or a session id: crypto.randomUUID(); without it a version-4
 * UUID from crypto.getRandomValues; without any crypto `${Date.now() base36}-${random base36}`.
 * Always matches [A-Za-z0-9_-]{8,64}.
 */
export function newEventId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  try {
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    // Some embedded browsers expose crypto but throw outside a secure context.
  }
  return `${Date.now().toString(36)}-${randomBase36(12)}`;
}

interface DbError {
  code?: string | null;
  message?: string | null;
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as DbError).code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return null;
}

function isSignedOut(code: string | null): boolean {
  return code === '28000' || code === '42501' || code === '401' || (code !== null && code.startsWith('PGRST30'));
}

function isUnavailable(code: string | null): boolean {
  return code === 'PGRST202' || code === 'PGRST205' || code === '42883' || code === '42P01';
}

function saveError(error: unknown): LearningSaveError {
  if (error instanceof LearningSaveError) return error;
  const code = errorCode(error);
  if (isSignedOut(code)) return new LearningSaveError(SAVE_SIGNED_OUT_MESSAGE, code);
  if (isUnavailable(code)) return new LearningSaveError(SAVE_UNAVAILABLE_MESSAGE, code);
  if (code && /^(22|23)/.test(code)) return new LearningSaveError(SAVE_INVALID_MESSAGE, code);
  return new LearningSaveError(SAVE_FAILED_MESSAGE, code);
}

function loadError(error: unknown): LearningLoadError {
  if (error instanceof LearningLoadError) return error;
  const code = errorCode(error);
  if (isSignedOut(code)) return new LearningLoadError(LOAD_SIGNED_OUT_MESSAGE, code);
  if (isUnavailable(code)) return new LearningLoadError(LOAD_UNAVAILABLE_MESSAGE, code);
  return new LearningLoadError(LOAD_FAILED_MESSAGE, code);
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function unique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export interface QuizAttemptAnswer {
  index: number;
  question: string;
  chosen: string | null;
  chosenText: string;
  expected: string | null;
  expectedText: string;
  correct: boolean | null;
  explanation?: string;
  sourceIds?: string[];
  options: number;
}

interface QuizAnswerPayload {
  index: number;
  question: string;
  chosen: string | null;
  chosen_text: string;
  expected: string | null;
  expected_text: string;
  correct: boolean | null;
  explanation: string;
  source_ids: string[];
  options: number;
}

function quizAnswerPayload(answer: QuizAttemptAnswer, position: number): QuizAnswerPayload {
  const index = Number.isInteger(answer.index) && answer.index >= 0 && answer.index <= 999 ? answer.index : position;
  const letter = (value: string | null) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 4) : null);
  return {
    index,
    // The server trims and keeps 1000 characters before hashing; never cut a question shorter here,
    // or the same question would get another history key.
    question: clip(answer.question, 2000),
    chosen: letter(answer.chosen),
    chosen_text: clip(answer.chosenText, 500),
    expected: letter(answer.expected),
    expected_text: clip(answer.expectedText, 1000),
    correct: answer.correct === true ? true : answer.correct === false ? false : null,
    explanation: clip(answer.explanation, 1000),
    source_ids: unique((answer.sourceIds ?? []).filter((id) => typeof id === 'string' && SOURCE_ID.test(id))).slice(0, 20),
    options: Number.isInteger(answer.options) && answer.options >= 0 && answer.options <= 26 ? answer.options : 0,
  };
}

/**
 * Records one checked quiz attempt with the record_quiz_attempt RPC: one quiz_answer event per
 * answer (idempotent by `<sessionId>:<index>`) and one open mistake per newly recorded wrong
 * answer. A session id must be a UUID (newEventId gives one); «Пройти снова» is a new session
 * with retake true. The server also marks the attempt as a retake when any of its questions was
 * already answered in another session.
 */
export async function recordQuizAttempt(input: {
  sessionId: string;
  materialId: string | null;
  retake: boolean;
  surface: 'analysis' | 'material';
  topic: string;
  answers: QuizAttemptAnswer[];
}): Promise<{ events: number; duplicate: boolean; retake: boolean; mistakesAdded: number; mistakesExisting: number }> {
  if (!UUID.test(input.sessionId ?? '')) throw new LearningSaveError(SAVE_INVALID_MESSAGE, 'session_id');
  if (!Array.isArray(input.answers) || input.answers.length < 1 || input.answers.length > 50) {
    throw new LearningSaveError(SAVE_INVALID_MESSAGE, 'answers');
  }

  const answers = input.answers.map(quizAnswerPayload);
  const attempt = {
    session_id: input.sessionId,
    material_id: input.materialId && UUID.test(input.materialId) ? input.materialId : null,
    local_date: localDate(),
    retake: input.retake === true,
    surface: input.surface === 'material' ? 'material' : 'analysis',
    topic: clip(input.topic, 200),
    answers,
  };
  // Long explanations and option texts are the first to give way; question texts never shrink.
  if (utf8Bytes(JSON.stringify(attempt)) > QUIZ_PAYLOAD_BUDGET) {
    for (const answer of answers) answer.explanation = answer.explanation.slice(0, 200);
  }
  if (utf8Bytes(JSON.stringify(attempt)) > QUIZ_PAYLOAD_BUDGET) {
    for (const answer of answers) {
      answer.chosen_text = answer.chosen_text.slice(0, 120);
      answer.expected_text = answer.expected_text.slice(0, 120);
      answer.explanation = '';
    }
  }
  if (utf8Bytes(JSON.stringify(attempt)) > QUIZ_PAYLOAD_BUDGET) {
    throw new LearningSaveError(SAVE_TOO_LARGE_MESSAGE, 'too_large');
  }

  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.rpc('record_quiz_attempt', { p_attempt: attempt });
  } catch (error) {
    throw saveError(error);
  }
  if (response.error) throw saveError(response.error);
  const result = response.data;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new LearningSaveError(SAVE_FAILED_MESSAGE, 'no_result');
  const row = result as Record<string, unknown>;
  return {
    events: count(row.events),
    duplicate: row.duplicate === true,
    retake: row.retake === true,
    mistakesAdded: count(row.mistakes_added),
    mistakesExisting: count(row.mistakes_existing),
  };
}

/**
 * Stores a self-rating of a question («знаю» 3 · «плаваю» 2 · «не знаю» 1 in `confidence`). Each tap
 * is a new event; the latest one wins. It is never an answer and never changes readiness.
 */
export async function recordSelfRating(input: {
  questionHash: string;
  rating: SelfRating;
  examId: string;
  examQuestionId: string;
  materialId?: string | null;
}): Promise<void> {
  const hash = typeof input.questionHash === 'string' ? input.questionHash.trim().toLowerCase() : '';
  const confidence = Object.prototype.hasOwnProperty.call(SELF_RATING_CONFIDENCE, input.rating)
    ? SELF_RATING_CONFIDENCE[input.rating]
    : null;
  if (!QUESTION_HASH.test(hash) || !confidence) throw new LearningSaveError(SAVE_INVALID_MESSAGE, 'self_rating');

  const materialId = input.materialId && UUID.test(input.materialId) ? input.materialId : null;
  const row = {
    kind: 'self_rating' as const,
    item_key: `q:${hash}`,
    confidence,
    client_event_id: newEventId(),
    local_date: localDate(),
    material_id: materialId,
    payload: { v: 1, exam_id: input.examId, exam_question_id: input.examQuestionId },
  };
  const write = async (values: typeof row) => {
    try {
      const { error } = await supabase
        .from('learning_events')
        .upsert(values, { onConflict: 'user_id,client_event_id', ignoreDuplicates: true });
      return error ?? null;
    } catch (error) {
      return error ?? new Error('network');
    }
  };

  let error = await write(row);
  // The journal links only the caller's own materials; a rating does not need the link at all.
  if (error && materialId && errorCode(error) === '42501') error = await write({ ...row, material_id: null });
  if (error) throw saveError(error);
}

type PageResult = { data: unknown[] | null; error: unknown };

async function readAllPages(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<LearningEvent[]> {
  const rows: LearningEvent[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let result: PageResult;
    try {
      result = await page(from, from + PAGE_SIZE - 1);
    } catch (error) {
      throw loadError(error);
    }
    if (result.error) throw loadError(result.error);
    const data = Array.isArray(result.data) ? result.data : [];
    for (const raw of data) {
      const event = normalizeEvent(raw);
      if (event) rows.push(event);
    }
    if (data.length < PAGE_SIZE) return rows;
  }
}

function normalizeEvent(raw: unknown): LearningEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.item_key !== 'string' || typeof row.kind !== 'string') return null;
  const confidence = row.confidence === 1 || row.confidence === 2 || row.confidence === 3 ? row.confidence : null;
  const score = typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : null;
  return {
    id: row.id,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    local_date: typeof row.local_date === 'string' ? row.local_date : '',
    material_id: typeof row.material_id === 'string' ? row.material_id : null,
    kind: row.kind as LearningKind,
    item_key: row.item_key,
    correct: row.correct === true ? true : row.correct === false ? false : null,
    score,
    confidence,
    source_ids: Array.isArray(row.source_ids) ? row.source_ids.filter((id): id is string => typeof id === 'string') : [],
    session_id: typeof row.session_id === 'string' ? row.session_id : null,
    payload:
      row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
  };
}

function chronological(events: LearningEvent[]): LearningEvent[] {
  const byId = new Map<string, LearningEvent>();
  for (const event of events) byId.set(event.id, event);
  return Array.from(byId.values()).sort(compareEventTime);
}

/**
 * «Подсмотреть» on the cheat sheet (lib/exams/cheatSheet.ts): the student uncovered a rubbed line.
 * A naming of that line later the same local day then erases nothing. item_key
 * `peek:<rubric_id>:<point_id>`; the payload carries the question hash and the point's words, which
 * is how the sheet finds the line again after its rubric is rebuilt.
 */
export async function recordSheetPeek(input: {
  questionHash: string;
  rubricId: string;
  pointId: string;
  title: string;
  examId: string;
}): Promise<void> {
  const hash = typeof input.questionHash === 'string' ? input.questionHash.trim().toLowerCase() : '';
  const pointId = typeof input.pointId === 'string' ? input.pointId.trim() : '';
  if (!QUESTION_HASH.test(hash) || !UUID.test(input.rubricId) || !/^p[1-6]$/.test(pointId)) {
    throw new LearningSaveError(SAVE_INVALID_MESSAGE, 'sheet_peek');
  }
  const row: SheetPeekRow = {
    kind: 'sheet_peek',
    item_key: `peek:${input.rubricId.toLowerCase()}:${pointId}`,
    client_event_id: newEventId(),
    local_date: localDate(),
    payload: {
      v: 1,
      question_hash: hash,
      rubric_id: input.rubricId.toLowerCase(),
      point_id: pointId,
      title: clip(input.title, 120),
      exam_id: UUID.test(input.examId) ? input.examId : null,
    },
  };
  try {
    await saveSheetPeekRow(row);
  } catch (error) {
    // Kept on the device to be sent again: a peek lost would let today's answer erase a line that was read.
    const user = await sessionUserId();
    if (user) writePendingPeeks([...readPendingPeeks(), { user, row }]);
    throw error;
  }
}

interface SheetPeekRow {
  kind: 'sheet_peek';
  item_key: string;
  client_event_id: string;
  local_date: string;
  payload: Record<string, unknown>;
}

async function saveSheetPeekRow(row: SheetPeekRow): Promise<void> {
  try {
    // The same client_event_id: a peek sent twice is one row.
    const { error } = await supabase.from('learning_events').upsert(row, { onConflict: 'user_id,client_event_id', ignoreDuplicates: true });
    if (error) throw saveError(error);
  } catch (error) {
    throw saveError(error);
  }
}

/** Peeks not saved yet, on this device, with the account they belong to (a new key of its own). */
const PENDING_PEEKS_KEY = 'studyforge_sheet_peeks_pending';
const PENDING_PEEKS_MAX = 50;

interface PendingPeek {
  user: string;
  row: SheetPeekRow;
}

function readPendingPeeks(): PendingPeek[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PENDING_PEEKS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item): item is PendingPeek =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as PendingPeek).user === 'string' &&
        Boolean((item as PendingPeek).row) &&
        (item as PendingPeek).row.kind === 'sheet_peek' &&
        typeof (item as PendingPeek).row.client_event_id === 'string' &&
        typeof (item as PendingPeek).row.local_date === 'string',
    );
  } catch {
    return [];
  }
}

function writePendingPeeks(list: PendingPeek[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(PENDING_PEEKS_KEY);
    else localStorage.setItem(PENDING_PEEKS_KEY, JSON.stringify(list.slice(-PENDING_PEEKS_MAX)));
  } catch {
    // Storage full or blocked: the peek is only lost as before.
  }
}

async function sessionUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Sends the peeks of this account that could not be saved, oldest first (each keeps its own day and
 * id, so one sent twice is one row). Resolves to how many are still not saved. Called again when the
 * sheet opens, when the tab comes back, when the network does, and before an answer is saved — a peek
 * saved after the answer would not keep it from erasing the line.
 */
export async function flushSheetPeeks(): Promise<number> {
  const all = readPendingPeeks();
  if (all.length === 0) return 0;
  const user = await sessionUserId();
  // Signed out: nothing of an account to send (another account's peeks wait for it).
  if (!user) return 0;
  const left: PendingPeek[] = [];
  for (const item of all) {
    if (item.user !== user) {
      left.push(item);
      continue;
    }
    try {
      await saveSheetPeekRow(item.row);
    } catch {
      left.push(item);
    }
  }
  // Another flush may have queued more meanwhile: keep those too.
  const queued = readPendingPeeks().filter((item) => !all.some((seen) => seen.row.client_event_id === item.row.client_event_id));
  writePendingPeeks([...left, ...queued]);
  return left.filter((item) => item.user === user).length + queued.filter((item) => item.user === user).length;
}

/** Question hashes per request when filtering on the payload (a URL stays far below 8 KB). */
const HASHES_PER_PAYLOAD_REQUEST = 50;

/**
 * The cheat sheet's events for these questions: every `oral_point` and `sheet_peek` whose
 * payload.question_hash is one of them (whatever rubric they were written with — the sheet matches
 * the point by its words), oldest first, in chunks of 50 hashes, all pages.
 */
export async function fetchSheetEvents(questionHashes: string[]): Promise<LearningEvent[]> {
  const hashes = unique(
    questionHashes
      .map((hash) => (typeof hash === 'string' ? hash.trim().toLowerCase() : ''))
      .filter((hash) => QUESTION_HASH.test(hash)),
  );
  if (hashes.length === 0) return [];
  const parts = await Promise.all(
    chunks(hashes, HASHES_PER_PAYLOAD_REQUEST).map((part) =>
      readAllPages((from, to) =>
        supabase
          .from('learning_events')
          .select(EVENT_COLUMNS)
          .in('kind', ['oral_point', 'sheet_peek'])
          .in('payload->>question_hash', part)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ),
  );
  return chronological(parts.flat());
}

/**
 * The caller's answers aloud and self-ratings for these question hashes (item_key 'q:' + hash),
 * read in chunks of 100 hashes, oldest first. Row-level security limits rows to the signed-in user.
 */
export async function fetchQuestionEvents(
  questionHashes: string[],
  kinds: Array<'exam_answer' | 'self_rating'> = ['exam_answer', 'self_rating'],
): Promise<LearningEvent[]> {
  const keys = unique(
    questionHashes
      .map((hash) => (typeof hash === 'string' ? hash.trim().toLowerCase() : ''))
      .filter((hash) => QUESTION_HASH.test(hash)),
  ).map((hash) => `q:${hash}`);
  const wanted = unique(kinds);
  if (keys.length === 0 || wanted.length === 0) return [];

  const parts = await Promise.all(
    chunks(keys, KEYS_PER_REQUEST).map((part) =>
      readAllPages((from, to) =>
        supabase
          .from('learning_events')
          .select(EVENT_COLUMNS)
          .in('item_key', part)
          .in('kind', wanted)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ),
  );
  return chronological(parts.flat());
}

/**
 * The rubric points (kind 'oral_point') of these answer sessions (exam_sessions ids, written by
 * record_oral_attempt with the answer), read in chunks of 100 session ids, oldest first. Ids that
 * are not UUIDs are dropped; none left returns nothing without a request. Failures raise
 * LearningLoadError. Used by «Второй ответ после разбора» on the exam sheet.
 */
export async function fetchSessionPoints(sessionIds: string[]): Promise<LearningEvent[]> {
  const ids = unique(
    sessionIds.map((id) => (typeof id === 'string' ? id.trim().toLowerCase() : '')).filter((id) => UUID.test(id)),
  );
  if (ids.length === 0) return [];
  const parts = await Promise.all(
    chunks(ids, KEYS_PER_REQUEST).map((part) =>
      readAllPages((from, to) =>
        supabase
          .from('learning_events')
          .select(EVENT_COLUMNS)
          .eq('kind', 'oral_point')
          .in('session_id', part)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ),
  );
  return chronological(parts.flat());
}

/**
 * The caller's journal events of these kinds, optionally only for some materials (in chunks of
 * 100 ids; an empty list returns nothing) and only for the last `sinceDays` days. Oldest first.
 */
export async function fetchMaterialEvents(input: {
  materialIds?: string[];
  kinds: LearningKind[];
  sinceDays?: number;
}): Promise<LearningEvent[]> {
  const kinds = unique(input.kinds ?? []);
  if (kinds.length === 0) return [];
  let idChunks: Array<string[] | null> = [null];
  if (input.materialIds !== undefined) {
    const ids = unique(input.materialIds.filter((id) => typeof id === 'string' && UUID.test(id)));
    if (ids.length === 0) return [];
    idChunks = chunks(ids, KEYS_PER_REQUEST);
  }
  const since =
    typeof input.sinceDays === 'number' && Number.isFinite(input.sinceDays) && input.sinceDays > 0
      ? new Date(Date.now() - input.sinceDays * 86_400_000).toISOString()
      : null;

  const parts = await Promise.all(
    idChunks.map((ids) =>
      readAllPages((from, to) => {
        let query = supabase.from('learning_events').select(EVENT_COLUMNS).in('kind', kinds);
        if (ids) query = query.in('material_id', ids);
        if (since) query = query.gte('created_at', since);
        return query.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to);
      }),
    ),
  );
  return chronological(parts.flat());
}
