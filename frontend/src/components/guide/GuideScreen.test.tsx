import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The guide names what is on screen (UX audit of 21.10, P4): the test's own page is «Тесты», an empty «Экзамены» has
   «Выбрать файлы». The shell mocked as in Guide.test.tsx. */

const mocks = vi.hoisted(() => ({ getProfile: vi.fn(), markSeen: vi.fn() }));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'alina@example.com', user_metadata: { full_name: 'Алина' } }, signOut: vi.fn() }),
}));
vi.mock('../../api/social', () => ({
  getProfile: (...args: unknown[]) => mocks.getProfile(...args),
  markOnboardingTourSeen: (...args: unknown[]) => mocks.markSeen(...args),
}));
vi.mock('../../api/limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/limits')>();
  return { ...actual, checkAILimit: vi.fn(async () => ({ allowed: true, isPro: false, count: 0, ok: true })) };
});
vi.mock('../../api/flashcards', () => ({ countDueCards: vi.fn(async () => 0) }));
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 0, error: null }).then(resolve);
  return { supabase: { from: () => chain } };
});
vi.mock('../../contexts/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light', resolved: 'light', setTheme: vi.fn() }) }));
vi.mock('../../hooks/useInstallPWA', () => ({ useInstallPWA: () => ({ handleInstallClick: vi.fn(), showInstall: false }) }));

import Layout from '../Layout';

const panel = () => document.querySelector('section.gd') as HTMLElement | null;

function renderWith(path: string, page: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={page} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.getProfile.mockReset().mockResolvedValue({ is_pro: false, role: 'student', onboarding_status: { guide: true } });
  mocks.markSeen.mockReset().mockResolvedValue(undefined);
  window.localStorage.clear();
});
afterEach(cleanup);

describe('the guide names what is on screen', () => {
  it('«?» on a test’s own page opens «Тесты», though its address is an exam’s', () => {
    renderWith('/exams/c/abc', <div data-guide-chapter="tests" />);
    fireEvent.click(screen.getByRole('button', { name: 'Как пользоваться Meldy' }));
    expect(within(panel()!).getByRole('heading', { name: 'Быстрая контрольная' })).toBeInTheDocument();
    expect(within(panel()!).getByRole('button', { name: 'Контрольная' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('«Экзамены» with no exam names «Выбрать файлы», the button that is there', async () => {
    renderWith(
      '/exams',
      <div className="ex-list-page">
        <div className="ex-empty" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Как пользоваться Meldy' }));
    expect(within(panel()!).getByRole('heading', { name: 'Экзамены' })).toBeInTheDocument();
    await waitFor(() => expect(panel()).toHaveTextContent('Нажмите «Выбрать файлы»'));
    expect(panel()).not.toHaveTextContent('Нажмите «Новый экзамен»');
  });

  it('«Экзамены» with exams keeps «Новый экзамен»', () => {
    renderWith('/exams', <div className="ex-list-page" />);
    fireEvent.click(screen.getByRole('button', { name: 'Как пользоваться Meldy' }));
    expect(panel()).toHaveTextContent('Нажмите «Новый экзамен»');
  });
});
