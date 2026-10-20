/**
 * /tg/play inside a (mocked) Telegram client: the Mini App gate of lib/telegram/miniApp.ts, full screen, Telegram's
 * haptics, the closing confirmation and swipes while playing, the token in SecureStorage, «Назад», sharing, the
 * start parameter; and the same address in a plain browser tab, which is the site's /play.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { setLiveApi } from '../../lib/live/api';
import { fakeApi, keyOf, useGameClock, type FakeApi } from '../../components/live/player/testkit';
import { secureKey } from '../../components/live/player/telegram';
import { fakeInitData, fakeWebApp, putTelegramBridge, stopMiniApp, type FakeWebApp } from '../../test/telegramWebApp';
import TgPlayPage from './TgPlayPage';

type GameFake = FakeWebApp & {
  HapticFeedback: FakeWebApp['HapticFeedback'] & { impactOccurred: Mock<(style: string) => void> };
  enableClosingConfirmation: Mock<() => void>;
  disableClosingConfirmation: Mock<() => void>;
  lockOrientation: Mock<() => void>;
  unlockOrientation: Mock<() => void>;
  exitFullscreen: Mock<() => void>;
  openTelegramLink: Mock<(url: string) => void>;
  shareMessage: Mock<(id: string, cb?: (sent: boolean) => void) => void>;
  isFullscreen: boolean;
  SecureStorage: {
    store: Map<string, string>;
    setItem: Mock<(key: string, value: string, cb?: (e: unknown, ok?: boolean) => void) => void>;
    getItem: Mock<(key: string, cb: (e: unknown, v?: string | null) => void) => void>;
    removeItem: Mock<(key: string, cb?: (e: unknown, ok?: boolean) => void) => void>;
  };
};

function gameWebApp(options: { startParam?: string; firstName?: string } = {}): GameFake {
  const w = fakeWebApp({ version: '9.1', startParam: options.startParam, initData: fakeInitData() }) as GameFake;
  w.initDataUnsafe = { start_param: options.startParam, user: { id: 4242, first_name: options.firstName ?? 'Алина' } };
  w.HapticFeedback.impactOccurred = vi.fn<(style: string) => void>();
  w.enableClosingConfirmation = vi.fn<() => void>();
  w.disableClosingConfirmation = vi.fn<() => void>();
  w.lockOrientation = vi.fn<() => void>();
  w.unlockOrientation = vi.fn<() => void>();
  w.isFullscreen = false;
  w.requestFullscreen = vi.fn<() => void>(() => {
    w.isFullscreen = true;
  });
  w.exitFullscreen = vi.fn<() => void>(() => {
    w.isFullscreen = false;
  });
  w.openTelegramLink = vi.fn<(url: string) => void>();
  w.shareMessage = vi.fn<(id: string, cb?: (sent: boolean) => void) => void>();
  const store = new Map<string, string>();
  w.SecureStorage = {
    store,
    setItem: vi.fn((key: string, value: string, cb?: (e: unknown, ok?: boolean) => void) => {
      store.set(key, value);
      cb?.(null, true);
    }),
    getItem: vi.fn((key: string, cb: (e: unknown, v?: string | null) => void) => cb(null, store.get(key) ?? null)),
    removeItem: vi.fn((key: string, cb?: (e: unknown, ok?: boolean) => void) => {
      store.delete(key);
      cb?.(null, true);
    }),
  };
  return w;
}

let api: FakeApi;
let w: GameFake;
let where = '';

function Where() {
  const loc = useLocation();
  where = `${loc.pathname}${loc.search}`;
  return null;
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function until(cond: () => boolean, maxMs = 90_000) {
  for (let t = 0; t <= maxMs; t += 100) {
    if (cond()) return;
    await tick(100);
  }
  throw new Error('never came');
}

const gameState = () => document.querySelector('main.lp')?.getAttribute('data-state');
const answers = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button.lp-ans'));

async function open(url: string, telegram = true) {
  if (telegram) {
    putTelegramBridge();
    window.Telegram = { WebApp: w };
  }
  render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/tg/play" element={<TgPlayPage />} />
        <Route path="/play" element={<p>Сайт: /play</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await tick(50);
}

beforeEach(() => {
  useGameClock();
  window.sessionStorage.clear();
  window.localStorage.clear();
  // The Mini App joins the fake server directly (it has no bot function): the flag the pages read.
  window.localStorage.setItem('meldy.live.fake', '1');
  api = fakeApi();
  setLiveApi(api);
  w = gameWebApp();
});

afterEach(() => {
  cleanup();
  setLiveApi(null);
  stopMiniApp();
  vi.useRealTimers();
});

describe('/tg/play in Telegram', () => {
  it('a plain browser tab (no Telegram client) is the site\'s /play, with the PIN', async () => {
    await open('/tg/play?pin=482913', false);
    expect(screen.getByText('Сайт: /play')).toBeInTheDocument();
    expect(where).toBe('/play?pin=482913');
    expect(window.Telegram).toBeUndefined();
  });

  it('startapp=<PIN>: full screen, the builder with the Telegram name, «Назад» to the PIN', async () => {
    w = gameWebApp({ startParam: '482913' });
    await open('/tg/play');
    expect(w.ready).toHaveBeenCalled();
    expect(w.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(document.documentElement).toHaveClass('tg-mode');
    expect(screen.getByRole('heading', { name: 'Ваш персонаж' })).toBeInTheDocument();
    expect(screen.getByLabelText('Имя в игре')).toHaveValue('Алина');
    expect(screen.getByText(/Имя взято из Telegram, его можно поменять/)).toBeInTheDocument();
    expect(w.BackButton.show).toHaveBeenCalled();
    expect(w.backHandlers()).toBe(1);
    await act(async () => {
      w.pressBack();
    });
    expect(screen.getByRole('heading', { name: 'Битва с монстром' })).toBeInTheDocument();
    expect(w.BackButton.isVisible).toBe(false);
  });

  it('plays a question: SecureStorage keeps the token, closing asks, haptics fire, «Назад» is hidden', async () => {
    await open('/tg/play?pin=482913');
    fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: 'Алина К' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    });
    await until(() => gameState() === 'lobby');
    const gameId = Array.from(w.SecureStorage.store.keys())[0];
    expect(gameId).toMatch(/^live_[0-9a-f]{32}$/);
    expect(w.SecureStorage.store.get(gameId)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(w.enableClosingConfirmation).toHaveBeenCalled();
    expect(w.disableVerticalSwipes).toHaveBeenCalled();
    expect(w.lockOrientation).toHaveBeenCalled();
    expect(w.HapticFeedback.notificationOccurred).toHaveBeenCalledWith('success');
    expect(screen.getByRole('heading', { name: 'Вы в игре' })).toBeInTheDocument();
    expect(w.BackButton.isVisible).toBe(false);
    // The lobby's builder: «Назад» back to the lobby.
    fireEvent.click(screen.getByRole('button', { name: 'Изменить персонажа' }));
    expect(w.BackButton.isVisible).toBe(true);
    await act(async () => {
      w.pressBack();
    });
    expect(screen.getByRole('heading', { name: 'Вы в игре' })).toBeInTheDocument();
    expect(w.BackButton.isVisible).toBe(false);
    // A question: the tap is a medium impact, the answer's result a notification.
    await until(() => answers().length === 4 && answers().every((b) => b.getAttribute('aria-disabled') !== 'true') && gameState() !== 'reveal');
    expect(w.HapticFeedback.impactOccurred).toHaveBeenCalledWith('light');
    await act(async () => {
      fireEvent.click(answers()[0]);
    });
    expect(w.HapticFeedback.impactOccurred).toHaveBeenCalledWith('medium');
    await until(() => gameState() === 'reveal');
    await tick(1500);
    const notes = w.HapticFeedback.notificationOccurred.mock.calls.map((c) => c[0]);
    expect(notes.some((n) => n === 'success' || n === 'error')).toBe(true);
    expect(w.BackButton.isVisible).toBe(false);
  });

  it('the end: closing no longer asks; «Поделиться» opens Telegram\'s share; leaving exits full screen', async () => {
    await open('/tg/play?pin=482913');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    });
    await until(() => gameState() === 'lobby');
    for (let q = 0; q < 6; q += 1) {
      await until(() => gameState() === 'podium' || (answers().length > 0 && answers().every((b) => b.getAttribute('aria-disabled') !== 'true') && gameState() !== 'reveal'));
      if (gameState() === 'podium') break;
      const id = Array.from(w.SecureStorage.store.keys())[0].slice(5);
      const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
      await act(async () => {
        fireEvent.click(answers()[keyOf(api, uuid)]);
      });
      await until(() => gameState() === 'reveal');
    }
    await until(() => gameState() === 'podium');
    expect(w.disableClosingConfirmation).toHaveBeenCalled();
    expect(w.unlockOrientation).toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));
    });
    expect(w.shareMessage).not.toHaveBeenCalled();
    expect(w.openTelegramLink).toHaveBeenCalledTimes(1);
    const url = new URL(w.openTelegramLink.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://t.me/share/url');
    expect(url.searchParams.get('url')).toBe('https://t.me/Meldyteach_bot');
    expect(url.searchParams.get('text')).toMatch(/^Дедлайн повержен\. \d+-е место из 4/);
    cleanup();
    expect(w.exitFullscreen).toHaveBeenCalled();
  });

  it('a reload in the same launch goes on with the token from SecureStorage', async () => {
    await open('/tg/play?pin=482913');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    });
    await until(() => gameState() === 'lobby');
    cleanup();
    // Telegram reloads the WebView: this tab's sessionStorage is gone in the worst case, SecureStorage stays.
    const pinToGame = Object.keys(window.sessionStorage).filter((k) => k.startsWith('meldy.live.'));
    const keep = new Map(pinToGame.map((k) => [k, window.sessionStorage.getItem(k) as string]));
    window.sessionStorage.clear();
    for (const [k, v] of keep) if (!k.startsWith('meldy.live.player.')) window.sessionStorage.setItem(k, v);
    stopMiniApp();
    await open('/tg/play?pin=482913');
    await until(() => gameState() === 'lobby' || gameState() === 'countdown');
    expect(w.SecureStorage.getItem).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Ваш персонаж' })).toBeNull();
  });

  it('startapp=r_<game> on a device without the token: the review says where it opens', async () => {
    w = gameWebApp({ startParam: 'r_0a1b2c3d4e5f4a6b8c7d0123456789ab' });
    await open('/tg/play');
    await tick(1600);
    expect(screen.getByRole('heading', { name: 'Разбор' })).toBeInTheDocument();
    expect(screen.getByText('Разбор открывается на том устройстве, где вы играли.')).toBeInTheDocument();
    expect(w.SecureStorage.getItem).toHaveBeenCalledWith('live_0a1b2c3d4e5f4a6b8c7d0123456789ab', expect.any(Function));
    expect(secureKey('0a1b2c3d-4e5f-4a6b-8c7d-0123456789ab')).toBe('live_0a1b2c3d4e5f4a6b8c7d0123456789ab');
  });
});
