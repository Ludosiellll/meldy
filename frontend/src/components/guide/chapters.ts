/**
 * The guide's chapters: one per item of the menu, in the order of the menu, with «Разобрать лекцию»
 * after «Сегодня» (that is where a new student starts), «Тесты» after «Экзамены» (its door, «Новый тест», is
 * on «Экзамены»), and «Лимит ИИ» last: the meter in the top line that every AI action spends. Each has a short
 * clip (scenes/), a title and a line or two of text in the words the screens use. The mistakes diary is told
 * inside «Повторение» and the knowledge map inside «Прогресс»: that is where they live in the menu.
 *
 * A chapter can have more than one clip (`reels`, the owner, 18.10: «для новых функций тоже нужно сделать обучение с
 * видео»): «Экзамены» also shows «Перенести экзамен» and the bot's «Экзамены» in Telegram, «Тесты» the studio and the
 * test as the student gets it by its link. Each reel has its own title and text; the step clips are components/clips.
 */
import { formatLimitReset, nextLimitReset } from '../../api/limits';
import { AI_COSTS, FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../../lib/plans';
import { plural } from '../pro/planCopy';
import type { StepClipId } from '../clips/types';

export type GuideChapterId = 'today' | 'add' | 'library' | 'exams' | 'tests' | 'review' | 'progress' | 'limit';

/** One clip of a chapter: the chapter's own (`clip` null: scenes/) or a step clip (components/clips). */
export interface GuideReel {
  clip: StepClipId | null;
  /** Its button under the clip: short, one line with the others on a phone. */
  label: string;
  title: string;
  text: string;
}

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
  /** More than one clip: the first is the chapter's own (its title and text), the others come by their buttons. */
  reels?: readonly GuideReel[];
}

const EXAMS_TEXT =
  'Нажмите «Новый экзамен» и загрузите вопросы: один общий файл или по файлу на предмет. Ключ к вариантам Meldy возьмёт из файла. Устные вопросы отвечайте голосом или текстом в «Тянуть билет»: Meldy сверит ответ с вашими лекциями.';

/** «Тесты»: the studio (release 47.2) in the words of its screens. */
const TESTS_TEXT =
  'Кнопка «Новый тест» на странице «Экзамены» открывает студию: блоки на страницу, вопросы с верными ответами, цвет во вкладке «Оформление». Затем — «Отправить по ссылке».';

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
    // Concept 1 §3.10: the nearest exam of either kind leads «Сегодня» with today's plan.
    text: 'Главная страница. Ближайший экзамен и план на сегодня: сколько вопросов и минут, кнопка «Начать», у устного экзамена — «Тянуть билет». Пока экзамена нет, здесь первые шаги.',
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
    narrow: 'На телефоне — «Разобрать лекцию» в начале «Лекций».',
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
    // The test pages (the studio, the old builder, the quizzes) are «Тесты»: the guide opened there starts on that chapter.
    match: /^\/exams(?!\/c\/[^/]+\/(?:studio|build|quizzes)(?:\/|$))(?:\/|$)/,
    title: 'Экзамены',
    // Concept 1 §3.10 with the words of the design critique: one door («Новый экзамен»), questions with variants and oral ones.
    // Five lines at most: on the owner's 1532×734 laptop a seventh line pushed «Назад / Дальше» under the card's edge.
    text: EXAMS_TEXT,
    spot: 'link',
    reels: [
      { clip: null, label: 'Новый экзамен', title: 'Экзамены', text: EXAMS_TEXT },
      {
        clip: 'move',
        label: 'Перенести',
        title: 'Перенести экзамен',
        // MoveExamDialog: the exam's page has «Перенести экзамен» on its day and after it, «Сегодня» its short «Перенести».
        text: 'Экзамен перенесли? В его день и после на странице экзамена есть «Перенести экзамен», на «Сегодня» — «Перенести». Выберите дату, и план по дням пересчитается.',
      },
      {
        clip: 'botExams',
        label: 'В Telegram',
        title: 'Экзамены в Telegram',
        // The bot (supabase/functions/_shared/bot/exams.ts): «Экзамены» in /settings and on the day card, K3's move.
        text: 'В боте: /settings, затем «Экзамены» — отметьте, по каким экзаменам приходит план, можно несколько. Когда экзамен прошёл, бот предложит «Перенести на неделю» или другую дату.',
      },
    ],
  },
  {
    id: 'tests',
    tab: 'Тесты',
    // «Новый тест» is on «Экзамены»: that page is the chapter's own, and «Экзамены» lights up in the menu.
    route: '/exams',
    match: /^\/(?:tests\/new|exams\/c\/[^/]+\/(?:studio|build|quizzes))(?:\/|$)/,
    title: 'Тесты',
    text: TESTS_TEXT,
    spot: 'link',
    reels: [
      { clip: 'studio', label: 'Свой тест', title: 'Тесты', text: TESTS_TEXT },
      {
        clip: 'quizLink',
        label: 'Как это видит ученик',
        title: 'Тест по ссылке',
        // Release 47: a participant without an account (/k/<код>), the result after «Завершить», the author's table.
        text: 'Ученик открывает ссылку или QR-код, пишет имя и нажимает «Начать»: аккаунт не нужен. После «Завершить» он видит результат, а вы — его строку в таблице.',
      },
    ],
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
