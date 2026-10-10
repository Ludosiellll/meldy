import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DayPlan, PlanInput } from '../../types/container';
import type { Loadable } from '../../lib/containers/hooks';
import { planDay } from '../../lib/containers/plan';
import * as copy from './copy';
import { GONE } from './copyImport';

/** The day's plan from the exam's input (lib/containers/plan.ts); null when there is no input or the engine failed. */
export function usePlan(input: PlanInput | null | undefined): DayPlan | null {
  return useMemo(() => {
    if (!input) return null;
    try {
      return planDay(input);
    } catch {
      return null;
    }
  }, [input]);
}

/** True once `active` has lasted 300 ms: a quick read shows no word that is gone at once (redesign spec 4.6). */
export function useShownAfter(active: boolean, ms = 300): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && shown;
}

/**
 * What a page of the exam shows while its data is not there: the wait, a failure with «Повторить», no functions yet, or
 * an exam that is no longer the user's — deleted, left, removed — with the way to «Экзамены» and no «Повторить», which
 * could not help (usability check m2).
 */
export function PageState<T>({ state, loadingText = copy.LOADING }: { state: Loadable<T>; loadingText?: string }) {
  const waiting = useShownAfter(state.loading && !state.data);
  if (state.gone && !state.data) {
    return (
      <div className="sf-page ct-page">
        <div className="ct-error">
          <h1>{GONE.title}</h1>
          <p>{GONE.text}</p>
          <Link className="sf-link" to="/exams">
            {copy.TO_EXAMS}
          </Link>
        </div>
      </div>
    );
  }
  if (state.unavailable) {
    return (
      <div className="sf-page ct-page">
        <div className="ct-error">
          <h1>{copy.UNAVAILABLE_TITLE}</h1>
          <p>{copy.UNAVAILABLE_TEXT}</p>
          <Link className="sf-link" to="/exams">
            {copy.TO_EXAMS}
          </Link>
        </div>
      </div>
    );
  }
  if (state.error && !state.data) {
    return (
      <div className="sf-page ct-page">
        <div className="ct-error" role="alert">
          <h1>{copy.LOAD_FAILED}</h1>
          <p>{state.error}</p>
          <button type="button" className="sf-link" onClick={state.reload}>
            {copy.RETRY}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="sf-page ct-page">
      <p className="ct-wait" role="status">
        {waiting ? loadingText : ''}
      </p>
    </div>
  );
}
