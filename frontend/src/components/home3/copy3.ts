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
  'Meldy сделает из лекции конспект и тест. Вопросы к экзамену разложит по дням. Свой тест вы соберёте сами и отправите по ссылке.';

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
  game: 'Провести игру',
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
  learn: 'Осталось выучить',
  group: 'Группа',
  game: 'Игра в классе',
  builder: 'Конструктор',
} as const;

/**
 * What the reel says, scene by scene: one or two short sentences each. The yellow dot of the wordmark ends the last
 * sentence on screen, so the sentences are kept without their final period here.
 */
export const SAY = {
  lecture: ['Вы загружаете лекцию на 82 минуты', 'Из неё Meldy делает конспект, выжимку, тест и карточки'],
  file: ['В файле кафедры 960 вопросов по 4 предметам', 'Верные ответы Meldy берёт из файла'],
  plan: ['Вопросы разложены на 18 дней до экзамена', 'Экзамен перенесли. План пересчитан на новую дату'],
  session: ['Сегодня 20 вопросов, около 10 минут', 'Видно, сколько вопросов уже выучено'],
  ticket: ['Билет 7 вы отвечаете вслух', 'Экзаменатор спрашивает о том, что вы пропустили'],
  learn: ['Экзамен разбит на темы', 'Ответили на последний вопрос, и тема выучена'],
  group: ['Одна ссылка, и экзамен есть у всей группы', 'В 20:00 бот присылает план на день'],
  game: ['Класс играет на проекторе, ученики заходят из Telegram', 'Кто не успел к верному ответу, проваливается'],
  build: ['Свой тест собирается из блоков', 'Блоки перетаскиваются на страницу'],
  media: ['Можно поставить свою картинку, фон и видео'],
  look: ['Цвет, шрифт и баллы вы задаёте сами', 'Сообщение после теста зависит от баллов'],
  send: ['Тест уходит по ссылке или QR-коду'],
  take: ['Участник отвечает без аккаунта'],
  stats: ['Результаты видно, пока участники пишут'],
} as const;

/** The example the reel follows: the /try example's lecture and its question 7 (data/ticketExample.ts Q7). */
export const EXAMPLE = {
  subject: 'Микроэкономика',
  lecture: 'Лекция 6. Эластичность спроса',
  lectureMeta: 'Микроэкономика, 82 минуты',
  quoteAt: '41:12',
  quote: 'Если спрос эластичный, снижение цены увеличивает выручку.',
  question: 'Эластичность спроса и выручка продавца',
  testStem: 'Спрос неэластичный. Что будет с выручкой, если поднять цену?',
  testOptions: ['Снизится', 'Вырастет', 'Не изменится'],
  testRight: 1,
  examinerAsk: 'А если спрос неэластичный, как продавцу увеличить выручку?',
  protocol: '3 из 4 главных мыслей вы назвали сами. Ещё одну после вопроса экзаменатора.',
  testTitle: 'Эластичность спроса',
  testSubtitle: 'Микроэкономика, 5 вопросов',
  link: 'ludosiel-studyforge.hf.space/k/kb0dxmwb21fb',
  author: 'Команда Meldy',
} as const;

/*
 * The page's own words (owner, 2026-10-21: «бесят эти надписи, ты когда их читаешь нихуя не понятно»; rules in the
 * project notes, «Простые слова»): a first-year student or a teacher reads each line once on a phone and knows what
 * Meldy does for them and what to press. The result, not the rule; one short sentence a thought; no chains through
 * «—», «:» or «·»; everyday words, never our own terms; a button is a verb and its object; a number first, with its
 * noun. copy3.test.ts holds the parts a test can see.
 */

export const LECTURE_SECTION = {
  title: 'Что Meldy делает из лекции',
  text: 'Загрузите запись лекции, файл или ссылку на видео. Meldy сделает конспект, выжимку, тест и карточки. Что осталось непонятным, можно спросить голосом.',
  tabs: ['Конспект', 'Выжимка', 'Тест', 'Карточки', 'Поговорить о лекции'],
} as const;

