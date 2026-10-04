/**
 * «Билеты» data access (contracts §1.4, §4, §8; tickets spec 4.4).
 *
 * The browser writes exams, their questions and lectures straight to Supabase (row-level security
 * keeps every row to its owner) and throws plain Russian errors instead of swallowing them. The
 * backend is called only to parse a question list, to extract lecture text and (fire and forget)
 * to prepare an answer key; mapping questions to lectures runs in components/exams/mapJobs.ts.
 *
 * Rules kept here:
 * - question_hash is a generated column: it is never sent, only read back;
 * - editing a question's text resets every coverage field of that row;
 * - known tickets store question ids, written after the questions exist; deleting a question
 *   removes its id from its ticket and keeps the ticket's other questions;
 * - positions are renumbered 1…N after every edit;
 * - an edit is compared with the rows the database holds at the moment of saving, so saving again
 *   after a failure repeats nothing (no question twice, no deleted row taken for a refusal).
 */
import { supabase } from '../lib/supabase';
import { httpErrorFromResponse, StreamError } from './sseStream';
import { displayMaterialTitle } from '../utils/materialTitle';

export type ExamKind = 'exam' | 'credit' | 'colloquium';
export type CoverageValue = 'full' | 'partial' | 'none' | 'unverified';
export type CoverageMethod = 'llm' | 'lexical' | 'manual';
export type MappingState = 'none' | 'running' | 'done' | 'partial' | 'failed';
export type LayoutMode = 'random' | 'sections' | 'fixed';

export const EXAM_KINDS: ExamKind[] = ['exam', 'credit', 'colloquium'];
export const MAX_QUESTIONS = 150;
export const MAX_SECTIONS = 20;
export const MAX_SOURCE_CHARS = 60_000;
export const QUESTION_MIN_CHARS = 3;
export const QUESTION_MAX_CHARS = 1000;
export const LABEL_MAX_CHARS = 16;
export const TITLE_MAX_CHARS = 200;
/** A running mapping whose lock is older than this is treated as stale (the server does the same). */
export const MAPPING_STALE_MS = 5 * 60_000;
export const MANUAL_REASON = 'Отмечено вами';

export interface FixedTicket {
  number: number;
  question_ids: string[];
}

export interface TicketLayout {
  mode: LayoutMode;
  per_ticket: number;
  tickets?: FixedTicket[];
  /** Section headings of the list, in order (additive key: the database stores only section numbers). */
  section_titles?: string[];
}

export interface EvidenceItem {
  material_id: string;
  material_title: string;
  source_id: string;
  excerpt: string;
}

export interface NearestItem extends EvidenceItem {
  matched: string[];
}

export interface ExamRow {
  id: string;
  title: string;
  kind: ExamKind;
  exam_date: string | null;
  source_kind: 'paste' | 'file';
  source_text: string;
  ticket_layout: TicketLayout;
  mapping_state: MappingState;
  mapping_started_at: string | null;
  mapped_at: string | null;
  mapped_material_ids: string[];
  created_at: string;
}

export interface ExamQuestion {
  id: string;
  exam_id: string;
  position: number;
  label: string;
  section: number | null;
  text: string;
  question_hash: string | null;
  coverage: CoverageValue | null;
  coverage_method: CoverageMethod | null;
  coverage_reason: string;
  missing_note: string;
  evidence: EvidenceItem[];
  nearest: NearestItem[];
  materials_fingerprint: string | null;
  mapping_version: number | null;
  mapped_at: string | null;
  created_at: string;
}

/** One coverage result of the mapping stream (contracts §4). */
export interface CoverageItem {
  question_id: string;
  coverage: CoverageValue;
  method: CoverageMethod | null;
  reason: string;
  missing: string;
  evidence: EvidenceItem[];
  nearest: NearestItem[];
  mapped_at: string | null;
  reused: boolean;
}

export interface ExamMaterial {
  id: string;
  title: string;
}

export interface ExamBundle {
  exam: ExamRow;
  questions: ExamQuestion[];
  materialIds: string[];
  materials: ExamMaterial[];
}

export interface ExamListItem {
  id: string;
  title: string;
  kind: ExamKind;
  exam_date: string | null;
  mapping_state: MappingState;
  mapped_at: string | null;
  created_at: string;
  total: number;
  coverage: { full: number; partial: number; none: number; unverified: number; unmapped: number };
  /** Question hashes of the exam (one per row), for the answers line. */
  hashes: string[];
}

export interface PickerMaterial {
  id: string;
  title: string;
  subject: string;
  created_at: string;
  /** Characters of extracted text; 0 means a scan or an empty file. */
  textLength: number;
  /** Source fragments the mapping will see (build_source_chunks without a cap). */
  fragments: number;
  textOnly: boolean;
}

export interface ParsedQuestion {
  position: number;
  label: string;
  text: string;
  section: number | null;
  flags: string[];
}

export interface ParseResult {
  method: string;
  questions: ParsedQuestion[];
  sections: Array<{ index: number; title: string }>;
  tickets: Array<{ number: number; positions: number[] }>;
  warnings: Array<{ code: string; message: string }>;
  source_text: string;
}

export interface ExtractResult {
  text: string;
  length: number;
  title_guess: string;
  warnings: string[];
}

