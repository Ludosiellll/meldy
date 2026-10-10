import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

const client = vi.hoisted(() => ({
  getSession: vi.fn(),
  listeners: [] as Array<(event: string, session: unknown) => void>,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: client.getSession,
      onAuthStateChange: (listener: Listener) => {
        client.listeners.push(listener as (event: string, session: unknown) => void);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: vi.fn(),
    },
  },
}));

import { AuthProvider, useAuth } from './AuthContext';

const KEY = 'sb-daunnytubqbzafjnpfnw-auth-token';
const stored = {
  access_token: 'expired-access',
  refresh_token: 'refresh',
  expires_at: 1,
  token_type: 'bearer',
  user: { id: 'user-1', email: 'student@example.com' },
};

function Who() {
  const { user, loading } = useAuth();
  return <p>{loading ? 'loading' : user ? `user:${user.id}` : 'signed out'}</p>;
}

async function mount() {
  render(
    <AuthProvider>
      <Who />
    </AuthProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard');
  client.listeners.length = 0;
  client.getSession.mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('AuthProvider: a session kept for lack of network', () => {
  it('keeps the student signed in when the client reports no session but still keeps one (refresh failed offline)', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    client.getSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
    await mount();
    expect(screen.getByText('user:user-1')).toBeTruthy();
    await act(async () => client.listeners.forEach((listen) => listen('INITIAL_SESSION', null)));
    expect(screen.getByText('user:user-1')).toBeTruthy();
  });

  it('signs out when nothing is kept here (the client removed the session: an expired or revoked sign-in)', async () => {
    client.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await mount();
    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('never falls back on a sign-out', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    client.getSession.mockResolvedValue({ data: { session: stored }, error: null });
    await mount();
    expect(screen.getByText('user:user-1')).toBeTruthy();
    await act(async () => client.listeners.forEach((listen) => listen('SIGNED_OUT', null)));
    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('ignores an incomplete kept session (no refresh token or no user id)', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ...stored, refresh_token: undefined }));
    client.getSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
    await mount();
    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('takes the refreshed session when the network is back', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    client.getSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
    await mount();
    const fresh = { ...stored, access_token: 'fresh', user: { id: 'user-1', email: 'student@example.com' } };
    await act(async () => client.listeners.forEach((listen) => listen('TOKEN_REFRESHED', fresh)));
    expect(screen.getByText('user:user-1')).toBeTruthy();
  });
});
