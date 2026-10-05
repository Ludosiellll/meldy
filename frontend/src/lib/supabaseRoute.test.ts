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
