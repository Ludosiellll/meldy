/**
 * The lines of the cheat sheet on a reel's stage («Шпаргалка, которая исчезает»), as pure functions
 * of scene time: the same moment always looks the same (the page, tests, the frame exporter). The
 * states and the passes between them are the exam page's (components/exams/sheet, lib/exams/cheatSheet):
 * - fresh — as written;
 * - rubbed — named once: two passes of the eraser leave islands of ink, the words are not readable;
 * - erased — named again on another day: a ghost of 7 % on rubbed paper;
 * - missed — readable, a pencil wave under it: not named, or named only after the examiner's question;
 * - returned — an erased line written again, with the wave.
 * Only answers move a line; nothing here claims that a point is learned.
 */

export type InkState = 'fresh' | 'rubbed' | 'erased' | 'missed' | 'returned';

/** How a line moves: → rubbed half-way, ← erased, → written again over its trace, a wave drawn under it. */
export type InkMove = 'rub' | 'erase' | 'return' | 'miss';

export interface InkStep {
  /** Scene time the eraser (or the pencil) starts on the line. */
  at: number;
  to: InkState;
  /** The pencil note under the line from then on (the exam page's words); none when left out. */
  note?: string;
}

export interface InkLine {
  /** The short handwritten line, word for word (↑ ↓ → are drawn in ink). */
  text: string;
  /** Main points have «•», the others «–». */
  essential: boolean;
  /** The line before the first step. */
  from: InkState;
  /** Its note before the first step. */
  note?: string;
  /**
   * Keeps the row of a note under the line although it has none in this scene: a paper handed to the
   * next scene, where the line gets one, keeps its height (nothing below moves).
   */
  noteRow?: boolean;
  steps?: readonly InkStep[];
}

/** How long each move takes (the eraser's pass is the landing sheet's 900 ms). */
export const MOVE_MS: Record<InkMove, number> = { rub: 900, erase: 900, return: 1000, miss: 650 };

/** The ink left of a line: full, the islands of a rubbed line, a ghost. */
export const LEVEL: Record<InkState, number> = { fresh: 1, missed: 1, returned: 1, rubbed: 0.8, erased: 0.07 };
/** Whole ink (no eraser marks) or broken into the islands of two passes. */
export const WHOLE: Record<InkState, boolean> = { fresh: true, missed: true, returned: true, rubbed: false, erased: false };
/** The bullet fades with the line, as on the exam page. */
export const BULLET: Record<InkState, number> = { fresh: 1, missed: 1, returned: 1, rubbed: 0.3, erased: 0.12 };
/** The eraser's track under a line it has touched (a returned line keeps it). */
export const PATCH: Record<InkState, number> = { fresh: 0, missed: 0, returned: 1, rubbed: 1, erased: 1 };
/** The pencil wave under a missed or returned line. */
export const WAVE: Record<InkState, number> = { fresh: 0, missed: 1, returned: 1, rubbed: 0, erased: 0 };

export function moveOf(from: InkState, to: InkState): InkMove | null {
  if (from === to) return null;
  if (to === 'rubbed') return 'rub';
  if (to === 'erased') return 'erase';
  if (to === 'missed' && from === 'fresh') return 'miss';
  return 'return';
}

export interface InkFrame {
  /** The state the line is in, or moving to. */
  state: InkState;
  /** The state it moves from (the same as `state` when still). */
  from: InkState;
  move: InkMove | null;
  /** Progress of the move, 0 → 1 (1 when still). */
  p: number;
  note: string | null;
  /** The note it had before the move (fading out while the new one waits). */
  noteBefore: string | null;
}

/** The line at scene time `l`. */
export function inkAt(line: InkLine, l: number): InkFrame {
  let state = line.from;
  let note = line.note ?? null;
  let frame: InkFrame = { state, from: state, move: null, p: 1, note, noteBefore: note };
  for (const step of line.steps ?? []) {
    if (l < step.at) break;
    const move = moveOf(state, step.to);
    const next = step.note ?? null;
    const p = move ? Math.min(1, (l - step.at) / MOVE_MS[move]) : 1;
    frame = { state: step.to, from: state, move: p < 1 ? move : null, p, note: next, noteBefore: note };
    state = step.to;
    note = next;
  }
  if (frame.move === null) frame = { ...frame, from: frame.state, p: 1, noteBefore: frame.note };
  return frame;
}

/** The line keeps a row for a note under it in this scene (it has one now, will have one, or keeps the room). */
export function keepsNoteRow(line: InkLine): boolean {
  return Boolean(line.noteRow) || Boolean(line.note) || (line.steps ?? []).some((step) => Boolean(step.note));
}

/** Every state a line takes in the scene (for the rows its note reserves, the wave it may need). */
export function statesOf(line: InkLine): InkState[] {
  return [line.from, ...(line.steps ?? []).map((step) => step.to)];
}

/** The state of each line after every step up to scene time `l` — what a still frame shows. */
export function statesAt(lines: readonly InkLine[], l: number): InkState[] {
  return lines.map((line) => inkAt(line, l).state);
}
