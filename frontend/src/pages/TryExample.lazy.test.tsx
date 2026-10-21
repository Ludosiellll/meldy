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
  return { ticket: deferred(), lecture: deferred() };
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
  return { tryTicketPart: held(files.ticket), tryLecturePart: held(files.lecture) };
});

import TryExample from './TryExample';
import { LECTURE_RESULT_LINK, PICK_TITLE } from '../components/example/ExamplePick';

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

const plain = (text: string) => text.replace(/\s+/g, ' ').trim();

/** A new file on the way for the lecture's result (the one before failed). */
function renewLecture() {
  const promise = new Promise((resolve, reject) => {
    files.lecture.resolve = resolve;
    files.lecture.reject = reject;
  });
  files.lecture.promise = promise;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('the example’s answer room and the lecture’s result are files of their own (jury QA, 2026-10-11: Slow 4G)', () => {
  it('the list of questions shows without them: neither file is asked for', () => {
    renderAt('/try');
    expect(screen.getByRole('heading', { level: 1, name: PICK_TITLE })).toBeInTheDocument();
    expect(files.ticket.asked).toBe(0);
    // The lecture's result neither: its link is under the list, its file comes when the link is pointed at or opened.
    expect(screen.getByRole('link', { name: (name) => plain(name) === plain(LECTURE_RESULT_LINK) })).toHaveAttribute('href', '/try/lecture');
    expect(files.lecture.asked).toBe(0);
  });

  it('a file that did not load goes to the boundary, as a page’s does', async () => {
    // React's development build replays the error as a window 'error' event; handled here, jsdom stays quiet.
    const quiet = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', quiet);
    onTestFinished(() => window.removeEventListener('error', quiet));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAt('/try/lecture');
    expect(screen.getByRole('status', { name: 'Загрузка страницы' })).toBeInTheDocument();
    await act(async () => {
      files.lecture.reject(new Error('Failed to fetch dynamically imported module'));
      await files.lecture.promise.catch(() => undefined);
    });
    expect(screen.getByRole('alert').textContent).toBe('Ошибка: Failed to fetch dynamically imported module');
    // The next time the page is wanted, its file is fetched again.
    renewLecture();
  });

  it('the lecture’s result keeps its top line and the loader while its file comes, the way back saying where it leads', async () => {
    const before = files.lecture.asked;
    renderAt('/try/lecture');
    expect(files.lecture.asked).toBe(before + 1);
    expect(screen.getByRole('status', { name: 'Загрузка страницы' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Вернуться к примеру' })).toHaveAttribute('href', '/try');
    const { default: ExampleLecture } = await import('../components/example/ExampleLecture');
    await act(async () => {
      files.lecture.resolve(ExampleLecture);
      await files.lecture.promise;
    });
    expect(screen.getByText('Материал обработан')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Вернуться к примеру' })[0]).toHaveAttribute('href', '/try');
    expect(screen.queryByRole('status', { name: 'Загрузка страницы' })).toBeNull();
  });

  it('a step whose file is still on its way keeps the top line and the page loader, then shows at once when it arrives', async () => {
    renderAt('/try/ticket?q=q5');
    expect(files.ticket.asked).toBe(1);
    expect(screen.getByRole('status', { name: 'Загрузка страницы' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Meldy, на главную' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('main')).toBeNull();
    const { default: ExampleTicket } = await import('../components/example/ExampleTicket');
    await act(async () => {
      files.ticket.resolve(ExampleTicket);
      await files.ticket.promise;
    });
    expect(screen.getByRole('button', { name: 'Вставить готовый ответ' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Загрузка страницы' })).toBeNull();
    // Once in, the step shows on its first frame: no loader again.
    cleanup();
    renderAt('/try/ticket?q=q5');
    expect(screen.getByRole('button', { name: 'Вставить готовый ответ' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Загрузка страницы' })).toBeNull();
    expect(files.ticket.asked).toBe(1);
  });
});
