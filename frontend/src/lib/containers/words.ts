/**
 * Every Russian line the plan makes the UI say (package D2; spec §3 words, §15 #32/#35/#39/#40, §16 #45/#55, the design
 * critique's table). A test fails on banned words, here and in every rendered line. Screens render `DayPlan.lines`
 * through `lineText`; screen-only strings live in components/containers/copy.ts.
 *
 * Numbers are glued to their words with a no-break space. Comments in this file stay in English on purpose: the
 * banned-word test reads the source.
 */
import type { DayPlan, LocalDay } from '../../types/container.ts';
import { addDays, dayIndex, daysBetween, studyDayFrom, weekday } from './time.ts';

export const TWO_DAYS = 'верно в два разных дня';
export const NBSP = ' ';
/** The figure card before the first counted question («Как считается» explains the rest). */
export const RULE_LINE = 'В счёт идёт вопрос, на который вы ответили верно в два разных дня.';
/** «План по дням», under the rows. */
export const SKIP_NOTE = 'Если пропустите день, его вопросы перейдут на следующие.';

/** Every key `DayPlan.lines` (and `subjectInfo().lines`) can carry. */
export const LINE_KEYS = [
  'later', 'first_count', 'skip', 'short', 'short_max', 'need', 'window_ahead', 'window_detail', 'window_in', 'exam_today',
  'exam_errors', 'after', 'no_date', 'first_day', 'more_new', 'ai_limit', 'oral', 'oral_no_lectures', 'done', 'nothing',
  'day_off', 'pace_faster', 'pace_slower', 'all', 'fast_all', 'fast_days',
] as const;
export type LineKey = typeof LINE_KEYS[number];
type Line = DayPlan['lines'][number];

/** Russian plural: one (1, 21), few (2–4, 22–24), many (0, 5–20, 11–14). */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 14) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** «20 вопросов»: the number glued to its word. */
export function glue(n: number, one: string, few: string, many: string): string {
  return `${n}${NBSP}${plural(n, one, few, many)}`;
}

const questions = (n: number) => glue(n, 'вопрос', 'вопроса', 'вопросов'); // nominative / accusative
const minutesGen = (n: number) => glue(n, 'минуты', 'минут', 'минут'); // «около 45 минут»
const minutesAcc = (n: number) => glue(n, 'минуту', 'минуты', 'минут'); // «за 61 минуту»
const minutesNom = (n: number) => glue(n, 'минута', 'минуты', 'минут'); // «те же 60 минут»
const minutesPrep = (n: number) => glue(n, 'минуте', 'минутах', 'минутах'); // «при 45 минутах»
/** From 3 hours a time reads in hours, to the half hour: «около 7,5 часа», «около 7 часов» («Все вопросы»). */
const HOURS_FROM_MIN = 180;
function hours(min: number, one: string, few: string, many: string): string {
  const h = Math.round(min / 30) / 2;
  // A half hour reads «7,5 часа» in either case.
  return Number.isInteger(h) ? glue(h, one, few, many) : `${String(h).replace('.', ',')}${NBSP}часа`;
}
/** «около 45 минут», «около 7,5 часа» (genitive). */
export const durationGen = (min: number) => (min >= HOURS_FROM_MIN ? hours(min, 'часа', 'часов', 'часов') : minutesGen(min));
/** «за 61 минуту», «за 7 часов» (accusative). */
const durationAcc = (min: number) => (min >= HOURS_FROM_MIN ? hours(min, 'час', 'часа', 'часов') : minutesAcc(min));
const days = (n: number) => glue(n, 'день', 'дня', 'дней');

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/** «в понедельник» … «в воскресенье» (a day within the coming week). */
const WEEKDAYS_ON = ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'];

/** '11 октября' */
export function dayText(day: LocalDay): string {
  dayIndex(day); // throws on a malformed day
  const [, m, d] = day.split('-').map(Number);
  return `${d}${NBSP}${MONTHS[m - 1]}`;
}

