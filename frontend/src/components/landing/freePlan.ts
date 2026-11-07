import { FREE_DAILY_UNITS } from '../../lib/plans';
import { perDay, plural } from '../pro/planCopy';

/**
 * What a free account gives, in one line, before sign-up (audit 2026-10-08, PUB-21: «Это бесплатно?» is a
 * newcomer's first question). Every number comes from lib/plans.ts: the free day's units, and how many lecture
 * analyses or checked answers they pay for. Nothing about payment.
 *
 * «Аккаунт бесплатный: лимит ИИ — 100 в день, это 5 лекций или 25 проверенных ответов.» (no «единицы» since the audit of
 * 07.11, as the limit window says it)
 */
export function freePlanLine(): string {
  const lectures = perDay(FREE_DAILY_UNITS, 'lecture');
  const answers = perDay(FREE_DAILY_UNITS, 'answer');
  return (
    `Аккаунт бесплатный: лимит ИИ\u00a0— ${FREE_DAILY_UNITS} в\u00a0день, это ` +
    `${lectures}\u00a0${plural(lectures, ['лекция', 'лекции', 'лекций'])} или\u00a0${answers}\u00a0${plural(answers, ['проверенный ответ', 'проверенных ответа', 'проверенных ответов'])}.`
  );
}
