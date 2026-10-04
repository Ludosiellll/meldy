import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  markSeen: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'alina@example.com', user_metadata: { full_name: 'Алина' } }, signOut: vi.fn() }),
}));
vi.mock('../../api/social', () => ({
  getProfile: (...args: unknown[]) => mocks.getProfile(...args),
  markOnboardingTourSeen: (...args: unknown[]) => mocks.markSeen(...args),
}));
vi.mock('../../api/chat', () => ({
  getUnreadCount: vi.fn(async () => 0),
  subscribeToNotifications: vi.fn(() => () => undefined),
  getNotifications: vi.fn(async () => []),
  markAllRead: vi.fn(async () => undefined),
  getUnreadDMsGrouped: vi.fn(async () => ({})),
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
vi.mock('../../contexts/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('../../hooks/useInstallPWA', () => ({ useInstallPWA: () => ({ handleInstallClick: vi.fn(), showInstall: false }) }));

import Layout from '../Layout';
import { GUIDE_CHAPTERS, chapterIndexFor, mayLeave } from './chapters';
import { GUIDE_SEEN_KEY } from './GuideContext';

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const guide = () => screen.queryByRole('dialog', { name: /./ , hidden: false });
const panel = () => document.querySelector('section.gd') as HTMLElement | null;

beforeEach(() => {
  mocks.getProfile.mockReset().mockResolvedValue({ is_pro: false, role: 'student', onboarding_status: {} });
  mocks.markSeen.mockReset().mockResolvedValue(undefined);
  window.localStorage.clear();
});
afterEach(cleanup);

describe('the guide chapters', () => {
  it('follow the sections, in the words of the menu', () => {
    expect(GUIDE_CHAPTERS.map((chapter) => chapter.tab)).toEqual([
      'Сегодня',
      'Добавить лекцию',
      'Библиотека',
      'Повторение',
      'Экзамены',
      'Дневник ошибок',
      'Карта знаний',
      'Прогресс',
    ]);
    expect(chapterIndexFor('/library/abc')).toBe(2);
    expect(chapterIndexFor('/exams/1/edit')).toBe(4);
    expect(chapterIndexFor('/profile')).toBe(-1);
  });

  it('move the app only from a section page nobody has touched, and never off an upload it did not open', () => {
    expect(mayLeave('/dashboard', null, false)).toBe(true);
    expect(mayLeave('/dashboard', null, true)).toBe(false);
    expect(mayLeave('/library/abc', null, false)).toBe(false);
    expect(mayLeave('/analyze', null, false)).toBe(false);
    expect(mayLeave('/analyze', '/analyze', false)).toBe(true);
  });
});

describe('the guide in the shell', () => {
  it('opens by itself once on «Сегодня», without taking the focus, and «Не сейчас» remembers it', async () => {
    renderAt('/dashboard');
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(within(panel()!).getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument();
    expect(panel()).not.toHaveFocus();
    fireEvent.click(within(panel()!).getByRole('button', { name: 'Не сейчас' }));
    expect(panel()).toBeNull();
    expect(window.localStorage.getItem(GUIDE_SEEN_KEY)).toBe('1');
    await waitFor(() => expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'guide'));
  });

  it('does not open by itself once seen on another device', async () => {
    mocks.getProfile.mockResolvedValue({ is_pro: false, role: 'student', onboarding_status: { guide: true } });
    renderAt('/dashboard');
    await act(async () => {
      await Promise.resolve();
    });
    expect(panel()).toBeNull();
  });

  it('«Дальше» takes the app to the next section and lights it up in the top line', async () => {
    renderAt('/dashboard');
    await waitFor(() => expect(panel()).not.toBeNull());
    fireEvent.click(within(panel()!).getByRole('button', { name: /Дальше/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/analyze');
    expect(within(panel()!).getByRole('heading', { name: 'Добавить лекцию' })).toBeInTheDocument();
    expect(document.querySelector('.sf-nav-cta')).toHaveAttribute('data-guide-spot');
    fireEvent.click(within(panel()!).getByRole('button', { name: /Дальше/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/library');
    expect(document.querySelector('.sf-bar-link[href="/library"]')).toHaveAttribute('data-guide-spot');
  });

  it('«?» opens it on the section of the page, with the focus inside; Esc closes and gives the focus back', async () => {
    mocks.getProfile.mockResolvedValue({ is_pro: false, role: 'student', onboarding_status: { guide: true } });
    renderAt('/review');
    const help = await screen.findByRole('button', { name: 'Как пользоваться Meldy' });
    help.focus();
    fireEvent.click(help);
    expect(within(panel()!).getByRole('heading', { name: 'Повторение' })).toBeInTheDocument();
    expect(panel()).toHaveFocus();
    fireEvent.keyDown(panel()!, { key: 'Escape' });
    expect(panel()).toBeNull();
    expect(help).toHaveFocus();
  });

  it('jumps to any chapter from the strip, and stays put on a page that is not a section', async () => {
    mocks.getProfile.mockResolvedValue({ is_pro: false, role: 'student', onboarding_status: { guide: true } });
    renderAt('/profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Как пользоваться Meldy' }));
    fireEvent.click(within(panel()!).getByRole('button', { name: 'Карта знаний' }));
    expect(within(panel()!).getByRole('heading', { name: 'Карта знаний' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/profile');
    expect(within(panel()!).getByRole('link', { name: 'Открыть раздел' })).toHaveAttribute('href', '/knowledge-map');
    expect(guide()).not.toBeNull();
  });
});
