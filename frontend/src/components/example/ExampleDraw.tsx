import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DrawStack, { ticketTitle, type DrawnCardQuestion } from '../exams/DrawStack';
import { glue } from '../exams/sheetModel';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { pluralRu } from '../conversation/visuals';
import { COVERAGE_PILL_WORDS } from '../exams/marks';
import { EXAMPLE_QUESTIONS, exampleDrawPool, type ExampleQuestion } from '../../data/example';
import { drawExampleQuestion } from './exampleFlow';
import TryBar from './TryBar';
import { track } from '../../lib/telemetry';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * «Случайно из 11 вопросов примера: 9 есть в лекциях, 2 — частично.» — what the card is drawn from, in the words of the
 * sheet's own pills: «…из 11 вопросов, которые есть в лекциях» stood beside «есть в лекциях 9» (jury QA, 2026-10-11).
 */
export function examplePoolLine(): string {
  const pool = exampleDrawPool();
  const from = `Случайно из ${pool.total} ${pluralRu(pool.total, ['вопроса', 'вопросов', 'вопросов'])} примера`;
  return pool.partial > 0
    ? `${from}: ${pool.full} ${COVERAGE_PILL_WORDS.full}, ${pool.partial} — ${COVERAGE_PILL_WORDS.partial}.`
    : `${from}, которые ${COVERAGE_PILL_WORDS.full}.`;
}

/** «Вопроса 12 нет в лекциях примера…» — the question the draw leaves out, and why. */
export function exampleSkippedLine(): string | null {
  const missing = EXAMPLE_QUESTIONS.filter((question) => question.coverage === 'none').map((question) => question.number);
  if (missing.length === 0) return null;
  const which = missing.length === 1 ? `Вопроса ${missing[0]}` : `Вопросов ${missing.join(', ')}`;
  return `${which} нет в лекциях примера: ответ не с чем сверить, поэтому в билеты ${missing.length === 1 ? 'он' : 'они'} не ${missing.length === 1 ? 'попадает' : 'попадают'}.`;
}

function cardOf(question: ExampleQuestion): DrawnCardQuestion {
  return { id: question.id, number: String(question.number), text: question.text, none: false };
}

/**
 * «Тянуть билет» of the example (/try/draw): the real draw room (components/exams/DrawStack) — the
 * stack, the top card lifts and turns over to the question drawn — then «Отвечать» and «Тянуть ещё».
 * The draw is lib/exams/draw over the questions the lectures cover; nothing is voiced or saved.
 */
export default function ExampleDraw() {
  useDocumentTitle('Тянуть билет · пример');
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const [drawn, setDrawn] = useState<{ key: number; question: ExampleQuestion } | null>(null);
  const counter = useRef(0);

  const draw = useCallback(() => {
    const question = drawExampleQuestion();
    if (!question) return;
    counter.current += 1;
    track('try_ticket_drawn');
    setDrawn({ key: counter.current, question });
  }, []);

  // Draw on arrival, as the real draw room does.
  useEffect(() => {
    draw();
  }, [draw]);

  const card = drawn ? [cardOf(drawn.question)] : null;
  const skipped = exampleSkippedLine();

  return (
    <>
      <TryBar where="Лист примера" back="/try" />
      <main className="sf-page dw-room tx-draw">
        <h1 className="sr-only">Тянуть билет</h1>
        <div className="dw-center">
          <section aria-label="Билет">
            <DrawStack drawKey={drawn?.key ?? 0} ticketNumber={null} questions={card} animate={!reduced} />
          </section>
          <section aria-label="Что дальше">
            {card ? <p className="dw-pool">{glue(examplePoolLine())}</p> : null}
            <div className="dw-acts">
              {drawn ? (
                <>
                  <button
                    type="button"
                    className="sf-primary"
                    onClick={() => navigate(`/try/ticket?q=${encodeURIComponent(drawn.question.id)}`)}
                    aria-describedby="tx-ticket-title"
                  >
                    Отвечать
                  </button>
                  <button type="button" className="ex-secondary" onClick={draw}>
                    Тянуть ещё
                  </button>
                </>
              ) : null}
            </div>
            {skipped ? <p className="dw-note">{glue(skipped)}</p> : null}
            <p className="dw-note tx-draw-back tx-narrow-only">
              <Link className="sf-link" data-muted="" to="/try">
                Лист примера
              </Link>
            </p>
            {card ? (
              <p id="tx-ticket-title" className="ex-sr">
                {ticketTitle(null, card)}
              </p>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
}
