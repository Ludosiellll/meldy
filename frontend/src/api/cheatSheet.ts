/**
 * The cheat sheet's server calls (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05, 3.2):
 * - GET /api/oral/sheet — every question of the exam with its current rubric (answer points and
 *   their short sheet lines), what is left to write and its price; no model, no units;
 * - POST /api/oral/sheet/write — starts (or joins) writing the missing questions: a server job that
 *   finishes what was paid for even when the page is gone; progress comes as an SSE stream;
 * - POST /api/oral/sheet/stop — no new questions (the ones already running finish).
 * The writing state of each exam lives here, outside React, so a page that comes back finds it
 * (the same way components/exams/mapJobs.ts keeps the mapping).
 */
import { httpErrorFromResponse, readSseStream, StreamError, STREAM_MESSAGES } from './sseStream';
import { notifyAIUsageChanged } from './limits';
import type { SheetCoverage, SheetMaterial, SheetPoint, SheetQuestion, SheetRubric } from '../lib/exams/cheatSheet';

export interface SheetJobInfo {
  /** stopping: «Остановить» was pressed; the questions already started are being finished. */
  state: 'running' | 'stopping';
  done: number;
  total: number;
  startedAt: string | null;
}

export interface SheetResponse {
  examId: string;
  mappingState: string;
  questions: SheetQuestion[];
  /** Questions that can be written and are not. */
  toWrite: number;
  /** Their price in AI units. */
  units: number;
  /** A writing job the server is running for this exam now. */
  job: SheetJobInfo | null;
}

