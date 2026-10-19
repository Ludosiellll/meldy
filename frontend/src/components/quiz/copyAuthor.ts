/**
 * The author's words of «Контрольная» (spec meldy-notes 10_Project/Quiz_and_Editor_Spec_2026-10-16.md §2.1, §2.3): the
 * list of an exam's quizzes, the settings form, the stats page with its people and questions. The words both sides
 * share (states, errors, plurals) are in copyQuiz.ts. Plain Russian, no exclamation marks.
 */
import { plural, QUIZ } from './copyQuiz';
import type { QuizAccent, QuizGrading, QuizReview } from '../../types/quiz';
import type { QuizWho } from './setupModel';

const people = (n: number) => `${n} ${plural(n, 'человек', 'человека', 'человек')}`;
/** «После сдачи участник видит»: the names of the four choices. */
const REVIEW_OPTIONS: Record<QuizReview, string> = {
  score: 'только балл',
  mistakes: 'балл и где ошибся',
  answers: 'балл, ошибки и верные ответы',
  /** The safe default: the explanations come with the right answers, after the closing (fits a phone's list). */
  mistakes_then_answers: 'балл и ошибки сразу; верные ответы и пояснения — после закрытия',
};
const keyed = (n: number) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')} с ключом`;
/** «6 баллов», «1 балл», «3 балла». */
export const pointsWord = (n: number) => `${n} ${plural(n, 'балл', 'балла', 'баллов')}`;

/** «Контрольные» of an exam: /exams/c/:id/quizzes. */
export const QA_LIST = {
  title: QUIZ.names,
  newQuiz: 'Новая контрольная',
  loading: 'Загружаем контрольные…',
  loadFailed: 'Не получилось загрузить контрольные.',
  retry: 'Повторить',
  authorOnly: 'Контрольные собирает и смотрит автор экзамена: участникам он присылает ссылку.',
  toExam: 'К экзамену',
  empty: 'Контрольных пока нет. Соберите контрольную из вопросов экзамена и пришлите ссылку: здесь будет видно, кто как ответил.',
  /** The same of a test (containers.kind 'test', release 47.3): the questions and the author are the test's. */
  authorOnlyTest: 'Контрольные собирает и смотрит автор теста: участникам он присылает ссылку.',
  toTest: 'К тесту',
  emptyTest: 'Контрольных пока нет. Соберите контрольную из вопросов теста и пришлите ссылку: здесь будет видно, кто как ответил.',
  /** «пишут 2 · сдали 5 · средний 71 %» (attempts; the average leaves the author out); nobody but the author — «пока никто не писал». */
  counts: (writing: number, finished: number, avg: number | null, anyone: boolean) =>
    anyone ? [`пишут ${writing}`, `сдали ${finished}`, avg === null ? null : `средний ${Math.round(avg)} %`].filter(Boolean).join(' · ') : 'пока никто не писал',
  meta: (count: number, seconds: number | null) => [QUIZ.questions(count), seconds ? QUIZ.minutes(Math.round(seconds / 60)) : QUIZ.noTimer].join(' · '),
} as const;

