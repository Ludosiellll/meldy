/**
 * A «занятие» in progress, on this device: the order of its questions, where the student is and what was answered, so
 * «Продолжить: ещё 8 вопросов» picks it up after a closed tab — on the same local day only (Concept 2 §3.10). The answers
 * themselves are already in the offline queue (lib/containers/answerQueue.ts); this keeps only the session's shape.
 * Every read and write is guarded: blocked storage means no resume, never an error.
 */
import type { LocalDay } from '../../types/container';
import type { QueueEntry } from '../../lib/containers/session';
import type { StudyRecord } from './model';
import { setAddressParams } from '../../lib/urlState';

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
  /** A self-check (OralRun): its ratings so far and the questions rated, so a reload goes on with them. */
  oral?: SavedOral;
}

export interface SavedOral {
  know: number;
  unsure: number;
  dontKnow: number;
  questions: number;
  rated: string[];
}

function isOral(value: unknown): value is SavedOral {
  const oral = value as SavedOral | null;
  return Boolean(
    oral &&
      typeof oral === 'object' &&
      [oral.know, oral.unsure, oral.dontKnow, oral.questions].every((n) => Number.isInteger(n) && n >= 0) &&
      Array.isArray(oral.rated) &&
      oral.rated.every((id) => typeof id === 'string'),
  );
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
      !Array.isArray(value.records) ||
      (value.oral !== undefined && !isOral(value.oral))
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

/**
 * The session an address names (`?sid=`, written into it when the session starts): a reload, or a tab the phone brings
 * back, opens that same session where it stopped — the same questions, in the same order — on the same local day,
 * until it is finished (owner, 2026-10-20: «обновляю сайт, то с 1 вопроса и вопросы другие»). Unlike `resumable`, a
 * session with nothing answered yet counts too.
 */
export function sessionOf(session: SavedSession | null, sid: string, today: LocalDay): SavedSession | null {
  if (!session || session.id !== sid || session.day !== today) return null;
  if (session.pos < 0 || session.pos >= session.queue.length) return null;
  return session;
}

/**
 * Writes the session's id into the address (`sid`, in place of `resume`) without a navigation: what a reload reads.
 * The router's own state on the history entry is kept.
 */
export function nameInAddress(sid: string): void {
  setAddressParams({ resume: null, sid });
}

const ENDED_KEY = 'meldy_container_sessions_ended';

/**
 * The sessions this tab finished (their ids, the last few): a reload of a finished session's end screen (its address
 * still names it) does not start a new session by itself — StudyPage says it is over and shows the way on.
 */
export function markSessionEnded(sid: string): void {
  try {
    const raw = window.sessionStorage.getItem(ENDED_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    const ids = Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && id !== sid) : [];
    window.sessionStorage.setItem(ENDED_KEY, JSON.stringify([...ids.slice(-9), sid]));
  } catch {
    // A reload of the end screen starts a new session, as before.
  }
}

export function sessionEnded(sid: string | null): boolean {
  if (!sid) return false;
  try {
    const raw = window.sessionStorage.getItem(ENDED_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) && list.includes(sid);
  } catch {
    return false;
  }
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

/** The re-estimate of the pace (Concept 2 §3.6) is told once per stage and exam: the last stage told, 0 for none. */
const PACE_PREFIX = 'meldy_container_pace:';
export function paceToldAt(containerId: string): number {
  try {
    const value = Number(storage()?.getItem(PACE_PREFIX + containerId));
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}
export function markPaceTold(containerId: string, stage: number): void {
  try {
    storage()?.setItem(PACE_PREFIX + containerId, String(stage));
  } catch {
    // Told again next time: harmless.
  }
}

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
