/**
 * «Осталось выучить» for oral exams: one RPC, `public.learn_left(p_exam_ids, p_tz)` (supabase/migrations/
 * 20261021140000_learn_left.sql), parsed by the pure lib/containers/topics.ts. The oral exam page asks for its exam,
 * «Сегодня» for all of the user's oral exams at once (no ids). Reads are shared: a component that asks for what another
 * asked for a moment ago gets the same promise (FRESH_MS); a saved answer drops them (forgetLearnLeft) so the next read
 * is new. No network beyond that one call: no Space, no journal reads, no sheet.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseLearnLeft, type LearnLeftExam } from '../lib/containers/topics';

export class LearnLeftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearnLeftError';
  }
}

/** A read this young is reused by the next component that asks for the same exams. */
export const FRESH_MS = 30_000;

function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

const reads = new Map<string, { at: number; promise: Promise<LearnLeftExam[]> }>();

function keyOf(ids: readonly string[] | null): string {
  return ids === null ? '*' : [...new Set(ids)].sort().join(',');
}

/** The oral exams' topics facts: these exams, or (null) every oral exam of the signed-in user. */
export function fetchLearnLeft(ids: readonly string[] | null, options: { fresh?: boolean } = {}): Promise<LearnLeftExam[]> {
  const key = keyOf(ids);
  const kept = reads.get(key);
  if (!options.fresh && kept && Date.now() - kept.at < FRESH_MS) return kept.promise;
  const promise = (async () => {
    const { data, error } = await supabase.rpc('learn_left', { p_exam_ids: ids === null ? null : [...new Set(ids)], p_tz: deviceZone() });
    if (error) throw new LearnLeftError(error.message || 'learn_left');
    return parseLearnLeft(data);
  })();
  reads.set(key, { at: Date.now(), promise });
  // A failed read is not kept: the next one asks again.
  promise.catch(() => {
    if (reads.get(key)?.promise === promise) reads.delete(key);
  });
  return promise;
}

/** After an answer is saved (or points written): the next read asks the server again. */
export function forgetLearnLeft(): void {
  reads.clear();
}

export type LearnLeftState =
  | { status: 'loading'; exams: LearnLeftExam[] }
  | { status: 'ready'; exams: LearnLeftExam[] }
  | { status: 'error'; exams: LearnLeftExam[] };

/**
 * The read as a hook: `ids` null for every oral exam of the user, [] (or `enabled` false) for none. The exams in hand
 * stay while a reload runs; `reload` asks the server again.
 */
export function useLearnLeft(ids: readonly string[] | null, enabled = true): LearnLeftState & { reload: () => void } {
  const key = enabled && (ids === null || ids.length > 0) ? keyOf(ids) : '';
  const [state, setState] = useState<{ key: string; value: LearnLeftState }>({ key: '', value: { status: 'loading', exams: [] } });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    const askedIds = key === '*' ? null : key.split(',');
    setState((current) => ({ key, value: { status: 'loading', exams: current.key === key ? current.value.exams : [] } }));
    fetchLearnLeft(askedIds, { fresh: round > 0 })
      .then((exams) => {
        if (alive) setState({ key, value: { status: 'ready', exams } });
      })
      .catch(() => {
        if (alive) setState((current) => ({ key, value: { status: 'error', exams: current.key === key ? current.value.exams : [] } }));
      });
    return () => {
      alive = false;
    };
  }, [key, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  const value: LearnLeftState = !key ? { status: 'ready', exams: [] } : state.key === key ? state.value : { status: 'loading', exams: [] };
  return { ...value, reload };
}
