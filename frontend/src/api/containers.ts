/**
 * The exam container's data API (package D1; spec v2 §8, Concept 3 §4–5). Every RPC of `ContainerRpc`
 * (types/container.ts) through the app's Supabase client, the direct writes RLS allows (a container and its subjects
 * by their owner, an item's deletion, the user's own `container_plans` row), the keyset pages of `test_items`, and
 * the two backend calls (`POST /api/exams/parse-bank`, `POST /api/containers/{id}/oral-sync`) through the same
 * same-origin `/api/*` path as every other backend call (lib/apiAuth adds the session's token).
 *
 * Errors: every function throws `ContainerApiError` with a Russian `message` and a `code`:
 * - the SQLSTATEs of the container functions ('MC001'…'MC009', '42501', 'P0002', '22023', '28000');
 * - 'unavailable': the database has no container functions or tables yet (PGRST202 / 42883, PGRST205 / 42P01: an old
 *   migration). `fetchOverview` then resolves `null` instead, so the screens hide the container UI;
 * - 'network': no answer at all (offline, a dropped connection, our own timeout);
 * - 'unknown' (with `status` ≥ 500 for a server failure), and the backend's own codes (`{detail, code}`).
 * `status` is the HTTP status (0 when nothing came back); `detail` the server's detail (`item 7: options`).
 */
import { supabase } from '../lib/supabase';
import { localDateKey } from '../utils/streak';
import { httpErrorFromResponse } from './sseStream';
import { notifyAIUsageChanged } from './limits';
import {
  TEST_ITEM_COLUMNS,
  type AnswerInput, type AnswerResult, type BankParseResult, type ContainerCreated, type ContainerKind, type ContainerRpc,
  type ContainerSettings, type ContainerSummary, type ContainersOverview, type CreateSubjectInput, type DayKey,
  type DoubtRow, type ItemImages, type ItemInput, type ItemPatch, type ItemUpdated, type ItemsAdded, type LinkCreated, type LinkPreview,
  type MemberRow, type MockRunInput, type MockRunResult, type OralSyncResponse, type PlanInputsWire,
  type RecordAnswersResponse, type TestItem, type Uuid,
} from '../types/container';
import type { ExamMoveFor, ExamMoved, ExamRemind, TelegramExam, TelegramExamState } from '../types/container';

/** Russian text of every error code (spec §3 words: «экзамен», never «контейнер» or «тест»). */
export const CONTAINER_ERROR_TEXT = {
  // Not «скопировали»: the join page never says «копи…» (spec §16 decision 45), and MC001 is shown there.
  MC001: 'Ссылка не найдена — проверьте, что вставили её целиком.',
  MC002: 'Автор закрыл эту ссылку.',
  MC003: 'Срок ссылки истёк — попросите у автора новую.',
  MC004: 'Места по этой ссылке закончились — попросите у автора новую.',
  MC005: 'Это ваша ссылка — по ней приходят участники.',
  MC006: 'Автор убрал вас из этого экзамена.',
  MC007: 'Слишком много: в экзамене до 20 предметов и 2000 вопросов.',
  MC008: 'Чтобы поделиться устными предметами, отметьте согласие.',
  MC009: 'Сначала уберите участников — потом экзамен можно удалить.',
  '42501': 'Это может сделать только автор экзамена.',
  P0002: 'Не нашли — возможно, его уже удалили.',
  '22023': 'Что-то не так с данными — обновите страницу и попробуйте снова.',
  '28000': 'Сессия истекла. Войдите снова.',
  network: 'Нет сети — попробуем ещё раз, когда она появится.',
  unavailable: 'Экзамены пока недоступны на сервере.',
  unknown: 'Не получилось. Попробуйте ещё раз.',
} as const;

/** MC007 is also «at most 10 open links» (container_link_create): the general text would name subjects there. */
export const LINKS_LIMIT_TEXT = 'Открыто уже 10 ссылок — закройте старую, чтобы сделать новую.';
/** 22023 «nothing to share yet» (container_link_create): no question has a key and no subject is oral. */
export const NOTHING_TO_SHARE_TEXT = 'Пока нечем делиться: ни у одного вопроса нет ответа из файла.';

export class ContainerApiError extends Error {
  /** SQLSTATE or our code: 'MC001'…'MC009', '42501', 'P0002', '22023', '28000', 'unavailable', 'network', 'unknown'. */
  readonly code: string;
  /** The HTTP status; 0 when no answer came; null when the call was never made. */
  readonly status: number | null;
  /** The server's detail, when it named one (container_items_add: «item 7: options»). */
  readonly detail: string | null;
  constructor(code: string, message: string, options: { status?: number | null; detail?: string | null } = {}) {
    super(message);
    this.name = 'ContainerApiError';
    this.code = code;
    this.status = options.status ?? null;
    this.detail = options.detail ?? null;
  }
}

