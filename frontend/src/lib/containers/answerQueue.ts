/**
 * The offline answer queue (package D1; Concept 3 §5.2, spec decisions 10, 26, 36): per account, first in first out, in
 * localStorage `meldy_test_answers_pending:<userId>`; sent in batches of ≤ 50 in order; guarded by navigator.locks
 * when present. Each element is exactly the RPC element, so a resend is a no-op on the server (client_event_id).
 *
 * Statuses (types/container.ts): QUEUE_DONE → remove; QUEUE_DROP_AND_REPORT → remove + telemetry
 * `container.queue_dropped` {status, count}; network / 5xx / 401 (and a database without the function) → keep and
 * stop until the next flush. Never drops silently: a whole call the server refuses as malformed is split into single
 * answers, and a single answer it still refuses is dropped and reported, so one bad answer never holds up the rest.
 *
 * «Как на экзамене» runs travel the same way (`meldy_test_mock_pending:<userId>`, container_mock_finish, idempotent
 * by client_run_id), in the order they were finished among the answers (lib/containers/mockStore.ts submitMock).
 *
 * Only the signed-in account's queue is ever sent: the RPC records for the session's user, so a queue of another
 * account on this device waits for that account. Flushes: on an answer, `online`, `visibilitychange` (visible) and
 * whenever a screen asks (the container hooks on start). Two locks: `meldy-test-queue` for sending (one tab sends at a
 * time) and a short one for each change of the stored list, so a tab never waits behind another tab's request to
 * keep an answer. This tab also keeps what it queued in memory until the server took it: a list rewritten by another
 * tab from an older copy cannot lose it (it is sent again and comes back «duplicate»), and blocked storage still
 * queues for the life of the page.
 */
import {
  ANSWERS_PER_CALL, CONTAINER_ERROR_TEXT, ContainerApiError, containerErrorText, finishMock, recordAnswers,
} from '../../api/containers';
import { supabase } from '../supabase';
import { track } from '../telemetry';
import {
  QUEUE_DONE, QUEUE_DROP_AND_REPORT,
  type AnswerInput, type AnswerResult, type AnswerStatus, type MockRunInput, type MockRunResult,
} from '../../types/container';

export interface QueueSnapshot { pending: AnswerInput[]; sending: boolean; lastError: string | null }

export const QUEUE_KEY_PREFIX = 'meldy_test_answers_pending:';
export const MOCK_QUEUE_KEY_PREFIX = 'meldy_test_mock_pending:';
/** The lock one tab holds while it sends (Concept 3 §5.2). */
export const QUEUE_LOCK = 'meldy-test-queue';
/** The short lock of a change to the stored lists. */
const STORE_LOCK = 'meldy-test-queue:store';
/** A request that hangs longer is given up (and kept): the next flush sends it again. */
export const SEND_TIMEOUT_MS = 20_000;
/** The telemetry event of answers the server refused for good. */
export const DROP_EVENT = 'container.queue_dropped';
const STORAGE_VERSION = 1;
const RESULTS_KEPT = 500;
const EVENT_ID = /^[A-Za-z0-9_:-]{8,120}$/;
/** Codes of a refusal that resending can never change. */
const FINAL_CODES: ReadonlySet<string> = new Set([
  'MC001', 'MC002', 'MC003', 'MC004', 'MC005', 'MC006', 'MC007', 'MC008', 'MC009', '42501', 'P0002', '22023',
]);

interface AnswerEntry { a: AnswerInput; at: number }
interface MockEntry { run: MockRunInput; at: number }

interface UserQueue {
  draining: Promise<void> | null;
  again: boolean;
  sending: boolean;
  lastError: string | null;
  listeners: Set<(snapshot: QueueSnapshot) => void>;
  /** What this tab queued and the server has not taken yet. */
  answers: Map<string, AnswerEntry>;
  mocks: Map<string, MockEntry>;
  /** Results of the latest sends, by client_event_id / client_run_id (for enqueueAnswers / submit). */
  results: Map<string, AnswerResult>;
  mockResults: Map<string, MockRunResult>;
  watching: boolean;
}

