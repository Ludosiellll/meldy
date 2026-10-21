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
import type { SheetRubric } from '../lib/exams/cheatSheet';
import { parseRubric, parseSheetResponse, SheetError, SHEET_LOAD_MESSAGE, type SheetResponse } from '../lib/exams/sheetResponse';

// The answer's parsing is pure and lives in lib/exams/sheetResponse.ts (the Telegram bot copies it); every import of it
// from here keeps working.
export { parseSheetQuestion, parseSheetResponse, SheetError, SHEET_LOAD_MESSAGE } from '../lib/exams/sheetResponse';
export type { SheetJobInfo, SheetResponse } from '../lib/exams/sheetResponse';

const SHEET_TIMEOUT_MS = 20_000;
const WRITE_IDLE_MS = 45_000;

// ── Small readers of the write stream's events ───────────────────────────────────────────

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

/** `capped`: the server's own daily limit of sheet writes is reached (not the AI, not the student's limit). */
export type WriteStatus = 'written' | 'cached' | 'none' | 'unverifiable' | 'failed' | 'busy' | 'capped' | 'limit' | 'auth';
const WRITE_STATUSES: ReadonlySet<string> = new Set(['written', 'cached', 'none', 'unverifiable', 'failed', 'busy', 'capped', 'limit', 'auth']);

export interface SheetWriteState {
  examId: string;
  phase: 'idle' | 'running' | 'done' | 'failed' | 'interrupted';
  done: number;
  total: number;
  written: number;
  /** Not written, with the unverifiable ones (the server's count). */
  failed: number;
  /** Of `failed`: points that failed the quote check twice — another try would not change it. */
  unverifiable: number;
  busy: number;
  /** Not written: the server's daily limit of sheet writes was reached. */
  capped: number;
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
  return { examId, phase: 'idle', done: 0, total: 0, written: 0, failed: 0, unverifiable: 0, busy: 0, capped: 0, limit: false, results: {}, message: null, seq: 0, stopping: false };
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
  // A question written before that got its short lines in this run ("refresh"): its rubric is merged,
  // the progress of the run does not move.
  const refresh = data.refresh === true;
  set(examId, (previous) => ({
    ...previous,
    done: refresh ? previous.done : typeof data.done === 'number' ? count(data.done) : previous.done + 1,
    total: refresh ? previous.total : count(data.total) || previous.total,
    results: questionId ? { ...previous.results, [questionId]: { status, rubric } } : previous.results,
    seq: previous.seq + 1,
  }));
}

/** written (with cached and none), failed (with unverifiable), busy and capped, counted from the questions that arrived. */
function tally(results: SheetWriteState['results']): { written: number; failed: number; unverifiable: number; busy: number; capped: number } {
  let written = 0;
  let failed = 0;
  let unverifiable = 0;
  let busy = 0;
  let capped = 0;
  for (const { status } of Object.values(results)) {
    if (status === 'written' || status === 'cached' || status === 'none') written += 1;
    else if (status === 'failed' || status === 'unverifiable') failed += 1;
    else if (status === 'busy') busy += 1;
    else if (status === 'capped') capped += 1;
    if (status === 'unverifiable') unverifiable += 1;
  }
  return { written, failed, unverifiable, busy, capped };
}

function aiLimitTerminal(data: Record<string, unknown>): boolean {
  return data.type === 'error' && (data.code === 'ai_limit' || isRecord(data.limit));
}

/**
 * Writes the exam's missing questions (or only `questionIds`). Resolves when the stream ends; the
 * page does not need to await it. A second call while one runs for the exam does nothing.
 * `follow`: only join the server's running job (the sheet reported one); when it has ended meanwhile
 * the server starts nothing and charges nothing, and the state goes back to idle. `stopping`: the job
 * joined was already told to stop.
 */
