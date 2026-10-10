/**
 * Chapter 04's cheat sheet as pure functions of scene time: which lines are left, named once or erased, and the day
 * the chapter shows. The look (HintsSheet.tsx) only reads this model, so another design of the sheet can replace it
 * without touching the story. The rule is the app's: a line fades when its point is named, and goes when the point is
 * named again on another day (an answer counts only when it is right on two different days).
 */
import type { LocalDay } from '../../../../types/container';
import { addDays } from '../../../../lib/containers/time';
import { weekdayText } from '../../../../lib/containers/words';
import { ORAL, SUBJECTS } from '../../content';
import { clamp, ease, rng, seg } from '../../timeline';

export type LineState = 'left' | 'half' | 'gone';

export interface SheetLine {
  text: string;
  /** A main point (a dot) or a detail (a dash). */
  main: boolean;
}

export interface SheetQuestion {
  number: number;
  title: string;
  lines: readonly SheetLine[];
}

// ---------------------------------------------------------------------------------------------
// The chapter's time (scene ms)

/** The oral answer: the words come as they are said, the points light up as they are named. */
export const SPEAK_AT = 850;
export const WORD_MS = 58;
/** The cut from the answer to the sheet. */
export const SHEET_AT = 3250;
/** The answer's day: the named lines get a stroke and fade to «named once». */
export const FIRST_AT = 3700;
/** Another day: the date turns, the same points are named again, the lines go. */
export const SECOND_DAY_AT = 4900;
export const SECOND_AT = 5250;
/** The days to the exam run by and the map empties. */
export const LAPSE_AT = 6050;
export const LAPSE_MS = 1100;
/** A stroke is drawn over a line, then the line settles in its new state. */
export const STROKE_MS = 380;
export const SETTLE_MS = 420;
export const MOVE_MS = STROKE_MS + SETTLE_MS;

/** When each word of the answer is said. */
export const wordAt = (index: number) => SPEAK_AT + index * WORD_MS;
/** When each point of the answer is named (null: not named). */
export const NAMED_AT: ReadonlyArray<number | null> = ORAL.points.map((point) => (point.namedAfter === null ? null : wordAt(point.namedAfter) + 220));

// ---------------------------------------------------------------------------------------------
// The days

/** The answer's day; «another day» is two days later; the run of days ends the day before the exam. */
export const DAY_FIRST: LocalDay = '2026-10-13';
const SECOND_DAY = 2;
const LAST_DAY = 16;

/** The day the sheet shows at `l`, in days after DAY_FIRST (fractional while the days run by). */
export function dayNumber(l: number): number {
  if (l < SECOND_DAY_AT) return 0;
  return SECOND_DAY + (LAST_DAY - SECOND_DAY) * ease.inOut(seg(l, LAPSE_AT, LAPSE_MS));
}

/** «Вт, 13 октября» — the day at `l`. */
export function dayLabel(l: number): string {
  return weekdayText(addDays(DAY_FIRST, Math.floor(dayNumber(l) + 1e-6)));
}

// ---------------------------------------------------------------------------------------------
// The sheet: the questions in view, and every line of the subject (the map's squares)

/** Questions 11–13 of «Философия»; 12 is the one answered aloud (its points are the oral chapter's). */
export const LIST: readonly SheetQuestion[] = [
  {
    number: 11,
    title: 'Этика Аристотеля: учение о добродетели.',
    lines: [
      { text: 'добродетель — середина между двумя крайностями', main: true },
      { text: 'счастье — деятельность души согласно добродетели', main: true },
      { text: 'этические и дианоэтические добродетели', main: false },
    ],
  },
  {
    number: ORAL.number,
    title: ORAL.question,
    lines: ORAL.points.map((point) => ({ text: point.text, main: point.main })),
  },
  {
    number: 13,
    title: 'Утилитаризм Бентама и Милля.',
    lines: [
      { text: 'благо — наибольшее счастье наибольшего числа людей', main: true },
      { text: 'поступок оценивают по его последствиям', main: true },
      { text: 'Милль различает удовольствия по качеству', main: false },
    ],
  },
];

/**
 * A line's story: its state when the chapter opens, the day it is named once and the day it is named again (days
 * after DAY_FIRST; null: not within the chapter). The named lines of question 12 move with the answer instead.
 */
export interface LineStory {
  from: LineState;
  halfDay: number | null;
  goneDay: number | null;
  answered?: boolean;
}

export interface MapLine {
  question: number;
  /** The line's place in its question. */
  line: number;
  story: LineStory;
}

/** The list's own lines: 11 and 13 part-way already, 12 untouched until it is answered. */
const LISTED: Record<number, LineStory[]> = {
  11: [
    { from: 'gone', halfDay: null, goneDay: null },
    { from: 'half', halfDay: null, goneDay: 6.5 },
    { from: 'left', halfDay: 5.5, goneDay: 10.5 },
  ],
  [ORAL.number]: ORAL.points.map((point): LineStory =>
    point.namedAfter !== null ? { from: 'left', halfDay: null, goneDay: null, answered: true } : { from: 'left', halfDay: 9.5, goneDay: 12.5 },
  ),
  13: [
    { from: 'left', halfDay: 4.5, goneDay: 8.5 },
    { from: 'half', halfDay: null, goneDay: 3.5 },
    { from: 'left', halfDay: 7.5, goneDay: 11.5 },
  ],
};