/** 'Сб, 10 октября' */
export function weekdayText(day: LocalDay): string {
  return `${WEEKDAYS[weekday(day)]}, ${dayText(day)}`;
}

/** '24–27 октября', '30 октября – 2 ноября' */
export function rangeText(from: LocalDay, to: LocalDay): string {
  if (from === to) return dayText(from);
  const [, m1, d1] = from.split('-').map(Number);
  const [, m2] = to.split('-').map(Number);
  if (m1 === m2 && from.slice(0, 4) === to.slice(0, 4)) return `${d1}–${dayText(to)}`;
  return `${dayText(from)} – ${dayText(to)}`;
}

/** 'сегодня', 'завтра' or '14 октября' for a day `offset` days from today. */
function relDay(offset: number | undefined, day: LocalDay | undefined): string {
  if (offset === 0) return 'сегодня';
  if (offset === 1) return 'завтра';
  return day ? dayText(day) : '';
}

/** 'завтра', 'в понедельник' (within the coming week) or '14 октября' for a day `offset` days from today. */
function weekDay(offset: number | undefined, day: LocalDay | undefined): string {
  if (day && typeof offset === 'number' && offset >= 2 && offset <= 6) return WEEKDAYS_ON[weekday(day)];
  return relDay(offset, day);
}

/**
 * When the plan brings back what was answered `today` (a mistake, a misclick): its first study day after `today`
 * (`mask`, settings.study_weekdays) as 'завтра', 'в понедельник' (2–6 days ahead) or '16 октября' (a week ahead: the
 * one study day of the week is today's weekday). Every day (127): always 'завтра'.
 */
export function nextStudyDayWord(today: LocalDay, mask: number): string {
  const next = studyDayFrom(addDays(today, 1), mask);
  return weekDay(daysBetween(today, next), next);
}

/** Minutes shown for an estimate: 1 at least, to the minute below 10, else to 5. */
export function shownMinutes(sec: number): number {
  const min = Math.max(0, sec) / 60;
  if (min <= 0) return 0;
  if (min < 10) return Math.max(1, Math.round(min));
  return Math.round(min / 5) * 5;
}

