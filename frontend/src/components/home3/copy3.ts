/**
 * Every word of the landing v3 and its reel (owner, 2026-10-19: «неважно какую ты концепцию берешь, но она должна
 * быть… особенно про конструктор не забудь»; «убрать иишные надписи и это подчеркивание волной»). Rules for this
 * file (copy3.test.ts checks them): short plain sentences that say what happens, real numbers from the example; no
 * eyebrow labels, no «не X, а Y» contrasts, no heading built around an em dash, no slogans, no disclaimers, no
 * exclamation marks. Words of the app's own screens come from the screens' copy files.
 */

/** The page's one face: the title is «Meldy — <FACE with a small first letter>» (index.html, manifest, README). */
export const FACE = 'Подготовка к экзамену и конструктор тестов';
export const SITE_TITLE_V3 = `Meldy — ${FACE.charAt(0).toLowerCase()}${FACE.slice(1)}`;

export const HEADLINE = 'Готовьтесь к экзамену и собирайте свои тесты';
export const LEAD =
  'Из лекции Meldy делает конспект и тест, вопросы кафедры раскладывает по дням до экзамена. Свой тест собирается из блоков и уходит по ссылке.';

export const SITE = 'https://ludosiel-studyforge.hf.space';

/** Russian typesetting: a word of one or two letters («к», «и», «по», «из») keeps to the word after it. */
export const bind = (text: string): string => text.replace(/(?<=^|[\s(«\u00a0])([а-яё]{1,2}) /gi, '$1\u00a0');

/** The public test the deck agent made (author «Команда Meldy», 5 questions on price elasticity); same-site path. */
export const SAMPLE_TEST_URL = '/k/kb0dxmwb21fb';

export const CTA = {
  example: 'Попробовать на примере',
  test: 'Пройти тест без входа',
  signUp: 'Создать аккаунт',
  signIn: 'Войти',
  build: 'Собрать свой тест',
} as const;

export const NAV = [
  { id: 'lecture', label: 'Лекции' },
  { id: 'exam', label: 'Экзамены' },
  { id: 'builder', label: 'Конструктор тестов' },
] as const;

/** The reel's chapters, in its order (the bar under the reel and the transcript). */
export const CHAPTER_LABELS = {
  lecture: 'Лекция',
  file: 'Вопросы кафедры',
  plan: 'План',
  session: 'Занятие',
  ticket: 'Билет вслух',
  sheet: 'Шпаргалка',
  group: 'Группа',
  builder: 'Конструктор',
} as const;

/**
 * What the reel says, scene by scene: one or two short sentences each. The yellow dot of the wordmark ends the last
 * sentence on screen, so the sentences are kept without their final period here.
 */
export const SAY = {
  lecture: ['Вы загружаете лекцию на 82 минуты', 'Из неё Meldy делает конспект, выжимку, тест и карточки'],
  file: ['В файле кафедры 960 вопросов по 4 предметам', 'Ключи Meldy берёт из оформления файла'],
  plan: ['Вопросы разложены на 18 дней до экзамена', 'Экзамен перенесли. План пересчитан на новую дату'],
  session: ['Сегодня 20 вопросов, около 10 минут', 'В счёт идёт ответ, верный в два разных дня'],
  ticket: ['Билет 7 вы отвечаете вслух', 'Экзаменатор спрашивает о пропущенном пункте'],
  sheet: ['Пункт уходит из шпаргалки, когда вы назвали его в два разных дня'],
  group: ['Одна ссылка, и экзамен есть у всей группы', 'В 20:00 бот присылает план на день'],
  build: ['Свой тест собирается из блоков', 'Блоки перетаскиваются на страницу'],
  media: ['Можно поставить свою картинку, фон и видео'],
  look: ['Цвет, шрифт и баллы вы задаёте сами', 'Сообщение после теста зависит от баллов'],
  send: ['Тест уходит по ссылке или QR-коду'],
  take: ['Участник отвечает без аккаунта'],
  stats: ['Результаты видно, пока участники пишут'],
} as const;

/** The example the reel follows: the /try example's lecture and its question 7 (data/sheetExample.ts Q7). */
export const EXAMPLE = {
  subject: 'Микроэкономика',
  lecture: 'Лекция 6. Эластичность спроса',
  lectureMeta: 'Микроэкономика · 82 минуты',
  quoteAt: '41:12',
  quote: 'Если спрос эластичный, снижение цены увеличивает выручку.',
  question: 'Эластичность спроса и выручка продавца',
  testStem: 'Спрос неэластичный. Что будет с выручкой, если поднять цену?',
  testOptions: ['Снизится', 'Вырастет', 'Не изменится'],
  testRight: 1,
  examinerAsk: 'А если спрос неэластичный, как продавцу увеличить выручку?',
  protocol: 'Сами назвали 3 из 4 главных пунктов, ещё 1 после вопроса экзаменатора',
  testTitle: 'Эластичность спроса',
  testSubtitle: 'Микроэкономика · 5 вопросов',
  link: 'ludosiel-studyforge.hf.space/k/kb0dxmwb21fb',
  author: 'Команда Meldy',
} as const;

/** The page's sections. */
export const LECTURE_SECTION = {
  title: 'Что Meldy делает из лекции',
  text: 'Загрузите запись, файл или ссылку на видео лекции. Meldy сделает конспект, короткую выжимку, тест и карточки. В разговоре голосом можно спросить о том, что осталось непонятным.',
  tabs: ['Конспект', 'Выжимка', 'Тест', 'Карточки', 'Поговорить о лекции'],
} as const;

export const EXAM_SECTION = {
  title: 'Экзамен по вопросам вашей кафедры',
  text: 'Загрузите файл с вопросами, один на все предметы или по файлу на предмет. Meldy разложит вопросы по дням до экзамена и каждый день даст занятие на выбранное время.',
  file: {
    title: 'Файл кафедры',
    text: 'Word, Excel или TXT. Ключи к вопросам с вариантами Meldy берёт из оформления: жирный шрифт, столбец или разметка.',
  },
  plan: {
    title: 'План по дням',
    text: 'Если экзамен перенесли, нажмите «Перенести экзамен». План пересчитается на новую дату.',
    move: 'Перенести на 2 недели',
    back: 'Вернуть дату',
  },
  session: {
    title: 'Занятие',
    text: 'В счёт идёт вопрос, на который вы ответили верно в два разных дня. Между ответами не меньше 20 часов.',
  },
  ticket: {
    title: 'Билет вслух',
    text: 'Устный билет вы отвечаете голосом. Meldy сверяет ответ с пунктами из ваших лекций, а экзаменатор спрашивает о пропущенном. Отметку ставит преподаватель.',
  },
  sheet: {
    title: 'Шпаргалка',
    text: 'Под каждым устным вопросом пункты ответа. Пункт уходит, когда вы назвали его в два разных дня.',
  },
} as const;

export const GROUP_SECTION = {
  title: 'Группа и Telegram',
  text: 'Отправьте группе одну ссылку, и у каждого будет весь экзамен со своим прогрессом. Бот в Telegram присылает план на день, а вопросы открываются прямо в чате.',
} as const;

export const BUILDER_SECTION = {
  title: 'Конструктор тестов',
  text: 'Тест собирается на странице из блоков: обложка, текст, картинка, видео и вопросы. Участники проходят его по ссылке без аккаунта, а вы видите их ответы.',
  tryTitle: 'Соберите страницу',
  tryText: 'Добавьте блок, смените оформление и фон. Справа тест виден так, как его увидит участник.',
  sendTitle: 'Ссылка и QR-код',
  sendText: 'Участник открывает ссылку на телефоне и отвечает без аккаунта. Ответы приходят вам сразу.',
  statsTitle: 'Результаты',
  statsText: 'Кто пишет сейчас, кто сдал, средний балл и самые трудные вопросы. Таблицу можно скачать.',
} as const;

export const FINAL = {
  title: 'Откройте пример или пройдите готовый тест',
  text: 'В примере три лекции по микроэкономике и 12 вопросов кафедры к ним. Тест из 5 вопросов собрала команда Meldy в конструкторе.',
} as const;

export const FOOTER = 'Meldy · подготовка к экзамену и конструктор тестов';