const users = new Map<string, UserQueue>();
/** Undoes the window listeners of watch() (tests). */
const unwatch: Array<() => void> = [];
let lastAt = 0;

function queueOf(userId: string): UserQueue {
  let queue = users.get(userId);
  if (!queue) {
    queue = {
      draining: null, again: false, sending: false, lastError: null, listeners: new Set(),
      answers: new Map(), mocks: new Map(), results: new Map(), mockResults: new Map(), watching: false,
    };
    users.set(userId, queue);
  }
  return queue;
}

/** Strictly increasing enqueue moments: the order of answers and runs survives a coarse clock. */
function stamp(): number {
  lastAt = Math.max(Date.now(), lastAt + 1);
  return lastAt;
}

// ── Storage ────────────────────────────────────────────────────────────────────────────────

function readList(key: string): unknown[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { items?: unknown }).items)) {
      return (parsed as { items: unknown[] }).items;
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: unknown[]): void {
  try {
    if (items.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ v: STORAGE_VERSION, items }));
  } catch {
    // Full or blocked: this tab keeps its own answers in memory (UserQueue.answers) and sends them from there.
  }
}

function isAnswerEntry(value: unknown): value is AnswerEntry {
  const entry = value as Partial<AnswerEntry> | null;
  return Boolean(entry && typeof entry === 'object' && entry.a && typeof entry.a === 'object' && typeof entry.a.client_event_id === 'string' && typeof entry.a.item_id === 'string');
}

function isMockEntry(value: unknown): value is MockEntry {
  const entry = value as Partial<MockEntry> | null;
  return Boolean(entry && typeof entry === 'object' && entry.run && typeof entry.run === 'object' && typeof entry.run.client_run_id === 'string' && Array.isArray(entry.run.answers));
}

function byMoment<T extends { at: number }>(a: T, b: T): number {
  return (a.at ?? 0) - (b.at ?? 0);
}

/** The stored answers of the account, with what this tab queued and the list lost meanwhile, oldest first. */
function storedAnswers(userId: string): AnswerEntry[] {
  const entries = readList(QUEUE_KEY_PREFIX + userId).filter(isAnswerEntry);
  const ids = new Set(entries.map((entry) => entry.a.client_event_id));
  const mine = [...queueOf(userId).answers.values()].filter((entry) => !ids.has(entry.a.client_event_id));
  return mine.length === 0 ? entries : [...entries, ...mine].sort(byMoment);
}

function storedMocks(userId: string): MockEntry[] {
  const entries = readList(MOCK_QUEUE_KEY_PREFIX + userId).filter(isMockEntry);
  const ids = new Set(entries.map((entry) => entry.run.client_run_id));
  const mine = [...queueOf(userId).mocks.values()].filter((entry) => !ids.has(entry.run.client_run_id));
  return mine.length === 0 ? entries : [...entries, ...mine].sort(byMoment);
}

// ── Locks ──────────────────────────────────────────────────────────────────────────────────

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

const tabLocks = new Map<string, Promise<unknown>>();

/** navigator.locks when the browser has it (across tabs), else a lock of this tab only. */
function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  let locks: LockManagerLike | undefined;
  try {
    locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  } catch {
    locks = undefined;
  }
  if (locks && typeof locks.request === 'function') return locks.request(name, work);
  const before = tabLocks.get(name) ?? Promise.resolve();
  const mine = before.then(work, work);
  tabLocks.set(name, mine.catch(() => undefined));
  return mine;
}

/** Adds to or removes from a stored list in one short locked step. */
function changeStored(userId: string, change: () => void): Promise<void> {
  return withLock(STORE_LOCK, async () => {
    change();
  });
}

// ── Snapshot and listeners ─────────────────────────────────────────────────────────────────

