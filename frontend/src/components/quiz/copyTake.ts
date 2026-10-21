/**
 * The participant's words of «Контрольная» (spec 2026-10-16 §2.2; release 47: a guest without an account, the
 * explanation in the review, «тренироваться дальше» — spec 2026-10-18 §47.1, §47.5): the page /k/<код> before the
 * start, the attempt and the result. Plain Russian, no exclamation marks; numbers keep the word after them (glue). The
 * words both sides share (the counts, the states, the refusals MC010–MC018) stay in copyQuiz.ts.
 */
import { glue } from '../containers/copy';
import { QUIZ, plural } from './copyQuiz';

const SEP = ' · ';
const NBSP = '\u00a0';
/** Words that must not break apart (a date and its time). */
const together = (text: string) => text.replace(/ /g, NBSP);

export const TAKE = {
  docTitle: QUIZ.name,
  kicker: QUIZ.name,
  loading: 'Открываем контрольную…',
  notFound: 'Такой контрольной нет. Проверьте ссылку.',
  failed: 'Не удалось открыть контрольную.',
  retry: 'Попробовать ещё раз',
  home: 'На главную',
  author: (name: string) => `автор: ${name}`,
  /** Not shown when it repeats the quiz's own title (sameTitle): a test made in «Новый тест» is named as its exam. */
  exam: (title: string) => `экзамен «${title}»`,
  /** «20 вопросов · 30 минут · открыта до 24 окт., 18:00 · 1 попытка». */
  meta(p: { items: number; minutes: number | null; window: string | null; attempts: number | null }): string {
    const parts = [QUIZ.questions(p.items), p.minutes === null ? QUIZ.noTimer : QUIZ.minutes(p.minutes)];
    if (p.window) parts.push(p.window);
    parts.push(QUIZ.attempts(p.attempts));
    return glue(parts.join(SEP));
  },
  /** The date keeps together on one line («24 окт., 18:00»). */
  openUntil: (when: string) => `открыта до ${together(when)}`,
  opensAt: (when: string) => `откроется ${together(when)}`,
  closedWord: 'закрыта',
  backAllowed: 'Ответы можно менять, пока не нажмёте «Завершить».',
  forwardOnly: 'Вернуться к прошлому вопросу нельзя.',
  /** The same words as on the result: «Проходной балл 60 %». */
  passMark: (percent: number) => glue(`Проходной балл ${percent} %.`),
  grading: {
    best: 'Засчитаем лучшую попытку.',
    last: 'Засчитаем последнюю попытку.',
  },
  review: {
    score: 'После сдачи вы увидите свой балл.',
    mistakes: 'После сдачи вы увидите балл и ошибки.',
    answers: 'После сдачи вы увидите балл, ошибки и верные ответы.',
    mistakes_then_answers: 'После сдачи вы увидите балл и ошибки. Верные ответы покажем, когда контрольная закроется.',
  },
  membersOnly: 'Писать могут только участники экзамена.',
  privacy: 'Автор увидит ваше имя, ответы и результат.',
  /** Without an account (release 47): the attempts live on this device, by its token. */
  guestPrivacy: 'Автор увидит ваше имя, ответы и результат. Ваши попытки хранятся в этом браузере.',
  haveAccount: 'Есть аккаунт?',
  signIn: 'Войти, чтобы начать',
  signInToSee: 'Войти и посмотреть свои результаты',
  register: 'Создать аккаунт',
  signInAgain: 'Нужно войти снова. Сохранённые ответы не пропадут.',
  signInShort: 'Войти',
  /** «Имя и фамилия. Их увидит Анна Петрова»; without the author's name — «автор теста». */
  nameLabel: (author: string | null | undefined) => glue(`Имя и фамилия. Их увидит ${author?.trim() || 'автор теста'}`),
  /** The author on their own page: nobody else to see the name (release 47.1). */
  nameLabelOwn: 'Имя и фамилия',
  nameHint: `Например: Иванов Иван, 9${NBSP}Б`,
  nameBad: 'Имя должно быть от 2 до 80 знаков.',
  start: 'Начать',
  resume: 'Продолжить',
  resumeNote: 'Вы уже начали. Ответы сохранены, время идёт.',
  authorNote: 'Это ваша контрольная. Ваша попытка не попадёт в средний результат.',
  reason: {
    no_attempts: 'Попытки закончились.',
    members_only: 'Эта контрольная только для участников экзамена.',
    not_yet: (when: string | null) => (when ? glue(`Контрольная откроется ${when}.`) : 'Контрольная ещё не открыта.'),
    closed: 'Контрольная закрыта.',
  },
  /**
   * Signed in on a device that holds attempts written here without an account (a shared computer): nothing moves until
   * the person says whose they are. The server does not give a guest's name back, so the time of the last one.
   */
  deviceAttempt: (when: string | null) =>
    when
      ? glue(`Эту контрольную уже писали на этом устройстве без входа, ${when}. Это были вы?`)
      : 'На этом устройстве есть начатая попытка без входа. Это были вы?',
  deviceMine: 'Да, перенести в мой аккаунт',
  deviceNotMine: 'Нет, это не я',
  deviceKept: 'Попытки не перенесли. В аккаунте уже есть попытки этой контрольной.',
  /** A guest on a device with someone else's attempts: forget them here and start as a new person. */
  otherPerson: 'Я другой человек',
  pastTitle: 'Ваши попытки',
  /** «Попытка 1 · 2 из 3 · 16 окт., 10:30»; the score as the result says it (RESULT.score or RESULT.points). */
  pastRow: (n: number, score: string, when: string) => glue(`Попытка ${n}${SEP}${score}${when ? `${SEP}${when}` : ''}`),
  see: 'Посмотреть',
  seeLabel: (n: number) => `Посмотреть попытку ${n}`,
} as const;

