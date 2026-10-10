import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionRegion, FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
    auth: { verifyOtp: (...args: unknown[]) => mocks.verifyOtp(...args) },
  },
}));

import { miniAppLink, miniAppSession, signInWithTelegram } from './telegramMiniApp';

const INIT = 'query_id=AAH&user=%7B%22id%22%3A4242%7D&auth_date=1760100000&hash=' + 'c'.repeat(64);
const ME = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const TOKEN = 'pkce_6b1c7d2e9f0a4b3c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a';

const answer = (data: unknown) => mocks.invoke.mockResolvedValue({ data, error: null });
const failure = (error: unknown) => mocks.invoke.mockResolvedValue({ data: null, error });

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.verifyOtp.mockReset();
});

describe('POST /telegram/webapp/session', () => {
  it('sends the launch and the account signed in here, to the function\'s region', async () => {
    answer({ status: 'unlinked' });
    expect(await miniAppSession(INIT, ME)).toEqual({ status: 'unlinked' });
    expect(mocks.invoke).toHaveBeenCalledWith('telegram/webapp/session', { body: { init_data: INIT, have: ME }, region: FunctionRegion.EuCentral1 });
    await miniAppSession(INIT, null);
    expect(mocks.invoke).toHaveBeenLastCalledWith('telegram/webapp/session', { body: { init_data: INIT }, region: FunctionRegion.EuCentral1 });
    // Only an account id goes as `have`.
    await miniAppSession(INIT, 'not-an-id');
    expect(mocks.invoke.mock.lastCall?.[1]).toEqual({ body: { init_data: INIT }, region: FunctionRegion.EuCentral1 });
  });

  it('reads a one-time sign-in, the same account, and every other answer', async () => {
    answer({ status: 'linked', token_hash: TOKEN });
    expect(await miniAppSession(INIT, null)).toEqual({ status: 'linked', tokenHash: TOKEN });
    answer({ status: 'linked', same: true });
    expect(await miniAppSession(INIT, ME)).toEqual({ status: 'same' });
    for (const status of ['unlinked', 'stale', 'invalid', 'replayed', 'slow_down', 'unavailable'] as const) {
      answer({ status });
      expect(await miniAppSession(INIT, null)).toEqual({ status });
    }
  });

  it('anything else is «unavailable»: a linked answer without a sign-in, an unknown status, no body', async () => {
    for (const data of [{ status: 'linked' }, { status: 'linked', token_hash: '' }, { status: 'opened' }, null, 'linked', [1]]) {
      answer(data);
      expect(await miniAppSession(INIT, null), JSON.stringify(data)).toEqual({ status: 'unavailable' });
    }
  });

  it('no answer is «network», 429 is «slow_down», any other failure «unavailable»', async () => {
    failure(new FunctionsFetchError(new TypeError('Failed to fetch')));
    expect(await miniAppSession(INIT, null)).toEqual({ status: 'network' });
    failure(new FunctionsHttpError(new Response('{"error":"slow_down"}', { status: 429 })));
    expect(await miniAppSession(INIT, null)).toEqual({ status: 'slow_down' });
    failure(new FunctionsHttpError(new Response('{"error":"unavailable"}', { status: 503 })));
    expect(await miniAppSession(INIT, null)).toEqual({ status: 'unavailable' });
    failure(new FunctionsRelayError(new Response('', { status: 502 })));
    expect(await miniAppSession(INIT, null)).toEqual({ status: 'unavailable' });
    mocks.invoke.mockRejectedValue(new Error('boom'));
    expect(await miniAppSession(INIT, null)).toEqual({ status: 'network' });
  });
});

describe('POST /telegram/webapp/link', () => {
  it('sends the launch and the browser\'s time zone; the client adds the session\'s JWT', async () => {
    answer({ status: 'linked' });
    expect(await miniAppLink(INIT, 'Europe/Minsk')).toBe('linked');
    expect(mocks.invoke).toHaveBeenCalledWith('telegram/webapp/link', { body: { init_data: INIT, tz: 'Europe/Minsk' }, region: FunctionRegion.EuCentral1 });
  });

  it('reads every status it knows and nothing else', async () => {
    for (const status of ['linked', 'linked_elsewhere', 'replayed', 'stale', 'invalid', 'signed_out', 'slow_down', 'unavailable'] as const) {
      answer({ status });
      expect(await miniAppLink(INIT, 'UTC')).toBe(status);
    }
    answer({ status: 'unlinked' });
    expect(await miniAppLink(INIT, 'UTC')).toBe('unavailable');
    failure(new FunctionsHttpError(new Response('{}', { status: 429 })));
    expect(await miniAppLink(INIT, 'UTC')).toBe('slow_down');
    failure(new FunctionsFetchError(new TypeError('offline')));
    expect(await miniAppLink(INIT, 'UTC')).toBe('network');
  });
});

describe('the one-time sign-in', () => {
  it('becomes the app\'s session through verifyOtp (magiclink, token_hash)', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { session: { access_token: 'jwt' }, user: { id: ME } }, error: null });
    expect(await signInWithTelegram(TOKEN)).toBe(true);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: 'magiclink', token_hash: TOKEN });
  });

  it('is false when Auth refuses it or does not answer', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: { name: 'AuthApiError', status: 403, message: 'Email link is invalid or has expired' } });
    expect(await signInWithTelegram(TOKEN)).toBe(false);
    mocks.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: null });
    expect(await signInWithTelegram(TOKEN)).toBe(false);
    mocks.verifyOtp.mockRejectedValue(new Error('offline'));
    expect(await signInWithTelegram(TOKEN)).toBe(false);
  });
});
