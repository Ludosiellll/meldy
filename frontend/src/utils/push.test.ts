import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeUserToPush } from './push';

// 'AQID' is base64url for the bytes 1, 2, 3; 'BAUG' for 4, 5, 6.
const SERVER_KEY = 'AQID';

interface FakeSubscription {
  options?: { applicationServerKey: ArrayBuffer | null };
  unsubscribe: () => Promise<boolean>;
}

function installPush(existing: FakeSubscription | null = null) {
  const subscribe = vi.fn(async (_options: { applicationServerKey: Uint8Array }) => ({ endpoint: 'https://push.example/1' }));
  const pushManager = { getSubscription: vi.fn(async () => existing), subscribe };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  return { subscribe };
}

function serverSays(key: unknown, saveOk = true) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/push/key') return new Response(JSON.stringify(key), { status: 200 });
    if (url === '/api/push/subscribe') return new Response('{}', { status: saveOk ? 200 : 500 });
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(window, 'PushManager');
});

describe('subscribeUserToPush', () => {
  it('subscribes with the key the server signs pushes with and saves the subscription', async () => {
    const { subscribe } = installPush();
    const fetchMock = serverSays({ public_key: SERVER_KEY, configured: true });
    await expect(subscribeUserToPush('user-1')).resolves.toBe(true);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(Array.from(subscribe.mock.calls[0][0].applicationServerKey)).toEqual([1, 2, 3]);
    const save = fetchMock.mock.calls.find(([url]) => url === '/api/push/subscribe');
    expect(JSON.parse(String(save?.[1]?.body))).toMatchObject({ user_id: 'user-1' });
  });

  it('refuses when the server cannot sign pushes, before asking the browser for a subscription', async () => {
    const { subscribe } = installPush();
    serverSays({ public_key: SERVER_KEY, configured: false });
    await expect(subscribeUserToPush('user-1')).rejects.toThrow('уведомления на сервере пока не настроены');
    serverSays({ public_key: null, configured: false });
    await expect(subscribeUserToPush('user-1')).rejects.toThrow('уведомления на сервере пока не настроены');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('never falls back to a key built into the page when the server does not answer', async () => {
    const { subscribe } = installPush();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(subscribeUserToPush('user-1')).rejects.toThrow('не удалось узнать ключ уведомлений, попробуйте позже');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('drops a subscription made with an older key and keeps one made with this key', async () => {
    const unsubscribe = vi.fn(async () => true);
    const older = installPush({ options: { applicationServerKey: new Uint8Array([4, 5, 6]).buffer }, unsubscribe });
    serverSays({ public_key: SERVER_KEY, configured: true });
    await subscribeUserToPush('user-1');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(older.subscribe).toHaveBeenCalledTimes(1);

    const keep = vi.fn(async () => true);
    installPush({ options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer }, unsubscribe: keep });
    serverSays({ public_key: SERVER_KEY, configured: true });
    await subscribeUserToPush('user-1');
    expect(keep).not.toHaveBeenCalled();
  });

  it('says so in Russian when the browser has no push or the server does not save the subscription', async () => {
    serverSays({ public_key: SERVER_KEY, configured: true });
    await expect(subscribeUserToPush('user-1')).rejects.toThrow('этот браузер не поддерживает уведомления');
    installPush();
    serverSays({ public_key: SERVER_KEY, configured: true }, false);
    await expect(subscribeUserToPush('user-1')).rejects.toThrow('не удалось сохранить подписку на сервере');
  });
});