const ORAL_QUESTIONS = SUBJECTS[3].oral;

/**
 * Every line of the oral subject's sheet, in question order: made from a seed, the same on every frame. The plan
 * brought the first questions first, so they are further along, and the days empty the sheet from its top: the map
 * clears like a wave.
 */
export const MAP: readonly MapLine[] = (() => {
  const random = rng(4242);
  const out: MapLine[] = [];
  for (let q = 0; q < ORAL_QUESTIONS; q += 1) {
    const number = q + 1;
    const listed = LISTED[number];
    const count = listed ? listed.length : 3 + Math.floor(random() * 2.4);
    const ahead = 1 - q / ORAL_QUESTIONS;
    for (let line = 0; line < count; line += 1) {
      if (listed) {
        out.push({ question: number, line, story: listed[line] });
        continue;
      }
      const r = random();
      const gone = 0.5 * ahead * ahead;
      const from: LineState = r < gone ? 'gone' : r < gone + 0.3 * ahead ? 'half' : 'left';
      let halfDay: number | null = null;
      let goneDay: number | null = null;
      // A line still left is named on a day that comes later the further down the sheet it is (one in ten not yet).
      if (from === 'left' && random() < 0.9) halfDay = 1.1 + 15 * (1 - ahead) ** 0.85 * (0.55 + 0.45 * random());
      if (from === 'half') goneDay = 2.3 + 6 * (1 - ahead) * (0.4 + 0.6 * random());
      if (halfDay !== null) {
        // Named again on another day, at least a day later.
        const day = halfDay + 1.8 + 4.5 * random();
        goneDay = day < LAST_DAY - 0.1 ? day : null;
      }
      out.push({ question: number, line, story: { from, halfDay, goneDay } });
    }
  }
  return out;
})();

export const TOTAL_LINES = MAP.length;

const FIRST = new Map<number, number>();
MAP.forEach((entry, index) => {
  if (!FIRST.has(entry.question)) FIRST.set(entry.question, index);
});

/** Where a question's first line is in MAP. */
export function firstIndex(number: number): number {
  return FIRST.get(number) ?? -1;
}

export interface LineFrame {
  state: LineState;
  /** The move under way: a stroke drawn over the line, then the line settles (p 0 → 1). */
  move: 'half' | 'gone' | null;
  p: number;
}

/** The moments question 12's named lines move: the answer, then the answer on another day. */
export function answeredMoves(line: number): { half: number; gone: number } {
  return { half: FIRST_AT + line * 180, gone: SECOND_AT + line * 160 };
}

/** One line at scene time `l` (`line`: its place in its question, for question 12's named lines). */
export function lineAt(story: LineStory, l: number, line = 0): LineFrame {
  if (story.answered) {
    const { half, gone } = answeredMoves(line);
    if (l >= gone) return { state: 'gone', move: l < gone + MOVE_MS ? 'gone' : null, p: clamp((l - gone) / MOVE_MS) };
    if (l >= half) return { state: 'half', move: l < half + MOVE_MS ? 'half' : null, p: clamp((l - half) / MOVE_MS) };
    return { state: 'left', move: null, p: 1 };
  }
  if (story.from === 'gone') return { state: 'gone', move: null, p: 1 };
  const day = dayNumber(l);
  // While the days run by a move takes a third of a day.
  const quick = (at: number) => clamp((day - at) / 0.35);
  if (story.goneDay !== null && day >= story.goneDay) {
    const p = quick(story.goneDay);
    return { state: 'gone', move: p < 1 ? 'gone' : null, p };
  }
  if (story.from === 'half') return { state: 'half', move: null, p: 1 };
  if (story.halfDay !== null && day >= story.halfDay) {
    const p = quick(story.halfDay);
    return { state: 'half', move: p < 1 ? 'half' : null, p };
  }
  return { state: 'left', move: null, p: 1 };
}

/** The last moments asked for: a frame reads the map several times (the list, the count, the canvas). */
const recent: Array<{ l: number; frames: LineFrame[] }> = [];

/** Every square of the map at `l`. */
export function mapAt(l: number): LineFrame[] {
  const known = recent.find((entry) => entry.l === l);
  if (known) return known.frames;
  const frames = MAP.map((entry) => lineAt(entry.story, l, entry.line));
  recent.unshift({ l, frames });
  recent.length = Math.min(recent.length, 3);
  return frames;
}

/** The count beside the map: lines left (a line named once is still on the sheet), named once, erased. */
export function countsOf(frames: readonly LineFrame[]): { left: number; half: number; gone: number } {
  let gone = 0;
  let half = 0;
  for (const frame of frames) {
    if (frame.state === 'gone') gone += 1;
    else if (frame.state === 'half') half += 1;
  }
  return { left: frames.length - gone, half, gone };
}

export const countsAt = (l: number) => countsOf(mapAt(l));
