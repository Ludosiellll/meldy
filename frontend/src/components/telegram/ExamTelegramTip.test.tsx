import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerData, Loadable } from '../../lib/containers/hooks';
import type { TelegramState } from '../../api/telegram';

/* The Telegram bot's first-use tip on the exam's page (ExamTelegramTip.tsx, tips.ts `telegram`). */

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  guide: { open: false, start: () => undefined } as { open: boolean; start: () => void },
  userId: 'user-1' as string | undefined,
  getProfile: vi.fn(),
  markSeen: vi.fn(),
  track: vi.fn(),
  fetchState: vi.fn(),
  startLink: vi.fn(),
}));

vi.mock('../../lib/containers/hooks', () => ({ useContainerData: () => mocks.state }));
vi.mock('../../lib/containers/plan', async (original) => (await import('../containers/testkit/engine')).planModule(original));
vi.mock('../../lib/containers/session', async (original) => (await import('../containers/testkit/engine')).sessionModule(original));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.userId ? { id: mocks.userId } : null, loading: false }) }));
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }) }));
vi.mock('../guide/GuideContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../guide/GuideContext')>()),
  useGuide: () => mocks.guide,
}));
vi.mock('../../api/social', () => ({
  getProfile: (...args: unknown[]) => mocks.getProfile(...args),
  markOnboardingTourSeen: (...args: unknown[]) => mocks.markSeen(...args),
}));
vi.mock('../../lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/telemetry')>()),
  track: (...args: unknown[]) => mocks.track(...args),
}));
vi.mock('../../api/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/telegram')>()),
  fetchTelegramState: (...args: unknown[]) => mocks.fetchState(...args),
  startTelegramLink: (...args: unknown[]) => mocks.startLink(...args),
}));
// The clip's file (the reel engine and the scenes) is not needed here: TipClip.test plays it.
vi.mock('../tips/clipPart', async () => {
  const { lazyPart } = await import('../../lib/lazyPart');
  return { tipClipPart: lazyPart(async () => () => <div data-testid="clip" />) };
});

import ContainerPage from '../../pages/container/ContainerPage';
import { telegramTipWorthy, useExamTelegramTip } from './ExamTelegramTip';
import { TELEGRAM_COPY } from './TelegramCard';
import { TIPS } from '../tips/tips';
import { TIP_SETTLE_MS } from '../tips/useFirstUseTip';
import { PHONE_QUERY } from '../../lib/usePhone';
import { CONTAINER, containerData, dayPlan, subject, summary } from '../containers/testkit/fixtures';

const HEX = '0123456789abcdef0123456789abcdef';
const URL_OF_CODE = `https://t.me/Meldyteach_bot?start=L${HEX}`;
const UA = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

function telegram(linked: boolean): TelegramState {
  return {
    linked,
    bot: 'Meldyteach_bot',
    remindOn: true,
    remindAt: '20:00',
    zone: linked ? 'Europe/Minsk' : null,
    pausedUntil: null,
    blocked: false,
    linkedAt: linked ? '2026-10-10T12:00:00Z' : null,
  };
}

function loaded(data: ContainerData): Loadable<ContainerData> {
  return { data, loading: false, offline: false, unavailable: false, error: null, reload: vi.fn() };
}