export const EXAM_MESSAGES = {
  load: 'Не удалось загрузить экзамен. Проверьте связь и повторите.',
  list: 'Не удалось загрузить экзамены. Проверьте связь и повторите.',
  materials: 'Не удалось загрузить лекции. Проверьте связь и повторите.',
  save: 'Экзамен не сохранён. Проверьте связь и повторите.',
  denied: 'Изменения не сохранены: экзамен недоступен этому аккаунту.',
  unavailable: 'Экзамены пока недоступны на сервере.',
  signedOut: 'Войдите в аккаунт и повторите.',
  delete: 'Экзамен не удалён. Проверьте связь и повторите.',
  manual: 'Отметка не сохранена. Проверьте связь и повторите.',
  material: 'Лекция не добавлена. Проверьте связь и повторите.',
  network: 'Нет связи с сервером. Проверьте интернет и повторите.',
  badResponse: 'Сервер ответил непонятно. Повторите попытку.',
  invalid: 'Экзамен не сохранён: проверьте название и вопросы.',
} as const;

/** A failed exam operation with a message for the screen. */
export class ExamApiError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = 'ExamApiError';
    this.code = code;
    this.status = status;
  }
}

/** The message to show for any error thrown by this module or by readSseStream. */
export function examErrorMessage(error: unknown, fallback: string = EXAM_MESSAGES.save): string {
  if (error instanceof ExamApiError || error instanceof StreamError) return error.message;
  return fallback;
}

const EXAM_COLUMNS =
  'id, title, kind, exam_date, source_kind, source_text, ticket_layout, mapping_state, mapping_started_at, mapped_at, mapped_material_ids, created_at';
const QUESTION_COLUMNS =
  'id, exam_id, position, label, section, text, question_hash, coverage, coverage_method, coverage_reason, missing_note, evidence, nearest, materials_fingerprint, mapping_version, mapped_at, created_at';
const WRITE_CONCURRENCY = 8;

/** Local calendar date 'yyyy-MM-dd'. */
function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function int(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function errorCode(error: unknown): string | null {
  if (isRecord(error) && typeof error.code === 'string' && error.code.trim()) return error.code.trim();
  return null;
}

/** Supabase / PostgREST error → ExamApiError with a plain message. */
function dbError(error: unknown, fallback: string): ExamApiError {
  if (error instanceof ExamApiError) return error;
  const code = errorCode(error);
  if (code === '42501') return new ExamApiError(EXAM_MESSAGES.denied, code);
  if (code === 'PGRST301' || code === 'PGRST302' || code === '28000') return new ExamApiError(EXAM_MESSAGES.signedOut, code);
  if (code === 'PGRST205' || code === '42P01' || code === 'PGRST204' || code === '42703') {
    return new ExamApiError(EXAM_MESSAGES.unavailable, code);
  }
  return new ExamApiError(fallback, code);
}

type DbResult = { data: unknown; error: unknown };

/** Awaits a Supabase query; its error becomes an ExamApiError. The data is narrowed by the caller. */
async function run(query: PromiseLike<DbResult>, fallback: string): Promise<unknown> {
  let result: DbResult;
  try {
    result = await query;
  } catch (error) {
    throw dbError(error, fallback);
  }
  if (result.error) throw dbError(result.error, fallback);
  return result.data;
}

/** Runs tasks with at most `limit` in flight; the first failure rejects after all started tasks settle. */
async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (next < items.length && failure === null) {
      const item = items[next];
      next += 1;
      try {
        await task(item);
      } catch (error) {
        if (failure === null) failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== null) throw failure;
}

// ---------------------------------------------------------------------------------------------
// Row normalisation (jsonb columns are parsed defensively: older or partial rows never crash a page)

function normalizeEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      material_id: str(item.material_id),
      material_title: displayMaterialTitle(str(item.material_title), ''),
      source_id: str(item.source_id),
      excerpt: str(item.excerpt),
    }))
    .filter((item) => item.excerpt.trim() !== '' || item.source_id !== '');
}

function normalizeNearest(value: unknown): NearestItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    material_id: str(item.material_id),
    material_title: displayMaterialTitle(str(item.material_title), ''),
    source_id: str(item.source_id),
    excerpt: str(item.excerpt),
    matched: Array.isArray(item.matched) ? item.matched.filter((word): word is string => typeof word === 'string') : [],
  }));
}

const COVERAGE_VALUES = new Set<CoverageValue>(['full', 'partial', 'none', 'unverified']);
const METHOD_VALUES = new Set<CoverageMethod>(['llm', 'lexical', 'manual']);

function coverageOf(value: unknown): CoverageValue | null {
  return typeof value === 'string' && COVERAGE_VALUES.has(value as CoverageValue) ? (value as CoverageValue) : null;
}

function methodOf(value: unknown): CoverageMethod | null {
  return typeof value === 'string' && METHOD_VALUES.has(value as CoverageMethod) ? (value as CoverageMethod) : null;
}

