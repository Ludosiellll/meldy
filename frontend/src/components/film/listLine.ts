/**
 * The cheat sheet's lines on a reel's stage in Meldy's own look (decision 2026-10-10, «Шпаргалка без бумаги»), as
 * pure functions of scene time: the same moment always looks the same (the page, tests, the frame exporter).
 *
 * The states are the sheet's (lib/exams/cheatSheet): fresh, rubbed (named once), erased (named again on another day),
 * missed (not named, or named only after the examiner's question) and returned (an erased line not named later). On
 * screen they are three looks, as on the exam page:
 * - left — the line stands: a dot for a main point, a dash for a detail, ink;
 * - once — named once: a yellow dot, muted words;
 * - gone — erased: faint words struck through, no marker.
 * A line moves only by an answer: to «once» its marker turns yellow; to «gone» a strike runs over it left to right.
 */

export type SheetState = 'fresh' | 'rubbed' | 'erased' | 'missed' | 'returned';
export type ListLook = 'left' | 'once' | 'gone';

export const LOOK: Record<SheetState, ListLook> = { fresh: 'left', missed: 'left', returned: 'left', rubbed: 'once', erased: 'gone' };

export interface ListStep {
  /** Scene time the answer reaches the line. */
  at: number;
  to: SheetState;
  /** The small note under the line from then on (the exam page's words); none when left out. */
  note?: string;
}

export interface ListLine {
  /** The short line, word for word. */
  text: string;
  /** Main points have a dot, the others a dash. */
  essential: boolean;
  from: SheetState;
  note?: string;
  steps?: readonly ListStep[];
}

/** How long a change takes: a line turning yellow, a strike running over a line, a note coming in. */
export const CHANGE_MS: Record<ListLook, number> = { left: 400, once: 420, gone: 760 };

export interface ListFrame {
  state: SheetState;
  /** The state it moves from (the same as `state` when still). */
  from: SheetState;
  look: ListLook;
  fromLook: ListLook;
  /** Progress of the change, 0 → 1 (1 when still). */
  p: number;
  note: string | null;
  noteBefore: string | null;
}

/** The line at scene time `l`. */
export function lineAt(line: ListLine, l: number): ListFrame {
  let state = line.from;
  let note = line.note ?? null;
  let frame: ListFrame = { state, from: state, look: LOOK[state], fromLook: LOOK[state], p: 1, note, noteBefore: note };
  for (const step of line.steps ?? []) {
    if (l < step.at) break;
    const next = step.note ?? null;
    const p = Math.min(1, (l - step.at) / CHANGE_MS[LOOK[step.to]]);
    frame = { state: step.to, from: state, look: LOOK[step.to], fromLook: LOOK[state], p, note: next, noteBefore: note };
    state = step.to;
    note = next;
  }
  if (frame.p >= 1) frame = { ...frame, from: frame.state, fromLook: frame.look, p: 1, noteBefore: frame.note };
  return frame;
}

/** The state of each line after every step up to scene time `l` — what a still frame shows. */
export function statesAt(lines: readonly ListLine[], l: number): SheetState[] {
  return lines.map((line) => lineAt(line, l).state);
}

/** The line keeps a row for a note under it in this scene (it has one now or will have one). */
export function keepsNote(line: ListLine): boolean {
  return Boolean(line.note) || (line.steps ?? []).some((step) => Boolean(step.note));
}

/** Share of a change to «gone» by which the strike has run over the whole line (StageList draws it so). */
export const STRUCK_AT = 0.75;

/** Lines left on the sheet (not erased) at `l`: the big number of the sheet's card, down by one as a strike ends. */
export function leftAt(lines: readonly ListLine[], l: number): number {
  return lines.filter((line) => {
    const frame = lineAt(line, l);
    return frame.look !== 'gone' || (frame.fromLook !== 'gone' && frame.p < STRUCK_AT);
  }).length;
}
