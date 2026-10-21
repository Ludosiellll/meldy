/**
 * Every how-to clip by its id (types.ts): the scene, its steps with their lines, the loop's length. This file pulls in
 * the scenes and the reel engine: it is loaded lazily (clipPart.ts, the guide's own clip part).
 */
import type { StepClipDef, StepClipId } from './types';
import { MOVE_STEPS, MOVE_TOTAL, MoveScene } from './scenes/move';
import { STUDIO_STEPS, STUDIO_TOTAL, StudioScene } from './scenes/studio';
import { QUIZ_STEPS, QUIZ_TOTAL, QuizLinkScene } from './scenes/quizLink';
import { BOT_STEPS, BOT_TOTAL, BotExamsScene } from './scenes/botExams';
import { QUICK_STEPS, QUICK_TOTAL, QuickScene } from './scenes/quick';
import { STUDIO_TOUR_STEPS, STUDIO_TOUR_TOTAL, StudioTourScene } from './scenes/studioTour';
import { QUIZ_STUDENT_STEPS, QUIZ_STUDENT_TOTAL, QuizStudentScene } from './scenes/quizStudent';
import './scenes/scenes.css';

export const STEP_CLIPS: Record<StepClipId, StepClipDef> = {
  studio: { id: 'studio', total: STUDIO_TOTAL, steps: STUDIO_STEPS, Scene: StudioScene },
  quizLink: { id: 'quizLink', total: QUIZ_TOTAL, steps: QUIZ_STEPS, Scene: QuizLinkScene },
  move: { id: 'move', total: MOVE_TOTAL, steps: MOVE_STEPS, Scene: MoveScene },
  botExams: { id: 'botExams', total: BOT_TOTAL, steps: BOT_STEPS, Scene: BotExamsScene },
  // «Быстрая контрольная» (UX audit of 21.10): the teacher's first card of the first run.
  quick: { id: 'quick', total: QUICK_TOTAL, steps: QUICK_STEPS, Scene: QuickScene },
  // The studio's tour: «Свой тест» from the studio on (its first step, «Новый тест», is behind the author already).
  studioTour: { id: 'studioTour', total: STUDIO_TOUR_TOTAL, steps: STUDIO_TOUR_STEPS, Scene: StudioTourScene },
  // «Как ученик пишет» of the teacher's first run: «Как это видит ученик» from the student's phone on.
  quizStudent: { id: 'quizStudent', total: QUIZ_STUDENT_TOTAL, steps: QUIZ_STUDENT_STEPS, Scene: QuizStudentScene },
};
