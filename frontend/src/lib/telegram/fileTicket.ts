/**
 * A file forwarded to the Telegram bot opens in the import (Telegram bot spec §4.7 F1, decision 27; package T9). The
 * bot's button «Открыть в Meldy» opens /exams/import?tg=<ticket>:
 *   1. telegram_file_take(p_ticket) as the signed-in user → a token for 60 seconds and the file's name, size and type
 *      (only for the account the ticket was made for; the ticket lives 30 minutes);
 *   2. GET <supabase>/functions/v1/telegram/file?t=<token> → the file's bytes, once (the ticket is spent with them);
 *   3. a File with its own name goes to the import's pick path (ImportPage's addFiles): what the file is — .doc, PDF,
 *      empty, too big for the site — the import says in its own words.
 * A stale or used ticket: «Ссылка из Telegram устарела — перешлите файл боту ещё раз.»
 *
 * The request to the function is a plain GET with no headers of ours (no preflight, no session token: the one-time
 * token is the only key), not cached, without cookies or the page's address.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { preferredRoute, PROXY_PREFIX } from '../supabaseRoute';

export const TG_PARAM = 'tg';
export const TICKET = /^F[0-9a-f]{32}$/;
const TOKEN = /^[0-9a-f]{64}$/;
/** The function's region (supabase/functions/_shared/bot/setup.ts FUNCTION_REGION): the webhook's warm workers. */
export const FUNCTION_REGION = 'eu-central-1';

export const TELEGRAM_FILE = {
  opening: 'Открываем файл из Telegram…',
  stale: 'Ссылка из Telegram устарела — перешлите файл боту ещё раз.',
  otherAccount: 'Этот файл ждёт в другом аккаунте Meldy — в том, к которому подключён Telegram.',
  failed: 'Файл из Telegram не открылся. Перешлите его боту ещё раз.',
  network: 'Нет связи с сервером. Проверьте интернет и откройте ссылку из Telegram снова.',
  /** The name of a file that came without one (the bot names it from its type when it can). */
  noName: 'Файл',
} as const;

export type TicketProblem = 'stale' | 'other_account' | 'failed' | 'network';

const LINES: Record<TicketProblem, string> = {
  stale: TELEGRAM_FILE.stale,
  other_account: TELEGRAM_FILE.otherAccount,
  failed: TELEGRAM_FILE.failed,
  network: TELEGRAM_FILE.network,
};

/** Why the file did not come; `message` is the line the page shows. */
export class TicketError extends Error {
  readonly code: TicketProblem;
  constructor(code: TicketProblem) {
    super(LINES[code]);
    this.name = 'TicketError';
    this.code = code;
  }
}

export interface TicketDeps {
  /** telegram_file_take through the app's Supabase client. */
  take: (ticket: string) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  /** https://<ref>.supabase.co/functions/v1, without a trailing slash. */
  functionsUrl: () => string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * The project's Edge Functions address: the build's VITE_SUPABASE_URL, else the client's own (as pages/Check.tsx).
 * A browser that reaches Supabase only through the site (lib/supabaseRoute.ts, route «proxy») takes the file through
 * /sb as well: backend/supabase_proxy.py passes this one GET.
 */
function functionsUrl(): string {
  if (preferredRoute() === 'proxy' && typeof window !== 'undefined') return `${window.location.origin}${PROXY_PREFIX}/functions/v1`;
  const env = import.meta.env as Record<string, string | undefined>;
  const fromClient = (supabase as unknown as { supabaseUrl?: unknown }).supabaseUrl;
  const url = (env.VITE_SUPABASE_URL || (typeof fromClient === 'string' ? fromClient : '') || '').replace(/\/+$/, '');
  return url ? `${url}/functions/v1` : '';
}

export const defaultDeps = (): TicketDeps => ({
  take: (ticket) => supabase.rpc('telegram_file_take', { p_ticket: ticket }),
  functionsUrl,
  fetch: (input, init) => fetch(input, init),
});

/** The ticket of ?tg=, when it has the bot's shape. */
export function ticketOf(search: URLSearchParams | string): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get(TG_PARAM);
  return value && TICKET.test(value) ? value : null;
}

