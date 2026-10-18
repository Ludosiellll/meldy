/**
 * The words «Контрольная» shares between the author's pages and the participant's page (spec 2026-10-16 part 2): the
 * errors of the quiz functions, the states, the settings' names. Each side keeps its own screen words next to it
 * (copyAuthor.ts, copyTake.ts).
 */

export const QUIZ = {
  name: 'Контрольная',
  names: 'Контрольные',
  defaultTitle: (date: string) => `Контрольная · ${date}`,
  minutes: (n: number) => `${n} ${plural(n, 'минута', 'минуты', 'минут')}`,
  questions: (n: number) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`,
  attempts: (n: number | null) => (n === null ? 'попыток сколько угодно' : `${n} ${plural(n, 'попытка', 'попытки', 'попыток')}`),
  noTimer: 'без ограничения времени',
  stateOpen: (until: string | null) => (until ? `Открыта до ${until}` : 'Открыта'),
  stateNotYet: (from: string) => `Откроется ${from}`,
  stateClosed: 'Закрыта',
} as const;

/** Russian words of the quiz functions' refusals (MC010–MC018 by their detail; the rest come from api/containers). */
export const QUIZ_ERRORS = {
  MC010: 'В экзамене уже 50 контрольных. Удалите старые, чтобы создать новую.',
  MC011: 'Эту настройку уже не поменять: контрольную начали писать.',
  MC012: 'Время вышло: ответы больше не принимаются.',
  MC013_not_yet: 'Контрольная ещё не открыта.',
  MC013_closed: 'Контрольная закрыта.',
  MC013_no_questions: 'В выбранных предметах нет вопросов с ключом.',
  MC014_attempts: 'Попытки закончились.',
  MC014_full: 'В контрольной больше нет мест.',
  MC015: 'Эта контрольная только для участников экзамена.',
  MC016_busy: 'Слишком много начатых попыток. Подождите минуту и попробуйте снова.',
  MC017_guests: 'Чтобы писать эту контрольную, войдите в аккаунт.',
  MC018_practice: 'Автор не предлагает тренироваться по этому экзамену.',
  MC018_removed: 'Автор убрал вас из этого экзамена.',
  MC018_full: 'В экзамене больше нет мест для участников.',
  MC018_open: 'Тренировка по всем вопросам откроется, когда контрольная закроется.',
  unfinished: 'Попытка ещё не закончена.',
} as const;

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
