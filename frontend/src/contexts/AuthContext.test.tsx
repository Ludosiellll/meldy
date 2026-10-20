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

/**
 * Offline at the start (usability check of 2026-10-10, m5): with an expired access token the client's refresh waits
 * for the network for about a minute, and «Сегодня» waited with it. The kept session signs the student in at once.
 */
describe('AuthProvider: offline at the start', () => {
  const pending = () => new Promise<never>(() => undefined);

  async function whileOffline(run: () => Promise<void>) {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      await run();
    } finally {
      onLine.mockRestore();
    }
  }

  it('signs in with the kept session on the first frame, without the client’s answer', async () => {
    await whileOffline(async () => {
      window.localStorage.setItem(KEY, JSON.stringify(stored));
      client.getSession.mockReturnValue(pending());
      render(
        <AuthProvider>
          <Who />
        </AuthProvider>,
      );
      expect(screen.getByText('user:user-1')).toBeTruthy();
    });
  });

  it('still takes the client’s answer when it comes: a refreshed session, a sign-out', async () => {
    await whileOffline(async () => {
      window.localStorage.setItem(KEY, JSON.stringify(stored));
      client.getSession.mockReturnValue(pending());
      await mount();
      expect(screen.getByText('user:user-1')).toBeTruthy();
      const fresh = { ...stored, access_token: 'fresh' };
      await act(async () => client.listeners.forEach((listen) => listen('TOKEN_REFRESHED', fresh as unknown as Session)));
      expect(screen.getByText('user:user-1')).toBeTruthy();
      await act(async () => client.listeners.forEach((listen) => listen('SIGNED_OUT', null)));
      expect(screen.getByText('signed out')).toBeTruthy();
    });
  });

  it('waits for the client without a complete kept session, or with a sign-in in the address', async () => {
    await whileOffline(async () => {
      client.getSession.mockReturnValue(pending());
      await mount();
      expect(screen.getByText('loading')).toBeTruthy();
      cleanup();

      window.localStorage.setItem(KEY, JSON.stringify({ ...stored, refresh_token: undefined }));
      await mount();
      expect(screen.getByText('loading')).toBeTruthy();
      cleanup();

      window.localStorage.setItem(KEY, JSON.stringify(stored));
      window.history.replaceState(null, '', '/auth/callback?code=abc');
      await mount();
      expect(screen.getByText('loading')).toBeTruthy();
    });
  });

  it('online, waits for the client as before', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    client.getSession.mockReturnValue(pending());
    await mount();
    expect(screen.getByText('loading')).toBeTruthy();
  });
});

describe('AuthProvider: a guest on the landing', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    client.getSession.mockResolvedValue({ data: { session: null } });
  });

  function Ask() {
    const { requestSession } = useAuth();
    return (
      <button type="button" onClick={() => requestSession?.()}>
        ask
      </button>
    );
  }

  it('never fetches the client while the guest stays on the landing, even when the page is idle', async () => {
    vi.useFakeTimers();
    try {
      render(
        <AuthProvider>
          <Who />
        </AuthProvider>,
      );
      await act(async () => {
        window.dispatchEvent(new Event('load'));
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(client.getSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the session when asked (leaving the landing) or when a session appears from another tab', async () => {
    render(
      <AuthProvider>
        <Who />
        <Ask />
      </AuthProvider>,
    );
    await act(async () => {
      screen.getByText('ask').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.getSession).toHaveBeenCalledTimes(1);
    cleanup();
    client.getSession.mockClear();
    await mount();
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.getSession).toHaveBeenCalledTimes(1);
  });
});
