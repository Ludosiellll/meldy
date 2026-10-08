/**
 * The guide's chapters: one per item of the menu, in the order of the menu, with «Разобрать лекцию»
 * after «Сегодня» (that is where a new student starts), and «Лимит ИИ» last: the meter in the top line
 * that every AI action spends. Each has a short clip (scenes/), a title and a line or two of text in
 * the words the screens use. The mistakes diary is told inside «Повторение» and the knowledge map inside
 * «Прогресс»: that is where they live in the menu.
 */
import { formatLimitReset, nextLimitReset } from '../../api/limits';
import { AI_COSTS, FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../../lib/plans';
import { plural } from '../pro/planCopy';

export type GuideChapterId = 'today' | 'add' | 'library' | 'exams' | 'review' | 'progress' | 'limit';

export interface GuideChapter {
  id: GuideChapterId;
  /** The section's name as the menu writes it. */
  tab: string;
  /**
   * The section's own page: «Дальше» brings the app here when nothing is in progress. None for the
   * limit: its meter is in the top line of every page, so the app stays where it is.
   */
  route?: string;
  /** The pages of the section: opened there, the guide starts on this chapter. */
  match?: RegExp;
  title: string;
  text: string;
  /** Where the section is below 1024 px (tablets and phones), when that is not obvious from the tabs. */
  phone?: string;
  /**
   * The same on a phone (up to 639 px), when it differs: a phone's top line holds only the wordmark, the limit and the
   * avatar (10_Project/Phone_Declutter_2026-10-08).
   */
  narrow?: string;
  /**
   * What lights up: the section's item in the menu, the «Разобрать лекцию» button (on a phone, whose line has no such
   * button, the «Лекции» tab), or the limit meter.
   */
  spot: 'link' | 'cta' | 'meter';
}

const units = (n: number) => `${n} ${plural(n, ['единица', 'единицы', 'единиц'])}`;

/**
 * «Лимит ИИ» in the words of the screens, every number from lib/plans.ts and the reset time in the
 * student's own clock (00:00 UTC is 3:00 in Moscow).
 */
export function limitChapterText(resetAt: string = formatLimitReset(nextLimitReset())): string {
  return (
    `Действия с ИИ тратят единицы дневного лимита: анализ лекции — ${AI_COSTS.lecture}, ` +
    `проверка ответа — ${AI_COSTS.answer}, подкаст — ${AI_COSTS.conversation}. ` +
    `В день — ${units(FREE_DAILY_UNITS)}, с PRO — ${PRO_DAILY_UNITS}; лимит обновляется ночью, в ${resetAt}, ` +
    'а остаток виден вверху справа.'
  );
}

export const GUIDE_CHAPTERS: readonly GuideChapter[] = [
  {
    id: 'today',
    tab: 'Сегодня',
    route: '/dashboard',
    match: /^\/dashboard\/?$/,
    title: 'Сегодня',
    text: 'Главная страница. Сначала здесь три первых шага: лекция, список вопросов, билет. Потом — ближайший экзамен с кнопкой «Тянуть билет» и карточки на сегодня.',
    spot: 'link',
  },
  {
    id: 'add',
    tab: 'Разобрать лекцию',
    route: '/analyze',
    match: /^\/analyze\/?$/,
    title: 'Разобрать лекцию',
    text: 'Файл, текст, ссылка или запись части пары. Meldy сделает конспект, карточки и тест; выжимку и подкаст добавьте через «Изменить». Затем нажмите «Запустить анализ».',
    phone: 'На телефоне — кнопка «+» вверху экрана.',
    narrow: 'На телефоне — «+ Лекция» в «Лекциях» и на «Сегодня».',
    spot: 'cta',
  },
  {
    id: 'library',
    tab: 'Лекции',
    route: '/library',
    match: /^\/library(\/|$)/,
    title: 'Лекции',
    text: 'Все ваши лекции. В лекции — конспект со ссылками «фрагмент 3» на исходный текст, карточки и тест, а во вкладке «Подкаст» лекцию обсуждают Макс и Софья. «Поговорить о лекции» — Meldy спросит вас по карточкам.',
    spot: 'link',
  },
  {
    id: 'exams',
    tab: 'Экзамены',
    route: '/exams',
    match: /^\/exams(\/|$)/,
    title: 'Экзамены',
    text: 'Вставьте список вопросов — Meldy сверит его с лекциями: есть, частично или нет. «Тянуть билет» — отвечайте голосом или текстом, экзаменатор задаст дополнительный вопрос. На «Шпаргалке» — пункты ответа из ваших лекций; строки стирают только ваши ответы.',
    spot: 'link',
  },
  {
    id: 'review',
    tab: 'Повторение',
    route: '/review',
    match: /^\/(review|mistakes)\/?$/,
    title: 'Повторение',
    text: 'Вспомните ответ, переверните карточку и оцените себя: «Не помню», «С трудом» или «Помню» — карточка вернётся, когда её пора вспомнить. Здесь же дневник ошибок из тестов и ответов на билеты.',
    spot: 'link',
  },
  {
    id: 'progress',
    tab: 'Прогресс',
    route: '/analytics',
    match: /^\/(analytics|knowledge-map)\/?$/,
    title: 'Прогресс',
    text: 'Сколько карточек закреплено, сколько вы вспомнили и что подтянуть. Отсюда открывается карта знаний: лекции экзамена и понятия, которые их связывают.',
    spot: 'link',
  },
  {
    id: 'limit',
    tab: 'Лимит ИИ',
    title: 'Лимит ИИ',
    text: limitChapterText(),
    phone: 'На телефоне — кружок с числом.',
    spot: 'meter',
  },
];

/** The chapter of the page at `pathname`, or -1 when the page belongs to none. */
export function chapterIndexFor(pathname: string): number {
  return GUIDE_CHAPTERS.findIndex((chapter) => chapter.match?.test(pathname) ?? false);
}

/** The sections' own pages, where nothing is typed or uploading. */
const SECTION_PAGES = new Set(GUIDE_CHAPTERS.flatMap((chapter) => (chapter.route ? [chapter.route] : [])));

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
