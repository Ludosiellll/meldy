import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  ANSWER_MS,
  CHECK_EVERY_MS,
  CHECK_ON_RETURN_AFTER_MS,
  FIRST_CHECK_MS,
  TAKEOVER_RETRIES,
  TAKEOVER_RETRY_MS,
  UPDATE_MESSAGE,
  askPrecaches,
  createAppUpdate,
  hasTypedText,
  holdsUpdate,
  type AppUpdate,
  type AppUpdateHost,
} from './appUpdate';
import { isRoomPath } from '../components/Layout';
import viteConfigSource from '../../vite.config.ts?raw';

/** A message channel whose ports deliver on the next microtask (MessageChannel is not part of jsdom). */
class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  other: FakePort | null = null;
  closed = false;
  postMessage(data: unknown) {
    const target = this.other;
    queueMicrotask(() => {
      if (target && !target.closed && !this.closed) target.onmessage?.({ data });
    });
  }
  close() {
    this.closed = true;
  }
}
class FakeChannel {
  port1 = new FakePort();
  port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

const PAGE_FILE = 'https://meldy.test/assets/index-OLD.js';
const NEW_FILE = 'https://meldy.test/assets/index-NEW.js';

/** A service worker: answers PRECACHES from its release's files, and SKIP_WAITING as told. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState;
  files: Set<string>;
  messages: Array<{ type: string; url?: string }> = [];
  /** The answer to SKIP_WAITING: takes over, refuses, or stays silent. */
  takeover: 'yes' | 'no' | 'silent' = 'yes';
  constructor(state: ServiceWorkerState, files: string[]) {
    super();
    this.state = state;
    this.files = new Set(files);
  }
  postMessage(message: { type: string; url?: string }, transfer?: unknown[]) {
    this.messages.push(message);
    const port = transfer?.[0] as FakePort | undefined;
    if (message.type === UPDATE_MESSAGE.precaches) port?.postMessage({ precached: this.files.has(message.url ?? '') });
    if (message.type === UPDATE_MESSAGE.skipWaiting && this.takeover !== 'silent') port?.postMessage({ activating: this.takeover === 'yes' });
  }
  sent(type: string) {
    return this.messages.filter((message) => message.type === type).length;
  }
  becomes(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  update = vi.fn(() => Promise.resolve());
  /** A new release found: it installs while the active worker serves, then waits. */
  release(worker: FakeWorker) {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    this.installing = null;
    this.waiting = worker;
    worker.becomes('installed');
  }
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null;
  startMessages = vi.fn();
  /** The waiting worker takes over: clients.claim() makes it the controller of every page. */
  takeOver(registration: FakeRegistration, worker: FakeWorker) {
    registration.active = worker;
    registration.waiting = null;
    this.controller = worker;
    this.dispatchEvent(new Event('controllerchange'));
  }
}

interface Page {
  path: string;
  hidden: boolean;
  typed: boolean;
  online: boolean;
}

let page: Page;
let container: FakeContainer;
let host: AppUpdateHost & { reload: Mock<() => void>; offer: Mock<(shown: boolean) => void> };
let update: AppUpdate;
let registration: FakeRegistration;
let old: FakeWorker;

const flush = () => vi.advanceTimersByTimeAsync(0);

function start(path = '/dashboard') {
  page = { path, hidden: false, typed: false, online: true };
  container = new FakeContainer();
  old = new FakeWorker('activated', [PAGE_FILE]);
  container.controller = old;
  registration = new FakeRegistration();
  registration.active = old;
  host = {
    container: container as unknown as AppUpdateHost['container'],
    pageFile: PAGE_FILE,
    pathname: () => page.path,
    hidden: () => page.hidden,
    typedText: () => page.typed,
    online: () => page.online,
    now: () => Date.now(),
    reload: vi.fn<() => void>(),
    offer: vi.fn<(shown: boolean) => void>(),
  };
  update = createAppUpdate(host);
  update.attach(registration as unknown as ServiceWorkerRegistration);
}

function hide() {
  page.hidden = true;
  update.visibilityChanged();
}

function show() {
  page.hidden = false;
  update.visibilityChanged();
}

/** A release that does not carry this page's files: the page is of an older release. */
async function newerRelease() {
  const worker = new FakeWorker('installing', [NEW_FILE]);
  registration.release(worker);
  await flush();
  return worker;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MessageChannel', FakeChannel);
});