/** True when the database has no container functions yet (the UI then shows exactly today's screens). */
export function isContainersUnavailable(error: unknown): boolean {
  return error instanceof ContainerApiError && error.code === 'unavailable';
}
/** True when the request failed for lack of network (the UI then draws from the device's cache). */
export function isOffline(error: unknown): boolean {
  return error instanceof ContainerApiError && error.code === 'network';
}
/**
 * True when the exam is not the caller's (P0002): the author deleted it, the member left, or the author removed them.
 * Another try changes nothing. Its page reads answer null for it (HTTP 200: `fetchSummary`, `fetchPlanInputs`); other
 * calls raise P0002, which PostgREST answers with HTTP 500.
 */
export function isGone(error: unknown): boolean {
  return error instanceof ContainerApiError && error.code === 'P0002';
}
/** Russian text for any error of this module (anything else: the general line, never an English message). */
export function containerErrorText(error: unknown): string {
  return error instanceof ContainerApiError && error.message ? error.message : CONTAINER_ERROR_TEXT.unknown;
}

// ── Error mapping ──────────────────────────────────────────────────────────────────────────

const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);
const CONTAINER_CODES: ReadonlySet<string> = new Set([
  'MC001', 'MC002', 'MC003', 'MC004', 'MC005', 'MC006', 'MC007', 'MC008', 'MC009', '42501', 'P0002', '22023',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(error: unknown, name: 'code' | 'message' | 'details'): string {
  const value = isRecord(error) ? error[name] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function textOf(code: string, message: string): string {
  if (code === 'MC007' && /\blinks?\b/i.test(message)) return LINKS_LIMIT_TEXT;
  if (code === '22023' && /nothing to share/i.test(message)) return NOTHING_TO_SHARE_TEXT;
  return (CONTAINER_ERROR_TEXT as Record<string, string>)[code] ?? CONTAINER_ERROR_TEXT.unknown;
}

function make(code: string, status: number | null, message = '', detail: string | null = null): ContainerApiError {
  return new ContainerApiError(code, textOf(code, message), { status, detail });
}

/** A PostgREST error object (with the response's status: 0 when the request never got an answer). */
export function containerError(error: unknown, status = 0): ContainerApiError {
  if (error instanceof ContainerApiError) return error;
  const code = field(error, 'code');
  const message = field(error, 'message');
  const detail = field(error, 'details') || null;
  if (UNAVAILABLE_CODES.has(code)) return make('unavailable', status);
  // A request without a session: PostgREST answers 401 (an anonymous 42501 too: live, containers_overview as anon).
  if (status === 401 || code === '28000' || /^PGRST30\d$/.test(code)) return make('28000', status);
  // The body's code decides, never the status: P0002 comes as 500 (PostgREST maps every P0 SQLSTATE but P0001 to 500).
  if (CONTAINER_CODES.has(code)) return make(code, status, message, detail);
  // Check, not-null and format violations of a direct write; a malformed id (22P02).
  if (/^(22|23)/.test(code)) return make('22023', status, message, detail);
  if (!code && status === 0) return make('network', 0);
  return make('unknown', status, message, detail);
}

/** Something threw instead of answering: a failed fetch (TypeError) or an abort is the network; anything else is not. */
function thrownError(error: unknown): ContainerApiError {
  if (error instanceof ContainerApiError) return error;
  const name = error instanceof Error ? error.name : isRecord(error) ? String(error.name ?? '') : '';
  if (name === 'TypeError' || name === 'AbortError') return make('network', 0);
  return make('unknown', null);
}

function badShape(what: string): ContainerApiError {
  return new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { detail: `bad shape: ${what}` });
}

// ── Calls ──────────────────────────────────────────────────────────────────────────────────

type Rpc = ContainerRpc;
type DbResult = { data: unknown; error: unknown; status?: number };

/** One RPC by name; its error becomes a ContainerApiError. The data is narrowed by the caller. */
async function call<K extends keyof Rpc>(name: K, args: Rpc[K]['args'], signal?: AbortSignal): Promise<unknown> {
  let result: DbResult;
  try {
    const query = supabase.rpc(name, args as Record<string, unknown>);
    result = await (signal ? query.abortSignal(signal) : query);
  } catch (error) {
    throw thrownError(error);
  }
  if (result.error) throw containerError(result.error, typeof result.status === 'number' ? result.status : 0);
  return result.data;
}

/** A direct table read or write under RLS. */
async function run(query: PromiseLike<DbResult>): Promise<unknown> {
  let result: DbResult;
  try {
    result = await query;
  } catch (error) {
    throw thrownError(error);
  }
  if (result.error) throw containerError(result.error, typeof result.status === 'number' ? result.status : 0);
  return result.data;
}

const today = (): DayKey => localDateKey();

// ── Normalisers (the SQL is ours and typed; a proxy, an old build or an empty body is not) ──

function list<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function strings(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === 'string');
}

function int(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeOverview(raw: unknown): ContainersOverview {
  if (!isRecord(raw) || !Array.isArray(raw.containers)) throw badShape('containers_overview');
  const containers = raw.containers
    .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === 'string')
    .map((item) => ({ ...item, subjects: list(item.subjects).filter(isRecord) }));
  return {
    ...(raw as object),
    v: 1,
    day: typeof raw.day === 'string' ? raw.day : today(),
    containers,
    attached_exam_ids: strings(raw.attached_exam_ids),
  } as unknown as ContainersOverview;
}

function normalizeSummary(raw: unknown): ContainerSummary {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.subjects)) throw badShape('container_summary');
  const version = isRecord(raw.items_version) ? raw.items_version : {};
  return {
    ...(raw as object),
    subjects: raw.subjects.filter(isRecord).map((subject) => ({
      ...subject,
      topic_titles: strings(subject.topic_titles),
      topics: list(subject.topics).filter(isRecord),
    })),
    items_version: { count: int(version.count), updated_at: typeof version.updated_at === 'string' ? version.updated_at : null },
    mock_runs: list(raw.mock_runs).filter(isRecord),
  } as unknown as ContainerSummary;
}

