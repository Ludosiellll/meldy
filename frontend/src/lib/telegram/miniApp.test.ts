import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MINI_APP_PATH, SCRIPT_TIMEOUT_MS, SESSION_FLAG, SIGNED_FLAG, TELEGRAM_SCRIPT, UNLINKED_FLAG,
  bootMiniApp, isMiniApp, launchData, launchKey, loadTelegramScript, markSignedThisLaunch, markUnlinkedThisLaunch, miniAppHaptic,
  miniAppState, openOutside, shouldLoadTelegram, signedThisLaunch, unlinkedThisLaunch,
} from './miniApp';
import { THEME_CANVAS } from '../../contexts/ThemeProvider';
import { LAUNCH_HASH, fakeInitData, fakeWebApp, startMiniApp, stopMiniApp } from '../../test/telegramWebApp';

const scripts = () => Array.from(document.head.querySelectorAll('script')).filter((script) => script.src.includes('telegram.org'));

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  stopMiniApp();
  for (const script of scripts()) script.remove();
  vi.useRealTimers();
});

describe('where Telegram\'s script belongs', () => {
  it('is /tg and a tab /tg marked, nothing else', () => {
    expect(MINI_APP_PATH).toBe('/tg');
    expect(shouldLoadTelegram('/tg')).toBe(true);
    for (const path of ['/', '/dashboard', '/tg/x', '/login', '/exams/c/x/study']) expect(shouldLoadTelegram(path), path).toBe(false);
    window.sessionStorage.setItem(SESSION_FLAG, '1');
    expect(shouldLoadTelegram('/exams/c/x/study')).toBe(true);
  });

  it('is the official file, over https, from telegram.org', () => {
    const url = new URL(TELEGRAM_SCRIPT);
    expect(url.origin).toBe('https://telegram.org');
    expect(url.pathname).toBe('/js/telegram-web-app.js');
  });

  it('a page off the Mini App loads nothing and stays as it was', async () => {
    const state = await bootMiniApp('/dashboard');
    expect(state).toEqual({ status: 'off' });
    expect(scripts()).toEqual([]);
    expect(document.documentElement.classList.contains('tg-mode')).toBe(false);
    expect(isMiniApp()).toBe(false);
    expect(window.sessionStorage.getItem(SESSION_FLAG)).toBeNull();
  });

  it('a storage that throws reads as an unmarked tab', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(shouldLoadTelegram('/dashboard')).toBe(false);
    expect(shouldLoadTelegram('/tg')).toBe(true);
  });
});

describe('starting inside Telegram', () => {
  it('readies and expands, marks the tab and <html>, paints Telegram in Meldy\'s canvas, swipes off', async () => {
    const webApp = await startMiniApp(fakeWebApp({ version: '8.0', colorScheme: 'dark' }));
    expect(miniAppState()).toMatchObject({ status: 'on', scheme: 'dark' });
    expect(isMiniApp()).toBe(true);
    expect(webApp.ready).toHaveBeenCalledTimes(1);
    expect(webApp.expand).toHaveBeenCalledTimes(1);
    expect(webApp.disableVerticalSwipes).toHaveBeenCalledTimes(1);
    expect(webApp.setHeaderColor).toHaveBeenCalledWith(THEME_CANVAS.dark);
    expect(webApp.setBackgroundColor).toHaveBeenCalledWith(THEME_CANVAS.dark);
    expect(webApp.setBottomBarColor).toHaveBeenCalledWith(THEME_CANVAS.dark);
    expect(document.documentElement.classList.contains('tg-mode')).toBe(true);
    expect(window.sessionStorage.getItem(SESSION_FLAG)).toBe('1');
    // No fullscreen: Telegram's own «Назад» and «Закрыть» stay in sight.
    expect(webApp.requestFullscreen).not.toHaveBeenCalled();
    // The script was there already: nothing fetched.
    expect(scripts()).toEqual([]);
  });

  it('asks an old Telegram only what it knows', async () => {
    const old = await startMiniApp(fakeWebApp({ version: '6.2' }));
    expect(old.setHeaderColor).toHaveBeenCalledWith('bg_color');
    expect(old.setBackgroundColor).toHaveBeenCalledWith(THEME_CANVAS.light);
    expect(old.setBottomBarColor).not.toHaveBeenCalled();
    expect(old.disableVerticalSwipes).not.toHaveBeenCalled();
    stopMiniApp();
    const oldest = await startMiniApp(fakeWebApp({ version: '6.0' }));
    expect(oldest.setHeaderColor).not.toHaveBeenCalled();
    expect(oldest.setBackgroundColor).not.toHaveBeenCalled();
    expect(oldest.ready).toHaveBeenCalled();
    expect(oldest.expand).toHaveBeenCalled();
  });

  it('follows Telegram\'s theme when it changes', async () => {
    const webApp = await startMiniApp(fakeWebApp({ colorScheme: 'light' }));
    expect(miniAppState()).toMatchObject({ scheme: 'light' });
    webApp.colorScheme = 'dark';
    webApp.emit('themeChanged');
    expect(miniAppState()).toMatchObject({ status: 'on', scheme: 'dark' });
    expect(webApp.setBackgroundColor).toHaveBeenLastCalledWith(THEME_CANVAS.dark);
  });

  it('a page without initData (a browser on /tg) is outside: no mark, no class', async () => {
    window.sessionStorage.setItem(SESSION_FLAG, '1');
    const webApp = await startMiniApp(fakeWebApp({ initData: '' }));
    expect(miniAppState()).toEqual({ status: 'outside' });
    expect(webApp.ready).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('tg-mode')).toBe(false);
    expect(window.sessionStorage.getItem(SESSION_FLAG)).toBeNull();
  });

  it('boots once', async () => {
    const webApp = await startMiniApp();
    await bootMiniApp('/tg');
    expect(webApp.ready).toHaveBeenCalledTimes(1);
  });

  it('starts with a client that throws on its calls', async () => {
    const webApp = fakeWebApp();
    webApp.expand.mockImplementation(() => {
      throw new Error('old client');
    });
    webApp.setHeaderColor.mockImplementation(() => {
      throw new Error('bad colour');
    });
    await startMiniApp(webApp);
    expect(isMiniApp()).toBe(true);
  });
});

