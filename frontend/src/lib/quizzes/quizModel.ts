/**
 * «Контрольная» without React (spec 2026-10-16 part 2; plan docs/superpowers/plans/2026-10-16-quiz.md): the author's
 * defaults and checks, the participant's clock against the server's deadline, one row a person from their attempts,
 * the summary line, the questions hardest first and the table for Excel.
 */
import type { TestItem } from '../../types/container';
import type { QuizAttemptItem, QuizAttemptRow, QuizGrading, QuizItemStat, QuizMark, QuizRow, QuizSettings } from '../../types/quiz';
import { QUIZ } from '../../components/quiz/copyQuiz';
import { optionOrder, pinnedLast } from '../containers/session';

export const TIME_OPTIONS: readonly (number | null)[] = [null, 5, 10, 15, 20, 30, 40, 45, 60, 90, 120, 180, 240];
export const ATTEMPT_OPTIONS: readonly (number | null)[] = [1, 2, 3, 5, null];
export const PASS_OPTIONS: readonly (number | null)[] = [null, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
export const COUNT_OPTIONS: readonly number[] = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 160, 200];
export const MAX_ITEMS = 200;
const DAY = 86400000;

/** About a minute a question: the smallest timer of the list that is not shorter. */
export function defaultMinutes(count: number): number {
  for (const option of TIME_OPTIONS) if (option !== null && option >= count) return option;
  return 240;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The form's start: every subject, 20 questions (fewer if the pool is smaller), one attempt, open for a week. */
export function defaultSettings(subjectIds: string[], pool: number, now: Date): QuizSettings {
  const count = Math.max(1, Math.min(20, pool, MAX_ITEMS));
  const closes = new Date(now.getTime() + 7 * DAY);
  closes.setHours(23, 59, 0, 0);
  return {
    title: QUIZ.defaultTitle(`${pad(now.getDate())}.${pad(now.getMonth() + 1)}`),
    subject_ids: [...subjectIds],
    item_count: count,
    same_set: false,
    shuffle_items: true,
    shuffle_options: true,
    time_limit_min: defaultMinutes(count),
    opens_at: null,
    closes_at: closes.toISOString(),
    attempts: 1,
    grading: 'best',
    allow_back: true,
    pass_percent: null,
    review: 'mistakes_then_answers',
    members_only: false,
  };
}

export type SettingsProblem = 'title' | 'subjects' | 'count' | 'window';

export function settingsProblems(s: QuizSettings, pool: number): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  const title = s.title.trim();
  if (title.length < 1 || title.length > 120) problems.push('title');
  if (s.subject_ids.length === 0) problems.push('subjects');
  else if (pool < 1 || s.item_count < 1 || s.item_count > MAX_ITEMS) problems.push('count');
  if (s.opens_at && s.closes_at && Date.parse(s.closes_at) <= Date.parse(s.opens_at)) problems.push('window');
  return problems;
}

const MONTHS = ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'нояб.', 'дек.'];

/** «24 окт., 18:00» in the device's time. */
export function dateTimeText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function quizStateWords(row: Pick<QuizRow, 'state' | 'opens_at' | 'closes_at'>): string {
  if (row.state === 'closed') return QUIZ.stateClosed;
  if (row.state === 'not_yet' && row.opens_at) return QUIZ.stateNotYet(dateTimeText(row.opens_at));
  return QUIZ.stateOpen(row.closes_at ? dateTimeText(row.closes_at) : null);
}

/** How far the server's clock is ahead of the device's (ms). */
export function clockOffset(serverNowIso: string, clientNowMs: number): number {
  const server = Date.parse(serverNowIso);
  return Number.isFinite(server) ? server - clientNowMs : 0;
}

/** Whole seconds left to the server's deadline; null without a deadline. */
export function secondsLeft(deadlineIso: string | null, offsetMs: number, nowMs: number): number | null {
  if (!deadlineIso) return null;
  const deadline = Date.parse(deadlineIso);
  if (!Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - (nowMs + offsetMs)) / 1000));
}