export class SheetError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, options: { status?: number | null; code?: string | null } = {}) {
    super(message);
    this.name = 'SheetError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

export const SHEET_LOAD_MESSAGE = 'Шпаргалка не загрузилась. Проверьте связь и обновите страницу.';
const SHEET_TIMEOUT_MS = 20_000;
const WRITE_IDLE_MS = 45_000;

// ── Parsing (the server is trusted; a broken proxy or an old build is not) ─────────────────

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HASH = /^[0-9a-f]{32}$/;
const POINT_ID = /^p[1-6]$/;
const SOURCE_ID = /^M\d{1,2}:S\d{1,3}$/;
const COVERAGES: ReadonlySet<string> = new Set(['full', 'partial', 'none', 'unverified']);
const METHODS: ReadonlySet<string> = new Set(['llm', 'lexical', 'manual']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function parsePoint(value: unknown): SheetPoint | null {
  if (!isRecord(value)) return null;
  const id = str(value.id, 4);
  const title = str(value.title, 240).trim();
  if (!POINT_ID.test(id) || !title) return null;
  return {
    id,
    title,
    short: str(value.short, 80).trim(),
    essential: value.essential === true,
    source_quote: str(value.source_quote, 400),
    source_ids: (Array.isArray(value.source_ids) ? value.source_ids : []).filter(
      (item): item is string => typeof item === 'string' && SOURCE_ID.test(item),
    ),
  };
}

function parseRubric(value: unknown): SheetRubric | null {
  if (!isRecord(value)) return null;
  const rubricId = str(value.rubric_id, 64);
  if (!UUID.test(rubricId)) return null;
  const coverage = value.coverage === 'partial' || value.coverage === 'none' ? value.coverage : 'full';
  const seen = new Set<string>();
  const points: SheetPoint[] = [];
  for (const item of Array.isArray(value.points) ? value.points : []) {
    const point = parsePoint(item);
    if (point && !seen.has(point.id)) {
      seen.add(point.id);
      points.push(point);
    }
  }
  const materials: SheetMaterial[] = (Array.isArray(value.materials) ? value.materials : [])
    .filter(isRecord)
    .map((item) => ({ key: str(item.key, 8), material_id: str(item.material_id, 64), title: str(item.title, 200) }))
    .filter((item) => item.key && item.material_id);
  return {
    rubric_id: rubricId.toLowerCase(),
    built_at: typeof value.built_at === 'string' && value.built_at ? value.built_at : null,
    coverage,
    coverage_note: str(value.coverage_note, 400),
    materials,
    points: coverage === 'none' ? [] : points,
  };
}

export function parseSheetQuestion(value: unknown): SheetQuestion | null {
  if (!isRecord(value)) return null;
  const questionId = str(value.question_id, 64);
  const text = str(value.text, 1000).trim();
  if (!UUID.test(questionId) || !text) return null;
  const position = count(value.position);
  const coverage = typeof value.coverage === 'string' && COVERAGES.has(value.coverage) ? (value.coverage as SheetCoverage) : null;
  const method = typeof value.coverage_method === 'string' && METHODS.has(value.coverage_method) ? value.coverage_method : null;
  const hash = str(value.question_hash, 64).toLowerCase();
  return {
    question_id: questionId,
    position: position || 1,
    label: str(value.label, 16),
    section: typeof value.section === 'number' && Number.isFinite(value.section) ? value.section : null,
    text,
    question_hash: HASH.test(hash) ? hash : '',
    coverage,
    coverage_method: method as SheetQuestion['coverage_method'],
    coverage_reason: str(value.coverage_reason, 400),
    missing_note: str(value.missing_note, 400),
    rubric: parseRubric(value.rubric),
    rebuilt: value.rebuilt === true,
  };
}

export function parseSheetResponse(value: unknown): SheetResponse {
  if (!isRecord(value) || !Array.isArray(value.questions)) throw new SheetError(SHEET_LOAD_MESSAGE);
  const questions = value.questions.map(parseSheetQuestion).filter((item): item is SheetQuestion => item !== null);
  const job =
    isRecord(value.job) && (value.job.state === 'running' || value.job.state === 'stopping')
      ? {
          state: value.job.state === 'stopping' ? ('stopping' as const) : ('running' as const),
          done: count(value.job.done),
          total: count(value.job.total),
          startedAt: str(value.job.started_at, 40) || null,
        }
      : null;
  return {
    examId: str(value.exam_id, 64),
    mappingState: str(value.mapping_state, 16),
    questions,
    toWrite: count(value.to_write),
    units: count(value.units),
    job,
  };
}

// ── GET the sheet ────────────────────────────────────────────────────────────────────────

export async function fetchSheet(examId: string, options: { signal?: AbortSignal } = {}): Promise<SheetResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHEET_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(`/api/oral/sheet?exam_id=${encodeURIComponent(examId)}`, { signal: controller.signal });
    } catch {
      throw new SheetError(options.signal?.aborted ? STREAM_MESSAGES.aborted : SHEET_LOAD_MESSAGE);
    }
    if (!response.ok) {
      const error = await httpErrorFromResponse(response);
      throw new SheetError(response.status >= 500 ? SHEET_LOAD_MESSAGE : error.message, { status: response.status, code: error.code ?? null });
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new SheetError(SHEET_LOAD_MESSAGE, { status: response.status });
    }
    return parseSheetResponse(json);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

// ── Writing: one job per exam, outside React ─────────────────────────────────────────────

export type WriteStatus = 'written' | 'cached' | 'none' | 'unverifiable' | 'failed' | 'busy' | 'limit' | 'auth';
const WRITE_STATUSES: ReadonlySet<string> = new Set(['written', 'cached', 'none', 'unverifiable', 'failed', 'busy', 'limit', 'auth']);

export interface SheetWriteState {
  examId: string;
  phase: 'idle' | 'running' | 'done' | 'failed' | 'interrupted';
  done: number;
  total: number;
  written: number;
  failed: number;
  busy: number;
  limit: boolean;
  /** The questions that arrived during this run, by id (status and rubric). */
  results: Record<string, { status: WriteStatus; rubric: SheetRubric | null }>;
  /** A sentence for the column when the run ended badly. */
  message: string | null;
  /** Bumped by every arrived question, so the page knows to merge. */
  seq: number;
  stopping: boolean;
}

const states = new Map<string, SheetWriteState>();
const listeners = new Set<() => void>();
const running = new Set<string>();

function idleState(examId: string): SheetWriteState {
  return { examId, phase: 'idle', done: 0, total: 0, written: 0, failed: 0, busy: 0, limit: false, results: {}, message: null, seq: 0, stopping: false };
}

/** The exam's writing state; the same object until it changes (a React external store). */
export function getSheetWrite(examId: string): SheetWriteState {
  let state = states.get(examId);
  if (!state) {
    state = idleState(examId);
    states.set(examId, state);
  }
  return state;
}

export function subscribeSheetWrites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(examId: string, update: (previous: SheetWriteState) => SheetWriteState) {
  states.set(examId, update(getSheetWrite(examId)));
  listeners.forEach((listener) => listener());
}

function handleEvent(examId: string, data: Record<string, unknown>) {
  if (data.type === 'progress') {
    set(examId, (previous) => ({ ...previous, done: count(data.done), total: count(data.total) || previous.total }));
    return;
  }
  if (data.type !== 'question') return;
  const questionId = str(data.question_id, 64);
  const status = typeof data.status === 'string' && WRITE_STATUSES.has(data.status) ? (data.status as WriteStatus) : 'failed';
  const rubric = parseRubric(data.rubric);
  set(examId, (previous) => ({
    ...previous,
    done: count(data.done) || previous.done + 1,
    total: count(data.total) || previous.total,
    results: questionId ? { ...previous.results, [questionId]: { status, rubric } } : previous.results,
    seq: previous.seq + 1,
  }));
}

function aiLimitTerminal(data: Record<string, unknown>): boolean {
  return data.type === 'error' && (data.code === 'ai_limit' || isRecord(data.limit));
}

/**
 * Writes the exam's missing questions (or only `questionIds`). Resolves when the stream ends; the
 * page does not need to await it. A second call while one runs for the exam does nothing.
 */
export async function startSheetWrite(examId: string, questionIds?: string[]): Promise<void> {
  if (running.has(examId)) return;
  running.add(examId);
  set(examId, (previous) => ({ ...idleState(examId), seq: previous.seq, phase: 'running' }));
  try {
    let terminal: Record<string, unknown> | null = null;
    try {
      ({ terminal } = await readSseStream({
        url: '/api/oral/sheet/write',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exam_id: examId, ...(questionIds && questionIds.length > 0 ? { question_ids: questionIds } : {}) }),
        },
        onEvent: (data) => handleEvent(examId, data),
        idleMs: WRITE_IDLE_MS,
      }));
    } catch (error) {
      const message =
        error instanceof StreamError && error.kind === 'http' && error.status === 409
          ? 'Сейчас идёт сверка списка с лекциями. Шпаргалку можно будет написать, когда она закончится.'
          : error instanceof StreamError && (error.kind === 'network' || error.kind === 'timeout')
            ? 'Связь прервалась. Шпаргалка дописывается на сервере — обновите страницу через минуту.'
            : error instanceof StreamError
              ? error.message
              : 'Не удалось начать. Повторите через минуту.';
      set(examId, (previous) => ({
        ...previous,
        phase: error instanceof StreamError && (error.kind === 'network' || error.kind === 'timeout') ? 'interrupted' : 'failed',
        message,
      }));
      return;
    }
    notifyAIUsageChanged(); // the server charged the written questions
    if (!terminal) {
      set(examId, (previous) => ({ ...previous, phase: 'interrupted', message: 'Связь прервалась. Шпаргалка дописывается на сервере — обновите страницу через минуту.' }));
    } else if (terminal.type === 'done') {
      set(examId, (previous) => ({
        ...previous,
        phase: 'done',
        written: count(terminal?.written),
        failed: count(terminal?.failed),
        busy: count(terminal?.busy),
        limit: terminal?.limit === true,
        message: null,
      }));
    } else if (aiLimitTerminal(terminal)) {
      set(examId, (previous) => ({ ...previous, phase: 'done', limit: true, message: null }));
    } else {
      set(examId, (previous) => ({ ...previous, phase: 'failed', message: str(terminal?.message, 200) || 'Запись остановилась. Повторите через минуту.' }));
    }
  } finally {
    running.delete(examId);
  }
}

/** No new questions; the ones already running finish (and are charged). */
export async function stopSheetWrite(examId: string): Promise<number> {
  set(examId, (previous) => ({ ...previous, stopping: true }));
  try {
    const response = await fetch('/api/oral/sheet/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exam_id: examId }),
    });
    if (!response.ok) return 0;
    const json: unknown = await response.json().catch(() => null);
    return isRecord(json) ? count(json.running) : 0;
  } catch {
    return 0;
  }
}

/** For tests: forget every run. */
export function resetSheetWritesForTests() {
  states.clear();
  running.clear();
  listeners.forEach((listener) => listener());
}
