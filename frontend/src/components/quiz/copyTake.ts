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
/** The first letter small: a top line's words inside a sentence. */
const lower = (text: string) => (text ? text[0].toLocaleLowerCase('ru') + text.slice(1) : text);

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
  backAllowed: 'К вопросам можно возвращаться и менять ответы до «Завершить».',
  forwardOnly: 'Только вперёд: к прошлым вопросам вернуться нельзя.',
  /** The same words as on the result: «Проходной балл 60 %». */
  passMark: (percent: number) => glue(`Проходной балл ${percent} %.`),
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
  /** «Имя и фамилия — их увидит Анна Петрова»; without the author's name — «автор теста». */
  nameLabel: (author: string | null | undefined) => glue(`Имя и фамилия — их увидит ${author?.trim() || 'автор теста'}`),
  /** The author on their own page: nobody else to see the name (release 47.1). */
  nameLabelOwn: 'Имя и фамилия',
  nameHint: `Например: Иванов Иван, 9${NBSP}Б`,
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
  /**
   * Signed in on a device that holds attempts written here without an account (a shared computer): nothing moves until
   * the person says whose they are. The server does not give a guest's name back, so the time of the last one.
   */
  deviceAttempt: (when: string | null) =>
    when ? glue(`На этом устройстве есть попытка без входа от ${when}.`) : 'На этом устройстве есть начатая попытка без входа.',
  deviceMine: 'Это я — перенести в аккаунт',
  deviceNotMine: 'Это не я',
  deviceKept: 'Попытки без входа не перенесены: в аккаунте уже есть попытки этой контрольной.',
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
  forwardOnly: 'Только вперёд: к прошлым вопросам не вернуться.',
  saved: 'Сохранено',
  offline: 'Нет связи — ответы сохранятся, когда она вернётся',
  failing: 'Ответы пока не сохранились — пробуем ещё раз',
  resumed: (pos: number, total: number, left: string | null) =>
    glue(left ? `Попытка продолжается: ${pos} из ${total}, осталось ${left}.` : `Попытка продолжается: ${pos} из ${total}.`),
  /** The same with the top line's words («Страница 2 из 3», «Отвечено 4 из 6»). */
  resumedAt: (place: string, left: string | null) =>
    glue(left ? `Попытка продолжается: ${lower(place)}, осталось ${left}.` : `Попытка продолжается: ${lower(place)}.`),
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
  /** The strict level ended the attempt at its limit (useGuard), while the answers go. */
  guardEnd: (count: number) => glue(`Вы покидали страницу ${count} ${times(count)}, поэтому попытка завершается. Сдаём ответы…`),
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
    'Пока идёт попытка, вопрос закрывается, если вы уходите со страницы или открываете что-то поверх неё: другое приложение, ассистента, шторку уведомлений, второе окно. Когда вы вернётесь, вопрос появится снова.',
    'Каждый такой раз записывается. Автор увидит, когда это было и сколько длилось. Звонок или погасший экран тоже попадают в запись, но считаются одним разом.',
    'Копирование текста и вставка в поле ответа тоже записываются.',
  ],
  rulesStrict: (limit: number) => [
    'Контрольная откроется на весь экран, если браузер это умеет. Выход из полноэкранного режима считается уходом.',
    'Пока идёт попытка, вопрос закрывается, если вы уходите со страницы или открываете что-то поверх неё: другое приложение, ассистента, шторку уведомлений, второе окно. Каждый такой раз записывается, автор увидит, когда это было и сколько длилось.',
    limit === 1
      ? 'Первый же уход завершит попытку. Ответы, которые вы успели дать, засчитаются.'
      : glue(`После ${limit}-го ухода попытка завершится сама. Ответы, которые вы успели дать, засчитаются.`),
    'Звонок или погасший экран тоже считаются уходом, одним на каждый раз. Если это важно, предупредите автора.',
    'Текст вопросов нельзя выделить и скопировать. Поверх вопросов будет видно ваше имя.',
  ],
  /** Over the start button: the rules in one line (the whole rules are under it). */
  short: (level: 'normal' | 'strict', limit: number) =>
    level === 'normal'
      ? 'Включена защита от списывания: уходы со страницы записываются, автор их увидит.'
      : limit === 1
        ? 'Включена строгая защита от списывания: контрольная откроется на весь экран, первый уход со страницы завершит попытку.'
        : glue(`Включена строгая защита от списывания: контрольная откроется на весь экран, после ${limit}-го ухода со страницы попытка завершится.`),
  /** Under the clock, once the page has been away: open about what is recorded. */
  line(count: number, level: 'normal' | 'strict', limit: number, lastMs: number | null): string {
    const last = lastMs !== null ? ` Последний раз ${seconds(lastMs)}.` : '';
    if (level === 'normal') return glue(`Вы покидали страницу: ${count} ${times(count)}.${last} Автор это увидит.`);
    const left = limit - count;
    const tail = left <= 0 ? '' : left === 1 ? ' Следующий уход завершит попытку.' : ` Попытка завершится через ${aways(left)}.`;
    return glue(`Вы покидали страницу: ${count} ${times(count)}.${last}${tail}`);
  },
  /** The strict level refused a copy. */
  noCopy: 'Копировать текст вопросов в этой контрольной нельзя.',
  /** The card over the question. */
  awayTitle: 'Вопрос скрыт',
  awayText: 'Страница не на первом плане, поэтому вопрос закрыт. Это записано. Вернитесь на страницу, и вопрос появится.',
  splitTitle: 'Окно стало меньше',
  splitText: 'В разделённом экране и в плавающем окне вопрос не показывается. Разверните браузер на весь экран, и вопрос появится.',
  fullscreenTitle: 'Вы вышли из полноэкранного режима',
  fullscreenText: 'Это записано. Чтобы продолжить, вернитесь на весь экран.',
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
  /** The words of the start page: «Проходной балл 60 % — сдано». */
  pass: (threshold: number, passed: boolean) => glue(`Проходной балл ${threshold} % — ${passed ? 'сдано' : 'не сдано'}`),
  byTime: 'Время вышло — попытка закрылась сама. Вопросы без ответа считаются ошибкой.',
  /** The strict level ended it (finish_reason 'protection'). */
  byGuard: (count: number) =>
    glue(`Попытка завершилась сама: вы покидали страницу ${count} ${times(count)}. Ответы, данные до этого, засчитаны, вопросы без ответа считаются ошибкой.`),
  byClose: 'Автор закрыл контрольную — попытка закрылась.',
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
  tagMineWrong: 'Ваш ответ — неверно',
  tagMineRight: 'Ваш ответ — верно',
  /** A right option the person did not pick: no fill, a green edge. */
  tagMissed: 'Верный — вы не отметили',
  shortMine: (text: string) => `Ваш ответ: ${text}`,
  shortNone: 'Ответа нет.',
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
  /** «Ещё попытка (осталась 1)»; without a limit — «Ещё попытка». */
  retry: (left: number | null) => (left === null ? 'Ещё попытка' : glue(`Ещё попытка (${plural(left, 'осталась', 'осталось', 'осталось')} ${left})`)),
} as const;
