/**
 * The participant's words of «Контрольная» (spec 2026-10-16 §2.2; release 47: a guest without an account, the
 * explanation in the review, «тренироваться дальше» — spec 2026-10-18 §47.1, §47.5): the page /k/<код> before the
 * start, the attempt and the result. Plain Russian, no exclamation marks; numbers keep the word after them (glue). The
 * words both sides share (the counts, the states, the refusals MC010–MC018) stay in copyQuiz.ts.
 */
import { glue } from '../containers/copy';
import { QUIZ, plural } from './copyQuiz';

const SEP = ' · ';

export const TAKE = {
  docTitle: QUIZ.name,
  kicker: QUIZ.name,
  loading: 'Открываем контрольную…',
  notFound: 'Такой контрольной нет. Проверьте ссылку.',
  failed: 'Не удалось открыть контрольную.',
  retry: 'Попробовать ещё раз',
  home: 'На главную',
  author: (name: string) => `автор: ${name}`,
  exam: (title: string) => `экзамен «${title}»`,
  /** «20 вопросов · 30 минут · открыта до 24 окт., 18:00 · 1 попытка». */
  meta(p: { items: number; minutes: number | null; window: string | null; attempts: number | null }): string {
    const parts = [QUIZ.questions(p.items), p.minutes === null ? QUIZ.noTimer : QUIZ.minutes(p.minutes)];
    if (p.window) parts.push(p.window);
    parts.push(QUIZ.attempts(p.attempts));
    return glue(parts.join(SEP));
  },
  openUntil: (when: string) => `открыта до ${when}`,
  opensAt: (when: string) => `откроется ${when}`,
  closedWord: 'закрыта',
  backAllowed: 'К вопросам можно возвращаться и менять ответы до «Завершить».',
  forwardOnly: 'Только вперёд: к прошлым вопросам вернуться нельзя.',
  passMark: (percent: number) => glue(`Проходной балл — ${percent} %.`),
  grading: {
    best: 'В зачёт идёт лучшая попытка.',
    last: 'В зачёт идёт последняя попытка.',
  },
  review: {
    score: 'После сдачи вы увидите свой балл.',
    mistakes: 'После сдачи вы увидите балл и где ошиблись.',
    answers: 'После сдачи вы увидите балл, ошибки и верные ответы.',
    mistakes_then_answers: 'После сдачи вы увидите балл и ошибки, а верные ответы — когда контрольная закроется.',
  },
  membersOnly: 'Писать могут только участники экзамена.',
  privacy: 'Автор увидит имя, которое вы укажете, ваши ответы и результат.',
  /** Without an account (release 47): the attempts live on this device, by its token. */
  guestPrivacy: 'Автор увидит имя, которое вы укажете, ваши ответы и результат. Попытки сохраняются в этом браузере.',
  haveAccount: 'Есть аккаунт?',
  signIn: 'Войти, чтобы начать',
  signInToSee: 'Войти и посмотреть свои результаты',
  register: 'Создать аккаунт',
  signInAgain: 'Вход закончился. Войдите снова — ответы, которые уже сохранились, останутся.',
  signInShort: 'Войти',
  nameLabel: 'Ваше имя для автора',
  nameHint: 'Например: Иванов Иван, гр. 21',
  nameBad: 'Имя — от 2 до 80 знаков.',
  start: 'Начать',
  resume: 'Продолжить',
  resumeNote: 'Вы уже начали эту попытку: ответы сохранены, время идёт.',
  authorNote: 'Это ваша контрольная. Ваша попытка будет отмечена «(вы)» и не войдёт в средний результат.',
  reason: {
    no_attempts: 'Попытки закончились.',
    members_only: 'Эта контрольная только для участников экзамена.',
    not_yet: (when: string | null) => (when ? glue(`Контрольная откроется ${when}.`) : 'Контрольная ещё не открыта.'),
    closed: 'Контрольная закрыта.',
  },
  pastTitle: 'Ваши попытки',
  pastRow: (n: number, correct: number, total: number, when: string) => glue(`Попытка ${n}${SEP}${correct} из ${total}${when ? `${SEP}${when}` : ''}`),
  see: 'Посмотреть',
  seeLabel: (n: number) => `Посмотреть попытку ${n}`,
} as const;

