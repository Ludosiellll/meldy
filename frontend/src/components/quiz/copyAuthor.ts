/**
 * The author's words of «Контрольная» (spec meldy-notes 10_Project/Quiz_and_Editor_Spec_2026-10-16.md §2.1, §2.3): the
 * list of an exam's quizzes, the settings form, the stats page with its people and questions. The words both sides
 * share (states, errors, plurals) are in copyQuiz.ts. Plain Russian, no exclamation marks.
 */
import { plural, QUIZ } from './copyQuiz';
import type { QuizAccent, QuizGrading, QuizGuardKind, QuizProtection, QuizReview } from '../../types/quiz';
import type { QuizWho } from './setupModel';

const people = (n: number) => `${n} ${plural(n, 'человек', 'человека', 'человек')}`;
/** «После сдачи участник видит»: the names of the four choices. */
const REVIEW_OPTIONS: Record<QuizReview, string> = {
  score: 'только балл',
  mistakes: 'балл и ошибки',
  answers: 'балл, ошибки и верные ответы',
  /** The safer choice when a class writes at the same time: the right answers come after the closing (fits a phone's list). */
  mistakes_then_answers: 'балл и ошибки сразу, ответы и пояснения после закрытия',
};
const keyed = (n: number) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')} с верным ответом`;
/** «6 баллов», «1 балл», «3 балла». */
export const pointsWord = (n: number) => `${n} ${plural(n, 'балл', 'балла', 'баллов')}`;

/** «Контрольные» of an exam: /exams/c/:id/quizzes. */
export const QA_LIST = {
  title: QUIZ.names,
  newQuiz: 'Новая контрольная',
  loading: 'Загружаем контрольные…',
  loadFailed: 'Не получилось загрузить контрольные.',
  retry: 'Повторить',
  authorOnly: 'Контрольные видит только автор экзамена.',
  toExam: 'К экзамену',
  empty: 'Контрольных пока нет. Контрольная — это вопросы экзамена по ссылке, со сроком сдачи. Создайте её, и здесь появятся результаты.',
  /** The same of a test (containers.kind 'test', release 47.3): the questions and the author are the test's. */
  authorOnlyTest: 'Контрольные видит только автор теста.',
  toTest: 'К тесту',
  emptyTest: 'Контрольных пока нет. Контрольная — это ваш тест по ссылке, со сроком сдачи. Создайте её, и здесь появятся результаты.',
  /** «пишут 2 · сдали 5 · средний 71 %» (attempts; the average leaves the author out); nobody but the author — «пока никто не писал». */
  counts: (writing: number, finished: number, avg: number | null, anyone: boolean) =>
    anyone ? [`пишут ${writing}`, `сдали ${finished}`, avg === null ? null : `средний ${Math.round(avg)} %`].filter(Boolean).join(' · ') : 'пока никто не писал',
  meta: (count: number, seconds: number | null) => [QUIZ.questions(count), seconds ? QUIZ.minutes(Math.round(seconds / 60)) : QUIZ.noTimer].join(' · '),
} as const;

