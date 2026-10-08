/**
 * The reel's time: the two scenes (the sheet and the end card), the seven chapters and the small math
 * every scene animates with. Everything on the stage is a pure function of one number, the reel time
 * in milliseconds, so the same moment always looks the same: on the page, in tests and in exported frames.
 */
import type { ReelChapter } from '../home/reelJump';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export type SceneId = 'paper' | 'end';

export interface SceneWindow {
  id: SceneId;
  /** First moment the scene is on the stage. */
  from: number;
  /** The scene is gone from this moment. */
  to: number;
  /** How long before `from` it is put on the stage, hidden (PREMOUNT unless set). */
  lead?: number;
}

/**
 * One sheet of paper for the whole film; the only cut is into the end card (CUT). The paper is never
 * remounted between the chapters: the camera moves along it.
 */
export const CUT = 45000;
export const TOTAL = 48000;

export const SCENES: readonly SceneWindow[] = [
  { id: 'paper', from: 0, to: CUT },
  { id: 'end', from: CUT, to: TOTAL },
];

/** A scene is put on the stage this early, hidden, so its first visible frame is ready. */
export const PREMOUNT = 400;

export function sceneWindow(id: SceneId): SceneWindow {
  const scene = SCENES.find((item) => item.id === id);
  if (!scene) throw new Error(`Unknown scene ${id}`);
  return scene;
}

/** The scenes that are on the stage at `t` (including the hidden premount lead), in stage order. */
export function activeScenes(t: number): SceneId[] {
  return SCENES.filter((scene) => t >= scene.from - (scene.lead ?? PREMOUNT) && t < scene.to).map((scene) => scene.id);
}

export interface Chapter {
  /** The reelJump id the landing asks for. */
  id: ReelChapter;
  number: string;
  label: string;
  /** The chapter starts here (its camera move begins, or its first beat). */
  from: number;
  /** «Go to the chapter» lands here: the camera has arrived and the chapter's first beat is readable. */
  at: number;
}

export const CHAPTERS: readonly Chapter[] = [
  { id: 'tickets', number: '01', label: 'Список кафедры', from: 0, at: 0 },
  { id: 'lectures', number: '02', label: 'Лекции', from: 6900, at: 8900 },
  { id: 'sheet', number: '03', label: 'Шпаргалка', from: 12000, at: 13900 },
  { id: 'oral', number: '04', label: 'Билет вслух', from: 18000, at: 19900 },
  { id: 'days', number: '05', label: 'Разные дни', from: 34000, at: 35900 },
  { id: 'group', number: '06', label: 'Группе', from: 40600, at: 43000 },
  { id: 'end', number: '07', label: 'Итог', from: CUT, at: CUT },
];

/** The chapter playing at `t` (the last one that has started). */
export function chapterAt(t: number): Chapter {
  let found = CHAPTERS[0];
  for (const chapter of CHAPTERS) if (t >= chapter.from) found = chapter;
  return found;
}

/** The poster: the moment shown when motion is reduced (the answer is given, its marks are on the sheet). */
export const POSTER_AT = 33600;

// ---------------------------------------------------------------------------------------------
// Math

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** 0 before `start`, 1 after `start + dur`, linear in between. */
export function seg(t: number, start: number, dur: number): number {
  if (dur <= 0) return t >= start ? 1 : 0;
  return clamp((t - start) / dur);
}

export const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** A CSS cubic-bezier as a function of progress (the same curve the browser draws). */
export function bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const slopeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let u = p;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(u) - p;
      if (Math.abs(error) < 1e-6) break;
      const slope = slopeX(u);
      if (Math.abs(slope) < 1e-6) break;
      u -= error / slope;
    }
    if (u < 0 || u > 1 || Math.abs(sampleX(u) - p) > 1e-4) {
      let lo = 0;
      let hi = 1;
      u = p;
      for (let i = 0; i < 30; i += 1) {
        if (sampleX(u) < p) lo = u;
        else hi = u;
        u = (lo + hi) / 2;
      }
    }
    return sampleY(u);
  };
}

export const ease = {
  linear: (p: number) => clamp(p),
  /** The brand curve: cubic-bezier(.16, 1, .3, 1), quick start and a long soft landing. */
  brand: bezier(0.16, 1, 0.3, 1),
  out: (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(p))),
  in: (p: number) => clamp(p) ** 3,
  inOut: (p: number) => {
    const x = clamp(p);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  },
  sine: (p: number) => -(Math.cos(Math.PI * clamp(p)) - 1) / 2,
  /** Overshoots a little and settles: for things that pop in (the authoring reels; the landing film uses none). */
  back: (p: number) => {
    const x = clamp(p);
    const c1 = 1.7;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
  /** A damped spring from 0 to 1 (overshoot about 12 %). */
  spring: (p: number) => {
    const x = clamp(p);
    if (x >= 1) return 1;
    return 1 - Math.exp(-6 * x) * Math.cos(10 * x);
  },
};

/** A smooth 0 → 1 → 0 hump over [start, start + dur]. */
export function pulse(t: number, start: number, dur: number): number {
  const p = seg(t, start, dur);
  return Math.sin(Math.PI * p);
}

/** Plural of a Russian noun after a number: forms for 1, 2–4 and 5+. */
export function plural(value: number, forms: readonly [string, string, string]): string {
  const n = Math.abs(value) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
