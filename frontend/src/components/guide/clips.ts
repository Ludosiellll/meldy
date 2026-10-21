/** The guide's clips: one short loop per chapter on a 1440 × 1080 (4:3) stage. */
import type { ComponentType } from 'react';
import type { GuideChapterId } from './chapters';
import { GUIDE_SCENES } from './scenes';
import { STAND_RUN } from '../../lib/footage';

export const GUIDE_W = 1440;
export const GUIDE_H = 1080;

export interface GuideClipDef {
  /** Length of the loop (ms). */
  total: number;
  /** The still frame shown when motion is reduced. */
  poster: number;
  Scene: ComponentType;
}

/**
 * The chapters shown in real footage of the app (lib/footage.ts) instead of a drawn scene, in the same 4:3 box:
 * «Игра в классе» is the 3D game on the projector, the class running to the answers (the owner, 21.10: «тут должен
 * быть ролик прям когда игра идет … небольшой отрезок где бегают игроки»).
 */
export const GUIDE_FOOTAGE = { game: STAND_RUN } as const;
export type FootageChapter = keyof typeof GUIDE_FOOTAGE;

/** The chapters with a drawn clip of their own here; «Тесты» has only step clips (components/clips). */
export type OwnClipChapter = Exclude<GuideChapterId, 'tests' | FootageChapter>;

export const GUIDE_CLIPS: Record<OwnClipChapter, GuideClipDef> = GUIDE_SCENES;