const isNetwork = (error: { message?: string; code?: string }) =>
  !error.code && /failed to fetch|networkerror|load failed|network|fetch/i.test(error.message ?? '');

interface Taken {
  status: string;
  token: string | null;
  name: string | null;
  mime: string | null;
}

function takenOf(data: unknown): Taken {
  const r = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : null);
  return { status: typeof r.status === 'string' ? r.status : '', token: text(r.token), name: text(r.name), mime: text(r.mime) };
}

/** The ticket → the File, or a TicketError with the line to show. */
export async function fileFromTicket(ticket: string, deps: TicketDeps = defaultDeps()): Promise<File> {
  if (!TICKET.test(ticket)) throw new TicketError('stale');
  let answer: { data: unknown; error: { message?: string; code?: string } | null };
  try {
    answer = await deps.take(ticket);
  } catch {
    throw new TicketError('network');
  }
  if (answer.error) throw new TicketError(isNetwork(answer.error) ? 'network' : 'failed');
  const taken = takenOf(answer.data);
  if (taken.status === 'other_user') throw new TicketError('other_account');
  if (taken.status !== 'ok') throw new TicketError(taken.status === 'expired' || taken.status === 'used' || taken.status === 'invalid' ? 'stale' : 'failed');
  const base = deps.functionsUrl();
  if (!taken.token || !TOKEN.test(taken.token) || !base) throw new TicketError('failed');
  let response: Response;
  try {
    response = await deps.fetch(`${base}/telegram/file?t=${taken.token}&forceFunctionRegion=${FUNCTION_REGION}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new TicketError('network');
  }
  if (response.status === 410) throw new TicketError('stale');
  if (!response.ok) throw new TicketError('failed');
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    throw new TicketError('failed');
  }
  const type = taken.mime ?? (response.headers.get('content-type') || '').split(';')[0].trim();
  return new File([bytes], taken.name ?? TELEGRAM_FILE.noName, { type });
}

/** One take per ticket per page load: React's StrictMode runs the effect twice and both runs wait for the same file. */
const pending = new Map<string, Promise<File>>();

export interface TelegramFileState {
  /** «Открываем файл из Telegram…» while it comes, a problem's line after; null otherwise. */
  line: string | null;
  /** The line is a problem (role alert), not progress. */
  alert: boolean;
}

/**
 * The import page's hook: /exams/import?tg=<ticket> → the File handed once to `onFiles` (the page's addFiles). The
 * ticket leaves the address once the file came or was refused, so a reload does not try a spent ticket; after a
 * network failure it stays, and a reload tries again.
 */
export function useTelegramFile(onFiles: (files: File[]) => void, deps?: TicketDeps): TelegramFileState {
  const [search, setSearch] = useSearchParams();
  const raw = search.get(TG_PARAM);
  const [state, setState] = useState<TelegramFileState>({ line: null, alert: false });
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    if (raw === null) return undefined;
    let live = true;
    const forget = () =>
      setSearch(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete(TG_PARAM);
          return next;
        },
        { replace: true },
      );
    let job = pending.get(raw);
    if (!job) {
      job = fileFromTicket(raw, depsRef.current ?? defaultDeps());
      pending.set(raw, job);
    }
    setState({ line: TELEGRAM_FILE.opening, alert: false });
    job.then(
      (file) => {
        if (!live) return;
        pending.delete(raw);
        setState({ line: null, alert: false });
        onFilesRef.current([file]);
        forget();
      },
      (error: unknown) => {
        if (!live) return;
        pending.delete(raw);
        const problem = error instanceof TicketError ? error : new TicketError('failed');
        setState({ line: problem.message, alert: true });
        if (problem.code !== 'network') forget();
      },
    );
    return () => {
      live = false;
    };
    // The ticket alone starts a take; setSearch is stable, onFiles and deps are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  return state;
}