export function normalizeLayout(value: unknown): TicketLayout {
  const raw = isRecord(value) ? value : {};
  const mode: LayoutMode = raw.mode === 'sections' || raw.mode === 'fixed' ? raw.mode : 'random';
  const perTicket = int(raw.per_ticket);
  const layout: TicketLayout = { mode, per_ticket: perTicket && perTicket >= 1 && perTicket <= 4 ? perTicket : 2 };
  if (Array.isArray(raw.tickets)) {
    layout.tickets = raw.tickets
      .filter(isRecord)
      .map((ticket) => ({
        number: int(ticket.number) ?? 0,
        question_ids: Array.isArray(ticket.question_ids)
          ? ticket.question_ids.filter((id): id is string => typeof id === 'string')
          : [],
      }))
      .filter((ticket) => ticket.number > 0);
  }
  if (Array.isArray(raw.section_titles)) {
    layout.section_titles = raw.section_titles.map((title) => (typeof title === 'string' ? title : ''));
  }
  return layout;
}

export function normalizeExam(raw: unknown): ExamRow | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const kind = raw.kind === 'credit' || raw.kind === 'colloquium' ? raw.kind : 'exam';
  const state = raw.mapping_state;
  return {
    id: raw.id,
    title: str(raw.title),
    kind,
    exam_date: strOrNull(raw.exam_date),
    source_kind: raw.source_kind === 'file' ? 'file' : 'paste',
    source_text: str(raw.source_text),
    ticket_layout: normalizeLayout(raw.ticket_layout),
    mapping_state:
      state === 'running' || state === 'done' || state === 'partial' || state === 'failed' ? state : 'none',
    mapping_started_at: strOrNull(raw.mapping_started_at),
    mapped_at: strOrNull(raw.mapped_at),
    mapped_material_ids: Array.isArray(raw.mapped_material_ids)
      ? raw.mapped_material_ids.filter((id): id is string => typeof id === 'string')
      : [],
    created_at: str(raw.created_at),
  };
}

export function normalizeQuestion(raw: unknown): ExamQuestion | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    exam_id: str(raw.exam_id),
    position: int(raw.position) ?? 0,
    label: str(raw.label),
    section: int(raw.section),
    text: str(raw.text),
    question_hash: strOrNull(raw.question_hash),
    coverage: coverageOf(raw.coverage),
    coverage_method: methodOf(raw.coverage_method),
    coverage_reason: str(raw.coverage_reason),
    missing_note: str(raw.missing_note),
    evidence: normalizeEvidence(raw.evidence),
    nearest: normalizeNearest(raw.nearest),
    materials_fingerprint: strOrNull(raw.materials_fingerprint),
    mapping_version: int(raw.mapping_version),
    mapped_at: strOrNull(raw.mapped_at),
    created_at: str(raw.created_at),
  };
}

/** A coverage item of the mapping stream; null when it is not usable. */
export function normalizeCoverageItem(raw: unknown): CoverageItem | null {
  if (!isRecord(raw) || typeof raw.question_id !== 'string') return null;
  const coverage = coverageOf(raw.coverage);
  if (!coverage) return null;
  return {
    question_id: raw.question_id,
    coverage,
    method: methodOf(raw.method),
    reason: str(raw.reason),
    missing: str(raw.missing),
    evidence: normalizeEvidence(raw.evidence),
    nearest: normalizeNearest(raw.nearest),
    mapped_at: strOrNull(raw.mapped_at),
    reused: raw.reused === true,
  };
}

/** The row as the sheet shows it after a live coverage item arrived. */
export function applyCoverage(question: ExamQuestion, item: CoverageItem): ExamQuestion {
  return {
    ...question,
    coverage: item.coverage,
    coverage_method: item.method,
    coverage_reason: item.reason,
    missing_note: item.missing,
    evidence: item.evidence,
    nearest: item.nearest,
    mapped_at: item.mapped_at ?? question.mapped_at,
  };
}

/** True while another run holds the mapping lock (a lock older than 5 minutes is stale). */
export function isMappingLocked(exam: Pick<ExamRow, 'mapping_state' | 'mapping_started_at'>, now: number = Date.now()): boolean {
  if (exam.mapping_state !== 'running') return false;
  const started = exam.mapping_started_at ? Date.parse(exam.mapping_started_at) : NaN;
  if (!Number.isFinite(started)) return true;
  return now - started < MAPPING_STALE_MS;
}

/**
 * How many source fragments the mapping will see in this text: build_source_chunks(text,
 * max_chunks=None) of backend/utils.py (paragraphs split on blank lines, long ones cut by words
 * into ~850-character pieces).
 */
