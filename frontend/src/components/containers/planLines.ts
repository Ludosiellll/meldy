import type { DayPlan, LocalDay, PlanInput } from '../../types/container';
import { NO_DATE_NEW_PER_DAY, feasibility } from '../../lib/containers/plan';
import { figureLines, lineText, planDetail, planLine, planTitle, startLabel } from '../../lib/containers/words';
import { dayDiff } from './model';
import { glue, q } from './copy';

/**
 * The plan's own lines (lib/containers/words.ts renders them) on the exam's pages; the lines the plan does not make
 * (`oral_no_lectures`, `need`, `pace_faster`, `pace_slower`) are built by the screens and rendered the same way:
 * - the lines of the day's state («На сегодня всё…», «Сегодня экзамен.», «Экзамен прошёл…») are the card's title, not
 *   a note; «Первые войдут в счёт завтра после 17:00 — если снова ответите верно» is the figure's line (decision 40);
 * - a line may carry one link: the minutes that fall short → «Изменить время»; no date → «Указать дату»; oral questions
 *   without lectures → «Добавить лекции»; «Ещё 20 новых» and «20 вопросов, где были ошибки» are links themselves.
 * The keys are lib/containers/words.ts LINE_KEYS (package D2); a line of an unknown key is shown as it is, without a
 * link. Every call is guarded: a plan the engine could not word shows no line rather than breaking the page.
 */
export type LineAction = 'minutes' | 'date' | 'lectures' | 'more_new' | 'errors' | null;

export interface LineView {
  key: string;
  /** The plan's key («short», «no_date», …). */
  kind: string;
  text: string;
  action: LineAction;
  /** The whole line is the link (its text is the link's words). */
  linkOnly: boolean;
}

type Line = DayPlan['lines'][number];

/** Lines that are not notes: the state's own line (the title) and the figure's first-count line. */
const NOT_NOTES = new Set(['first_count', 'done', 'nothing', 'after', 'exam_today']);
/** Lines that are links on their own. */
const LINK_ONLY = new Set(['more_new', 'exam_errors']);

export function lineAction(key: string): LineAction {
  const k = key.toLowerCase();
  if (k === 'exam_errors') return 'errors';
  if (/more_?new|extra_new/.test(k)) return 'more_new';
  if (/^short|short_max|^need|feasib|budget|minutes/.test(k)) return 'minutes';
  if (/no_?date|nodate|date_missing|set_date/.test(k)) return 'date';
  if (/lecture|oral_no|no_points/.test(k)) return 'lectures';
  return null;
}

/** A line in words ('' when the words cannot say it). */
export function text(line: Line): string {
  try {
    return lineText(line);
  } catch {
    return '';
  }
}

/** The plan's lines for the card: notes (with their links) and the link-only lines, in the plan's order. */
export function planLineViews(plan: DayPlan | null): LineView[] {
  return lineViews(plan?.lines ?? []);
}

/** Lines of the plan or of one subject (plan.ts subjectInfo) as views. */
export function lineViews(lines: readonly Line[]): LineView[] {
  const out: LineView[] = [];
  for (const [index, line] of lines.entries()) {
    if (NOT_NOTES.has(line.key)) continue;
    const words = text(line);
    if (words) out.push({ key: `${line.key}-${index}`, kind: line.key, text: words, action: lineAction(line.key), linkOnly: LINK_ONLY.has(line.key) });
  }
  return out;
}

/** «На сегодня всё. Завтра около 40 минут.» and the other one-line states of the plan. */
export function planText(plan: DayPlan): string {
  try {
    return planLine(plan);
  } catch {
    return '';
  }
}

/** The card's title in the plan's words: «Сегодня 90 вопросов, около 45 минут» (words.ts planTitle). */
export function titleText(plan: DayPlan): string {
  try {
    return planTitle(plan);
  } catch {
    return '';
  }
}

/** «30 новых и 60 знакомых» (words.ts planDetail). */
export function detailText(plan: DayPlan): string {
  try {
    return planDetail(plan);
  } catch {
    return '';
  }
}

