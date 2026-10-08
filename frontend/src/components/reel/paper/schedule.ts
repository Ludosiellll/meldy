/**
 * Every moment of the sheet, in reel milliseconds. The answer's own moments (each word, each naming)
 * come from TICKET and wordAt in content.ts, so the rubs and the words share one clock: a rub starts
 * RUB_LAG after the word that names its point appears.
 */
import { DAYS, RUB_LAG, namedAt } from '../content';

export const SCHEDULE = {
  /** The department's heading, then the rows of the list (typed). */
  head: { at: 1500, dur: 500 },
  rows: { at: 2000, step: 330, dur: 330 },
  /** The lecture slip is pinned to the question; its hint and the unmatched line follow. */
  slip: { at: 8600 },
  hint: { at: 9900 },
  lead: { at: 11000 },
  /** The four points, written by hand one after another, a pen stroke each. */
  points: { writeAt: [14600, 15550, 16500, 17450], writeDur: 800 },
  /** The ticket lies on the sheet; the answer's transcript and the voice wave follow it. */
  ticket: { at: 18900 },
  wave: { from: 19800, to: 34000 },
  talkOut: { at: 34000, dur: 500 },
  /** The count of the editor and its fine print. */
  count: { at: 32000, out: 34000, dur: 500 },
  /** The date of each answer is written in the sheet's corner; the next one replaces it. */
  dates: [
    { at: 20000, text: DAYS.first, until: 36200 },
    { at: 36200, text: DAYS.second, until: 38800 },
    { at: 38800, text: DAYS.third, until: undefined as number | undefined },
  ],
  /** The first answer: the rub of the point named before the question, and the marks after the answer. */
  rub: namedAt(0) + RUB_LAG,
  lateMiss: namedAt(2) + RUB_LAG,
  missB: 31700,
  missD: 31950,
  /** The second answer (8 окт.) names the first point again: its line is erased. */
  erase: 36600,
  /**
   * The third answer (10 окт.) does not name it: the erased line comes back in ink, with its note. The
   * date is written first (38.8 s, 450 ms); the beat that follows moves nothing else, until the camera turns.
   */
  returnAt: 39400,
  /** The copy: the sheet duplicates, the copy slides to the classmate's label, the day's card and the reminder. */
  copy: { appear: 42400, slide: 42600, slideDur: 1500, label: 43600, day: 43900, remind: 44200 },
} as const;
