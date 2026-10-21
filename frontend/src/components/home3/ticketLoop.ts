/**
 * «Билет вслух» on the landing as a loop (owner, 2026-10-21: «там где билет вслух думаю нужно было сделать
 * анимацией»): the student names three points of ticket 7 one by one, each lights up as it is named; the examiner
 * asks about the missed one; the student answers and the last point lights, yellow (named after the question); the
 * protocol line closes it. One pure function of the time in the loop, so every frame is known in advance (tests,
 * the reduced-motion still frame) and the page only wakes at the cues, never per frame.
 */

/** A point of the ticket: not named yet, named by the student, asked about by the examiner, named after the question. */
export type PointState = 'wait' | 'ok' | 'asked' | 'after';
export type Speaker = 'you' | 'examiner' | null;

export interface TicketFrame {
  /** How many lines of the talk are on screen (0…5): three said, the examiner's question, the answer. */
  lines: number;
  points: [PointState, PointState, PointState, PointState];
  speaker: Speaker;
  /** The protocol line under the ticket. */
  protocol: boolean;
  /** The loop's last half second: everything fades before it starts again. */
  fading: boolean;
}

/** The loop, ms. */
export const LOOP_MS = 15000;

/** The moments something changes, ms from the loop's start, in order. */
export const CUES = [0, 500, 1900, 2400, 3900, 4400, 5800, 6500, 8800, 10300, 11000, 14400] as const;

/**
 * The frame at `t` ms (any t: it is taken modulo the loop). Which line names which point: line 1 → point 1,
 * line 2 → point 2, line 3 → point 4; the examiner asks about point 3, the answer names it.
 */
export function ticketFrame(t: number): TicketFrame {
  const at = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const lines = at >= 8800 ? 5 : at >= 6500 ? 4 : at >= 4400 ? 3 : at >= 2400 ? 2 : at >= 500 ? 1 : 0;
  const third: PointState = at >= 10300 ? 'after' : at >= 6500 ? 'asked' : 'wait';
  const points: TicketFrame['points'] = [at >= 1900 ? 'ok' : 'wait', at >= 3900 ? 'ok' : 'wait', third, at >= 5800 ? 'ok' : 'wait'];
  const speaker: Speaker = at >= 11000 ? null : at >= 8800 ? 'you' : at >= 6500 ? 'examiner' : at >= 500 ? 'you' : null;
  return { lines, points, speaker, protocol: at >= 11000, fading: at >= 14400 };
}

/** The still frame (reduced motion, a paused loop before it began): the answer as it ends. */
export const FINAL_FRAME: TicketFrame = { ...ticketFrame(14000), fading: false };

/** Ms from `t` to the next cue (a whole loop's wrap included), so a timer wakes exactly when the frame changes. */
export function untilNextCue(t: number): number {
  const at = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const next = CUES.find((cue) => cue > at);
  return (next ?? LOOP_MS) - at;
}