function normalizePlanInputs(raw: unknown): PlanInputsWire {
  if (!isRecord(raw) || !Array.isArray(raw.containers) || !Array.isArray(raw.subjects) || !Array.isArray(raw.items)) {
    throw badShape('plan_inputs');
  }
  return {
    ...(raw as object),
    v: 1,
    states: list(raw.states).filter(Array.isArray),
    doubted: list(raw.doubted),
    pace: list(raw.pace).filter(isRecord),
    ai: isRecord(raw.ai) ? raw.ai : null,
  } as unknown as PlanInputsWire;
}

const KINDS: ReadonlySet<string> = new Set(['single', 'multiple', 'short']);

/** One test_items row; null when it is not one. */
export function normalizeItem(raw: unknown): TestItem | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.subject_id !== 'string') return null;
  const position = int(raw.position, -1);
  if (position < 1) return null;
  const topic = raw.topic === null || raw.topic === undefined ? null : int(raw.topic, 0) || null;
  return {
    id: raw.id,
    container_id: typeof raw.container_id === 'string' ? raw.container_id : '',
    subject_id: raw.subject_id,
    position,
    file_no: typeof raw.file_no === 'string' ? raw.file_no : raw.file_no === null || raw.file_no === undefined ? '' : String(raw.file_no),
    topic,
    kind: typeof raw.kind === 'string' && KINDS.has(raw.kind) ? (raw.kind as TestItem['kind']) : 'single',
    stem: typeof raw.stem === 'string' ? raw.stem : '',
    options: strings(raw.options),
    correct: list(raw.correct).map((value) => int(value, -1)).filter((value) => value >= 0),
    answers: strings(raw.answers),
    key_source: (typeof raw.key_source === 'string' ? raw.key_source : 'none') as TestItem['key_source'],
    code: raw.code === true,
    keep_order: raw.keep_order === true,
    flags: strings(raw.flags),
    rev: Math.max(1, int(raw.rev, 1)),
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '',
    images: itemImages(raw.images),
    explanation: typeof raw.explanation === 'string' ? raw.explanation : '',
  };
}

/** test_items.images ({} — none) → ItemImages, or null when it names no picture. */
export function itemImages(raw: unknown): ItemImages | null {
  if (!isRecord(raw)) return null;
  const stem = strings(raw.stem).filter(Boolean);
  const options = list(raw.options).map((entry) => strings(entry).filter(Boolean));
  return stem.length > 0 || options.some((entry) => entry.length > 0) ? { stem, options } : null;
}

function normalizeRecord(raw: unknown): RecordAnswersResponse {
  if (!isRecord(raw) || !Array.isArray(raw.results)) throw badShape('record_test_answers');
  return {
    v: 1,
    server_day: typeof raw.server_day === 'string' ? raw.server_day : today(),
    results: raw.results.map((item) => (isRecord(item) ? item : { client_event_id: null, status: 'invalid' })) as unknown as AnswerResult[],
  };
}

function normalizeMock(raw: unknown): MockRunResult {
  if (!isRecord(raw) || typeof raw.run_id !== 'string') throw badShape('container_mock_finish');
  const result: MockRunResult = {
    run_id: raw.run_id,
    items: int(raw.items),
    correct: int(raw.correct),
    unanswered: int(raw.unanswered),
    duplicate: raw.duplicate === true,
  };
  if (Array.isArray(raw.results)) result.results = raw.results.filter(isRecord) as unknown as AnswerResult[];
  return result;
}

