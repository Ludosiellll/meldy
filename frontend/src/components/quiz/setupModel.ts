/**
 * The author's settings form of «Контрольная» without React (spec 2026-10-16 §2.1; release 47 §47.1, §47.4, §47.5):
 * the pool of keyed questions by subject, the counts the «Сколько вопросов» list offers, who may write (three choices
 * over `guests` and `members_only`), the start of a quiz of all the questions (`?all=1` from the constructor), a saved
 * quiz as the form's settings, the keys an edit changed (quiz_update takes only those), and the device's local
 * date-time of a native datetime-local field.
 */
import type { TestItem } from '../../types/container';
import type { QuizRow, QuizSettings } from '../../types/quiz';
import { COUNT_OPTIONS, defaultMinutes, MAX_ITEMS } from '../../lib/quizzes/quizModel';

/** A question goes into a quiz only with a key (the database's `keyed` column). */
export const isKeyed = (item: Pick<TestItem, 'correct' | 'answers'>) => item.correct.length > 0 || item.answers.length > 0;

/** Keyed questions by subject. */
export function keyedBySubject(items: Iterable<TestItem>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) if (isKeyed(item)) counts.set(item.subject_id, (counts.get(item.subject_id) ?? 0) + 1);
  return counts;
}

export function poolOf(subjectIds: readonly string[], counts: ReadonlyMap<string, number>): number {
  return subjectIds.reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
}

/**
 * The counts of «Сколько вопросов»: the list's steps below the pool, then the pool itself as «все» (when it fits under
 * 200), and the current count if it is none of these (a quiz saved with 17).
 */
export function countChoices(pool: number, current: number): Array<{ value: number; all: boolean }> {
  const cap = Math.max(1, Math.min(pool, MAX_ITEMS));
  const values = new Set<number>(COUNT_OPTIONS.filter((n) => n < cap));
  values.add(cap);
  if (current >= 1 && current <= cap) values.add(current);
  return [...values].sort((a, b) => a - b).map((value) => ({ value, all: value === cap && pool <= MAX_ITEMS }));
}

/** A new pool for the ticked subjects: the count stays unless it no longer fits; «все» stays «все». */
export function countFor(current: number, oldPool: number, newPool: number): number {
  const oldCap = Math.min(oldPool, MAX_ITEMS);
  const newCap = Math.max(1, Math.min(newPool, MAX_ITEMS));
  if (oldPool > 0 && current >= oldCap) return newCap;
  return Math.min(current, newCap);
}

/**
 * «Кто может писать»: anyone with the link without signing in (guests), anyone with the link who signs in, or only the
 * exam's members. The database keeps it as two flags and never both (quizzes CHECK not (members_only and guests)).
 */
export type QuizWho = 'guests' | 'link' | 'members';
export const WHO_CHOICES: readonly QuizWho[] = ['guests', 'link', 'members'];

export function whoOf(settings: Pick<QuizSettings, 'guests' | 'members_only'>): QuizWho {
  if (settings.members_only) return 'members';
  return settings.guests ? 'guests' : 'link';
}

export function withWho(settings: QuizSettings, who: QuizWho): QuizSettings {
  return { ...settings, guests: who === 'guests', members_only: who === 'members' };
}

/**
 * A new quiz of all the questions (the constructor's «Отправить по ссылке», `?all=1`): the whole pool of the ticked
 * subjects (no more than MAX_ITEMS), one set for everyone, the questions in the exam's order; the timer follows. Its
 * name is the test's own (the exam's title, cut to the 120 characters a quiz's name may have), when there is one.
 */
export function allQuestions(settings: QuizSettings, pool: number, title?: string | null): QuizSettings {
  const count = Math.max(1, Math.min(pool, MAX_ITEMS));
  const name = (title ?? '').trim().slice(0, 120).trim();
  return { ...settings, title: name || settings.title, item_count: count, time_limit_min: defaultMinutes(count), same_set: true, shuffle_items: false };
}

/** A keyed question of the ticked subjects has the author's explanation (it reaches the takers with the right answers). */
export function hasExplanations(items: Iterable<TestItem>, subjectIds: readonly string[]): boolean {
  const ticked = new Set(subjectIds);
  for (const item of items) {
    if (ticked.has(item.subject_id) && isKeyed(item) && typeof item.explanation === 'string' && item.explanation.trim() !== '') return true;
  }
  return false;
}

/** The form's settings of a saved quiz. */
export function settingsOf(row: QuizRow): QuizSettings {
  return {
    title: row.title,
    subject_ids: [...row.subject_ids],
    item_count: row.item_count,
    same_set: row.same_set,
    shuffle_items: row.shuffle_items,
    shuffle_options: row.shuffle_options,
    time_limit_min: row.time_limit_s === null ? null : Math.round(row.time_limit_s / 60),
    opens_at: row.opens_at,
    closes_at: row.closes_at,
    attempts: row.attempts,
    grading: row.grading,
    allow_back: row.allow_back,
    pass_percent: row.pass_percent,
    review: row.review,
    members_only: row.members_only,
    guests: row.guests,
    cover_path: row.cover_path,
    accent: row.accent,
    offer_practice: row.offer_practice,
  };
}

function sameMoment(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : a === b;
}

const SETTING_KEYS: ReadonlyArray<keyof QuizSettings> = [
  'title',
  'subject_ids',
  'item_count',
  'same_set',
  'shuffle_items',
  'shuffle_options',
  'time_limit_min',
  'opens_at',
  'closes_at',
  'attempts',
  'grading',
  'allow_back',
  'pass_percent',
  'review',
  'members_only',
  'guests',
  'cover_path',
  'accent',
  'offer_practice',
];

/** Only what the edit changed: quiz_update keeps every key it is not given. */
export function changedSettings(original: QuizSettings, next: QuizSettings): Partial<QuizSettings> {
  const patch: Partial<QuizSettings> = {};
  const put = <K extends keyof QuizSettings>(key: K) => {
    patch[key] = next[key];
  };
  for (const key of SETTING_KEYS) {
    if (key === 'title') {
      if (next.title.trim() !== original.title.trim()) patch.title = next.title.trim();
    } else if (key === 'subject_ids') {
      const a = [...original.subject_ids].sort().join(',');
      const b = [...next.subject_ids].sort().join(',');
      if (a !== b) put(key);
    } else if (key === 'opens_at' || key === 'closes_at') {
      if (!sameMoment(original[key], next[key])) put(key);
    } else if (original[key] !== next[key]) put(key);
  }
  return patch;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO moment as the value of a datetime-local field, in the device's time («2026-10-23T23:59»). */
export function localInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local field's value (the device's time) as an ISO moment; null when empty or unreadable. */
export function isoFromLocal(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** «Открыта с» switched to a date: the next whole hour. */
export function nextHour(now: Date): string {
  const d = new Date(now.getTime());
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

/** «Открыта до» switched to a date: a week on, 23:59 (as the form's default). */
export function weekOn(now: Date): string {
  const d = new Date(now.getTime() + 7 * 86400000);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}
