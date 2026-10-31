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

/** Where the last card of a goal's way takes the app: the exam's to «Сегодня», the teacher's to the quick test. */
export const GOAL_END: Record<Goal, string> = { exam: '/dashboard', test: '/tests/quick' };
