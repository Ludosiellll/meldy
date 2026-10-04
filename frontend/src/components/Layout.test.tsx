import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lazy } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  checkAILimit: vi.fn(),
  getProfile: vi.fn(),
  countDueCards: vi.fn(),
  setTheme: vi.fn(),
  signOut: vi.fn(),
  subscribe: vi.fn(),
  getUnreadCount: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'alina@example.com', user_metadata: { full_name: 'Алина' } }, signOut: mocks.signOut }),
}));
vi.mock('../api/social', () => ({ getProfile: (...args: unknown[]) => mocks.getProfile(...args), markOnboardingTourSeen: vi.fn(async () => undefined) }));
vi.mock('../api/chat', () => ({
  getUnreadCount: (...args: unknown[]) => mocks.getUnreadCount(...args),
  subscribeToNotifications: (...args: unknown[]) => mocks.subscribe(...args),
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
vi.mock('../api/flashcards', () => ({ countDueCards: (...args: unknown[]) => mocks.countDueCards(...args) }));
vi.mock('../lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mocks.from(...args) } }));
vi.mock('../contexts/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light', setTheme: mocks.setTheme }) }));
vi.mock('../hooks/useInstallPWA', () => ({ useInstallPWA: () => ({ handleInstallClick: vi.fn(), showInstall: false }) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));

import toast from 'react-hot-toast';
import Layout, { DESK_LINKS, NAV_ITEMS, PHONE_TABS, backLinkFor, hidesBottomNav, isRoomPath, quotaRemaining, sectionOf } from './Layout';
import { OPEN_PRO_EVENT } from '../lib/plans';

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

const bar = () => document.querySelector('header.sf-bar') as HTMLElement;
const deskNav = () => within(bar()).getByRole('navigation', { name: 'Разделы' });
const tabBar = () => screen.queryByTestId('tab-bar');
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Алина: профиль, тема, выход/ }));
/** The guide was seen, so a student's first run does not cover the shell in these tests (Guide.test.tsx covers it). */
const profile = (extra: Record<string, unknown> = {}) => ({ is_pro: false, role: 'student', onboarding_status: { guide: true }, ...extra });