export function countSourceFragments(text: string, chunkChars = 850): number {
  if (!text || !text.trim()) return 0;
  let count = 0;
  for (const part of text.split(/\n\s*\n/)) {
    const paragraph = part.trim();
    if (!paragraph) continue;
    if (paragraph.length <= chunkChars) {
      count += 1;
      continue;
    }
    let currentLength = 0;
    let hasCurrent = false;
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (hasCurrent && currentLength + word.length + 1 > chunkChars) {
        count += 1;
        currentLength = 0;
        hasCurrent = false;
      }
      hasCurrent = true;
      currentLength += word.length + 1;
    }
    if (hasCurrent) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// Reads

export async function fetchExam(examId: string): Promise<ExamRow | null> {
  const data = await run(supabase.from('exams').select(EXAM_COLUMNS).eq('id', examId).maybeSingle(), EXAM_MESSAGES.load);
  return normalizeExam(data);
}

/** The mapping lock fields only (polling while another run maps the exam). */
export async function fetchExamMappingState(
  examId: string,
): Promise<Pick<ExamRow, 'mapping_state' | 'mapping_started_at' | 'mapped_at'> | null> {
  const data = await run(
    supabase.from('exams').select('id, mapping_state, mapping_started_at, mapped_at').eq('id', examId).maybeSingle(),
    EXAM_MESSAGES.load,
  );
  const exam = normalizeExam(data);
  return exam ? { mapping_state: exam.mapping_state, mapping_started_at: exam.mapping_started_at, mapped_at: exam.mapped_at } : null;
}

export async function fetchExamQuestions(examId: string, fallback: string = EXAM_MESSAGES.load): Promise<ExamQuestion[]> {
  const data = await run(
    supabase
      .from('exam_questions')
      .select(QUESTION_COLUMNS)
      .eq('exam_id', examId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    fallback,
  );
  return (Array.isArray(data) ? data : []).map(normalizeQuestion).filter((row): row is ExamQuestion => row !== null);
}

/** An exam with the lectures added to it, in the order they were added (Library groups, redesign spec 5.1). */
export interface ExamShelf {
  id: string;
  title: string;
  kind: ExamKind;
  exam_date: string | null;
  created_at: string;
  /** The exam's lectures in the order they were added (exam_materials.added_at), each once. */
  materials: Array<{ id: string; addedAt: string }>;
}

/** The user's exams, newest first, each with its lectures in the order they were added. */
export async function listExamShelves(userId: string): Promise<ExamShelf[]> {
  const data = await run(
    supabase.from('exams').select('id, title, kind, exam_date, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    EXAM_MESSAGES.list,
  );
  const exams = (Array.isArray(data) ? data : []).map(normalizeExam).filter((row): row is ExamRow => row !== null);
  if (exams.length === 0) return [];
  const links = await run(
    supabase
      .from('exam_materials')
      .select('exam_id, material_id, added_at')
      .in('exam_id', exams.map((exam) => exam.id))
      .order('added_at', { ascending: true })
      .limit(5_000),
    EXAM_MESSAGES.list,
  );
  const byExam = new Map<string, Array<{ id: string; addedAt: string }>>();
  for (const row of Array.isArray(links) ? links : []) {
    if (!isRecord(row) || typeof row.exam_id !== 'string' || typeof row.material_id !== 'string') continue;
    const list = byExam.get(row.exam_id) ?? [];
    const materialId = row.material_id;
    if (!list.some((item) => item.id === materialId)) list.push({ id: materialId, addedAt: str(row.added_at) });
    byExam.set(row.exam_id, list);
  }
  return exams.map((exam) => ({
    id: exam.id,
    title: exam.title,
    kind: exam.kind,
    exam_date: exam.exam_date,
    created_at: exam.created_at,
    materials: byExam.get(exam.id) ?? [],
  }));
}

export async function fetchExamMaterialIds(examId: string, fallback: string = EXAM_MESSAGES.load): Promise<string[]> {
  const data = await run(supabase.from('exam_materials').select('material_id').eq('exam_id', examId), fallback);
  const ids = (Array.isArray(data) ? data : [])
    .map((row) => (isRecord(row) && typeof row.material_id === 'string' ? row.material_id : null))
    .filter((id): id is string => id !== null);
  return Array.from(new Set(ids));
}

async function fetchMaterialTitles(ids: string[]): Promise<ExamMaterial[]> {
  if (ids.length === 0) return [];
  const data = await run(supabase.from('materials').select('id, title').in('id', ids), EXAM_MESSAGES.load);
  const byId = new Map<string, ExamMaterial>();
  for (const row of Array.isArray(data) ? data : []) {
    if (isRecord(row) && typeof row.id === 'string') byId.set(row.id, { id: row.id, title: displayMaterialTitle(str(row.title)) });
  }
  return ids.map((id) => byId.get(id)).filter((item): item is ExamMaterial => Boolean(item));
}

/**
 * Exam, questions (in sheet order) and its lectures. null when the exam is missing or not the user's.
 * `onQuestions` gets the questions as soon as they are read, before the lecture titles: the sheet
 * starts reading the answer history for them in parallel.
 */
export async function loadExamBundle(
  examId: string,
  options: { onQuestions?: (questions: ExamQuestion[]) => void } = {},
): Promise<ExamBundle | null> {
  const [exam, questions, materialIds] = await Promise.all([
    fetchExam(examId),
    fetchExamQuestions(examId),
    fetchExamMaterialIds(examId),
  ]);
  if (!exam) return null;
  try {
    options.onQuestions?.(questions);
  } catch {
    // The caller's own follow-up work never turns into a failed load.
  }
  const materials = await fetchMaterialTitles(materialIds);
  return { exam, questions, materialIds, materials };
}

/** The user's exams with coverage counts, nearest exam date first, then the newest without a date. */
export async function listExams(userId: string): Promise<ExamListItem[]> {
  const data = await run(
    supabase
      .from('exams')
      .select('id, title, kind, exam_date, mapping_state, mapped_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    EXAM_MESSAGES.list,
  );
  const exams = (Array.isArray(data) ? data : []).map(normalizeExam).filter((row): row is ExamRow => row !== null);
  if (exams.length === 0) return [];

  const rows = await run(
    supabase
      .from('exam_questions')
      .select('id, exam_id, question_hash, coverage')
      .in('exam_id', exams.map((exam) => exam.id))
      .limit(10_000),
    EXAM_MESSAGES.list,
  );
  const byExam = new Map<string, Array<{ hash: string | null; coverage: CoverageValue | null }>>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isRecord(row) || typeof row.exam_id !== 'string') continue;
    const list = byExam.get(row.exam_id) ?? [];
    list.push({ hash: strOrNull(row.question_hash), coverage: coverageOf(row.coverage) });
    byExam.set(row.exam_id, list);
  }

  const items = exams.map((exam): ExamListItem => {
    const questions = byExam.get(exam.id) ?? [];
    const coverage = { full: 0, partial: 0, none: 0, unverified: 0, unmapped: 0 };
    for (const question of questions) {
      if (question.coverage) coverage[question.coverage] += 1;
      else coverage.unmapped += 1;
    }
    return {
      id: exam.id,
      title: exam.title,
      kind: exam.kind,
      exam_date: exam.exam_date,
      mapping_state: exam.mapping_state,
      mapped_at: exam.mapped_at,
      created_at: exam.created_at,
      total: questions.length,
      coverage,
      hashes: questions.map((question) => question.hash).filter((hash): hash is string => Boolean(hash)),
    };
  });

  // Upcoming exams by date, then the ones without a date (newest first), then past exams.
  const today = todayKey();
  const upcoming = items
    .filter((item) => item.exam_date && item.exam_date >= today)
    .sort((a, b) => (a.exam_date! < b.exam_date! ? -1 : a.exam_date! > b.exam_date! ? 1 : 0));
  const undated = items.filter((item) => !item.exam_date);
  const past = items
    .filter((item) => item.exam_date && item.exam_date < today)
    .sort((a, b) => (a.exam_date! > b.exam_date! ? -1 : a.exam_date! < b.exam_date! ? 1 : 0));
  return [...upcoming, ...undated, ...past];
}

/** The user's materials for the lecture picker, newest first, with text size and fragment count. */
export async function listPickerMaterials(userId: string): Promise<PickerMaterial[]> {
  const data = await run(
    supabase
      .from('materials')
      .select('id, title, subject, created_at, original_text, text_only:summary_json->text_only')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    EXAM_MESSAGES.materials,
  );
  return (Array.isArray(data) ? data : [])
    .filter(isRecord)
    .filter((row) => typeof row.id === 'string')
    .map((row) => {
      const text = str(row.original_text);
      return {
        id: row.id as string,
        title: str(row.title) || 'Без названия',
        subject: str(row.subject),
        created_at: str(row.created_at),
        textLength: text.trim().length,
        fragments: countSourceFragments(text),
        textOnly: row.text_only === true || row.text_only === 'true',
      };
    });
}

// ---------------------------------------------------------------------------------------------
// Writes

export interface DraftQuestion {
  /** Stable key of the editor row: the question id for existing rows, a local key for new ones. */
  key: string;
  /** Existing question id (edit mode); null for a new question. */
  id: string | null;
  label: string;
  section: number | null;
  text: string;
}

export interface DraftTicket {
  number: number;
  /** Keys of the editor rows that make up the ticket. */
  keys: string[];
}

export interface ExamDraft {
  title: string;
  kind: ExamKind;
  examDate: string | null;
  sourceKind: 'paste' | 'file';
  sourceText: string;
  layoutMode: LayoutMode;
  perTicket: number;
  sectionTitles: string[];
  questions: DraftQuestion[];
  tickets: DraftTicket[];
  materialIds: string[];
}

function cleanTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX_CHARS);
}