export interface FigureWords {
  big: string;
  of: string;
  label: string;
  under: string | null;
}

/**
 * The figure in the plan's words (words.ts figureLines): «143», «из 960», «верно в два разных дня» and «Видели 410 ·
 * ошибок сейчас 37»; while it is 0, the dated first-count line (decision 40) with its time from the plan's
 * `first_count` line, or the rule before any answer.
 */
export function figureWords(
  figure: { twoDays: number; total: number; seen: number; errors: number },
  plan: DayPlan | null,
  today: LocalDay,
): FigureWords | null {
  const first = plan?.lines.find((line) => line.key === 'first_count');
  try {
    return figureLines(
      { inPlan: figure.total, twoDays: figure.twoDays, seen: figure.seen, errors: figure.errors, selfKnow: plan?.figure.selfKnow ?? 0 },
      plan?.firstCountDay ?? first?.day ?? null,
      { today, time: first?.time ?? null },
    );
  } catch {
    return null;
  }
}

/** While the figure is 0: «Первые войдут в счёт завтра после 17:00 — если снова ответите верно» (decision 40). */
export function firstCountText(plan: DayPlan | null): string | null {
  if (!plan || plan.figure.twoDays > 0 || plan.figure.seen === 0) return null;
  const words = figureWords({ twoDays: 0, total: plan.figure.inPlan, seen: plan.figure.seen, errors: plan.figure.errors }, plan, plan.day);
  return words && words.label.startsWith('Первые') ? words.label : null;
}

/** The options of «Время в день». */
const OPTIONS = [30, 45, 60, 90] as const;

export interface PaceNote {
  line: Line;
  /** The minutes «Поставить» sets. */
  option: number;
  budget: number;
  /** 1 after the first 20 answers, 2 from the 7th day: each told once. */
  stage: number;
}

/**
 * The re-estimate of the time a day at the student's own pace (Concept 2 §3.6), told once after the first 20 answers
 * and once more from the 7th day: «Вы отвечаете быстрее, чем мы считали: хватит 45 минут в день.» or «…медленнее…:
 * нужно около 80 минут в день.», with «Поставить 45» / «Оставить 60». The plan does not make these lines
 * (`pace_faster`, `pace_slower`); the feasibility at the student's pace is plan.ts `feasibility`.
 */
export function paceNote(p: { input: PlanInput | null; plan: DayPlan | null; budget: number; firstPlanDay: LocalDay }): PaceNote | null {
  const { input, plan, budget, firstPlanDay } = p;
  if (!input || !plan || plan.state !== 'study' || !input.pace || plan.figure.seen < 20) return null;
  let fit: ReturnType<typeof feasibility>;
  try {
    fit = feasibility(input);
  } catch {
    return null;
  }
  if (!(fit.neededMin > 0)) return null;
  const option = fit.option ?? OPTIONS[OPTIONS.length - 1];
  if (option === budget) return null;
  const stage = (dayDiff(firstPlanDay, plan.day) ?? 0) >= 7 ? 2 : 1;
  if (option < budget) return { line: { key: 'pace_faster', n: [option] }, option, budget, stage };
  return { line: { key: 'pace_slower', n: [fit.neededMin] }, option, budget, stage };
}

/** The pill's words (words.ts startLabel): «Начать: 20 вопросов», «Продолжить: ещё 8 вопросов», «Ответить вслух: 3 вопроса». */
export function safeStart(count: number, minutes: number | null, resume: { done: number; of: number } | null, kind?: DayPlan['sessions'][number]['kind']): string {
  try {
    return startLabel(count, minutes, resume, kind);
  } catch {
    return glue(resume ? `Продолжить: ещё ${q(Math.max(1, count))}` : `Начать: ${q(count)}`);
  }
}

/** «Без даты — по 15 новых в день на предмет.» (the plan's `no_date` line) for an exam or a subject without a date. */
export function noDateText(): string {
  return text({ key: 'no_date', n: [NO_DATE_NEW_PER_DAY] });
}
