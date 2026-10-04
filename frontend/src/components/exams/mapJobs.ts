/**
 * Mapping runs that outlive the open page (contracts §8, the pattern of conversation/jobs.ts).
 *
 * «Разметить по лекциям» streams for 10–40 seconds. The run lives here, per exam, not in a
 * component: the sheet shows marks as batches arrive, a page opened again sees the same run, and a
 * second run of the same exam cannot start. Daily limit: checked here before the run (at least
 * AI_COSTS.examMapping); the server charges 10 units for every started 40 questions that go to the
 * model just before the judge, and gives them back if the model answered none. A run the limit
 * does not cover ends with an `error` event of code ai_limit: the sheet says so in its note (the
 * sheet shows the limit without a dialog, redesign spec 4.6 and 5.11).
 *
 * Outcomes of a run:
 * - `done` → phase 'done'; the sheet reloads its rows (finishedSeq changes);
 * - the stream ended without `done` or the connection dropped → 'interrupted' with
 *   «Разметка прервалась: проверено 28 из 40.» and «Продолжить» on the sheet;
 * - `error` or a refused request → 'failed' with the server's plain message (for code ai_limit a
 *   sentence with what is left today and when the limit renews);
 * - 409 (another run holds the lock) → 'waiting' «Разметка ещё идёт»: the exam row is polled every
 *   3 s for up to 5 minutes, then the sheet reloads.
 */
import { useSyncExternalStore } from 'react';
import { aiLimitFromBody, formatLimitReset, notifyAIUsageChanged, remainingUnits, type AILimitInfo } from '../../api/limits';
import { AI_COSTS } from '../../lib/plans';
import { readSseStream, StreamError } from '../../api/sseStream';
import { fetchExamMappingState, isMappingLocked, normalizeCoverageItem, type CoverageItem } from '../../api/exams';

/** The least a run costs (one started batch of 40 new questions); the server counts the rest. */
export const MAPPING_COST = AI_COSTS.examMapping;
export const MAPPING_ACTION = 'Разметка по лекциям';
export const MAP_IDLE_MS = 45_000;
export const MARK_STAGGER_MS = 60;

export type MapPhase = 'idle' | 'running' | 'done' | 'interrupted' | 'failed' | 'waiting';

export interface MapStart {
  questions: number;
  toCheck: number;
  materials: Array<{ id: string; title: string; fragments: number }>;
  skipped: Array<{ id: string; title: string; reason: string }>;
}

export interface MapDone {
  state: 'done' | 'partial';
  counts: { full: number; partial: number; none: number; unverified: number };
  reused: number;
  oldestMappedAt: string | null;
  mappedAt: string | null;
  usedAi: boolean;
}

export interface MarkAppearance {
  /** Draw the stroke (a live result); reused and fallback marks appear at once. */
  animate: boolean;
  delayMs: number;
}

export interface MapJobSnapshot {
  examId: string;
  phase: MapPhase;
  start: MapStart | null;
  /** Coverage received during the current or last run, by question id. */
  items: ReadonlyMap<string, CoverageItem>;
  marks: ReadonlyMap<string, MarkAppearance>;
  /** Questions of the batches the model did not answer (checked only by words). */
  failedIds: string[];
  failedMessage: string | null;
  /** Question ids asked for (null: the server picked what needs checking). */
  requested: string[] | null;
  force: boolean;
  received: number;
  reusedCount: number;
  done: MapDone | null;
  /** Plain sentence for the banner (interrupted, failed, waiting). */
  message: string | null;
  /** Grows whenever a run or a wait ends: the sheet reloads its rows then. */
  finishedSeq: number;
  /** The daily limit is being checked before the run starts. */
  starting: boolean;
}

export type VerifyEnergy = (userId: string, cost: number, actionName?: string) => Promise<boolean>;

export interface StartMappingOptions {
  examId: string;
  userId: string;
  questionIds?: string[] | null;
  force?: boolean;
  verifyEnergy: VerifyEnergy;
}

const EMPTY_ITEMS: ReadonlyMap<string, CoverageItem> = new Map();
const EMPTY_MARKS: ReadonlyMap<string, MarkAppearance> = new Map();

const snapshots = new Map<string, MapJobSnapshot>();
const idleSnapshots = new Map<string, MapJobSnapshot>();
/** Exams with a run in progress, including the limit check before it visibly starts. */
const busy = new Set<string>();
const listeners = new Set<() => void>();

const timing = {
  pollIntervalMs: 3_000,
  pollLimitMs: 5 * 60_000,
};

function idle(examId: string, finishedSeq = 0): MapJobSnapshot {
  return {
    examId,
    phase: 'idle',
    start: null,
    items: EMPTY_ITEMS,
    marks: EMPTY_MARKS,
    failedIds: [],
    failedMessage: null,
    requested: null,
    force: false,
    received: 0,
    reusedCount: 0,
    done: null,
    message: null,
    finishedSeq,
    starting: false,
  };
}

