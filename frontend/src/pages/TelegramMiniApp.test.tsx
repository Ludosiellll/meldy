import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  LAUNCH_HASH, fakeInitData, fakeWebApp, putTelegramBridge, startMiniApp, stopMiniApp, type FakeWebApp,
} from '../test/telegramWebApp';

type User = { id: string; email: string };

const auth = vi.hoisted(() => {
  let user: { id: string; email: string } | null = null;
  const listeners = new Set<() => void>();
  return {
    loading: false,
    user: () => user,
    set(next: { id: string; email: string } | null) {
      user = next;
      for (const listener of Array.from(listeners)) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

const mocks = vi.hoisted(() => ({
  miniAppSession: vi.fn(),
  signInWithTelegram: vi.fn(),
  container: { loading: false, data: null } as { loading: boolean; data: unknown },
  plan: null as unknown,
  startTarget: vi.fn(),
  loadSession: vi.fn(),
  resumable: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../hooks/useAuth', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useAuth: () => {
      const user = useSyncExternalStore(auth.subscribe, auth.user);
      return { user, loading: auth.loading };
    },
  };
});
vi.mock('../api/telegramMiniApp', () => ({
  miniAppSession: (...args: unknown[]) => mocks.miniAppSession(...args),
  signInWithTelegram: (...args: unknown[]) => mocks.signInWithTelegram(...args),
}));
vi.mock('../lib/containers/hooks', () => ({ useContainerData: () => mocks.container }));
vi.mock('../lib/telemetry', () => ({ track: (...args: unknown[]) => mocks.track(...args) }));
vi.mock('../components/containers/PageState', () => ({ usePlan: () => mocks.plan }));
vi.mock('../components/containers/actions', () => ({ startTarget: (...args: unknown[]) => mocks.startTarget(...args) }));
vi.mock('../components/containers/sessionStore', () => ({
  loadSession: (...args: unknown[]) => mocks.loadSession(...args),
  resumable: (...args: unknown[]) => mocks.resumable(...args),
}));

import TelegramMiniApp, { WORDS, examOfLaunch } from './TelegramMiniApp';

const ALINA: User = { id: 'f4881273-7331-4c39-96d7-f2ce4a31a1c0', email: 'alina@example.com' };
const OTHER: User = { id: '0b6f3c2e-9a1d-4e7b-8c5a-2d4e6f8a0b1c', email: 'other@example.com' };
const EXAM = '69ead689-38d6-4350-bc5d-13d273f8b9b2';
const TOKEN = 'pkce_6b1c7d2e9f0a4b3c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a';
const STUDY = `/exams/c/${EXAM}/study?s=1`;

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function StudyPage() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Назад из занятия
    </button>
  );
}

function renderAt(path = '/tg') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tg" element={<TelegramMiniApp />} />
        <Route path="/dashboard" element={<p>Сегодня</p>} />
        <Route path="/exams/c/:id/study" element={<StudyPage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
/** Inputs or a «Подключить» of any kind: the page has no way to link a Telegram. */
const noLinking = () => {
  expect(screen.queryAllByRole('textbox')).toEqual([]);
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Подключить/ })).toBeNull();
};
let webApp: FakeWebApp;

beforeEach(async () => {
  window.sessionStorage.clear();
  auth.loading = false;
  auth.set(null);
  mocks.miniAppSession.mockReset().mockResolvedValue({ status: 'unlinked' });
  mocks.signInWithTelegram.mockReset().mockImplementation(async () => {
    auth.set(ALINA);
    return true;
  });
  mocks.container = { loading: false, data: null };
  mocks.plan = null;
  mocks.startTarget.mockReset().mockReturnValue(null);
  mocks.loadSession.mockReset().mockReturnValue(null);
  mocks.resumable.mockReset().mockReturnValue(null);
  mocks.track.mockReset();
  webApp = await startMiniApp(fakeWebApp());
});

afterEach(() => {
  cleanup();
  stopMiniApp();
  window.history.replaceState(null, '', '/');
});

