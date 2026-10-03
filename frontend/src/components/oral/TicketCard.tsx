import { glue } from '../../lib/oral/format';

export interface TicketHeading {
  /** The bold part: «Билет 12», «Случайный билет», «Вопрос 17». */
  strong: string;
  /** «вопрос 1 из 2» or ''. */
  rest: string;
}

/**
 * «Билет 12 · вопрос 1 из 2» for a known ticket, «Случайный билет · вопрос 1 из 2» for a drawn pair,
 * «Вопрос 17» for a single question (redesign spec 2.2 #2: Literata, ordinary case, no small caps).
 */
export function ticketHeading(ticketNumber: string | null, index: number, total: number, questionLabel: string): TicketHeading {
  const rest = total > 1 ? `вопрос ${index + 1} из ${total}` : '';
  if (ticketNumber) return { strong: `Билет ${ticketNumber}`, rest };
  if (total > 1) return { strong: 'Случайный билет', rest };
  return { strong: questionLabel ? `Вопрос ${questionLabel}` : 'Вопрос', rest: '' };
}

interface TicketCardProps {
  heading: TicketHeading;
  question: string;
}

/**
 * The ticket as an index card (redesign spec 5.11): the line «Билет 12 · вопрос 1 из 2» and the
 * question in Literata 600. It never folds while the answer is given — the audience reads it then.
 * The question is shown, never voiced (orchestrator correction 7).
 */
export default function TicketCard({ heading, question }: TicketCardProps) {
  return (
    <article className="sf-index-card or-ticket" aria-label={[heading.strong, heading.rest].filter(Boolean).join(', ')}>
      <p className="or-ticket-no">
        <b>{heading.strong}</b>
        {heading.rest && glue(` · ${heading.rest}`)}
      </p>
      <h1 className="or-ticket-q">{question}</h1>
    </article>
  );
}
