/**
 * The game inside Telegram (/tg/play; meldy-notes 10_Project/Telegram_Live_Game_Spec_2026-10-20.md, CONTRACT §7, §9).
 * The Mini App itself (the client bridge, telegram-web-app.js, theme, safe areas) is lib/telegram/miniApp.ts: this file
 * only adds what the game uses on top of it — full screen, Telegram's haptics, the closing confirmation, the token in
 * SecureStorage (sessionStorage when it is not there), the join through the bot's function and sharing the result.
 */
import { FunctionRegion } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { newLiveToken } from '../../../lib/live/api';
import { LiveError, type JoinResult, type LiveApi, type Look } from '../../../lib/live/types';
import { miniAppState, type TelegramWebApp } from '../../../lib/telegram/miniApp';
import { readStore, writeStore, tokenKey, TOKEN_RE, type HapticKind, type Joined, type PlayerPlatform, type ShareCard, type ShareResult } from './platform';

type Callback<T> = (error: unknown, value?: T) => void;

/** The parts of Telegram.WebApp the game adds (Bot API 6.1 – 9.0). */
export interface GameWebApp extends TelegramWebApp {
  isFullscreen?: boolean;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  lockOrientation?(): void;
  unlockOrientation?(): void;
  shareMessage?(id: string, callback?: (sent: boolean) => void): void;
  openTelegramLink?(url: string): void;
  HapticFeedback?: {
    impactOccurred?(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  SecureStorage?: {
    setItem(key: string, value: string, callback?: Callback<boolean>): void;
    getItem(key: string, callback: (error: unknown, value?: string | null, canRestore?: boolean) => void): void;
    removeItem(key: string, callback?: Callback<boolean>): void;
  };
}

export function gameWebApp(): GameWebApp | null {
  const st = miniAppState();
  return st.status === 'on' ? (st.webApp as GameWebApp) : null;
}

export function atLeast(webApp: TelegramWebApp, version: string): boolean {
  try {
    return typeof webApp.isVersionAtLeast === 'function' ? webApp.isVersionAtLeast(version) : false;
  } catch {
    return false;
  }
}

/** CONTRACT §7: SecureStorage key `live_<game_id_without_dashes>`. */
export const secureKey = (gameId: string) => `live_${gameId.replace(/-/g, '')}`;
/** The SecureStorage keys this device wrote, oldest first (SecureStorage holds 10 values a bot). */
const KEYS_LIST = 'meldy.live.tgkeys';
const KEEP_KEYS = 3;

/** `r_<32 hex>` → the game's uuid; anything else → null. */
export function reviewGameOf(startParam: string | null): string | null {
  const m = startParam ? /^r_([0-9a-f]{32})$/i.exec(startParam) : null;
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** `482913` (startapp) → the PIN; anything else → null. */
export function pinOf(startParam: string | null): string | null {
  return startParam && /^\d{6}$/.test(startParam) ? startParam : null;
}

function withTimeout<T>(run: (done: (value: T) => void) => void, fallback: T, ms = 1500): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), ms);
    try {
      run((value) => {
        clearTimeout(timer);
        finish(value);
      });
    } catch {
      clearTimeout(timer);
      finish(fallback);
    }
  });
}

// ─────────────────────────────────────────── the bot's function ───────────────────────────────────────────

const JOIN_STATUSES: Record<string, LiveError> = {
  not_found: new LiveError('P0002', 'pin', 404),
  full: new LiveError('ML001'),
  ended: new LiveError('ML002', 'ended'),
  members_only: new LiveError('ML003', null, 403),
  slow_down: new LiveError('ML005', 'join', 429),
  kicked: new LiveError('42501', 'kicked', 403),
  invalid: new LiveError('unknown', 'launch'),
  stale: new LiveError('unknown', 'launch'),
  replayed: new LiveError('unknown', 'launch'),
};

