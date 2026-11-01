/**
 * «Дуэль»: the client of the duel_* RPCs (docs/live/DUEL.md §6). Every call is a POST of PostgREST's rpc/… (the token in
 * the body, never in the address), through lib/supabase and its route (lib/supabaseRoute: directly or the site's /sb).
 * Errors are the live game's LiveError, read from the body's `code` (lib/live/real.ts liveError); a 429 of the /sb proxy
 * itself (no body code) keeps its status, and the controller backs off on it.
 */
import { supabase } from '../supabase';
import { liveError } from '../live/real';
import { LiveError } from '../live/types';
import type { DuelApi, DuelInfo, DuelReview, DuelState, DuelUnchanged } from './types';
import type { PracticeResult } from '../live/types';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let result: { data: unknown; error: unknown; status?: number };
  try {
    result = await supabase.rpc(name, args);
  } catch (error) {
    const kind = error instanceof Error ? error.name : '';
    throw new LiveError(kind === 'TypeError' || kind === 'AbortError' ? 'network' : 'unknown', null, 0);
  }
  if (result.error) throw liveError(result.error, typeof result.status === 'number' ? result.status : 0);
  return result.data as T;
}

export function createRealDuelApi(): DuelApi {
  return {
    kind: 'real',
    create: (source, settings, name, token, look) =>
      rpc<DuelState>('duel_create', { p_source: source, p_settings: settings, p_name: name, p_token: token, p_look: look }),
    info: (code) => rpc<DuelInfo>('duel_info', { p_code: code }),
    join: (code, name, token, look) => rpc<DuelState>('duel_join', { p_code: code, p_name: name, p_token: token, p_look: look }),
    state: (code, token, rev) => rpc<DuelState | DuelUnchanged>('duel_state', { p_code: code, p_token: token, p_rev: rev ?? null }),
    ready: (code, token) => rpc<DuelState>('duel_ready', { p_code: code, p_token: token }),
    answer: (code, token, qi, answer) => rpc<DuelState>('duel_answer', { p_code: code, p_token: token, p_qi: qi, p_answer: answer }),
    next: (code, token, qi) => rpc<DuelState>('duel_next', { p_code: code, p_token: token, p_qi: qi }),
    rematch: (code, token) => rpc<DuelState>('duel_rematch', { p_code: code, p_token: token }),
    review: (code, token) => rpc<DuelReview>('duel_review', { p_code: code, p_token: token }),
    practice: (code, token) => rpc<PracticeResult>('duel_practice', { p_code: code, p_token: token }),
  };
}

let current: DuelApi | null = null;

/** The client the pages use (tests put their own with setDuelApi). */
export function duelApi(): DuelApi {
  current ??= createRealDuelApi();
  return current;
}

export function setDuelApi(api: DuelApi | null): void {
  current = api;
}
