import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  exchange: vi.fn(),
  getSession: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as null | ((event: string, session: unknown) => void),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => auth.exchange(...args),
      getSession: (...args: unknown[]) => auth.getSession(...args),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        auth.listener = callback;
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      },
    },
  },
}));

import AuthCallback from './AuthCallback';

function renderCallback(search = '') {
  window.history.pushState({}, '', `/auth/callback${search}`);
  return render(
    <MemoryRouter initialEntries={['/auth/callback']}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/login" element={<p>Страница входа</p>} />
        <Route path="/dashboard" element={<p>Сегодня</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.exchange.mockResolvedValue({ error: null });
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.listener = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.pushState({}, '', '/');
});

describe('AuthCallback', () => {
  it('waits on the paper canvas with a quiet status', async () => {
    const { container } = renderCallback();
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Выполняем вход…');
    const main = container.querySelector('main')!;
    expect(main.className).toContain('bg-[var(--sf-canvas)]');
    expect(container.innerHTML).not.toMatch(/bg-slate-9|#07111f|border-indigo-500/);
    expect(container.querySelector('.animate-spin')!.className).toContain('motion-reduce:animate-none');
  });

  it('shows a readable error in rose and leads back to the login page', async () => {
    auth.exchange.mockResolvedValue({ error: new Error('invalid grant') });
    const { container } = renderCallback('?code=abc');
    const alert = await screen.findByRole('alert');
    expect(auth.exchange).toHaveBeenCalledWith('abc');
    const message = screen.getByText('Не удалось завершить вход. Вернитесь на страницу входа и попробуйте ещё раз.');
    // rose-700 на светлом --sf-canvas даёт 5,8:1 (rose-600 было 4,3:1 — ниже WCAG AA для 14 px).
    expect(message.className).toContain('text-rose-700');
    expect(message.className).not.toContain('text-rose-600');
    expect(message.className).toContain('dark:text-rose-400');
    expect(alert).not.toHaveTextContent('invalid grant');
    expect(container.querySelector('main')!.className).toContain('bg-[var(--sf-canvas)]');
    expect(container.querySelector('.animate-spin')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Вернуться ко входу' }));
    expect(await screen.findByText('Страница входа')).toBeInTheDocument();
  });

  it('goes to the dashboard once the session exists', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    renderCallback('?code=abc');
    expect(await screen.findByText('Сегодня')).toBeInTheDocument();
  });

  it('finishes from the auth event as well', async () => {
    renderCallback();
    await screen.findByRole('status');
    act(() => {
      auth.listener?.('SIGNED_IN', { access_token: 't' });
    });
    expect(await screen.findByText('Сегодня')).toBeInTheDocument();
  });

  it('reports a timeout after 15 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderCallback();
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(await screen.findByText('Вход не завершился вовремя. Проверьте настройки OAuth и попробуйте ещё раз.')).toBeInTheDocument();
  });
});