function cleanText(text: string): string {
  return text.trim().replace(/[ \t]+/g, ' ').slice(0, QUESTION_MAX_CHARS);
}

function validateDraft(draft: ExamDraft): void {
  if (!cleanTitle(draft.title)) throw new ExamApiError('Назовите экзамен.', 'title');
  if (draft.questions.length === 0) throw new ExamApiError('Добавьте хотя бы один вопрос.', 'questions');
  if (draft.questions.length > MAX_QUESTIONS) {
    throw new ExamApiError(`Можно до ${MAX_QUESTIONS} вопросов. Разбейте список на два экзамена.`, 'questions');
  }
  for (const question of draft.questions) {
    if (cleanText(question.text).length < QUESTION_MIN_CHARS) {
      throw new ExamApiError('В списке есть слишком короткий вопрос: допишите или удалите его.', 'question_text');
    }
  }
}

function layoutFor(draft: ExamDraft, ticketIds: FixedTicket[] | null): TicketLayout {
  const layout: TicketLayout = {
    mode: draft.layoutMode,
    per_ticket: Math.min(Math.max(Math.trunc(draft.perTicket) || 2, 1), 4),
  };
  if (draft.layoutMode === 'fixed') layout.tickets = ticketIds ?? [];
  const titles = draft.sectionTitles.map((title) => title.trim().slice(0, 200)).slice(0, MAX_SECTIONS);
  if (titles.length > 0) layout.section_titles = titles;
  return layout;
}

/** Fixed tickets with question ids; keys of deleted rows drop out, empty tickets disappear. */
function ticketsWithIds(tickets: DraftTicket[], idByKey: Map<string, string>): FixedTicket[] {
  return tickets
    .map((ticket) => ({
      number: ticket.number,
      question_ids: Array.from(new Set(ticket.keys.map((key) => idByKey.get(key)).filter((id): id is string => Boolean(id)))),
    }))
    .filter((ticket) => ticket.question_ids.length > 0);
}

