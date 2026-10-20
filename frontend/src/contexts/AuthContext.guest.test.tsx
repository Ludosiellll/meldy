import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

/**
 * A guest on the landing or /try with no session kept here: the client's file is not fetched for the session it does
 * not have (smoothness audit 20.10: 58 KB about 2 s in). It is read once something needs it: a page that brings the
 * client (sign-in), or a session that another tab keeps in this browser.
 */
type Listener = (event: AuthChangeEvent, session: Session | null) => void;

const client = vi.hoisted(() => ({
  getSession: vi.fn(),
  listeners: [] as Listener[],
  imported: 0,
}));

vi.mock('../lib/supabase', () => {
  client.imported += 1;
  return {
    supabase: {
      auth: {
        getSession: client.getSession,
        onAuthStateChange: (listener: Listener) => {
          client.listeners.push(listener);
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
        signOut: vi.fn(),
      },
    },
  };
});

const KEY = 'sb-daunnytubqbzafjnpfnw-auth-token';

async function mountFresh() {
  vi.resetModules();
  const { AuthProvider, useAuth } = await import('./AuthContext');
  const clientModule = await import('../lib/supabaseClient');
  function Who() {
    const { user, loading } = useAuth();
    return <p>{loading ? 'loading' : user ? `user:${user.id}` : 'signed out'}</p>;
  }
  render(
    <AuthProvider>
      <Who />
    </AuthProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return clientModule;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  client.listeners.length = 0;
  client.imported = 0;
  client.getSession.mockReset();
  client.getSession.mockResolvedValue({ data: { session: null } });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('AuthProvider: a guest on the landing with no session kept here', () => {
  it('does not fetch the client for a session there is none of, even when the page is idle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mountFresh();
      window.dispatchEvent(new Event('load'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(client.imported).toBe(0);
      expect(client.getSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the session once a page brings the client (the sign-in page), and hears the sign-in', async () => {
    const { supabaseStarted } = await mountFresh();
    expect(client.getSession).not.toHaveBeenCalled();
    const { supabase } = await import('../lib/supabase');
    await act(async () => {
      supabaseStarted(supabase as never);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.getSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText('signed out')).toBeInTheDocument();
    await act(async () => {
      for (const listener of client.listeners) listener('SIGNED_IN', { user: { id: 'user-2' } } as unknown as Session);
    });
    expect(screen.getByText('user:user-2')).toBeInTheDocument();
  });

  it('reads the session when another tab keeps one in this browser', async () => {
    await mountFresh();
    client.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-3' } } } });
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.getSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText('user:user-3')).toBeInTheDocument();
  });
});