export const EXAM_SECTION = {
  title: 'Экзамен по вопросам вашей кафедры',
  text: 'Загрузите вопросы к экзамену одним файлом или по файлу на предмет. Meldy разложит их по дням. Каждый день вас ждёт занятие на то время, которое вы выбрали.',
  file: {
    title: 'Файл кафедры',
    text: 'Подойдёт Word, Excel или TXT. Правильные ответы Meldy находит сам, например по жирному шрифту.',
    found: 'Нашли 4 предмета и 960 вопросов',
  },
  plan: {
    title: 'План по дням',
    text: 'Вопросы разложены по дням до экзамена. Если экзамен перенесли, план сам сдвинется на новую дату.',
    move: 'Перенести на 2 недели',
    back: 'Вернуть дату',
  },
  session: {
    title: 'Занятие',
    text: 'Вопрос выучен, когда вы ответили верно в два разных дня. Видно, сколько тем осталось.',
    idle: 'Выберите ответ.',
    right: 'Верно, и вчера тоже. Вопрос выучен.',
    wrong: 'Неверно. Правильный ответ «Вырастет». Повторим его в понедельник.',
    again: 'Ответить ещё раз',
    learned: 'Выучено',
  },
  /** What is left of the exam (owner, 2026-10-21): the exam broken into topics, each closes when it is learned. */
  left: {
    title: 'Осталось выучить',
    of: 24,
    topics: [
      { title: 'Рыночное равновесие', done: 9, of: 10 },
      { title: 'Эластичность и выручка', done: 5, of: 6 },
      { title: 'Факторы эластичности', done: 2, of: 5 },
    ],
  },
  ticket: {
    title: 'Билет вслух',
    text: 'Вы отвечаете билет вслух. Meldy сверяет ответ с вашими лекциями. О пропущенном спросит экзаменатор. Оценку ставит преподаватель.',
  },
} as const;

/**
 * «Билет вслух» on the page, a short loop: the parts of the answer to ticket 7 (data/ticketExample.ts Q7, said in
 * plain words), what the student says (each of the first three lines names one part: 1, 2 and 4), the examiner's
 * question about the missed part and the answer to it.
 */
export const TICKET_TALK = {
  parts: [
    'Выручка = цена × количество',
    'Спрос эластичный, цену снизили, выручка выросла',
    'Спрос неэластичный, цену подняли, выручка выросла',
    'При единичной эластичности выручка та же',
  ],
  said: [
    'Выручка — это цена, умноженная на количество.',
    'Если спрос эластичный, снижение цены увеличивает выручку.',
    'При единичной эластичности выручка не меняется.',
  ],
  answer: 'Поднять цену. Покупают почти столько же, и выручка растёт.',
  result: 'Ответ полный. 3 части из 4 вы назвали сами, одну после вопроса.',
  speaking: 'Вы отвечаете',
  asking: 'Экзаменатор спрашивает',
  done: 'Ответ записан',
  examiner: 'Экзаменатор',
  you: 'Вы',
  pause: 'Остановить анимацию',
  play: 'Запустить анимацию',
} as const;

export const GROUP_SECTION = {
  title: 'Группа и Telegram',
  text: 'Отправьте группе одну ссылку. У каждого будет весь экзамен и свой прогресс. Бот в Telegram присылает план на день, и вопросы можно решать прямо в чате.',
} as const;

/**
 * «Игра в классе» (owner, 21.10: «не забудь сделать это» for the page and the reel): the live game «Встань на ответ»,
 * shown by the real recorded game (lib/footage STAND_RUN, home3/game). The question, its options and the PIN are the
 * recorded game's (its projector shows them), the test's title too; the bot's post is the stand game's group post
 * (supabase/functions/_shared/bot/live.ts livePost); the phone's words are the phone's own (live/stand/phone/words.ts).
 */
export const GAME_SECTION = {
  title: 'Игра в классе',
  text: 'Класс играет на проекторе. Ученики бегут к ответу с телефона. Кто не успел к верному ответу, проваливается. Играть можно на сайте и в Telegram.',
} as const;

