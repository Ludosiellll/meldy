/**
 * A stand-in for Telegram's `window.Telegram.WebApp` in tests (lib/telegram/miniApp.ts): the methods the site calls are
 * spies, `emit` fires Telegram's events, `pressBack` presses Telegram's «Назад». The initData is made up and unsigned:
 * the page passes it on and never reads it (the bot's function checks the signature). `startMiniApp` also puts the
 * native client's `TelegramWebviewProxy` around the page, as Telegram does (the Mini App starts only with it).
 */
import { vi, type Mock } from 'vitest';
import { bootMiniApp, resetMiniAppForTests, type TelegramWebApp } from '../lib/telegram/miniApp';

export const LAUNCH_HASH = 'c0ffee'.padEnd(64, '0');

/** A launch's initData as Telegram encodes it (the user is a URL-encoded JSON). */
export function fakeInitData(hash = LAUNCH_HASH): string {
  const user = encodeURIComponent(JSON.stringify({ id: 4242, first_name: 'Алина', language_code: 'ru', allows_write_to_pm: true }));
  return `query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=${user}&auth_date=1760100000&signature=c2lnbmF0dXJl&hash=${hash}`;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

type Call = Mock<() => void>;
type Paint = Mock<(color: string) => void>;
type Handler = Mock<(handler: () => void) => void>;

export interface FakeWebApp extends TelegramWebApp {
  ready: Call;
  expand: Call;
  setHeaderColor: Paint;
  setBackgroundColor: Paint;
  setBottomBarColor: Paint;
  disableVerticalSwipes: Call;
  openLink: Paint;
  /** Telegram 8.0's fullscreen: the site never asks for it. */
  requestFullscreen: Call;
  BackButton: { isVisible: boolean; show: Call; hide: Call; onClick: Handler; offClick: Handler };
  HapticFeedback: { notificationOccurred: Mock<(type: 'error' | 'success' | 'warning') => void>; selectionChanged: Call };
  /** Telegram fires an event (themeChanged…). */
  emit(event: string): void;
  /** Telegram's «Назад» pressed: its handlers run. */
  pressBack(): void;
  backHandlers(): number;
}

export function fakeWebApp(
  options: { initData?: string; version?: string; colorScheme?: 'light' | 'dark'; startParam?: string } = {},
): FakeWebApp {
  const events = new Map<string, Set<() => void>>();
  const back = new Set<() => void>();
  const webApp: FakeWebApp = {
    initData: options.initData ?? fakeInitData(),
    initDataUnsafe: { start_param: options.startParam, user: { id: 4242 } },
    version: options.version ?? '8.0',
    platform: 'android',
    colorScheme: options.colorScheme ?? 'light',
    ready: vi.fn<() => void>(),
    expand: vi.fn<() => void>(),
    isVersionAtLeast: (version: string) => compareVersions(webApp.version ?? '6.0', version) >= 0,
    setHeaderColor: vi.fn<(color: string) => void>(),
    setBackgroundColor: vi.fn<(color: string) => void>(),
    setBottomBarColor: vi.fn<(color: string) => void>(),
    disableVerticalSwipes: vi.fn<() => void>(),
    openLink: vi.fn<(url: string) => void>(),
    requestFullscreen: vi.fn<() => void>(),
    onEvent: (event: string, handler: () => void) => {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(handler);
    },
    offEvent: (event: string, handler: () => void) => {
      events.get(event)?.delete(handler);
    },
    BackButton: {
      isVisible: false,
      show: vi.fn<() => void>(() => {
        webApp.BackButton.isVisible = true;
      }),
      hide: vi.fn<() => void>(() => {
        webApp.BackButton.isVisible = false;
      }),
      onClick: vi.fn<(handler: () => void) => void>((handler) => {
        back.add(handler);
      }),
      offClick: vi.fn<(handler: () => void) => void>((handler) => {
        back.delete(handler);
      }),
    },
    HapticFeedback: {
      notificationOccurred: vi.fn<(type: 'error' | 'success' | 'warning') => void>(),
      selectionChanged: vi.fn<() => void>(),
    },
    emit: (event: string) => {
      for (const handler of Array.from(events.get(event) ?? [])) handler();
    },
    pressBack: () => {
      for (const handler of Array.from(back)) handler();
    },
    backHandlers: () => back.size,
  };
  return webApp;
}

/** A native Telegram client around the page (what hasTelegramBridge looks for). */
export function putTelegramBridge(): void {
  window.TelegramWebviewProxy = { postEvent: () => undefined };
}

/**
 * The page as Telegram opens it: the client's bridge and Telegram.WebApp are there, and the Mini App starts (no script
 * is fetched). `bridge: false` is the same address in a plain browser tab.
 */
export async function startMiniApp(webApp: FakeWebApp = fakeWebApp(), pathname = '/tg', options: { bridge?: boolean } = {}): Promise<FakeWebApp> {
  if (options.bridge !== false) putTelegramBridge();
  window.Telegram = { WebApp: webApp };
  await bootMiniApp(pathname);
  return webApp;
}

/** Back to a page outside Telegram: the state, the class on <html>, the tab's marks and Telegram.WebApp go. */
export function stopMiniApp(): void {
  resetMiniAppForTests();
  delete window.Telegram;
  delete window.TelegramWebviewProxy;
  try {
    window.sessionStorage.removeItem('meldy_tg');
    window.sessionStorage.removeItem('meldy_tg_signed');
    window.sessionStorage.removeItem('meldy_tg_unlinked');
  } catch {
    // Storage blocked by a test: nothing was written.
  }
}