export function pendingAnswers(userId: string): AnswerInput[] {
  if (!userId) return [];
  const answers = storedAnswers(userId).map((entry) => entry.a);
  // The answers of a finished «Как на экзамене» waiting for the network count too (the plan takes them as answered).
  for (const entry of storedMocks(userId)) {
    for (const answer of entry.run.answers) {
      if (answer && typeof answer === 'object') answers.push({ ...answer, mode: 'mock', local_date: answer.local_date ?? entry.run.local_date });
    }
  }
  return answers;
}

function snapshot(userId: string): QueueSnapshot {
  const queue = queueOf(userId);
  return { pending: pendingAnswers(userId), sending: queue.sending, lastError: queue.lastError };
}

function notify(userId: string): void {
  const queue = users.get(userId);
  if (!queue || queue.listeners.size === 0) return;
  const current = snapshot(userId);
  for (const listener of [...queue.listeners]) {
    try {
      listener(current);
    } catch {
      // A listener's failure is its own.
    }
  }
}

/** Flushes on `online` and when the tab comes back into sight; tells listeners about other tabs' changes. */
function watch(userId: string): void {
  const queue = queueOf(userId);
  if (queue.watching || typeof window === 'undefined') return;
  queue.watching = true;
  try {
    const online = () => void flushAnswers(userId);
    const visible = () => {
      if (document.visibilityState === 'visible') void flushAnswers(userId);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === QUEUE_KEY_PREFIX + userId || event.key === MOCK_QUEUE_KEY_PREFIX + userId || event.key === null) notify(userId);
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('storage', storage);
    unwatch.push(() => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('storage', storage);
    });
  } catch {
    // Without these events the queue still flushes on every answer and when a screen asks.
  }
}

export function onQueueChange(userId: string, listener: (snapshot: QueueSnapshot) => void): () => void {
  if (!userId) return () => undefined;
  const queue = queueOf(userId);
  queue.listeners.add(listener);
  watch(userId);
  return () => {
    queue.listeners.delete(listener);
  };
}

// ── Sending ────────────────────────────────────────────────────────────────────────────────

