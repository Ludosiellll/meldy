import { useRef } from 'react';
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
/** «Как на экзамене» has no «Тянуть ещё»: the card only says what the question lacks. */
export const NONE_QUESTION_EXAM_MESSAGE = 'Этого вопроса нет в ваших лекциях.';

interface DrawStackProps {
  /** Changes with every draw, so the top card turns over again. */
  drawKey: number;
  /** The department's ticket number for a known ticket; null for a random combination. */
  ticketNumber: number | null;
  questions: DrawnCardQuestion[] | null;
  /** False under prefers-reduced-motion: the card only fades in (150 ms). */
  animate: boolean;
  /** «Как на экзамене»: no «тяните ещё» in the card's notes. */
  examMode?: boolean;
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
 * The card's own line: «Случайный билет · вопросы 12 и 31», «Билет 12 · вопросы 3 и 25», «Вопрос 12».
 * «Билет N» only for a ticket of the department's list: a number is never invented (Jury_Check 9).
 * The numbers stay on the card (redesign critique 8: a random pair used to lose them until the peak).
 */
export function cardHead(ticketNumber: number | null, questions: DrawnCardQuestion[]): { strong: string; rest: string } {
  if (ticketNumber === null && questions.length === 1) return { strong: `Вопрос ${questions[0].number}`, rest: '' };
  return { strong: ticketNumber !== null ? `Билет ${ticketNumber}` : 'Случайный билет', rest: numbersPhrase(questions) };
}

interface Face {
  ticketNumber: number | null;
  questions: DrawnCardQuestion[] | null;
}

/** A ticket whose questions run longer than this (in characters) is set smaller on a phone (exams.css). */
const LONG_TICKET_CHARS = 150;

function FaceContent({ face, examMode = false }: { face: Face; examMode?: boolean }) {
  if (!face.questions) return <p className="dw-back">Билеты</p>;
  const head = cardHead(face.ticketNumber, face.questions);
  const single = face.ticketNumber === null && face.questions.length === 1;
  const long = face.questions.reduce((sum, question) => sum + question.text.length, 0) > LONG_TICKET_CHARS;
  return (
    <>
      {/* The ticket's tag (navy pill) and its questions' numbers; the dot between them is for reading only. */}
      <p className="dw-no">
        <b>{head.strong}</b>
        {head.rest && (
          <>
            <span className="dw-no-sep"> · </span>
            <span className="dw-no-rest">{glue(head.rest)}</span>
          </>
        )}
      </p>
      <ol className="dw-qs" data-single={single ? '' : undefined} data-long={long ? '' : undefined}>
        {face.questions.map((question) => (
          <li key={question.id} className="dw-q">
            {!single && (
              <span className="dw-q-n" aria-hidden="true">
                {question.number}
              </span>
            )}
            <span className="dw-q-t">{question.text}</span>
            {question.none && <span className="dw-q-none sf-pnote">{examMode ? NONE_QUESTION_EXAM_MESSAGE : NONE_QUESTION_MESSAGE}</span>}
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * A static stack of three ticket cards; the top one lifts and turns over around its horizontal axis
 * (600 ms at most, no shuffling; a 150 ms fade under reduced motion). Until the card is edge-on
 * (250 ms) it still shows what it showed before — the blank back, or the last ticket on «Тянуть ещё»
 * — and only then the drawn ticket, so turning it over reveals something (redesign critique 8). The
 * drawn ticket is in the page at once (an aria-hidden copy of the old face covers it for those 250 ms).
 * Nothing is voiced (correction 7).
 */
export default function DrawStack({ drawKey, ticketNumber, questions, animate, examMode = false }: DrawStackProps) {
  // The face shown before this draw: the blank back first, then the previous ticket.
  const faces = useRef<{ key: number; current: Face; previous: Face | null }>({
    key: drawKey,
    current: { ticketNumber, questions },
    previous: null,
  });
  if (faces.current.key !== drawKey) {
    faces.current = { key: drawKey, current: { ticketNumber, questions }, previous: faces.current.current };
  } else {
    faces.current.current = { ticketNumber, questions };
  }
  const previous = animate && questions ? faces.current.previous ?? { ticketNumber: null, questions: null } : null;
  return (
    <div className="dw-stack">
      <div className="sf-index-card dw-under" data-n="2" aria-hidden="true" />
      <div className="sf-index-card dw-under" data-n="1" aria-hidden="true" />
      <article
        key={drawKey}
        className="sf-index-card dw-card"
        data-state={questions ? (animate ? 'lift' : 'fade') : undefined}
        aria-live="polite"
        aria-label={questions ? ticketTitle(ticketNumber, questions) : 'Стопка билетов'}
      >
        <div className="dw-face">
          <FaceContent face={{ ticketNumber, questions }} examMode={examMode} />
        </div>
        {previous && (
          <div className="dw-face dw-face-old" aria-hidden="true">
            <FaceContent face={previous} examMode={examMode} />
          </div>
        )}
      </article>
    </div>
  );
}
