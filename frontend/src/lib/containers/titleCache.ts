/**
 * The way back to an exam from the pages around it (components/Layout.tsx backLinkFor; spec decision 23): the top
 * line says «‹ Зимняя сессия» and leads to /exams/c/<id>.
 *
 * - Container titles: container id → title, in sessionStorage. A container's pages remember theirs
 *   (rememberContainerTitle) once they have read it.
 * - Attached oral exams: oral exam id → { containerId, title }, the oral parts that live inside a container. Package
 *   D1 hands over the whole map whenever containers_overview loads (rememberAttachedExams), and it replaces the old
 *   one. Kept in sessionStorage plus a copy in localStorage, so a new tab knows them too: an oral page reached without
 *   ?from=c:<id> (ExamTicket's «‹ Лист экзамена» drops it) still leads back to its container.
 *
 * Storage can be missing, blocked or full (private mode, cleared site data): every read and write is guarded, and the
 * top line then says «‹ Назад» or leads to the exam list. Each change fires CONTAINER_TITLES_EVENT on window, so the
 * open top line can show a title that arrived after it was drawn (onContainerTitles).
 */

export const CONTAINER_TITLES_KEY = 'meldy_container_titles';
export const ATTACHED_EXAMS_KEY = 'meldy_attached_exams';
export const CONTAINER_TITLES_EVENT = 'meldy:container-titles';

/** The container an oral exam belongs to, and that container's title. */
export interface AttachedExam {
  containerId: string;
  title: string;
}

const MAX_TITLES = 50;
const MAX_ATTACHED = 400; // 20 subjects in each of many containers: far more than an account holds
const MAX_ID = 64;
const MAX_TITLE = 200;

type Store = 'sessionStorage' | 'localStorage';

function read(store: Store, key: string): unknown {
  try {
    const raw = window[store].getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(store: Store, key: string, value: unknown): void {
  try {
    window[store].setItem(key, JSON.stringify(value));
  } catch {
    // Blocked or full: the way back falls back to «‹ Назад».
  }
}

function changed(): void {
  try {
    window.dispatchEvent(new Event(CONTAINER_TITLES_EVENT));
  } catch {
    // No window (a test without a DOM): nothing is listening.
  }
}

const cleanId = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.trim().length <= MAX_ID ? value.trim() : null;

const cleanTitle = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_TITLE) : null;

function titles(): Record<string, string> {
  const value = read('sessionStorage', CONTAINER_TITLES_KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [id, title] of Object.entries(value)) {
    const cleanTitleValue = cleanTitle(title);
    if (cleanId(id) && cleanTitleValue) out[id] = cleanTitleValue;
  }
  return out;
}

function attached(store: Store): Record<string, AttachedExam> | null {
  const value = read(store, ATTACHED_EXAMS_KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, AttachedExam> = {};
  for (const [examId, entry] of Object.entries(value)) {
    const containerId = cleanId((entry as Partial<AttachedExam> | null)?.containerId);
    const title = cleanTitle((entry as Partial<AttachedExam> | null)?.title);
    if (cleanId(examId) && containerId && title) out[examId] = { containerId, title };
  }
  return out;
}

/** The attached exams this tab knows: its own copy, else the device's (a new tab). */
function attachedExams(): Record<string, AttachedExam> {
  return attached('sessionStorage') ?? attached('localStorage') ?? {};
}

/** Remembers a container's title for the way back to it (the latest first; the 50 latest are kept). */
export function rememberContainerTitle(containerId: string, title: string): void {
  const id = cleanId(containerId);
  const clean = cleanTitle(title);
  if (!id || !clean) return;
  const map = titles();
  if (map[id] === clean) return;
  delete map[id];
  const entries = Object.entries(map);
  write('sessionStorage', CONTAINER_TITLES_KEY, Object.fromEntries([...entries.slice(-(MAX_TITLES - 1)), [id, clean]]));
  changed();
}

/** The container's title, if this tab knows it (from its pages or from the attached exams); else null. */
export function containerTitle(containerId: string): string | null {
  const id = cleanId(containerId);
  if (!id) return null;
  const known = titles()[id];
  if (known) return known;
  return Object.values(attachedExams()).find((exam) => exam.containerId === id)?.title ?? null;
}

/**
 * The oral exams that live inside containers, from containers_overview: exam id → { containerId, title }. The whole
 * map each time (an exam no longer attached is forgotten); empty entries are skipped.
 */
export function rememberAttachedExams(map: Record<string, AttachedExam>): void {
  const clean: Record<string, AttachedExam> = {};
  for (const [examId, entry] of Object.entries(map ?? {}).slice(0, MAX_ATTACHED)) {
    const id = cleanId(examId);
    const containerId = cleanId(entry?.containerId);
    const title = cleanTitle(entry?.title);
    if (id && containerId && title) clean[id] = { containerId, title };
  }
  write('sessionStorage', ATTACHED_EXAMS_KEY, clean);
  write('localStorage', ATTACHED_EXAMS_KEY, clean);
  changed();
}

/** The container an oral exam lives in, with its title; null when it is a plain exam or unknown here. */
export function containerOfExam(examId: string): AttachedExam | null {
  const id = cleanId(examId);
  if (!id) return null;
  return attachedExams()[id] ?? null;
}

/** Calls `listener` whenever a title or the attached exams change; returns the way to stop. */
export function onContainerTitles(listener: () => void): () => void {
  try {
    window.addEventListener(CONTAINER_TITLES_EVENT, listener);
    return () => window.removeEventListener(CONTAINER_TITLES_EVENT, listener);
  } catch {
    return () => undefined;
  }
}