/** The settings form: /exams/c/:id/quizzes/new and …/:quizId/edit (spec §2.1). */
export const QA_SETUP = {
  newTitle: 'Новая контрольная',
  editTitle: 'Настройки контрольной',
  /** Under «Новая контрольная»: the word said once where it first appears (UX audit 21.10). */
  newLede: (test: boolean) =>
    test
      ? 'Контрольная — это ваш тест по ссылке, со сроком сдачи. Выберите настройки и получите ссылку.'
      : 'Контрольная — это вопросы экзамена по ссылке, со сроком сдачи. Выберите настройки и получите ссылку.',
  loading: 'Загружаем…',
  loadFailed: 'Не получилось загрузить контрольную.',
  notFound: 'Такой контрольной нет. Возможно, её удалили.',
  retry: 'Повторить',
  toList: 'К списку контрольных',
  partQuestions: 'Вопросы',
  partWhen: 'Срок и правила',
  name: 'Название',
  subjects: 'Вопросы из',
  subjectMeta: (n: number) => (n > 0 ? keyed(n) : 'нет вопросов с верным ответом'),
  pool: (n: number) => `Возьмём только вопросы с верным ответом. В выбранных предметах их ${n}.`,
  /** One subject: no «Вопросы из», the count's hint says the pool. */
  poolOne: (n: number) => `Возьмём только вопросы с верным ответом. Их ${n}.`,
  /** The part of a quiz of all the questions (?all=1) with the five settings that matter first. */
  partMain: 'Основное',
  /** The rest of the settings of ?all=1, folded. */
  more: 'Ещё настройки',
  moreNote: 'вопросы, попытки, проходной балл, что видно после сдачи, защита от списывания',
  noPool: 'В экзамене нет вопросов с верным ответом. Отметьте ответы, и можно собрать контрольную.',
  toKeys: 'Вопросы и ключи',
  count: 'Сколько вопросов',
  countAll: (n: number) => `все (${n})`,
  countOption: (n: number) => `${n}`,
  set: 'Набор вопросов',
  setOwn: 'свой у каждого',
  setSame: 'одинаковый у всех',
  setOwnHint: 'В каждой попытке будут другие вопросы.',
  order: 'Порядок вопросов',
  orderShuffle: 'вперемешку',
  orderFile: 'как в экзамене',
  options: 'Варианты ответа',
  optionsShuffle: 'вперемешку',
  optionsFile: 'как в файле',
  optionsHint: 'Где стоит «Не перемешивать варианты», порядок останется как в файле.',
  time: 'Время на попытку',
  timeNone: 'без ограничения',
  timeOption: (n: number) => `${n} мин`,
  opens: 'Открыта с',
  opensNow: 'сразу',
  opensAt: 'дата и время',
  opensField: 'Дата и время открытия',
  closes: 'Открыта до',
  closesAt: 'дата и время',
  closesNever: 'пока не закрою',
  closesField: 'Дата и время закрытия',
  closesPast: 'Это время уже прошло. Контрольная сразу закроется.',
  /** Beside the date field: the date in words («до 25 октября, 23:59»). */
  opensWords: (when: string) => `с ${when}`,
  closesWords: (when: string) => `до ${when}`,
  attempts: 'Сколько попыток',
  attemptsNone: 'сколько угодно (до 50)',
  attemptsOption: (n: number) => `${n}`,
  grading: 'Засчитать',
  gradingOption: (g: QuizGrading) => (g === 'best' ? 'лучшую попытку' : 'последнюю попытку'),
  back: 'Вернуться к прошлым вопросам',
  backYes: 'можно',
  backNo: 'нельзя',
  pass: 'Проходной балл',
  passNone: 'нет',
  passOption: (n: number) => `${n} %`,
  review: 'После сдачи ученик видит',
  reviewOption: (r: QuizReview) => REVIEW_OPTIONS[r],
  /** Without an account and with the right answers at once: a second browser is a fresh start that shows them. */
  reviewGuests: `Без входа ученик может открыть тест в другом браузере и заранее увидеть ответы. Лучше выбрать «${REVIEW_OPTIONS.mistakes_then_answers}».`,
  /** A question of the set has the author's explanation: when the takers see it (it comes with the right answers). */
  reviewExplain: (review: QuizReview) =>
    review === 'answers'
      ? 'Пояснения ученики увидят сразу, вместе с верными ответами.'
      : review === 'mistakes_then_answers'
        ? 'Пояснения ученики увидят после закрытия, вместе с верными ответами.'
        : 'При этой настройке пояснения не видны. Их показываем только с верными ответами.',
  who: 'Кто может писать',
  /** `test`: the quiz is a test's (containers.kind 'test', release 47.3), its members are the test's. */
  whoOption: (who: QuizWho, test = false) =>
    ({
      guests: 'все по ссылке, без входа',
      link: 'все по ссылке, после входа',
      members: test ? 'только участники этого теста' : 'только участники этого экзамена',
    })[who],
  whoHint: (who: QuizWho, test = false) =>
    ({
      guests: 'Аккаунт не нужен. Попытки считаем по браузеру, в другом браузере можно начать заново.',
      link: 'Ученик войдёт в Meldy или создаст аккаунт. Попытки считаем по аккаунту.',
      members: `Только те, кто уже вступил в этот ${test ? 'тест' : 'экзамен'}.`,
    })[who],
  /** The words of the participant's button «Тренировать эти вопросы» (copyTake RESULT.practiceJoin; release 47.1). */
  practice: 'После сдачи предложить тренировать эти вопросы в Meldy',
  /** The button waits until no quiz of the exam is open or not yet open (20261018130000_quiz_guards). */
  practiceNote: 'Кнопка появится после закрытия контрольной. В тренировке видны все ответы экзамена.',
  practiceSeen: 'Кто согласится, появится в списке участников экзамена. Его прогресс вы не увидите.',
  /** The same of a test (containers.kind 'test', release 47.3). */
  practiceNoteTest: 'Кнопка появится после закрытия контрольной. В тренировке видны все ответы теста.',
  practiceSeenTest: 'Кто согласится, появится в списке участников теста. Его прогресс вы не увидите.',
  partLook: 'Оформление',
  cover: 'Обложка',
  // Release 47.4 shrinks a big photo itself (api/itemPictures pictureFromFile): only a GIF keeps the 3 MB limit.
  coverHint: 'Картинка над названием: JPEG, PNG, WebP или GIF. Большое фото уменьшим сами, GIF до 3 МБ.',
  coverUpload: 'Загрузить обложку',
  coverReplace: 'Заменить',
  coverRemove: 'Убрать',
  coverAlt: 'Обложка контрольной',
  coverUploading: 'Загружаем обложку…',
  coverType: 'Это не картинка. Подойдут JPEG, PNG, GIF, WebP и фото с телефона.',
  coverSize: 'Картинка больше 3 МБ даже после сжатия.',
  coverHeic: 'Браузер не может открыть этот формат. Сохраните фото как JPEG или сделайте снимок экрана.',
  coverRefused: 'Эту картинку не получилось сохранить. Подойдут PNG, JPEG, GIF, WebP до 3 МБ.',
  coverFailed: 'Обложка не загрузилась. Попробуйте ещё раз.',
  accent: 'Цвет',
  accentHint: 'Цвет кнопок и полосы времени.',
  accentName: (accent: QuizAccent) =>
    ({
      blue: 'Синий',
      green: 'Зелёный',
      orange: 'Оранжевый',
      violet: 'Фиолетовый',
      pink: 'Розовый',
      graphite: 'Графит',
    })[accent],
  locked: 'Контрольную уже начали писать. Вопросы, их порядок, время и защиту от списывания поменять нельзя. Остальное можно.',
  /** A quiz «как в студии» (release 47.2). */
  lockedDesign: 'Контрольную уже начали писать. «Как в студии», порядок вариантов, время и защиту от списывания поменять нельзя. Остальное можно.',
  /**
   * «Защита от списывания» (20261020120000_quiz_protection): three levels, each in one short line (UX audit 21.10: the
   * three descriptions were 25–45 words); what counts as leaving and what a web page cannot catch is under «Подробнее».
   */
  protection: 'Защита от списывания',
  protectionOption: (level: QuizProtection) => ({ off: 'выключена', normal: 'обычная', strict: 'строгая' })[level],
  protectionHint: (level: QuizProtection, limit: number) =>
    ({
      off: 'Уходы со страницы не записываем.',
      normal: 'Вопрос скрывается, если ученик уходит со страницы. Вы увидите каждый уход.',
      strict: `Как обычная, плюс весь экран и запрет копирования. ${limit === 1 ? 'Первый же уход' : `${limit}-й уход`} завершит попытку.`,
    })[level],
  /** Under the levels when one is on: what a web page cannot catch, then the rest folded under «Подробнее». */
  protectionLimits: 'Второй телефон и фото экрана сайт не заметит.',
  protectionMore: 'Подробнее',
  protectionDetails: [
    'Уходом считается другое приложение, ассистент вроде Gemini, шторка уведомлений или разделённый экран. Вы увидите, когда был каждый уход и сколько он длился.',
    'Звонок или погасший экран у ученика тоже записываются. Смотрите, сколько длился уход.',
    'Строгая защита на Android открывает контрольную на весь экран. Текст вопросов не копируется, поверх вопросов видно имя ученика. Ответы до последнего ухода засчитываются.',
  ],
  protectionLimit: 'Завершить попытку после',
  protectionLimitOption: (n: number) => `${n} ${plural(n, 'ухода', 'уходов', 'уходов')}`,
  design: 'Как в студии',
  designLine: 'Вопросы, порядок и оформление берём из студии.',
  designOff: 'Вопросы берём из предметов экзамена.',
  toStudio: 'Открыть студию',
  moreNoteDesign: 'варианты ответа, попытки, проходной балл, что видно после сдачи, защита от списывания',
  problems: {
    title: 'Напишите название, до 120 знаков.',
    subjects: 'Отметьте хотя бы один предмет.',
    count: 'В выбранных предметах нет вопросов с верным ответом.',
    page: 'В студии нет вопросов с верным ответом. Отметьте ответ хотя бы в одном.',
    window: '«Открыта до» должно быть позже, чем «Открыта с».',
    when: 'Укажите дату и время.',
  },
  create: 'Получить ссылку',
  creating: 'Готовим ссылку…',
  save: 'Сохранить',
  saving: 'Сохраняем…',
  cancel: 'Отмена',
} as const;

