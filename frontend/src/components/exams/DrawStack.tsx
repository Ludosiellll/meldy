import { pluralRu } from '../conversation/visuals';
import { glue } from './sheetModel';

export interface DrawnCardQuestion {
  id: string;
  number: string;
  text: string;
  /** Not in any lecture: there is nothing to check an answer against. */
  none: boolean;
}

export const NONE_QUESTION_MESSAGE =
  'Этого вопроса нет в ваших лекциях — оценить ответ не по чему. Добавьте материал или тяните ещё.';

interface DrawStackProps {
  /** Changes with every draw, so the top card lifts again. */
  drawKey: number;
  /** The department's ticket number for a known ticket; null for a random combination. */
  ticketNumber: number | null;
  questions: DrawnCardQuestion[] | null;
  /** False under prefers-reduced-motion: the card only fades in (150 ms). */
  animate: boolean;
}

function numbersPhrase(questions: DrawnCardQuestion[]): string {
  const numbers = questions.map((question) => question.number);
  if (numbers.length === 1) return `вопрос ${numbers[0]}`;
  return `вопросы ${numbers.slice(0, -1).join(', ')} и ${numbers[numbers.length - 1]}`;
}

/** «Билет 12: вопросы 12 и 31» / «Случайный билет: вопросы 7 и 31» — read out with the card. */
export function ticketTitle(ticketNumber: number | null, questions: DrawnCardQuestion[]): string {
  const head = ticketNumber !== null ? `Билет ${ticketNumber}` : questions.length === 1 ? 'Вопрос' : 'Случайный билет';
  if (ticketNumber === null && questions.length === 1) return `Вопрос ${questions[0].number}`;
  return `${head}: ${numbersPhrase(questions)}`;
}

/**
 * A static stack of three ticket cards; the top one lifts and turns over (600 ms at most, no
 * shuffling; a 150 ms fade under reduced motion) and shows the drawn ticket: its number when the
 * department's tickets are known, the questions with their numbers and texts. Nothing is voiced
 * (correction 7).
 */
export default function DrawStack({ drawKey, ticketNumber, questions, animate }: DrawStackProps) {
  const single = ticketNumber === null && questions?.length === 1;
  return (
    <div className="dw-stack">
      <div className="sf-index-card dw-under" data-n="2" aria-hidden="true" />
      <div className="sf-index-card dw-under" data-n="1" aria-hidden="true" />
      <article
        key={drawKey}
        className="sf-index-card dw-card"
        data-state={questions ? (animate ? 'lift' : 'fade') : undefined}
        data-lifted={questions ? '' : undefined}
        aria-live="polite"
        aria-label={questions ? ticketTitle(ticketNumber, questions) : 'Стопка билетов'}
      >
        {questions ? (
          <>
            <p className="dw-no">
              {ticketNumber !== null ? (
                <b>Билет {ticketNumber}</b>
              ) : (
                // One question: the same line the answer screen's card will have, «Вопрос 12».
                <b>{single ? `Вопрос ${questions[0].number}` : 'Случайный билет'}</b>
              )}
              {questions.length > 1 && glue(` · ${questions.length} ${pluralRu(questions.length, ['вопрос', 'вопроса', 'вопросов'])}`)}
            </p>
            <ol className="dw-qs">
              {questions.map((question) => (
                <li key={question.id} className="dw-q">
                  {!single && <span className="dw-q-n">Вопрос {question.number}</span>}
                  <span className="dw-q-t">{question.text}</span>
                  {question.none && <span className="dw-q-none sf-pnote">{NONE_QUESTION_MESSAGE}</span>}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="dw-back">Билеты</p>
        )}
      </article>
    </div>
  );
}
