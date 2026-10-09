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
  from: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'alina@example.com', user_metadata: { full_name: 'Алина' } }, signOut: mocks.signOut }),
}));
vi.mock('../api/social', () => ({ getProfile: (...args: unknown[]) => mocks.getProfile(...args), markOnboardingTourSeen: vi.fn(async () => undefined) }));
vi.mock('../api/limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/limits')>();
  return { ...actual, checkAILimit: (...args: unknown[]) => mocks.checkAILimit(...args) };
});
vi.mock('../api/flashcards', () => ({ countDueCards: (...args: unknown[]) => mocks.countDueCards(...args) }));
vi.mock('../lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mocks.from(...args) } }));
vi.mock('../contexts/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light', setTheme: mocks.setTheme }) }));
vi.mock('../hooks/useInstallPWA', () => ({ useInstallPWA: () => ({ handleInstallClick: vi.fn(), showInstall: false }) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));

import Layout, { DESK_LINKS, NAV_ITEMS, PHONE_TABS, backLinkFor, hidesBottomNav, isRoomPath, quotaRemaining, sectionOf } from './Layout';
import { LOW_SHARE, quotaLevel, quotaSentence } from './QuotaMeter';
import { rememberAttachedExams, rememberContainerTitle } from '../lib/containers/titleCache';
import { formatLimitReset, nextLimitReset } from '../api/limits';
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
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Алина: профиль, справка, тема, выход/ }));
/** The guide was seen, so a student's first run does not cover the shell in these tests (Guide.test.tsx covers it). */
const profile = (extra: Record<string, unknown> = {}) => ({ is_pro: false, role: 'student', onboarding_status: { guide: true }, ...extra });

