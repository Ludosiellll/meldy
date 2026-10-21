/**
 * What differs between the site's /play and the Telegram Mini App's /tg/play: how the player joins (the site's
 * `live_join` with a token made here; Telegram's `/telegram/game/join`, whose token the function makes), where the token
 * is kept (sessionStorage; Telegram's SecureStorage), haptics, the «in a game» guards and sharing. The game itself
 * (controller.ts) is the same on both.
 */
import { newLiveToken } from '../../../lib/live/api';
import { LiveError, type JoinResult, type LiveApi, type Look } from '../../../lib/live/types';

/** `tick`: a second of the last three («Встань на ответ»: the alarm before the stomp). */
export type HapticKind = 'tap' | 'select' | 'go' | 'success' | 'error' | 'warning' | 'hit' | 'freeze' | 'tick';

export interface ShareCard {
  title: string;
  text: string;
  url: string;
  gameId: string;
  token: string;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface JoinRequest {
  pin: string;
  name: string;
  look: Look | null;
  /** A token this device already holds for the game (a reconnect): the same player comes back. */
  token: string | null;
}

export interface Joined {
  result: JoinResult;
  token: string;
}

export interface PlayerPlatform {
  readonly kind: 'web' | 'telegram';
  /** Telegram: the first name Telegram gives (the name field starts with it; the player may change it). The site: null. */
  readonly suggestedName: string | null;
  haptic(kind: HapticKind): void;
  readToken(gameId: string): Promise<string | null>;
  keepToken(gameId: string, token: string): Promise<void>;
  forgetToken(gameId: string): Promise<void>;
  join(api: LiveApi, request: JoinRequest): Promise<Joined>;
  /** Joined and the game not over: Telegram asks before closing and keeps the swipe-down off. */
  setPlaying(on: boolean): void;
  share(card: ShareCard): Promise<ShareResult>;
}

// ─────────────────────────────────────────── storage that may throw ───────────────────────────────────────────

export function readStore(kind: 'session' | 'local', key: string): string | null {
  try {
    return (kind === 'session' ? window.sessionStorage : window.localStorage).getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(kind: 'session' | 'local', key: string, value: string | null): void {
  try {
    const store = kind === 'session' ? window.sessionStorage : window.localStorage;
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // A private window: the game still works; a reload starts over.
  }
}

/** CONTRACT §7: the site keeps the player's token in sessionStorage `meldy.live.player.<game_id>`. */
export const tokenKey = (gameId: string) => `meldy.live.player.${gameId}`;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// ─────────────────────────────────────────── the site ───────────────────────────────────────────

/**
 * Android's vibration for the moments Telegram gives HapticFeedback (telegram.ts): short, and long enough to be felt —
 * many phones' motors do not move for less than ~15 ms. Right = two light taps, wrong = one firm buzz, the freeze = a
 * buzz that grows. iOS Safari has no navigator.vibrate: nothing happens there.
 */
export const VIBRATION: Record<HapticKind, number | number[]> = {
  tap: 15,
  select: 10,
  go: 20,
  success: [25, 60, 25],
  error: 70,
  warning: [30, 60, 30],
  hit: 40,
  freeze: [20, 50, 90],
  tick: 30,
};

function vibrate(kind: HapticKind): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // Before the first tap on the page Chrome refuses (and says so in the console): a reload mid-game waits for a tap.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation && !activation.hasBeenActive) return;
    navigator.vibrate(VIBRATION[kind]);
  } catch {
    // Haptics are a bonus.
  }
}

async function webShare(card: ShareCard): Promise<ShareResult> {
  const text = `${card.title}. ${card.text}`;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ title: card.title, text, url: card.url });
      return 'shared';
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard.writeText(`${text} ${card.url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function webPlatform(): PlayerPlatform {
  return {
    kind: 'web',
    suggestedName: null,
    haptic: vibrate,
    async readToken(gameId) {
      const value = readStore('session', tokenKey(gameId));
      return value && TOKEN_RE.test(value) ? value : null;
    },
    async keepToken(gameId, token) {
      writeStore('session', tokenKey(gameId), token);
    },
    async forgetToken(gameId) {
      writeStore('session', tokenKey(gameId), null);
    },
    async join(api, request) {
      const token = request.token && TOKEN_RE.test(request.token) ? request.token : newLiveToken();
      const result = await api.join(request.pin, request.name, token, request.look);
      return { result, token };
    },
    setPlaying() {},
    share: webShare,
  };
}

/** A LiveError for a failure that is not the server's answer. */
export function networkError(): LiveError {
  return new LiveError('network', null, 0);
}