function questionRow(examId: string, userId: string | null, question: DraftQuestion, position: number) {
  const row: Record<string, unknown> = {
    exam_id: examId,
    position,
    label: question.label.trim().slice(0, LABEL_MAX_CHARS),
    section: question.section,
    text: cleanText(question.text),
  };
  if (userId) row.user_id = userId;
  return row;
}

async function insertQuestions(
  examId: string,
  userId: string | null,
  rows: Array<{ question: DraftQuestion; position: number }>,
): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();
  if (rows.length === 0) return idByKey;
  const data = await run(
    supabase
      .from('exam_questions')
      .insert(rows.map(({ question, position }) => questionRow(examId, userId, question, position)))
      .select('id, position'),
    EXAM_MESSAGES.save,
  );
  const inserted = (Array.isArray(data) ? data : []).filter(isRecord);
  // Positions are unique within one insert, so they map the returned ids back to the rows.
  const idByPosition = new Map<number, string>();
  for (const row of inserted) {
    const position = int(row.position);
    if (typeof row.id === 'string' && position !== null) idByPosition.set(position, row.id);
  }
  for (const { question, position } of rows) {
    const id = idByPosition.get(position);
    if (!id) throw new ExamApiError(EXAM_MESSAGES.save, 'insert_mismatch');
    idByKey.set(question.key, id);
  }
  return idByKey;
}

async function updateRow(table: string, filters: Record<string, string>, values: Record<string, unknown>, fallback: string) {
  let query = supabase.from(table).update(values);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const data = await run(query.select('id'), fallback);
  if (!Array.isArray(data) || data.length === 0) throw new ExamApiError(EXAM_MESSAGES.denied, 'no_rows');
}

/**
 * Creates the exam: exams row → questions (without question_hash, ids read back) → lectures →
 * for known tickets a PATCH of ticket_layout with question ids. Anything failing after the exam row
 * exists removes that row again (questions and links cascade), so no half-saved exam is left.
 */
export async function createExam(userId: string, draft: ExamDraft): Promise<{ examId: string; questionIds: string[] }> {
  validateDraft(draft);
  const created = await run(
    supabase
      .from('exams')
      .insert({
        user_id: userId,
        title: cleanTitle(draft.title),
        kind: draft.kind,
        exam_date: draft.examDate || null,
        source_kind: draft.sourceKind,
        source_text: draft.sourceText.slice(0, MAX_SOURCE_CHARS),
        ticket_layout: layoutFor(draft, null),
      })
      .select('id')
      .single(),
    EXAM_MESSAGES.save,
  );
  const examId = isRecord(created) && typeof created.id === 'string' ? created.id : null;
  if (!examId) throw new ExamApiError(EXAM_MESSAGES.save, 'no_id');

  try {
    const idByKey = await insertQuestions(
      examId,
      userId,
      draft.questions.map((question, index) => ({ question, position: index + 1 })),
    );
    const materialIds = Array.from(new Set(draft.materialIds.filter(Boolean)));
    if (materialIds.length > 0) {
      await run(
        supabase.from('exam_materials').insert(materialIds.map((materialId) => ({ exam_id: examId, material_id: materialId, user_id: userId }))),
        EXAM_MESSAGES.save,
      );
    }
    if (draft.layoutMode === 'fixed') {
      await updateRow('exams', { id: examId }, { ticket_layout: layoutFor(draft, ticketsWithIds(draft.tickets, idByKey)) }, EXAM_MESSAGES.save);
    }
    return { examId, questionIds: draft.questions.map((question) => idByKey.get(question.key)!) };
  } catch (error) {
    try {
      await supabase.from('exams').delete().eq('id', examId);
    } catch {
      // The exam stays half-saved; the user sees the error and can delete it from the list.
    }
    throw error instanceof ExamApiError ? error : dbError(error, EXAM_MESSAGES.save);
  }
}

/** Every coverage field of a question back to «не размечено» (its text changed). */
export const COVERAGE_RESET = {
  coverage: null,
  coverage_method: null,
  coverage_reason: '',
  missing_note: '',
  evidence: [],
  nearest: [],
  materials_fingerprint: null,
  mapping_version: null,
  mapped_at: null,
} as const;

export interface EditResult {
  questionIds: string[];
  /** Questions whose text changed or that are new: they need mapping. */
  needsMapping: string[];
  materialsChanged: boolean;
}

/** Deletes questions; a row that is already gone counts as deleted, a row that is still there was refused. */
async function deleteQuestions(ids: string[]): Promise<void> {
  const removed = await run(supabase.from('exam_questions').delete().in('id', ids).select('id'), EXAM_MESSAGES.save);
  const gone = new Set((Array.isArray(removed) ? removed : []).filter(isRecord).map((row) => row.id));
  const missing = ids.filter((id) => !gone.has(id));
  if (missing.length === 0) return;
  const still = await run(supabase.from('exam_questions').select('id').in('id', missing), EXAM_MESSAGES.save);
  if (Array.isArray(still) && still.length > 0) throw new ExamApiError(EXAM_MESSAGES.denied, 'no_rows');
}

