import type { ComponentType } from 'react';

/**
 * The how-to clips of the features of release 47 (the owner, 18.10: «для новых функций тоже нужно сделать обучение с
 * видео»): Meldy's own screens on a 1440 × 900 stage, step by step, each step with a short line under the picture.
 * The guide plays them in its chapters, the studio's tour and the move dialog as first-use tips.
 */
export type StepClipId = 'studio' | 'quizLink' | 'move' | 'botExams';

export interface ClipStep {
  /** Scene time (ms) the step begins: its line comes under the picture. */
  at: number;
  /** The line under the picture: plain Russian, the screen's own words in «ёлочках». */
  caption: string;
  /** The still frame of the step (ms), shown when motion is reduced: everything of the step on screen. */
  still: number;
}

export interface StepClipDef {
  id: StepClipId;
  /** Length of the loop (ms). */
  total: number;
  steps: readonly ClipStep[];
  Scene: ComponentType;
}

/** Every clip's stage (16:10): the scenes are drawn in these pixels and scaled to the frame. */
export const STEP_W = 1440;
export const STEP_H = 900;