beforeEach(() => {
  mocks.checkAILimit.mockReset().mockResolvedValue({ allowed: true, isPro: false, count: 30, ok: true });
  mocks.getProfile.mockReset().mockResolvedValue(profile());
  mocks.countDueCards.mockReset().mockResolvedValue(11);
  mocks.from.mockReset();
  mocks.setTheme.mockReset();
  mocks.signOut.mockReset();
  mocks.getUnreadCount.mockReset().mockResolvedValue(0);
  mocks.subscribe.mockReset().mockReturnValue(() => undefined);
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-stage');
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('the menu: five sections around the core', () => {
  it('is one line of the five sections — Сегодня, Экзамены, Лекции, Повторение, Прогресс — and no sidebar', async () => {
    renderAt('/dashboard');
    const links = within(deskNav()).getAllByRole('link');
    expect(links.map((link) => link.textContent?.replace(/\d+/g, '').trim())).toEqual(['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/dashboard', '/exams', '/library', '/review', '/analytics']);
    for (const link of links) expect(link.className).toBe('sf-bar-link');
    expect(within(bar()).queryByRole('link', { name: /Карта знаний|Дневник ошибок|Библиотека/ })).toBeNull();
    expect(document.querySelector('aside')).toBeNull();
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('has no capitals, group titles, icons or badges in the top line', async () => {
    renderAt('/dashboard');
    const header = bar();
    expect(header.querySelector('svg')).toBeNull();
    expect(header.querySelector('h3')).toBeNull();
    expect(header.innerHTML).not.toMatch(/uppercase|tracking-|animate-|bg-rose|bg-cyan/);
    expect(header.textContent).not.toMatch(/УЧЁБА|ПРАКТИКА|ПРОГРЕСС|Лимит/);
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('marks the current section with aria-current, also on its detail pages', async () => {
    renderAt('/exams/exam-1');
    expect(within(deskNav()).getByRole('link', { name: 'Экзамены' })).toHaveAttribute('aria-current', 'page');
    expect(within(deskNav()).getByRole('link', { name: 'Сегодня' })).not.toHaveAttribute('aria-current');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('keeps the knowledge map in «Прогресс» and the mistakes diary in «Повторение»', async () => {
    for (const [path, section] of [
      ['/knowledge-map', 'Прогресс'],
      ['/analytics', 'Прогресс'],
      ['/mistakes', 'Повторение'],
      ['/review', 'Повторение'],
      ['/library/m1', 'Лекции'],
    ] as const) {
      renderAt(path);
      const current = within(deskNav()).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current.map((link) => link.textContent?.replace(/\d+/g, '').trim())).toEqual([section]);
      cleanup();
    }
    expect(sectionOf('/knowledge-map')?.to).toBe('/analytics');
    expect(sectionOf('/mistakes')?.to).toBe('/review');
    expect(sectionOf('/profile')).toBeNull();
    expect(sectionOf('/analyze')).toBeNull();
  });

  it('shows the cards due next to «Повторение»', async () => {
    renderAt('/dashboard');
    await waitFor(() => expect(within(deskNav()).getByRole('link', { name: 'Повторение 11' })).toBeInTheDocument());
    expect(mocks.countDueCards).toHaveBeenCalledWith('user-1');
    // The open mistakes are counted on «Повторение» itself, not by the shell.
    expect(mocks.from).not.toHaveBeenCalledWith('mistake_diary');
  });

  it('shows no counter at all when the count is zero or could not be read', async () => {
    mocks.countDueCards.mockRejectedValue(new Error('offline'));
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.countDueCards).toHaveBeenCalled());
    await act(async () => undefined);
    expect(within(deskNav()).getByRole('link', { name: 'Повторение' }).textContent).toBe('Повторение');
  });

  it('keeps «Добавить лекцию» as the button of the line, a round «+» with the same name on a phone', async () => {
    renderAt('/analyze');
    const cta = within(bar()).getByRole('link', { name: 'Добавить лекцию' });
    expect(cta).toHaveAttribute('href', '/analyze');
    expect(cta).toHaveClass('sf-nav-cta');
    expect(cta).toHaveAttribute('aria-current', 'page');
    expect(cta.querySelector('.sf-cta-plus')).toHaveAttribute('aria-hidden', 'true');
    expect(cta.querySelector('.sf-cta-t')).toHaveTextContent('Добавить лекцию');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('no longer pops up toasts for messages and friend requests (they lead to hidden sections)', async () => {
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());
    const onNotification = mocks.subscribe.mock.calls[0][1] as (payload: unknown) => void;
    await act(async () => {
      onNotification({ new: { type: 'message', title: 'Новое сообщение' } });
    });
    expect(toast).not.toHaveBeenCalled();
    expect(mocks.getUnreadCount).toHaveBeenCalledTimes(2);
  });
});

describe('phones and tablets (spec 4.2)', () => {
  it('has the same five sections as tabs at the bottom, an icon over a word', async () => {
    renderAt('/dashboard');
    const tabs = tabBar()!;
    const links = within(tabs).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс']);
    expect(within(tabs).getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    expect(within(tabs).getByRole('link', { name: 'Сегодня' })).toHaveAttribute('aria-current', 'page');
    for (const link of links) {
      expect(link.querySelector('.sf-tab-ico svg')).not.toBeNull();
      expect(link.querySelector('.sf-tab-ico')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(PHONE_TABS.map((item) => item.to)).toEqual(['/dashboard', '/exams', '/library', '/review', '/analytics']);
    expect(DESK_LINKS).toBe(NAV_ITEMS);
    expect(PHONE_TABS).toBe(NAV_ITEMS);
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('lets the tab bar step aside on detail pages and puts «‹ Родитель» in the line', async () => {
    for (const [path, label, href] of [
      ['/exams/exam-1', 'Экзамены', '/exams'],
      ['/exams/new', 'Экзамены', '/exams'],
      ['/exams/exam-1/edit', 'Лист экзамена', '/exams/exam-1'],
      ['/library/m1', 'Лекции', '/library'],
    ] as const) {
      renderAt(path);
      expect(tabBar()).toBeNull();
      const back = document.querySelector('.sf-back') as HTMLAnchorElement;
      expect(back.textContent).toBe(label);
      expect(back).toHaveAttribute('href', href);
      expect(document.querySelector('.sf-shell')).toHaveAttribute('data-back');
      cleanup();
    }
    renderAt('/exams');
    expect(tabBar()).not.toBeNull();
    expect(document.querySelector('.sf-back')).toBeNull();
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('leads back from the map to «Прогресс» and from the diary to «Повторение», with the tabs still there', async () => {
    for (const [path, label, href] of [
      ['/knowledge-map', 'Прогресс', '/analytics'],
      ['/mistakes', 'Повторение', '/review'],
    ] as const) {
      renderAt(path);
      const back = document.querySelector('.sf-back') as HTMLAnchorElement;
      expect(back.textContent).toBe(label);
      expect(back).toHaveAttribute('href', href);
      expect(within(tabBar()!).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
      cleanup();
    }
  });

  it('recognises room, detail and parent paths', () => {
    expect(isRoomPath('/exams/abc/draw')).toBe(true);
    expect(isRoomPath('/exams/abc/ticket')).toBe(true);
    expect(isRoomPath('/exams/abc')).toBe(false);
    expect(isRoomPath('/exam')).toBe(false);
    expect(hidesBottomNav('/exams/new')).toBe(true);
    expect(hidesBottomNav('/exams/abc')).toBe(true);
    expect(hidesBottomNav('/exams/abc/edit')).toBe(true);
    expect(hidesBottomNav('/library/abc')).toBe(true);
    expect(hidesBottomNav('/exams')).toBe(false);
    expect(hidesBottomNav('/library')).toBe(false);
    expect(hidesBottomNav('/knowledge-map')).toBe(false);
    expect(hidesBottomNav('/mistakes')).toBe(false);
    expect(hidesBottomNav('/exams/abc/draw')).toBe(false);
    expect(backLinkFor('/dashboard')).toBeNull();
    expect(backLinkFor('/exams')).toBeNull();
    expect(backLinkFor('/analytics')).toBeNull();
    expect(backLinkFor('/knowledge-map')).toEqual({ to: '/analytics', label: 'Прогресс' });
    expect(backLinkFor('/mistakes')).toEqual({ to: '/review', label: 'Повторение' });
  });
});

describe('room mode', () => {
  it('renders only the page for «Тянуть билет» and the answer screen', async () => {
    for (const path of ['/exams/exam-1/draw', '/exams/exam-1/ticket']) {
      renderAt(path, <h1>Комната</h1>);
      expect(screen.getByRole('heading', { name: 'Комната' })).toBeInTheDocument();
      expect(document.querySelector('header.sf-bar')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Повторение' })).toBeNull();
      cleanup();
    }
  });
});

describe('the window scrolls (spec 4.1)', () => {
  it('never locks the window scroll in the shell', async () => {
    renderAt('/exams');
    expect(document.body.style.overflow).not.toBe('hidden');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('opens a page reached by a link at its top', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    function Page() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/library')}>
          Дальше
        </button>
      );
    }
    renderAt('/dashboard', <Page />);
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('gives full-height screens (messages) a height of their own', async () => {
    renderAt('/messages');
    expect(document.querySelector('main')).toHaveAttribute('data-pane');
    cleanup();
    renderAt('/library');
    expect(document.querySelector('main')).not.toHaveAttribute('data-pane');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });
});

describe('account menu', () => {
  it('holds the profile, the theme, projector mode, the daily limit and «Выйти»; Escape closes it', async () => {
    renderAt('/dashboard');
    const button = screen.getByRole('button', { name: /Алина: профиль, тема, выход/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    const menu = screen.getByRole('dialog', { name: 'Меню аккаунта' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByText('alina@example.com')).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Профиль' })).toHaveAttribute('href', '/profile');
    expect(within(menu).getByRole('button', { name: 'Светлая' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(menu).getByRole('button', { name: 'Тёмная' }));
    expect(mocks.setTheme).toHaveBeenCalledWith('dark');
    expect(within(menu).getByRole('switch', { name: /Показ на проекторе/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: 'Выйти' }));
    expect(mocks.signOut).toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Меню аккаунта' })).toBeNull();
    expect(button).toHaveFocus();
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('keeps only the account: the sections are all in the menu line and the tabs', async () => {
    renderAt('/dashboard');
    openMenu();
    const menu = screen.getByRole('dialog', { name: 'Меню аккаунта' });
    expect(within(menu).queryByRole('link', { name: /Карта знаний|Дневник ошибок|Прогресс|Добавить лекцию/ })).toBeNull();
    expect(within(menu).getByRole('button', { name: 'Как пользоваться Meldy' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('gives a teacher «Мои группы» and «Диалоги и друзья»', async () => {
    mocks.getProfile.mockResolvedValue(profile({ role: 'teacher' }));
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
    await act(async () => undefined);
    openMenu();
    const menu = screen.getByRole('dialog', { name: 'Меню аккаунта' });
    expect(within(menu).getByRole('link', { name: 'Мои группы' })).toHaveAttribute('href', '/teacher');
    expect(within(menu).getByRole('link', { name: /Диалоги и друзья/ })).toHaveAttribute('href', '/messages');
  });
});

describe('daily limit line', () => {
  it('shows what is left in plain words and reads it again after every charge', async () => {
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalledTimes(1));
    openMenu();
    const meter = await screen.findByTestId('quota-meter');
    await waitFor(() => expect(meter).toHaveTextContent('Дневной лимитосталось 70 из 100'));
    expect(meter.querySelector('svg')).toBeNull();
    expect(meter).toHaveAccessibleName('Дневной лимит: осталось 70 из 100');

    mocks.checkAILimit.mockResolvedValue({ allowed: false, isPro: false, count: 130, ok: true });
    await act(async () => {
      window.dispatchEvent(new Event('ai_usage_updated'));
    });
    await waitFor(() => expect(meter).toHaveTextContent('осталось 0 из 100'));
    expect(meter.textContent).not.toMatch(/-\d/);
    expect(mocks.checkAILimit).toHaveBeenCalledTimes(2);
  });

  it('offers «Что даёт PRO» next to the limit: it opens the PRO window and closes the menu', async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_PRO_EVENT, opened);
    try {
      renderAt('/dashboard');
      await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
      await act(async () => undefined);
      openMenu();
      const menu = screen.getByRole('dialog', { name: 'Меню аккаунта' });
      const meter = within(menu).getByTestId('quota-meter');
      const pro = within(menu).getByRole('button', { name: 'Что даёт PRO' });
      expect(meter.compareDocumentPosition(pro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(pro);
      expect(opened).toHaveBeenCalledTimes(1);
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ reason: 'meter' });
      expect(screen.queryByRole('dialog', { name: 'Меню аккаунта' })).toBeNull();
    } finally {
      window.removeEventListener(OPEN_PRO_EVENT, opened);
    }
  });

  it('does not offer PRO to a PRO account', async () => {
    mocks.getProfile.mockResolvedValue(profile({ is_pro: true }));
    mocks.checkAILimit.mockResolvedValue({ allowed: true, isPro: true, count: 0, ok: true });
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
    await act(async () => undefined);
    openMenu();
    expect(screen.getByTestId('quota-meter')).toHaveTextContent('без лимита');
    expect(screen.queryByRole('button', { name: 'Что даёт PRO' })).toBeNull();
  });

  it('does not pretend the limit is full when the counter could not be read', async () => {
    mocks.checkAILimit.mockResolvedValue({ allowed: true, isPro: false, count: 0, ok: false });
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalledTimes(1));
    openMenu();
    const meter = await screen.findByTestId('quota-meter');
    await waitFor(() => expect(meter).toHaveAccessibleName(/не удалось загрузить/));
    expect(meter).toHaveTextContent('Дневной лимитпроверить');
    fireEvent.click(meter);
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Дневной лимит ИИ' })).toBeNull();
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
    expect(document.querySelector('header.sf-bar')).not.toBeNull();
    await act(async () => {
      release({ default: () => <p>Лекции загружены</p> });
    });
    expect(await screen.findByText('Лекции загружены')).toBeInTheDocument();
  });
});

describe('projector mode', () => {
  it('switches html[data-stage] from the account menu and remembers it under meldy_stage', async () => {
    renderAt('/dashboard');
    openMenu();
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

  it('keeps the projector mode on after a reload', async () => {
    window.localStorage.setItem('meldy_stage', '1');
    renderAt('/exams');
    expect(document.documentElement.hasAttribute('data-stage')).toBe(true);
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });
});