function record<T>(raw: unknown, what: string, key: string): T {
  if (!isRecord(raw) || !(key in raw)) throw badShape(what);
  return raw as T;
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────

/** containers_overview for the device's local day; `null` when the database has no container functions. */
export async function fetchOverview(localDate?: DayKey): Promise<ContainersOverview | null> {
  try {
    return normalizeOverview(await call('containers_overview', { p_local_date: localDate ?? today() }));
  } catch (error) {
    if (isContainersUnavailable(error)) return null;
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An exam that is not the caller's, as its page's two reads answer it: null with HTTP 200 (20261011100000; before it,
 * P0002 with HTTP 500, which `containerError` reads the same way). `isGone` is true for both. An address that cannot
 * be an exam's (a cut link) is the same, without a request (`status` null).
 */
const notTheirs = (status: number | null = 200): ContainerApiError => make('P0002', status);

export async function fetchSummary(containerId: Uuid, localDate?: DayKey): Promise<ContainerSummary> {
  if (!UUID.test(containerId)) throw notTheirs(null);
  const raw = await call('container_summary', { p_container_id: containerId, p_local_date: localDate ?? today() });
  if (raw === null) throw notTheirs();
  return normalizeSummary(raw);
}

/** plan_inputs for every container of the user (Сегодня, the bot) or for one (`containerId`). */
export async function fetchPlanInputs(localDate?: DayKey, containerId?: Uuid): Promise<PlanInputsWire> {
  if (containerId && !UUID.test(containerId)) throw notTheirs(null);
  const args: Rpc['plan_inputs']['args'] = { p_local_date: localDate ?? today() };
  if (containerId) args.p_container_id = containerId;
  const raw = await call('plan_inputs', args);
  if (raw === null && containerId) throw notTheirs();
  return normalizePlanInputs(raw);
}

/** Items per keyset page: under PostgREST's 1000-row cap, about 450 KB of synthetic text. */
export const ITEMS_PAGE_SIZE = 500;
/** Subjects read at the same time by fetchAllItems. */
const SUBJECTS_IN_FLIGHT = 3;

/** One keyset page (≤ 500) of a subject's items, ordered by position, after `afterPosition`. */
export async function fetchItemsPage(subjectId: Uuid, afterPosition = 0): Promise<TestItem[]> {
  const rows = await run(
    supabase
      .from('test_items')
      .select(TEST_ITEM_COLUMNS)
      .eq('subject_id', subjectId)
      .gt('position', afterPosition)
      .order('position', { ascending: true })
      .limit(ITEMS_PAGE_SIZE),
  );
  return list(rows)
    .map(normalizeItem)
    .filter((item): item is TestItem => item !== null);
}

async function subjectItems(subjectId: Uuid): Promise<TestItem[]> {
  const items = new Map<string, TestItem>();
  let after = 0;
  for (;;) {
    const page = await fetchItemsPage(subjectId, after);
    for (const item of page) if (!items.has(item.id)) items.set(item.id, item);
    if (page.length < ITEMS_PAGE_SIZE) break;
    const last = page[page.length - 1].position;
    // Positions only grow along the keyset; a page that does not move on would read forever.
    if (last <= after) break;
    after = last;
  }
  return [...items.values()];
}

/** Every item of the given subjects, in their order and by position (paged under the hood). */
export async function fetchAllItems(subjectIds: Uuid[]): Promise<TestItem[]> {
  const ids = [...new Set(subjectIds.filter((id) => typeof id === 'string' && id !== ''))];
  const parts: TestItem[][] = new Array(ids.length);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const index = next;
      next += 1;
      parts[index] = await subjectItems(ids[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SUBJECTS_IN_FLIGHT, ids.length) }, worker));
  return parts.flat();
}

export async function fetchAnswerDays(since: DayKey): Promise<Array<{ local_date: DayKey; answers: number }>> {
  const rows = await call('test_answer_days', { p_since: since });
  return list(rows)
    .filter(isRecord)
    .filter((row) => typeof row.local_date === 'string')
    .map((row) => ({ local_date: row.local_date as DayKey, answers: int(row.answers) }));
}

// ── Answers ────────────────────────────────────────────────────────────────────────────────

/** record_test_answers takes 1..50 answers per call. */
export const ANSWERS_PER_CALL = 50;

/** Records answers (in calls of ≤ 50, in order); each element comes back with its status. */
export async function recordAnswers(answers: AnswerInput[], options: { signal?: AbortSignal } = {}): Promise<RecordAnswersResponse> {
  const results: AnswerResult[] = [];
  let serverDay = today();
  for (let start = 0; start < answers.length; start += ANSWERS_PER_CALL) {
    const response = normalizeRecord(
      await call('record_test_answers', { p_answers: answers.slice(start, start + ANSWERS_PER_CALL) }, options.signal),
    );
    results.push(...response.results);
    serverDay = response.server_day;
  }
  return { v: 1, server_day: serverDay, results };
}

/** container_mock_finish: the whole «Как на экзамене» run; resending the same client_run_id is a no-op. */
export async function finishMock(run: MockRunInput, options: { signal?: AbortSignal } = {}): Promise<MockRunResult> {
  return normalizeMock(await call('container_mock_finish', { p_run: run }, options.signal));
}

// ── Writing ────────────────────────────────────────────────────────────────────────────────

export async function createContainer(title: string, examDate: DayKey | null, subjects: CreateSubjectInput[]): Promise<ContainerCreated> {
  const raw = await call('container_create', { p_title: title, p_exam_date: examDate, p_subjects: subjects });
  const created = record<ContainerCreated>(raw, 'container_create', 'container_id');
  return { container_id: created.container_id, subjects: list(created.subjects) };
}

export async function addSubject(containerId: Uuid, subject: CreateSubjectInput): Promise<{ id: Uuid; position: number; title: string }> {
  return record(await call('container_subject_add', { p_container_id: containerId, p_subject: subject }), 'container_subject_add', 'id');
}

/** Items per container_items_add call: the RPC takes up to 300; 250 stays far under the request-body limit. */
export const ITEMS_PER_CALL = 250;

/** Adds items in batches of ≤ 250 (refs make a resent batch a no-op); `onProgress(done, total)` after each batch. */
export async function addItems(subjectId: Uuid, items: ItemInput[], onProgress?: (done: number, total: number) => void): Promise<ItemsAdded[]> {
  const added: ItemsAdded[] = [];
  for (let start = 0; start < items.length; start += ITEMS_PER_CALL) {
    const batch = items.slice(start, start + ITEMS_PER_CALL);
    const raw = record<ItemsAdded>(await call('container_items_add', { p_subject_id: subjectId, p_items: batch }), 'container_items_add', 'added');
    added.push({ subject_id: raw.subject_id, added: int(raw.added), in_container: int(raw.in_container), items: list(raw.items) });
    onProgress?.(start + batch.length, items.length);
  }
  return added;
}

export async function updateItem(itemId: Uuid, patch: ItemPatch): Promise<ItemUpdated> {
  return record(await call('container_item_update', { p_item_id: itemId, p_patch: patch }), 'container_item_update', 'rev');
}

/** The constructor's «вверх / вниз»: every question of the subject, in the new order (positions become 1..n). */
export async function reorderItems(subjectId: Uuid, itemIds: Uuid[]): Promise<void> {
  await call('container_items_reorder', { p_subject_id: subjectId, p_item_ids: itemIds });
}

type OwnTable = 'containers' | 'container_subjects' | 'test_items';

/** A write that touched no row: the row is gone (P0002), or it is there and not the caller's to change (42501). */
async function noRow(table: OwnTable, id: Uuid): Promise<ContainerApiError> {
  try {
    const rows = await run(supabase.from(table).select('id').eq('id', id).limit(1));
    if (list(rows).length > 0) return make('42501', null);
  } catch {
    // Unreadable: say it is gone.
  }
  return make('P0002', null);
}

async function deleteRow(table: OwnTable, id: Uuid): Promise<void> {
  const rows = await run(supabase.from(table).delete().eq('id', id).select('id'));
  if (list(rows).length === 0) throw await noRow(table, id);
}

/** The owner deletes one item (states, doubts and key changes go with it; the answer log keeps its rows). */
export async function deleteItem(itemId: Uuid): Promise<void> {
  await deleteRow('test_items', itemId);
}

/**
 * The owner's title, common date or kind (direct write, RLS «Containers: update own»; a member's or a stranger's write
 * touches no row: 42501 / P0002). `kind` needs 20261019090000; before it the column is unknown (an error, 'unknown').
 */
export async function updateContainer(
  containerId: Uuid,
  patch: { title?: string; exam_date?: DayKey | null; kind?: ContainerKind },
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.title !== undefined) values.title = patch.title.trim();
  if (patch.exam_date !== undefined) values.exam_date = patch.exam_date;
  if (patch.kind !== undefined) values.kind = patch.kind;
  if (Object.keys(values).length === 0) return;
  const rows = await run(supabase.from('containers').update(values).eq('id', containerId).select('id'));
  if (list(rows).length === 0) throw await noRow('containers', containerId);
}