describe('loading the script', () => {
  it('adds the one official script and starts when it has loaded', async () => {
    const booting = bootMiniApp('/tg');
    expect(miniAppState()).toEqual({ status: 'loading' });
    const [script] = scripts();
    expect(script.src).toBe(TELEGRAM_SCRIPT);
    expect(script.async).toBe(true);
    window.Telegram = { WebApp: fakeWebApp() };
    script.dispatchEvent(new Event('load'));
    await booting;
    expect(isMiniApp()).toBe(true);
    // Asked again, it does not add a second one.
    await loadTelegramScript();
    expect(scripts()).toHaveLength(1);
  });

  it('a failed script is a browser\'s visit', async () => {
    const booting = bootMiniApp('/tg');
    scripts()[0].dispatchEvent(new Event('error'));
    expect(await booting).toEqual({ status: 'outside' });
  });

  it('a script that never answers is a browser\'s visit after the wait', async () => {
    vi.useFakeTimers();
    const booting = bootMiniApp('/tg');
    await vi.advanceTimersByTimeAsync(SCRIPT_TIMEOUT_MS);
    expect(await booting).toEqual({ status: 'outside' });
  });
});

describe('the launch', () => {
  it('gives its initData and the direct link\'s start_param', async () => {
    expect(launchData()).toBeNull();
    await startMiniApp(fakeWebApp({ startParam: 'f4881273-7331-4c39-96d7-f2ce4a31a1c0' }));
    expect(launchData()).toEqual({ initData: fakeInitData(), startParam: 'f4881273-7331-4c39-96d7-f2ce4a31a1c0' });
  });

  it('is known by its hash, and the tab remembers the one it signed in with', () => {
    expect(launchKey(fakeInitData())).toBe(LAUNCH_HASH);
    expect(launchKey('user=1&hash=ABC')).toBeNull();
    expect(launchKey('user=1')).toBeNull();
    expect(signedThisLaunch(fakeInitData())).toBe(false);
    markSignedThisLaunch(fakeInitData());
    expect(window.sessionStorage.getItem(SIGNED_FLAG)).toBe(LAUNCH_HASH);
    expect(signedThisLaunch(fakeInitData())).toBe(true);
    expect(signedThisLaunch(fakeInitData('b'.repeat(64)))).toBe(false);
    // The tab keeps the hash only, never the data.
    expect(JSON.stringify(Object.entries(window.sessionStorage))).not.toContain('auth_date');
  });

  it('remembers a launch the server called «not linked», apart from a signed one', () => {
    expect(unlinkedThisLaunch(fakeInitData())).toBe(false);
    markUnlinkedThisLaunch(fakeInitData());
    expect(window.sessionStorage.getItem(UNLINKED_FLAG)).toBe(LAUNCH_HASH);
    expect(unlinkedThisLaunch(fakeInitData())).toBe(true);
    expect(signedThisLaunch(fakeInitData())).toBe(false);
    expect(unlinkedThisLaunch(fakeInitData('d'.repeat(64)))).toBe(false);
  });
});

describe('haptics and links out', () => {
  it('buzz only inside Telegram, 6.1 and up', async () => {
    miniAppHaptic('success');
    const webApp = await startMiniApp();
    miniAppHaptic('success');
    miniAppHaptic('error');
    miniAppHaptic('select');
    expect(webApp.HapticFeedback.notificationOccurred.mock.calls).toEqual([['success'], ['error']]);
    expect(webApp.HapticFeedback.selectionChanged).toHaveBeenCalledTimes(1);
    stopMiniApp();
    const old = await startMiniApp(fakeWebApp({ version: '6.0' }));
    miniAppHaptic('success');
    expect(old.HapticFeedback.notificationOccurred).not.toHaveBeenCalled();
  });

  it('open in the browser through Telegram, or in a new tab elsewhere', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    openOutside('https://example.org/a');
    expect(open).toHaveBeenCalledWith('https://example.org/a', '_blank', 'noopener,noreferrer');
    const webApp = await startMiniApp();
    openOutside('https://example.org/b');
    expect(webApp.openLink).toHaveBeenCalledWith('https://example.org/b');
    expect(open).toHaveBeenCalledTimes(1);
  });
});
