import { glue } from '../../lib/oral/format';

export interface TicketHeading {
  /** The bold part: «Билет 12», «Случайный билет», «Вопрос 17». */
  strong: string;
  /** «вопрос 1 из 2» or ''. */
  rest: string;
}

/**
 * «Билет 12 · вопрос 1 из 2» for a department's ticket; for a drawn pair the question's own number,
 * «Вопрос 12 · 1 из 2», so the number stays on screen from the draw to the protocol (redesign
 * critique 8); «Вопрос 17» for a single question (redesign spec 2.2 #2: ordinary case, no capitals).
 */
export function ticketHeading(ticketNumber: string | null, index: number, total: number, questionLabel: string): TicketHeading {
  const label = questionLabel.trim().replace(/[.)]\s*$/, '');
  if (ticketNumber) return { strong: `Билет ${ticketNumber}`, rest: total > 1 ? `вопрос ${index + 1} из ${total}` : '' };
  if (total > 1) return label ? { strong: `Вопрос ${label}`, rest: `${index + 1} из ${total}` } : { strong: 'Случайный билет', rest: `вопрос ${index + 1} из ${total}` };
  return { strong: label ? `Вопрос ${label}` : 'Вопрос', rest: '' };
}

interface TicketCardProps {
  heading: TicketHeading;
  question: string;
}

/**
 * The ticket as a big rounded card (redesign spec 5.11, the reel's «Ответ вслух»): the tag «Билет 12»
 * with «вопрос 1 из 2» and the question large. It never folds while the answer is given — the
 * audience reads it then. The question is shown, never voiced (orchestrator correction 7).
 */
export default function TicketCard({ heading, question }: TicketCardProps) {
  return (
    <article className="sf-index-card or-ticket" aria-label={[heading.strong, heading.rest].filter(Boolean).join(', ')}>
      {/* The ticket's tag (a navy pill, as in the reel) and «вопрос 1 из 2»; the dot is for reading only. */}
      <p className="or-ticket-no">
        <b>{heading.strong}</b>
        {heading.rest && (
          <>
            <span className="or-ticket-sep"> · </span>
            <span>{glue(heading.rest)}</span>
          </>
        )}
      </p>
      <h1 className="or-ticket-q">{question}</h1>
    </article>
  );
}
