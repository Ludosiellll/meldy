/**
 * The words of the mistakes diary (`mistake_diary`), read back from what the server stored.
 *
 * An answer to an exam ticket leaves one mistake per point the student did not name
 * (record_oral_attempt, migration 20261003083154): `question` is the ticket's question,
 * `correct_answer` is «<пункт>. <источник>: «<цитата из лекции>»» (the source part only when there
 * is a quote; the source is «Лекция» or «"<название>", фрагмент N»), and `student_answer` is the
 * student's own words for that point or «(не названо)». One ticket answer can leave several
 * mistakes with the same question, so the diary shows them under their question.
 *
 * Russian quotes nest as «ёлочки» outside and „лапки“ inside; a quote stored with a «…» inside a
 * «…» (or cut off before its closing mark) reads back with the inner pair as „…“. Pure module.
 */
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

/** What the server stores when the student did not name the point at all. */
export const NOT_NAMED = '(не названо)';

export interface OralMistakeText {
  /** The point of the answer the student missed. */
  point: string;
  /** «"Реляционная модель", фрагмент 4», «Лекция», or null when no quote was stored. */
  source: string | null;
  /** The lecture's words for the point, without the outer quotes; null when none. */
  quote: string | null;
}

// «<point>. <source>: «<quote>». The source is «Лекция» or a lecture title in «» (possibly with one
// nested pair), optionally followed by «, фрагмент 4» / «, фрагменты 4, 5».
const ORAL_ANSWER = /^([\s\S]*?)\.\s((?:«[^«»]*(?:«[^«»]*»[^«»]*)*»|Лекция)(?:,\s*фрагмент[а-я]*\s[\d,\s]*\d)?):\s«([\s\S]*)$/;

/** Splits the stored answer of a ticket's point into the point, its source and the lecture's quote. */
export function splitOralAnswer(text: string | null | undefined): OralMistakeText {
  const value = (text ?? '').trim();
  const match = ORAL_ANSWER.exec(value);
  if (!match) return { point: value, source: null, quote: null };
  let quote = match[3].trim();
  // The outer closing mark; a quote cut at 1000 characters may have lost it.
  if (quote.endsWith('»')) quote = quote.slice(0, -1).trimEnd();
  return { point: match[1].trim(), source: match[2].trim(), quote: quote || null };
}

/**
 * Inner quotes as „…“: every «…» inside the text becomes „…“, a pair left open is closed at the end
 * and a stray closing mark is dropped.
 */
export function nestQuotes(text: string): string {
  let depth = 0;
  let out = '';
  for (const ch of text) {
    if (ch === '«' || ch === '„') {
      out += '„';
      depth += 1;
    } else if (ch === '»' || ch === '“') {
      if (depth > 0) {
        out += '“';
        depth -= 1;
      }
    } else {
      out += ch;
    }
  }
  return out + '“'.repeat(depth);
}

/** «<quote>» with its inner quotes nested. */
export function quoted(text: string): string {
  return `«${nestQuotes(text)}»`;
}

/** True when the stored answer of a point says that it was not named. */
export function notNamed(studentAnswer: string | null | undefined): boolean {
  const value = (studentAnswer ?? '').trim();
  return value === '' || value === NOT_NAMED;
}

/** «7 окт.», as the other pages date things; with the year when it is not this year. */
export function mistakeDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return format(date, date.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yyyy', { locale: ru });
}

export interface MistakeLike {
  id: string;
  question: string;
  origin?: string | null;
  created_at: string;
}

export type MistakeEntry<T extends MistakeLike> =
  /** The points of one ticket question the student missed, newest first. */
  | { kind: 'ticket'; key: string; question: string; items: T[] }
  /** A mistake of a test or of the old oral exam, on its own. */
  | { kind: 'single'; key: string; item: T };

function questionKey(question: string): string {
  return question.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
}

/**
 * The diary's rows in their order (newest first): mistakes of ticket answers gathered under their
 * question, at the place of the question's newest mistake; every other mistake on its own.
 */
export function groupMistakes<T extends MistakeLike>(rows: readonly T[]): Array<MistakeEntry<T>> {
  const entries: Array<MistakeEntry<T>> = [];
  const tickets = new Map<string, { kind: 'ticket'; key: string; question: string; items: T[] }>();
  for (const row of rows) {
    if (row.origin !== 'oral_ticket') {
      entries.push({ kind: 'single', key: row.id, item: row });
      continue;
    }
    const key = questionKey(row.question);
    const group = tickets.get(key);
    if (group) {
      group.items.push(row);
      continue;
    }
    const entry = { kind: 'ticket' as const, key: `q:${row.id}`, question: row.question.trim(), items: [row] };
    tickets.set(key, entry);
    entries.push(entry);
  }
  return entries;
}
