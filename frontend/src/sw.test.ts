import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import swSource from './sw.js?raw';
import { UPDATE_MESSAGE } from './lib/appUpdate';

/** The service worker (src/sw.js) run in jsdom: workbox replaced, the worker's globals stubbed on `self`. */
const workbox = vi.hoisted(() => ({
  precacheAndRoute: vi.fn(),
  matchPrecache: vi.fn(),
  registerRoute: vi.fn(),
  getCacheKeyForURL: vi.fn<(url: string) => string | undefined>(),
}));

vi.mock('workbox-precaching', () => ({
  precacheAndRoute: workbox.precacheAndRoute,
  matchPrecache: workbox.matchPrecache,
  getCacheKeyForURL: (url: string) => workbox.getCacheKeyForURL(url),
}));
vi.mock('workbox-routing', () => ({
  NavigationRoute: class {
    constructor(
      public handler: unknown,
      public options: unknown,
    ) {}
  },
  registerRoute: workbox.registerRoute,
}));
vi.mock('workbox-strategies', () => ({
  NetworkOnly: class {
    constructor(public options: unknown) {}
  },
}));

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  other: FakePort | null = null;
  postMessage(data: unknown) {
    const target = this.other;
    queueMicrotask(() => target?.onmessage?.({ data }));
  }
  close() {}
}
class FakeChannel {
  port1 = new FakePort();
  port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

const NEW_FILE = 'https://meldy.test/assets/index-NEW.js';
const OLD_FILE = 'https://meldy.test/assets/index-OLD.js';

const worker = {
  skipWaiting: vi.fn(() => Promise.resolve()),
  clients: {
    matchAll: vi.fn<() => Promise<unknown[]>>(),
    claim: vi.fn(() => Promise.resolve()),
    openWindow: vi.fn(),
  },
  registration: { showNotification: vi.fn(() => Promise.resolve()) },
};
const cacheStorage = { delete: vi.fn(() => Promise.resolve(true)) };
/** What the worker set up as it loaded (the config clears mock calls before each test). */
const atLoad = { precached: 0, routes: 0 };
/** The page route the worker registered (a mocked NavigationRoute keeps its handler and options). */
let pageRoute: null | {
  handler: { options: { plugins: Array<{ handlerDidError: (args: { request: Request }) => Promise<Response> }> } };
  options: { denylist: RegExp[] };
} = null;

/** An open window that answers MAY_ACTIVATE (or, like a page of a release before the change, never does). */
function openWindow(id: string, answer: { url: string; free: boolean } | 'silent') {
  return {
    id,
    url: 'https://meldy.test/exams',
    postMessage: vi.fn((message: { type: string }, transfer: FakePort[]) => {
      if (message.type === UPDATE_MESSAGE.mayActivate && answer !== 'silent') transfer[0].postMessage(answer);
    }),
  };
}

/** Dispatches an extendable event at the worker's global scope; resolves with its waitUntil promises. */
function dispatch(type: string, props: Record<string, unknown> = {}) {
  const pending: Promise<unknown>[] = [];
  const event = Object.assign(new Event(type), props, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
  window.dispatchEvent(event);
  return Promise.all(pending);
}

/** A page sends a message to the worker with a channel for the answer. */
async function message(data: unknown, source: { id: string } = { id: 'asking' }) {
  const channel = new FakeChannel();
  const answers: unknown[] = [];
  channel.port1.onmessage = (event) => answers.push(event.data);
  const done = dispatch('message', { data, ports: [channel.port2], source });
  await vi.advanceTimersByTimeAsync(2_000);
  await done;
  await vi.advanceTimersByTimeAsync(0);
  return answers;
}

beforeAll(async () => {
  Object.defineProperty(window, 'skipWaiting', { configurable: true, value: worker.skipWaiting });
  Object.defineProperty(window, 'clients', { configurable: true, value: worker.clients });
  Object.defineProperty(window, 'registration', { configurable: true, value: worker.registration });
  Object.defineProperty(window, 'caches', { configurable: true, value: cacheStorage });
  // @ts-expect-error -- the service worker is plain JavaScript without types.
  await import('./sw.js');
  atLoad.precached = workbox.precacheAndRoute.mock.calls.length;
  atLoad.routes = workbox.registerRoute.mock.calls.length;
  pageRoute = workbox.registerRoute.mock.calls[0]?.[0] as typeof pageRoute;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MessageChannel', FakeChannel);
  worker.skipWaiting.mockClear();
  worker.clients.matchAll.mockReset();
  workbox.getCacheKeyForURL.mockReset().mockImplementation((url) => (url === NEW_FILE ? `${url}?__WB_REVISION__=1` : undefined));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a new release waits', () => {
  it('does not skip waiting on install', async () => {
    expect(swSource).not.toMatch(/addEventListener\(\s*['"]install['"]/);
    await dispatch('install');
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it('still precaches the release and serves pages from the network', () => {
    expect(atLoad).toEqual({ precached: 1, routes: 1 });
  });
});

describe('SKIP_WAITING', () => {
  it('takes over at once when no other window is open, and says so', async () => {
    worker.clients.matchAll.mockResolvedValue([{ id: 'asking', url: 'https://meldy.test/library', postMessage: vi.fn() }]);
    const answers = await message({ type: UPDATE_MESSAGE.skipWaiting });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
    expect(answers).toEqual([{ activating: true }]);
    expect(worker.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  });

  it('takes over when every other window is of its release or could reload unnoticed', async () => {
    const asking = openWindow('asking', { url: NEW_FILE, free: false });
    const sameRelease = openWindow('b', { url: NEW_FILE, free: false });
    const hiddenOlder = openWindow('c', { url: OLD_FILE, free: true });
    worker.clients.matchAll.mockResolvedValue([asking, sameRelease, hiddenOlder]);
    const answers = await message({ type: UPDATE_MESSAGE.skipWaiting });
    expect(asking.postMessage).not.toHaveBeenCalled();
    expect(sameRelease.postMessage).toHaveBeenCalledWith({ type: UPDATE_MESSAGE.mayActivate }, expect.any(Array));
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
    expect(answers).toEqual([{ activating: true }]);
  });

  it('waits while a window of an older release is in sight, on the answer screen or holds typed text', async () => {
    worker.clients.matchAll.mockResolvedValue([openWindow('b', { url: NEW_FILE, free: false }), openWindow('c', { url: OLD_FILE, free: false })]);
    const answers = await message({ type: UPDATE_MESSAGE.skipWaiting });
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    expect(answers).toEqual([{ activating: false }]);
  });

  it('waits while a window cannot answer: a tab of a release before this change keeps the old worker', async () => {
    worker.clients.matchAll.mockResolvedValue([openWindow('old-tab', 'silent')]);
    const answers = await message({ type: UPDATE_MESSAGE.skipWaiting });
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    expect(answers).toEqual([{ activating: false }]);
  });

  it('treats a window that is gone as not agreeing', async () => {
    const gone = {
      id: 'gone',
      url: 'https://meldy.test/',
      postMessage: () => {
        throw new DOMException('The client is gone', 'InvalidStateError');
      },
    };
    worker.clients.matchAll.mockResolvedValue([gone]);
    const answers = await message({ type: UPDATE_MESSAGE.skipWaiting });
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    expect(answers).toEqual([{ activating: false }]);
  });
});

describe('PRECACHES', () => {
  it('tells a page whether its file is part of this release', async () => {
    expect(await message({ type: UPDATE_MESSAGE.precaches, url: NEW_FILE })).toEqual([{ precached: true }]);
    expect(await message({ type: UPDATE_MESSAGE.precaches, url: OLD_FILE })).toEqual([{ precached: false }]);
    expect(await message({ type: UPDATE_MESSAGE.precaches })).toEqual([{ precached: false }]);
    workbox.getCacheKeyForURL.mockImplementation(() => {
      throw new TypeError('Invalid URL');
    });
    expect(await message({ type: UPDATE_MESSAGE.precaches, url: 'http://' })).toEqual([{ precached: false }]);
  });

  it('ignores messages it does not know', async () => {
    expect(await message({ type: 'CACHE_URLS', payload: { urlsToCache: [] } })).toEqual([]);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });
});

describe('as before the change', () => {
  it('claims the pages on activation and drops the old navigations cache', async () => {
    await dispatch('activate');
    expect(worker.clients.claim).toHaveBeenCalled();
    expect(cacheStorage.delete).toHaveBeenCalledWith('navigations');
  });

  it('shows a push as a notification', async () => {
    await dispatch('push', { data: { json: () => ({ title: 'Повторение', body: 'Пора повторить 3 карточки', url: '/review' }) } });
    expect(worker.registration.showNotification).toHaveBeenCalledWith('Повторение', {
      body: 'Пора повторить 3 карточки',
      icon: '/pwa-192x192.svg',
      badge: '/pwa-192x192.svg',
      data: { url: '/review' },
    });
  });
});

describe('a page without network (spec decision 31)', () => {
  const APP = 'app shell of this release';
  const OFFLINE = 'offline page';
  /** The page route's answer when the network fails, with what the precache holds. */
  async function offlineAnswer(path: string, precache: Record<string, string> = { '/index.html': APP, '/offline.html': OFFLINE }) {
    workbox.matchPrecache.mockImplementation(async (url: string) => (url in precache ? new Response(precache[url]) : undefined));
    const plugin = pageRoute!.handler.options.plugins[0];
    const response = await plugin.handlerDidError({ request: new Request(`https://meldy.test${path}`) });
    return response.type === 'error' ? 'error' : await response.text();
  }

  it('«Сегодня», «Экзамены» and an exam container open from the precached app of this release', async () => {
    for (const path of ['/', '/dashboard', '/dashboard/', '/exams', '/exams/', '/exams/c/abc', '/exams/c/abc/', '/exams/c/abc/s/sub-1', '/exams/c/abc/study', '/exams/c/abc/study?s=sub-1&kind=answer', '/exams/c/abc/mock', '/exams/c/abc/keys', '/exams/c/abc/settings']) {
      expect(await offlineAnswer(path), path).toBe(APP);
    }
    expect(workbox.matchPrecache).toHaveBeenCalledWith('/index.html');
  });

  it('every other page gets the offline page, as before', async () => {
    for (const path of ['/library', '/library/abc', '/exams/abc', '/exams/abc/ticket', '/exams/import', '/exams/c', '/review', '/profile', '/g/abcdefghjkmn', '/join/abcdefghjkmn', '/login', '/dashboardx', '/examsx']) {
      expect(await offlineAnswer(path), path).toBe(OFFLINE);
    }
  });

  it('without the app in the precache the offline page; without either a network error', async () => {
    expect(await offlineAnswer('/exams/c/abc', { '/offline.html': OFFLINE })).toBe(OFFLINE);
    expect(await offlineAnswer('/exams/c/abc', {})).toBe('error');
    expect(await offlineAnswer('/library', {})).toBe('error');
  });

  it('pages still come from the network first, and the API and Supabase are never pages', () => {
    expect(swSource).toMatch(/new NetworkOnly\(/);
    expect(pageRoute!.options.denylist.map(String)).toEqual([String(/^\/api/), String(/^\/sb\//), String(/^\/supabase/)]);
  });
});
