/**
 * A stand-in for lib/containers/words.ts in tests (package D2 builds the real one in parallel): the same names and the
 * same Russian lines for the keys the screens use, so a screen test reads like the product.
 */
import type { DayPlan, LocalDay } from '../../../types/container';

export const TWO_DAYS = 'верно в два разных дня';
const NB = String.fromCharCode(0xa0);
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 14) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
const q = (n: number) => `${n}${NB}${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;
const minGen = (n: number) => `${n}${NB}${plural(n, 'минуты', 'минут', 'минут')}`;

export function dayText(day: LocalDay): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d}${NB}${MONTHS[m - 1]}`;
}

function shown(sec: number): number {
  const min = Math.max(0, sec) / 60;
  if (min < 10) return Math.max(1, Math.round(min));
  return Math.round(min / 5) * 5;
}

export function lineText(line: DayPlan['lines'][number]): string {
  const n = (i: number) => (line.n ? line.n[i] ?? 0 : 0);
  switch (line.key) {
    case 'later':
      return `Ещё ${q(n(0))} — после ${line.time ?? ''}`;
    case 'first_count':
      return `Первые войдут в счёт ${n(0) === 1 ? 'завтра' : dayText(line.day ?? '2026-10-11')}${line.time ? ` после ${line.time}` : ''} — если снова ответите верно`;
    case 'skip':
      return `Вчера без занятий. Сегодня те же ${n(1)}${NB}минут — больше знакомых вопросов.`;
    case 'short':
      return `При ${n(0)}${NB}минутах к ${dayText(line.day ?? '2026-10-28')} вы увидите около ${n(1)} из ${n(2)}. Чтобы увидеть все, нужно около ${minGen(n(3))}.`;
    case 'window_ahead':
      return `С ${dayText(line.day ?? '2026-10-24')} новых вопросов не будет: последние ${n(0)}${NB}дня — только знакомые, сначала ошибки.`;
    case 'exam_today':
      return 'Сегодня экзамен.';
    case 'exam_errors':
      return `${q(n(0))}, где были ошибки`;
    case 'after':
      return `Экзамен прошёл ${dayText(line.day ?? '2026-10-28')}.`;
    case 'no_date':
      return `Без даты — по ${n(0)} новых в день на предмет.`;
    case 'more_new':
      return `Ещё ${n(0)} новых`;
    case 'oral_no_lectures':
      return `Ещё ${n(0)} устных войдут в план, когда к предмету будут лекции.`;
    case 'done':
      return `На сегодня всё: ${q(n(0))}.`;
    case 'nothing':
      return 'На сегодня всё.';
    default:
      return '';
  }
}

export function planLine(plan: DayPlan): string {
  const done = plan.lines.find((line) => line.key === 'done');
  switch (plan.state) {
    case 'study':
      return `Сегодня около ${minGen(shown(plan.counts.leftSec))}`;
    case 'done':
      return done ? lineText(done) : 'На сегодня всё.';
    case 'nothing':
      return 'На сегодня всё.';
    case 'exam_today':
      return 'Сегодня экзамен.';
    case 'after': {
      const after = plan.lines.find((line) => line.key === 'after');
      return after ? lineText(after) : '';
    }
    default:
      return '';
  }
}

export function figureLines(figure: DayPlan['figure'], firstCountDay: LocalDay | null): { big: string; of: string; label: string; under: string | null } {
  const under = figure.seen > 0 ? `Видели ${figure.seen} · ошибок сейчас ${figure.errors}` : null;
  if (figure.twoDays > 0) return { big: String(figure.twoDays), of: `из ${figure.inPlan}`, label: TWO_DAYS, under };
  if (figure.seen > 0 && firstCountDay) return { big: '', of: '', label: 'Первые войдут в счёт завтра — если снова ответите верно', under };
  return { big: '', of: '', label: 'В счёт идёт вопрос, на который вы ответили верно в два разных дня.', under };
}

export function startLabel(count: number, minutes: number | null, resume: { done: number; of: number } | null): string {
  const time = minutes !== null && minutes > 0 ? `, около ${minGen(minutes)}` : '';
  if (resume) return `Продолжить: ещё ${q(Math.max(0, resume.of - resume.done))}${time}`;
  return `Начать: ${q(count)}${time}`;
}