export const GAME = {
  mode: 'Встань на ответ',
  question: 'Какая планета ближе всего к Солнцу?',
  options: ['Меркурий', 'Венера', 'Марс', 'Земля'],
  of: 'Вопрос 1 из 3',
  onAnswer: 'Вы на ответе',
  run: 'Бегите к ответу',
  right: 'Верно',
  points: '+980',
  close: 'Закрыть',
  chat: '9 «Б» класс',
  chatMeta: '31 участник',
  bot: 'Meldy',
  /** The bot's lines; a number keeps to its word and the PIN stays whole (\u00a0). */
  post: ['Игра по тесту «Повторение». 3\u00a0вопроса.', 'Заходите по PIN\u00a0123\u00a0456.', 'Играют 30'],
  play: 'Играть',
} as const;

/** The small studio's switch on a phone (MiniStudio): the participant's view, which a wider screen shows on the right. */
const TAKE_TAB = 'Как видит участник';

export const BUILDER_SECTION = {
  title: 'Конструктор тестов',
  text: 'Соберите свой тест из текста, картинок, видео и вопросов. Отправьте ссылку. Участникам не нужен аккаунт, а их ответы вы видите сразу.',
  tryTitle: 'Попробуйте прямо здесь',
  tryText: 'Добавьте блок, смените цвет и фон. Справа видно, каким тест увидит участник.',
  /** The same on a phone, where nothing is on the right: the participant's view is the switch's second half. */
  tryTextPhone: `Добавьте блок, смените цвет и фон. Нажмите «${TAKE_TAB}» и пройдите тест сами.`,
  takeTab: TAKE_TAB,
  sendTitle: 'Ссылка и QR-код',
  sendText: 'Участник открывает ссылку на телефоне и отвечает без аккаунта. Ответы приходят вам сразу.',
  /** Under the two pills: the same test as a game in class (the live game, release 47.12). */
  game: 'Ещё тест можно провести как игру в классе. Вопросы на проекторе, ученики отвечают с телефонов.',
  statsTitle: 'Результаты',
  statsText: 'Видно, кто пишет сейчас и кто уже сдал. Видны средний балл и самые трудные вопросы. Таблицу можно скачать.',
} as const;

/** Words inside the pictures of the app on the page (the page's own lines, so the rules above hold for them too). */
export const PICTURES = {
  lectureMeta: 'Микроэкономика, 82 минуты',
  exam: 'Микроэкономика',
  examDate: ['Экзамен 6 ноября', 'Экзамен 20 ноября'],
  examIn: ['через 18 дней', 'через 32 дня'],
  today: ['Сегодня 90 вопросов', 'Сегодня 60 вопросов'],
  todayTime: ['около 45 минут', 'около 30 минут'],
  moved: 'Экзамен перенесён на 20 ноября. Сегодня 60 вопросов.',
  question: 'Вопрос 7 из 20',
  inviteTitle: 'Пригласить группу',
  inviteText: 'По ссылке каждый получит весь экзамен. Прогресс у каждого свой.',
  copy: 'Скопировать',
  members: 'В экзамене 24 участника',
  bot: 'бот',
  botToday: 'Сегодня 90 вопросов, около 45 минут.',
  botExam: 'Экзамен 6 ноября, через 18 дней.',
  botStart: 'Начать занятие',
  botOpen: 'Открыть Meldy',
  linkLabel: 'Ссылка для участников',
  copyLink: ['Скопировать ссылку', 'Ссылка скопирована'],
  results: 'Результаты теста «Эластичность спроса»',
  resultsLine: 'Сдали 23, пишут сейчас 3. Средний балл 71 %.',
  hardest: 'Самый трудный вопрос',
  hardestQuestion: 'Неэластичный спрос и выручка',
  hardestRight: 'верно 38 %',
  writing: 'пишет',
  noAccount: 'без аккаунта',
} as const;

export const FINAL = {
  title: 'Откройте пример или пройдите готовый тест',
  text: 'В примере 3 лекции по микроэкономике и 12 вопросов к экзамену. Тест из 5 вопросов команда Meldy собрала в конструкторе.',
} as const;

export const FOOTER = 'Meldy помогает готовиться к экзамену и собирать тесты.';
/** lib/telemetry's note in the page's words (the same facts; the profile keeps its own line). */
export const FOOTER_NOTE = 'Meldy собирает статистику использования и отчёты об ошибках. Тексты лекций и ответы туда не попадают.';
