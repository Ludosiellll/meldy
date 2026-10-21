/**
 * The words of «Быстрая контрольная» and of the ways to it (UX audit of 21.10): the quick test's screen and its link,
 * the «Экзамены | Тесты» switch, the goal choice of «Первые шаги» and of the first-run guide, the studio's paste that
 * gave no questions. Written to the owner's plain-words rules of 21.10: what happened and what to do, one thought in one
 * short sentence, a verb and its object on a button. «Контрольная» is said in one line where it first shows: a test the
 * students write by its link before a deadline.
 */
import { count, plural } from '../containers/copyImport';

const questions = (n: number) => count(n, 'вопрос', 'вопроса', 'вопросов');
const days = (n: number) => count(n, 'день', 'дня', 'дней');
const attempts = (n: number) => count(n, 'попытка', 'попытки', 'попыток');
const minutes = (n: number) => count(n, 'минута', 'минуты', 'минут');
const quizzes = (n: number) => count(n, 'контрольная', 'контрольные', 'контрольных');

/** What «контрольная» is, said once where the word first shows. */
export const QUIZ_MEANS = 'Ученики пишут контрольную по ссылке до срока.';

export const QUICK = {
  docTitle: 'Быстрая контрольная',
  title: 'Быстрая контрольная',
  /** Back to the tests. */
  crumb: 'Тесты',
  lede: QUIZ_MEANS,
  ledeMore: 'Вставьте вопросы из Word или из чата.',

  name: 'Название',
  namePlaceholder: 'Например, Кислоты и основания, 9 Б',
  text: 'Вопросы',
  textPlaceholder: ['1. Сколько будет 2 + 2?', 'а) 3', 'б) 4 *', 'в) 5', '', '2. Столица Франции?', 'Ответ: Париж'].join('\n'),
  /** Under the field: how to mark the right answer (a computer has the questions on the right, a phone below). */
  howTo: (side: 'right' | 'below') =>
    `Верный вариант отметьте звёздочкой * или строкой «Ответ: б». Ещё можно нажать на верный вариант ${side === 'right' ? 'справа' : 'ниже'}.`,

  // the questions found
  found: (n: number) => (n > 0 ? `Нашли ${questions(n)}` : 'Вопросов пока нет'),
  waiting: (side: 'right' | 'below') => `Вставьте вопросы, и они появятся ${side === 'right' ? 'здесь' : 'ниже'}.`,
  waitingPhone: 'Вставьте вопросы выше, и они появятся здесь.',
  nothing: 'Здесь нет вопросов. Начните вопрос с номера «1.». Варианты пишите с новой строки: «а)», «б)».',
  reading: 'Читаем вопросы…',
  readFailed: 'Не получилось прочитать вопросы. Проверьте интернет.',
  retry: 'Повторить',
  /** The badge over the questions: how many still need their answer. */
  noKey: (n: number) => `${questions(n)} без ответа`,
  number: (n: number) => `Вопрос ${n}`,
  kinds: { single: 'Один ответ', multiple: 'Несколько ответов', short: 'Короткий ответ' } as const,
  tapRight: 'Нажмите на верный вариант',
  right: 'верный',
  shortAnswer: (forms: string[]) => `Ответ: ${forms.join(' или ')}`,
  blocked: 'Нет вариантов. Допишите варианты или строку «Ответ: …».',
  marked: (n: number, letter: string) => `Вопрос ${n}. Верный вариант ${letter}.`,
  /** Lines of the text that are not questions («Удачи!», the class's name). */
  skipped: (n: number) => `${count(n, 'строка', 'строки', 'строк')} не ${plural(n, 'похожа', 'похожи', 'похожи')} на вопросы.`,
  skippedShow: 'Показать',
  skippedHide: 'Скрыть',

  // the settings
  settings: 'Настройки контрольной',
  who: { label: 'Кто пишет', guests: 'Без входа', link: 'Со входом в Meldy' },
  time: { label: 'Время', none: 'Время не ограничено', some: (n: number) => (n === 60 ? '1 час' : minutes(n)) },
  open: { label: 'Сколько открыта', days: (n: number) => `Открыта ${days(n)}`, never: 'Без срока' },
  tries: { label: 'Попытки', some: (n: number) => attempts(n), any: 'Попыток сколько угодно' },
  more: 'Ещё настройки',

  // the button and why it waits
  submit: 'Получить ссылку',
  saving: 'Сохраняем…',
  inQuiz: (n: number) => `В контрольной ${questions(n)}.`,
  leftOut: (n: number) => `${questions(n)} без ответа не ${plural(n, 'войдёт', 'войдут', 'войдут')}.`,
  needText: 'Сначала вставьте вопросы.',
  needKey: 'Отметьте верный ответ хотя бы в одном вопросе.',
  saveFailed: 'Не получилось сохранить. Попробуйте ещё раз.',
} as const;