function setAgent(agent: string, touchPoints = 0) {
  Object.defineProperty(window.navigator, 'userAgent', { value: agent, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

function setPhone(phone: boolean) {
  if (!phone) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    return;
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

/** The tip's hook where the page is not the exam's own (the example /try). */
function Probe() {
  const data = containerData();
  const { tip } = useExamTelegramTip({ summary: data.summary, plan: dayPlan() });
  return <p data-testid="probe">{tip ? 'tip' : 'none'}</p>;
}

function renderPage(data: ContainerData = containerData(), path = `/exams/c/${CONTAINER}`) {
  mocks.state = loaded(data);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/c/:id" element={<ContainerPage />} />
        <Route path="/try/*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The state read, the profile read, the page settled (fake timers). */
async function settle(ms = TIP_SETTLE_MS + 50) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

const tip = () => document.querySelector('.tp-card');
const planCard = () => document.querySelector('section.ct-plan') as HTMLElement;
/** One subject with variants, answered in: SubjectView, the exam's own page. */
const solo = (patch: Parameters<typeof subject>[0] = {}) => containerData({ summary: summary({ subjects: [subject(patch)] }) });

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  mocks.guide = { open: false, start: () => undefined };
  mocks.userId = 'user-1';
  mocks.getProfile.mockReset().mockResolvedValue({ id: 'user-1', onboarding_status: { guide: true } });
  mocks.markSeen.mockReset().mockResolvedValue(undefined);
  mocks.track.mockReset();
  mocks.fetchState.mockReset().mockResolvedValue(telegram(false));
  mocks.startLink
    .mockReset()
    .mockResolvedValue({ code: `L${HEX}`, url: URL_OF_CODE, bot: 'Meldyteach_bot', expiresAt: '2026-10-10T12:15:00Z' });
  setAgent(UA.desktop);
  setPhone(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setPhone(false);
});

describe('the Telegram tip on the exam page', () => {
  it('comes once the page has settled: under today’s plan, the plan ringed, in the profile card’s words', async () => {
    renderPage();
    await settle(10);
    expect(tip()).toBeNull();
    await settle();
    const card = screen.getByRole('region', { name: TIPS.telegram.title });
    expect(card).toHaveAccessibleDescription(TIPS.telegram.text);
    expect(screen.getByTestId('clip')).toBeInTheDocument();
    // Right after the plan card, which wears the ring: Tab goes from the plan to the tip.
    expect(planCard().nextElementSibling).toBe(card);
    expect(planCard()).toHaveAttribute('data-tip-spot');
    expect(within(card).getByRole('button', { name: TELEGRAM_COPY.connect })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Не сейчас' })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    expect(mocks.fetchState).toHaveBeenCalledTimes(1);
    expect(mocks.getProfile).toHaveBeenCalledWith('user-1');
    expect(mocks.track).toHaveBeenCalledWith('tip_shown', { id: 'telegram' });
  });

  it('says what the profile card says: its title, its line (set as the card sets it) and its button', () => {
    expect(TIPS.telegram.title).toBe(TELEGRAM_COPY.title);
    expect(TIPS.telegram.text.replace(/\u00a0/g, ' ')).toBe(TELEGRAM_COPY.about);
    expect(TIPS.telegram.text).toContain('20\u00a0за');
    expect(TIPS.telegram.action).toBe(TELEGRAM_COPY.connect);
    expect(TIPS.telegram.later).toBe('Не сейчас');
  });

  it('shows on an exam of one subject too (its page is the subject’s)', async () => {
    renderPage(solo());
    await settle();
    await settle();
    expect(screen.getByRole('region', { name: TIPS.telegram.title })).toBeInTheDocument();
    expect(planCard()).toHaveAttribute('data-tip-spot');
  });

  it('«Подключить Telegram» opens the link window here: a code at once, the QR code on a computer; the tip is used', async () => {
    renderPage();
    await settle();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: TELEGRAM_COPY.connect }));
    expect(tip()).toBeNull();
    expect(planCard()).not.toHaveAttribute('data-tip-spot');
    const dialog = screen.getByRole('dialog', { name: TELEGRAM_COPY.title });
    await settle(0);
    expect(mocks.startLink).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('img', { name: TELEGRAM_COPY.qr })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: TELEGRAM_COPY.openHere })).toHaveAttribute('href', URL_OF_CODE);
    // Used: here and in the profile, reported once as «try».
    expect(window.localStorage.getItem('meldy_tip_telegram')).toBe('1');
    expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'tip_telegram');
    expect(mocks.track).toHaveBeenCalledWith('tip_action', { id: 'telegram', action: 'try' });
    // «Отмена» closes the window; the focus goes to today's plan.
    fireEvent.click(within(dialog).getByRole('button', { name: TELEGRAM_COPY.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toHaveClass('ct-plan-t');
  });

  it('on a phone the tip is a sheet above the «Начать» bar, and its window opens the bot in the app', async () => {
    setAgent(UA.iphone, 5);
    setPhone(true);
    vi.stubGlobal('innerWidth', 390);
    renderPage();
    await settle();
    await settle();
    expect(tip()).toHaveAttribute('data-layout', 'sheet');
    expect(document.querySelector('.ct-cta')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: TELEGRAM_COPY.connect }));
    await settle(0);
    const dialog = screen.getByRole('dialog', { name: TELEGRAM_COPY.title });
    const open = within(dialog).getByRole('link', { name: TELEGRAM_COPY.openApp });
    expect(open).toHaveAttribute('href', URL_OF_CODE);
    expect(open).toHaveClass('sf-primary');
    expect(within(dialog).queryByRole('img', { name: TELEGRAM_COPY.qr })).toBeNull();
  });

  it('«Не сейчас» puts it away for good: here and in the profile, and no state is read on the next visit', async () => {
    renderPage();
    await settle();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }));
    expect(tip()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await settle(0);
    expect(window.localStorage.getItem('meldy_tip_telegram')).toBe('1');
    expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'tip_telegram');
    expect(mocks.track).toHaveBeenLastCalledWith('tip_action', { id: 'telegram', action: 'dismiss' });
    expect(mocks.startLink).not.toHaveBeenCalled();
    cleanup();
    mocks.fetchState.mockClear();
    renderPage();
    await settle();
    await settle();
    expect(tip()).toBeNull();
    expect(mocks.fetchState).not.toHaveBeenCalled();
  });

  it('Escape inside the card is «Не сейчас», and the focus goes back to the plan', async () => {
    renderPage();
    await settle();
    await settle();
    const later = screen.getByRole('button', { name: 'Не сейчас' });
    later.focus();
    fireEvent.keyDown(later, { key: 'Escape' });
    expect(tip()).toBeNull();
    expect(document.activeElement).toBe(planCard());
    expect(window.localStorage.getItem('meldy_tip_telegram')).toBe('1');
  });
});

