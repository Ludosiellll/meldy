import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSupabaseFetch,
  DIRECT_READ_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  ROUTE_STORAGE_KEY,
  ROUTE_TTL_MS,
} from './supabaseRoute';

const BASE = 'https://ref.supabase.co';
const SITE = 'https://meldy.example';
const REST = `${BASE}/rest/v1/materials?select=id`;
const VIA_SITE = `${SITE}/sb/rest/v1/materials?select=id`;

type Call = { url: string; init?: RequestInit };

/** Сеть: прямой адрес «работает» или «заблокирован» (отказ или тишина); сайт отвечает всегда. */
function network(direct: 'up' | 'refused' | 'silent') {
  const calls: Call[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    // Как настоящий fetch: уже отменённый запрос сразу отклоняется.
    if (init?.signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
    if (url.startsWith(SITE) || direct === 'up' || !url.startsWith(BASE)) return Promise.resolve(new Response('[]', { status: 200 }));
    if (direct === 'refused') return Promise.reject(new TypeError('Failed to fetch'));
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  });
  return { calls, fetchImpl };
}

let clock = 1_000_000;
const make = (fetchImpl: ReturnType<typeof network>['fetchImpl']) =>
  createSupabaseFetch({ supabaseUrl: BASE, anonKey: 'anon', fetchImpl, now: () => clock, origin: () => SITE });

beforeEach(() => {
  window.localStorage.clear();
  clock = 1_000_000;
});
afterEach(() => vi.useRealTimers());

describe('supabaseRoute', () => {
  it('goes direct after one probe when supabase.co answers, and remembers it', async () => {
    const net = network('up');
    const sbFetch = make(net.fetchImpl);
    await sbFetch(REST);
    await sbFetch(REST, { method: 'POST', body: '{}' });
    expect(net.calls.map(call => call.url)).toEqual([`${BASE}/auth/v1/health`, REST, REST]);
    expect((net.calls[0].init?.headers as Record<string, string>).apikey).toBe('anon');
    expect(JSON.parse(window.localStorage.getItem(ROUTE_STORAGE_KEY) ?? '{}')).toEqual({ route: 'direct', at: clock });
  });

  it('goes through the site when the probe is refused, for reads and writes alike', async () => {
    const net = network('refused');
    const sbFetch = make(net.fetchImpl);
    await sbFetch(REST);
    await sbFetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', body: '{}' });
    expect(net.calls.map(call => call.url)).toEqual([
      `${BASE}/auth/v1/health`,
      VIA_SITE,
      `${SITE}/sb/auth/v1/token?grant_type=password`,
    ]);
    expect(net.calls[2].init?.body).toBe('{}');
    expect(JSON.parse(window.localStorage.getItem(ROUTE_STORAGE_KEY) ?? '{}').route).toBe('proxy');
  });

  it('a silent supabase.co costs one probe of 4 seconds', async () => {
    vi.useFakeTimers();
    const net = network('silent');
    const sbFetch = make(net.fetchImpl);
    const pending = sbFetch(REST);
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    await pending;
    expect(net.calls.map(call => call.url)).toEqual([`${BASE}/auth/v1/health`, VIA_SITE]);
  });

  it('uses a remembered way without a probe, and probes again after 12 hours', async () => {
    window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ route: 'proxy', at: clock }));
    const net = network('up');
    await make(net.fetchImpl)(REST);
    expect(net.calls.map(call => call.url)).toEqual([VIA_SITE]);

    clock += ROUTE_TTL_MS + 1;
    const later = network('up');
    await make(later.fetchImpl)(REST);
    expect(later.calls.map(call => call.url)).toEqual([`${BASE}/auth/v1/health`, REST]);
  });

  it('a direct read that fails moves to the site and is repeated there; a write is not repeated', async () => {
    window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ route: 'direct', at: clock }));
    const net = network('refused');
    const sbFetch = make(net.fetchImpl);
    const read = await sbFetch(REST);
    expect(read.status).toBe(200);
    expect(net.calls.map(call => call.url)).toEqual([REST, VIA_SITE]);

    window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ route: 'direct', at: clock }));
    const writes = network('refused');
    const writeFetch = make(writes.fetchImpl);
    await expect(writeFetch(REST, { method: 'POST', body: '{}' })).rejects.toThrow('Failed to fetch');
    expect(writes.calls.map(call => call.url)).toEqual([REST]); // могла дойти до базы — не повторяем
    await writeFetch(REST, { method: 'POST', body: '{}' });
    expect(writes.calls.map(call => call.url)).toEqual([REST, VIA_SITE]); // следующая — уже через сайт
  });

  it('a direct read that hangs moves to the site after the read timeout', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ route: 'direct', at: clock }));
    const net = network('silent');
    const pending = make(net.fetchImpl)(REST);
    await vi.advanceTimersByTimeAsync(DIRECT_READ_TIMEOUT_MS);
    expect((await pending).status).toBe(200);
    expect(net.calls.map(call => call.url)).toEqual([REST, VIA_SITE]);
  });

  it('a request cancelled by the caller stays cancelled and keeps the way', async () => {
    window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ route: 'direct', at: clock }));
    const net = network('silent');
    const controller = new AbortController();
    const pending = make(net.fetchImpl)(REST, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(net.calls.map(call => call.url)).toEqual([REST]);
    expect(JSON.parse(window.localStorage.getItem(ROUTE_STORAGE_KEY) ?? '{}').route).toBe('direct');
  });

  it('leaves other addresses and Request objects alone', async () => {
    const net = network('refused');
    const sbFetch = make(net.fetchImpl);
    await sbFetch('https://elsewhere.example/x');
    await sbFetch(new Request(`${SITE}/api/health`));
    expect(net.calls.map(call => call.url)).toEqual(['https://elsewhere.example/x', expect.stringContaining('[object Request]')]);
  });
});