/** «Это тест» / «Это экзамен» (release 47.3): the author's own choice, saved at once; «Новый тест» sets 'test'. */
export async function setContainerKind(containerId: Uuid, kind: ContainerKind): Promise<void> {
  await updateContainer(containerId, { kind });
}

/**
 * The owner's subject: title, date of the test part, position (direct write, RLS «Container subjects: update own»; the
 * guard trigger keeps it in its container). A subject with an oral part: a new date is written to that exam too
 * (Concept 3 §2.5: the exam row stays the only owner of an oral date, through its own RLS path). Clearing the date
 * (null: the test part takes the exam's common date) leaves the oral exam's date as it is.
 */
export async function updateSubject(subjectId: Uuid, patch: { title?: string; exam_date?: DayKey | null; position?: number }): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.title !== undefined) values.title = patch.title.trim();
  if (patch.exam_date !== undefined) values.exam_date = patch.exam_date;
  if (patch.position !== undefined) values.position = patch.position;
  if (Object.keys(values).length === 0) return;
  const rows = list(await run(supabase.from('container_subjects').update(values).eq('id', subjectId).select('id, exam_id')));
  if (rows.length === 0) throw await noRow('container_subjects', subjectId);
  const oralExamId = isRecord(rows[0]) && typeof rows[0].exam_id === 'string' ? rows[0].exam_id : null;
  if (oralExamId && typeof patch.exam_date === 'string') {
    await run(supabase.from('exams').update({ exam_date: patch.exam_date }).eq('id', oralExamId).select('id'));
  }
}

/** The owner deletes a subject: its items go with it; its oral exam stays an ordinary exam. */
export async function deleteSubject(subjectId: Uuid): Promise<void> {
  await deleteRow('container_subjects', subjectId);
}

