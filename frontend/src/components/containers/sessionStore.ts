/**
 * A «занятие» in progress, on this device: the order of its questions, where the student is and what was answered, so
 * «Продолжить: ещё 8 вопросов» picks it up after a closed tab — on the same local day only (Concept 2 §3.10). The answers
 * themselves are already in the offline queue (lib/containers/answerQueue.ts); this keeps only the session's shape.
 * Every read and write is guarded: blocked storage means no resume, never an error.
 */
import type { LocalDay } from '../../types/container';
import type { QueueEntry } from '../../lib/containers/session';
import type { StudyRecord } from './model';

export interface SavedSession {
  v: 1;
  id: string;
  containerId: string;
  day: LocalDay;
  subjectId: string;
  kind: 'answer' | 'self_check';
  topic: number | null;
  only: 'errors' | 'new' | null;
  queue: QueueEntry[];
  pos: number;
  startedAt: number;
  records: StudyRecord[];
}

const PREFIX = 'meldy_container_session:';
const HINT_KEY = 'meldy_container_keys_hint';
const SELF_CHECK_KEY = 'meldy_container_self_check_note';
const FIRST_SESSION_KEY = 'meldy_container_first_session';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const keyOf = (userId: string, containerId: string) => `${PREFIX}${userId}:${containerId}`;

export function saveSession(userId: string, session: SavedSession): void {
  try {
    storage()?.setItem(keyOf(userId, session.containerId), JSON.stringify(session));
  } catch {
    // Full or blocked: the session simply cannot be resumed.
  }
}

function isEntry(value: unknown): value is QueueEntry {
  const entry = value as QueueEntry | null;
  return Boolean(entry && typeof entry.id === 'string' && (entry.retry === 0 || entry.retry === 1 || entry.retry === 2));
}

export function loadSession(userId: string, containerId: string): SavedSession | null {
  try {
    const raw = storage()?.getItem(keyOf(userId, containerId));
    if (!raw) return null;
    const value = JSON.parse(raw) as SavedSession;
    if (
      !value ||
      value.v !== 1 ||
      value.containerId !== containerId ||
      typeof value.day !== 'string' ||
      !Array.isArray(value.queue) ||
      !value.queue.every(isEntry) ||
      typeof value.pos !== 'number' ||
      !Array.isArray(value.records)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function clearSession(userId: string, containerId: string): void {
  try {
    storage()?.removeItem(keyOf(userId, containerId));
  } catch {
    // Nothing to clear.
  }
}

/** A session that can be continued today: started, not finished. */
export function resumable(session: SavedSession | null, today: LocalDay): SavedSession | null {
  if (!session || session.day !== today) return null;
  if (session.pos <= 0 || session.pos >= session.queue.length) return null;
  return session;
}

/** «Продолжить: ещё 8 вопросов»: the distinct planned questions answered and in all. */
export function resumeCounts(session: SavedSession): { done: number; of: number } {
  const planned = session.queue.filter((entry) => entry.retry === 0);
  const done = new Set(session.queue.slice(0, session.pos).filter((entry) => entry.retry === 0).map((entry) => entry.id));
  return { done: done.size, of: new Set(planned.map((entry) => entry.id)).size };
}

function flag(key: string): boolean {
  try {
    return storage()?.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setFlag(key: string): void {
  try {
    storage()?.setItem(key, '1');
  } catch {
    // Shown again next time: harmless.
  }
}

/** The laptop's keys hint shows during the first session only (the design critique's N3). */
export const keysHintSeen = () => flag(HINT_KEY);
export const markKeysHintSeen = () => setFlag(HINT_KEY);
/** «Самопроверка в счёт не идёт…» shows the first time only (the critique's I7). */
export const selfCheckNoteSeen = () => flag(SELF_CHECK_KEY);
export const markSelfCheckNoteSeen = () => setFlag(SELF_CHECK_KEY);
/** The first session ever on this device: its end offers the daily reminder and opens the guide (decision 33). */
export const firstSessionDone = () => flag(FIRST_SESSION_KEY);
export const markFirstSessionDone = () => setFlag(FIRST_SESSION_KEY);

/** A fresh uuid (session ids, mock runs): crypto.randomUUID, else getRandomValues, else time and Math.random. */
export function newId(): string {
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
    // An embedded browser may throw outside a secure context.
  }
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}
