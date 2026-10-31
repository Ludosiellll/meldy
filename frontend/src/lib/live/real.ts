/**
 * The real live client (docs/live/CONTRACT.md §6, §8): PostgREST RPCs `live_*` and the Realtime hint channel. The SQL is
 * W1's; this file follows the contract and is switched on by the flag in api.ts. Errors become LiveError by the body's
 * `code` (never the HTTP status alone: P0002 comes as 404 by the PGRST override, our ML0xx as 400/409/429).
 */
import { livePictureUrl } from '../../api/itemPictures';
import { supabase } from '../supabase';
import { preferredRoute } from '../supabaseRoute';
import {
  LiveError,
  type AnswerAck,
  type AnswerInput,
  type CreateResult,
  type GameSource,
  type GameState,
  type Hint,
  type HostState,
  type JoinResult,
  type LiveApi,
  type LiveErrorCode,
  type Look,
  type PinResult,
  type PlayerState,
  type PracticeResult,
  type Review,
  type Settings,
  type TgPostResult,
  type Unchanged,
  type Uuid,
  SERVER_CODES as CODES,
} from './types';

/**
 * ML005's wait in seconds. supabase-js does not hand the response's headers over, so Retry-After itself cannot be read
 * here: the seconds are taken from the error's `hint` when the server puts them there ("42"), else unknown.
 */
function retryAfter(rec: Record<string, unknown>): number | null {
  const m = typeof rec.hint === 'string' ? /\d{1,5}/.exec(rec.hint) : null;
  return m ? Number(m[0]) : null;
}

export function liveError(error: unknown, status: number): LiveError {
  const rec = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const code = typeof rec.code === 'string' ? rec.code : '';
  const detail = typeof rec.details === 'string' && rec.details ? rec.details : null;
  if (CODES.has(code)) return new LiveError(code as LiveErrorCode, detail, status, code === 'ML005' ? retryAfter(rec) : null);
  if (status === 401 || /^PGRST30\d$/.test(code)) return new LiveError('28000', detail, status);
  return new LiveError('unknown', code || detail, status);
}

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

/**
 * The PIN step before 20261025090000_live_pin.sql is applied (or after its rollback), when PostgREST does not know
 * live_pin (PGRST202): the old check, live_join with the empty name, read as the database reads it — a join is the
 * identity taken back, ML006 (the name) a game to join, any other refusal as it came. A network or unknown failure throws.
 */
async function pinByJoin(pin: string, token: string): Promise<PinResult> {
  try {
    return { status: 'joined', ...(await rpc<JoinResult>('live_join', { p_pin: pin, p_name: '', p_token: token, p_look: null })) };
  } catch (error) {
    if (!(error instanceof LiveError) || error.code === 'network' || error.code === 'unknown') throw error;
    if (error.code === 'ML006') return { status: 'open', mode: null };
    return { status: 'refused', code: error.code, detail: error.detail, http: error.status, retry_after: error.retryAfterS };
  }
}

function unchangedOr<T extends { rev: number }>(raw: T | { rev: number; now: string }): T | Unchanged {
  return 'state' in raw ? (raw as T) : { rev: raw.rev, now: (raw as { now: string }).now, unchanged: true };
}

export function createRealApi(): LiveApi {
  return {
    kind: 'real',
    create: (source: GameSource, settings: Settings) => rpc<CreateResult>('live_create', { p_source: source, p_settings: settings }),
    hostState: async (game: Uuid, hostToken: string, sinceRev?: number) =>
      unchangedOr(await rpc<HostState>('live_host_state', { p_game: game, p_host_token: hostToken, p_since_rev: sinceRev ?? null })),
    next: (game: Uuid, hostToken: string, expect: GameState) => rpc<HostState>('live_next', { p_game: game, p_host_token: hostToken, p_expect: expect }),
    kick: async (game: Uuid, hostToken: string, player: Uuid) => {
      await rpc('live_kick', { p_game: game, p_host_token: hostToken, p_player: player });
    },
    end: async (game: Uuid, hostToken: string) => {
      await rpc('live_end', { p_game: game, p_host_token: hostToken });
    },
    tgPost: (game: Uuid, chatId: number) => rpc<TgPostResult>('live_tg_post', { p_game: game, p_chat_id: chatId }),
    pin: async (pin: string, token: string) => {
      try {
        return await rpc<PinResult>('live_pin', { p_pin: pin, p_token: token });
      } catch (error) {
        if (error instanceof LiveError && error.code === 'unknown' && error.detail === 'PGRST202') return pinByJoin(pin, token);
        throw error;
      }
    },
    join: (pin: string, name: string, token: string, look: Look | null) => rpc<JoinResult>('live_join', { p_pin: pin, p_name: name, p_token: token, p_look: look }),
    setLook: async (game: Uuid, token: string, look: Look) => (await rpc<{ look: Look }>('live_set_look', { p_game: game, p_token: token, p_look: look })).look,
    answer: (game: Uuid, token: string, qi: number, choice: number) => rpc<AnswerAck>('live_answer', { p_game: game, p_token: token, p_qi: qi, p_choice: choice }),
    submit: (game: Uuid, token: string, qi: number, answer: AnswerInput) => rpc<AnswerAck>('live_submit', { p_game: game, p_token: token, p_qi: qi, p_answer: answer }),
    state: async (game: Uuid, token: string, sinceRev?: number) =>
      unchangedOr(await rpc<PlayerState>('live_state', { p_game: game, p_token: token, p_since_rev: sinceRev ?? null })),
    review: (game: Uuid, token: string) => rpc<Review>('live_review', { p_game: game, p_token: token }),
    practice: (game: Uuid, token: string) => rpc<PracticeResult>('live_practice', { p_game: game, p_token: token }),
    picture: (game: Uuid, token: string, path: string) => livePictureUrl(path, game, token),
    subscribe(topic: string, onHint: (hint: Hint) => void, onLink?: (connected: boolean) => void) {
      // Through the site's /sb proxy there is no WebSocket: say so at once, the caller polls every second.
      if (preferredRoute() === 'proxy') {
        onLink?.(false);
        return () => {};
      }
      const channel = supabase
        .channel(`live:${topic}`, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'hint' }, (message: { payload?: unknown }) => {
          const p = message.payload as Partial<Hint> | undefined;
          if (p && typeof p.rev === 'number' && typeof p.state === 'string') onHint({ rev: p.rev, state: p.state as GameState });
        })
        .subscribe((status: string) => onLink?.(status === 'SUBSCRIBED'));
      return () => {
        void supabase.removeChannel(channel);
      };
    },
  };
}
