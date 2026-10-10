/**
 * The exam's screens as pure functions of the data (no React): what the meta line says, which numbers the figure and
 * the plan card show, where «Начать» leads, which questions a topic or an error block takes, how an answer is graded
 * on the device from the cached key, how a stem with code splits, and what the end of a session says.
 *
 * Inputs are the shared shapes of types/container.ts; the plan comes from lib/containers/plan.ts (planDay), its words
 * from lib/containers/words.ts. Day keys are 'YYYY-MM-DD'.
 */
import type {
  AnswerResult,
  ContainerRole,
  ContainerSummary,
  DayPlan,
  LocalDay,
  PlanCls,
  PlanInput,
  PlanItem,
  SummarySubject,
  TestItem,
  UnitState,
} from '../../types/container';
import { extraNew, onStudyDay, promiseTime } from '../../lib/containers/plan';
import { EVERY_DAY, studyDayFrom, studyMask } from '../../lib/containers/time';
import { countableFrom, emptyState, isOpenError, isSeen } from '../../lib/containers/rule';
import { figureChange } from '../../lib/containers/session';
import { dayText, shownMinutes } from '../../lib/containers/words';
import * as copy from './copy';

// ─────────────────────────────────────────────── days

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayUtc(day: LocalDay): number | null {
  const match = DAY_KEY.exec(day);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Calendar days from `from` to `to` (negative when `to` is earlier); null for a broken key. */
export function dayDiff(from: LocalDay, to: LocalDay): number | null {
  const a = dayUtc(from);
  const b = dayUtc(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

export function addDay(day: LocalDay, n: number): LocalDay {
  const at = dayUtc(day);
  if (at === null) return day;
  const d = new Date(at + n * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The local day of a moment in the student's zone. */
export function dayIn(ms: number, tz: string): LocalDay {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

// ─────────────────────────────────────────────── subjects

export type SubjectKind = 'test' | 'oral' | 'mixed' | 'empty';

export function testCount(subject: SummarySubject): number {
  return subject.keyed + subject.no_key;
}
export function oralCount(subject: SummarySubject): number {
  return subject.oral?.questions ?? 0;
}
export function subjectKind(subject: SummarySubject): SubjectKind {
  const test = testCount(subject) > 0;
  const oral = oralCount(subject) > 0;
  if (test && oral) return 'mixed';
  if (test) return 'test';
  if (oral) return 'oral';
  return 'empty';
}
/** A one-subject exam with variants is the subject's page (spec §7, Concept 1 §2.3). */
export function soloSubject(summary: ContainerSummary): SummarySubject | null {
  if (summary.subjects.length !== 1) return null;
  const only = summary.subjects[0];
  const kind = subjectKind(only);
  return kind === 'test' || kind === 'mixed' ? only : null;
}

export function examQuestions(summary: ContainerSummary): number {
  return summary.items_version.count + summary.subjects.reduce((sum, subject) => sum + oralCount(subject), 0);
}
export function subjectQuestions(subject: SummarySubject): number {
  return testCount(subject) + oralCount(subject);
}

/** The test dates of the exam's subjects, sorted, each once; the exam's own date when no subject has one. */
export function examDates(summary: ContainerSummary): LocalDay[] {
  const dates = new Set<LocalDay>();
  for (const subject of summary.subjects) if (subject.exam_date) dates.add(subject.exam_date);
  if (dates.size === 0 && summary.exam_date) dates.add(summary.exam_date);
  return Array.from(dates).sort();
}

export interface MetaDay {
  text: string;
  passed: boolean;
  noDate: boolean;
  /** The nearest date still ahead (or today), for lines like «к 28 октября». */
  next: LocalDay | null;
}

/** «28 октября, через 19 дней», «с 25 по 28 октября, через 15 дней», «Экзамен прошёл 28 октября», «Дата не указана». */
export function metaDay(dates: LocalDay[], today: LocalDay): MetaDay {
  if (dates.length === 0) return { text: copy.NO_DATE, passed: false, noDate: true, next: null };
  const ahead = dates.filter((date) => (dayDiff(today, date) ?? -1) >= 0);
  if (ahead.length === 0) {
    const last = dates[dates.length - 1];
    return { text: copy.examDay(dayText(last), dayDiff(today, last)), passed: true, noDate: false, next: null };
  }
  const first = ahead[0];
  if (ahead.length === 1) return { text: copy.examDay(dayText(first), dayDiff(today, first)), passed: false, noDate: false, next: first };
  return { text: copy.examSpan(dayText(first), dayText(ahead[ahead.length - 1]), dayDiff(today, first)), passed: false, noDate: false, next: first };
}

// ─────────────────────────────────────────────── the figure

export interface Figure {
  twoDays: number;
  total: number;
  seen: number;
  errors: number;
}

export function summaryFigure(subjects: SummarySubject[]): Figure {
  return subjects.reduce<Figure>(
    (sum, subject) => ({
      twoDays: sum.twoDays + subject.two_days,
      total: sum.total + subject.keyed,
      seen: sum.seen + subject.seen,
      errors: sum.errors + subject.open_errors,
    }),
    { twoDays: 0, total: 0, seen: 0, errors: 0 },
  );
}

/** The exam's figure: the plan's (oral questions with points included) when there is a plan, else the summary's. */
export function examFigure(summary: ContainerSummary, plan: DayPlan | null): Figure {
  if (plan) return { twoDays: plan.figure.twoDays, total: plan.figure.inPlan, seen: plan.figure.seen, errors: plan.figure.errors };
  return summaryFigure(summary.subjects);
}

export function subjectFigure(subject: SummarySubject, plan: DayPlan | null): Figure {
  const own = plan?.perSubject.find((row) => row.subjectId === subject.id);
  if (own) return { twoDays: own.figure.twoDays, total: own.figure.inPlan, seen: own.figure.seen, errors: own.figure.errors };
  return summaryFigure([subject]);
}

// ─────────────────────────────────────────────── today's plan

export function answeredToday(input: PlanInput | null, day: LocalDay): Set<string> {
  const out = new Set<string>();
  for (const item of input?.items ?? []) {
    if (item.u?.lastDay === day) out.add(item.id);
  }
  return out;
}

/**
 * One subject's share of today's plan as a plan of its own, for the plan's words (lib/containers/words.ts planTitle,
 * planDetail): its sessions, its questions by kind (new, familiar, oral) and its minutes; «осталось» once some of the
 * subject was answered today.
 */
export function subjectPlan(plan: DayPlan, subjectId: string, input: PlanInput | null): DayPlan {
  const sessions = plan.sessions.filter((session) => session.subjectId === subjectId);
  const items = new Map((input?.items ?? []).map((item) => [item.id, item]));
  let newItems = 0;
  let reviews = 0;
  let oral = 0;
  let aiChecks = 0;
  for (const session of sessions) {
    for (const id of session.ids) {
      const item = items.get(id);
      if (session.kind !== 'answer' || item?.f === 'o') {
        oral += 1;
        if (session.kind === 'ai_check') aiChecks += 1;
      } else if (!item?.u || !isSeen(item.u)) newItems += 1;
      else reviews += 1;
    }
  }
  const row = plan.perSubject.find((entry) => entry.subjectId === subjectId);
  // The engine's perSubject.estSec is the sum of the subject's sessions; the sessions themselves are what the pill starts.
  const leftSec = sessions.length > 0 ? sessions.reduce((sum, session) => sum + session.estSec, 0) : row?.estSec ?? 0;
  const done = Array.from(answeredToday(input, plan.day)).some((id) => items.get(id)?.s === subjectId);
  return {
    ...plan,
    sessions,
    counts: { newItems, reviews, oral, aiChecks, estSec: leftSec + (done ? 1 : 0), leftSec, doneSec: 0 },
    perSubject: row ? [row] : [],
  };
}

/** Today's questions of a plan (with options, oral self-checks and AI checks). */
export function planCount(plan: DayPlan): number {
  return plan.counts.newItems + plan.counts.reviews + plan.counts.oral;
}

export type DaySession = DayPlan['sessions'][number];

export function firstSession(plan: DayPlan | null, subjectId?: string | null): DaySession | null {
  if (!plan) return null;
  return plan.sessions.find((session) => session.ids.length > 0 && (!subjectId || session.subjectId === subjectId)) ?? null;
}

/** The oral exam of a subject (the author's, or a member's own copy). */
export function oralExamOf(summary: ContainerSummary, subjectId: string): string | null {
  return summary.subjects.find((subject) => subject.id === subjectId)?.oral?.exam_id ?? null;
}

export function studyHref(containerId: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  const query = search.toString();
  return `/exams/c/${containerId}/study${query ? `?${query}` : ''}`;
}

/**
 * Where a session of the plan leads: a «занятие» on this site, or — an AI check — one ticket of the oral exam with up
 * to three questions (decision 29в): /exams/:examId/ticket?q=a,b,c&from=c:<containerId>.
 */
export function sessionHref(containerId: string, summary: ContainerSummary, session: DaySession, back: 's' | null = null): string | null {
  if (session.kind === 'ai_check') {
    const examId = oralExamOf(summary, session.subjectId);
    if (!examId || session.ids.length === 0) return null;
    return `/exams/${examId}/ticket?q=${session.ids.slice(0, 3).join(',')}&from=c:${containerId}`;
  }
  return studyHref(containerId, { s: session.subjectId, kind: session.kind === 'self_check' ? 'self_check' : null, back });
}

/** The minutes of a session as the plan's words show them (lib/containers/words.ts shownMinutes). */
export function minutesOf(estSec: number): number {
  return shownMinutes(estSec);
}

// ─────────────────────────────────────────────── blocks outside the plan: a topic, the errors, more new ones
// The questions themselves come from the study engine (lib/containers/session.ts freeSession, plan.ts extraNew); these
// are the counts the links show.

const EMPTY = emptyState();

export function testItemsOf(input: PlanInput | null, subjectId: string): PlanItem[] {
  return (input?.items ?? []).filter((item) => item.f === 't' && item.s === subjectId).sort((a, b) => a.o - b.o || (a.id < b.id ? -1 : 1));
}

/** «Только ошибки: N»: the subject's current errors (rule.ts isOpenError, as «ошибок сейчас»). */
export function errorCount(input: PlanInput | null, subjectId: string): number {
  return testItemsOf(input, subjectId).filter((item) => isOpenError(item.u ?? EMPTY)).length;
}

export function topicCount(input: PlanInput | null, subjectId: string, topic: number): number {
  return testItemsOf(input, subjectId).filter((item) => item.tp === topic).length;
}

/**
 * «Ещё 20 новых» (lib/containers/plan.ts extraNew): the next new questions of the subject the plan takes them from,
 * past today's plan and past what this session already answered.
 */
export function moreNew(input: PlanInput | null, plan: DayPlan | null, answered?: ReadonlySet<string>): { subjectId: string; ids: string[] } | null {
  if (!input) return null;
  const extra = answered && answered.size > 0 ? [{ subjectId: '', kind: 'answer' as const, ids: Array.from(answered), estSec: 0 }] : [];
  const sessions = [...(plan?.sessions ?? []), ...extra];
  try {
    return extraNew(input, undefined, plan ? { ...plan, sessions } : sessions.length > 0 ? ({ sessions } as unknown as DayPlan) : undefined);
  } catch {
    return null;
  }
}

/** The plan class of an answer, from the question's state (for the student's own pace and miss rates). */
export function clsOf(u: UnitState | undefined, inWindow: boolean): PlanCls {
  if (!u || !isSeen(u)) return 'new_floor';
  if (u!.twoDaysAt !== null) return inWindow ? 'final' : 'check';
  if (u!.seriesAt !== null) return 'confirm';
  return 'relearn';
}

// ─────────────────────────────────────────────── a question on the screen

/**
 * A code-like line: braces, semicolons, operators or a keyword, and few Cyrillic letters once its comments and string
 * literals are left out («Console.WriteLine(c); // целочисленное деление» is code).
 */
export function codeLike(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (/^(\/\/|\/\*|#|--\s)/.test(text)) return true;
  const bare = text
    .replace(/\/\*.*?\*\//g, ' ')
    .replace(/\/\/.*$/, ' ')
    .replace(/\s--\s.*$/, ' ')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '""')
    .trim();
  const letters = bare.match(/[a-zа-яё]/gi) ?? [];
  const cyrillic = bare.match(/[а-яё]/gi) ?? [];
  if (letters.length > 0 && cyrillic.length / letters.length > 0.5) return false;
  if (/^\s{2,}|\t/.test(line)) return true;
  if (/[;{}]|=>|==|!=|\+\+|::|<\/?\w+>|\w\(.*\)|\[\d*\]/.test(bare)) return true;
  return /^(int|var|let|const|string|bool|double|float|char|long|class|struct|public|private|protected|static|void|for|while|if|else|return|using|namespace|import|from|def|print|console|select|insert|update|delete|create|alter|drop|begin|end|function|new)\b/i.test(bare);
}

/** A stem with code: the words before, the code block (its lines verbatim), the words after. */
export function splitStem(stem: string, code: boolean): { before: string; code: string | null; after: string } {
  const text = stem.replace(/\r\n?/g, '\n');
  if (!code || !text.includes('\n')) return { before: text.trim(), code: null, after: '' };
  const lines = text.split('\n');
  let first = lines.findIndex((line) => codeLike(line));
  if (first < 0) return { before: text.trim(), code: null, after: '' };
  let last = lines.length - 1;
  while (last > first && !codeLike(lines[last])) last -= 1;
  // A question line ending with «?» or «:» right before the code stays words even if it has brackets.
  if (first === 0 && lines.length > 1 && /[?:]\s*$/.test(lines[0]) && !/[;{}]/.test(lines[0])) first = 1;
  const block = lines.slice(first, last + 1).join('\n').replace(/\s+$/, '');
  const before = lines.slice(0, first).join('\n').trim();
  const after = lines.slice(last + 1).join('\n').trim();
  return { before, code: block || null, after };
}

/** The short answer as the server compares it (public.meldy_short_norm): case, ё/е, spaces, a final period. */
export function shortNorm(value: string): string {
  let t = value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s\u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, ' ')
    .trim();
  if (t.endsWith('.')) t = t.slice(0, -1);
  return t.trimEnd();
}

export interface LocalAnswer {
  chosen: number[] | null; // file indices; null = «Не знаю»
  text: string | null; // short; null = «Не знаю»
}

/** The verdict on the device, from the cached key (the server's verdict wins when it arrives). */
export function gradeLocal(item: TestItem, answer: LocalAnswer): boolean {
  if (item.kind === 'short') {
    if (answer.text === null) return false;
    const norm = shortNorm(answer.text);
    return norm !== '' && item.answers.some((form) => shortNorm(form) === norm);
  }
  if (!answer.chosen || answer.chosen.length === 0) return false;
  const key = [...item.correct].sort((a, b) => a - b);
  const chosen = Array.from(new Set(answer.chosen)).sort((a, b) => a - b);
  return key.length === chosen.length && key.every((value, index) => value === chosen[index]);
}

/** An option names the key in the verdict up to this many characters; a longer one is cut at a word, with «…». */
export const KEY_NAME_MAX = 40;

/** One option as the verdict names it: its own words on one line, cut at a word when long; an empty one by its letter. */
export function optionName(text: string | undefined, fileIndex: number): string {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!words) return copy.OPTION_LETTERS[fileIndex] ?? String(fileIndex + 1);
  if (words.length <= KEY_NAME_MAX) return words;
  const head = words.slice(0, KEY_NAME_MAX);
  const space = head.lastIndexOf(' ');
  return `${(space >= KEY_NAME_MAX / 2 ? head.slice(0, space) : head).replace(/[\s,;:.—–-]+$/u, '')}…`;
}

/**
 * The key as the file has it, for the verdict «В файле — 7 12» (usability check, m2): the options' own words in the
 * file's order. Never the letters of the shuffled screen — the key panel and «Ключи» use the file's letters, and a
 * letter of one would contradict the other.
 */
export function keyNames(item: TestItem): string[] {
  return [...item.correct].sort((a, b) => a - b).map((fileIndex) => optionName(item.options[fileIndex], fileIndex));
}

/** «тема 2.12» from a topic title that starts with its number («Тема 2.12. Индексы», «2.12 Индексы»); else null. */
export function topicNumber(title: string | undefined): string | null {
  const match = title ? /^\s*(?:тема|раздел)?\s*(\d+(?:\.\d+)*)[.)\s]/i.exec(title) : null;
  return match ? match[1] : null;
}

// ─────────────────────────────────────────────── the end of a session

export interface StudyRecord {
  id: string;
  /** The session's own retry of a mistake (never counted). */
  retry: boolean;
  correct: boolean;
  dontKnow: boolean;
  misclick: boolean;
  clientEventId: string;
}

export interface SessionSummary {
  questions: number;
  retries: number;
  firstRight: number;
  errors: number;
  /** Server results arrived for at least one answer (then the figure's change is known). */
  known: boolean;
  gained: number;
  dropped: number;
  tooEarly: number;
  tooEarlyAt: number | null;
  started: number;
  firstCountAt: number | null;
}

/** When a started series can count, from the server's state of the answer (lib/containers/rule.ts countableFrom). */
function countableAt(result: AnswerResult, today: LocalDay, tz: string): number | null {
  const state = result.state;
  if (!state || !state.streak_at || !state.streak_day) return null;
  const at = Date.parse(state.streak_at);
  if (!Number.isFinite(at)) return null;
  try {
    return countableFrom(at, state.streak_day, state.peek_day ?? null, today, tz);
  } catch {
    return null;
  }
}

/**
 * The numbers of the end screen from the session's answers and the server's results (decision 49): what moved in the
 * figure (lib/containers/session.ts figureChange against the states before the session), the first-try score, the
 * errors, the answers that came too early and when they can count.
 */
export function summarize(
  records: StudyRecord[],
  results: ReadonlyMap<string, AnswerResult>,
  before: ReadonlyMap<string, UnitState | undefined>,
  today: LocalDay,
  tz: string,
): SessionSummary {
  const firsts = records.filter((record) => !record.retry);
  const seen = new Set(firsts.map((record) => record.id));
  const errors = new Set<string>();
  for (const record of firsts) if (!record.correct && !record.misclick) errors.add(record.id);
  const list: AnswerResult[] = [];
  for (const record of records) {
    const result = results.get(record.clientEventId);
    if (result) list.push(result.item_id ? result : { ...result, item_id: record.id });
  }
  const known = list.some((result) => result.status === 'saved' || result.status === 'late');
  let change = { gained: 0, dropped: 0, tooEarly: 0 };
  try {
    change = figureChange(before, list);
  } catch {
    // The figure's change stays unknown: the end screen says the time instead.
  }
  let tooEarlyAt: number | null = null;
  let firstCountAt: number | null = null;
  const started = new Set<string>();
  for (const result of list) {
    if (result.status !== 'saved') continue;
    if (result.step === 'too_early') {
      const at = countableAt(result, today, tz);
      if (at !== null) tooEarlyAt = tooEarlyAt === null ? at : Math.max(tooEarlyAt, at);
    } else if (result.step === 'start') {
      if (result.item_id) started.add(result.item_id);
      const at = countableAt(result, today, tz);
      if (at !== null) firstCountAt = firstCountAt === null ? at : Math.min(firstCountAt, at);
    }
  }
  return {
    questions: seen.size,
    retries: records.length - firsts.length,
    firstRight: firsts.filter((record) => record.correct && !record.misclick).length,
    errors: errors.size,
    known,
    gained: change.gained,
    dropped: change.dropped,
    tooEarly: change.tooEarly,
    tooEarlyAt,
    started: started.size,
    firstCountAt,
  };
}

/**
 * «после 17:05» when the moment is later today; null (= «завтра») when it is on another day. The time is the plan's
 * (lib/containers/plan.ts promiseTime: rounded up to 5 minutes), so the end of a session and the exam page name one time.
 */
export function laterToday(ms: number | null, today: LocalDay, tz: string): string | null {
  if (ms === null) return null;
  const at = promiseTime(ms, tz);
  return at.day === today ? at.time : null;
}

/** The time of tomorrow's first count («завтра после 17:05», as the plan's line says it), or null for «завтра» alone. */
export function tomorrowTime(ms: number | null, today: LocalDay, tz: string): string | null {
  if (ms === null) return null;
  const at = promiseTime(ms, tz);
  return at.day === addDay(today, 1) ? at.time : null;
}

/**
 * When what was answered today comes back, as the plan brings it back: «завтра», or the next study day («12 октября»)
 * when tomorrow is not one of the student's days of the week (`mask`, settings.study_weekdays; every day: «завтра»).
 */
export function comesBackWhen(today: LocalDay, mask?: number): string {
  const tomorrow = addDay(today, 1);
  const next = studyDayFrom(tomorrow, studyMask(mask));
  return next === tomorrow ? 'завтра' : dayText(next);
}

/**
 * When the first questions can count, as the plan's line on the exam page says it: «завтра после 17:05», or from the
 * start of the next study day («12 октября») when tomorrow is a day off. Every day: exactly `tomorrowTime`.
 */
export function firstCountWhen(ms: number | null, today: LocalDay, tz: string, mask?: number): { when: string; time: string | null } {
  const m = studyMask(mask);
  if (m === EVERY_DAY) return { when: 'завтра', time: tomorrowTime(ms, today, tz) };
  if (ms === null) return { when: comesBackWhen(today, m), time: null };
  const at = promiseTime(onStudyDay(ms, m, tz), tz);
  return at.day === addDay(today, 1) ? { when: 'завтра', time: at.time } : { when: dayText(at.day), time: at.time };
}

// ─────────────────────────────────────────────── roles and names

export function isAuthor(role: ContainerRole): boolean {
  return role === 'owner';
}

/** The author shares the exam with a group (then a key fix reaches the group, too). */
export function hasGroup(summary: ContainerSummary): boolean {
  return Boolean(summary.owner && summary.owner.members > 0);
}

export function subjectTitle(summary: ContainerSummary, subjectId: string): string {
  return summary.subjects.find((subject) => subject.id === subjectId)?.title ?? '';
}

/** Items the student set aside («Сомневаюсь в ключе»): keyed questions of the bank that the plan leaves out. */
export function setAsideIds(items: ReadonlyMap<string, TestItem>, input: PlanInput | null, subjectId?: string | null): string[] {
  const planned = new Set((input?.items ?? []).filter((item) => item.f === 't').map((item) => item.id));
  const out: string[] = [];
  for (const item of items.values()) {
    if (subjectId && item.subject_id !== subjectId) continue;
    const keyed = item.kind === 'short' ? item.answers.length > 0 : item.correct.length > 0;
    if (keyed && !planned.has(item.id)) out.push(item.id);
  }
  return out;
}
