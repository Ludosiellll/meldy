import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  listeners: [] as Array<(event: string, session: unknown) => void>,
  lost: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'user-1' }, access_token: 'a', refresh_token: 'r' } }, error: null }),
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        client.listeners.push(listener);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      // the client's own sign-out tells its listeners SIGNED_OUT before it resolves
      signOut: async () => {
        client.listeners.forEach((listen) => listen('SIGNED_OUT', null));
        return { error: null };
      },
    },
  },
}));
vi.mock('../lib/draftRescue', () => ({ sessionLost: client.lost }));

import { AuthProvider, useAuth } from './AuthContext';

function Who() {
  const { user, signOut } = useAuth();
  return (
    <>
      <p>{user ? `user:${user.id}` : 'signed out'}</p>
      <button type="button" onClick={() => void signOut()}>
        out
      </button>
    </>
  );
}

async function mount() {
  window.localStorage.setItem('sb-daunnytubqbzafjnpfnw-auth-token', JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 'user-1' } }));
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
  client.lost.mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('AuthProvider: open editors keep their drafts when the session ends by itself', () => {
  it('a sign-out the app did not ask for (the session ran out) tells the editors before the page goes', async () => {
    await mount();
    expect(screen.getByText('user:user-1')).toBeTruthy();
    await act(async () => client.listeners.forEach((listen) => listen('SIGNED_OUT', null)));
    expect(client.lost).toHaveBeenCalledTimes(1);
    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it("«Выйти» is the author's own choice: nothing is kept", async () => {
    await mount();
    await act(async () => {
      screen.getByText('out').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText('signed out')).toBeTruthy();
    expect(client.lost).not.toHaveBeenCalled();
  });

  it('a refreshed token tells nobody', async () => {
    await mount();
    await act(async () => client.listeners.forEach((listen) => listen('TOKEN_REFRESHED', { user: { id: 'user-1' } })));
    expect(client.lost).not.toHaveBeenCalled();
  });
});