export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(s % 60)}` : `${pad(minutes)}:${pad(s % 60)}`;
}

/**
 * The order an attempt shows a question's options in (file indexes by place). Not stored: derived from the attempt and
 * the question, so the attempt (QuizRun) and its review (QuizResult) agree — a reload or a later look gives the same
 * letters. A short answer has none; without shuffling, or when a question keeps its order, the file's order.
 */
export function quizOrder(item: Pick<QuizAttemptItem, 'id' | 'kind' | 'options'> & { keep_order?: boolean }, attemptId: string, shuffle: boolean): number[] {
  if (item.kind === 'short') return [];
  const options = Array.isArray(item.options) ? item.options : [];
  const files = options.map((_, index) => index);
  if (!shuffle) return files;
  try {
    const order = optionOrder(options.length, Boolean(item.keep_order), pinnedLast(options), `${attemptId}:${item.id}`);
    if (order.length === files.length && new Set(order).size === order.length) return order;
  } catch {
    // The file's order.
  }
  return files;
}

export type PersonStatus = 'writing' | 'done' | 'time' | 'closed';

export interface PersonRow {
  person: string;
  name: string;
  own: boolean;
  attempts: number;
  /** The attempt the row shows: one being written, else the one that counts (best or last). */
  counted: QuizAttemptRow;
  all: QuizAttemptRow[];
  status: PersonStatus;
  /** Of the counted, finished attempt; null while writing or without questions. */
  percent: number | null;
  minutes: number | null;
}

const ratio = (a: QuizAttemptRow) => (a.total > 0 ? a.correct / a.total : 0);
export const percentOf = (correct: number, total: number) => (total > 0 ? Math.round((correct * 100) / total) : null);

export function peopleRows(attempts: readonly QuizAttemptRow[], grading: QuizGrading): PersonRow[] {
  const byPerson = new Map<string, QuizAttemptRow[]>();
  for (const a of attempts) byPerson.set(a.person, [...(byPerson.get(a.person) ?? []), a]);
  const rows: PersonRow[] = [];
  byPerson.forEach((list, person) => {
    const all = [...list].sort((a, b) => a.n - b.n);
    const open = all.find((a) => !a.finished_at);
    const finished = all.filter((a) => a.finished_at);
    let counted = open ?? finished[finished.length - 1] ?? all[all.length - 1];
    if (!open && grading === 'best') {
      for (const a of finished) if (ratio(a) > ratio(counted)) counted = a;
    }
    const status: PersonStatus = !counted.finished_at ? 'writing' : counted.finish_reason === 'time' ? 'time' : counted.finish_reason === 'closed' ? 'closed' : 'done';
    const minutes = counted.finished_at ? Math.round((Date.parse(counted.finished_at) - Date.parse(counted.started_at)) / 60000) : null;
    rows.push({
      person,
      name: counted.name,
      own: all.some((a) => a.own),
      attempts: all.length,
      counted,
      all,
      status,
      percent: status === 'writing' ? null : percentOf(counted.correct, counted.total),
      minutes,
    });
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export interface QuizSummary {
  writing: number;
  done: number;
  avgPercent: number | null;
  passed: number | null;
}

/** The line over the table; the author's own tries are left out. */
export function summaryOf(rows: readonly PersonRow[], passPercent: number | null): QuizSummary {
  const people = rows.filter((row) => !row.own);
  const writing = people.filter((row) => row.status === 'writing').length;
  const done = people.filter((row) => row.status !== 'writing');
  const percents = done.map((row) => row.percent).filter((value): value is number => value !== null);
  const avgPercent = percents.length > 0 ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length) : null;
  const passed = passPercent === null ? null : percents.filter((value) => value >= passPercent).length;
  return { writing, done: done.length, avgPercent, passed };
}

export interface QuestionRow {
  itemId: string;
  item: TestItem | null;
  shown: number;
  answered: number;
  correct: number;
  percent: number | null;
  picks: number[];
  wrongTexts: Array<{ text: string; n: number }>;
}

/** Hardest first (the lowest share right of those who got it); questions nobody got go last. */
export function questionRows(stats: readonly QuizItemStat[], items: ReadonlyMap<string, TestItem>): QuestionRow[] {
  return stats
    .map((stat) => ({
      itemId: stat.item_id,
      item: items.get(stat.item_id) ?? null,
      shown: stat.shown,
      answered: stat.answered,
      correct: stat.correct,
      percent: percentOf(stat.correct, stat.shown),
      picks: stat.picks ?? [],
      wrongTexts: stat.wrong_texts ?? [],
    }))
    .sort((a, b) => (a.percent === null ? 1 : 0) - (b.percent === null ? 1 : 0) || (a.percent ?? 0) - (b.percent ?? 0) || b.shown - a.shown);
}

function cell(value: string | number): string {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function stamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The results as a table Excel opens (BOM, «;», CRLF): a row an attempt, a column a question (1 / 0 / empty). */
export function csvOf(
  quiz: Pick<QuizRow, 'pass_percent'>,
  attempts: readonly QuizAttemptRow[],
  marks: readonly QuizMark[],
  items: readonly TestItem[],
  subjects: ReadonlyArray<{ id: string; title: string }>,
): string {
  const order = new Map(subjects.map((subject, index) => [subject.id, index]));
  const title = new Map(subjects.map((subject) => [subject.id, subject.title]));
  const byId = new Map(items.map((item) => [item.id, item]));
  const asked = [...new Set(marks.map((mark) => mark.item_id))]
    .map((id) => byId.get(id))
    .filter((item): item is TestItem => Boolean(item))
    .sort((a, b) => (order.get(a.subject_id) ?? 0) - (order.get(b.subject_id) ?? 0) || a.position - b.position);
  const mark = new Map(marks.map((m) => [`${m.attempt_id}:${m.item_id}`, m.correct]));
  const header = ['Имя', 'Попытка', 'Начало', 'Конец', 'Минуты', 'Верно', 'Всего', '%', 'Порог', ...asked.map((item) => `${title.get(item.subject_id) ?? ''} № ${item.file_no}`.trim())];
  const lines = [header.map(cell).join(';')];
  const sorted = [...attempts].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.n - b.n);
  for (const a of sorted) {
    const percent = percentOf(a.correct, a.total);
    const minutes = a.finished_at ? Math.round((Date.parse(a.finished_at) - Date.parse(a.started_at)) / 60000) : '';
    const passed = quiz.pass_percent === null || percent === null || !a.finished_at ? '' : percent >= quiz.pass_percent ? 'да' : 'нет';
    const row: Array<string | number> = [
      a.own ? `${a.name} (автор)` : a.name,
      a.n,
      stamp(a.started_at),
      stamp(a.finished_at),
      minutes,
      a.correct,
      a.total,
      percent ?? '',
      passed,
      ...asked.map((item) => {
        const value = mark.get(`${a.id}:${item.id}`);
        return value === undefined ? '' : value ? 1 : 0;
      }),
    ];
    lines.push(row.map(cell).join(';'));
  }
  return `﻿${lines.join('\r\n')}`;
}
