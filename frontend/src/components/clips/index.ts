/**
 * Every how-to clip by its id (types.ts): the scene, its steps with their lines, the loop's length. This file pulls in
 * the scenes and the reel engine: it is loaded lazily (clipPart.ts, the guide's own clip part).
 */
import type { StepClipDef, StepClipId } from './types';
import { MOVE_STEPS, MOVE_TOTAL, MoveScene } from './scenes/move';
import { STUDIO_STEPS, STUDIO_TOTAL, StudioScene } from './scenes/studio';
import { QUIZ_STEPS, QUIZ_TOTAL, QuizLinkScene } from './scenes/quizLink';
import { BOT_STEPS, BOT_TOTAL, BotExamsScene } from './scenes/botExams';
import './scenes/scenes.css';

export const STEP_CLIPS: Record<StepClipId, StepClipDef> = {
  studio: { id: 'studio', total: STUDIO_TOTAL, steps: STUDIO_STEPS, Scene: StudioScene },
  quizLink: { id: 'quizLink', total: QUIZ_TOTAL, steps: QUIZ_STEPS, Scene: QuizLinkScene },
  move: { id: 'move', total: MOVE_TOTAL, steps: MOVE_STEPS, Scene: MoveScene },
  botExams: { id: 'botExams', total: BOT_TOTAL, steps: BOT_STEPS, Scene: BotExamsScene },
};