describe('the exam a launch names', () => {
  it('is ?c= of the bot\'s buttons, else the direct link\'s startapp; an exam id only', () => {
    expect(examOfLaunch(`?c=${EXAM}`, null)).toBe(EXAM);
    expect(examOfLaunch(`?c=${EXAM.toUpperCase()}`, null)).toBe(EXAM);
    expect(examOfLaunch('', EXAM)).toBe(EXAM);
    expect(examOfLaunch(`?c=${EXAM}`, ALINA.id)).toBe(EXAM);
    for (const value of ['../profile', 'javascript:alert(1)', `${EXAM}x`, '']) {
      expect(examOfLaunch(`?c=${encodeURIComponent(value)}`, null), value).toBeNull();
      expect(examOfLaunch('', value), value).toBeNull();
    }
  });
});

describe('outside Telegram', () => {
  it('a link to /tg with someone\'s initData in the address, in a plain browser tab: «Сегодня», no sign-in, no Telegram mode', async () => {
    stopMiniApp();
    // The attack of the security review (2026-10-11): the attacker's own fresh launch, the victim's browser, signed in.
    auth.set(OTHER);
    window.history.replaceState(null, '', `/tg#tgWebAppData=${encodeURIComponent(fakeInitData())}&tgWebAppVersion=8.0`);
    window.Telegram = { WebApp: fakeWebApp() };
    renderAt();
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).not.toHaveBeenCalled();
    expect(mocks.signInWithTelegram).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('tg-mode')).toBe(false);
    expect(auth.user()).toEqual(OTHER);
  });

  it('a Telegram client without initData goes to «Сегодня» and nothing is asked of the server', async () => {
    stopMiniApp();
    await startMiniApp(fakeWebApp({ initData: '' }));
    renderAt();
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).not.toHaveBeenCalled();
  });

  it('a page that got here before main.tsx booted the Mini App boots it itself', async () => {
    stopMiniApp();
    putTelegramBridge();
    window.Telegram = { WebApp: webApp };
    renderAt();
    await waitFor(() => expect(mocks.miniAppSession).toHaveBeenCalledWith(fakeInitData(), null));
    expect(webApp.ready).toHaveBeenCalled();
  });
});

