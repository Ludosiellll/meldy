/** The guide's clips: one short loop per chapter on a 1440 × 1080 (4:3) stage. */
import type { ComponentType } from 'react';
import type { GuideChapterId } from './chapters';
import { GUIDE_SCENES } from './scenes';

export const GUIDE_W = 1440;
export const GUIDE_H = 1080;

export interface GuideClipDef {
  /** Length of the loop (ms). */
  total: number;
  /** The still frame shown when motion is reduced. */
  poster: number;
  Scene: ComponentType;
}

export const GUIDE_CLIPS: Record<GuideChapterId, GuideClipDef> = GUIDE_SCENES;