beforeEach(() => {
  mocks.checkAILimit.mockReset().mockResolvedValue({ allowed: true, isPro: false, count: 30, ok: true });
  mocks.getProfile.mockReset().mockResolvedValue(profile());
  mocks.countDueCards.mockReset().mockResolvedValue(11);
  mocks.from.mockReset();
  mocks.setTheme.mockReset();
  mocks.signOut.mockReset();
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

  it('has no capitals, group titles, icons or badges in the top line; the only drawing is the limit ring', async () => {
    renderAt('/dashboard');
    const header = bar();
    const meter = within(header).getByTestId('quota-meter');
    expect(Array.from(header.querySelectorAll('svg')).filter((svg) => !meter.contains(svg))).toEqual([]);
    expect(header.querySelector('h3')).toBeNull();
    expect(header.innerHTML).not.toMatch(/uppercase|tracking-|animate-|bg-rose|bg-cyan|⚡/);
    expect(header.textContent).not.toMatch(/УЧЁБА|ПРАКТИКА|ПРОГРЕСС|Энерги/);
    // «Лимит» is said once, by the meter.
    const rest = header.cloneNode(true) as HTMLElement;
    rest.querySelector('[data-testid="quota-meter"]')?.remove();
    expect(rest.textContent).not.toMatch(/Лимит/);
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

  it('keeps «Разобрать лекцию» as the button of the line, a round «+» with the same name on a phone', async () => {
    // The analysis (/analyze, 20 units) is named apart from the free «Добавить лекцию» of «Сегодня» (live run of 2026-10-07).
    renderAt('/analyze');
    const cta = within(bar()).getByRole('link', { name: 'Разобрать лекцию' });
    expect(cta).toHaveAttribute('href', '/analyze');
    expect(cta).toHaveClass('sf-nav-cta');
    expect(cta).toHaveAttribute('aria-current', 'page');
    expect(cta.querySelector('.sf-cta-plus')).toHaveAttribute('aria-hidden', 'true');
    expect(cta.querySelector('.sf-cta-t')).toHaveTextContent('Разобрать лекцию');
    // On a phone «+ Лекция» (the word for the eye only; the name stays «Разобрать лекцию»), so it is
    // not taken for a page's own «Новый экзамен +».
    expect(cta.querySelector('.sf-cta-short')).toHaveTextContent('Лекция');
    expect(cta.querySelector('.sf-cta-short')).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
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

  it('puts the cards due on the «Повторение» tab as a badge, «99+» above 99', async () => {
    renderAt('/dashboard');
    const tabs = tabBar()!;
    await waitFor(() => expect(within(tabs).getByRole('link', { name: 'Повторение 11' })).toBeInTheDocument());
    expect(tabs.querySelectorAll('.sf-tab-n')).toHaveLength(1);
    expect(tabs.querySelector('.sf-tab-n')).toHaveTextContent('11');
    cleanup();

    mocks.countDueCards.mockResolvedValue(140);
    renderAt('/review');
    await waitFor(() => expect(within(tabBar()!).getByRole('link', { name: 'Повторение 99+' })).toBeInTheDocument());
    cleanup();

    mocks.countDueCards.mockResolvedValue(0);
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.countDueCards).toHaveBeenCalled());
    expect(tabBar()!.querySelector('.sf-tab-n')).toBeNull();
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
    expect(isRoomPath('/exams/abc/report')).toBe(true);
    expect(isRoomPath('/exams/abc/report/')).toBe(true);
    expect(isRoomPath('/exams/report')).toBe(false);
    expect(isRoomPath('/library/abc/talk')).toBe(true);
    expect(isRoomPath('/library/abc/talk/')).toBe(true);
    expect(isRoomPath('/library/abc')).toBe(false);
    expect(isRoomPath('/library/talk')).toBe(false);
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

describe('the guide from the account menu (the only way to it on a phone, 10_Project/Phone_Declutter_2026-10-08)', () => {
  it('opens the guide from the account menu and gives the focus back to the account button', async () => {
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
    const button = screen.getByRole('button', { name: /Алина: профиль, справка, тема, выход/ });
    openMenu();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Меню аккаунта' })).getByRole('button', { name: 'Как пользоваться Meldy' }));
    expect(screen.queryByRole('dialog', { name: 'Меню аккаунта' })).toBeNull();
    const panel = document.querySelector('section.gd') as HTMLElement;
    expect(within(panel).getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument();
    expect(panel).toHaveFocus();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(document.querySelector('section.gd')).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe('room mode', () => {
  it('renders only the page for «Тянуть билет», the answer screen and «Поговорить о лекции»', async () => {
    for (const path of ['/exams/exam-1/draw', '/exams/exam-1/ticket', '/library/m-1/talk']) {
      renderAt(path, <h1>Комната</h1>);
      expect(screen.getByRole('heading', { name: 'Комната' })).toBeInTheDocument();
      expect(document.querySelector('header.sf-bar')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Повторение' })).toBeNull();
      cleanup();
    }
  });
});

describe('the exam container (spec decision 23)', () => {
  const C = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
  const C2 = '0b6f3c2e-9a1d-4e7b-8c5a-2d4e6f8a0b1c';
  const S = '69ead689-38d6-4350-bc5d-13d273f8b9b2';
  const ORAL = 'c0390f9c-787d-4d0e-a82d-9efa069bfe11';
  const toContainer = (label: string, id = C) => ({ to: `/exams/c/${id}`, label });
  const EXAMS = { to: '/exams', label: 'Экзамены' };

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('makes the «занятие» and «Как на экзамене» rooms, and nothing else of the container', () => {
    for (const path of [`/exams/c/${C}/study`, `/exams/c/${C}/mock`, `/exams/c/${C}/study/`, `/exams/c/${C}/mock/`]) {
      expect(isRoomPath(path), path).toBe(true);
    }
    for (const path of [
      `/exams/c/${C}`, `/exams/c/${C}/`, `/exams/c/${C}/s/${S}`, `/exams/c/${C}/keys`, `/exams/c/${C}/settings`, '/exams/import',
      '/g/abcd2fghjkmn', '/exams/c/draw', '/exams/c/ticket',
    ]) {
      expect(isRoomPath(path), path).toBe(false);
    }
    // The oral rooms stay rooms.
    for (const path of [`/exams/${ORAL}/draw`, `/exams/${ORAL}/ticket`, `/exams/${ORAL}/report`]) expect(isRoomPath(path), path).toBe(true);
  });

  it('steps the tab bar aside on every page of an exam container, the import page and the group link', () => {
    for (const path of ['/exams/import', `/exams/c/${C}`, `/exams/c/${C}/`, '/exams/c/draw', `/exams/c/${C}/s/${S}`, `/exams/c/${C}/keys`, `/exams/c/${C}/settings`, '/g/abcd2fghjkmn']) {
      expect(hidesBottomNav(path), path).toBe(true);
    }
    expect(hidesBottomNav('/exams'), '/exams').toBe(false);
  });

  it('leads from the pages under an exam back to it, with its title when this tab knows it', () => {
    for (const page of [`s/${S}`, 'keys', 'settings', 'study', 'mock']) {
      expect(backLinkFor(`/exams/c/${C}/${page}`), page).toEqual(toContainer('Назад'));
    }
    rememberContainerTitle(C, 'Зимняя сессия');
    for (const page of [`s/${S}`, 'keys', 'settings', 'study', 'mock']) {
      expect(backLinkFor(`/exams/c/${C}/${page}/`), page).toEqual(toContainer('Зимняя сессия'));
    }
    expect(backLinkFor(`/exams/c/${C}`)).toEqual(EXAMS);
    expect(backLinkFor('/exams/c/draw')).toEqual(EXAMS);
    expect(backLinkFor('/exams/import')).toEqual(EXAMS);
    expect(backLinkFor('/exams/import', `?from=c:${C}`)).toEqual(toContainer('Зимняя сессия'));
  });

  it('leads an oral page opened with ?from=c:<id> back to that exam, «‹ Назад» while its title is unknown', () => {
    for (const [path, search] of [
      [`/exams/${ORAL}`, `?from=c:${C}`],
      [`/exams/${ORAL}/`, `?view=sheet&from=c:${C}`],
      [`/exams/${ORAL}/edit`, `?from=c%3A${C}`],
      [`/exams/${ORAL}/draw`, `?mode=awaiting&from=c:${C}`],
      [`/exams/${ORAL}/ticket`, `?q=q-17&from=c:${C}`],
      [`/exams/${ORAL}/report`, `?from=c:${C}`],
    ] as const) {
      expect(backLinkFor(path, search), path).toEqual(toContainer('Назад'));
    }
    rememberContainerTitle(C, 'Зимняя сессия');
    expect(backLinkFor(`/exams/${ORAL}`, `?from=c:${C}`)).toEqual(toContainer('Зимняя сессия'));
  });

  it('knows an oral exam that lives in a container without ?from (it is lost on the first move), and ?from wins', () => {
    rememberAttachedExams({ [ORAL]: { containerId: C, title: 'Зимняя сессия' } });
    for (const path of [`/exams/${ORAL}`, `/exams/${ORAL}/edit`, `/exams/${ORAL}/draw`, `/exams/${ORAL}/ticket`, `/exams/${ORAL}/report`]) {
      expect(backLinkFor(path), path).toEqual(toContainer('Зимняя сессия'));
    }
    rememberContainerTitle(C2, 'Летняя сессия');
    expect(backLinkFor(`/exams/${ORAL}`, `?from=c:${C2}`)).toEqual(toContainer('Летняя сессия', C2));
    // A new tab: only the device's copy of the map.
    window.sessionStorage.clear();
    expect(backLinkFor(`/exams/${ORAL}/ticket`, '?q=q-1')).toEqual(toContainer('Зимняя сессия'));
  });

  it('keeps every plain exam as it was, and ignores a ?from that is not a container id', () => {
    rememberAttachedExams({ [ORAL]: { containerId: C, title: 'Зимняя сессия' } });
    expect(backLinkFor('/exams/exam-1')).toEqual(EXAMS);
    expect(backLinkFor('/exams/exam-1/edit')).toEqual({ to: '/exams/exam-1', label: 'Лист экзамена' });
    expect(backLinkFor('/exams/exam-1/draw')).toBeNull();
    expect(backLinkFor('/exams/new', `?from=c:${C}`)).toEqual(EXAMS);
    for (const search of ['?from=c:', '?from=c:../../dashboard', '?from=c:a/b', `?from=x:${C}`, `?from=${C}`, '?from=c:%2Fevil']) {
      expect(backLinkFor('/exams/exam-1', search), search).toEqual(EXAMS);
    }
  });

  it('puts «‹ Зимняя сессия» in the phone line of an oral page reached from the exam', async () => {
    rememberContainerTitle(C, 'Зимняя сессия');
    renderAt(`/exams/${ORAL}?from=c:${C}`);
    const back = document.querySelector('.sf-back') as HTMLAnchorElement;
    expect(back.textContent).toBe('Зимняя сессия');
    expect(back).toHaveAttribute('href', `/exams/c/${C}`);
    expect(tabBar()).toBeNull();
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('draws the title once the page has read it', async () => {
    renderAt(`/exams/c/${C}/keys`);
    const back = () => document.querySelector('.sf-back') as HTMLAnchorElement;
    expect(back().textContent).toBe('Назад');
    expect(back()).toHaveAttribute('href', `/exams/c/${C}`);
    expect(tabBar()).toBeNull();
    act(() => rememberContainerTitle(C, 'Зимняя сессия'));
    expect(back().textContent).toBe('Зимняя сессия');
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('shows «‹ Экзамены» without the tabs on the exam page; renders the «занятие» as a room', async () => {
    renderAt(`/exams/c/${C}`);
    expect(tabBar()).toBeNull();
    expect(document.querySelector('.sf-back')).toHaveAttribute('href', '/exams');
    expect(within(deskNav()).getByRole('link', { name: 'Экзамены' })).toHaveAttribute('aria-current', 'page');
    cleanup();
    for (const path of [`/exams/c/${C}/study?s=${S}`, `/exams/c/${C}/mock`]) {
      renderAt(path, <h1>Комната</h1>);
      expect(screen.getByRole('heading', { name: 'Комната' })).toBeInTheDocument();
      expect(document.querySelector('header.sf-bar')).toBeNull();
      expect(tabBar()).toBeNull();
      cleanup();
    }
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
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
});

describe('account menu', () => {
  it('holds the profile, the theme, projector mode, the way to PRO and «Выйти»; Escape closes it', async () => {
    renderAt('/dashboard');
    const button = screen.getByRole('button', { name: /Алина: профиль, справка, тема, выход/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    const menu = screen.getByRole('dialog', { name: 'Меню аккаунта' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByText('alina@example.com')).toHaveAttribute('title', 'alina@example.com');
    expect(within(menu).getByRole('link', { name: 'Профиль' })).toHaveAttribute('href', '/profile');
    expect(within(menu).getByRole('button', { name: 'Светлая' })).toHaveAttribute('aria-pressed', 'true');
    // Three one-word themes in one row; the third explains itself on hover.
    expect(within(within(menu).getByRole('group', { name: 'Тема' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Светлая',
      'Тёмная',
      'Системная',
    ]);
    expect(within(menu).getByRole('button', { name: 'Системная' })).toHaveAttribute('title', 'Как в настройках устройства');
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
    expect(within(menu).queryByRole('link', { name: /Карта знаний|Дневник ошибок|Прогресс|Разобрать лекцию/ })).toBeNull();
    expect(within(menu).getByRole('button', { name: 'Как пользоваться Meldy' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
  });

  it('has no groups, dialogs or notifications, for a teacher account too', async () => {
    mocks.getProfile.mockResolvedValue(profile({ role: 'teacher' }));
    renderAt('/dashboard');
    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
    await act(async () => undefined);
    openMenu();
    const menu = screen.getByRole('dialog', { name: 'Меню аккаунта' });
    expect(within(menu).getByRole('link', { name: 'Профиль' })).toHaveAttribute('href', '/profile');
    expect(within(menu).queryByRole('link', { name: /Мои группы|Диалоги/ })).toBeNull();
    expect(within(menu).queryByRole('button', { name: /Уведомления/ })).toBeNull();
    expect(within(menu).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/profile']);
  });
});

describe('the daily limit meter in the top line', () => {
  const resetAt = () => formatLimitReset(nextLimitReset());
  const meter = () => within(bar()).getByTestId('quota-meter');
  const number = () => meter().querySelector('.sf-quota-n')?.textContent;
  const arc = () => meter().querySelector('.sf-quota-arc')?.getAttribute('stroke-dasharray');
  const free = (count: number, extra: Record<string, unknown> = {}) => ({ allowed: count < 100, isPro: false, count, ok: true, limit: 100, ...extra });

  it('sits between «Разобрать лекцию» and «?»: a ring and the units left, the sentence as its name', async () => {
    renderAt('/dashboard');
    await waitFor(() => expect(number()).toBe('70'));
    const cta = within(bar()).getByRole('link', { name: 'Разобрать лекцию' });
    const help = within(bar()).getByRole('button', { name: 'Как пользоваться Meldy' });
    expect(cta.compareDocumentPosition(meter()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(meter().compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(meter().tagName).toBe('BUTTON');
    expect(meter()).toHaveAccessibleName(`Лимит ИИ: осталось 70 из 100, обновится в ${resetAt()}`);
    expect(meter().querySelector('.sf-quota-t')).toHaveTextContent('Лимит ИИ');
    expect(meter().querySelector('.sf-quota-tip')).toHaveTextContent(`Лимит ИИ: осталось 70 из 100, обновится в ${resetAt()}`);
    expect(meter()).toHaveAttribute('data-level', 'ok');
    expect(arc()).toBe('70.00 100');
    // A phone draws the open gauge (quotaMeter.css): 92 % of the circle, the gap at the top, the arc in proportion.
    const open = meter().querySelectorAll('.sf-quota-open');
    expect(open).toHaveLength(2);
    expect(open[0].getAttribute('stroke-dasharray')).toBe('92 100');
    expect(open[1].getAttribute('stroke-dasharray')).toBe('64.40 100');
    expect(open[1].getAttribute('transform')).toBe('rotate(-75.6 20 20)');
    expect(mocks.checkAILimit).toHaveBeenCalledWith('user-1', 0);
  });

  it('reads the limit again after every AI action and never shows a negative number', async () => {
    renderAt('/dashboard');
    await waitFor(() => expect(number()).toBe('70'));
    mocks.checkAILimit.mockResolvedValue(free(130, { allowed: false }));
    await act(async () => {
      window.dispatchEvent(new Event('ai_usage_updated'));
    });
    await waitFor(() => expect(number()).toBe('0'));
    expect(meter().textContent).not.toMatch(/-\d|−\d/);
    expect(meter()).toHaveAttribute('data-level', 'empty');
    expect(mocks.checkAILimit).toHaveBeenCalledTimes(2);
  });

  it('turns yellow at 20 % or less and is empty at zero', async () => {
    mocks.checkAILimit.mockResolvedValue(free(80));
    renderAt('/dashboard');
    await waitFor(() => expect(number()).toBe('20'));
    expect(meter()).toHaveAttribute('data-level', 'low');
    expect(LOW_SHARE).toBe(0.2);
    expect(quotaLevel(21, 100, true)).toBe('ok');
    expect(quotaLevel(20, 100, true)).toBe('low');
    expect(quotaLevel(1, 100, true)).toBe('low');
    expect(quotaLevel(0, 100, true)).toBe('empty');
    expect(quotaLevel(200, 1000, true)).toBe('low');
    expect(quotaLevel(null, 100, false)).toBe('loading');
    expect(quotaLevel(null, 100, true)).toBe('unknown');
  });

  it('explains the limit on a click: what is left, when it comes back, the prices and «Что даёт PRO»', async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_PRO_EVENT, opened);
    try {
      renderAt('/dashboard');
      await waitFor(() => expect(number()).toBe('70'));
      fireEvent.click(meter());
      const dialog = screen.getByRole('dialog', { name: 'Дневной лимит ИИ' });
      expect(within(dialog).getByText(/Осталось на сегодня:/).textContent).toBe('Осталось на сегодня: 70 из 100 единиц.');
      expect(within(dialog).getByText(`Лимит обновится в ${resetAt()}.`)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Что даёт PRO' }));
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ reason: 'meter' });
      expect(screen.queryByRole('dialog', { name: 'Дневной лимит ИИ' })).toBeNull();
    } finally {
      window.removeEventListener(OPEN_PRO_EVENT, opened);
    }
  });

  it('with the free day spent, a click opens the PRO window for the limit instead', async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_PRO_EVENT, opened);
    try {
      mocks.checkAILimit.mockResolvedValue(free(100, { allowed: false }));
      renderAt('/dashboard');
      await waitFor(() => expect(number()).toBe('0'));
      expect(meter()).toHaveAccessibleName(`Лимит ИИ: осталось 0 из 100, обновится в ${resetAt()}`);
      fireEvent.click(meter());
      expect(opened).toHaveBeenCalledTimes(1);
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ reason: 'limit' });
      expect(screen.queryByRole('dialog', { name: 'Дневной лимит ИИ' })).toBeNull();
    } finally {
      window.removeEventListener(OPEN_PRO_EVENT, opened);
    }
  });

  it('shows a PRO account the same meter out of 1000, and its menu says «Тариф PRO» instead of offering it', async () => {
    mocks.getProfile.mockResolvedValue(profile({ is_pro: true }));
    mocks.checkAILimit.mockResolvedValue({ allowed: true, isPro: true, count: 250, ok: true, limit: 1000 });
    renderAt('/dashboard');
    await waitFor(() => expect(number()).toBe('750'));
    expect(meter()).toHaveAccessibleName(`Лимит ИИ (PRO): осталось 750 из 1000, обновится в ${resetAt()}`);
    expect(meter()).toHaveAttribute('data-pro');
    expect(arc()).toBe('75.00 100');
    await act(async () => undefined);
    openMenu();
    const menu = screen.getByRole('dialog', { name: 'Меню аккаунта' });
    expect(within(menu).queryByRole('button', { name: 'Что даёт PRO' })).toBeNull();
    expect(within(menu).getByRole('button', { name: /Тариф PRO/ })).toHaveTextContent('Тариф PROвключён');
    // The limit itself is no longer a row of the menu: the meter is always in sight.
    expect(within(menu).queryByTestId('quota-meter')).toBeNull();
    expect(within(menu).queryByText(/Дневной лимит/)).toBeNull();
  });

  it('a PRO account at zero still gets the explanation, not an offer of PRO', async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_PRO_EVENT, opened);
    try {
      mocks.getProfile.mockResolvedValue(profile({ is_pro: true }));
      mocks.checkAILimit.mockResolvedValue({ allowed: false, isPro: true, count: 1000, ok: true, limit: 1000 });
      renderAt('/dashboard');
      await waitFor(() => expect(number()).toBe('0'));
      fireEvent.click(meter());
      const dialog = screen.getByRole('dialog', { name: 'Дневной лимит ИИ' });
      expect(within(dialog).queryByRole('button', { name: 'Что даёт PRO' })).toBeNull();
      expect(opened).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(OPEN_PRO_EVENT, opened);
    }
  });

  it('does not pretend the limit is full when the counter could not be read: a dash, and a click reads again', async () => {
    mocks.checkAILimit.mockResolvedValue({ allowed: true, isPro: false, count: 0, ok: false });
    renderAt('/dashboard');
    await waitFor(() => expect(meter()).toHaveAttribute('data-level', 'unknown'));
    expect(meter()).toHaveAccessibleName('Лимит ИИ: остаток не удалось загрузить. Нажмите, чтобы проверить ещё раз');
    expect(number()).toBe('—');
    fireEvent.click(meter());
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Дневной лимит ИИ' })).toBeNull();
  });

  it('follows a plan change: the PRO window\'s events read the limit and the profile again', async () => {
    renderAt('/dashboard');
    await waitFor(() => expect(number()).toBe('70'));
    mocks.getProfile.mockResolvedValue(profile({ is_pro: true }));
    mocks.checkAILimit.mockResolvedValue({ allowed: true, isPro: true, count: 30, ok: true, limit: 1000 });
    await act(async () => {
      window.dispatchEvent(new Event('ai_usage_updated'));
      window.dispatchEvent(new Event('profile_updated'));
    });
    await waitFor(() => expect(number()).toBe('970'));
    expect(meter()).toHaveAccessibleName(/^Лимит ИИ \(PRO\): осталось 970 из 1000/);
    openMenu();
    expect(within(screen.getByRole('dialog', { name: 'Меню аккаунта' })).getByRole('button', { name: /Тариф PRO/ })).toBeInTheDocument();
  });

  it('says the same sentence in words for every state', () => {
    expect(quotaSentence('ok', 80, 100, false, '3:00')).toBe('Лимит ИИ: осталось 80 из 100, обновится в 3:00');
    expect(quotaSentence('empty', 0, 1000, true, '3:00')).toBe('Лимит ИИ (PRO): осталось 0 из 1000, обновится в 3:00');
    expect(quotaSentence('loading', null, 100, false)).toBe('Лимит ИИ: загружаем остаток');
  });

  it('offers «Что даёт PRO» in the account menu to an account without PRO', async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_PRO_EVENT, opened);
    try {
      renderAt('/dashboard');
      await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
      await act(async () => undefined);
      openMenu();
      const menu = screen.getByRole('dialog', { name: 'Меню аккаунта' });
      fireEvent.click(within(menu).getByRole('button', { name: 'Что даёт PRO' }));
      expect(opened).toHaveBeenCalledTimes(1);
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ reason: 'meter' });
      expect(screen.queryByRole('dialog', { name: 'Меню аккаунта' })).toBeNull();
    } finally {
      window.removeEventListener(OPEN_PRO_EVENT, opened);
    }
  });

  it('never goes below zero', () => {
    expect(quotaRemaining(30)).toBe(70);
    expect(quotaRemaining(100)).toBe(0);
    expect(quotaRemaining(250)).toBe(0);
    expect(quotaRemaining(-5)).toBe(100);
    expect(quotaRemaining(null)).toBeNull();
    expect(quotaRemaining(250, 1000)).toBe(750);
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
