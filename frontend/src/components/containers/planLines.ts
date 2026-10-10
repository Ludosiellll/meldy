import type { DayPlan } from '../../types/container';
import { figureLines, lineText, planLine } from '../../lib/containers/words';

/**
 * The plan's own lines (lib/containers/words.ts renders them) on the exam's pages:
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

function text(line: DayPlan['lines'][number]): string {
  try {
    return lineText(line);
  } catch {
    return '';
  }
}

/** The plan's lines for the card: notes (with their links) and the link-only lines, in the plan's order. */
export function planLineViews(plan: DayPlan | null): LineView[] {
  if (!plan) return [];
  const out: LineView[] = [];
  for (const [index, line] of plan.lines.entries()) {
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

/** While the figure is 0: «Первые войдут в счёт завтра после 17:00 — если снова ответите верно» (decision 40). */
export function firstCountText(plan: DayPlan | null): string | null {
  if (!plan || plan.figure.twoDays > 0) return null;
  const line = plan.lines.find((entry) => entry.key === 'first_count');
  if (line) {
    const words = text(line);
    if (words) return words;
  }
  try {
    const lines = figureLines(plan.figure, plan.firstCountDay);
    return [lines.label, lines.under].find((value): value is string => typeof value === 'string' && value.startsWith('Первые')) ?? null;
  } catch {
    return null;
  }
}