/** The settings form: /exams/c/:id/quizzes/new and …/:quizId/edit (spec §2.1). */
export const QA_SETUP = {
  newTitle: 'Новая контрольная',
  editTitle: 'Настройки контрольной',
  loading: 'Загружаем…',
  loadFailed: 'Не получилось загрузить контрольную.',
  notFound: 'Такой контрольной нет: возможно, её удалили.',
  retry: 'Повторить',
  toList: 'К списку контрольных',
  partQuestions: 'Вопросы',
  partWhen: 'Когда и как',
  name: 'Название',
  subjects: 'Вопросы из',
  subjectMeta: (n: number) => (n > 0 ? keyed(n) : 'нет вопросов с ключом'),
  pool: (n: number) => `В контрольную идут только вопросы с ключом: в выбранных предметах их ${n}.`,
  /** One subject: no «Вопросы из», the count's hint says the pool. */
  poolOne: (n: number) => `В контрольную идут только вопросы с ключом: их ${n}.`,
  /** The part of a quiz of all the questions (?all=1) with the five settings that matter first. */
  partMain: 'Основное',
  /** The rest of the settings of ?all=1, folded. */
  more: 'Ещё настройки',
  moreNote: 'вопросы и порядок, попытки, проходной балл, что ученик видит после сдачи',
  noPool: 'В экзамене нет вопросов с ключом: контрольную пока не из чего собрать.',
  toKeys: 'Вопросы и ключи',
  count: 'Сколько вопросов',
  countAll: (n: number) => `все (${n})`,
  countOption: (n: number) => `${n}`,
  set: 'Набор',
  setOwn: 'свой у каждого',
  setSame: 'одинаковый у всех',
  setOwnHint: 'Каждая попытка берёт новый набор вопросов.',
  order: 'Порядок вопросов',
  orderShuffle: 'вперемешку',
  orderFile: 'как в экзамене',
  options: 'Варианты ответа',
  optionsShuffle: 'вперемешку',
  optionsFile: 'как в файле',
  optionsHint: 'Вопросы с пометкой «Не перемешивать варианты» всегда идут как в файле.',
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
  closesPast: 'Это время уже прошло: контрольная будет закрыта.',
  /** Beside the date field: the date in words («до 25 октября, 23:59»). */
  opensWords: (when: string) => `с ${when}`,
  closesWords: (when: string) => `до ${when}`,
  attempts: 'Попыток',
  attemptsNone: 'без ограничения (до 50)',
  attemptsOption: (n: number) => `${n}`,
  grading: 'В зачёт',
  gradingOption: (g: QuizGrading) => (g === 'best' ? 'лучшая попытка' : 'последняя попытка'),
  back: 'Возврат к вопросам',
  backYes: 'можно',
  backNo: 'только вперёд',
  pass: 'Проходной балл',
  passNone: 'нет',
  passOption: (n: number) => `${n} %`,
  review: 'После сдачи участник видит',
  reviewOption: (r: QuizReview) => REVIEW_OPTIONS[r],
  /** Without an account and with the right answers at once: a second browser is a fresh start that shows them. */
  reviewGuests: `Без входа тест можно открыть заново в другом браузере и увидеть ответы до своей попытки. Для контрольной лучше «${REVIEW_OPTIONS.mistakes_then_answers}».`,
  /** A question of the set has the author's explanation: when the takers see it (it comes with the right answers). */
  reviewExplain: (review: QuizReview) =>
    review === 'answers'
      ? 'В тесте есть пояснения. Ученики увидят их вместе с верными ответами — сразу.'
      : review === 'mistakes_then_answers'
        ? 'В тесте есть пояснения. Ученики увидят их вместе с верными ответами — после закрытия.'
        : 'В тесте есть пояснения. При этой настройке ученики их не увидят: пояснения показываются вместе с верными ответами.',
  who: 'Кто может писать',
  /** `test`: the quiz is a test's (containers.kind 'test', release 47.3), its members are the test's. */
  whoOption: (who: QuizWho, test = false) =>
    ({
      guests: 'все по ссылке, без входа',
      link: 'все по ссылке, со входом',
      members: test ? 'только участники этого теста' : 'только участники этого экзамена',
    })[who],
  whoHint: (who: QuizWho, test = false) =>
    ({
      guests: 'Участнику не нужен аккаунт. Его попытки считаются по браузеру: в другом браузере можно начать заново.',
      link: 'Чтобы начать, участник входит в Meldy или создаёт аккаунт. Попытки считаются по аккаунту.',
      members: `Писать могут только те, кто уже вступил в этот ${test ? 'тест' : 'экзамен'}. Остальные увидят, что контрольная только для участников.`,
    })[who],
  /** The words of the participant's button «Тренировать эти вопросы» (copyTake RESULT.practiceJoin; release 47.1). */
  practice: 'После сдачи предложить тренировать эти вопросы в Meldy',
  /** The button waits until no quiz of the exam is open or not yet open (20261018130000_quiz_guards). */
  practiceNote: 'После закрытия ученикам предложат тренировать вопросы экзамена в Meldy (в тренировке видны все ответы).',
  practiceSeen: 'Кто согласится, появится в списке участников экзамена. Его прогресс вам не виден.',
  /** The same of a test (containers.kind 'test', release 47.3). */
  practiceNoteTest: 'После закрытия ученикам предложат тренировать вопросы теста в Meldy (в тренировке видны все ответы).',
  practiceSeenTest: 'Кто согласится, появится в списке участников теста. Его прогресс вам не виден.',
  partLook: 'Оформление',
  cover: 'Обложка',
  coverHint: 'Картинка над названием на странице контрольной: PNG, JPEG, GIF или WebP до 3 МБ.',
  coverUpload: 'Загрузить обложку',
  coverReplace: 'Заменить',
  coverRemove: 'Убрать',
  coverAlt: 'Обложка контрольной',
  coverUploading: 'Загружаем обложку…',
  coverType: 'Это не картинка. Подойдут JPEG, PNG, GIF, WebP и фото с телефона.',
  coverSize: 'Картинка больше 3 МБ даже после сжатия.',
  coverHeic: 'Этот формат телефон не отдаёт браузеру. Сохраните фото как JPEG или сделайте снимок экрана.',
  coverRefused: 'Хранилище не приняло эту картинку. Подойдут PNG, JPEG, GIF, WebP до 3 МБ.',
  coverFailed: 'Обложка не загрузилась. Попробуйте ещё раз.',
  accent: 'Цвет',
  accentHint: 'Цвет кнопок и полосы времени на странице контрольной.',
  accentName: (accent: QuizAccent) =>
    ({
      blue: 'Синий',
      green: 'Зелёный',
      orange: 'Оранжевый',
      violet: 'Фиолетовый',
      pink: 'Розовый',
      graphite: 'Графит',
    })[accent],
  locked: 'Контрольную уже начали писать: предметы, число вопросов, набор, порядок и время больше не меняются. Остальное можно.',
  /** A quiz «как в студии» (release 47.2). */
  lockedDesign: 'Контрольную уже начали писать: «Как в студии», порядок вариантов и время больше не меняются. Остальное можно.',
  design: 'Как в студии',
  designLine: 'Вопросы, порядок и оформление — как в студии.',
  designOff: 'Вопросы — из предметов экзамена, как в обычной контрольной.',
  toStudio: 'Открыть студию',
  moreNoteDesign: 'варианты ответа, попытки, проходной балл, что ученик видит после сдачи',
  problems: {
    title: 'Напишите название, до 120 знаков.',
    subjects: 'Отметьте хотя бы один предмет.',
    count: 'В выбранных предметах нет вопросов с ключом.',
    page: 'На странице студии нет вопросов с ключом.',
    window: '«Открыта до» должно быть позже, чем «Открыта с».',
    when: 'Укажите дату и время.',
  },
  create: 'Создать',
  creating: 'Создаём…',
  save: 'Сохранить',
  saving: 'Сохраняем…',
  cancel: 'Отмена',
} as const;