function emit() {
  listeners.forEach((listener) => listener());
}

/** Called after every change of any mapping run. Returns the unsubscribe function. */
export function subscribeMapJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const subscribe = subscribeMapJobs;

export function getMapJob(examId: string): MapJobSnapshot {
  const current = snapshots.get(examId);
  if (current) return current;
  let cached = idleSnapshots.get(examId);
  if (!cached) {
    cached = idle(examId);
    idleSnapshots.set(examId, cached);
  }
  return cached;
}

function set(examId: string, update: (previous: MapJobSnapshot) => MapJobSnapshot) {
  snapshots.set(examId, update(getMapJob(examId)));
  emit();
}

export function useMapJob(examId: string | undefined): MapJobSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => getMapJob(examId ?? ''),
    () => getMapJob(examId ?? ''),
  );
}

export function isMappingBusy(examId: string): boolean {
  return busy.has(examId);
}

/** Questions of the exam that already had a mark before this run, plus the marks received. */
export function checkedCount(job: MapJobSnapshot): { checked: number; total: number } | null {
  if (!job.start) return null;
  const before = Math.max(0, job.start.questions - job.start.toCheck);
  return { checked: Math.min(job.start.questions, before + job.received), total: job.start.questions };
}

export function interruptedMessage(job: MapJobSnapshot): string {
  const progress = checkedCount(job);
  if (!progress) return 'Разметка прервалась до начала проверки.';
  return `Разметка прервалась: проверено ${progress.checked} из ${progress.total}.`;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function plainMessage(value: unknown, fallback: string): string {
  const message = typeof value === 'string' ? value.trim() : '';
  return message && message.length <= 200 && /[А-Яа-яЁё]/.test(message) ? message : fallback;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [];
}

function addItems(examId: string, raw: unknown, appearance: (index: number) => MarkAppearance, reused: boolean) {
  const items = list(raw)
    .map(normalizeCoverageItem)
    .filter((item): item is CoverageItem => item !== null);
  if (items.length === 0) return;
  set(examId, (previous) => {
    const nextItems = new Map(previous.items);
    const nextMarks = new Map(previous.marks);
    let received = previous.received;
    items.forEach((item, index) => {
      if (!nextItems.has(item.question_id)) received += 1;
      nextItems.set(item.question_id, item);
      nextMarks.set(item.question_id, reused || item.reused ? { animate: false, delayMs: 0 } : appearance(index));
    });
    return {
      ...previous,
      items: nextItems,
      marks: nextMarks,
      received,
      reusedCount: previous.reusedCount + (reused ? items.length : 0),
    };
  });
}

function handleEvent(examId: string, data: Record<string, unknown>) {
  switch (data.type) {
    case 'start':
      set(examId, (previous) => ({
        ...previous,
        start: {
          questions: num(data.questions),
          toCheck: num(data.to_check ?? data.questions),
          materials: list(data.materials).map((item) => ({ id: text(item.id), title: text(item.title), fragments: num(item.fragments) })),
          skipped: list(data.skipped).map((item) => ({ id: text(item.id), title: text(item.title), reason: text(item.reason) })),
        },
      }));
      break;
    case 'reused':
      addItems(examId, data.items, () => ({ animate: false, delayMs: 0 }), true);
      break;
    case 'lexical':
    case 'batch':
      addItems(examId, data.items, (index) => ({ animate: true, delayMs: index * MARK_STAGGER_MS }), false);
      break;
    case 'batch_failed': {
      const ids = Array.isArray(data.question_ids) ? data.question_ids.filter((id): id is string => typeof id === 'string') : [];
      addItems(examId, data.items, () => ({ animate: false, delayMs: 0 }), false);
      set(examId, (previous) => ({
        ...previous,
        failedIds: Array.from(new Set([...previous.failedIds, ...ids])),
        failedMessage: plainMessage(data.message, 'Сервис занят — эти вопросы проверены только по словам'),
      }));
      break;
    }
    case 'done': {
      const counts = (typeof data.counts === 'object' && data.counts !== null ? data.counts : {}) as Record<string, unknown>;
      set(examId, (previous) => ({
        ...previous,
        done: {
          state: data.state === 'partial' ? 'partial' : 'done',
          counts: { full: num(counts.full), partial: num(counts.partial), none: num(counts.none), unverified: num(counts.unverified) },
          reused: num(data.reused),
          oldestMappedAt: text(data.oldest_mapped_at) || null,
          mappedAt: text(data.mapped_at) || null,
          usedAi: data.used_ai === true,
        },
      }));
      break;
    }
    default:
      break;
  }
}

/** The check of the list was refused by the daily limit (server event error, code ai_limit). */
export function mappingLimitMessage(info: AILimitInfo): string {
  const at = formatLimitReset(info.resetsAt);
  const left = remainingUnits(info);
  if (left <= 0) return `Дневной лимит ИИ исчерпан: сверка с лекциями не запущена. Лимит обновится в ${at}.`;
  const need = info.units !== null && info.units > 0 ? `сверка этих вопросов расходует ${info.units}, а ` : '';
  return `Не хватает дневного лимита ИИ: ${need}сегодня осталось ${left}. Лимит обновится в ${at}.`;
}

function finish(examId: string, phase: MapPhase, message: string | null) {
  set(examId, (previous) => ({ ...previous, phase, message, finishedSeq: previous.finishedSeq + 1 }));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Another run holds the lock: poll the exam row until it is free (or stale), at most five minutes. */
async function waitForOtherRun(examId: string) {
  set(examId, (previous) => ({ ...previous, phase: 'waiting', message: 'Разметка ещё идёт' }));
  const deadline = Date.now() + timing.pollLimitMs;
  while (Date.now() < deadline) {
    await sleep(timing.pollIntervalMs);
    try {
      const state = await fetchExamMappingState(examId);
      if (!state || !isMappingLocked(state)) break;
    } catch {
      // A failed poll is not a verdict: keep waiting until the deadline.
    }
  }
  finish(examId, 'idle', null);
}

/**
 * Starts mapping the exam (once per exam at a time). Resolves when the run is over; the page does
 * not need to await it. Returns 'busy' when a run is already going, 'declined' when the daily
 * limit is not enough.
 */
export async function startMapping(options: StartMappingOptions): Promise<'started' | 'busy' | 'declined'> {
  const { examId, userId } = options;
  if (busy.has(examId)) return 'busy';
  busy.add(examId);
  set(examId, (previous) => ({ ...previous, starting: true }));
  try {
    let allowed = true;
    try {
      allowed = await options.verifyEnergy(userId, MAPPING_COST, MAPPING_ACTION);
    } catch {
      allowed = true; // the limit could not be read: do not block the work
    }
    if (!allowed) {
      set(examId, (previous) => ({ ...previous, starting: false }));
      return 'declined';
    }

    const requested = options.questionIds && options.questionIds.length > 0 ? [...options.questionIds] : null;
    set(examId, (previous) => ({ ...idle(examId, previous.finishedSeq), phase: 'running', requested, force: options.force === true }));

    let terminal: Record<string, unknown> | null;
    try {
      ({ terminal } = await readSseStream({
        url: `/api/exams/${encodeURIComponent(examId)}/map`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_ids: requested, force: options.force === true }),
        },
        onEvent: (data) => handleEvent(examId, data),
        idleMs: MAP_IDLE_MS,
      }));
    } catch (error) {
      if (error instanceof StreamError && error.kind === 'http' && error.status === 409) {
        await waitForOtherRun(examId);
        return 'started';
      }
      if (error instanceof StreamError && (error.kind === 'network' || error.kind === 'timeout')) {
        finish(examId, 'interrupted', interruptedMessage(getMapJob(examId)));
      } else if (error instanceof StreamError && error.kind === 'aborted') {
        finish(examId, 'idle', null);
      } else {
        finish(examId, 'failed', error instanceof StreamError ? error.message : 'Разметка не запустилась. Повторите через минуту.');
      }
      return 'started';
    }

    if (!terminal) {
      finish(examId, 'interrupted', interruptedMessage(getMapJob(examId)));
    } else if (terminal.type === 'done') {
      if (terminal.used_ai === true) notifyAIUsageChanged(); // the server charged the units
      finish(examId, 'done', null);
    } else {
      const limit = aiLimitFromBody(terminal);
      if (limit) {
        notifyAIUsageChanged(); // the meter shows what is left
        finish(examId, 'failed', mappingLimitMessage(limit));
      } else {
        finish(examId, 'failed', plainMessage(terminal.message, 'Разметка не завершилась. Повторите через минуту.'));
      }
    }
    return 'started';
  } finally {
    busy.delete(examId);
    if (getMapJob(examId).starting) set(examId, (previous) => ({ ...previous, starting: false }));
  }
}

/**
 * A run started elsewhere (another tab, or before a reload) still holds the lock: show «Разметка
 * ещё идёт» and poll the exam row like after a 409, without starting a new run.
 */
export async function watchMapping(examId: string): Promise<void> {
  if (busy.has(examId)) return;
  busy.add(examId);
  try {
    await waitForOtherRun(examId);
  } finally {
    busy.delete(examId);
  }
}

/** For tests: forget every run and use short polling. */
export function resetMapJobsForTests(options: { pollIntervalMs?: number; pollLimitMs?: number } = {}) {
  snapshots.clear();
  idleSnapshots.clear();
  busy.clear();
  timing.pollIntervalMs = options.pollIntervalMs ?? 3_000;
  timing.pollLimitMs = options.pollLimitMs ?? 5 * 60_000;
  emit();
}
