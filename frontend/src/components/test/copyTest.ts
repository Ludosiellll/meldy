/**
 * The words of «Новый тест» and «Конструктор» (spec 2026-10-18 §47.2): the entry on «Экзамены», the page that names a
 * new test (/tests/new) and the author's builder (/exams/c/:id/build). Words the keys page and the editor already have
 * are taken from copyImport.ts (KEYS, EDITOR), not repeated here.
 */
import { count, NBSP } from '../containers/copyImport';

const questions = (n: number) => count(n, 'вопрос', 'вопроса', 'вопросов');
const subjects = (n: number) => count(n, 'предмет', 'предмета', 'предметов');

/** The four kinds of question the builder adds; «верно / неверно» is a one-answer question with two fixed options. */
export type BuildType = 'single' | 'multiple' | 'short' | 'truefalse';

export const NEW_TEST = {
  entry: 'Новый тест',
  /** Under the two doors on «Экзамены» (release 47, M11): what each one makes. */
  examNote: 'Экзамен — план подготовки по вопросам и лекциям',
  entryNote: 'Тест — свои вопросы, ученикам по ссылке',
  /** On the empty «Экзамены», under the import's door. */
  emptyLead: 'Файла нет? Напишите вопросы сами:',
  docTitle: 'Новый тест',
  title: 'Новый тест',
  lede: 'Назовите тест, затем добавьте вопросы: с одним или несколькими верными ответами, с коротким ответом или «верно / неверно».',
  name: 'Название теста',
  create: 'Создать',
  creating: 'Создаём…',
  nameEmpty: 'Назовите тест.',
  /** The one subject a new test starts with. */
  subject: 'Вопросы',
} as const;

/** The most characters of a test's name on /tests/new. */
export const TEST_TITLE_MAX = 120;

export const BUILD = {
  label: 'Конструктор',
  docTitle: 'Конструктор',
  meta: (total: number, subjectCount: number, noKey: number) =>
    [
      subjectCount > 1 ? subjects(subjectCount) : null,
      total > 0 ? questions(total) : 'пока без вопросов',
      noKey > 0 ? `без ключа: ${noKey}` : null,
    ]
      .filter(Boolean)
      .join(`${NBSP}· `),
  subjectCount: (n: number) => questions(n),
  list: 'Вопросы',
  number: (n: number) => `Вопрос ${n}`,
  types: {
    single: 'Один ответ',
    multiple: 'Несколько ответов',
    short: 'Короткий ответ',
    truefalse: 'Верно / неверно',
  } as Record<BuildType, string>,
  /** What the author does in the editor of a new question of that kind. */
  typeHints: {
    single: 'отметьте верный вариант',
    multiple: 'отметьте все верные варианты',
    short: 'напишите принятые ответы через «;»',
    truefalse: 'отметьте, какой вариант верный',
  } as Record<BuildType, string>,
  trueWord: 'Верно',
  falseWord: 'Неверно',
  typeChoice: 'Какой вопрос добавить',
  cancel: 'Отмена',
  empty: 'В тесте пока нет вопросов. Выберите, с какого начать.',
  rightWord: 'верный',
  /** A question without its key, on the card and in the editor (release 47, M10). */
  noKey: 'Не отмечен верный ответ: вопрос не попадёт в контрольную и в повторение.',
  forms: 'Принятые ответы',
  explanation: 'Пояснение',
  copy: 'Копия',
  remove: 'Удалить',
  up: 'Выше',
  down: 'Ниже',
  removeAsk: (n: number, group: boolean) => `Удалить вопрос ${n}? Ответы по нему пропадут${group ? ' у всех участников' : ''}.`,
  copied: (n: number) => `Копия добавлена: вопрос ${n}.`,
  copiedEnd: 'Копия добавлена в конец списка: поставить её под этим вопросом не получилось.',
  moved: (n: number) => `Вопрос теперь на месте ${n}.`,
  moveFailed: 'Порядок не сохранился, вопрос вернулся на место.',
  added: (n: number) => `Вопрос ${n} добавлен.`,
  newContext: (n: number, type: BuildType) => `Новый вопрос ${n} · ${BUILD.types[type]}: ${BUILD.typeHints[type]}`,
  editContext: (n: number, type: BuildType) => `Вопрос ${n} · ${BUILD.types[type]}`,
  send: 'Отправить по ссылке',
  sendWhy: 'Отправить можно, когда хотя бы у одного вопроса отмечен верный ответ.',
  quizzes: 'Контрольные',
  settings: 'Настройки',
  noSubjects: 'В этом экзамене только устные предметы: их вопросы правят на странице предмета.',
} as const;

const quizzes = (n: number) => count(n, 'контрольная', 'контрольные', 'контрольных');

/**
 * The test's own page (release 47.3; owner, 18.10: the page of a test was an exam's study page — eight pills, the
 * plan's «На сегодня здесь всё», «В счёт идёт вопрос…»): /exams/c/:id for the author of a test (containers.kind 'test').
 */
export const TEST_HOME = {
  /** «Тест · 12 вопросов · 2 контрольные»; no question yet — «пока без вопросов»; no quiz — not said. */
  meta: (total: number, quizCount: number | null) =>
    ['Тест', total > 0 ? questions(total) : 'пока без вопросов', quizCount ? quizzes(quizCount) : null].filter(Boolean).join(`${NBSP}· `),
  /** The row on «Экзамены»: «Тест · 12 вопросов». */
  listMeta: (total: number) => `Тест${NBSP}· ${total > 0 ? questions(total) : 'пока без вопросов'}`,
  studio: 'Открыть студию',
  send: BUILD.send,
  /** Why «Отправить по ссылке» waits: no question yet, or none with its key. */
  sendWhyEmpty: 'Отправить можно, когда в тесте появятся вопросы: добавьте их в студии.',
  sendWhyKey: BUILD.sendWhy,
  quizzes: BUILD.quizzes,
  quizzesLoading: 'Загружаем контрольные…',
  quizzesFailed: 'Не получилось загрузить контрольные.',
  retry: 'Повторить',
  quizzesEmpty: 'Контрольных пока нет. Отправьте тест по ссылке: здесь будет видно, кто его написал и как.',
  /** «сдали 5»; nobody yet — «пока никто не сдал». */
  finished: (n: number) => (n > 0 ? `сдали ${n}` : 'пока никто не сдал'),
  menuLabel: 'Ещё: тест',
} as const;

/** «Это экзамен» / «Это тест» in «Настройки»: the author's own choice, saved at once. */
export const KIND = {
  label: 'Что это',
  exam: 'Это экзамен',
  test: 'Это тест',
  examHint: 'Вы готовитесь сами: план на каждый день, время в день, напоминания в Telegram.',
  testHint: 'Вы даёте вопросы другим: студия, ссылка, контрольные. В ваш план на день он не входит.',
  saving: 'Сохраняем…',
  savedExam: 'Сохранено: это экзамен.',
  savedTest: 'Сохранено: это тест.',
} as const;

/** «Удалить» of a test: the words of «Настройки» and of the confirm on the test's page, one source. */
export const REMOVE_TEST = {
  title: 'Удалить тест',
  ask: (title: string) => `Удалить «${title}»? Вопросы, контрольные и их результаты пропадут.`,
  yes: 'Удалить тест',
  done: (title: string) => `Тест «${title}» удалён.`,
} as const;