/** The stats page: /exams/c/:id/quizzes/:quizId (spec §2.3). */
export const QA_STATS = {
  loading: 'Загружаем результаты…',
  loadFailed: 'Не получилось загрузить результаты.',
  notFound: 'Такой контрольной нет. Возможно, её удалили.',
  retry: 'Повторить',
  toList: 'К списку контрольных',
  created: 'Ссылка готова. Отправьте её ученикам.',
  saved: 'Настройки сохранены.',
  closedHint: 'Чтобы открыть снова, поменяйте «Открыта до» в настройках.',
  link: 'Ссылка для участников',
  copy: 'Скопировать',
  copied: 'Скопировано',
  copiedLine: 'Ссылка скопирована.',
  copyFailed: 'Не получилось скопировать. Выделите ссылку в поле и скопируйте сами.',
  /** Sharing the link (release 47): a QR on the whole screen, the phone's sharing, the page as a taker sees it. */
  qr: 'Показать QR-код',
  qrTitle: 'QR-код ссылки на контрольную',
  qrHint: 'Наведите камеру телефона на код или наберите адрес.',
  qrClose: 'Закрыть',
  share: 'Поделиться',
  asTaker: 'Открыть как ученик',
  asTakerLabel: 'Открыть как ученик (в новой вкладке)',
  edit: 'Изменить настройки',
  close: 'Закрыть контрольную',
  closeAsk: (writing: number) =>
    writing > 0
      ? `Закрыть контрольную сейчас? Ещё ${plural(writing, 'пишет', 'пишут', 'пишут')} ${people(writing)}. Засчитаем ответы, которые уже есть.`
      : 'Закрыть контрольную сейчас? Начать новую попытку будет нельзя.',
  closeYes: 'Закрыть',
  remove: 'Удалить',
  removeAsk: (title: string) => `Удалить «${title}»? Все попытки и результаты пропадут.`,
  removeYes: 'Удалить',
  no: 'Отмена',
  summary: (writing: number, done: number, avg: number | null, passed: number | null) =>
    [
      `Пишут ${writing}`,
      `Сдали ${done}`,
      avg === null ? null : `Средний результат ${avg} %`,
      passed === null || done === 0 ? null : `Набрали проходной балл ${passed} из ${done}`,
    ]
      .filter(Boolean)
      .join(' · '),
  nobody: 'Пока никто не писал. Отправьте ссылку, и результаты появятся здесь.',
  onlyOwn: 'Пока писали только вы, ваши попытки не считаем. Отправьте ссылку, и результаты появятся здесь.',
  tabs: 'Результаты',
  tabPeople: 'Участники',
  tabQuestions: 'Вопросы',
  download: 'Скачать таблицу',
  downloading: 'Готовим таблицу…',
  downloadFailed: 'Не получилось собрать таблицу. Попробуйте ещё раз.',
  stale: (time: string) => `Нет связи. Результаты на ${time}. Обновим, когда связь вернётся.`,
} as const;