/** The quick test's link, at once after «Получить ссылку» (and the test's way back to it). */
export const QUICK_LINK = {
  docTitle: 'Ссылка на контрольную',
  ready: 'Ссылка готова',
  /** Tags under the name: no full stop. */
  guests: 'Ученикам вход не нужен',
  signIn: 'Ученики входят в Meldy',
  questions,
  noTime: 'Без ограничения времени',
  time: (n: number) => (n === 60 ? 'На 1 час' : `На ${minutes(n)}`),
  until: (date: string) => `Открыта до ${date}`,
  noEnd: 'Без срока',
  closed: 'Закрыта',
  qr: 'QR-код ссылки',
  copy: 'Скопировать ссылку',
  copied: 'Ссылка скопирована',
  copyFailed: 'Не получилось скопировать. Выделите ссылку и скопируйте её.',
  share: 'Поделиться',
  full: 'Показать QR на весь экран',
  hint: 'Отправьте ссылку в чат класса или покажите QR на уроке.',
  results: 'Результаты',
  nobody: 'Пока никто не начал. Здесь будет видно, кто пишет и кто сдал.',
  writing: (n: number) => `Пишут ${n}`,
  finished: (n: number) => `Сдали ${n}`,
  openResults: 'Открыть результаты',
  studio: 'Оформить в студии',
  edit: 'Изменить настройки',
  another: 'Сделать ещё одну',
  loading: 'Загружаем ссылку…',
  failed: 'Не получилось загрузить ссылку.',
  missing: 'Этой контрольной больше нет.',
  retry: 'Повторить',
  toTests: 'К тестам',
} as const;

/** «Экзамены | Тесты» on «Экзамены»: the switch, the tests with their контрольные, the two ways to make one. */
export const TESTS_VIEW = {
  switchLabel: 'Что показать',
  exams: 'Экзамены',
  tests: 'Тесты',
  title: 'Тесты',
  lede: QUIZ_MEANS,
  quick: 'Быстрая контрольная',
  quickNote: 'Вставьте вопросы и получите ссылку. Ученикам вход не нужен.',
  studio: 'Тест в студии',
  studioNote: 'Картинки, оформление и свой экран результата.',
  listLabel: 'Ваши тесты',
  meta: (total: number, quizCount: number | null) =>
    [total > 0 ? questions(total) : 'Пока без вопросов', quizCount ? quizzes(quizCount) : null].filter(Boolean) as string[],
  notSent: 'Ещё не отправлен.',
  send: 'Отправить по ссылке',
  link: 'Показать ссылку',
  results: 'Открыть результаты',
  finished: (n: number) => (n > 0 ? `Сдали ${n}` : 'Пока никто не сдал'),
  loading: 'Загружаем…',
  failed: 'Не загрузилось.',
  retry: 'Повторить',
  empty: 'Тестов пока нет. Начните с быстрой контрольной.',
  more: (n: number) => `Ещё ${quizzes(n)}`,
} as const;

