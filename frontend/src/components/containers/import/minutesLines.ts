/**
 * The line under «Время в день» (the exam's «Настройки» and the import form; Concept 2 §3.6, spec decision 59): the
 * plan's own words (lib/containers/words.ts) for what the minutes reach by the date.
 *
 * - The minutes are enough: «Чтобы увидеть все 960 вопросов к 28 октября, нужно около 70 минут в день.» (`need`).
 * - They fall short: «При 45 минутах к 28 октября вы увидите около 700 из 960. Чтобы увидеть все, нужно около 75 минут.»
 *   (`short`), or at 90 minutes, when even they are not enough, `short_max`. Like planDay: short_max only when the
 *   chosen minutes are 90, so the line never names minutes the student did not choose.
 * - One date for the whole exam: the final days without new questions in full (`window_detail`; the plan card's
 *   `window_ahead` says it in one line), under «Подробнее». Days and minutes are the study days' (settings.study_weekdays).
 *
 * The date is the last one ahead among the subjects with questions in the plan; the count is the questions of the
 * subjects whose date is still ahead (or have none), as the plan counts them. When the exam holds more questions than
 * that (`input.examQuestions`: oral ones waiting for lectures, ones without a key, a subject after its date), the line
 * says what it counts: «Чтобы увидеть все 50 вопросов в плане к 21 октября…» (usability check 2026-10-10, m6: «все 50»
 * under an exam of 54). No date, nothing to see, or an estimate that fails: no line.
 */
import { feasibility, windowDays } from '../../../lib/containers/plan';
import { localDay, studyDayBefore, studyMask } from '../../../lib/containers/time';
import { lineText } from '../../../lib/containers/words';
import type { PlanInput } from '../../../types/container';

export interface MinutesLines {
  /** `need`, `short` or `short_max`. */
  line: string;
  /** The final days without new questions, when the exam has one date. */
  window: string | null;
  /** The smallest of 30 / 45 / 60 / 90 minutes that is enough, or null when even 90 is not. */
  option: 30 | 45 | 60 | 90 | null;
  /** The chosen minutes fall short. */
  short: boolean;
}

const ceil5 = (n: number) => Math.max(0, Math.ceil(n / 5) * 5);
/** «около 700»: a forecast to the tens (the estimate is ±10 %, Concept 2 §3.6). */
const about = (n: number) => (n >= 100 ? Math.floor(n / 10) * 10 : Math.max(0, Math.round(n)));

export function minutesLines(input: PlanInput | null, minutes: number): MinutesLines | null {
  if (!input) return null;
  try {
    const today = localDay(input.now, input.tz);
    const inPlan = new Set(input.items.map((item) => item.s));
    const ahead = input.subjects.filter((subject) => inPlan.has(subject.id) && (subject.date === null || subject.date > today));
    const dates = ahead.map((subject) => subject.date).filter((date): date is string => Boolean(date));
    if (dates.length === 0) return null;
    const ids = new Set(ahead.map((subject) => subject.id));
    const total = new Set(input.items.filter((item) => ids.has(item.s)).map((item) => item.id)).size;
    if (total === 0) return null;
    const last = dates.reduce((latest, date) => (date > latest ? date : latest));

    const at = feasibility({ ...input, budgetMin: minutes });
    const needed = ceil5(at.neededMin);
    if (needed <= 0) return null;
    // Short only when the minutes are below the need and the estimate falls below the count; «около» rounds the
    // estimate down to tens only then, so 476 of 476 never reads as «около 470 из 476».
    const reach = Math.min(total, Math.max(0, at.seenByDateEst));
    const short = needed > minutes && reach < total;
    const seen = about(reach);
    // The exam's size (words.ts: «в плане» when it is more than the count).
    const size = typeof input.examQuestions === 'number' && Number.isFinite(input.examQuestions) ? Math.max(0, input.examQuestions) : total;
    const line = !short
      ? lineText({ key: 'need', n: [total, needed, size], day: last })
      : needed > 90 && minutes >= 90
        ? lineText({ key: 'short_max', n: [minutes, seen, total, size], day: last })
        : lineText({ key: 'short', n: [minutes, seen, total, needed, size], day: last });

    // The final days are the student's last study days before the date, as the plan counts them (plan.ts windowDays,
    // windowStart): the first of them is the W-th study day back.
    let window: string | null = null;
    if (ahead.every((subject) => subject.date === last)) {
      const mask = studyMask(input.studyWeekdays);
      const days = windowDays(input.firstPlanDay, last, mask);
      let from = last;
      for (let k = 0; k < days; k += 1) from = studyDayBefore(from, mask);
      if (days > 0) window = lineText({ key: 'window_detail', n: [days], day: from });
    }
    return { line, window, option: at.option, short };
  } catch {
    return null;
  }
}