/** The stats page: /exams/c/:id/quizzes/:quizId (spec §2.3). */
export const QA_STATS = {
  loading: 'Загружаем результаты…',
  loadFailed: 'Не получилось загрузить результаты.',
  notFound: 'Такой контрольной нет: возможно, её удалили.',
  retry: 'Повторить',
  toList: 'К списку контрольных',
  created: 'Контрольная создана. Пришлите ссылку участникам.',
  saved: 'Настройки сохранены.',
  closedHint: 'Чтобы открыть снова, поставьте в настройках новое время в «Открыта до».',
  link: 'Ссылка для участников',
  copy: 'Скопировать',
  copied: 'Скопировано',
  copiedLine: 'Ссылка скопирована.',
  copyFailed: 'Не получилось скопировать: выделите ссылку в поле и скопируйте её.',
  /** Sharing the link (release 47): a QR on the whole screen, the phone's sharing, the page as a taker sees it. */
  qr: 'Показать QR',
  qrTitle: 'QR-код ссылки на контрольную',
  qrHint: 'Наведите камеру телефона на код или наберите адрес.',
  qrClose: 'Закрыть',
  share: 'Поделиться',
  asTaker: 'Открыть как ученик',
  asTakerLabel: 'Открыть как ученик (в новой вкладке)',
  edit: 'Изменить настройки',
  close: 'Закрыть сейчас',
  closeAsk: (writing: number) =>
    writing > 0
      ? `Закрыть контрольную сейчас? Кто пишет (${people(writing)}), закончит с теми ответами, что успел дать.`
      : 'Закрыть контрольную сейчас? Начать новую попытку будет нельзя.',
  closeYes: 'Закрыть',
  remove: 'Удалить',
  removeAsk: (title: string) => `Удалить «${title}»? Попытки, ответы и результаты участников пропадут.`,
  removeYes: 'Удалить',
  no: 'Отмена',
  summary: (writing: number, done: number, avg: number | null, passed: number | null) =>
    [
      `Пишут сейчас: ${writing}`,
      `Сдали: ${done}`,
      avg === null ? null : `Средний результат: ${avg} %`,
      passed === null || done === 0 ? null : `Прошли порог: ${passed} из ${done}`,
    ]
      .filter(Boolean)
      .join(' · '),
  nobody: 'Пока никто не писал. Пришлите ссылку участникам: результаты появятся здесь сами.',
  onlyOwn: 'Пока писали только вы — ваши попытки в итоги не идут. Пришлите ссылку участникам: их результаты появятся здесь сами.',
  tabs: 'Результаты',
  tabPeople: 'Участники',
  tabQuestions: 'Вопросы',
  download: 'Скачать таблицу',
  downloading: 'Готовим таблицу…',
  downloadFailed: 'Не получилось собрать таблицу. Попробуйте ещё раз.',
  stale: (time: string) => `Нет связи с сервером: показаны результаты на ${time}. Обновим, когда связь вернётся.`,
} as const;