describe('a linked Telegram', () => {
  it('signs in once with the function\'s one-time sign-in and opens «Сегодня»', async () => {
    mocks.miniAppSession.mockResolvedValue({ status: 'linked', tokenHash: TOKEN });
    renderAt();
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).toHaveBeenCalledTimes(1);
    expect(mocks.miniAppSession).toHaveBeenCalledWith(fakeInitData(), null);
    expect(mocks.signInWithTelegram).toHaveBeenCalledWith(TOKEN);
    expect(window.sessionStorage.getItem('meldy_tg_signed')).toBe(LAUNCH_HASH);
    expect(mocks.track).toHaveBeenCalledWith('login_done', { method: 'telegram' });
  });

  it('with an exam: «Сегодня» underneath and today\'s session of that exam on top', async () => {
    mocks.miniAppSession.mockResolvedValue({ status: 'linked', tokenHash: TOKEN });
    const summary = { id: EXAM };
    const plan = { day: '2026-10-10', sessions: [] };
    const saved = { subjectId: null };
    mocks.container = { loading: false, data: { summary, planInput: {} } };
    mocks.plan = plan;
    mocks.loadSession.mockReturnValue(saved);
    mocks.resumable.mockReturnValue(saved);
    mocks.startTarget.mockReturnValue({ href: STUDY, label: 'Продолжить' });
    renderAt(`/tg?c=${EXAM}`);
    await waitFor(() => expect(where()).toBe(STUDY));
    expect(mocks.loadSession).toHaveBeenCalledWith(ALINA.id, EXAM);
    expect(mocks.resumable).toHaveBeenCalledWith(saved, '2026-10-10');
    expect(mocks.startTarget).toHaveBeenCalledWith({ containerId: EXAM, summary, plan, saved, wide: false });
    // «Назад» from the session is «Сегодня».
    fireEvent.click(screen.getByRole('button', { name: 'Назад из занятия' }));
    expect(where()).toBe('/dashboard');
  });

  it('an exam with nothing to study today, or only an answer aloud, stays on «Сегодня»', async () => {
    mocks.miniAppSession.mockResolvedValue({ status: 'linked', tokenHash: TOKEN });
    mocks.container = { loading: false, data: { summary: {}, planInput: {} } };
    mocks.plan = { day: '2026-10-10', sessions: [] };
    mocks.startTarget.mockReturnValue({ href: `/exams/${EXAM}/ticket`, label: 'Ответить вслух' });
    renderAt(`/tg?c=${EXAM}`);
    await waitFor(() => expect(mocks.startTarget).toHaveBeenCalled());
    expect(where()).toBe('/dashboard');
  });

  it('an exam that is not the student\'s (no data) stays on «Сегодня»', async () => {
    mocks.miniAppSession.mockResolvedValue({ status: 'linked', tokenHash: TOKEN });
    renderAt(`/tg?c=${EXAM}`);
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.startTarget).not.toHaveBeenCalled();
  });

  it('already signed in here as that account: no new sign-in', async () => {
    auth.set(ALINA);
    mocks.miniAppSession.mockResolvedValue({ status: 'same' });
    renderAt();
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).toHaveBeenCalledWith(fakeInitData(), ALINA.id);
    expect(mocks.signInWithTelegram).not.toHaveBeenCalled();
  });

  it('never signs in twice in one launch: a reload of a launch this tab already used goes straight on', async () => {
    auth.set(ALINA);
    window.sessionStorage.setItem('meldy_tg_signed', LAUNCH_HASH);
    renderAt();
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).not.toHaveBeenCalled();
    expect(mocks.signInWithTelegram).not.toHaveBeenCalled();
  });

  it('a sign-in Auth refuses spent the launch: no «Повторить», only the site', async () => {
    mocks.miniAppSession.mockResolvedValue({ status: 'linked', tokenHash: TOKEN });
    mocks.signInWithTelegram.mockResolvedValue(false);
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.problems.unavailable.title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WORDS.retry })).toBeNull();
    expect(screen.getByRole('button', { name: WORDS.openSite })).toBeInTheDocument();
  });
});

describe('another Meldy account is open in this WebView (no silent switch)', () => {
  const OTHER_ANSWER = { status: 'other', tokenHash: TOKEN, email: ALINA.email };

  it('asks first, naming the account of this Telegram; «Открыть аккаунт Telegram» signs in to it', async () => {
    auth.set(OTHER);
    mocks.miniAppSession.mockResolvedValue(OTHER_ANSWER);
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.otherTitle })).toBeInTheDocument();
    expect(mocks.miniAppSession).toHaveBeenCalledWith(fakeInitData(), OTHER.id);
    expect(screen.getByText(WORDS.otherText(ALINA.email, OTHER.email))).toBeInTheDocument();
    expect(mocks.signInWithTelegram).not.toHaveBeenCalled();
    expect(auth.user()).toEqual(OTHER);
    fireEvent.click(screen.getByRole('button', { name: WORDS.openOther }));
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.signInWithTelegram).toHaveBeenCalledWith(TOKEN);
    expect(auth.user()).toEqual(ALINA);
    expect(mocks.track).toHaveBeenCalledWith('login_done', { method: 'telegram' });
  });

  it('«Остаться в текущем» keeps the account that is open, and a reload does not ask again', async () => {
    auth.set(OTHER);
    mocks.miniAppSession.mockResolvedValue(OTHER_ANSWER);
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: WORDS.stay }));
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.signInWithTelegram).not.toHaveBeenCalled();
    expect(auth.user()).toEqual(OTHER);
    cleanup();
    renderAt();
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithTelegram).not.toHaveBeenCalled();
  });

  it('a reload while it asks keeps the account that is open (the safe answer)', async () => {
    auth.set(OTHER);
    mocks.miniAppSession.mockResolvedValue(OTHER_ANSWER);
    renderAt();
    await screen.findByRole('heading', { name: WORDS.otherTitle });
    cleanup();
    renderAt();
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.signInWithTelegram).not.toHaveBeenCalled();
    expect(auth.user()).toEqual(OTHER);
  });

  it('a switch Auth refuses: the account that was open stays, no «Повторить»', async () => {
    auth.set(OTHER);
    mocks.miniAppSession.mockResolvedValue(OTHER_ANSWER);
    mocks.signInWithTelegram.mockResolvedValue(false);
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: WORDS.openOther }));
    expect(await screen.findByRole('heading', { name: WORDS.problems.unavailable.title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WORDS.retry })).toBeNull();
    expect(auth.user()).toEqual(OTHER);
  });
});

