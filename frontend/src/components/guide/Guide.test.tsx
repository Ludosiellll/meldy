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

const guide = () => screen.queryByRole('dialog', { name: /./, hidden: false });
const panel = () => document.querySelector('section.gd') as HTMLElement | null;
const next = () => fireEvent.click(within(panel()!).getByRole('button', { name: /Дальше/ }));
const where = () => screen.getByTestId('where').textContent;

/**
 * The first run opens from an effect once the profile has loaded (outside act): wait until the dialog
 * has taken the focus and the app stands on «Сегодня» (the router moves in a transition).
 */
async function firstRunOpen() {
  await waitFor(() => expect(panel()).not.toBeNull());
  await waitFor(() => expect(panel()).toHaveFocus());
  await waitFor(() => expect(where()).toBe('/dashboard'));
  return panel()!;
}
const student = (onboarding: Record<string, boolean> = {}) => ({ is_pro: false, role: 'student', onboarding_status: onboarding });

beforeEach(() => {
  mocks.getProfile.mockReset().mockResolvedValue(student());
  mocks.markSeen.mockReset().mockResolvedValue(undefined);
  window.localStorage.clear();
});
afterEach(cleanup);

describe('the guide chapters', () => {
  it('follow the menu, in its words: the map is told in «Прогресс», the mistakes diary in «Повторение»', () => {
    expect(GUIDE_CHAPTERS.map((chapter) => chapter.tab)).toEqual(['Сегодня', 'Добавить лекцию', 'Лекции', 'Экзамены', 'Повторение', 'Прогресс']);
    expect(chapterIndexFor('/library/abc')).toBe(2);
    expect(chapterIndexFor('/exams/1/edit')).toBe(3);
    expect(chapterIndexFor('/mistakes')).toBe(4);
    expect(chapterIndexFor('/knowledge-map')).toBe(5);
    expect(chapterIndexFor('/profile')).toBe(-1);
    const byId = Object.fromEntries(GUIDE_CHAPTERS.map((chapter) => [chapter.id, chapter.text]));
    expect(byId.review).toMatch(/дневник ошибок/);
    expect(byId.progress).toMatch(/карта знаний/);
    expect(GUIDE_CHAPTERS.map((chapter) => chapter.text).join(' ')).not.toMatch(/разметк|эталон|Библиотек/i);
  });

  it('move the app only from a section page nobody has touched, and never off an upload it did not open', () => {
    expect(mayLeave('/dashboard', null, false)).toBe(true);
    expect(mayLeave('/dashboard', null, true)).toBe(false);
    expect(mayLeave('/library/abc', null, false)).toBe(false);
    expect(mayLeave('/analyze', null, false)).toBe(false);
    expect(mayLeave('/analyze', '/analyze', false)).toBe(true);
  });
});