/** «Участники»: one row a person, their answers in a sheet. */
export const QA_PEOPLE = {
  title: 'Участники',
  own: '(вы)',
  ownHint: 'Ваши собственные попытки помечены «(вы)» и в средний результат не идут.',
  /** Beside the name of somebody who wrote without an account (release 47). */
  guest: 'без входа',
  guestHint: 'Попытки без входа считаются по браузеру.',
  sort: 'Порядок',
  sortOption: (key: 'name' | 'result' | 'time') => ({ name: 'по имени', result: 'по результату', time: 'по времени' })[key],
  head: { name: 'Имя', status: 'Сейчас', result: 'Результат', minutes: 'Время', attempts: 'Попытки' },
  writing: (answered: number, total: number, left: string | null) => `пишет — ${answered} из ${total}${left ? `, осталось ${left}` : ''}`,
  done: (time: string) => `сдано ${time}`,
  time: 'время вышло',
  /** Still unfinished, the clock at 00:00: the server takes the last answers for 20 s more, then closes it. */
  timeOver: 'время вышло, ответы сдаются',
  closed: 'закрыта',
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
  attemptGone: 'Этой попытки уже нет: её сбросили или удалили вместе с контрольной.',
  retry: 'Повторить',
  noAnswers: 'В этой попытке пока нет ответов.',
  unanswered: (n: number) => `Без ответа: ${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}.`,
  context: (subject: string, no: string) => `${subject} · № ${no}`.replace(/^ · /, ''),
  gone: 'Этого вопроса больше нет в экзамене.',
  answer: (text: string) => `Ответ: ${text}`,
  key: (text: string) => `Ключ: ${text}`,
  forms: (text: string) => `Принимается: ${text}`,
  noKey: 'Ключа сейчас нет.',
  right: 'верно',
  wrong: 'неверно',
  reset: 'Сбросить попытку',
  resetAsk: (n: number) => `Сбросить попытку ${n}? Её ответы пропадут, а человек сможет написать её заново.`,
  resetYes: 'Сбросить',
  resetNo: 'Отмена',
} as const;

/** «Вопросы»: the hardest first, the picks of each option, the common wrong short answers. */
export const QA_QUESTIONS = {
  title: 'Вопросы',
  hint: 'От самого трудного к лёгкому. Попытки автора не считаются.',
  line: (context: string, correct: number, shown: number, percent: number | null) =>
    shown > 0 ? `${context} — верно ${correct} из ${shown}${percent === null ? '' : ` (${percent} %)`}` : `${context} — пока никто не отвечал`,
  gone: 'Этого вопроса больше нет в экзамене.',
  picks: 'Выборы по вариантам',
  keyWord: 'ключ',
  noAnswer: (n: number) => `без ответа: ${n}`,
  wrongTexts: 'Частые неверные ответы',
  wrongText: (text: string, n: number) => `«${text}» — ${n}`,
  edit: 'Изменить',
  empty: 'Вопросы появятся здесь, когда участники начнут писать. Ваши собственные попытки сюда не идут.',
} as const;

/** P0002 of a quiz function: the quiz, not the exam, is gone. */
export const QA_ERRORS: Record<string, string> = {
  P0002: 'Такой контрольной нет: возможно, её удалили.',
  '42501': 'Это может только автор экзамена.',
};