/** «Участники»: one row a person, their answers in a sheet. */
export const QA_PEOPLE = {
  title: 'Участники',
  own: '(вы)',
  ownHint: 'Ваши попытки отмечены «(вы)», в средний результат они не входят.',
  /** Beside the name of somebody who wrote without an account (release 47). */
  guest: 'без входа',
  guestHint: 'Попытки без входа считаются по браузеру.',
  sort: 'Порядок',
  sortOption: (key: 'name' | 'result' | 'time') => ({ name: 'по имени', result: 'по результату', time: 'по времени' })[key],
  head: { name: 'Имя', status: 'Статус', result: 'Результат', minutes: 'Время', attempts: 'Попытки' },
  writing: (answered: number, total: number, left: string | null) => `пишет, ${answered} из ${total}${left ? `, осталось ${left}` : ''}`,
  done: (time: string) => `сдано ${time}`,
  time: 'время вышло',
  /** Still unfinished, the clock at 00:00: the server takes the last answers for 20 s more, then closes it. */
  timeOver: 'время вышло, ответы сдаются',
  closed: 'закрыта',
  /** The strict level ended the attempt (finish_reason 'protection'). */
  guardEnded: 'завершена из-за уходов со страницы',
  /** The mark of an attempt with events (a counted one, a copy or a paste). */
  flag: (counted: number) => (counted > 0 ? `${counted} ${plural(counted, 'уход', 'ухода', 'уходов')}` : 'копирование'),
  flagLabel: (counted: number) =>
    counted > 0 ? `Уходил со страницы ${counted} ${plural(counted, 'раз', 'раза', 'раз')}` : 'Копировал или вставлял текст',
  onlyFlagged: 'Только с нарушениями',
  noneFlagged: 'Попыток с нарушениями нет.',
  /** The timeline of «Защита от списывания» in the answers sheet. */
  eventsTitle: 'Что записала защита',
  eventsLoading: 'Загружаем записи…',
  eventsFailed: 'Не получилось загрузить записи.',
  eventsNone: 'Ничего не записано.',
  eventsCount: (n: number) => `${n} ${plural(n, 'уход', 'ухода', 'уходов')} со страницы.`,
  eventsLimits: 'Второй телефон и фото экрана сайт не заметит. Звонок и погасший экран записываются как уход.',
  eventKind: (kind: QuizGuardKind) =>
    ({
      hidden: 'Ушёл со страницы: другое приложение, блокировка экрана или звонок',
      blur: 'Открыл окно поверх страницы: ассистент, поиск по экрану, шторка уведомлений',
      split: 'Уменьшил окно: разделённый экран или плавающее окно',
      fullscreen: 'Вышел из полноэкранного режима',
      copy: 'Пытался скопировать текст',
      paste: 'Вставил текст в ответ',
      reload: 'Открыл страницу заново',
    })[kind],
  /** «вопрос 2» with a no-break space: on a phone the number never wraps alone. */
  eventQ: (n: number) => `вопрос ${n}`,
  eventMs: (ms: number) => {
    const s = Math.max(1, Math.round(ms / 1000));
    return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
  },
  result: (correct: number, total: number, percent: number | null) => `${correct} из ${total}${percent === null ? '' : ` · ${percent} %`}`,
  /** A quiz «как в студии» whose questions weigh their points (release 47.2): the participant's «6 баллов из 8 · 75 %». */
  points: (score: number, max: number, percent: number | null) => `${pointsWord(score)} из ${max}${percent === null ? '' : ` · ${percent} %`}`,
  /** 0 — under a minute (quizModel.minutesTaken). */
  minutes: (n: number) => (n === 0 ? 'меньше минуты' : `${n} мин`),
  attempts: (used: number, allowed: number | null) => (allowed === null ? `попытка ${used}` : `попытка ${used} из ${allowed}`),
  empty: 'Пока никто не начал.',
  open: (name: string) => `Ответы: ${name}`,
  attemptSwitch: 'Попытка',
  attemptTab: (n: number) => `Попытка ${n}`,
  loading: 'Загружаем ответы…',
  loadFailed: 'Не получилось загрузить ответы.',
  attemptGone: 'Этой попытки уже нет. Её сбросили или удалили.',
  retry: 'Повторить',
  noAnswers: 'В этой попытке пока нет ответов.',
  unanswered: (n: number) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')} без ответа.`,
  context: (subject: string, no: string) => `${subject} · № ${no}`.replace(/^ · /, ''),
  gone: 'Этот вопрос удалили.',
  answer: (text: string) => `Ответ: ${text}`,
  key: (text: string) => `Верный ответ: ${text}`,
  forms: (text: string) => `Принимаем: ${text}`,
  noKey: 'Верный ответ не отмечен.',
  right: 'верно',
  wrong: 'неверно',
  reset: 'Сбросить попытку',
  resetAsk: (n: number) => `Сбросить попытку ${n}? Ответы пропадут, человек сможет пройти заново.`,
  resetYes: 'Сбросить',
  resetNo: 'Отмена',
} as const;

/** «Вопросы»: the hardest first, the picks of each option, the common wrong short answers. */
export const QA_QUESTIONS = {
  title: 'Вопросы',
  hint: 'Сначала самые трудные. Ваши попытки не считаем.',
  line: (context: string, correct: number, shown: number, percent: number | null) =>
    shown > 0 ? `${context}: ${correct} из ${shown} ответили верно${percent === null ? '' : ` (${percent} %)`}` : `${context}: пока никто не отвечал`,
  gone: 'Этот вопрос удалили.',
  picks: 'Кто что выбрал',
  keyWord: 'верный',
  noAnswer: (n: number) => `${n} без ответа`,
  wrongTexts: 'Частые неверные ответы',
  wrongText: (text: string, n: number) => `«${text}» · ${n} ${plural(n, 'раз', 'раза', 'раз')}`,
  edit: 'Изменить',
  empty: 'Вопросы появятся здесь, когда ученики начнут писать. Ваши попытки не считаем.',
} as const;

/** P0002 of a quiz function: the quiz, not the exam, is gone. */
export const QA_ERRORS: Record<string, string> = {
  P0002: 'Такой контрольной нет. Возможно, её удалили.',
  '42501': 'Это может сделать только автор.',
};
