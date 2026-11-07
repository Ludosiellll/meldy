/**
 * The first run's way by goal (UX audit of 21.10, P4; mockup m5): the guide opens with «Что вы хотите сделать?» and
 * then shows only that goal's cards — five for an exam («Сегодня», «Экзамены», «Повторение», «Игры», «Лимит ИИ»), four
 * for a teacher («Быстрая контрольная», how a student writes, the results, «Игры»). «Показать все разделы» is the whole guide, as «?»
 * opens it. A stop is a chapter, with the words, the clip and the page of its own when the chapter's are not the ones.
 */
import { GUIDE_START } from '../quick/copyQuick';
import type { Goal } from '../quick/goal';
import type { StepClipId } from '../clips/types';
import { GAME_STUDENT, type GuideChapterId } from './chapters';

export interface GuideStop {
  chapter: GuideChapterId;
  title?: string;
  text?: string;
  /** A step clip of its own; null — no clip (the card is words only). Absent — the chapter's own. */
  clip?: StepClipId | null;
  /** The page the stop takes the app to, when it is not the chapter's. */
  route?: string;
}

export const GOAL_STOPS: Record<Goal, readonly GuideStop[]> = {
  // «Игры» (owner, 31.10: «есть ли обучение о том что эти мини-игры есть»): the real game on the projector, its section in
  // the top line; for a student how to join, for a teacher how to start one.
  exam: [{ chapter: 'today' }, { chapter: 'exams' }, { chapter: 'review' }, { chapter: 'game', ...GAME_STUDENT }, { chapter: 'limit' }],
  test: [
    { chapter: 'tests', ...GUIDE_START.test[0], clip: 'quick', route: '/exams?view=tests' },
    { chapter: 'tests', ...GUIDE_START.test[1], clip: 'quizStudent', route: '/exams?view=tests' },
    { chapter: 'tests', ...GUIDE_START.test[2], clip: null, route: '/exams?view=tests' },
    { chapter: 'game' },
  ],
};

/**
 * The guide after the first «занятие» of a group student (UX audit of 06.11, finding #3): an account that is only a
 * member of someone else's exams gets the exam's own way — today's plan and «Начать», «План по дням» and «Осталось
 * выучить», the plan in Telegram — and one card that its own lectures can be made too (the owner, 07.11: «я надеюсь
 * студент сможет лекцию сам делать»). Not «Новый экзамен», «Тесты» or «Игры»: «?» still opens the whole guide. Cards of
 * words only, in the screens' own words; the clips show an author's screens.
 */
export const MEMBER_STOPS: readonly GuideStop[] = [
  {
    chapter: 'today',
    title: 'План на сегодня',
    text: 'На странице экзамена и на «Сегодня» — план на день: сколько вопросов и минут. Нажмите «Начать», и Meldy даст вопросы на сегодня.',
    clip: null,
  },
  {
    chapter: 'exams',
    title: 'План по дням',
    text: '«План по дням» на странице экзамена — сколько вопросов в какой день до экзамена. У предмета «Осталось выучить» показывает темы, которые ещё не выучены.',
    clip: null,
  },
  {
    chapter: 'exams',
    title: 'План в Telegram',
    text: 'Бот Meldy раз в день пришлёт план на сегодня, а вопросы экзамена можно решать прямо в чате. Подключить его можно в «Профиле»: «Подключить Telegram».',
    clip: null,
  },
  {
    chapter: 'add',
    title: 'Свои лекции',
    text: 'Свою лекцию тоже можно разобрать: кнопка «Разобрать лекцию». Meldy сделает конспект, карточки и самопроверку.',
    clip: null,
  },
];

/** Where the last card of a goal's way takes the app: the exam's to «Сегодня», the teacher's to the quick test. */
export const GOAL_END: Record<Goal, string> = { exam: '/dashboard', test: '/tests/quick' };