/** `name_refused` / `look_refused` carry a `reason`: the contract's code (length, rude, locked …) or plain words. */
function refused(status: string, reason: unknown): LiveError | null {
  const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : null;
  if (status === 'name_refused') return new LiveError('ML006', why);
  if (status === 'look_refused') return new LiveError('ML007', why);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function invokeGame(route: 'join' | 'share', body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await supabase.functions.invoke(`telegram/game/${route}`, { body, region: FunctionRegion.EuCentral1 });
    if (error) {
      const name = isRecord(error) ? String(error.name ?? '') : '';
      if (name === 'FunctionsFetchError') throw new LiveError('network', null, 0);
      const context = isRecord(error) ? error.context : null;
      const status = context instanceof Response ? context.status : 0;
      throw status === 429 ? new LiveError('ML005', 'join', 429) : new LiveError('unknown', null, status);
    }
    if (!isRecord(data)) throw new LiveError('unknown');
    return data;
  } catch (error) {
    if (error instanceof LiveError) throw error;
    throw new LiveError('network', null, 0);
  }
}

/** Waits between the retries of a join whose answer was lost (the same launch may join again). */
export const JOIN_RETRY_MS: readonly number[] = [800, 2000];

/**
 * POST /telegram/game/join (CONTRACT §9): the Telegram user comes from the launch's initData; the name typed here goes
 * with it (without one the function takes Telegram's first name). A lost answer is retried: the same launch may join
 * the game it already joined, and a refused join does not spend the launch.
 */
export async function telegramJoin(initData: string, pin: string, look: Look | null, name: string | null = null, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<Joined> {
  const payload: Record<string, unknown> = { init_data: initData, pin, look };
  if (name && name.trim()) payload.name = name.trim();
  let body: Record<string, unknown> | null = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      body = await invokeGame('join', payload);
      break;
    } catch (error) {
      const lost = error instanceof LiveError && (error.code === 'network' || error.status >= 500);
      if (!lost || attempt >= JOIN_RETRY_MS.length) throw error;
      await wait(JOIN_RETRY_MS[attempt]);
    }
  }
  const status = typeof body.status === 'string' ? body.status : '';
  if (status === 'joined' && typeof body.token === 'string' && TOKEN_RE.test(body.token) && typeof body.game_id === 'string') {
    const { token, status: _status, ...rest } = body;
    return { result: rest as unknown as JoinResult, token };
  }
  throw refused(status, body.reason) ?? JOIN_STATUSES[status] ?? new LiveError('unknown');
}

/**
 * The prepared message for Telegram's shareMessage (Bot API 8.0: the bot's savePreparedInlineMessage). Not in the
 * contract yet: the route is asked for in the report; without it the result goes through Telegram's share link.
 */
