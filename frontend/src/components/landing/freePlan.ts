import { FREE_DAILY_UNITS } from '../../lib/plans';
import { perDay, plural } from '../pro/planCopy';

/**
 * What a free account gives, in one line, before sign-up (audit 2026-10-08, PUB-21: «Это бесплатно?» is a
 * newcomer's first question). Every number comes from lib/plans.ts: the free day's units, and how many lecture
 * analyses or checked answers they pay for. Nothing about payment.
 *
 * «Аккаунт бесплатный: каждый день 100 единиц ИИ — это 5 лекций или 25 проверенных ответов.»
 */
export function freePlanLine(): string {
  const lectures = perDay(FREE_DAILY_UNITS, 'lecture');
  const answers = perDay(FREE_DAILY_UNITS, 'answer');
  return (
    `Аккаунт бесплатный: каждый день ${FREE_DAILY_UNITS} ${plural(FREE_DAILY_UNITS, ['единица', 'единицы', 'единиц'])} ИИ — это ` +
    `${lectures} ${plural(lectures, ['лекция', 'лекции', 'лекций'])} или ${answers} ${plural(answers, ['проверенный ответ', 'проверенных ответа', 'проверенных ответов'])}.`
  );
}
