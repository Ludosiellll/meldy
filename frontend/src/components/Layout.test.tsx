import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lazy } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  checkAILimit: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'alina@example.com', user_metadata: { full_name: 'Алина' } }, signOut: vi.fn() }),
}));
vi.mock('../api/social', () => ({ getProfile: (...args: unknown[]) => mocks.getProfile(...args) }));
vi.mock('../api/chat', () => ({
  getUnreadCount: vi.fn(async () => 0),
  subscribeToNotifications: vi.fn(() => () => undefined),
  subscribeToMessages: vi.fn(() => () => undefined),
  getNotifications: vi.fn(async () => []),
  markAllRead: vi.fn(async () => undefined),
  getUnreadDMsGrouped: vi.fn(async () => ({})),
  deleteNotification: vi.fn(async () => true),
}));
vi.mock('../api/limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/limits')>();
  return { ...actual, checkAILimit: (...args: unknown[]) => mocks.checkAILimit(...args) };
});
vi.mock('../contexts/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('../hooks/useInstallPWA', () => ({ useInstallPWA: () => ({ handleInstallClick: vi.fn(), showInstall: false }) }));
vi.mock('./OnboardingManager', () => ({ default: () => null }));

import Layout, { hidesBottomNav, isRoomPath, quotaRemaining } from './Layout';

function renderAt(path: string, page: React.ReactNode = <p>Содержимое страницы</p>) {
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
  mocks.checkAILimit.mockReset().mockResolvedValue({ allowed: true, isPro: false, count: 30, ok: true });
  mocks.getProfile.mockReset().mockResolvedValue({ is_pro: false, role: 'student' });
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-stage');
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('navigation', () => {
  it('puts «Экзамены» right after «Повторение» in the sidebar and the drawer', async () => {
    renderAt('/dashboard');
    const sidebar = document.querySelector('aside')!;
    const labels = within(sidebar)
      .getAllByRole('link')
      .map((link) => link.textContent?.trim());
    const review = labels.indexOf('Повторение');
    expect(review).toBeGreaterThanOrEqual(0);
    expect(labels[review + 1]).toBe('Экзамены');
    expect(within(sidebar).getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('adds «Экзамены» to the phone tab bar', async () => {
    renderAt('/dashboard');
    const tabs = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(tabs).getByRole('link', { name: /Экзамены/ })).toHaveAttribute('href', '/exams');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('lets the tab bar step aside on exam detail pages', async () => {
    renderAt('/exams/exam-1');
    expect(screen.getByRole('navigation', { name: 'Разделы', hidden: true })).toHaveClass('hidden');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('recognises room and detail paths', () => {
    expect(isRoomPath('/exams/abc/draw')).toBe(true);
    expect(isRoomPath('/exams/abc/ticket')).toBe(true);
    expect(isRoomPath('/exams/abc')).toBe(false);
    expect(isRoomPath('/exam')).toBe(false);
    expect(hidesBottomNav('/exams/new')).toBe(true);
    expect(hidesBottomNav('/exams/abc')).toBe(true);
    expect(hidesBottomNav('/exams/abc/edit')).toBe(true);
    expect(hidesBottomNav('/exams')).toBe(false);
    expect(hidesBottomNav('/exams/abc/draw')).toBe(false);
  });
});

describe('room mode', () => {
  it('renders only the page for «Тянуть билет» and the answer screen, and lets the window scroll', async () => {
    for (const path of ['/exams/exam-1/draw', '/exams/exam-1/ticket']) {
      renderAt(path, <h1>Комната</h1>);
      expect(screen.getByRole('heading', { name: 'Комната' })).toBeInTheDocument();
      expect(document.querySelector('aside')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Повторение' })).toBeNull();
      expect(document.body.style.overflow).not.toBe('hidden');
      cleanup();
    }
  });

  it('locks the window scroll only in the shell', async () => {
    renderAt('/exams');
    expect(document.body.style.overflow).toBe('hidden');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });
});

describe('daily limit line', () => {
  it('shows what is left in plain words and reads it again after every charge', async () => {
    renderAt('/dashboard');
    const meter = await screen.findByTestId('quota-meter');
    await waitFor(() => expect(meter).toHaveTextContent('Лимит: 70'));
    expect(meter.querySelector('svg')).toBeNull();
    expect(meter).toHaveAccessibleName('Дневной лимит: осталось 70 из 100');

    mocks.checkAILimit.mockResolvedValue({ allowed: false, isPro: false, count: 130, ok: true });
    await act(async () => {
      window.dispatchEvent(new Event('ai_usage_updated'));
    });
    await waitFor(() => expect(meter).toHaveTextContent('Лимит: 0'));
    expect(meter.textContent).not.toMatch(/-\d/);
    expect(mocks.checkAILimit).toHaveBeenCalledTimes(2);
  });

  it('does not pretend the limit is full when the counter could not be read', async () => {
    mocks.checkAILimit.mockResolvedValue({ allowed: true, isPro: false, count: 0, ok: false });
    renderAt('/dashboard');
    const meter = await screen.findByTestId('quota-meter');
    await waitFor(() => expect(meter).toHaveAccessibleName(/не удалось загрузить/));
    expect(meter).toHaveTextContent(/^Лимит$/);
    fireEvent.click(meter);
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never goes below zero', () => {
    expect(quotaRemaining(30)).toBe(70);
    expect(quotaRemaining(100)).toBe(0);
    expect(quotaRemaining(250)).toBe(0);
    expect(quotaRemaining(-5)).toBe(100);
    expect(quotaRemaining(null)).toBeNull();
  });

  it('stops listening when the shell goes away', async () => {
    const { unmount } = renderAt('/dashboard');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalledTimes(1));
    unmount();
    window.dispatchEvent(new Event('ai_usage_updated'));
    expect(mocks.checkAILimit).toHaveBeenCalledTimes(1);
  });
});

describe('page loading', () => {
  it('shows the route loader inside the shell while a page chunk loads', async () => {
    let release: (value: { default: () => JSX.Element }) => void = () => undefined;
    const Slow = lazy(
      () =>
        new Promise<{ default: () => JSX.Element }>((resolve) => {
          release = resolve;
        }),
    );
    renderAt('/library', <Slow />);
    const main = document.querySelector('main')!;
    const loader = within(main).getByRole('status', { name: 'Загрузка страницы' });
    expect(loader.className).toContain('min-h-[40vh]');
    expect(document.querySelector('aside')).not.toBeNull();
    await act(async () => {
      release({ default: () => <p>Библиотека загружена</p> });
    });
    expect(await screen.findByText('Библиотека загружена')).toBeInTheDocument();
  });
});

describe('projector mode', () => {
  it('switches html[data-stage] and remembers it under meldy_stage', async () => {
    renderAt('/dashboard');
    const toggle = screen.getByRole('switch', { name: /Показ на проекторе/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.hasAttribute('data-stage')).toBe(true);
    expect(window.localStorage.getItem('meldy_stage')).toBe('1');
    fireEvent.click(toggle);
    expect(document.documentElement.hasAttribute('data-stage')).toBe(false);
    expect(window.localStorage.getItem('meldy_stage')).toBeNull();
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });
});