afterEach(() => {
  update?.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('holdsUpdate', () => {
  it('holds the update on the screens where work may be in progress', () => {
    for (const path of [
      '/exams/abc/draw',
      '/exams/abc/ticket',
      '/exams/abc/ticket/',
      '/exams/abc/report',
      '/library/abc/talk',
      '/try/draw',
      '/try/ticket',
      '/analyze',
      '/exams/new',
      '/exams/abc/edit',
      // An exam container's «занятие» and «Как на экзамене» (an unfinished session or run), the import page (the
      // parsed preview of the files).
      '/exams/c/abc/study',
      '/exams/c/abc/study/',
      '/exams/c/abc/mock',
      '/exams/c/abc/mock/',
      '/exams/import',
      '/exams/import/',
    ]) {
      expect(holdsUpdate(path), path).toBe(true);
    }
  });

  it('lets it through everywhere else', () => {
    for (const path of [
      '/', '/dashboard', '/exams', '/exams/abc', '/library', '/library/abc', '/review', '/mistakes', '/analytics',
      '/knowledge-map', '/profile', '/try', '/login',
      '/exams/c/abc', '/exams/c/abc/s/sub-1', '/exams/c/abc/keys', '/exams/c/abc/settings', '/g/abcdefghjkmn',
      '/exams/c/abc/study/extra', '/exams/importer',
    ]) {
      expect(holdsUpdate(path), path).toBe(false);
    }
  });

  it('holds it on every room of the signed-in shell (components/Layout.tsx isRoomPath), at every route of App.tsx', () => {
    const routes = [
      '/', '/login', '/register', '/forgot-password', '/update-password', '/try', '/try/draw', '/try/ticket', '/check',
      '/dashboard', '/profile', '/analyze', '/library', '/library/x', '/library/x/talk', '/review', '/exams', '/exams/new',
      '/exams/x', '/exams/x/edit', '/exams/x/draw', '/exams/x/ticket', '/exams/x/report', '/mistakes', '/analytics',
      '/knowledge-map', '/shared/x', '/join/x', '/auth/callback',
      '/exams/import', '/exams/c/x', '/exams/c/x/s/y', '/exams/c/x/study', '/exams/c/x/mock', '/exams/c/x/keys',
      '/exams/c/x/settings', '/g/x',
    ];
    const rooms = routes.filter((path) => isRoomPath(path) || isRoomPath(`${path}/`));
    expect(rooms).toEqual(['/library/x/talk', '/exams/x/draw', '/exams/x/ticket', '/exams/x/report', '/exams/c/x/study', '/exams/c/x/mock']);
    for (const path of rooms) {
      expect(holdsUpdate(path), path).toBe(true);
      expect(holdsUpdate(`${path}/`), path).toBe(true);
    }
  });
});

describe('hasTypedText', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds text a reload would lose in text fields and text areas', () => {
    document.body.innerHTML = '<input type="text"><input type="search"><textarea></textarea>';
    expect(hasTypedText(document)).toBe(false);
    (document.querySelector('textarea') as HTMLTextAreaElement).value = 'Ответ на билет';
    expect(hasTypedText(document)).toBe(true);
  });

  it('ignores blanks, switches, sliders and fields nobody can type in', () => {
    document.body.innerHTML =
      '<input type="text" value="   "><input type="checkbox" checked><input type="range" value="40"><input type="number" value="3"><input type="hidden" value="x"><input type="text" value="x" disabled><textarea readonly>x</textarea>';
    expect(hasTypedText(document)).toBe(false);
  });

  it('counts a typed password and a chosen file', () => {
    document.body.innerHTML = '<input type="password">';
    (document.querySelector('input') as HTMLInputElement).value = 'secret';
    expect(hasTypedText(document)).toBe(true);
    document.body.innerHTML = '<input type="file">';
    const input = document.querySelector('input') as HTMLInputElement;
    expect(hasTypedText(document)).toBe(false);
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'lecture.pdf')] });
    expect(hasTypedText(document)).toBe(true);
  });
});

