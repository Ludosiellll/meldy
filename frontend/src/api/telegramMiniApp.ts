/**
 * The Mini App's calls to the bot's function (supabase/functions/_shared/bot/webapp.ts; meldy-notes
 * 10_Project/Telegram_Mini_App_Spec_2026-10-10.md §3):
 * - `miniAppSession(initData, have)` — POST /telegram/webapp/session: the account linked to this Telegram gets a
 *   one-time sign-in (`tokenHash`, for `signInWithTelegram`), or `same` when `have` (the account signed in here) is
 *   already it; else why not (unlinked, stale, replayed …);
 * - `miniAppLink(initData, zone)` — POST /telegram/webapp/link with the signed-in student's JWT: this Telegram is
 *   linked to the account (the bot then says so in the chat).
 * Both go through the app's Supabase client (lib/supabase): its fetch picks the direct way or the site's /sb/
 * (lib/supabaseRoute), and `functions.invoke` adds the session's JWT the link needs. The region is the function's.
 * initData goes only to the function: never to a log, the address or storage.
 */
import { FunctionRegion } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type MiniAppSessionResult =
  | { status: 'linked'; tokenHash: string }
  | { status: 'same' }
  | { status: 'unlinked' | 'stale' | 'invalid' | 'replayed' | 'slow_down' | 'unavailable' | 'network' };

export type MiniAppLinkStatus =
  | 'linked' | 'linked_elsewhere' | 'replayed' | 'stale' | 'invalid' | 'signed_out' | 'slow_down' | 'unavailable' | 'network';

const SESSION_STATUSES = new Set(['unlinked', 'stale', 'invalid', 'replayed', 'slow_down', 'unavailable']);
const LINK_STATUSES = new Set(['linked', 'linked_elsewhere', 'replayed', 'stale', 'invalid', 'signed_out', 'slow_down', 'unavailable']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Invoked = { body: Record<string, unknown> } | { failure: 'network' | 'slow_down' | 'unavailable' };

async function invoke(action: 'session' | 'link', body: Record<string, unknown>): Promise<Invoked> {
  try {
    const { data, error } = await supabase.functions.invoke(`telegram/webapp/${action}`, { body, region: FunctionRegion.EuCentral1 });
    if (error) {
      const name = isRecord(error) ? String(error.name ?? '') : '';
      if (name === 'FunctionsFetchError') return { failure: 'network' };
      const context = isRecord(error) ? error.context : null;
      const status = context instanceof Response ? context.status : 0;
      return { failure: status === 429 ? 'slow_down' : 'unavailable' };
    }
    return isRecord(data) ? { body: data } : { failure: 'unavailable' };
  } catch {
    return { failure: 'network' };
  }
}

/** POST /telegram/webapp/session. `have`: the id of the account signed in here, when there is one. */
export async function miniAppSession(initData: string, have: string | null): Promise<MiniAppSessionResult> {
  const answer = await invoke('session', { init_data: initData, ...(have && UUID.test(have) ? { have } : {}) });
  if ('failure' in answer) return { status: answer.failure };
  const { status } = answer.body;
  if (status === 'linked' && answer.body.same === true) return { status: 'same' };
  if (status === 'linked' && typeof answer.body.token_hash === 'string' && answer.body.token_hash) return { status: 'linked', tokenHash: answer.body.token_hash };
  if (typeof status === 'string' && SESSION_STATUSES.has(status)) return { status: status as Exclude<MiniAppSessionResult['status'], 'linked' | 'same' | 'network'> };
  return { status: 'unavailable' };
}

/** POST /telegram/webapp/link with the signed-in student's JWT (the client adds it). `zone`: the browser's. */
export async function miniAppLink(initData: string, zone: string): Promise<MiniAppLinkStatus> {
  const answer = await invoke('link', { init_data: initData, tz: zone });
  if ('failure' in answer) return answer.failure;
  const { status } = answer.body;
  return typeof status === 'string' && LINK_STATUSES.has(status) ? (status as MiniAppLinkStatus) : 'unavailable';
}

/** The one-time sign-in from the function becomes the app's session (Supabase Auth verify, token_hash). */
export async function signInWithTelegram(tokenHash: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
    return !error && Boolean(data?.session);
  } catch {
    return false;
  }
}