describe('the Telegram tip stays away', () => {
  it('when the site has no Telegram functions (the bot is not there), without reading the profile', async () => {
    mocks.fetchState.mockResolvedValue(null);
    renderPage();
    await settle();
    await settle(2000);
    expect(tip()).toBeNull();
    expect(mocks.fetchState).toHaveBeenCalledTimes(1);
    expect(mocks.getProfile).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('meldy_tip_telegram')).toBeNull();
  });

  it('when the state cannot be read now', async () => {
    mocks.fetchState.mockRejectedValue(new Error('offline'));
    renderPage();
    await settle();
    await settle(2000);
    expect(tip()).toBeNull();
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });

  it('when the account is linked already: the feature is in use, the tip is put away unseen and not reported', async () => {
    mocks.fetchState.mockResolvedValue(telegram(true));
    renderPage();
    await settle();
    await settle(2000);
    expect(tip()).toBeNull();
    expect(window.localStorage.getItem('meldy_tip_telegram')).toBe('1');
    expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'tip_telegram');
    expect(mocks.track).not.toHaveBeenCalled();
    cleanup();
    mocks.fetchState.mockClear();
    renderPage();
    await settle(2000);
    expect(mocks.fetchState).not.toHaveBeenCalled();
  });

  it('on the first visit right after the import: nothing answered yet, nothing is asked', async () => {
    const fresh = containerData({
      summary: summary({ subjects: [subject({ seen: 0, two_days: 0, open_errors: 0, topics: [] })], answers_today: 0 }),
    });
    renderPage(fresh);
    await settle();
    await settle(2000);
    expect(tip()).toBeNull();
    expect(mocks.fetchState).not.toHaveBeenCalled();
  });

  it('when the exam has no questions with variants (what the bot asks in the chat)', async () => {
    renderPage(solo({ keyed: 0, kinds: { single: 0, multiple: 0, short: 0 } }));
    await settle();
    await settle(2000);
    expect(tip()).toBeNull();
    expect(mocks.fetchState).not.toHaveBeenCalled();
  });

  it.each(['exam_today', 'after'] as const)('when the plan has no days left to send (%s)', async (state) => {
    renderPage(containerData({ plan: dayPlan({ state, sessions: [] }) }));
    await settle();
    await settle(2000);
    expect(tip()).toBeNull();
    expect(mocks.fetchState).not.toHaveBeenCalled();
  });

  it('while the guide is open, and comes after it closes', async () => {
    mocks.guide = { open: true, start: () => undefined };
    const view = renderPage();
    await settle();
    await settle(2000);
    expect(tip()).toBeNull();
    mocks.guide = { open: false, start: () => undefined };
    view.rerender(
      <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}`]}>
        <Routes>
          <Route path="/exams/c/:id" element={<ContainerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(screen.getByRole('region', { name: TIPS.telegram.title })).toBeInTheDocument();
  });

  it('before the guide’s first run (neither the profile nor this device has seen it)', async () => {
    mocks.getProfile.mockResolvedValue({ id: 'user-1', onboarding_status: {} });
    renderPage();
    await settle();
    await settle(2000);
    expect(tip()).toBeNull();
  });

  it('without an account', async () => {
    mocks.userId = undefined;
    renderPage();
    await settle();
    await settle(2000);
    expect(tip()).toBeNull();
    expect(mocks.fetchState).not.toHaveBeenCalled();
  });

  it('never on the example (/try)', async () => {
    renderPage(containerData(), '/try');
    await settle();
    await settle(2000);
    expect(screen.getByTestId('probe')).toHaveTextContent('none');
    expect(mocks.fetchState).not.toHaveBeenCalled();
  });
});

describe('telegramTipWorthy', () => {
  it('wants an exam the bot can plan and ask, answered in, with days ahead', () => {
    const data = containerData();
    expect(telegramTipWorthy(data.summary, dayPlan())).toBe(true);
    expect(telegramTipWorthy(data.summary, dayPlan({ state: 'done' }))).toBe(true);
    expect(telegramTipWorthy(data.summary, dayPlan({ state: 'nothing' }))).toBe(true);
    expect(telegramTipWorthy(data.summary, dayPlan({ state: 'exam_today' }))).toBe(false);
    expect(telegramTipWorthy(data.summary, dayPlan({ state: 'after' }))).toBe(false);
    expect(telegramTipWorthy(data.summary, null)).toBe(false);
    expect(telegramTipWorthy(null, dayPlan())).toBe(false);
    // Answered today only (the first session is today): enough.
    const today = summary({ subjects: [subject({ seen: 0 })], answers_today: 12 });
    expect(telegramTipWorthy(today, dayPlan())).toBe(true);
  });
});
