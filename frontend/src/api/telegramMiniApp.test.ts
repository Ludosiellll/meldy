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

import * as client from './telegramMiniApp';
import { miniAppSession, signInWithTelegram } from './telegramMiniApp';

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

  it('another account signed in here: the sign-in and the linked account\'s e-mail, for the page to ask', async () => {
    answer({ status: 'linked', token_hash: TOKEN, email: ' other@example.com ' });
    expect(await miniAppSession(INIT, ME)).toEqual({ status: 'other', tokenHash: TOKEN, email: 'other@example.com' });
    // Without an account here there is nothing to ask; a broken e-mail is no e-mail.
    expect(await miniAppSession(INIT, null)).toEqual({ status: 'linked', tokenHash: TOKEN });
    answer({ status: 'linked', token_hash: TOKEN, email: 'not an e-mail' });
    expect(await miniAppSession(INIT, ME)).toEqual({ status: 'linked', tokenHash: TOKEN });
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

describe('no linking from the Mini App', () => {
  it('the client has no way to link a Telegram (security review 2026-10-11)', () => {
    expect(Object.keys(client).sort()).toEqual(['miniAppSession', 'signInWithTelegram']);
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
