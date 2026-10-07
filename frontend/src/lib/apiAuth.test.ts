import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token-a' } } }) } },
}));

import { installApiAuth, resetApiAuthForTests } from './apiAuth';
import { AI_LIMIT_EVENT, resetAILimitReportsForTests, type AILimitInfo } from '../api/limits';

const originalFetch = window.fetch;
let seen: Array<{ url: string; auth: string | null }> = [];
let limits: AILimitInfo[] = [];
const onLimit = (event: Event) => limits.push((event as CustomEvent<AILimitInfo>).detail);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function install(answer: (url: string) => Response) {
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    seen.push({ url, auth: new Headers(init?.headers).get('Authorization') });
    return answer(url);
  }) as typeof window.fetch;
  resetApiAuthForTests();
  installApiAuth();
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  seen = [];
  limits = [];
  resetAILimitReportsForTests();
  window.addEventListener(AI_LIMIT_EVENT, onLimit);
});

afterEach(() => {
  window.removeEventListener(AI_LIMIT_EVENT, onLimit);
  window.fetch = originalFetch;
  resetApiAuthForTests();
});

describe('installApiAuth', () => {
  it('adds the session token to backend calls only', async () => {
    install(() => json(200, { ok: true }));
    await window.fetch('/api/chat', { method: 'POST' });
    await window.fetch('/api/health');
    await window.fetch('/api/try/evaluate', { method: 'POST' });
    await window.fetch('https://cdn.example.com/x.js');
    expect(seen).toEqual([
      { url: '/api/chat', auth: 'Bearer token-a' },
      { url: '/api/health', auth: null },
      // The /try example's AI check is open without an account: no token, no wait for the Supabase client.
      { url: '/api/try/evaluate', auth: null },
      { url: 'https://cdn.example.com/x.js', auth: null },
    ]);
  });

  it('a 429 ai_limit opens the limit dialog and the caller still reads the body', async () => {
    const body = { detail: 'Дневной лимит ИИ на сегодня исчерпан.', code: 'ai_limit', used: 100, limit: 100, units: 4,
                   resets_at: '2026-10-05T00:00:00Z', pro: false };
    install(() => json(429, body));
    const response = await window.fetch('/api/oral/evaluate', { method: 'POST' });
    await expect(response.json()).resolves.toEqual(body);
    await settle();
    expect(limits).toEqual([{ used: 100, limit: 100, units: 4, resetsAt: new Date('2026-10-05T00:00:00Z'), pro: false }]);
  });

  it('other refusals are not the daily limit', async () => {
    install((url) =>
      url === '/api/chat'
        ? json(429, { detail: 'Слишком много запросов. Подождите минуту и повторите.' })
        : url === '/api/quick-prep'
          ? json(429, { detail: 'Сервис ИИ сейчас занят.', code: 'ai_busy' })
          : new Response('<html>busy</html>', { status: 429, headers: { 'Content-Type': 'text/html' } }),
    );
    await window.fetch('/api/chat');
    await window.fetch('/api/quick-prep');
    await window.fetch('/api/podcast/generate');
    await settle();
    expect(limits).toEqual([]);
  });
});