/** The goal at the start: «Первые шаги» on «Сегодня» and the first-run guide's first card. */
export const GOAL = {
  lede: 'Выберите, с чего начать. Второе можно сделать потом.',
  exam: {
    title: 'Готовлюсь к экзамену',
    text: 'Загрузите вопросы к экзамену. Meldy разложит их по дням.',
    action: 'Новый экзамен',
  },
  test: {
    title: 'Даю тест ученикам',
    text: 'Вставьте вопросы и получите ссылку. Ученикам вход не нужен.',
    action: 'Быстрая контрольная',
  },
  tryFirst: 'Сначала посмотреть?',
  tryLink: 'Попробовать на примере',
} as const;

/** The first-run guide: its first card, the way out, and the three cards for a teacher. */
export const GUIDE_START = {
  kicker: 'Знакомство с Meldy',
  title: 'Что вы хотите сделать?',
  lede: 'Покажем только нужное. Остальное откроется по кнопке «?» вверху.',
  ledePhone: 'Покажем только нужное. Остальное откроется в меню профиля.',
  examSteps: '4 коротких шага',
  testSteps: '3 коротких шага',
  all: 'Показать все разделы',
  skip: 'Пропустить знакомство',
  next: 'Дальше',
  close: 'Закрыть',
  /** The last card of the teacher's way: it opens «Быстрая контрольная». */
  startTest: 'Сделать контрольную',
  test: [
    {
      title: 'Быстрая контрольная',
      text: 'Откройте «Экзамены», затем «Тесты». Нажмите «Быстрая контрольная» и вставьте вопросы. Ссылка и QR-код появятся сразу.',
    },
    {
      title: 'Как ученик пишет',
      text: 'Ученик открывает ссылку и пишет своё имя. Входить в Meldy ему не нужно. После «Завершить» он видит свой результат.',
    },
    {
      title: 'Результаты',
      text: 'Откройте тест в «Тестах». Там видно, кто пишет и кто сдал. Таблицу можно скачать для Excel.',
    },
  ],
  /** «Экзамены» as an empty page shows it: the button there is «Выбрать файлы». */
  examsEmpty:
    'Нажмите «Выбрать файлы» и загрузите вопросы к экзамену. Можно один общий файл или по файлу на предмет. Ключ к вариантам Meldy возьмёт из файла.',
} as const;

/** The studio: a paste that gave no questions, and why «Отправить по ссылке» waits. */
export const STUDIO_PASTE = {
  noneTitle: 'Вопросов не нашлось',
  noneText: 'Похоже на вопросы из Word. Meldy может сделать из них вопросы с вариантами.',
  make: 'Сделать вопросами',
  making: 'Делаем вопросы…',
  asText: 'Оставить текстом',
  notFound: 'В тексте нет вопросов. Начните вопрос с номера «1.», варианты пишите с новой строки: «а)», «б)».',
  made: (n: number) => `Готово. ${count(n, 'вопрос', 'вопроса', 'вопросов')} на странице.`,
  noKeyAfter: (n: number) => `У ${count(n, 'вопроса', 'вопросов', 'вопросов')} нет верного ответа. Отметьте его на странице.`,
  failed: 'Не получилось сделать вопросы. Попробуйте ещё раз.',
  /** Why «Отправить по ссылке» waits, said on the page. */
  sendWaitsEmpty: 'Чтобы отправить тест, добавьте в него вопросы.',
  sendWaitsKey: 'Чтобы отправить тест, отметьте верный ответ хотя бы в одном вопросе.',
  /** «Проверка теста»: no question has its key. */
  checkNoKeyed: 'В тесте нет вопросов с верным ответом. Без них тест не отправить.',
  checkNoQuestions: 'В тесте пока нет вопросов. Добавьте их, и тест можно будет отправить.',
} as const;
