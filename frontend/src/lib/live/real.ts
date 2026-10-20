/**
 * The real live client (docs/live/CONTRACT.md §6, §8): PostgREST RPCs `live_*` and the Realtime hint channel. The SQL is
 * W1's; this file follows the contract and is switched on by the flag in api.ts. Errors become LiveError by the body's
 * `code` (never the HTTP status alone: P0002 comes as 404 by the PGRST override, our ML0xx as 400/409/429).
 */
import { supabase } from '../supabase';
import { preferredRoute } from '../supabaseRoute';
import {
  LiveError,
  type AnswerAck,
  type CreateResult,
  type GameSource,
  type GameState,
  type Hint,
  type HostState,
  type JoinResult,
  type LiveApi,
  type LiveErrorCode,
  type Look,
  type PlayerState,
  type Review,
  type Settings,
  type Unchanged,
  type Uuid,
} from './types';

const CODES: ReadonlySet<string> = new Set(['28000', '42501', 'P0002', '22023', 'ML001', 'ML002', 'ML003', 'ML004', 'ML005', 'ML006', 'ML007', 'ML008', 'ML009', 'ML011']);

export function liveError(error: unknown, status: number): LiveError {
  const rec = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const code = typeof rec.code === 'string' ? rec.code : '';
  const detail = typeof rec.details === 'string' && rec.details ? rec.details : null;
  if (CODES.has(code)) return new LiveError(code as LiveErrorCode, detail, status);
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
    join: (pin: string, name: string, token: string, look: Look | null) => rpc<JoinResult>('live_join', { p_pin: pin, p_name: name, p_token: token, p_look: look }),
    setLook: async (game: Uuid, token: string, look: Look) => (await rpc<{ look: Look }>('live_set_look', { p_game: game, p_token: token, p_look: look })).look,
    answer: (game: Uuid, token: string, qi: number, choice: number) => rpc<AnswerAck>('live_answer', { p_game: game, p_token: token, p_qi: qi, p_choice: choice }),
    state: async (game: Uuid, token: string, sinceRev?: number) =>
      unchangedOr(await rpc<PlayerState>('live_state', { p_game: game, p_token: token, p_since_rev: sinceRev ?? null })),
    review: (game: Uuid, token: string) => rpc<Review>('live_review', { p_game: game, p_token: token }),
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
