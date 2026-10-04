import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lazy } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  checkAILimit: vi.fn(),
  getProfile: vi.fn(),
  countDueCards: vi.fn(),
  openMistakes: { count: 5 as number | null, error: null as null | { message: string } },
  setTheme: vi.fn(),
  signOut: vi.fn(),
  subscribe: vi.fn(),
  getUnreadCount: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'alina@example.com', user_metadata: { full_name: 'Алина' } }, signOut: mocks.signOut }),
}));
vi.mock('../api/social', () => ({ getProfile: (...args: unknown[]) => mocks.getProfile(...args) }));
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
vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ count: mocks.openMistakes.count, error: mocks.openMistakes.error }).then(resolve, reject);
  return { supabase: { from: () => chain } };
});
vi.mock('../contexts/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light', setTheme: mocks.setTheme }) }));
vi.mock('../hooks/useInstallPWA', () => ({ useInstallPWA: () => ({ handleInstallClick: vi.fn(), showInstall: false }) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));

import toast from 'react-hot-toast';
import Layout, { DESK_LINKS, PHONE_TABS, backLinkFor, hidesBottomNav, isRoomPath, quotaRemaining } from './Layout';

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

beforeEach(() => {
  mocks.checkAILimit.mockReset().mockResolvedValue({ allowed: true, isPro: false, count: 30, ok: true });
  mocks.getProfile.mockReset().mockResolvedValue({ is_pro: false, role: 'student' });
  mocks.countDueCards.mockReset().mockResolvedValue(11);
  mocks.openMistakes.count = 5;
  mocks.openMistakes.error = null;
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

describe('the menu line (spec 4.1)', () => {
  it('is one line of text links with «Экзамены» second and «Карта знаний» after «Библиотека», and no sidebar', async () => {
    renderAt('/dashboard');
    const labels = within(deskNav())
      .getAllByRole('link')
      .map((link) => link.textContent?.replace(/\d+/g, '').trim());
    expect(labels).toEqual(['Сегодня', 'Экзамены', 'Библиотека', 'Карта знаний', 'Повторение', 'Дневник ошибок', 'Прогресс']);
    expect(within(deskNav()).getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    expect(document.querySelector('aside')).toBeNull();
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('shows «Карта знаний» in the line only where it fits (1280 px and wider), else in the account menu', async () => {
    renderAt('/knowledge-map');
    const link = within(deskNav()).getByRole('link', { name: 'Карта знаний' });
    expect(link).toHaveAttribute('href', '/knowledge-map');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveClass('sf-bar-link', 'max-[1279px]:!hidden');
    // The other six are never hidden: the line of six fits from 1024 px.
    for (const other of within(deskNav()).getAllByRole('link').filter((item) => item !== link)) expect(other.className).toBe('sf-bar-link');
    openMenu();
    const fallback = within(screen.getByRole('dialog', { name: 'Меню аккаунта' })).getByRole('link', { name: 'Карта знаний' });
    expect(fallback).toHaveAttribute('href', '/knowledge-map');
    expect(fallback).toHaveClass('sf-acct-item', 'min-[1280px]:!hidden');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('has no capitals, group titles, icons or badges', async () => {
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

  it('shows real counters next to «Повторение» and «Дневник ошибок»', async () => {
    renderAt('/dashboard');
    const nav = deskNav();
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Повторение 11' })).toBeInTheDocument());
    expect(within(nav).getByRole('link', { name: 'Дневник ошибок 5' })).toHaveAttribute('href', '/mistakes');
    expect(mocks.countDueCards).toHaveBeenCalledWith('user-1');
  });

  it('shows no counter at all when a count is zero or could not be read', async () => {
    mocks.countDueCards.mockRejectedValue(new Error('offline'));
    mocks.openMistakes.count = 0;
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.countDueCards).toHaveBeenCalled());
    await act(async () => undefined);
    expect(within(deskNav()).getByRole('link', { name: 'Повторение' }).textContent).toBe('Повторение');
    expect(within(deskNav()).getByRole('link', { name: 'Дневник ошибок' }).textContent).toBe('Дневник ошибок');
  });

  it('keeps «Добавить лекцию» as the outlined button of the line', async () => {
    renderAt('/analyze');
    const cta = within(bar()).getByRole('link', { name: 'Добавить лекцию' });
    expect(cta).toHaveAttribute('href', '/analyze');
    expect(cta).toHaveClass('sf-nav-cta');
    expect(cta).toHaveAttribute('aria-current', 'page');
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
  it('has four text tabs at the bottom', async () => {
    renderAt('/dashboard');
    const tabs = tabBar()!;
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Сегодня', 'Экзамены', 'Библиотека', 'Повторение']);
    expect(within(tabs).getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    expect(tabs.querySelector('svg')).toBeNull();
    expect(PHONE_TABS.map((item) => item.to)).toEqual(['/dashboard', '/exams', '/library', '/review']);
    expect(DESK_LINKS.map((item) => item.to)).toContain('/knowledge-map');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('lets the tab bar step aside on detail pages and puts «‹ Родитель» in the line', async () => {
    for (const [path, label, href] of [
      ['/exams/exam-1', 'Экзамены', '/exams'],
      ['/exams/new', 'Экзамены', '/exams'],
      ['/exams/exam-1/edit', 'Лист экзамена', '/exams/exam-1'],
      ['/library/m1', 'Библиотека', '/library'],
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
    expect(hidesBottomNav('/exams/abc/draw')).toBe(false);
    expect(backLinkFor('/dashboard')).toBeNull();
    expect(backLinkFor('/exams')).toBeNull();
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

  it('on a phone also lists «Дневник ошибок», «Прогресс» and «Добавить лекцию»', async () => {
    renderAt('/dashboard');
    openMenu();
    const menu = screen.getByRole('dialog', { name: 'Меню аккаунта' });
    for (const [name, href] of [
      [/Дневник ошибок/, '/mistakes'],
      [/Прогресс/, '/analytics'],
      [/Добавить лекцию/, '/analyze'],
    ] as const) {
      const link = within(menu).getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveClass('sf-acct-phone');
    }
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('gives a teacher «Мои группы» and «Диалоги и друзья»', async () => {
    mocks.getProfile.mockResolvedValue({ is_pro: false, role: 'teacher' });
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
      release({ default: () => <p>Библиотека загружена</p> });
    });
    expect(await screen.findByText('Библиотека загружена')).toBeInTheDocument();
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