function nth(line: Line, i: number): number {
  const v = line.n ? line.n[i] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * « в плане» when the line's count (`n[count]`) is smaller than the exam's size the screen added at `n[size]` (all its
 * questions, as the exam's meta says them): a line about what the plan brings by the date names what it counts.
 */
function inPlan(line: Line, count: number, size: number): string {
  return nth(line, size) > nth(line, count) ? ' в плане' : '';
}

/** «Первые войдут в счёт завтра после 17:00 — если снова ответите верно» (decision 40). */
export function firstCountText(when: string, time: string | null | undefined): string {
  const at = time ? ` после ${time}` : '';
  return `Первые войдут в счёт ${when}${at} — если снова ответите верно`;
}

/** One of `DayPlan.lines` as text ('' for an unknown key). */
export function lineText(line: Line): string {
  switch (line.key as LineKey) {
    case 'later':
      return `Ещё ${questions(nth(line, 0))} — после ${line.time ?? ''}`.trimEnd();
    case 'first_count':
      return firstCountText(relDay(line.n ? line.n[0] : undefined, line.day), line.time);
    case 'skip': {
      // The study days missed; `day` (the last of them) when it was not yesterday: a day off came after it.
      const gap = nth(line, 0);
      const head = gap <= 1 && !line.day ? 'Вчера без занятий.' : `${days(Math.max(1, gap))} без занятий.`;
      return `${head} Сегодня те же ${minutesNom(nth(line, 1))} — больше знакомых вопросов.`;
    }
    // What the minutes reach by the date counts the questions in the plan; when the screen says the exam holds more
    // (its size after the count: oral ones waiting for lectures, ones without a key), the line says «в плане».
    case 'short':
      return `При ${minutesPrep(nth(line, 0))} к ${dayText(line.day ?? '')} вы увидите около ${nth(line, 1)} из ${nth(line, 2)}${inPlan(line, 2, 4)}. `
        + `Чтобы увидеть все, нужно около ${durationGen(nth(line, 3))}.`;
    case 'short_max':
      // The way out is the choice after 90 (plan.ts ALL_QUESTIONS_MIN): the owner met a dead end here (2026-10-14).
      return `Даже при ${minutesPrep(nth(line, 0))} в день к ${dayText(line.day ?? '')} вы увидите около ${nth(line, 1)} из ${nth(line, 2)}${inPlan(line, 2, 3)}. `
        + 'Чтобы увидеть все, выберите «Все вопросы».';
    case 'need':
      return `Чтобы увидеть все ${questions(nth(line, 0))}${inPlan(line, 0, 2)} к ${dayText(line.day ?? '')}, нужно около ${durationGen(nth(line, 1))} в день.`;
    // «Все вопросы» under «Время в день»: n = [count, new a day, minutes a day, the exam's size]; `day` the last day of
    // new questions when the exam has one date. With nothing new left, only what comes back.
    case 'all': {
      const perDay = nth(line, 1);
      const time = `около ${durationGen(nth(line, 2))} в${NBSP}день`;
      if (perDay <= 0) return `Новых вопросов не осталось: ошибки и вторая проверка, ${time}.`;
      const by = line.day ? ` — к ${dayText(line.day)}` : '';
      return `Все ${questions(nth(line, 0))}${inPlan(line, 0, 3)}${by}: около ${perDay} новых в${NBSP}день, ${time}.`;
    }
    // «Как можно быстрее» under «Время в день» (plan.ts fastForecast). On «Все вопросы»: n = [count, minutes, the exam's
    // size, days to that day] — everything on the first study day; with minutes: n = [minutes, count, study days, the
    // exam's size, days to that day], `day` the day the last new question comes up.
    case 'fast_all': {
      const when = relDay(nth(line, 3), line.day);
      return `Все ${questions(nth(line, 0))}${inPlan(line, 0, 2)} — ${when}: около ${durationGen(nth(line, 1))}. `
        + 'На следующий день — повтор тех, на которые ответили верно.';
    }
    case 'fast_days': {
      const when = nth(line, 2) <= 1 ? relDay(nth(line, 4), line.day) : `к ${dayText(line.day ?? '')} — за ${days(nth(line, 2))} занятий`;
      return `При ${minutesPrep(nth(line, 0))} в${NBSP}день все ${questions(nth(line, 1))}${inPlan(line, 1, 3)} вы увидите ${when}.`;
    }
    case 'window_ahead':
      // The plan card's note: one line on a phone from day 1 (usability check, m9). What those days hold is the row
      // of «План по дням» and, under «Время в день», `window_detail`.
      return `С ${dayText(line.day ?? '')} новых вопросов не будет.`;
    case 'window_detail': {
      const w = nth(line, 0);
      const last = w <= 1 ? 'последний день' : `последние ${days(w)}`;
      return `С ${dayText(line.day ?? '')} новых вопросов не будет: ${last} — только знакомые, сначала ошибки.`;
    }
    case 'window_in':
      return `До экзамена ${days(nth(line, 0))}: новых нет, только знакомые.`;
    case 'exam_today':
      return 'Сегодня экзамен.';
    case 'exam_errors': {
      const k = nth(line, 0);
      return `${questions(k)}, где ${k === 1 ? 'была ошибка' : 'были ошибки'}`;
    }
    case 'after':
      return `Экзамен прошёл ${dayText(line.day ?? '')}.`;
    case 'no_date':
      return `Без даты — по ${nth(line, 0)} новых в день на предмет.`;
    case 'first_day':
      return 'Время уточнится после первых 20 ответов.';
    case 'more_new':
      return `Ещё ${glue(nth(line, 0), 'новый', 'новых', 'новых')}`;
    case 'ai_limit':
      return `Лимит ИИ на сегодня закончился. Проверка вернётся в ${line.time ?? '3:00'}.`;
    case 'oral': {
      const parts: string[] = [];
      if (nth(line, 0) > 0) parts.push(`${nth(line, 0)} сверить с пунктами`);
      if (nth(line, 1) > 0) parts.push(`${nth(line, 1)} ответить вслух с проверкой`);
      const units = nth(line, 2) > 0 ? ` — ${glue(nth(line, 2), 'единица', 'единицы', 'единиц')} ИИ` : '';
      return `Устные: ${parts.join(', ')}${units}.`;
    }
    case 'oral_no_lectures':
      return `Ещё ${nth(line, 0)}${NBSP}${plural(nth(line, 0), 'устный войдёт', 'устных войдут', 'устных войдут')} в план, когда к предмету будут лекции.`;
    case 'done': {
      const min = nth(line, 1);
      return min > 0 ? `На сегодня всё: ${questions(nth(line, 0))} за ${durationAcc(min)}.` : `На сегодня всё: ${questions(nth(line, 0))}.`;
    }
    case 'nothing':
      return line.day ? `На сегодня всё. Следующие вопросы — ${relDay(line.n ? line.n[0] : undefined, line.day)}.` : 'На сегодня всё.';
    case 'day_off': {
      // Not one of the student's days of the week: no plan today (it can still study: «Ещё 20 новых»).
      const when = line.day ? weekDay(line.n ? line.n[0] : undefined, line.day) : '';
      // The dash stays with the word before it: a line never starts with «—».
      return when ? `Сегодня выходной. Следующие вопросы${NBSP}— ${when}.` : 'Сегодня выходной.';
    }
    case 'pace_faster':
      return `Вы отвечаете быстрее, чем мы считали: хватит ${minutesGen(nth(line, 0))} в день.`;
    case 'pace_slower':
      return `Вы отвечаете медленнее, чем мы считали: нужно около ${durationGen(nth(line, 0))} в день.`;
    default:
      return '';
  }
}

function findLine(plan: DayPlan, key: LineKey): Line | undefined {
  return plan.lines.find((l) => l.key === key);
}

function todayCount(plan: DayPlan): number {
  return plan.counts.newItems + plan.counts.reviews + plan.counts.oral;
}

/** «30 новых и 60 знакомых» (and «и 12 устных»): what today's questions are. */
export function planDetail(plan: DayPlan): string {
  const c = plan.counts;
  const parts: string[] = [];
  if (c.newItems > 0) parts.push(glue(c.newItems, 'новый', 'новых', 'новых'));
  if (c.reviews > 0) parts.push(glue(c.reviews, 'знакомый', 'знакомых', 'знакомых'));
  if (c.oral > 0) parts.push(glue(c.oral, 'устный', 'устных', 'устных'));
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}`;
}

/** The status card's title: «Сегодня 90 вопросов, около 45 минут» (or the left / done / nothing / exam-day forms). */
export function planTitle(plan: DayPlan): string {
  const left = shownMinutes(plan.counts.leftSec);
  switch (plan.state) {
    case 'study': {
      const n = todayCount(plan);
      const partly = plan.counts.estSec > plan.counts.leftSec;
      const time = left > 0 ? `, около ${durationGen(left)}` : '';
      return partly ? `Сегодня осталось ${questions(n)}${time}` : `Сегодня ${questions(n)}${time}`;
    }
    case 'done': {
      const done = findLine(plan, 'done');
      return done ? lineText(done).replace(/\.$/, '') : 'На сегодня всё';
    }
    case 'nothing':
      return findLine(plan, 'day_off') ? 'Сегодня выходной' : 'На сегодня всё';
    case 'exam_today':
      return 'Сегодня экзамен';
    case 'after': {
      const after = findLine(plan, 'after');
      return after ? lineText(after).replace(/\.$/, '') : '';
    }
    default:
      return '';
  }
}

/** «Сегодня около 45 минут: 30 новых и 60 знакомых» (or the done / nothing / exam-day variants). */
export function planLine(plan: DayPlan): string {
  switch (plan.state) {
    case 'study': {
      const left = shownMinutes(plan.counts.leftSec);
      if (plan.counts.estSec > plan.counts.leftSec) {
        return `Сегодня осталось ${questions(todayCount(plan))}${left > 0 ? `, около ${durationGen(left)}` : ''}.`;
      }
      return `Сегодня около ${durationGen(Math.max(1, left))}: ${planDetail(plan)}`;
    }
    case 'done': {
      const done = findLine(plan, 'done');
      return done ? lineText(done) : 'На сегодня всё.';
    }
    case 'nothing': {
      const nothing = findLine(plan, 'day_off') ?? findLine(plan, 'nothing');
      return nothing ? lineText(nothing) : 'На сегодня всё.';
    }
    case 'exam_today':
      return 'Сегодня экзамен.';
    case 'after': {
      const after = findLine(plan, 'after');
      return after ? lineText(after) : '';
    }
    default:
      return '';
  }
}

/** The main figure: «143», «из 960», «верно в два разных дня»; while it is 0, the dated first-count line. */
export function figureLines(figure: DayPlan['figure'], firstCountDay: LocalDay | null,
  options?: { today?: LocalDay; time?: string | null }): { big: string; of: string; label: string; under: string | null } {
  const under = figure.seen > 0 ? `Видели ${figure.seen} · ошибок сейчас ${figure.errors}` : null;
  if (figure.twoDays > 0) return { big: String(figure.twoDays), of: `из ${figure.inPlan}`, label: TWO_DAYS, under };
  if (figure.seen > 0 && firstCountDay) {
    const offset = options && options.today ? dayIndex(firstCountDay) - dayIndex(options.today) : undefined;
    return { big: '', of: '', label: firstCountText(relDay(offset, firstCountDay), options ? options.time : null), under };
  }
  return { big: '', of: '', label: RULE_LINE, under };
}

/** The list row of «Экзамены»: «Верно в два разных дня: 143 из 960». */
export function figureRow(figure: DayPlan['figure']): string {
  return `Верно в два разных дня: ${figure.twoDays} из ${figure.inPlan}`;
}

/**
 * The main button: «Начать: 20 вопросов» (phone) / «Начать: 20 вопросов, около 9 минут» (laptop),
 * «Продолжить: ещё 8 вопросов», «Ответить вслух: 3 вопроса» (an AI-check session).
 */
export function startLabel(count: number, minutes: number | null, resume: { done: number; of: number } | null,
  kind?: 'answer' | 'self_check' | 'ai_check'): string {
  const time = minutes !== null && minutes > 0 ? `, около ${durationGen(minutes)}` : '';
  if (resume) return `Продолжить: ещё ${questions(Math.max(0, resume.of - resume.done))}${time}`;
  if (kind === 'ai_check') return `Ответить вслух: ${questions(count)}${time}`;
  return `Начать: ${questions(count)}${time}`;
}

/** One row of «План по дням» (plan.ts `daysAhead`); days that hold oral questions say so («с устными»). */
export function dayRowText(row: { from: LocalDay; to: LocalDay; kind: 'study' | 'window' | 'exam'; minutes: number | null; oral?: boolean }): string {
  const when = rangeText(row.from, row.to);
  const oral = row.oral ? ', с устными' : '';
  if (row.kind === 'exam') return `${when} — экзамен`;
  if (row.kind === 'window') return `${when} — новых нет, только знакомые${oral}, сначала ошибки`;
  if (row.minutes === null) return `${when} — только знакомые${oral}`;
  return row.from === row.to ? `${when} — около ${durationGen(row.minutes)}${oral}` : `${when} — около ${durationGen(row.minutes)} в день${oral}`;
}
