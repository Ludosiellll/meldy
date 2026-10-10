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
import { dayText } from '../../lib/containers/words';
import { midnightAfter } from '../../lib/containers/time';
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

/** «17:00» in the student's zone. */
export function clockIn(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  } catch {
    const d = new Date(ms);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
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

/** The hour of a moment in the zone, rounded up («17:23» → «18:00»): by then it surely can count. */
export function hourAfter(ms: number, tz: string): { day: LocalDay; time: string; hour: number } {
  const up = Math.ceil(ms / 3_600_000) * 3_600_000;
  const time = clockIn(up, tz);
  return { day: dayIn(up, tz), time, hour: Number(time.split(':')[0]) };
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

export interface PlanCardNumbers {
  questions: number;
  minutes: number;
  newItems: number;
  reviews: number;
  oral: number;
  left: boolean;
}

/** Minutes as the plan's words show them: at least 1, to the minute below 10, else to 5 (lib/containers/words.ts). */
export function shownMinutes(sec: number): number {
  const min = Math.max(0, sec) / 60;
  if (min <= 0) return 1;
  if (min < 10) return Math.max(1, Math.round(min));
  return Math.round(min / 5) * 5;
}

/**
 * The plan card of the exam page: what is left today and its minutes. `oral` counts every oral question of the day
 * (self-checks and AI checks); `leftSec` is what is left, `estSec` the whole day (more than `leftSec` once some is done).
 */
export function examPlanNumbers(plan: DayPlan): PlanCardNumbers {
  const c = plan.counts;
  return {
    questions: c.newItems + c.reviews + c.oral,
    minutes: shownMinutes(c.leftSec > 0 ? c.leftSec : c.estSec),
    newItems: c.newItems,
    reviews: c.reviews,
    oral: c.oral,
    left: c.doneSec > 0 || c.estSec > c.leftSec,
  };
}

/** The same for one subject (its share of the day). */
export function subjectPlanNumbers(plan: DayPlan, subjectId: string, input: PlanInput | null): PlanCardNumbers {
  const row = plan.perSubject.find((entry) => entry.subjectId === subjectId);
  const ids = new Set(plan.sessions.filter((session) => session.subjectId === subjectId).flatMap((session) => session.ids));
  const items = new Map((input?.items ?? []).map((item) => [item.id, item]));
  let newItems = 0;
  let reviews = 0;
  let oral = 0;
  for (const id of ids) {
    const item = items.get(id);
    if (item?.f === 'o') oral += 1;
    else if (!item?.u || item.u.seen === 0) newItems += 1;
    else reviews += 1;
  }
  const done = Array.from(answeredToday(input, plan.day)).some((id) => items.get(id)?.s === subjectId);
  return {
    questions: row?.items ?? ids.size,
    minutes: shownMinutes(row?.estSec ?? 0),
    newItems,
    reviews,
    oral,
    left: done,
  };
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

export function minutesOf(estSec: number): number {
  return shownMinutes(estSec);
}

// ─────────────────────────────────────────────── blocks outside the plan: a topic, the errors, more new ones

function isError(u: UnitState | undefined): boolean {
  return Boolean(u && u.seen > 0 && u.wrong > 0 && u.seriesAt === null && u.twoDaysAt === null);
}
function isUnseen(u: UnitState | undefined): boolean {
  return !u || u.seen === 0;
}

export function testItemsOf(input: PlanInput | null, subjectId: string): PlanItem[] {
  return (input?.items ?? []).filter((item) => item.f === 't' && item.s === subjectId).sort((a, b) => a.o - b.o || (a.id < b.id ? -1 : 1));
}

/** The current errors of a subject (last answer wrong or «Не знаю»), up to `limit`, in the file's order. */
export function errorIds(input: PlanInput | null, subjectId: string, limit = 20): string[] {
  return testItemsOf(input, subjectId)
    .filter((item) => isError(item.u))
    .slice(0, limit)
    .map((item) => item.id);
}

export function errorCount(input: PlanInput | null, subjectId: string): number {
  return testItemsOf(input, subjectId).filter((item) => isError(item.u)).length;
}

/**
 * Up to `limit` questions of a topic: errors first, then the ones with a first right answer, then new ones, then
 * the rest; what was answered today goes last.
 */
export function topicIds(input: PlanInput | null, subjectId: string, topic: number, today: LocalDay, limit = 20): string[] {
  const rank = (item: PlanItem) => {
    const u = item.u;
    if (u?.lastDay === today) return 4;
    if (isError(u)) return 0;
    if (u && u.seriesAt !== null && u.twoDaysAt === null) return 1;
    if (isUnseen(u)) return 2;
    return 3;
  };
  return testItemsOf(input, subjectId)
    .filter((item) => item.tp === topic)
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item.id);
}

export function topicCount(input: PlanInput | null, subjectId: string, topic: number): number {
  return testItemsOf(input, subjectId).filter((item) => item.tp === topic).length;
}

/** «Ещё 20 новых»: the next new questions of a subject in the file's order, past today's plan. */
export function newIds(input: PlanInput | null, subjectId: string, planned: ReadonlySet<string>, limit = 20): string[] {
  return testItemsOf(input, subjectId)
    .filter((item) => isUnseen(item.u) && !planned.has(item.id))
    .slice(0, limit)
    .map((item) => item.id);
}

/** The subject whose new questions «Ещё 20 новых» takes: the first one (by position) that still has any. */
export function subjectWithNew(summary: ContainerSummary, input: PlanInput | null, planned: ReadonlySet<string>, prefer?: string | null): string | null {
  const order = prefer ? [prefer, ...summary.subjects.map((subject) => subject.id).filter((id) => id !== prefer)] : summary.subjects.map((subject) => subject.id);
  return order.find((id) => newIds(input, id, planned, 1).length > 0) ?? null;
}

/** The plan class of an answer, from the question's state (for the student's own pace and miss rates). */
export function clsOf(u: UnitState | undefined, inWindow: boolean): PlanCls {
  if (isUnseen(u)) return 'new_floor';
  if (u!.twoDaysAt !== null) return inWindow ? 'final' : 'check';
  if (u!.seriesAt !== null) return 'confirm';
  return 'relearn';
}

// ─────────────────────────────────────────────── a question on the screen

/** «Все перечисленные», «Ни один из…»: such options stay last whatever the shuffle. */
export function lastOptionIndices(options: readonly string[]): number[] {
  const tail = /^\s*(вс[её] (выше)?перечисленн|вс[её] вариант|вс[её] ответы верн|все верн|ни од(ин|на|но|ни) из|ни одного|нет (верного|правильного)|оба (варианта|ответа|верн)|другое\b)/i;
  return options.map((option, index) => (tail.test(option) ? index : -1)).filter((index) => index >= 0);
}

/** A code-like line: braces, semicolons, operators or a keyword, and few Cyrillic letters. */
export function codeLike(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  const letters = text.match(/[a-zа-яё]/gi) ?? [];
  const cyrillic = text.match(/[а-яё]/gi) ?? [];
  if (letters.length > 0 && cyrillic.length / letters.length > 0.5) return false;
  if (/^\s{2,}|\t/.test(line)) return true;
  if (/[;{}]|=>|==|!=|\+\+|--|::|<\/?\w+>|\w\(.*\)|\[\d*\]|^#|^\/\//.test(text)) return true;
  return /^(int|var|let|const|string|bool|double|float|char|long|class|struct|public|private|protected|static|void|for|while|if|else|return|using|namespace|import|from|def|print|console|select|insert|update|delete|create|alter|drop|begin|end|function|new)\b/i.test(text);
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

/** The shown letters of the key: the file indices of the key at their places on the screen. */
export function keyLetters(item: TestItem, order: readonly number[]): string[] {
  const out: string[] = [];
  order.forEach((fileIndex, place) => {
    if (item.correct.includes(fileIndex)) out.push(copy.OPTION_LETTERS[place] ?? String(place + 1));
  });
  return out;
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

const HOURS_20 = 20 * 3_600_000;

function countableFrom(at: string | null, day: LocalDay | null, tz: string): number | null {
  if (!at || !day) return null;
  const started = Date.parse(at);
  if (!Number.isFinite(started)) return null;
  // The rule needs another local day and 20 hours: the later of the two moments.
  return Math.max(started + HOURS_20, midnightAfter(day, tz));
}

/**
 * The numbers of the end screen from the session's answers and the server's results (decision 49): what moved in the
 * figure, the first-try score, the errors, the answers that came too early and when they can count.
 */
export function summarize(records: StudyRecord[], results: ReadonlyMap<string, AnswerResult>, inFigureBefore: ReadonlySet<string>, tz: string): SessionSummary {
  const firsts = records.filter((record) => !record.retry);
  const seen = new Set(firsts.map((record) => record.id));
  const errors = new Set<string>();
  for (const record of firsts) if (!record.correct && !record.misclick) errors.add(record.id);
  let known = false;
  let gained = 0;
  let dropped = 0;
  let tooEarly = 0;
  let tooEarlyAt: number | null = null;
  let started = 0;
  let firstCountAt: number | null = null;
  const inFigure = new Set(inFigureBefore);
  for (const record of records) {
    const result = results.get(record.clientEventId);
    if (!result || (result.status !== 'saved' && result.status !== 'late')) continue;
    known = true;
    switch (result.step) {
      case 'two_days':
        gained += 1;
        inFigure.add(record.id);
        break;
      case 'miss':
        if (inFigure.has(record.id)) {
          dropped += 1;
          inFigure.delete(record.id);
        }
        break;
      case 'too_early': {
        tooEarly += 1;
        const at = countableFrom(result.state?.streak_at ?? null, result.state?.streak_day ?? null, tz);
        if (at !== null) tooEarlyAt = tooEarlyAt === null ? at : Math.max(tooEarlyAt, at);
        break;
      }
      case 'start': {
        started += 1;
        const at = countableFrom(result.state?.streak_at ?? null, result.state?.streak_day ?? null, tz);
        if (at !== null) firstCountAt = firstCountAt === null ? at : Math.min(firstCountAt, at);
        break;
      }
      default:
        break;
    }
  }
  return {
    questions: seen.size,
    retries: records.length - firsts.length,
    firstRight: firsts.filter((record) => record.correct && !record.misclick).length,
    errors: errors.size,
    known,
    gained,
    dropped,
    tooEarly,
    tooEarlyAt,
    started,
    firstCountAt,
  };
}

/** «после 17:00» when the moment is later today; null (= «завтра») when it is on another day or early in the morning. */
export function laterToday(ms: number | null, today: LocalDay, tz: string): string | null {
  if (ms === null) return null;
  const at = hourAfter(ms, tz);
  return at.day === today ? at.time : null;
}

/** The time of tomorrow's first count («завтра после 17:00»), or null for «завтра» alone. */
export function tomorrowTime(ms: number | null, today: LocalDay, tz: string): string | null {
  if (ms === null) return null;
  const at = hourAfter(ms, tz);
  if (at.day !== addDay(today, 1) || at.hour < 10) return null;
  return at.time;
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
