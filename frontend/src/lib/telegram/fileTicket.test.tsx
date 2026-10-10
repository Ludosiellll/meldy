import { StrictMode, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sb = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: sb.rpc, supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co' } }));

import {
  defaultDeps, fileFromTicket, FUNCTION_REGION, TELEGRAM_FILE, TicketError, ticketOf, useTelegramFile, type TicketDeps,
} from './fileTicket';
import { ROUTE_STORAGE_KEY } from '../supabaseRoute';

// An invented file of the spec's exam «Осенняя сессия»: a made-up ticket, token and bytes.
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const NAME = 'Банк_БД_2026.docx';
const TOKEN = 'a1'.repeat(32);
const BASE = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1';
const BYTES = new Uint8Array([80, 75, 3, 4, 20, 0, 6, 0, 8, 0, 0, 0, 33, 0]);
let seq = 0;
/** A fresh ticket per test: the hook keeps one take per ticket for the page's life. */
const ticket = () => `F${(0x10000000 + (seq += 1)).toString(16).padStart(8, '0')}${'0123456789abcdef'.repeat(2).slice(0, 24)}`;

type Answer = { data: unknown; error: { message?: string; code?: string } | null };

function depsOf(answer: Answer | Error, response: Response | Error = new Response(BYTES, { status: 200, headers: { 'Content-Type': DOCX } })) {
  const take = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const deps: TicketDeps = { take, fetch, functionsUrl: () => BASE };
  return { deps, take, fetch };
}
const ok = (over: Record<string, unknown> = {}): Answer => ({
  data: { status: 'ok', token: TOKEN, expires_at: '2026-10-16T17:01:00Z', name: NAME, size: BYTES.length, mime: DOCX, ...over },
  error: null,
});

async function problemOf(promise: Promise<unknown>): Promise<TicketError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(TicketError);
  return error as TicketError;
}

describe('fileFromTicket: the ticket → telegram_file_take → GET /telegram/file → a File', () => {
  it('takes the ticket, fetches the file once and makes a File with its own name and type', async () => {
    const t = ticket();
    const { deps, take, fetch } = depsOf(ok());
    const file = await fileFromTicket(t, deps);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe(NAME);
    expect(file.type).toBe(DOCX);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(BYTES);
    expect(take).toHaveBeenCalledWith(t);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${BASE}/telegram/file?t=${TOKEN}&forceFunctionRegion=${FUNCTION_REGION}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    expect(FUNCTION_REGION).toBe('eu-central-1');
  });

  it('a stale, used or unknown ticket: «Ссылка из Telegram устарела — перешлите файл боту ещё раз.»', async () => {
    expect(TELEGRAM_FILE.stale).toBe('Ссылка из Telegram устарела — перешлите файл боту ещё раз.');
    for (const status of ['expired', 'used', 'invalid']) {
      const { deps, fetch } = depsOf({ data: { status }, error: null });
      const problem = await problemOf(fileFromTicket(ticket(), deps));
      expect(problem.code).toBe('stale');
      expect(problem.message).toBe(TELEGRAM_FILE.stale);
      expect(fetch).not.toHaveBeenCalled();
    }
    // The function says the token went stale between the take and the fetch (410): the same line.
    const late = depsOf(ok(), new Response(JSON.stringify({ error: 'expired' }), { status: 410 }));
    expect((await problemOf(fileFromTicket(ticket(), late.deps))).message).toBe(TELEGRAM_FILE.stale);
    // Not a ticket of the bot at all: the same line, and nothing is asked.
    const garbage = depsOf(ok());
    expect((await problemOf(fileFromTicket('F123', garbage.deps))).code).toBe('stale');
    expect(garbage.take).not.toHaveBeenCalled();
  });

  it('another account’s ticket says which account it waits in', async () => {
    const { deps } = depsOf({ data: { status: 'other_user' }, error: null });
    const problem = await problemOf(fileFromTicket(ticket(), deps));
    expect(problem.code).toBe('other_account');
    expect(problem.message).toBe(TELEGRAM_FILE.otherAccount);
  });

  it('no network: the take or the fetch never answered', async () => {
    const thrown = depsOf(new TypeError('Failed to fetch'));
    expect((await problemOf(fileFromTicket(ticket(), thrown.deps))).code).toBe('network');
    const reported = depsOf({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
    expect((await problemOf(fileFromTicket(ticket(), reported.deps))).code).toBe('network');
    const fetchFailed = depsOf(ok(), new TypeError('Failed to fetch'));
    const problem = await problemOf(fileFromTicket(ticket(), fetchFailed.deps));
    expect(problem.code).toBe('network');
    expect(problem.message).toBe(TELEGRAM_FILE.network);
  });

  it('anything else fails with «Файл из Telegram не открылся…»: a database error, a bad answer, a server error', async () => {
    const cases: Array<ReturnType<typeof depsOf>> = [
      depsOf({ data: null, error: { message: 'not signed in', code: '28000' } }),
      depsOf({ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } }),
      depsOf({ data: { status: 'what' }, error: null }),
      depsOf(ok({ token: 'short' })),
      depsOf(ok(), new Response(JSON.stringify({ error: 'telegram' }), { status: 502 })),
      depsOf(ok(), new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })),
      depsOf(ok(), new Response(JSON.stringify({ error: 'origin' }), { status: 403 })),
    ];
    for (const { deps } of cases) {
      const problem = await problemOf(fileFromTicket(ticket(), deps));
      expect(problem.code).toBe('failed');
      expect(problem.message).toBe(TELEGRAM_FILE.failed);
    }
    const badToken = depsOf(ok({ token: 'G'.repeat(64) }));
    await problemOf(fileFromTicket(ticket(), badToken.deps));
    expect(badToken.fetch).not.toHaveBeenCalled();
  });

  it('a file without a name or type: «Файл» and the response’s type', async () => {
    const { deps } = depsOf(ok({ name: null, mime: null }), new Response(BYTES, { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    const file = await fileFromTicket(ticket(), deps);
    expect(file.name).toBe('Файл');
    expect(file.type).toBe('text/plain');
  });

  it('the default way: the app’s client calls telegram_file_take; the function at <project>/functions/v1', async () => {
    sb.rpc.mockReset().mockResolvedValue({ data: { status: 'used' }, error: null });
    const deps = defaultDeps();
    const t = ticket();
    expect(await deps.take(t)).toEqual({ data: { status: 'used' }, error: null });
    expect(sb.rpc).toHaveBeenCalledWith('telegram_file_take', { p_ticket: t });
    expect(deps.functionsUrl()).toMatch(/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1$/);
  });

  it('a browser on the site route (lib/supabaseRoute.ts «proxy») takes the file through /sb, the one function it passes', () => {
    window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ route: 'proxy', at: Date.now() }));
    try {
      expect(defaultDeps().functionsUrl()).toBe(`${window.location.origin}/sb/functions/v1`);
    } finally {
      window.localStorage.removeItem(ROUTE_STORAGE_KEY);
    }
    expect(defaultDeps().functionsUrl()).toMatch(/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1$/);
  });

  it('ticketOf reads ?tg= of the bot’s shape only', () => {
    const t = ticket();
    expect(ticketOf(`?tg=${t}`)).toBe(t);
    expect(ticketOf(new URLSearchParams({ tg: t, from: 'c:x' }))).toBe(t);
    for (const bad of ['', '?tg=', '?tg=F123', `?tg=${t.toUpperCase()}`, `?tg=${t}0`, '?from=c:x']) expect(ticketOf(bad)).toBeNull();
  });

  it('the lines keep the site’s words: none of the banned ones, no «!»', () => {
    const banned = ['контейнер', 'тест', 'повторени', 'на проверку', 'спорн', 'пробн', 'засчитан', 'сгорел', 'преподавател', 'колледж',
      'аккредитац', 'правильный ответ'];
    for (const line of Object.values(TELEGRAM_FILE)) {
      expect(banned.filter((word) => line.toLowerCase().includes(word))).toEqual([]);
      expect(line).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
  });
});