/**
 * The owner deletes the exam; with members still in it the database refuses (MC009). Its pictures (quiz covers, the
 * studio's page pictures, question pictures) leave storage after it, on the server: the delete queues the container's
 * folders in its own transaction and the Telegram bot's minute tick removes them through the Storage API (migration
 * 20261103090200_picture_sweep.sql, supabase/functions/_shared/bot/sweep.ts). The page used to remove them itself right
 * before the delete (live check of 47.4): that could be skipped, and when the database then refused the delete, or the
 * network failed, the exam stayed without its pictures.
 */
export async function deleteContainer(containerId: Uuid): Promise<void> {
  await deleteRow('containers', containerId);
}

/** The user's own minutes a day and days of the week (upsert of their `container_plans` row). */
export async function saveSettings(containerId: Uuid, settings: ContainerSettings): Promise<void> {
  await run(
    supabase
      .from('container_plans')
      .upsert(
        {
          container_id: containerId,
          minutes_per_day: settings.minutes_per_day,
          study_weekdays: settings.study_weekdays,
          ...(settings.tempo ? { tempo: settings.tempo } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,container_id' },
      )
      .select('container_id'),
  );
}

// ── Keys ───────────────────────────────────────────────────────────────────────────────────

/** «Сомневаюсь в ключе» / «Ключ неверный?»: the item leaves this user's plan until withdrawn or decided. */
export async function doubtKey(itemId: Uuid, proposed: number[] = [], note = ''): Promise<void> {
  await call('test_key_doubt', { p_item_id: itemId, p_proposed: proposed, p_note: note });
}

export async function withdrawDoubt(itemId: Uuid): Promise<void> {
  await call('test_key_doubt_withdraw', { p_item_id: itemId });
}

/** The author's list: items with open doubts and the «most chose the same wrong option» signal; no names. */
export async function fetchDoubts(containerId: Uuid): Promise<DoubtRow[]> {
  return list(await call('container_doubts', { p_container_id: containerId })).filter(isRecord) as unknown as DoubtRow[];
}

/** «Ключ верный»: the open doubts of the item are resolved as kept; resolves with how many. */
export async function keepKey(itemId: Uuid): Promise<number> {
  const raw = record<{ resolved: unknown }>(await call('container_doubt_keep', { p_item_id: itemId }), 'container_doubt_keep', 'resolved');
  return int(raw.resolved);
}

// ── Group ──────────────────────────────────────────────────────────────────────────────────

const CODE = /^[0-9a-hjkmnp-tv-z]{12}$/;

/** A link code as it may be pasted: without spaces and dashes, lower case (backend exam_shares.normalize_code). */
export function normalizeCode(raw: string): string {
  return String(raw ?? '').replace(/[\s-]+/g, '').toLowerCase();
}

export async function createLink(containerId: Uuid, maxMembers?: number, consent?: string | null): Promise<LinkCreated> {
  const args: Rpc['container_link_create']['args'] = { p_container_id: containerId, p_consent: consent ?? null };
  if (maxMembers !== undefined) args.p_max_members = maxMembers;
  return record(await call('container_link_create', args), 'container_link_create', 'code');
}

export async function revokeLink(linkId: Uuid): Promise<void> {
  await call('container_link_revoke', { p_link_id: linkId });
}

const PREVIEW_STATUSES: ReadonlySet<string> = new Set(['active', 'own', 'joined', 'removed', 'revoked', 'expired', 'full', 'not_found']);

/** Works signed out (anon). A code that cannot be one is not_found without a request. */
export async function previewLink(code: string): Promise<LinkPreview> {
  const clean = normalizeCode(code);
  if (!CODE.test(clean)) return { status: 'not_found' };
  const raw = await call('container_link_preview', { p_code: clean });
  if (!isRecord(raw)) throw badShape('container_link_preview');
  const status = typeof raw.status === 'string' && PREVIEW_STATUSES.has(raw.status) ? raw.status : 'not_found';
  return { ...(raw as object), status, subjects: list(raw.subjects).filter(isRecord) } as LinkPreview;
}

export async function joinByCode(code: string): Promise<{ container_id: Uuid; joined: boolean; oral_subjects?: number }> {
  const clean = normalizeCode(code);
  if (!CODE.test(clean)) throw make('MC001', null);
  return record(await call('container_join', { p_code: clean }), 'container_join', 'container_id');
}

export async function leaveContainer(containerId: Uuid): Promise<void> {
  await call('container_leave', { p_container_id: containerId });
}

export async function fetchMembers(containerId: Uuid): Promise<MemberRow[]> {
  return list(await call('container_members_list', { p_container_id: containerId })).filter(isRecord) as unknown as MemberRow[];
}

/** `userId` null removes (or with `restore`, restores) everyone; resolves with how many changed. */
export async function removeMember(containerId: Uuid, userId: Uuid | null, restore = false): Promise<number> {
  const raw = record<{ removed: unknown }>(
    await call('container_member_remove', { p_container_id: containerId, p_user_id: userId, p_restore: restore }),
    'container_member_remove',
    'removed',
  );
  return int(raw.removed);
}

// ── Backend calls (same origin; lib/apiAuth adds the session's token to every /api/* request) ──

/** Codes of this module that a backend's `{detail, code}` must not take over. */
const RESERVED_CODES: ReadonlySet<string> = new Set(['unavailable', 'network', 'unknown', 'aborted', '28000']);

/**
 * A failed backend answer: the server's Russian `detail` and its `code` (parse-bank: `no_items`, `old_doc`…; oral-sync:
 * `not_found`, `forbidden`…), else the app's usual words for the status (429 of the rate limiter, a 5xx).
 */
async function backendError(response: Response): Promise<ContainerApiError> {
  const status = response.status;
  let body: unknown = null;
  try {
    body = JSON.parse(await response.clone().text());
  } catch {
    body = null;
  }
  const raw = isRecord(body) && typeof body.code === 'string' && body.code.trim() ? body.code.trim().slice(0, 64) : null;
  // The backend's own codes never pass for this module's: oral-sync answers 503 `unavailable` when it cannot reach the
  // database, which is not «the database has no container functions» (isContainersUnavailable).
  const code = raw && RESERVED_CODES.has(raw) ? `server_${raw}` : raw;
  const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail.trim() : '';
  if (status === 401) return new ContainerApiError('28000', CONTAINER_ERROR_TEXT['28000'], { status, detail: detail || null });
  if (detail && status < 500) return new ContainerApiError(code ?? `http_${status}`, detail, { status, detail });
  // A server failure (5xx) is said in the app's own words (api/sseStream: never the text of a 5xx); its code stays.
  const fallback = await httpErrorFromResponse(response);
  return new ContainerApiError(status >= 500 ? 'unknown' : code ?? `http_${status}`, fallback.message, { status, detail: code });
}

async function backend(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError' && init.signal?.aborted) {
      throw new ContainerApiError('aborted', 'Запрос остановлен.', { status: 0 });
    }
    throw make('network', 0);
  }
  if (!response.ok) throw await backendError(response);
  try {
    return await response.json();
  } catch {
    throw new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { status: response.status, detail: 'bad json' });
  }
}