describe('the first run', () => {
  it('is a blocking dialog: modal, the focus inside, no «Не сейчас», no ×, Escape does nothing', async () => {
    renderAt('/dashboard');
    const dialog = await firstRunOpen();
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Не сейчас' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Закрыть' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Назад' })).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel()).not.toBeNull();
    // The app under it cannot be reached: the top line, the page and the tabs are inert, the app is dimmed.
    expect(document.querySelector('header.sf-bar')).toHaveAttribute('inert');
    expect(document.querySelector('main.sf-main')).toHaveAttribute('inert');
    expect(document.querySelector('nav.sf-tabbar')).toHaveAttribute('inert');
    expect(document.querySelector('.gd-layer .gd-dim')).not.toBeNull();
    expect(window.localStorage.getItem(GUIDE_SEEN_KEY)).toBeNull();
    expect(mocks.markSeen).not.toHaveBeenCalled();
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    renderAt('/dashboard');
    const dialog = await firstRunOpen();
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    const last = controls[controls.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(controls[0]).toHaveFocus();
    fireEvent.keyDown(controls[0], { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    // A focus that lands outside (a script, a click on the dim) comes back to the dialog.
    const outside = document.querySelector('.sf-wordmark') as HTMLElement;
    act(() => outside.focus());
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('«Дальше» takes the app through the sections and lights each one up in the menu', async () => {
    renderAt('/dashboard');
    await firstRunOpen();
    expect(document.querySelector('.sf-bar-link[href="/dashboard"]')).toHaveAttribute('data-guide-spot');
    expect(document.querySelector('.sf-tablink[href="/dashboard"]')).toHaveAttribute('data-guide-spot');
    next();
    expect(where()).toBe('/analyze');
    expect(within(panel()!).getByRole('heading', { name: 'Добавить лекцию' })).toBeInTheDocument();
    expect(document.querySelector('.sf-nav-cta')).toHaveAttribute('data-guide-spot');
    next();
    expect(where()).toBe('/library');
    expect(within(panel()!).getByRole('heading', { name: 'Лекции' })).toBeInTheDocument();
    next();
    expect(where()).toBe('/exams');
    expect(document.querySelector('.sf-bar-link[href="/exams"]')).toHaveAttribute('data-guide-spot');
    expect(within(panel()!).getByRole('button', { name: 'Назад' })).toBeInTheDocument();
    next();
    expect(where()).toBe('/review');
    next();
    expect(where()).toBe('/analytics');
    expect(within(panel()!).getByRole('heading', { name: 'Прогресс' })).toBeInTheDocument();
    expect(within(panel()!).queryByRole('button', { name: /Дальше/ })).toBeNull();
  });

  it('ends with «Начать»: closed, seen on this device and in the profile, the app back on «Сегодня»', async () => {
    renderAt('/dashboard');
    await firstRunOpen();
    for (let step = 1; step < GUIDE_CHAPTERS.length; step += 1) next();
    expect(where()).toBe('/analytics');
    fireEvent.click(within(panel()!).getByRole('button', { name: 'Начать' }));
    expect(panel()).toBeNull();
    expect(where()).toBe('/dashboard');
    expect(window.localStorage.getItem(GUIDE_SEEN_KEY)).toBe('1');
    await waitFor(() => expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'guide'));
    expect(document.querySelector('[inert]')).toBeNull();

    // Afterwards «?» opens the card as before: not modal, with «Не сейчас», × and Escape.
    fireEvent.click(screen.getByRole('button', { name: 'Как пользоваться Meldy' }));
    expect(panel()).toHaveAttribute('aria-modal', 'false');
    expect(within(panel()!).getByRole('button', { name: 'Не сейчас' })).toBeInTheDocument();
    expect(within(panel()!).getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
    expect(document.querySelector('.gd-dim')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
    fireEvent.keyDown(panel()!, { key: 'Escape' });
    expect(panel()).toBeNull();
  });

  it('starts from «Сегодня» when the app opens on another section, and waits out the ticket room', async () => {
    renderAt('/exams');
    const dialog = await firstRunOpen();
    expect(within(dialog).getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument();
    cleanup();

    renderAt('/exams/e-1/ticket');
    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(panel()).toBeNull();
    expect(where()).toBe('/exams/e-1/ticket');
  });

  it('is not shown once seen: in the profile (another device) or on this device', async () => {
    mocks.getProfile.mockResolvedValue(student({ guide: true }));
    renderAt('/dashboard');
    await act(async () => {
      await Promise.resolve();
    });
    expect(panel()).toBeNull();
    cleanup();

    mocks.getProfile.mockResolvedValue(student());
    window.localStorage.setItem(GUIDE_SEEN_KEY, '1');
    renderAt('/dashboard');
    await act(async () => {
      await Promise.resolve();
    });
    expect(panel()).toBeNull();
  });

  it('is the same for an account marked as a teacher: no card in the corner', async () => {
    mocks.getProfile.mockResolvedValue({ is_pro: false, role: 'teacher', onboarding_status: {} });
    renderAt('/exams');
    const dialog = await firstRunOpen();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Не сейчас' })).toBeNull();
    expect(document.querySelector('header.sf-bar')).toHaveAttribute('inert');
  });
});

describe('the guide asked for', () => {
  it('«?» opens it on the section of the page, with the focus inside; Esc closes and gives the focus back', async () => {
    mocks.getProfile.mockResolvedValue(student({ guide: true }));
    renderAt('/mistakes');
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
    mocks.getProfile.mockResolvedValue(student({ guide: true }));
    renderAt('/profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Как пользоваться Meldy' }));
    fireEvent.click(within(panel()!).getByRole('button', { name: 'Прогресс' }));
    expect(within(panel()!).getByRole('heading', { name: 'Прогресс' })).toBeInTheDocument();
    expect(where()).toBe('/profile');
    expect(within(panel()!).getByRole('link', { name: 'Открыть раздел' })).toHaveAttribute('href', '/analytics');
    expect(guide()).not.toBeNull();
  });
});
