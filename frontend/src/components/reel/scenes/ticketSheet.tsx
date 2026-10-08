/**
 * The ticket's cheat sheet in chapters 03 and 04: one paper, handed from scene to scene in the same
 * place, so the cut between them does not show. Its lines are the points of the oral chapter's answer
 * sheet (content.ts TICKET_LINES), its question the ticket's; the moves are the exam page's rule:
 * named — half-way, named again on another day — gone, not named after that — back.
 */
import { StageSheet, type StageDate } from '../../film/StageSheet';
import type { InkLine } from '../../film/ink';
import { SHEET_WORDS, TICKET, TICKET_LINES } from '../content';

/** The paper at its own size and how much larger the stage shows it. */
export const PAPER = { width: 518, zoom: 1.85 } as const;
/** Where chapter 03 leaves the paper and chapter 04 takes it (stage px). */
export const PAPER_AT = { left: 860, top: 330 } as const;
/** The line of the point the answer missed (the examiner asked about it). */
const MISSED = TICKET.missed;
/**
 * The line that comes back in chapter 04 (erased, then not named): the last one, so the row its note
 * needs is at the foot of the paper in chapter 03 already, where an empty row is just paper.
 */
export const RETURNING = TICKET_LINES.length - 1;

export function TicketPaper({ lines, dates }: { lines: readonly InkLine[]; dates: readonly StageDate[] }) {
  return (
    <StageSheet questions={[{ number: 7, text: TICKET.question, lines }]} dates={dates} width={PAPER.width} zoom={PAPER.zoom} seed="landing-reel-ticket" />
  );
}

/**
 * Chapter 03, from `at` (its own time): the answer of chapter 02. The four points named in it rub
 * half-way one after another; the missed one, named only after the examiner's question, stays with
 * the pencil wave.
 */
export function afterAnswer(at: number, missedAt: number): InkLine[] {
  let order = 0;
  return TICKET_LINES.map((text, index): InkLine => {
    if (index === MISSED) return { text, essential: true, from: 'fresh', steps: [{ at: missedAt, to: 'missed', note: SHEET_WORDS.afterQuestion }] };
    const step = { at: at + order * 180, to: 'rubbed' as const };
    order += 1;
    return { text, essential: true, from: 'fresh', noteRow: index === RETURNING, steps: [step] };
  });
}

/**
 * Chapter 04: the lines as chapter 03 leaves them. On another day (`second`) the four named again go,
 * the missed one is named and rubs half-way; on a third day (`third`) it goes too, and one erased line
 * is not named — it comes back.
 */
export function overDays(second: number, third: number): InkLine[] {
  let order = 0;
  return TICKET_LINES.map((text, index): InkLine => {
    if (index === MISSED) {
      return {
        text,
        essential: true,
        from: 'missed',
        note: SHEET_WORDS.afterQuestion,
        steps: [
          { at: second + 100, to: 'rubbed' },
          { at: third, to: 'erased' },
        ],
      };
    }
    const steps: InkLine['steps'] = [{ at: second + order * 160, to: 'erased' }];
    order += 1;
    if (index === RETURNING) return { text, essential: true, from: 'rubbed', steps: [...steps, { at: third + 120, to: 'returned', note: SHEET_WORDS.returned }] };
    return { text, essential: true, from: 'rubbed', steps };
  });
}