/** POST /api/containers/{id}/oral-sync: the member's oral copies through the oral path (package C). */
export async function oralSync(containerId: Uuid): Promise<OralSyncResponse> {
  const raw = await backend(`/api/containers/${encodeURIComponent(containerId)}/oral-sync`, { method: 'POST' });
  if (!isRecord(raw)) throw badShape('oral-sync');
  return { container_id: typeof raw.container_id === 'string' ? raw.container_id : containerId, oral: list(raw.oral).filter(isRecord) } as OralSyncResponse;
}

// import
export interface ParseBankInput {
  file?: File;
  text?: string;
  keyMode?: 'auto' | 'first_option' | 'none';
  keyText?: string;
  /** The key kept in another file (owner, 2026-10-14): the importer takes the section of the test's variant. */
  keyFile?: File;
  /** The section of the key file the student chose (its index in `key_file.sections`). */
  keySection?: number | null;
  format?: 'auto' | 'test' | 'open';
  /** Stops the upload (the import page's «Отмена»): the call then throws ContainerApiError 'aborted'. */
  signal?: AbortSignal;
}

/**
 * POST /api/exams/parse-bank as multipart form data (the browser sets the boundary; never urlencoded): `file` or `text`,
 * and `key_mode`, `key_text`, `key_file` (with `key_section`), `format` when given. Throws ContainerApiError with the server's Russian `detail` and `code`.
 */
export async function parseBank(input: ParseBankInput): Promise<BankParseResult> {
  return bankResult(await backend('/api/exams/parse-bank', { method: 'POST', body: bankForm(input), signal: input.signal }), 'parse-bank');
}

/**
 * POST /api/tests/paste (backend/paste_api.py): «Быстрая контрольная»'s pasted text, read by the same rules in their
 * hand mode (one «*» is a key). Text without questions is an answer with no items, not an error.
 */
