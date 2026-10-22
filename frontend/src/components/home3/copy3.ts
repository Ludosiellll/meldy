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

/**
 * The tiles under the first screen (owner, 22.10: the layout «D — Плитки»). Each tile is a short heading and at most one
 * line; a video next to it shows the real screen, and the words say what it shows.
 */
export const TILES = {
  /** The first screen's blue tile: a ticket answered aloud on a phone. */
  oral: 'Ответ вслух, как на экзамене',
  lecture: {
    title: 'Лекция → конспект, карточки, самопроверка',
    text: 'У каждого раздела видно, откуда он взят в лекции.',
  },
  exam: {
    title: 'Вопросы кафедры → план по дням',
    text: 'Ответы Meldy находит в самом файле.',
  },
  /**
   * Two facts, each true as said: a new test is open to guests by default (quizzes.guests, the author may ask for an
   * account), and the bot sends the day's plan at the time the student picked (supabase/functions/_shared/bot/tick.ts).
   */
  link: 'Тест по ссылке, без аккаунта',
  telegram: 'План на день приходит в Telegram',
} as const;

/**
 * The game's tile (owner, 21.10: «не забудь сделать это»; 22.10: «игру оставить как есть»): the live game «Встань на
 * ответ», shown by the real recorded game (lib/footage STAND_RUN and the phone's STAND_RUN_PHONE). The words are the
 * tile's in the layout «D — Плитки». GAME below are the recorded game's own words (its projector shows them), and the
 * reel's.
 */
export const GAME_SECTION = {
  title: 'Игра на паре',
  text: 'Класс бегает к ответам на проекторе с телефонов.',
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

/** Words inside the constructor's pictures (the page's own lines, so the rules above hold for them too). */
export const PICTURES = {
  linkLabel: 'Ссылка для участников',
  copyLink: ['Скопировать ссылку', 'Ссылка скопирована'],
  results: 'Результаты теста «Эластичность спроса»',
  resultsLine: 'Сдали 23, пишут сейчас 3. Средний балл 71 %.',
  hardest: 'Самый трудный вопрос',
  hardestQuestion: 'Неэластичный спрос и выручка',
  hardestRight: 'верно 38 %',
  writing: 'пишет',
  noAccount: 'без аккаунта',
} as const;

/** The end of the page: the prototype's «Попробуйте на примере — без регистрации», said without the dash (rules above). */
export const FINAL = {
  title: 'Попробуйте на примере, без регистрации',
} as const;

export const FOOTER = 'Meldy помогает готовиться к экзамену и собирать тесты.';
/** lib/telemetry's note in the page's words (the same facts; the profile keeps its own line). */
export const FOOTER_NOTE = 'Meldy собирает статистику использования и отчёты об ошибках. Тексты лекций и ответы туда не попадают.';
