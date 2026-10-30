/**
 * Which live server the screens talk to (docs/live/CONTRACT.md §12), and the one way to follow a game's state:
 * Realtime hints + polling (§6). The fake is used when `VITE_LIVE_FAKE=1`, `localStorage['meldy.live.fake'] = '1'`, or
 * the address has `?fake=1`.
 */
import { createFakeServer, PICTURE_QUESTIONS, type FakeOptions } from './fake';
import { createRealApi } from './real';
import { POLL_FAST_MS, POLL_ONLY_ABOVE, POLL_SLOW_MS } from './rules';
import { LiveError, isUnchanged, type LiveApi, type Unchanged } from './types';

export function liveFakeWanted(): boolean {
  try {
    if (import.meta.env.VITE_LIVE_FAKE === '1') return true;
    if (typeof window !== 'undefined') {
      if (new URLSearchParams(window.location.search).get('fake') === '1') return true;
      if (window.localStorage.getItem('meldy.live.fake') === '1') return true;
    }
  } catch {
    /* storage refused: the real server */
  }
  return false;
}

/** `?fakeq=pictures`: the fake plays a test as real ones are (five options, pictures). */
function fakeQuestions(): Pick<FakeOptions, 'questions'> {
  try {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fakeq') === 'pictures') {
      return { questions: PICTURE_QUESTIONS };
    }
  } catch {
    /* no address */
  }
  return {};
}

let instance: LiveApi | null = null;

/** The app-wide live API (one fake server per tab, so a host and a player in the same tab share its games). */
export function liveApi(fakeOptions?: FakeOptions): LiveApi {
  if (!instance) instance = liveFakeWanted() ? createFakeServer({ fastBots: false, autoHost: true, ...fakeQuestions(), ...fakeOptions }) : createRealApi();
  return instance;
}

/** Tests and the preview: start over with another server. */
export function setLiveApi(api: LiveApi | null): void {
  instance = api;
}

export interface WatchOptions<S extends { rev: number; state: string; players?: number }> {
  api: LiveApi;
  topic: string;
  /** One read with `since` (live_state or live_host_state). */
  read: (since: number | undefined) => Promise<S | Unchanged>;
  onState: (state: S) => void;
  onError?: (error: LiveError) => void;
  /** The host polls fast in these states (roster, answered count). */
  fastIn?: readonly string[];
  /** Server time offset updates (ms to add to Date.now()). */
  onClock?: (offsetMs: number) => void;
}

/**
 * Follow a game: a read now, then on every hint (after 0–300 ms), and by polling — every 5 s with the channel joined, every
 * 1 s without it, or above 80 players, or in `fastIn` states. Returns stop().
 */
export function watchState<S extends { rev: number; state: string; players?: number; now?: string }>(o: WatchOptions<S>): () => void {
  let stopped = false;
  let rev: number | undefined;
  let linked = false;
  let current: S | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let again = false;
  const offsets: number[] = [];

  const delay = () => {
    const fast = !linked || (current?.players ?? 0) > POLL_ONLY_ABOVE || (current && o.fastIn?.includes(current.state));
    return fast ? POLL_FAST_MS : POLL_SLOW_MS;
  };
  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void pull(), ms);
  };
  const pull = async () => {
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    const sent = Date.now();
    try {
      const got = await o.read(rev);
      const back = Date.now();
      const serverNow = Date.parse((got as { now?: string }).now ?? '');
      if (Number.isFinite(serverNow)) {
        offsets.push(serverNow - (sent + back) / 2);
        if (offsets.length > 5) offsets.shift();
        const sorted = offsets.slice().sort((a, b) => a - b);
        o.onClock?.(sorted[Math.floor(sorted.length / 2)]);
      }
      if (!stopped && !isUnchanged(got)) {
        rev = got.rev;
        current = got;
        o.onState(got);
      } else if (isUnchanged(got)) rev = got.rev;
    } catch (error) {
      if (!stopped) o.onError?.(error instanceof LiveError ? error : new LiveError('unknown', null, 0));
    } finally {
      busy = false;
      if (again) {
        again = false;
        void pull();
      } else schedule(delay());
    }
  };
  const unsubscribe = o.api.subscribe(
    o.topic,
    (hint) => {
      if (rev !== undefined && hint.rev <= rev) return;
      schedule(Math.floor(Math.random() * 300));
    },
    (connected) => {
      linked = connected;
    },
  );
  void pull();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

/** 32 random bytes as base64url (43 characters): a player's or host's secret (CONTRACT §7). */
export function newLiveToken(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(32));
  let text = '';
  bytes.forEach((byte) => {
    text += String.fromCharCode(byte);
  });
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
