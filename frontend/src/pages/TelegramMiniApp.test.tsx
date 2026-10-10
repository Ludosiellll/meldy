import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LAUNCH_HASH, fakeInitData, fakeWebApp, startMiniApp, stopMiniApp, type FakeWebApp } from '../test/telegramWebApp';

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
  miniAppLink: vi.fn(),
  signInWithTelegram: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
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
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mocks.signInWithPassword(...args),
      signOut: (...args: unknown[]) => mocks.signOut(...args),
    },
  },
}));
vi.mock('../api/telegramMiniApp', () => ({
  miniAppSession: (...args: unknown[]) => mocks.miniAppSession(...args),
  miniAppLink: (...args: unknown[]) => mocks.miniAppLink(...args),
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
let webApp: FakeWebApp;

beforeEach(async () => {
  window.sessionStorage.clear();
  auth.loading = false;
  auth.set(null);
  mocks.miniAppSession.mockReset().mockResolvedValue({ status: 'unlinked' });
  mocks.miniAppLink.mockReset().mockResolvedValue('linked');
  mocks.signInWithTelegram.mockReset().mockImplementation(async () => {
    auth.set(ALINA);
    return true;
  });
  mocks.signInWithPassword.mockReset().mockImplementation(async ({ email }: { email: string }) => {
    auth.set({ ...ALINA, email });
    return { data: {}, error: null };
  });
  mocks.signOut.mockReset().mockImplementation(async () => {
    auth.set(null);
    return { error: null };
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
  it('a browser on /tg goes to «Сегодня» and nothing is asked of the server', async () => {
    stopMiniApp();
    await startMiniApp(fakeWebApp({ initData: '' }));
    renderAt();
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).not.toHaveBeenCalled();
  });

  it('a page that got here before main.tsx booted the Mini App boots it itself', async () => {
    stopMiniApp();
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

  it('a reload of a launch this tab already signed in with goes straight on', async () => {
    auth.set(ALINA);
    window.sessionStorage.setItem('meldy_tg_signed', LAUNCH_HASH);
    renderAt();
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).not.toHaveBeenCalled();
  });

  it('a sign-in Auth refuses is a problem with «Повторить»', async () => {
    mocks.miniAppSession.mockResolvedValue({ status: 'linked', tokenHash: TOKEN });
    mocks.signInWithTelegram.mockResolvedValue(false);
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.problems.unavailable.title })).toBeInTheDocument();
    mocks.signInWithTelegram.mockImplementation(async () => {
      auth.set(ALINA);
      return true;
    });
    fireEvent.click(screen.getByRole('button', { name: WORDS.retry }));
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppSession).toHaveBeenCalledTimes(2);
  });
});

describe('a Telegram not linked yet', () => {
  const fill = (email: string, password: string) => {
    fireEvent.change(screen.getByLabelText(WORDS.email), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(WORDS.password), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: WORDS.submit }));
  };

  it('signs in by e-mail and password, then links this Telegram in one call: no code', async () => {
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.formTitle })).toBeInTheDocument();
    expect(document.title).toContain('Вход через Telegram');
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    fill('  alina@example.com ', 'secret-1');
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'alina@example.com', password: 'secret-1' });
    expect(mocks.track).toHaveBeenCalledWith('login_done', { method: 'email' });
    expect(mocks.miniAppLink).toHaveBeenCalledTimes(1);
    expect(mocks.miniAppLink.mock.calls[0][0]).toBe(fakeInitData());
    expect(typeof mocks.miniAppLink.mock.calls[0][1]).toBe('string');
    expect(window.sessionStorage.getItem('meldy_tg_signed')).toBe(LAUNCH_HASH);
  });

  it('says what is wrong with the form, and wrong credentials in words', async () => {
    renderAt();
    await screen.findByRole('heading', { name: WORDS.formTitle });
    fill('', '');
    expect(await screen.findByText(WORDS.emailMissing)).toBeInTheDocument();
    fill('alina@', 'secret-1');
    expect(await screen.findByText(/Проверьте адрес/)).toBeInTheDocument();
    fill('alina@example.com', '');
    expect(await screen.findByText(WORDS.passwordMissing)).toBeInTheDocument();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } });
    fill('alina@example.com', 'wrong');
    expect(await screen.findByText(WORDS.badCredentials)).toBeInTheDocument();
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Email not confirmed' } });
    fill('alina@example.com', 'secret-1');
    expect(await screen.findByText(WORDS.notConfirmed)).toBeInTheDocument();
    mocks.signInWithPassword.mockRejectedValue(new Error('offline'));
    fill('alina@example.com', 'secret-1');
    expect(await screen.findByText(WORDS.signInFailed)).toBeInTheDocument();
    expect(mocks.miniAppLink).not.toHaveBeenCalled();
  });

  it('opens the site\'s pages in the browser: the password, a new account, the profile for Google', async () => {
    renderAt();
    await screen.findByRole('heading', { name: WORDS.formTitle });
    fireEvent.click(screen.getByRole('button', { name: WORDS.forgot }));
    fireEvent.click(screen.getByRole('button', { name: WORDS.register }));
    fireEvent.click(screen.getByRole('button', { name: WORDS.googleButton }));
    expect(webApp.openLink.mock.calls.map(([url]) => url)).toEqual([
      `${window.location.origin}/forgot-password`,
      `${window.location.origin}/register`,
      `${window.location.origin}/profile#telegram`,
    ]);
    expect(screen.getByText(WORDS.googleNote)).toBeInTheDocument();
  });

  it('a reload of the sign-in form goes back to it: the server already spent this launch on «not linked»', async () => {
    renderAt();
    await screen.findByRole('heading', { name: WORDS.formTitle });
    expect(window.sessionStorage.getItem('meldy_tg_unlinked')).toBe(LAUNCH_HASH);
    cleanup();
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.formTitle })).toBeInTheDocument();
    expect(mocks.miniAppSession).toHaveBeenCalledTimes(1);
    // Signed in meanwhile (another tab of the WebView): the question before linking.
    cleanup();
    auth.set(OTHER);
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.confirmTitle })).toBeInTheDocument();
    expect(mocks.miniAppSession).toHaveBeenCalledTimes(1);
  });

  it('signed in here already: asks before linking, or signs out for another account', async () => {
    auth.set(OTHER);
    renderAt();
    expect(await screen.findByRole('heading', { name: WORDS.confirmTitle })).toBeInTheDocument();
    expect(mocks.miniAppSession).toHaveBeenCalledWith(fakeInitData(), OTHER.id);
    expect(screen.getByText(WORDS.confirmLede(OTHER.email))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: WORDS.otherAccount }));
    expect(await screen.findByRole('heading', { name: WORDS.formTitle })).toBeInTheDocument();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('«Подключить» links the account signed in here', async () => {
    auth.set(OTHER);
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: WORDS.confirm }));
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(mocks.miniAppLink).toHaveBeenCalledTimes(1);
  });

  it('a Telegram linked to another account is said so; a lost session asks to sign in again', async () => {
    mocks.miniAppLink.mockResolvedValue('linked_elsewhere');
    renderAt();
    await screen.findByRole('heading', { name: WORDS.formTitle });
    fill('alina@example.com', 'secret-1');
    expect(await screen.findByRole('heading', { name: WORDS.problems.linked_elsewhere.title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WORDS.retry })).toBeNull();
    cleanup();
    auth.set(null);
    mocks.miniAppLink.mockResolvedValue('signed_out');
    renderAt();
    await screen.findByRole('heading', { name: WORDS.formTitle });
    fill('alina@example.com', 'secret-1');
    expect(await screen.findByText(WORDS.signedOut)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: WORDS.formTitle })).toBeInTheDocument();
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