export const RUN = {
  /** The top line: «Контрольная · 3 из 20 · 24:13» (a phone keeps «3 из 20 · 24:13»). */
  barLong: (pos: number, total: number, clock: string | null) => glue([QUIZ.name, `${pos} из ${total}`, ...(clock ? [clock] : [])].join(SEP)),
  barShort: (pos: number, total: number, clock: string | null) => glue([`${pos} из ${total}`, ...(clock ? [clock] : [])].join(SEP)),
  finish: 'Завершить',
  next: 'Дальше',
  back: 'Назад',
  all: 'Все вопросы',
  cell: (n: number, answered: boolean) => `Вопрос ${n}${answered ? ', есть ответ' : ', без ответа'}`,
  forwardOnly: 'Только вперёд: к прошлым вопросам не вернуться.',
  saved: 'Сохранено',
  offline: 'Нет связи — ответы сохранятся, когда она вернётся',
  failing: 'Ответы пока не сохранились — пробуем ещё раз',
  resumed: (pos: number, total: number, left: string | null) =>
    glue(left ? `Попытка продолжается: ${pos} из ${total}, осталось ${left}.` : `Попытка продолжается: ${pos} из ${total}.`),
  finishTitle: 'Завершить контрольную?',
  /** «Отвечено 18 из 20, без ответа: 4, 17 — они считаются ошибками.» */
  finishLine(answered: number, total: number, missing: number[]): string {
    if (missing.length === 0) return glue(`Ответы есть на все ${QUIZ.questions(total)}. После этого их не изменить.`);
    const shown = missing.slice(0, 12);
    const more = missing.length - shown.length;
    const list = `${shown.join(', ')}${more > 0 ? ` и ещё ${more}` : ''}`;
    const tail = missing.length > 1 ? 'они считаются ошибками' : 'он считается ошибкой';
    return glue(`Отвечено ${answered} из ${total}, без ответа: ${list} — ${tail}.`);
  },
  backToQuestions: 'Вернуться к вопросам',
  sending: 'Сдаём ответы…',
  timeUp: 'Время вышло. Сдаём ответы…',
  endOffline: 'Нет связи — ответы сохранятся, когда она вернётся. Попробуем сдать ещё раз сами.',
  endFailed: 'Не удалось сдать ответы. Попробуем ещё раз сами.',
  retryEnd: 'Сдать ещё раз',
  lost: 'Этой попытки больше нет: автор её сбросил. Можно начать заново.',
} as const;

export const RESULT = {
  barLong: glue(`${QUIZ.name} · Результат`),
  barShort: 'Результат',
  close: 'Закрыть',
  attemptLine: (n: number, when: string) => glue(when ? `Попытка ${n}${SEP}${when}` : `Попытка ${n}`),
  /** «15 из 20 · 75 %». */
  score: (correct: number, total: number) => glue(`${correct} из ${total}`),
  percent: (percent: number) => glue(`${percent} %`),
  pass: (threshold: number, passed: boolean) => glue(`Порог ${threshold} % — ${passed ? 'сдано' : 'не сдано'}`),
  byTime: 'Время вышло — попытка закрылась сама. Вопросы без ответа считаются ошибкой.',
  byClose: 'Автор закрыл контрольную — попытка закрылась.',
  answersAfter: (when: string) => glue(`Верные ответы откроются после ${when}.`),
  mistakesTitle: 'Где вы ошиблись',
  answersTitle: 'Ошибки и верные ответы',
  noMistakes: 'Ошибок нет.',
  showAll: (n: number) => glue(`Показать все вопросы (${n})`),
  showWrong: 'Показать только ошибки',
  itemNo: (n: number) => `Вопрос ${n}`,
  unanswered: 'без ответа',
  tagMine: 'Ваш ответ',
  tagRight: 'Верный',
  tagMineRight: 'Ваш ответ, верный',
  shortMine: (text: string) => `Ваш ответ: ${text}`,
  shortNone: 'Ответа нет.',
  shortRight: (forms: readonly string[]) => (forms.length > 1 ? `Верные ответы: ${forms.join(', ')}` : `Верный ответ: ${forms[0] ?? ''}`),
  explanation: 'Пояснение',
  /** «Тренироваться дальше» (release 47, spec §47.5): the author offers the exam the quiz was drawn from. */
  practiceTitle: 'Тренироваться дальше',
  practiceJoin: 'Тренировать эти вопросы в Meldy',
  practiceNote: (exam: string) => glue(`Вы станете участником экзамена «${exam}»: автор увидит вас в списке участников, ваш прогресс — нет.`),
  practiceMember: (exam: string) => glue(`Вы уже участник экзамена «${exam}».`),
  practiceOpen: 'Открыть экзамен',
  practiceGuest: 'Создать аккаунт и тренироваться',
  /** «Ещё попытка (осталась 1)»; without a limit — «Ещё попытка». */
  retry: (left: number | null) => (left === null ? 'Ещё попытка' : glue(`Ещё попытка (${plural(left, 'осталась', 'осталось', 'осталось')} ${left})`)),
} as const;