export async function parsePaste(text: string, signal?: AbortSignal): Promise<BankParseResult> {
  const raw = await backend('/api/tests/paste', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
  return bankResult(raw, 'tests/paste');
}

/**
 * POST /api/exams/parse-bank/ai: the same form, read again with the model on the doubtful places only (scope 'flagged')
 * or the whole file ('all'). Spends units (the answer's ai.units); 429 ai_busy, 502 ai_failed, 422 no_doubts.
 * The server charges before the model, so after its answer — the parse or an error — the top bar's AI limit is read
 * again (notifyAIUsageChanged, as after every AI action); a request that never reached it spent nothing.
 */
export async function parseBankAi(input: ParseBankInput & { scope?: 'flagged' | 'all' }): Promise<BankParseResult> {
  const form = bankForm(input);
  if (input.scope) form.append('scope', input.scope);
  let raw: unknown;
  try {
    raw = await backend('/api/exams/parse-bank/ai', { method: 'POST', body: form, signal: input.signal });
  } catch (error) {
    if (error instanceof ContainerApiError && (error.status ?? 0) > 0) notifyAIUsageChanged();
    throw error;
  }
  notifyAIUsageChanged();
  return bankResult(raw, 'parse-bank/ai');
}

function bankForm(input: ParseBankInput): FormData {
  const form = new FormData();
  if (input.file) form.append('file', input.file, input.file.name);
  else form.append('text', input.text ?? '');
  if (input.keyMode) form.append('key_mode', input.keyMode);
  if (input.keyText) form.append('key_text', input.keyText);
  if (input.keyFile) form.append('key_file', input.keyFile, input.keyFile.name);
  if (input.keyFile && typeof input.keySection === 'number') form.append('key_section', String(input.keySection));
  if (input.format) form.append('format', input.format);
  // The page saves the pictures of a DOCX (saveImport.ts); without this the importer only flags them (has_image).
  if (input.file) form.append('pictures', '1');
  return form;
}

function bankResult(raw: unknown, what: string): BankParseResult {
  if (!isRecord(raw) || !Array.isArray(raw.items) || !Array.isArray(raw.subjects)) throw badShape(what);
  return {
    ...(raw as object),
    topics: list(raw.topics),
    skipped: strings(raw.skipped),
    warnings: list(raw.warnings).filter(isRecord),
    pictures: isRecord(raw.pictures) ? (raw.pictures as BankParseResult['pictures']) : {},
    source_lines: list(raw.source_lines).filter(isRecord) as unknown as BankParseResult['source_lines'],
  } as BankParseResult;
}

// ── «Перенести экзамен» and the Telegram plan per exam (20261018120000) ──────────────────────

/** 22023 of a move: the date is before today or more than two years ahead (exam_date_move checks 0..730 days). */
export const MOVE_DATE_TEXT = 'Нужна дата не раньше сегодняшней и не дальше чем через два года.';

const DAY_KEY = /^(\d{4}-\d{2}-\d{2})/;

function dayKey(value: unknown): DayKey | null {
  const match = typeof value === 'string' ? DAY_KEY.exec(value) : null;
  return match ? match[1] : null;
}

/**
 * Moves an exam's date (exam_date_move). `forWhom` 'all' is the author's: with `subjectId` that subject's date (and its
 * oral exam's, as `updateSubject` writes it), without it the exam's date and every subject date already passed. 'me' is
 * the caller's own date of the whole exam (the author's and the others' stay); `date` null clears it.
 */
export async function moveExamDate(containerId: Uuid, date: DayKey | null, forWhom: ExamMoveFor, subjectId?: Uuid | null): Promise<ExamMoved> {
  let raw: unknown;
  try {
    raw = await call('exam_date_move', { p_container_id: containerId, p_date: date, p_for: forWhom, p_subject_id: subjectId ?? null });
  } catch (error) {
    if (error instanceof ContainerApiError && error.code === '22023') {
      throw new ContainerApiError('22023', MOVE_DATE_TEXT, { status: error.status, detail: error.detail });
    }
    throw error;
  }
  if (!isRecord(raw)) throw badShape('exam_date_move');
  return {
    for: raw.for === 'me' ? 'me' : raw.for === 'all' ? 'all' : forWhom,
    container_id: typeof raw.container_id === 'string' ? raw.container_id : containerId,
    exam_date: dayKey(raw.exam_date),
    own_exam_date: dayKey(raw.own_exam_date),
    subjects: list(raw.subjects)
      .filter(isRecord)
      .filter((subject) => typeof subject.id === 'string')
      .map((subject) => ({ id: subject.id as Uuid, exam_date: dayKey(subject.exam_date) })),
  };
}

/** Whether the bot's day plan counts this exam (exam_remind_set; the author or an active member). */
export async function setExamRemind(containerId: Uuid, on: boolean): Promise<ExamRemind> {
  const raw = await call('exam_remind_set', { p_container_id: containerId, p_on: on });
  if (!isRecord(raw)) throw badShape('exam_remind_set');
  return { container_id: typeof raw.container_id === 'string' ? raw.container_id : containerId, tg_remind: raw.tg_remind !== false };
}

const EXAM_STATES: ReadonlySet<string> = new Set(['study', 'exam_today', 'after', 'no_date']);

/**
 * The caller's exams for the bot's day plan (telegram_exams), nearest first, each with its switch; `null` when the
 * database has no such function yet (the profile then says the one exam line, as before).
 */
export async function telegramExams(): Promise<TelegramExam[] | null> {
  let raw: unknown;
  try {
    raw = await call('telegram_exams', {});
  } catch (error) {
    if (isContainersUnavailable(error)) return null;
    throw error;
  }
  return list(raw)
    .filter(isRecord)
    .filter((exam) => typeof exam.container_id === 'string' && exam.container_id !== '')
    .map((exam) => {
      const date = dayKey(exam.exam_date);
      const state = typeof exam.state === 'string' && EXAM_STATES.has(exam.state) ? (exam.state as TelegramExamState) : date ? 'study' : 'no_date';
      return {
        container_id: exam.container_id as Uuid,
        title: typeof exam.title === 'string' && exam.title.trim() ? exam.title.trim() : 'Экзамен',
        exam_date: date,
        state,
        tg_remind: exam.tg_remind !== false,
      };
    });
}
