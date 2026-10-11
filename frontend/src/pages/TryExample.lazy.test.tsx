import { Component, type ComponentType, type ReactNode } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/** The steps' files, held back until the test lets them arrive (or fail). */
const files = vi.hoisted(() => {
  const deferred = () => {
    let resolve: (value: unknown) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject, asked: 0 };
  };
  return { ticket: deferred(), draw: deferred() };
});

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }) }));
vi.mock('../components/example/tryParts', async () => {
  const { lazyPart } = await import('../lib/lazyPart');
  const held = (file: typeof files.ticket) =>
    lazyPart(() => {
      file.asked += 1;
      return file.promise as Promise<ComponentType>;
    });
  return { tryTicketPart: held(files.ticket), tryDrawPart: held(files.draw) };
});

import TryExample from './TryExample';

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <p role="alert">{`Ошибка: ${this.state.error.message}`}</p> : this.props.children;
  }
}

function renderAt(url: string) {
  return render(
    <Boundary>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/try/*" element={<TryExample />} />
        </Routes>
      </MemoryRouter>
    </Boundary>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('the example’s draw and answer room are files of their own (jury QA, 2026-10-11: Slow 4G)', () => {
  it('the sheet shows without them: neither file is asked for', () => {
    renderAt('/try');
    expect(document.querySelector('.cs-paper')).not.toBeNull();
    expect(files.ticket.asked).toBe(0);
    expect(files.draw.asked).toBe(0);
  });

  it('a step whose file is still on its way keeps the top line and the page loader, then shows at once when it arrives', async () => {
    renderAt('/try/ticket?q=q5');
    expect(files.ticket.asked).toBe(1);
    expect(screen.getByRole('status', { name: 'Загрузка страницы' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Лист примера' })).toHaveAttribute('href', '/try');
    expect(screen.queryByRole('main')).toBeNull();
    const { default: ExampleTicket } = await import('../components/example/ExampleTicket');
    await act(async () => {
      files.ticket.resolve(ExampleTicket);
      await files.ticket.promise;
    });
    expect(screen.getByRole('button', { name: 'Вставить ответ примера' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Загрузка страницы' })).toBeNull();
    // Once in, the step shows on its first frame: no loader again.
    cleanup();
    renderAt('/try/ticket?q=q5');
    expect(screen.getByRole('button', { name: 'Вставить ответ примера' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Загрузка страницы' })).toBeNull();
    expect(files.ticket.asked).toBe(1);
  });

  it('a file that did not load goes to the boundary, as a page’s does', async () => {
    // React's development build replays the error as a window 'error' event; handled here, jsdom stays quiet.
    const quiet = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', quiet);
    onTestFinished(() => window.removeEventListener('error', quiet));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAt('/try/draw');
    expect(screen.getByRole('status', { name: 'Загрузка страницы' })).toBeInTheDocument();
    await act(async () => {
      files.draw.reject(new Error('Failed to fetch dynamically imported module'));
      await files.draw.promise.catch(() => undefined);
    });
    expect(screen.getByRole('alert').textContent).toBe('Ошибка: Failed to fetch dynamically imported module');
  });
});