describe('supabaseRoute: a token «from the future» (PGRST303)', () => {
  const future = () => new Response(JSON.stringify({ code: 'PGRST303', message: 'JWT issued at future' }), { status: 401 });
  const expired = () => new Response(JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }), { status: 401 });

  function scripted(answers: Array<() => Response>) {
    const calls: string[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/auth/v1/health')) return Promise.resolve(new Response('{}', { status: 200 }));
      const next = answers.shift();
      return Promise.resolve(next ? next() : new Response('[]', { status: 200 }));
    });
    const waits: number[] = [];
    const sbFetch = createSupabaseFetch({
      supabaseUrl: BASE,
      anonKey: 'anon',
      fetchImpl,
      now: () => clock,
      origin: () => SITE,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    return { calls, waits, sbFetch };
  }

  it('sends the request again after a pause: right after sign-in the auth clock can run a second ahead', async () => {
    const net = scripted([future]);
    const response = await net.sbFetch(REST);
    expect(response.status).toBe(200);
    expect(net.calls.filter((url) => url === REST)).toHaveLength(2);
    expect(net.waits).toEqual([1000]);
  });

  it('a write refused for the token is sent again too: PostgREST did not run it', async () => {
    const net = scripted([future]);
    const response = await net.sbFetch(`${BASE}/rest/v1/rpc/ai_quota_status`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(net.calls.filter((url) => url.endsWith('/rpc/ai_quota_status'))).toHaveLength(2);
  });

  it('gives up after two pauses and returns the last refusal', async () => {
    const net = scripted([future, future, future, future]);
    const response = await net.sbFetch(REST);
    expect(response.status).toBe(401);
    expect(net.calls.filter((url) => url === REST)).toHaveLength(3);
    expect(net.waits).toEqual([1000, 2000]);
  });

  it('leaves any other 401 as it is (an expired token is the auth client’s business)', async () => {
    const net = scripted([expired]);
    const response = await net.sbFetch(REST);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'PGRST301', message: 'JWT expired' });
    expect(net.calls.filter((url) => url === REST)).toHaveLength(1);
    expect(net.waits).toEqual([]);
  });
});

describe('supabaseRoute: a request cut off by leaving the page (live check of release 47.2)', () => {
  /** A request in flight that the test cuts off, as the browser does when the page goes away. */
  function inFlight() {
    let cut: (error: unknown) => void = () => undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((_, reject) => (cut = reject)));
    return { fetchImpl, cut: (error: unknown) => cut(error) };
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const viaSite = () => window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ route: 'proxy', at: clock }));
  const makeOn = (page: EventTarget, fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
    createSupabaseFetch({ supabaseUrl: BASE, anonKey: 'anon', fetchImpl, now: () => clock, origin: () => SITE, page });

  it('after pagehide the failure is not answered: nobody is left to hear it; a page back from the cache gets it as it was', async () => {
    viaSite();
    const page = new EventTarget();
    const net = inFlight();
    const sbFetch = makeOn(page, net.fetchImpl);
    let settled: unknown = 'pending';
    sbFetch(`${BASE}/auth/v1/user`).then(
      (value) => (settled = value),
      (error) => (settled = error),
    );
    await tick();
    expect(net.fetchImpl).toHaveBeenCalledWith(`${SITE}/sb/auth/v1/user`, undefined);
    page.dispatchEvent(new Event('pagehide'));
    const failure = new TypeError('Failed to fetch');
    net.cut(failure);
    await tick();
    expect(settled).toBe('pending');
    page.dispatchEvent(new Event('pageshow'));
    await tick();
    expect(settled).toBe(failure);
  });

  it('a failure while the page stays is the caller’s at once, as before (a real one is not hidden)', async () => {
    viaSite();
    const page = new EventTarget();
    const net = inFlight();
    const sbFetch = makeOn(page, net.fetchImpl);
    const asked = sbFetch(REST);
    await tick();
    const failure = new TypeError('Failed to fetch');
    net.cut(failure);
    await expect(asked).rejects.toBe(failure);
    // Back from the cache: what fails then fails at once again.
    page.dispatchEvent(new Event('pagehide'));
    page.dispatchEvent(new Event('pageshow'));
    const again = sbFetch(REST);
    await tick();
    net.cut(failure);
    await expect(again).rejects.toBe(failure);
  });

  it('supabase-js’s auth client logs nothing for a request cut off by leaving; a real failure it still logs', async () => {
    viaSite();
    const { createClient } = await import('@supabase/supabase-js');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const page = new EventTarget();
    const net = inFlight();
    const client = createClient(BASE, 'anon', {
      global: { fetch: makeOn(page, net.fetchImpl) },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbg';

    // The page goes away while auth/v1/user is out (getProfile's getUser in the live check).
    void client.auth.getUser(jwt);
    await vi.waitFor(() => expect(net.fetchImpl).toHaveBeenCalledTimes(1));
    page.dispatchEvent(new Event('pagehide'));
    net.cut(new TypeError('Failed to fetch'));
    await tick();
    await tick();
    expect(errors).not.toHaveBeenCalled();

    // The page is back; a request that fails now is a real failure, and the auth client says so as it always does.
    page.dispatchEvent(new Event('pageshow'));
    await tick();
    errors.mockClear();
    const answer = client.auth.getUser(jwt);
    await vi.waitFor(() => expect(net.fetchImpl).toHaveBeenCalledTimes(2));
    net.cut(new TypeError('Failed to fetch'));
    const { error } = await answer;
    expect(error?.name).toBe('AuthRetryableFetchError');
    expect(errors).toHaveBeenCalled();
  });
});