/** The account the client is signed in as now (null when signed out or unreadable). */
async function sessionUser(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Only the database refusing for good (its own codes: malformed, gone, not allowed, removed…) may ever cost an answer.
 * Everything else — no network, a 5xx, 401 / 28000 (a session to renew), a database without the function, a proxy's
 * odd answer — keeps every answer and stops until the next flush.
 */
function refusedForGood(error: unknown): error is ContainerApiError {
  return error instanceof ContainerApiError && FINAL_CODES.has(error.code);
}

function timeoutSignal(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function keepResult(queue: UserQueue, id: string, result: AnswerResult): void {
  queue.results.delete(id);
  queue.results.set(id, result);
  while (queue.results.size > RESULTS_KEPT) {
    const oldest = queue.results.keys().next().value;
    if (oldest === undefined) break;
    queue.results.delete(oldest);
  }
}

function report(counts: Map<string, number>, extra: Record<string, string> = {}): void {
  for (const [status, count] of counts) if (count > 0) track(DROP_EVENT, { status, count, ...extra });
}

async function removeAnswers(userId: string, ids: ReadonlySet<string>): Promise<void> {
  if (ids.size === 0) return;
  const queue = queueOf(userId);
  for (const id of ids) queue.answers.delete(id);
  await changeStored(userId, () => {
    const key = QUEUE_KEY_PREFIX + userId;
    const left = readList(key).filter((entry) => !(isAnswerEntry(entry) && ids.has(entry.a.client_event_id)));
    writeList(key, left);
  });
}

async function removeMock(userId: string, runId: string): Promise<void> {
  queueOf(userId).mocks.delete(runId);
  await changeStored(userId, () => {
    const key = MOCK_QUEUE_KEY_PREFIX + userId;
    writeList(key, readList(key).filter((entry) => !(isMockEntry(entry) && entry.run.client_run_id === runId)));
  });
}

type Outcome = 'moved' | 'blocked';

/** One call with these answers; a whole call refused as malformed is tried answer by answer. */
async function sendAnswers(userId: string, batch: AnswerEntry[]): Promise<Outcome> {
  const queue = queueOf(userId);
  const timer = timeoutSignal();
  let results: AnswerResult[];
  try {
    results = (await recordAnswers(batch.map((entry) => entry.a), { signal: timer.signal })).results;
  } catch (error) {
    if (!refusedForGood(error)) {
      queue.lastError = containerErrorText(error);
      return 'blocked';
    }
    if (batch.length > 1) {
      for (const entry of batch) if ((await sendAnswers(userId, [entry])) === 'blocked') return 'blocked';
      return 'moved';
    }
    // One answer the server refuses whatever happens: it goes, and the statistics hear of it.
    await removeAnswers(userId, new Set([batch[0].a.client_event_id]));
    report(new Map([['invalid', 1]]), { code: error.code });
    return 'moved';
  } finally {
    timer.done();
  }
  const done = new Set<string>();
  const dropped = new Map<string, number>();
  // Results come back in the order of the answers; each is still matched by its id, the position only for one without.
  const byId = new Map<string, AnswerResult>();
  for (const result of results) if (result && typeof result.client_event_id === 'string') byId.set(result.client_event_id, result);
  batch.forEach((entry, index) => {
    const id = entry.a.client_event_id;
    const atIndex = results[index];
    const result = byId.get(id) ?? (atIndex && typeof atIndex.client_event_id !== 'string' ? atIndex : undefined);
    const status = result?.status as AnswerStatus | undefined;
    if (!result || !status) return;
    if (QUEUE_DONE.includes(status)) {
      done.add(id);
    } else if (QUEUE_DROP_AND_REPORT.includes(status)) {
      done.add(id);
      dropped.set(status, (dropped.get(status) ?? 0) + 1);
    } else {
      return;
    }
    keepResult(queue, id, result);
  });
  await removeAnswers(userId, done);
  report(dropped);
  // Nothing moved (no result came back for any of them): stop rather than send the same answers again at once.
  return done.size > 0 ? 'moved' : 'blocked';
}

async function sendMock(userId: string, entry: MockEntry): Promise<Outcome> {
  const queue = queueOf(userId);
  const timer = timeoutSignal();
  try {
    const result = await finishMock(entry.run, { signal: timer.signal });
    queue.mockResults.set(entry.run.client_run_id, result);
    await removeMock(userId, entry.run.client_run_id);
    return 'moved';
  } catch (error) {
    if (!refusedForGood(error)) {
      queue.lastError = containerErrorText(error);
      return 'blocked';
    }
    await removeMock(userId, entry.run.client_run_id);
    report(new Map([[error.code, 1]]), { kind: 'mock' });
    return 'moved';
  } finally {
    timer.done();
  }
}

/** Sends until the queue is empty or a send has to wait; oldest first, answers and runs in their order. */
async function drain(userId: string): Promise<Outcome> {
  const queue = queueOf(userId);
  if ((await sessionUser()) !== userId) return 'blocked';
  for (;;) {
    const answers = storedAnswers(userId);
    const mocks = storedMocks(userId);
    if (answers.length === 0 && mocks.length === 0) {
      queue.lastError = null;
      return 'moved';
    }
    if (!queue.sending) {
      queue.sending = true;
      notify(userId);
    }
    let outcome: Outcome;
    const firstRun = mocks[0];
    if (firstRun && (answers.length === 0 || firstRun.at <= answers[0].at)) {
      outcome = await sendMock(userId, firstRun);
    } else {
      const before = firstRun ? firstRun.at : Infinity;
      const batch: AnswerEntry[] = [];
      for (const entry of answers) {
        if (batch.length >= ANSWERS_PER_CALL || entry.at > before) break;
        batch.push(entry);
      }
      outcome = await sendAnswers(userId, batch);
    }
    notify(userId);
    if (outcome === 'blocked') return 'blocked';
  }
}

/** Sends what is pending (on start, `online`, `visibilitychange`). */
export async function flushAnswers(userId: string): Promise<void> {
  if (!userId) return;
  watch(userId);
  const queue = queueOf(userId);
  if (queue.draining) {
    queue.again = true;
    return queue.draining;
  }
  queue.draining = (async () => {
    try {
      do {
        queue.again = false;
        if ((await withLock(QUEUE_LOCK, () => drain(userId))) === 'blocked') break;
      } while (queue.again);
    } catch (error) {
      queue.lastError = containerErrorText(error);
    } finally {
      queue.draining = null;
      queue.sending = false;
      notify(userId);
    }
  })();
  return queue.draining;
}

function freshId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // below
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Adds answers and starts a flush; resolves with the server's results for those that went through now (or [] offline). */
export async function enqueueAnswers(userId: string, answers: AnswerInput[]): Promise<AnswerResult[]> {
  if (!userId || answers.length === 0) return [];
  const queue = queueOf(userId);
  const entries: AnswerEntry[] = answers.map((answer) => ({
    // An answer without a usable id would never be matched to its result: it gets one now, kept from here on.
    a: typeof answer.client_event_id === 'string' && EVENT_ID.test(answer.client_event_id) ? answer : { ...answer, client_event_id: freshId() },
    at: stamp(),
  }));
  for (const entry of entries) queue.answers.set(entry.a.client_event_id, entry);
  await changeStored(userId, () => {
    const key = QUEUE_KEY_PREFIX + userId;
    const stored = readList(key).filter(isAnswerEntry);
    const ids = new Set(stored.map((entry) => entry.a.client_event_id));
    writeList(key, [...stored, ...entries.filter((entry) => !ids.has(entry.a.client_event_id))]);
  });
  notify(userId);
  await flushAnswers(userId);
  const out: AnswerResult[] = [];
  for (const entry of entries) {
    const result = queue.results.get(entry.a.client_event_id);
    if (result) {
      out.push(result);
      queue.results.delete(entry.a.client_event_id);
    }
  }
  return out;
}

/**
 * A finished «Как на экзамене» run into the same queue, then a flush; resolves with the server's result, or null when
 * it waits for the network (lib/containers/mockStore.ts submitMock). A run the server could never take (no answers,
 * more than 200) is refused at once. `onStored` runs once the run is kept on the device, before it is sent.
 */
export async function enqueueMockRun(userId: string, run: MockRunInput, onStored?: () => void): Promise<MockRunResult | null> {
  if (!userId) return null;
  if (!run || !Array.isArray(run.answers) || run.answers.length < 1 || run.answers.length > 200 || !EVENT_ID.test(run.client_run_id ?? '')) {
    throw new ContainerApiError('22023', CONTAINER_ERROR_TEXT['22023'], { status: null });
  }
  const queue = queueOf(userId);
  const entry: MockEntry = { run, at: stamp() };
  queue.mocks.set(run.client_run_id, entry);
  await changeStored(userId, () => {
    const key = MOCK_QUEUE_KEY_PREFIX + userId;
    const stored = readList(key).filter(isMockEntry);
    if (!stored.some((item) => item.run.client_run_id === run.client_run_id)) writeList(key, [...stored, entry]);
  });
  try {
    onStored?.();
  } catch {
    // The caller's own bookkeeping; the run is queued either way.
  }
  notify(userId);
  await flushAnswers(userId);
  const result = queue.mockResults.get(run.client_run_id) ?? null;
  queue.mockResults.delete(run.client_run_id);
  return result;
}

/** For tests: forget every queue state of this tab (not the stored lists). */
export function resetAnswerQueueForTests(): void {
  for (const undo of unwatch.splice(0)) undo();
  users.clear();
  tabLocks.clear();
  lastAt = 0;
}