export async function startSheetWrite(examId: string, questionIds?: string[], options: { follow?: boolean; stopping?: boolean } = {}): Promise<void> {
  if (running.has(examId)) return;
  running.add(examId);
  set(examId, (previous) => ({ ...idleState(examId), seq: previous.seq, phase: 'running', stopping: options.stopping === true }));
  try {
    let terminal: Record<string, unknown> | null = null;
    try {
      ({ terminal } = await readSseStream({
        url: '/api/oral/sheet/write',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exam_id: examId,
            ...(questionIds && questionIds.length > 0 ? { question_ids: questionIds } : {}),
            ...(options.follow ? { follow: true } : {}),
          }),
        },
        onEvent: (data) => handleEvent(examId, data),
        idleMs: WRITE_IDLE_MS,
      }));
    } catch (error) {
      const message =
        error instanceof StreamError && error.kind === 'http' && error.status === 409
          ? 'Сейчас идёт сверка с лекциями. Пункты ответа можно будет подготовить после неё.'
          : error instanceof StreamError && (error.kind === 'network' || error.kind === 'timeout')
            ? 'Связь прервалась. Пункты ответа готовятся на сервере. Обновите страницу через минуту.'
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
      set(examId, (previous) => ({ ...previous, phase: 'interrupted', message: 'Связь прервалась. Пункты ответа готовятся на сервере. Обновите страницу через минуту.' }));
    } else if (terminal.type === 'done' && terminal.joined === false) {
      set(examId, (previous) => ({ ...idleState(examId), seq: previous.seq }));
    } else if (terminal.type === 'done') {
      set(examId, (previous) => ({
        ...previous,
        phase: 'done',
        written: count(terminal?.written),
        failed: count(terminal?.failed),
        // The server counts them in `failed`; the questions that arrived say which.
        unverifiable: Math.min(count(terminal?.failed), tally(previous.results).unverifiable),
        busy: count(terminal?.busy),
        // An older server sends no count of its own: counted from the questions that arrived.
        capped: typeof terminal?.capped === 'number' ? count(terminal.capped) : tally(previous.results).capped,
        limit: terminal?.limit === true,
        message: null,
      }));
    } else if (aiLimitTerminal(terminal)) {
      // The day's AI limit ended the run: «Написано 20 из 31». The server sends the counts with the
      // limit; an older server does not, and then they are counted from the questions that arrived.
      const end = terminal;
      set(examId, (previous) => {
        const counted = tally(previous.results);
        return {
          ...previous,
          phase: 'done',
          written: typeof end.written === 'number' ? count(end.written) : counted.written,
          failed: typeof end.failed === 'number' ? count(end.failed) : counted.failed,
          unverifiable: Math.min(typeof end.failed === 'number' ? count(end.failed) : counted.failed, counted.unverifiable),
          busy: typeof end.busy === 'number' ? count(end.busy) : counted.busy,
          capped: typeof end.capped === 'number' ? count(end.capped) : counted.capped,
          total: count(end.total) || previous.total,
          limit: true,
          message: null,
        };
      });
    } else {
      set(examId, (previous) => ({ ...previous, phase: 'failed', message: str(terminal?.message, 200) || 'Запись остановилась. Повторите через минуту.' }));
    }
  } finally {
    running.delete(examId);
  }
}

/**
 * No new questions; the ones already running finish (and are charged). Resolves to how many are
 * still running; a request that failed takes «stopping» back, so «Остановить» can be pressed again.
 */
export async function stopSheetWrite(examId: string): Promise<number> {
  set(examId, (previous) => ({ ...previous, stopping: true }));
  try {
    const response = await fetch('/api/oral/sheet/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exam_id: examId }),
    });
    if (!response.ok) throw new Error(`stop ${response.status}`);
    const json: unknown = await response.json().catch(() => null);
    return isRecord(json) ? count(json.running) : 0;
  } catch {
    set(examId, (previous) => ({ ...previous, stopping: false }));
    return 0;
  }
}

/** For tests: forget every run. */
export function resetSheetWritesForTests() {
  states.clear();
  running.clear();
  listeners.forEach((listener) => listener());
}