export async function prepareShare(gameId: string, token: string): Promise<string | null> {
  try {
    const body = await invokeGame('share', { game_id: gameId, token });
    return body.status === 'ok' && typeof body.id === 'string' && body.id ? body.id : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────── the platform ───────────────────────────────────────────

export interface TelegramPlatformOptions {
  webApp: GameWebApp;
  initData: string;
  firstName: string | null;
  /** The fake server has no bot function: the join goes to it directly with a token made here. */
  fake: boolean;
  join?: (initData: string, pin: string, look: Look | null, name: string | null) => Promise<Joined>;
  prepare?: (gameId: string, token: string) => Promise<string | null>;
}

export function telegramPlatform(options: TelegramPlatformOptions): PlayerPlatform {
  const w = options.webApp;
  const haptics = atLeast(w, '6.1') ? w.HapticFeedback : undefined;
  const secure = atLeast(w, '9.0') ? w.SecureStorage : undefined;

  const haptic = (kind: HapticKind) => {
    if (!haptics) return;
    try {
      if (kind === 'select') haptics.selectionChanged();
      else if (kind === 'success' || kind === 'error' || kind === 'warning') haptics.notificationOccurred(kind);
      else haptics.impactOccurred?.(kind === 'tap' ? 'medium' : kind === 'go' ? 'light' : kind === 'hit' ? 'heavy' : 'rigid');
    } catch {
      // Haptics are a bonus (Telegram Desktop has none).
    }
  };

  const remember = (key: string) => {
    let list: string[] = [];
    try {
      const raw = JSON.parse(readStore('local', KEYS_LIST) ?? '[]');
      if (Array.isArray(raw)) list = raw.filter((x): x is string => typeof x === 'string');
    } catch {
      list = [];
    }
    list = [...list.filter((k) => k !== key), key];
    while (list.length > KEEP_KEYS) {
      const old = list.shift() as string;
      try {
        secure?.removeItem(old);
      } catch {
        // An old game's token stays until Telegram drops it.
      }
    }
    writeStore('local', KEYS_LIST, JSON.stringify(list));
  };

  let playing = false;

  return {
    kind: 'telegram',
    suggestedName: options.firstName ? [...options.firstName.trim()].slice(0, 24).join('') : null,
    haptic,
    async readToken(gameId) {
      const inTab = readStore('session', tokenKey(gameId));
      if (inTab && TOKEN_RE.test(inTab)) return inTab;
      if (!secure) return null;
      const value = await withTimeout<string | null>((done) => secure.getItem(secureKey(gameId), (error, got) => done(!error && typeof got === 'string' ? got : null)), null);
      return value && TOKEN_RE.test(value) ? value : null;
    },
    async keepToken(gameId, token) {
      writeStore('session', tokenKey(gameId), token);
      if (!secure) return;
      await withTimeout<boolean>((done) => secure.setItem(secureKey(gameId), token, (error) => done(!error)), false);
      remember(secureKey(gameId));
    },
    async forgetToken(gameId) {
      writeStore('session', tokenKey(gameId), null);
      try {
        secure?.removeItem(secureKey(gameId));
      } catch {
        // Nothing to forget.
      }
    },
    async join(api: LiveApi, request) {
      if (options.fake) {
        const token = request.token && TOKEN_RE.test(request.token) ? request.token : newLiveToken();
        const result = await api.join(request.pin, request.name || options.firstName || 'Игрок', token, request.look);
        return { result, token };
      }
      return (options.join ?? telegramJoin)(options.initData, request.pin, request.look, request.name || null);
    },
    setPlaying(on) {
      if (on === playing) return;
      playing = on;
      try {
        if (on) {
          if (atLeast(w, '6.2')) w.enableClosingConfirmation?.();
          if (atLeast(w, '7.7')) w.disableVerticalSwipes?.();
          if (atLeast(w, '8.0')) w.lockOrientation?.();
        } else {
          if (atLeast(w, '6.2')) w.disableClosingConfirmation?.();
          if (atLeast(w, '8.0')) w.unlockOrientation?.();
        }
      } catch {
        // An old client: the game still plays.
      }
    },
    async share(card: ShareCard): Promise<ShareResult> {
      const id = atLeast(w, '8.0') && typeof w.shareMessage === 'function' && !options.fake ? await (options.prepare ?? prepareShare)(card.gameId, card.token) : null;
      if (id && w.shareMessage) {
        return withTimeout<ShareResult>((done) => w.shareMessage?.(id, (sent) => done(sent ? 'shared' : 'cancelled')), 'shared', 60_000);
      }
      const url = `https://t.me/share/url?url=${encodeURIComponent(card.url)}&text=${encodeURIComponent(`${card.title}. ${card.text}`)}`;
      try {
        if (atLeast(w, '6.1') && typeof w.openTelegramLink === 'function') {
          w.openTelegramLink(url);
          return 'shared';
        }
        w.openLink?.(url);
        return 'shared';
      } catch {
        return 'failed';
      }
    },
  };
}

/** Full screen for the game (Bot API 8.0); off again when the page goes. */
export function enterFullscreen(webApp: GameWebApp): () => void {
  if (!atLeast(webApp, '8.0') || typeof webApp.requestFullscreen !== 'function') return () => {};
  try {
    if (!webApp.isFullscreen) webApp.requestFullscreen();
  } catch {
    return () => {};
  }
  return () => {
    try {
      if (webApp.isFullscreen !== false) webApp.exitFullscreen?.();
    } catch {
      // Leaving: nothing to undo.
    }
  };
}
