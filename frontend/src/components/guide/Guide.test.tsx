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
import { GUIDE_CHAPTERS, chapterIndexFor, limitChapterText, mayLeave } from './chapters';
import { GUIDE_SEEN_KEY } from './GuideContext';
import { deferGuideOnce } from './guideLater';
import { GUIDE_CLIPS } from './clips';
import { LIMIT_FLY, LIMIT_SPENDS, limitMeterAt } from './scenes';
import { formatLimitReset, nextLimitReset } from '../../api/limits';
import { AI_COSTS, FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../../lib/plans';

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
  it('follow the menu, in its words: the map is told in «Прогресс», the mistakes diary in «Повторение»; the limit comes last', () => {
    expect(GUIDE_CHAPTERS.map((chapter) => chapter.tab)).toEqual([
      'Сегодня',
      'Разобрать лекцию',
      'Лекции',
      'Экзамены',
      'Повторение',
      'Прогресс',
      'Лимит ИИ',
    ]);
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

  it('tell the limit with the numbers of lib/plans.ts and the real reset time, and light up the meter', () => {
    const limit = GUIDE_CHAPTERS[GUIDE_CHAPTERS.length - 1];
    expect(limit).toMatchObject({ id: 'limit', title: 'Лимит ИИ', spot: 'meter' });
    // No page of its own: the meter is in the top line of every page.
    expect(limit.route).toBeUndefined();
    expect(limit.match).toBeUndefined();
    const resetAt = formatLimitReset(nextLimitReset());
    expect(limit.text).toBe(limitChapterText(resetAt));
    expect(limit.text).toBe(
      `Действия с ИИ тратят единицы дневного лимита: анализ лекции — ${AI_COSTS.lecture}, проверка ответа — ${AI_COSTS.answer}, подкаст — ${AI_COSTS.conversation}. ` +
        `В день — ${FREE_DAILY_UNITS} единиц, с PRO — ${PRO_DAILY_UNITS}; лимит обновляется ночью, в ${resetAt}, а остаток виден вверху справа.`,
    );
    expect(limitChapterText('3:00')).toContain('лимит обновляется ночью, в 3:00,');
    // Decision 1 and finding LIB-20: the two-host audio is «Подкаст»; 15 МБ hold a part of a pair, not a whole one.
    const analyze = GUIDE_CHAPTERS.find((chapter) => chapter.route === '/analyze')!;
    expect(analyze.title).toBe('Разобрать лекцию');
    expect(analyze.text).toContain('запись части пары');
    const lectures = GUIDE_CHAPTERS.find((chapter) => chapter.route === '/library')!;
    expect(lectures.text).toContain('во вкладке «Подкаст»');
    expect(GUIDE_CHAPTERS.map((chapter) => chapter.text).join(' ')).not.toMatch(/[Рр]азговор/);
    expect(limit.phone).toBe('На телефоне — кружок с числом.');
  });

  it('give the limit its own clip: the prices of a lecture and an answer fly into the meter, from lib/plans.ts', () => {
    const clip = GUIDE_CLIPS.limit;
    expect(clip.total).toBe(GUIDE_CLIPS.today.total);
    expect(LIMIT_SPENDS.map((spend) => spend.cost)).toEqual([AI_COSTS.lecture, AI_COSTS.answer]);
    expect(limitMeterAt(0)).toBe(FREE_DAILY_UNITS);
    expect(limitMeterAt(clip.poster)).toBe(FREE_DAILY_UNITS - AI_COSTS.lecture - AI_COSTS.answer);
    // The still frame (reduced motion) shows the meter after both prices, nothing in flight.
    expect(LIMIT_SPENDS.every((spend) => spend.at + LIMIT_FLY < clip.poster)).toBe(true);
    expect(limitMeterAt(LIMIT_SPENDS[0].at + LIMIT_FLY - 1)).toBe(FREE_DAILY_UNITS);
    expect(limitMeterAt(LIMIT_SPENDS[0].at + LIMIT_FLY)).toBe(FREE_DAILY_UNITS - AI_COSTS.lecture);
    expect(clip.poster).toBeLessThan(clip.total - 760);
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
    expect(within(panel()!).getByRole('heading', { name: 'Разобрать лекцию' })).toBeInTheDocument();
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
    // The last chapter is the limit: the app stays put, the meter in the top line lights up.
    next();
    expect(where()).toBe('/analytics');
    expect(within(panel()!).getByRole('heading', { name: 'Лимит ИИ' })).toBeInTheDocument();
    expect(screen.getByTestId('quota-meter')).toHaveAttribute('data-guide-spot');
    expect(document.querySelectorAll('[data-guide-spot]')).toHaveLength(1);
    expect(within(panel()!).queryByRole('link', { name: 'Открыть раздел' })).toBeNull();
    expect(within(panel()!).queryByRole('button', { name: /Дальше/ })).toBeNull();
    expect(within(panel()!).getByRole('button', { name: 'Начать' })).toBeInTheDocument();
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

describe('the first run after a group link (guideLater)', () => {
  afterEach(() => window.sessionStorage.clear());

  it('waits: the copy of the exam stays on screen, «?» still opens the guide, the next visit shows the first run', async () => {
    deferGuideOnce(); // what /join/<код> does before it opens the copy
    renderAt('/exams/copy-1');
    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(panel()).toBeNull();
    expect(where()).toBe('/exams/copy-1');
    expect(document.querySelector('[inert]')).toBeNull();
    expect(window.localStorage.getItem(GUIDE_SEEN_KEY)).toBeNull();
    expect(mocks.markSeen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Как пользоваться Meldy' }));
    expect(panel()).toHaveAttribute('aria-modal', 'false');
    cleanup();

    // Another visit (a new tab): the first run as usual (an exam's own page is not left for «Сегодня»).
    window.sessionStorage.clear();
    renderAt('/exams/copy-1');
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(panel()).toHaveAttribute('aria-modal', 'true');
    expect(where()).toBe('/exams/copy-1');
  });
});
