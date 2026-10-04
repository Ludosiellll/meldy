/**
 * The guide's chapters: one per section of Meldy, in the order a new student meets them. Each has
 * a short clip (scenes/), a title and a line or two of text in the words the screens use.
 */

export type GuideChapterId = 'today' | 'add' | 'library' | 'review' | 'exams' | 'mistakes' | 'map' | 'progress';

export interface GuideChapter {
  id: GuideChapterId;
  /** The section's name as the menu writes it. */
  tab: string;
  /** The section's own page: «Дальше» brings the app here when nothing is in progress. */
  route: string;
  /** The pages of the section: opened there, the guide starts on this chapter. */
  match: RegExp;
  title: string;
  text: string;
  /** Where the section is on a phone, when it is not one of the four bottom tabs. */
  phone?: string;
  /** What lights up in the top line: the link to the route, or the «Добавить лекцию» button. */
  spot: 'link' | 'cta';
}

export const GUIDE_CHAPTERS: readonly GuideChapter[] = [
  {
    id: 'today',
    tab: 'Сегодня',
    route: '/dashboard',
    match: /^\/dashboard\/?$/,
    title: 'Сегодня',
    text: 'Главная страница: ближайший экзамен с кнопкой «Тянуть билет», карточки на сегодня — «Начать повторение», ниже ваши лекции.',
    spot: 'link',
  },
  {
    id: 'add',
    tab: 'Добавить лекцию',
    route: '/analyze',
    match: /^\/analyze\/?$/,
    title: 'Добавить лекцию',
    text: 'Файл, текст, ссылка или запись пары. Отметьте, что подготовить — конспект, карточки, тест, шпаргалку или разговор, — и нажмите «Запустить анализ».',
    phone: 'На телефоне — в меню под кружком профиля.',
    spot: 'cta',
  },
  {
    id: 'library',
    tab: 'Библиотека',
    route: '/library',
    match: /^\/library(\/|$)/,
    title: 'Библиотека',
    text: 'Все ваши лекции. В лекции — конспект со ссылками «фрагмент 3» на исходный текст, карточки и тест, а во вкладке «Разговор» лекцию обсуждают Макс и Софья.',
    spot: 'link',
  },
  {
    id: 'review',
    tab: 'Повторение',
    route: '/review',
    match: /^\/review\/?$/,
    title: 'Повторение',
    text: 'Вспомните ответ, переверните карточку и оцените себя: «Не помню», «С трудом» или «Помню». Карточка вернётся, когда её пора вспомнить: завтра, через 6 дней, через 2 недели.',
    spot: 'link',
  },
  {
    id: 'exams',
    tab: 'Экзамены',
    route: '/exams',
    match: /^\/exams(\/|$)/,
    title: 'Экзамены',
    text: 'Вставьте список вопросов — Meldy отметит, какие есть в ваших лекциях. Потом «Тянуть билет» и отвечать голосом или текстом: экзаменатор задаст дополнительный вопрос.',
    spot: 'link',
  },
  {
    id: 'mistakes',
    tab: 'Дневник ошибок',
    route: '/mistakes',
    match: /^\/mistakes\/?$/,
    title: 'Дневник ошибок',
    text: 'Сюда попадают ошибки из тестов и ответов на билеты. Правильный ответ открывается по нажатию, разобранную ошибку отметьте как исправленную.',
    phone: 'На телефоне — в меню под кружком профиля.',
    spot: 'link',
  },
  {
    id: 'map',
    tab: 'Карта знаний',
    route: '/knowledge-map',
    match: /^\/knowledge-map\/?$/,
    title: 'Карта знаний',
    text: 'Лекции экзамена по порядку, а между ними — понятия, которые встречаются в нескольких лекциях. Нажмите на понятие или лекцию, чтобы увидеть, где оно и какие вопросы с ним связаны.',
    phone: 'На телефоне — в меню под кружком профиля.',
    spot: 'link',
  },
  {
    id: 'progress',
    tab: 'Прогресс',
    route: '/analytics',
    match: /^\/analytics\/?$/,
    title: 'Прогресс',
    text: 'Сколько карточек закреплено, сколько вы вспомнили и сколько повторений ждёт на неделе. В «Что подтянуть» у каждой строки одна кнопка.',
    phone: 'На телефоне — в меню под кружком профиля.',
    spot: 'link',
  },
];

/** The chapter of the page at `pathname`, or -1 when the page belongs to none. */
export function chapterIndexFor(pathname: string): number {
  return GUIDE_CHAPTERS.findIndex((chapter) => chapter.match.test(pathname));
}

/** The sections' own pages, where nothing is typed or uploading. */
const SECTION_PAGES = new Set(GUIDE_CHAPTERS.map((chapter) => chapter.route));

/**
 * Whether «Дальше» may take the app to the next section: only from a section's own page that the
 * student has not touched since it opened. The upload page is left only when the guide brought the
 * student there (leaving it stops an upload in progress).
 */
export function mayLeave(pathname: string, broughtByGuide: string | null, touched: boolean): boolean {
  if (touched || !SECTION_PAGES.has(pathname)) return false;
  if (pathname === '/analyze') return broughtByGuide === '/analyze';
  return true;
}