/**
 * Saves an edited exam by diff: deleted questions go, changed text resets coverage, new
 * questions are inserted, every question gets its position 1…N, lectures are attached or
 * detached, and known tickets keep their remaining questions.
 *
 * The diff is taken against the rows the database holds now, not against the editor's copy: a
 * save that failed halfway may already have deleted, changed or inserted rows, and saving again
 * must neither insert a question twice nor take an already deleted row for a refusal. So a new
 * question whose exact text is stored in a row no other question of the list refers to (inserted
 * by the attempt that failed) takes that row, and lectures already attached are left as they are.
 */
export async function saveExamEdits(input: {
  exam: ExamRow;
  draft: ExamDraft;
  /** Replace the stored source text (the list was pasted or uploaded again). */
  replaceSource: boolean;
}): Promise<EditResult> {
  const { exam, draft } = input;
  validateDraft(draft);
  const [current, currentMaterialIds] = await Promise.all([
    fetchExamQuestions(exam.id, EXAM_MESSAGES.save),
    fetchExamMaterialIds(exam.id, EXAM_MESSAGES.save),
  ]);
  const currentById = new Map(current.map((question) => [question.id, question]));
  const referenced = new Set(draft.questions.map((question) => question.id).filter((id): id is string => Boolean(id && currentById.has(id))));
  const spare = new Map<string, ExamQuestion[]>();
  for (const question of current) {
    if (referenced.has(question.id)) continue;
    const text = cleanText(question.text);
    spare.set(text, [...(spare.get(text) ?? []), question]);
  }
  const rows = draft.questions.map((question, index) => ({
    question,
    position: index + 1,
    before: (question.id ? currentById.get(question.id) : undefined) ?? spare.get(cleanText(question.text))?.shift(),
  }));
  const kept = new Set(rows.map((row) => row.before?.id).filter((id): id is string => Boolean(id)));
  const deleted = current.filter((question) => !kept.has(question.id)).map((question) => question.id);
  if (deleted.length > 0) await deleteQuestions(deleted);

  const idByKey = new Map<string, string>();
  const needsMapping: string[] = [];
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const inserts: Array<{ question: DraftQuestion; position: number }> = [];
  for (const { question, position, before } of rows) {
    if (!before) {
      inserts.push({ question, position });
      continue;
    }
    idByKey.set(question.key, before.id);
    const text = cleanText(question.text);
    const label = question.label.trim().slice(0, LABEL_MAX_CHARS);
    const values: Record<string, unknown> = {};
    if (before.position !== position) values.position = position;
    if (before.label !== label) values.label = label;
    if ((before.section ?? null) !== (question.section ?? null)) values.section = question.section;
    if (cleanText(before.text) !== text) {
      values.text = text;
      Object.assign(values, COVERAGE_RESET);
      needsMapping.push(before.id);
    } else if (before.coverage === null) {
      needsMapping.push(before.id);
    }
    if (Object.keys(values).length > 0) updates.push({ id: before.id, values });
  }

  await pool(updates, WRITE_CONCURRENCY, ({ id, values }) => updateRow('exam_questions', { id }, values, EXAM_MESSAGES.save));
  const insertedIds = await insertQuestions(exam.id, null, inserts);
  insertedIds.forEach((id, key) => {
    idByKey.set(key, id);
    needsMapping.push(id);
  });

  const wanted = Array.from(new Set(draft.materialIds.filter(Boolean)));
  const attached = new Set(currentMaterialIds);
  const attach = wanted.filter((id) => !attached.has(id));
  const detach = currentMaterialIds.filter((id) => !wanted.includes(id));
  if (detach.length > 0) {
    await run(supabase.from('exam_materials').delete().eq('exam_id', exam.id).in('material_id', detach), EXAM_MESSAGES.save);
  }
  if (attach.length > 0) {
    // ON CONFLICT DO NOTHING (needs only the insert grant): a lecture attached meanwhile is not an error.
    await run(
      supabase
        .from('exam_materials')
        .upsert(attach.map((materialId) => ({ exam_id: exam.id, material_id: materialId })), {
          onConflict: 'exam_id,material_id',
          ignoreDuplicates: true,
        }),
      EXAM_MESSAGES.save,
    );
  }

  const examValues: Record<string, unknown> = {
    title: cleanTitle(draft.title),
    kind: draft.kind,
    exam_date: draft.examDate || null,
    ticket_layout: layoutFor(draft, draft.layoutMode === 'fixed' ? ticketsWithIds(draft.tickets, idByKey) : null),
  };
  if (input.replaceSource) {
    examValues.source_kind = draft.sourceKind;
    examValues.source_text = draft.sourceText.slice(0, MAX_SOURCE_CHARS);
  }
  await updateRow('exams', { id: exam.id }, examValues, EXAM_MESSAGES.save);

  return {
    questionIds: draft.questions.map((question) => idByKey.get(question.key)!).filter(Boolean),
    needsMapping,
    materialsChanged: attach.length > 0 || detach.length > 0,
  };
}

/** «Это есть в лекции…»: the student's own mark, never a model verdict. */
export async function markQuestionManual(questionId: string): Promise<void> {
  await updateRow(
    'exam_questions',
    { id: questionId },
    {
      coverage: 'full',
      coverage_method: 'manual',
      coverage_reason: MANUAL_REASON,
      missing_note: '',
      evidence: [],
      nearest: [],
    },
    EXAM_MESSAGES.manual,
  );
}

