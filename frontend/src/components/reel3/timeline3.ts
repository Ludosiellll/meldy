/**
 * The landing v3 reel «Один вопрос»: one ticket question («Эластичность спроса и выручка продавца») goes through the
 * whole of Meldy, then the test constructor gets the longest part. Everything on the stage is a pure function of one
 * time in ms (the engine of components/reel: ReelClock, useFrame, put).
 *
 * Two stages: wide 1600 × 900 (16:9, from a 600 px frame up) and tall 400 × 500 (4:5, phones). The scenes draw the
 * same elements in both; CSS places them (reel3.css, [data-layout]) and the frame code moves them only relative to
 * their place, so one timeline serves both.
 */
import { CHAPTER_LABELS } from '../home3/copy3';

export type Layout = 'wide' | 'tall';
export const STAGE: Record<Layout, { w: number; h: number }> = {
  wide: { w: 1600, h: 900 },
  tall: { w: 400, h: 500 },
};
/** Below this frame width the tall stage is used. */
export const TALL_BELOW = 600;

export type SceneId3 =
  | 'lecture'
  | 'file'
  | 'plan'
  | 'session'
  | 'ticket'
  | 'sheet'
  | 'group'
  | 'build'
  | 'media'
  | 'look'
  | 'send'
  | 'take'
  | 'stats'
  | 'end';

export interface SceneWindow3 {
  id: SceneId3;
  from: number;
  to: number;
}

/** Scenes overlap by OVERLAP: the next one slides in while the last slides out. */
export const OVERLAP = 400;

export const SCENES3: readonly SceneWindow3[] = [
  { id: 'lecture', from: 0, to: 7000 },
  { id: 'file', from: 6600, to: 12600 },
  { id: 'plan', from: 12200, to: 19000 },
  { id: 'session', from: 18600, to: 25000 },
  { id: 'ticket', from: 24600, to: 32600 },
  { id: 'sheet', from: 32200, to: 37800 },
  { id: 'group', from: 37400, to: 44600 },
  { id: 'build', from: 44200, to: 51600 },
  { id: 'media', from: 51200, to: 56600 },
  { id: 'look', from: 56200, to: 60600 },
  { id: 'send', from: 60200, to: 64200 },
  { id: 'take', from: 63800, to: 68200 },
  { id: 'stats', from: 67800, to: 72600 },
  { id: 'end', from: 72200, to: 76000 },
];

export const TOTAL3 = 76000;

/** A scene is mounted this long before it shows (hidden), during the calm end of the scene before it. */
export const PREMOUNT3 = 900;

export function scene3(id: SceneId3): SceneWindow3 {
  const found = SCENES3.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown scene ${id}`);
  return found;
}

/** The scenes on the stage at `t`, the premounted next one included. */
export function activeScenes3(t: number): SceneId3[] {
  return SCENES3.filter((item) => t >= item.from - PREMOUNT3 && t < item.to).map((item) => item.id);
}

export type ChapterId3 = keyof typeof CHAPTER_LABELS;

export interface Chapter3 {
  id: ChapterId3;
  label: string;
  from: number;
  to: number;
}

/** The bar under the reel: eight chapters; the constructor runs from «Новый тест» to the end card. */
export const CHAPTERS3: readonly Chapter3[] = [
  { id: 'lecture', label: CHAPTER_LABELS.lecture, from: 0, to: scene3('file').from },
  { id: 'file', label: CHAPTER_LABELS.file, from: scene3('file').from, to: scene3('plan').from },
  { id: 'plan', label: CHAPTER_LABELS.plan, from: scene3('plan').from, to: scene3('session').from },
  { id: 'session', label: CHAPTER_LABELS.session, from: scene3('session').from, to: scene3('ticket').from },
  { id: 'ticket', label: CHAPTER_LABELS.ticket, from: scene3('ticket').from, to: scene3('sheet').from },
  { id: 'sheet', label: CHAPTER_LABELS.sheet, from: scene3('sheet').from, to: scene3('group').from },
  { id: 'group', label: CHAPTER_LABELS.group, from: scene3('group').from, to: scene3('build').from },
  { id: 'builder', label: CHAPTER_LABELS.builder, from: scene3('build').from, to: TOTAL3 },
];

export function chapterAt3(t: number): number {
  const index = CHAPTERS3.findIndex((chapter) => t >= chapter.from && t < chapter.to);
  return index < 0 ? CHAPTERS3.length - 1 : index;
}

/**
 * The still shown before the first play and when motion is reduced: the studio, a question block just dropped on the
 * page. A moment with no picture on the stage, so the reel's still never outgrows the headline as the largest paint
 * (phone check: the look scene's page background became the LCP at 2.35 s).
 */
export const POSTER3 = 50500;