export const RUN = {
  /** The top line: «3 из 20 · осталось 24:13»; the place, then the clock in a span of its own (it turns red near the end). */
  place: (pos: number, total: number) => glue(`${pos} из ${total}`),
  /** A quiz «как в студии» (release 47.2): «По страницам» says the page, «Одна страница» how many have an answer. */
  pageOf: (pos: number, total: number) => glue(`Страница ${pos} из ${total}`),
  answeredOf: (answered: number, total: number) => glue(`Отвечено ${answered} из ${total}`),
  /** Read on arriving at a question of «По одному». */
  questionOf: (pos: number, total: number) => glue(`Вопрос ${pos} из ${total}`),
  sep: glue(SEP),
  clock: (clock: string) => `осталось${NBSP}${clock}`,
  /** The strip under the top line (role progressbar). */
  timeLabel: 'Осталось времени',
  /** Said once each, when five minutes and then one minute are left (role status). */
  lowFive: 'Осталось 5 минут',
  lowOne: 'Осталась 1 минута',
  finish: 'Завершить',
  next: 'Дальше',
  back: 'Назад',
  all: 'Все вопросы',
  cell: (n: number, answered: boolean) => `Вопрос ${n}${answered ? ', есть ответ' : ', без ответа'}`,
  forwardOnly: 'Вернуться к прошлым вопросам нельзя.',
  saved: 'Сохранено',
  offline: 'Нет связи. Ответы сохранятся, когда связь вернётся',
  failing: 'Ответы пока не сохранились. Пробуем ещё раз',
  resumed: (pos: number, total: number, left: string | null) =>
    glue(left ? `Продолжаем с вопроса ${pos} из ${total}. Осталось ${left}.` : `Продолжаем с вопроса ${pos} из ${total}.`),
  /** The same with the top line's words («Страница 2 из 3», «Отвечено 4 из 6»). */
  resumedAt: (place: string, left: string | null) =>
    glue(left ? `Продолжаем. ${place}. Осталось ${left}.` : `Продолжаем. ${place}.`),
  finishTitle: 'Завершить контрольную?',
  /** «Нет ответа на вопросы 4, 17. Они засчитаются как ошибки.» */
  finishLine(answered: number, total: number, missing: number[]): string {
    if (missing.length === 0) return glue(`Вы ответили на все ${QUIZ.questions(total)}. Потом ответы не изменить.`);
    const shown = missing.slice(0, 12);
    const more = missing.length - shown.length;
    const list = `${shown.join(', ')}${more > 0 ? ` и ещё ${more}` : ''}`;
    return glue(
      missing.length > 1 ? `Нет ответа на вопросы ${list}. Они засчитаются как ошибки.` : `Нет ответа на вопрос ${list}. Он засчитается как ошибка.`,
    );
  },
  backToQuestions: 'Вернуться к вопросам',
  sending: 'Сдаём ответы…',
  timeUp: 'Время вышло. Сдаём ответы…',
  endOffline: 'Нет связи. Сдадим ответы сами, когда связь вернётся.',
  endFailed: 'Не получилось сдать ответы. Пробуем ещё раз.',
  retryEnd: 'Сдать ещё раз',
  lost: 'Автор сбросил эту попытку. Можно начать заново.',
  /** The strict level ended the attempt at its limit (useGuard), while the answers go. */
  guardEnd: (count: number) => glue(`Вы уходили со страницы ${count} ${times(count)}. Попытка завершена, сдаём ответы…`),
} as const;