/** Deletes the exam (its questions and lecture links cascade). The screen asks for confirmation first. */
export async function deleteExam(examId: string): Promise<void> {
  const data = await run(supabase.from('exams').delete().eq('id', examId).select('id'), EXAM_MESSAGES.delete);
  if (!Array.isArray(data) || data.length === 0) throw new ExamApiError(EXAM_MESSAGES.delete, 'no_rows');
}

// ---------------------------------------------------------------------------------------------
// Backend calls

async function postForm(url: string, form: FormData, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', body: form, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new ExamApiError('Запрос остановлен.', 'aborted');
    throw new ExamApiError(EXAM_MESSAGES.network, 'network');
  }
  if (!response.ok) {
    const failure = await httpErrorFromResponse(response);
    throw new ExamApiError(failure.message, failure.code ?? null, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new ExamApiError(EXAM_MESSAGES.badResponse, 'bad_json', response.status);
  }
}

function normalizeParse(raw: unknown): ParseResult {
  if (!isRecord(raw) || !Array.isArray(raw.questions)) throw new ExamApiError(EXAM_MESSAGES.badResponse, 'bad_shape');
  const questions = raw.questions
    .filter(isRecord)
    .map((item, index) => ({
      position: int(item.position) ?? index + 1,
      label: str(item.label),
      text: str(item.text).trim(),
      section: int(item.section),
      flags: Array.isArray(item.flags) ? item.flags.filter((flag): flag is string => typeof flag === 'string') : [],
    }))
    .filter((item) => item.text !== '');
  return {
    method: str(raw.method, 'regex'),
    questions,
    sections: Array.isArray(raw.sections)
      ? raw.sections.filter(isRecord).map((item) => ({ index: int(item.index) ?? 0, title: str(item.title) }))
      : [],
    tickets: Array.isArray(raw.tickets)
      ? raw.tickets
          .filter(isRecord)
          .map((item) => ({
            number: int(item.number) ?? 0,
            positions: Array.isArray(item.positions) ? item.positions.map(int).filter((p): p is number => p !== null) : [],
          }))
          .filter((item) => item.number > 0 && item.positions.length > 0)
      : [],
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter(isRecord).map((item) => ({ code: str(item.code), message: str(item.message) })).filter((item) => item.message)
      : [],
    source_text: str(raw.source_text),
  };
}

/** POST /api/exams/parse with pasted text or a file. Nothing is saved. */
export async function parseQuestionList(input: { text?: string; file?: File }, signal?: AbortSignal): Promise<ParseResult> {
  const form = new FormData();
  if (input.file) form.append('file', input.file, input.file.name);
  else form.append('text', input.text ?? '');
  return normalizeParse(await postForm('/api/exams/parse', form, signal));
}

/** POST /api/extract: lecture text without AI and without energy. */
export async function extractText(file: File, signal?: AbortSignal): Promise<ExtractResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  const raw = await postForm('/api/extract', form, signal);
  if (!isRecord(raw) || typeof raw.text !== 'string') throw new ExamApiError(EXAM_MESSAGES.badResponse, 'bad_shape');
  return {
    text: raw.text,
    length: int(raw.length) ?? raw.text.length,
    title_guess: str(raw.title_guess),
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((item): item is string => typeof item === 'string') : [],
  };
}

function fileTitle(name: string): string {
  return name.replace(/\.[^./\\]+$/, '').replace(/[_]+/g, ' ').trim();
}

/**
 * «Добавить лекции»: extracts the text and stores it as a text-only material (no summary, no
 * cards, no test, no energy). Returns the new material for the picker.
 */
export async function importTextOnlyMaterial(userId: string, file: File, signal?: AbortSignal): Promise<PickerMaterial> {
  const extracted = await extractText(file, signal);
  const text = extracted.text;
  if (!text.trim()) throw new ExamApiError('В файле не найден текст: похоже на скан.', 'no_text');
  const title = (extracted.title_guess.trim() || fileTitle(file.name) || 'Лекция').slice(0, TITLE_MAX_CHARS);
  const data = await run(
    supabase
      .from('materials')
      .insert({
        user_id: userId,
        title,
        subject: '',
        original_text: text,
        summary_json: { text_only: true },
        flashcards_json: { flashcards: [] },
        quiz_json: { quiz: [] },
        missions_json: { missions: [] },
      })
      .select('id, created_at')
      .single(),
    EXAM_MESSAGES.material,
  );
  if (!isRecord(data) || typeof data.id !== 'string') throw new ExamApiError(EXAM_MESSAGES.material, 'no_id');
  return {
    id: data.id,
    title,
    subject: '',
    created_at: str(data.created_at, new Date().toISOString()),
    textLength: text.trim().length,
    fragments: countSourceFragments(text),
    textOnly: true,
  };
}

/**
 * Prepares the answer key of a drawn question in the background (POST /api/oral/rubric). Fire and
 * forget: the ticket screen asks again and shares the same server call; failures are ignored here.
 */
export function prefetchRubric(examId: string, questionId: string): void {
  try {
    void fetch('/api/oral/rubric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exam_id: examId, question_id: questionId, force: false }),
    })
      .then((response) => response.body?.cancel?.())
      .catch(() => undefined);
  } catch {
    // fetch itself threw (very old browser): the ticket screen will prepare the key.
  }
}
