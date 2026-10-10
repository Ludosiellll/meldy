/**
 * Meldy as a Telegram Mini App (meldy-notes 10_Project/Telegram_Mini_App_Spec_2026-10-10.md §5): the one place the
 * site touches Telegram's script.
 *
 * telegram-web-app.js loads only in a Mini App session: on /tg, or in a tab /tg already marked (sessionStorage
 * `meldy_tg`). Telegram's own reload of the WebView lands on the page the student is on, and the script then restores
 * the launch data from its own sessionStorage (`__telegram__initParams`), so the session goes on there. Outside
 * Telegram nothing loads and nothing changes: /tg in a browser finds no initData and leaves for «Сегодня».
 *
 * In the session (`status: 'on'`): ready() and expand(), vertical swipes off (Bot API 7.7+, the page scrolls), the
 * header, background and bottom bar in Meldy's canvas, the class `tg-mode` on <html> (styles/telegram.css: safe areas,
 * full height, the parts hidden), Telegram's colour scheme for Meldy's light or dark theme (TelegramChrome), haptics
 * on an answer, links out through openLink. No fullscreen: it would hide Telegram's own «Назад» and «Закрыть».
 */
import { useSyncExternalStore } from 'react';
import { THEME_CANVAS } from '../../contexts/ThemeProvider';

/** Telegram's script, as the Mini Apps docs give it (the CSP allows exactly this file: nginx.conf). */
export const TELEGRAM_SCRIPT = 'https://telegram.org/js/telegram-web-app.js?64';
export const MINI_APP_PATH = '/tg';
/** This tab is a Mini App session (sessionStorage; set once Telegram's initData is there). */
export const SESSION_FLAG = 'meldy_tg';
/** The launch whose sign-in this tab already did: the hash of its initData (a reload must not spend it again). */
export const SIGNED_FLAG = 'meldy_tg_signed';
/**
 * The launch the server already called «not linked»: its hash. The server spends an initData on that answer too (so a
 * copy cannot sign in once the student links), so a reload of the sign-in form goes straight back to the form.
 */
export const UNLINKED_FLAG = 'meldy_tg_unlinked';
/** How long the page waits for Telegram's script before it treats the visit as a browser's. */
export const SCRIPT_TIMEOUT_MS = 8000;

export type Scheme = 'light' | 'dark';

/** The part of Telegram.WebApp the site uses (https://core.telegram.org/bots/webapps). */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { id?: number } };
  version?: string;
  platform?: string;
  colorScheme?: Scheme;
  ready(): void;
  expand(): void;
  isVersionAtLeast?(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  openLink?(url: string): void;
  onEvent?(event: string, handler: () => void): void;
  offEvent?(event: string, handler: () => void): void;
  BackButton?: { show(): void; hide(): void; onClick(handler: () => void): void; offClick(handler: () => void): void };
  HapticFeedback?: { notificationOccurred(type: 'error' | 'success' | 'warning'): void; selectionChanged(): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export type MiniAppState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'outside' }
  | { status: 'on'; webApp: TelegramWebApp; scheme: Scheme };

let state: MiniAppState = { status: 'off' };
const listeners = new Set<() => void>();

function set(next: MiniAppState): void {
  state = next;
  for (const listener of Array.from(listeners)) listener();
}

export function miniAppState(): MiniAppState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Mini App's state for React: off outside Telegram (and on the server). */
export function useMiniApp(): MiniAppState {
  return useSyncExternalStore(subscribe, miniAppState, miniAppState);
}

/** True inside a Telegram Mini App session. */
export function isMiniApp(): boolean {
  return state.status === 'on';
}

// ─────────────────────────────────────────── the tab's marks ───────────────────────────────────────────

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Without storage a reload of the Mini App opens as the site; the next launch from Telegram starts it again.
  }
}

/** Telegram's script belongs on this page: /tg, or a tab already marked as a Mini App session. */
export function shouldLoadTelegram(pathname: string): boolean {
  return pathname === MINI_APP_PATH || readSession(SESSION_FLAG) === '1';
}

