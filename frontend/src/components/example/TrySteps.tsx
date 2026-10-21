import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';

/** The three steps of the example, in the visitor's words. */
export const TRY_STEPS = ['Вопрос', 'Ответ', 'Проверка'] as const;

export type TryStepNumber = 1 | 2 | 3;

interface TryStepsProps {
  /** The step the visitor is on. */
  current: TryStepNumber;
  /**
   * Going back to the first step (another question) asks first while an answer is being given: the room passes its
   * own way out, as it does for the top line.
   */
  onLeave?: (to: string) => void;
}

/**
 * Where the visitor is in «Попробовать на примере» (/try): 1 «Вопрос» → 2 «Ответ» → 3 «Проверка». The first step,
 * once passed, is a link back to the list of questions; the others are where the visitor is or will be. A list with
 * the current step marked (aria-current), so a screen reader says «шаг 2 из 3».
 */
export default function TrySteps({ current, onLeave }: TryStepsProps) {
  const back = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onLeave) return;
    event.preventDefault();
    onLeave('/try');
  };
  return (
    <nav className="tx-steps" aria-label="Шаги примера">
      <ol>
        {TRY_STEPS.map((label, index) => {
          const step = (index + 1) as TryStepNumber;
          const state = step < current ? 'done' : step === current ? 'now' : 'next';
          const body = (
            <>
              <span className="tx-step-n" aria-hidden="true">
                {state === 'done' ? <Tick /> : step}
              </span>
              <span className="tx-step-t">{label}</span>
              <span className="sr-only">{state === 'done' ? ', пройден' : state === 'now' ? `, шаг ${step} из ${TRY_STEPS.length}` : ''}</span>
            </>
          );
          return (
            <li key={label} className="tx-step" data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
              {step === 1 && state === 'done' ? (
                <Link className="tx-step-in" to="/try" onClick={back}>
                  {body}
                </Link>
              ) : (
                <span className="tx-step-in">{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" focusable="false">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