// ─────────────────────────────────────────── the hook ───────────────────────────────────────────

let where = '';
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}${location.hash}`;
  return null;
}
const wrapperAt = (path: string, strict = false) =>
  function Wrapper({ children }: { children: ReactNode }) {
    const tree = (
      <MemoryRouter initialEntries={[path]}>
        {children}
        <Where />
      </MemoryRouter>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };

describe('useTelegramFile: ?tg= on the import page', () => {
  beforeEach(() => {
    where = '';
  });

  it('hands the File to the pick path once, even under StrictMode, and takes the ticket out of the address', async () => {
    const t = ticket();
    const { deps, take, fetch } = depsOf(ok());
    const onFiles = vi.fn();
    const { result } = renderHook(() => useTelegramFile(onFiles, deps), { wrapper: wrapperAt(`/exams/import?from=c:abc&tg=${t}`, true) });
    expect(result.current).toEqual({ line: TELEGRAM_FILE.opening, alert: false });
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    const [files] = onFiles.mock.calls[0] as [File[]];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe(NAME);
    expect(take).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(where).toBe('/exams/import?from=c%3Aabc'));
    expect(result.current).toEqual({ line: null, alert: false });
    // Nothing more happens afterwards.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it('a stale ticket shows its line as an alert and leaves the address; no file', async () => {
    const t = ticket();
    const { deps } = depsOf({ data: { status: 'used' }, error: null });
    const onFiles = vi.fn();
    const { result } = renderHook(() => useTelegramFile(onFiles, deps), { wrapper: wrapperAt(`/exams/import?tg=${t}`) });
    await waitFor(() => expect(result.current).toEqual({ line: TELEGRAM_FILE.stale, alert: true }));
    await waitFor(() => expect(where).toBe('/exams/import'));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('a network failure keeps the ticket in the address (a reload tries again)', async () => {
    const t = ticket();
    const { deps } = depsOf(new TypeError('Failed to fetch'));
    const onFiles = vi.fn();
    const { result } = renderHook(() => useTelegramFile(onFiles, deps), { wrapper: wrapperAt(`/exams/import?tg=${t}`) });
    await waitFor(() => expect(result.current).toEqual({ line: TELEGRAM_FILE.network, alert: true }));
    expect(where).toBe(`/exams/import?tg=${t}`);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('a malformed ?tg= is a stale link; no ?tg= does nothing', async () => {
    const malformed = depsOf(ok());
    const first = renderHook(() => useTelegramFile(vi.fn(), malformed.deps), { wrapper: wrapperAt('/exams/import?tg=hello') });
    await waitFor(() => expect(first.result.current).toEqual({ line: TELEGRAM_FILE.stale, alert: true }));
    expect(malformed.take).not.toHaveBeenCalled();
    first.unmount();
    const none = depsOf(ok());
    const second = renderHook(() => useTelegramFile(vi.fn(), none.deps), { wrapper: wrapperAt('/exams/import') });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(second.result.current).toEqual({ line: null, alert: false });
    expect(none.take).not.toHaveBeenCalled();
  });
});