/** The hash field of an initData: what marks one launch (never sent anywhere from here). */
export function launchKey(initData: string): string | null {
  try {
    const hash = new URLSearchParams(initData).get('hash');
    return hash && /^[0-9a-f]{64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

/** This launch already signed the student in, in this tab (a reload: the server would answer «replayed»). */
export function signedThisLaunch(initData: string): boolean {
  const key = launchKey(initData);
  return key !== null && readSession(SIGNED_FLAG) === key;
}

export function markSignedThisLaunch(initData: string): void {
  writeSession(SIGNED_FLAG, launchKey(initData));
}

/** The server already said this launch's Telegram is not linked (a reload of the sign-in form). */
export function unlinkedThisLaunch(initData: string): boolean {
  const key = launchKey(initData);
  return key !== null && readSession(UNLINKED_FLAG) === key;
}

export function markUnlinkedThisLaunch(initData: string): void {
  writeSession(UNLINKED_FLAG, launchKey(initData));
}

// ─────────────────────────────────────────── the script ───────────────────────────────────────────

let loading: Promise<TelegramWebApp | null> | null = null;

/** Adds telegram-web-app.js once; resolves with Telegram.WebApp, or null on an error or after `timeoutMs`. */
export function loadTelegramScript(timeoutMs = SCRIPT_TIMEOUT_MS): Promise<TelegramWebApp | null> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const present = window.Telegram?.WebApp;
    if (present) {
      resolve(present);
      return;
    }
    const script = document.createElement('script');
    script.src = TELEGRAM_SCRIPT;
    script.async = true;
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(window.Telegram?.WebApp ?? null);
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

const atLeast = (webApp: TelegramWebApp, version: string): boolean => {
  try {
    return typeof webApp.isVersionAtLeast === 'function' ? webApp.isVersionAtLeast(version) : false;
  } catch {
    return false;
  }
};

const schemeOf = (webApp: TelegramWebApp): Scheme => (webApp.colorScheme === 'dark' ? 'dark' : 'light');

/** Telegram's header, background and bottom bar in Meldy's canvas: one surface from the top of the screen down. */
function paint(webApp: TelegramWebApp, scheme: Scheme): void {
  const canvas = THEME_CANVAS[scheme];
  try {
    // Up to Bot API 6.9 the header takes only Telegram's own keywords.
    if (atLeast(webApp, '6.1')) webApp.setHeaderColor?.(atLeast(webApp, '7.0') ? canvas : 'bg_color');
    if (atLeast(webApp, '6.1')) webApp.setBackgroundColor?.(canvas);
    if (atLeast(webApp, '7.10')) webApp.setBottomBarColor?.(canvas);
  } catch {
    // Colours are cosmetic.
  }
}

function start(webApp: TelegramWebApp): void {
  writeSession(SESSION_FLAG, '1');
  document.documentElement.classList.add('tg-mode');
  try {
    webApp.ready();
    webApp.expand();
    if (atLeast(webApp, '7.7')) webApp.disableVerticalSwipes?.();
  } catch {
    // An old client without one of these still shows the app.
  }
  const scheme = schemeOf(webApp);
  paint(webApp, scheme);
  const onTheme = () => {
    const next = schemeOf(webApp);
    paint(webApp, next);
    set({ status: 'on', webApp, scheme: next });
  };
  try {
    webApp.onEvent?.('themeChanged', onTheme);
  } catch {
    // The scheme stays the launch's.
  }
  set({ status: 'on', webApp, scheme });
}

/**
 * Called once as the app starts (main.tsx). Off the Mini App path and outside a marked tab it does nothing at all.
 * Resolves with the state it reached.
 */
export async function bootMiniApp(pathname: string = window.location.pathname): Promise<MiniAppState> {
  if (state.status !== 'off' || !shouldLoadTelegram(pathname)) return state;
  set({ status: 'loading' });
  const webApp = await loadTelegramScript();
  if (!webApp || typeof webApp.initData !== 'string' || webApp.initData === '') {
    writeSession(SESSION_FLAG, null);
    set({ status: 'outside' });
    return state;
  }
  start(webApp);
  return state;
}

/** The launch's signed data (for the server only) and the exam a direct link names (`startapp=<id>`), when any. */
export function launchData(): { initData: string; startParam: string | null } | null {
  if (state.status !== 'on') return null;
  const start = state.webApp.initDataUnsafe?.start_param;
  return { initData: state.webApp.initData, startParam: typeof start === 'string' && start ? start : null };
}

/** Haptics on an answer (Bot API 6.1+); nothing outside Telegram. */
export function miniAppHaptic(kind: 'success' | 'error' | 'warning' | 'select'): void {
  if (state.status !== 'on' || !atLeast(state.webApp, '6.1')) return;
  const haptic = state.webApp.HapticFeedback;
  try {
    if (kind === 'select') haptic?.selectionChanged();
    else haptic?.notificationOccurred(kind);
  } catch {
    // Haptics are a bonus.
  }
}

/** A page outside the Mini App: Telegram opens it in the browser (the Mini App stays); elsewhere a new tab. */
export function openOutside(url: string): void {
  if (state.status === 'on' && typeof state.webApp.openLink === 'function') {
    try {
      state.webApp.openLink(url);
      return;
    } catch {
      // Fall through to the browser's way.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Tests only: back to the state of a page that has not booted. */
export function resetMiniAppForTests(): void {
  loading = null;
  state = { status: 'off' };
  for (const listener of Array.from(listeners)) listener();
  document.documentElement.classList.remove('tg-mode');
}