describe('a Telegram not linked yet: how to link it on the site, and nothing here links it', () => {
  it('greets by the Telegram name and sends to the profile in the browser', async () => {
    stopMiniApp();
    const named = fakeWebApp();
    named.initDataUnsafe = { user: { id: 4242, first_name: 'Алина' } };
    webApp = await startMiniApp(named);
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.unlinkedTitle('Алина') })).toBeInTheDocument();
    expect(screen.getByText(WORDS.unlinkedText)).toBeInTheDocument();
    noLinking();
    fireEvent.click(screen.getByRole('button', { name: WORDS.openProfile }));
    expect(webApp.openLink).toHaveBeenCalledWith(`${window.location.origin}/profile#telegram`);
    expect(window.sessionStorage.getItem('meldy_tg_unlinked')).toBe(LAUNCH_HASH);
  });

  it('without a name, the same words; signed in here, the same screen: the account is not offered to this Telegram', async () => {
    auth.set(OTHER);
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.unlinkedTitle(null) })).toBeInTheDocument();
    expect(mocks.miniAppSession).toHaveBeenCalledWith(fakeInitData(), OTHER.id);
    noLinking();
    expect(screen.queryByText(OTHER.email)).toBeNull();
    expect(mocks.signInWithTelegram).not.toHaveBeenCalled();
  });

  it('a reload shows it again without asking the server once more', async () => {
    renderAt();
    await screen.findByRole('heading', { name: WORDS.unlinkedTitle(null) });
    cleanup();
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.unlinkedTitle(null) })).toBeInTheDocument();
    expect(mocks.miniAppSession).toHaveBeenCalledTimes(1);
  });
});

describe('what the server refused', () => {
  it.each([
    ['replayed', WORDS.problems.stale.title, false],
    ['stale', WORDS.problems.stale.title, false],
    ['invalid', WORDS.problems.invalid.title, false],
    ['slow_down', WORDS.problems.slow_down.title, false],
    ['unavailable', WORDS.problems.unavailable.title, true],
    ['network', WORDS.problems.network.title, true],
  ] as const)('%s → «%s»', async (status, title, retry) => {
    mocks.miniAppSession.mockResolvedValue({ status });
    renderAt();
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(Boolean(screen.queryByRole('button', { name: WORDS.retry }))).toBe(retry);
    fireEvent.click(screen.getByRole('button', { name: WORDS.openSite }));
    expect(webApp.openLink).toHaveBeenCalledWith(`${window.location.origin}/dashboard`);
  });

  it('«Повторить» after no answer asks once more and goes on', async () => {
    mocks.miniAppSession.mockResolvedValueOnce({ status: 'network' }).mockResolvedValueOnce({ status: 'linked', tokenHash: TOKEN });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: WORDS.retry }));
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).toHaveBeenCalledTimes(2);
  });
});

describe('the launch\'s data', () => {
  it('never reaches the address, the console or the tab\'s storage', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name));
    mocks.miniAppSession.mockResolvedValue({ status: 'linked', tokenHash: TOKEN });
    renderAt(`/tg?c=${EXAM}`);
    await waitFor(() => expect(where()).toBe('/dashboard'));
    await act(async () => undefined);
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(/auth_date|query_id|pkce_/);
    }
    expect(where()).not.toMatch(/auth_date|hash=|pkce_/);
    expect(JSON.stringify(Object.entries(window.sessionStorage))).not.toMatch(/auth_date|query_id|pkce_/);
  });
});
