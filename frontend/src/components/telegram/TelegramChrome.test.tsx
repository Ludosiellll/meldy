import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider } from '../../contexts/ThemeProvider';
import { bootMiniApp } from '../../lib/telegram/miniApp';
import TelegramChrome, { isMiniAppHome } from './TelegramChrome';
import { fakeInitData, fakeWebApp, putTelegramBridge, startMiniApp, stopMiniApp, type FakeWebApp } from '../../test/telegramWebApp';

const KEY = 'studyforge-theme';
let go: ((to: string) => void) | null = null;

function Where() {
  const location = useLocation();
  const navigate = useNavigate();
  go = (to) => navigate(to);
  return <output data-testid="where">{location.pathname}</output>;
}

/** The app's frame as main.tsx and App.tsx build it: the theme around the router, the chrome inside it. */
function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return render(
    <ThemeProvider defaultTheme="system" storageKey={KEY}>
      <BrowserRouter>
        <TelegramChrome />
        <Where />
      </BrowserRouter>
    </ThemeProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const html = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem(KEY, 'light');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  html().className = '';
});

afterEach(() => {
  cleanup();
  stopMiniApp();
  go = null;
  html().removeAttribute('data-tg-theme');
  for (const script of Array.from(document.head.querySelectorAll('script'))) script.remove();
  window.history.replaceState(null, '', '/');
});

describe('outside Telegram', () => {
  it('a link with Telegram\'s launch data in a plain browser tab changes nothing: the student\'s theme, no «Назад»', async () => {
    const webApp = fakeWebApp({ colorScheme: 'dark' });
    window.Telegram = { WebApp: webApp };
    await act(async () => {
      await startMiniApp(webApp, '/tg', { bridge: false });
    });
    renderAt(`/tg#tgWebAppData=${encodeURIComponent(fakeInitData())}`);
    expect(html().classList.contains('light')).toBe(true);
    expect(html().classList.contains('tg-mode')).toBe(false);
    expect(webApp.BackButton.show).not.toHaveBeenCalled();
    expect(webApp.setHeaderColor).not.toHaveBeenCalled();
  });

  it('does nothing: the student\'s theme, no Telegram, no class', () => {
    renderAt('/exams/c/x/study');
    expect(html().classList.contains('light')).toBe(true);
    expect(html().classList.contains('tg-mode')).toBe(false);
    expect(window.Telegram).toBeUndefined();
  });
});

describe('inside Telegram', () => {
  let webApp: FakeWebApp;

  it('shows Meldy in Telegram\'s scheme, follows it, and never writes it as the student\'s choice', async () => {
    webApp = await startMiniApp(fakeWebApp({ colorScheme: 'dark' }));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderAt('/dashboard');
    expect(html().classList.contains('dark')).toBe(true);
    expect(html().classList.contains('tg-mode')).toBe(true);
    webApp.colorScheme = 'light';
    act(() => webApp.emit('themeChanged'));
    expect(html().classList.contains('light')).toBe(true);
    webApp.colorScheme = 'dark';
    act(() => webApp.emit('themeChanged'));
    expect(html().classList.contains('dark')).toBe(true);
    expect(setItem.mock.calls.filter(([key]) => key === KEY)).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBe('light');
  });

  it('holds the theme theme-init.js read until Telegram\'s script answers; the student\'s own when it is not Telegram', async () => {
    html().setAttribute('data-tg-theme', 'dark');
    putTelegramBridge();
    const booting = bootMiniApp('/tg');
    renderAt('/tg');
    expect(html().classList.contains('dark')).toBe(true);
    const script = document.head.querySelector('script[src*="telegram.org"]') as HTMLScriptElement;
    await act(async () => {
      script.dispatchEvent(new Event('error'));
      await booting;
    });
    expect(html().classList.contains('light')).toBe(true);
  });

  it('hides Telegram\'s «Назад» on «Сегодня» and shows it elsewhere; it steps back in the app', async () => {
    webApp = await startMiniApp();
    renderAt('/dashboard');
    expect(webApp.BackButton.hide).toHaveBeenCalled();
    expect(webApp.BackButton.isVisible).toBe(false);
    act(() => go!('/exams/c/x/study'));
    expect(webApp.BackButton.isVisible).toBe(true);
    expect(webApp.backHandlers()).toBe(1);
    act(() => webApp.pressBack());
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(webApp.BackButton.isVisible).toBe(false);
    expect(webApp.backHandlers()).toBe(0);
  });

  it('without a step back (the session opened first), «Назад» is «Сегодня»', async () => {
    webApp = await startMiniApp();
    renderAt('/exams/c/x/study');
    expect(webApp.BackButton.isVisible).toBe(true);
    const entries = window.history.length;
    act(() => webApp.pressBack());
    await waitFor(() => expect(where()).toBe('/dashboard'));
    // In place of the session, not on top of it: Telegram's «Закрыть» is the way out from there.
    expect(window.history.length).toBe(entries);
  });

  it('lets go of «Назад» when it leaves', async () => {
    webApp = await startMiniApp();
    const { unmount } = renderAt('/exams');
    expect(webApp.backHandlers()).toBe(1);
    unmount();
    expect(webApp.backHandlers()).toBe(0);
  });
});

describe('«Сегодня», the home of the Mini App', () => {
  it('is /dashboard (and / and /tg, which lead there)', () => {
    for (const path of ['/dashboard', '/', '/tg']) expect(isMiniAppHome(path), path).toBe(true);
    for (const path of ['/exams', '/exams/c/x/study', '/profile', '/dashboard/x']) expect(isMiniAppHome(path), path).toBe(false);
  });
});