describe('a page of an older release', () => {
  it('offers the update while in sight and never reloads there, however long the student clicks around', async () => {
    start('/dashboard');
    await newerRelease();
    expect(host.offer).toHaveBeenCalledWith(true);
    for (const path of ['/exams', '/library', '/review', '/analytics', '/dashboard']) {
      page.path = path;
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(host.reload).not.toHaveBeenCalled();
  });

  it('reloads once when it goes out of sight on an ordinary screen', async () => {
    start('/exams');
    await newerRelease();
    hide();
    expect(host.reload).toHaveBeenCalledTimes(1);
    show();
    hide();
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload out of sight on the answer screen, and does once the student has left it', async () => {
    start('/exams/abc/ticket');
    await newerRelease();
    hide();
    show();
    expect(host.reload).not.toHaveBeenCalled();
    page.path = '/exams/abc';
    hide();
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload out of sight while a field holds typed text', async () => {
    start('/library');
    await newerRelease();
    page.typed = true;
    hide();
    expect(host.reload).not.toHaveBeenCalled();
    page.typed = false;
    show();
    hide();
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at once when the release is found while the page is out of sight', async () => {
    start('/review');
    page.hidden = true;
    await newerRelease();
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('offers once, whatever number of releases arrive', async () => {
    start();
    await newerRelease();
    await newerRelease();
    expect(host.offer).toHaveBeenCalledTimes(1);
  });

  it('reloads on «Обновить»', async () => {
    start('/exams/abc');
    await newerRelease();
    update.reloadNow();
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('never asks a newer release to take over', async () => {
    start();
    const worker = await newerRelease();
    hide();
    show();
    expect(worker.sent(UPDATE_MESSAGE.skipWaiting)).toBe(0);
  });

  it('notices a release whose install had begun before the page registered', async () => {
    page = { path: '/library', hidden: false, typed: false, online: true };
    container = new FakeContainer();
    old = new FakeWorker('activated', [PAGE_FILE]);
    container.controller = old;
    registration = new FakeRegistration();
    registration.active = old;
    const worker = new FakeWorker('installing', [NEW_FILE]);
    registration.installing = worker;
    host = {
      container: container as unknown as AppUpdateHost['container'],
      pageFile: PAGE_FILE,
      pathname: () => page.path,
      hidden: () => page.hidden,
      typedText: () => page.typed,
      online: () => page.online,
      now: () => Date.now(),
      reload: vi.fn<() => void>(),
      offer: vi.fn<(shown: boolean) => void>(),
    };
    update = createAppUpdate(host);
    update.attach(registration as unknown as ServiceWorkerRegistration);
    registration.installing = null;
    registration.waiting = worker;
    worker.becomes('installed');
    await flush();
    expect(host.offer).toHaveBeenCalledWith(true);
  });
});

describe('a page of the waiting release', () => {
  async function ownRelease(takeover: FakeWorker['takeover'] = 'yes') {
    const worker = new FakeWorker('installing', [PAGE_FILE]);
    worker.takeover = takeover;
    registration.release(worker);
    await flush();
    return worker;
  }

  it('asks it to take over and offers nothing', async () => {
    start('/library');
    const worker = await ownRelease();
    expect(worker.sent(UPDATE_MESSAGE.skipWaiting)).toBe(1);
    expect(host.offer).not.toHaveBeenCalled();
    expect(host.reload).not.toHaveBeenCalled();
  });

  it('asks again a few times when refused, then at the next visibility change', async () => {
    start('/library');
    const worker = await ownRelease('no');
    await vi.advanceTimersByTimeAsync(TAKEOVER_RETRY_MS * (TAKEOVER_RETRIES + 3));
    expect(worker.sent(UPDATE_MESSAGE.skipWaiting)).toBe(1 + TAKEOVER_RETRIES);
    hide();
    await flush();
    expect(worker.sent(UPDATE_MESSAGE.skipWaiting)).toBe(2 + TAKEOVER_RETRIES);
  });

  it('does not ask again once the worker agreed', async () => {
    start('/library');
    const worker = await ownRelease('yes');
    await vi.advanceTimersByTimeAsync(TAKEOVER_RETRY_MS * 10);
    expect(worker.sent(UPDATE_MESSAGE.skipWaiting)).toBe(1);
  });

  it('keeps the page as it is when its release takes over', async () => {
    start('/library');
    const worker = await ownRelease();
    container.takeOver(registration, worker);
    await flush();
    expect(host.reload).not.toHaveBeenCalled();
    expect(host.offer).not.toHaveBeenCalled();
  });
});

describe('when a new worker takes the page over', () => {
  it('a page of an older release in sight keeps going and offers the update; it reloads once out of sight', async () => {
    start('/exams');
    const worker = new FakeWorker('activated', [NEW_FILE]);
    container.takeOver(registration, worker);
    await flush();
    expect(host.reload).not.toHaveBeenCalled();
    expect(host.offer).toHaveBeenCalledWith(true);
    hide();
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('a page of an older release already out of sight reloads at once, unless on the answer screen', async () => {
    start('/exams');
    page.hidden = true;
    container.takeOver(registration, new FakeWorker('activated', [NEW_FILE]));
    await flush();
    expect(host.reload).toHaveBeenCalledTimes(1);

    update.dispose();
    start('/exams/abc/ticket');
    page.hidden = true;
    container.takeOver(registration, new FakeWorker('activated', [NEW_FILE]));
    await flush();
    expect(host.reload).not.toHaveBeenCalled();
  });

  it('a page that is of the new release withdraws the offer and stays', async () => {
    start('/exams');
    await newerRelease();
    expect(host.offer).toHaveBeenLastCalledWith(true);
    // The new worker carries this page's files after all (its first answer did not come in time).
    container.takeOver(registration, new FakeWorker('activated', [PAGE_FILE, NEW_FILE]));
    await flush();
    expect(host.offer).toHaveBeenLastCalledWith(false);
    expect(host.reload).not.toHaveBeenCalled();
  });

  it('the first worker taking an uncontrolled page (a first visit) changes nothing', async () => {
    start('/');
    update.dispose();
    container = new FakeContainer();
    host.container = container as unknown as AppUpdateHost['container'];
    update = createAppUpdate(host);
    const first = new FakeWorker('activated', []);
    container.takeOver(registration, first);
    await flush();
    expect(first.messages).toEqual([]);
    expect(host.reload).not.toHaveBeenCalled();
    expect(host.offer).not.toHaveBeenCalled();
  });
});

describe('answering a worker that asks to take over', () => {
  function ask() {
    const channel = new FakeChannel();
    const answers: unknown[] = [];
    channel.port1.onmessage = (event) => answers.push(event.data);
    container.dispatchEvent(Object.assign(new Event('message'), { data: { type: UPDATE_MESSAGE.mayActivate }, ports: [channel.port2] }));
    return answers;
  }

  it('names a file of its release and whether it could reload unnoticed now', async () => {
    start('/exams');
    const inSight = ask();
    page.hidden = true;
    const outOfSight = ask();
    page.path = '/exams/abc/ticket';
    const onTicket = ask();
    page.path = '/exams';
    page.typed = true;
    const typing = ask();
    await flush();
    expect(inSight).toEqual([{ url: PAGE_FILE, free: false }]);
    expect(outOfSight).toEqual([{ url: PAGE_FILE, free: true }]);
    expect(onTicket).toEqual([{ url: PAGE_FILE, free: false }]);
    expect(typing).toEqual([{ url: PAGE_FILE, free: false }]);
    expect(container.startMessages).toHaveBeenCalled();
  });

  it('ignores other messages and stops answering once disposed', async () => {
    start('/exams');
    const channel = new FakeChannel();
    const answers: unknown[] = [];
    channel.port1.onmessage = (event) => answers.push(event.data);
    container.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'CACHE_URLS' }, ports: [channel.port2] }));
    update.dispose();
    const late = ask();
    await flush();
    expect(answers).toEqual([]);
    expect(late).toEqual([]);
  });
});

describe('checks for a release', () => {
  it('checks 60 s after registering, then every 30 minutes', async () => {
    start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS - 1);
    expect(registration.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(registration.update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(registration.update).toHaveBeenCalledTimes(3);
  });

  it('checks when the page comes back to the front after a while', async () => {
    start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
    page.hidden = true;
    update.visibilityChanged();
    await vi.advanceTimersByTimeAsync(CHECK_ON_RETURN_AFTER_MS - 1_000);
    show();
    expect(registration.update).toHaveBeenCalledTimes(1);
    page.hidden = true;
    update.visibilityChanged();
    await vi.advanceTimersByTimeAsync(2_000);
    show();
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('skips a check offline or while a release installs, and swallows a failed one', async () => {
    start();
    page.online = false;
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(registration.update).not.toHaveBeenCalled();
    page.online = true;
    registration.installing = new FakeWorker('installing', []);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(registration.update).not.toHaveBeenCalled();
    registration.installing = null;
    registration.update.mockImplementation(() => Promise.reject(new TypeError('Failed to update a ServiceWorker')));
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('stops checking once disposed', async () => {
    start();
    update.dispose();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(registration.update).not.toHaveBeenCalled();
  });
});

describe('askPrecaches', () => {
  it('takes no answer in time as no', async () => {
    const silent = { postMessage: vi.fn() } as unknown as ServiceWorker;
    const answer = askPrecaches(silent, PAGE_FILE);
    await vi.advanceTimersByTimeAsync(ANSWER_MS);
    await expect(answer).resolves.toBe(false);
  });

  it('takes a worker that is gone as no', async () => {
    const gone = {
      postMessage: () => {
        throw new DOMException('The worker is redundant', 'InvalidStateError');
      },
    } as unknown as ServiceWorker;
    await expect(askPrecaches(gone, PAGE_FILE)).resolves.toBe(false);
  });
});

describe('the plugin configuration', () => {
  it('registers in prompt mode: a new release waits instead of reloading the open pages', () => {
    expect(viteConfigSource).toMatch(/registerType:\s*'prompt'/);
    expect(viteConfigSource).not.toMatch(/registerType:\s*'autoUpdate'/);
  });
});