/** «1 раз», «2 раза», «5 раз». */
const times = (n: number) => plural(n, 'раз', 'раза', 'раз');
/** «через 2 ухода» */
const aways = (n: number) => `${n} ${plural(n, 'уход', 'ухода', 'уходов')}`;
/** «12 с», «3 мин 5 с». */
function seconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}${NBSP}с`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest > 0 ? `${m}${NBSP}мин ${rest}${NBSP}с` : `${m}${NBSP}мин`;
}

/**
 * «Защита от списывания» for the participant (20261020120000_quiz_protection): the rules before the start, the line under
 * the clock, the card over the question while the page is away, the notes of the strict level. What the page cannot see
 * is said to the author, not here.
 */
export const GUARD = {
  /** Before the start, under the button: what is recorded and what happens. */
  rulesTitle: 'Защита от списывания',
  rulesNormal: [
    'Если вы уйдёте со страницы, вопрос скроется, пока вы не вернётесь. Уходом считается и приложение, ассистент или шторка уведомлений поверх страницы.',
    'Автор увидит, когда и надолго ли вы уходили. Звонок и погасший экран тоже считаются уходом.',
    'Копирование и вставка текста тоже видны автору.',
  ],
  rulesStrict: (limit: number) => [
    'Контрольная откроется на весь экран, если браузер это умеет. Выход из него считается уходом.',
    'Если вы уйдёте со страницы, вопрос скроется. Уходом считается и приложение, ассистент или шторка уведомлений поверх страницы. Автор увидит, когда и надолго ли вы уходили.',
    limit === 1
      ? 'Первый же уход завершит попытку. Ответы до него засчитаются.'
      : glue(`После ${limit}-го ухода попытка завершится. Ответы до него засчитаются.`),
    'Звонок и погасший экран тоже считаются уходом. Если ждёте звонка, предупредите автора.',
    'Текст вопросов нельзя скопировать. Поверх вопросов будет видно ваше имя.',
  ],
  /** Over the start button: the rules in one line (the whole rules are under it). */
  short: (level: 'normal' | 'strict', limit: number) =>
    level === 'normal'
      ? 'Автор увидит, если вы уйдёте со страницы.'
      : limit === 1
        ? 'Контрольная откроется на весь экран. Если уйти со страницы, попытка завершится.'
        : glue(`Контрольная откроется на весь экран. После ${limit}-го ухода со страницы попытка завершится.`),
  /** Under the clock, once the page has been away: open about what is recorded. */
  line(count: number, level: 'normal' | 'strict', limit: number, lastMs: number | null): string {
    const last = lastMs !== null ? ` Последний раз на ${seconds(lastMs)}.` : '';
    if (level === 'normal') return glue(`Вы уходили со страницы ${count} ${times(count)}.${last} Автор это увидит.`);
    const left = limit - count;
    const tail = left <= 0 ? '' : left === 1 ? ' Следующий уход завершит попытку.' : ` Ещё ${aways(left)}, и попытка завершится.`;
    return glue(`Вы уходили со страницы ${count} ${times(count)}.${last}${tail}`);
  },
  /** The strict level refused a copy. */
  noCopy: 'В этой контрольной текст вопросов не копируется.',
  /** The card over the question. */
  awayTitle: 'Вопрос скрыт',
  awayText: 'Страница сейчас не на первом плане. Автор это увидит. Вернитесь на страницу, и вопрос появится.',
  splitTitle: 'Окно стало меньше',
  splitText: 'В разделённом экране и плавающем окне вопрос не виден. Разверните браузер на весь экран.',
  fullscreenTitle: 'Вы вышли из полноэкранного режима',
  fullscreenText: 'Автор это увидит. Чтобы продолжить, вернитесь на весь экран.',
  fullscreenBack: 'Продолжить на весь экран',
  /** The watermark of the strict level: the name and the start of the attempt. */
  mark: (name: string, when: string) => `${name} · ${when}`,
} as const;

export const RESULT = {
  barLong: glue(`${QUIZ.name} · Результат`),
  barShort: 'Результат',
  close: 'Закрыть',
  attemptLine: (n: number, when: string) => glue(when ? `Попытка ${n}${SEP}${when}` : `Попытка ${n}`),
  /** «15 из 20 · 75 %». */
  score: (correct: number, total: number) => glue(`${correct} из ${total}`),
  /** The studio's points (release 47.2), when they differ from the count: «6 баллов из 8 · 75 %». */
  points: (score: number, max: number) => glue(`${score} ${plural(score, 'балл', 'балла', 'баллов')} из ${max}`),
  /** The page's link further on the result screen, with its address. */
  ctaNote: ' (откроется в новой вкладке)',
  percent: (percent: number) => glue(`${percent} %`),
  /** The start page's «Проходной балл» first said as the outcome: «Сдано. Проходной балл 60 %». */
  pass: (threshold: number, passed: boolean) => glue(`${passed ? 'Сдано' : 'Не сдано'}. Проходной балл ${threshold} %`),
  byTime: 'Время вышло, попытка завершена. Вопросы без ответа считаются ошибками.',
  /** The strict level ended it (finish_reason 'protection'). */
  byGuard: (count: number) =>
    glue(`Вы уходили со страницы ${count} ${times(count)}, и попытка завершилась. Ответы до этого засчитаны. Вопросы без ответа считаются ошибками.`),
  byClose: 'Автор закрыл контрольную, и попытка завершилась.',
  answersAfter: (when: string) => glue(`Верные ответы откроются после ${when}.`),
  mistakesTitle: 'Где вы ошиблись',
  answersTitle: 'Ошибки и верные ответы',
  noMistakes: 'Ошибок нет.',
  showAll: (n: number) => glue(`Показать все вопросы (${n})`),
  showWrong: 'Показать только ошибки',
  itemNo: (n: number) => `Вопрос ${n}`,
  unanswered: 'без ответа',
  /** The person's answer where the right ones are not shown yet. */
  tagMine: 'Ваш ответ',
  tagMineWrong: 'Ваш ответ неверный',
  tagMineRight: 'Ваш ответ верный',
  /** A right option the person did not pick: no fill, a green edge. */
  tagMissed: 'Верный, но вы его не отметили',
  shortMine: (text: string) => `Ваш ответ: ${text}`,
  shortNone: 'Вы не ответили.',
  shortRight: (forms: readonly string[]) => (forms.length > 1 ? `Верные ответы: ${forms.join(', ')}` : `Верный ответ: ${forms[0] ?? ''}`),
  explanation: 'Пояснение',
  /** «Повторить эти вопросы» (release 47, spec §47.5): the author offers the exam the quiz was drawn from. */
  practiceTitle: 'Повторить эти вопросы',
  practiceJoin: 'Тренировать эти вопросы',
  practiceNote: glue('Meldy будет возвращать вопросы, пока вы их не запомните. Автор увидит только, что вы присоединились.'),
  practiceMember: (exam: string) => glue(`Вы уже участник экзамена «${exam}».`),
  practiceOpen: 'Открыть экзамен',
  practiceGuest: 'Создать аккаунт и тренироваться',
  /** While a quiz of the exam is open or not yet open: no button (a member sees every answer of the exam). */
  practiceLater: 'Тренировка по всем вопросам откроется, когда контрольная закроется.',
  /** «Пройти ещё раз (осталась 1)»; without a limit — «Пройти ещё раз». */
  retry: (left: number | null) => (left === null ? 'Пройти ещё раз' : glue(`Пройти ещё раз (${plural(left, 'осталась', 'осталось', 'осталось')} ${left})`)),
} as const;
