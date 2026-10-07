import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { UPDATE_MESSAGE } from '../lib/appUpdate';

const mocks = vi.hoisted(() => ({ registerSW: vi.fn() }));
vi.mock('../lib/pwaRegister', () => ({ registerSW: mocks.registerSW }));

import PWAUpdater from './PWAUpdater';

/** The file the component names as its release's: its own module (a file: or a dev server URL, as Vitest serves it). */
const PAGE_FILE = /\/src\/components\/PWAUpdater\.tsx$/;
const NEW_FILE = /\/assets\/index-NEW\.js$/;
const OFFER = 'Есть новая версия Meldy';

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  other: FakePort | null = null;
  closed = false;
  postMessage(data: unknown) {
    const target = this.other;
    queueMicrotask(() => {
      if (target && !target.closed) target.onmessage?.({ data });
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

class FakeWorker extends EventTarget {
  messages: string[] = [];
  constructor(public state: ServiceWorkerState, private files: RegExp[]) {
    super();
  }
  postMessage(message: { type: string; url?: string }, transfer?: unknown[]) {
    this.messages.push(message.type);
    const port = transfer?.[0] as FakePort | undefined;
    if (message.type === UPDATE_MESSAGE.precaches) port?.postMessage({ precached: this.files.some((file) => file.test(message.url ?? '')) });
    if (message.type === UPDATE_MESSAGE.skipWaiting) port?.postMessage({ activating: true });
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = new FakeWorker('activated', [PAGE_FILE]);
  update = vi.fn(() => Promise.resolve());
  release(worker: FakeWorker) {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    this.installing = null;
    this.waiting = worker;
    worker.state = 'installed';
    worker.dispatchEvent(new Event('statechange'));
  }
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null;
  startMessages() {}
}

const originalLocation = window.location;
let reload: Mock<() => void>;
let registration: FakeRegistration;
let navigate: NavigateFunction;
let visibility: DocumentVisibilityState;

function Navigator() {
  navigate = useNavigate();
  return null;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Navigator />
      <PWAUpdater />
      <Toaster />
    </MemoryRouter>,
  );
}

/** The plugin registered the worker (registerSW's onRegisteredSW). */
function registered() {
  const options = mocks.registerSW.mock.calls[0][0] as RegisterSWOptions;
  act(() => options.onRegisteredSW?.('/sw.js', registration as unknown as ServiceWorkerRegistration));
}

async function release(files: RegExp[]) {
  const worker = new FakeWorker('installing', files);
  await act(async () => {
    registration.release(worker);
    // The worker's answers travel through message channels: let them arrive.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  return worker;
}

function goOutOfSight() {
  visibility = 'hidden';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  mocks.registerSW.mockReset();
  reload = vi.fn<() => void>();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } });
  const container = new FakeContainer();
  container.controller = new FakeWorker('activated', [PAGE_FILE]);
  Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: container });
  vi.stubGlobal('MessageChannel', FakeChannel);
  // react-hot-toast asks for reduced motion; jsdom has no matchMedia.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  registration = new FakeRegistration();
});

afterEach(() => {
  cleanup();
  // The toasts live in react-hot-toast's store, beyond the Toaster of one test.
  toast.remove();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (document as { visibilityState?: unknown }).visibilityState;
  vi.unstubAllGlobals();
});

describe('PWAUpdater', () => {
  it('registers the worker at once and keeps the plugin from reloading the page by itself', () => {
    renderAt('/dashboard');
    expect(mocks.registerSW).toHaveBeenCalledTimes(1);
    const options = mocks.registerSW.mock.calls[0][0] as RegisterSWOptions;
    expect(options.immediate).toBe(true);
    // In prompt mode the plugin calls this when a new worker takes the page over, instead of reloading.
    expect(typeof options.onNeedReload).toBe('function');
    options.onNeedReload?.();
    expect(reload).not.toHaveBeenCalled();
  });

  it('offers «Есть новая версия Meldy» once to a page of an older release, and reloads on «Обновить»', async () => {
    renderAt('/dashboard');
    registered();
    await release([NEW_FILE]);
    expect(await screen.findByText(OFFER)).toBeInTheDocument();
    await release([/\/assets\/index-NEWER\.js$/]);
    expect(screen.getAllByText(OFFER)).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('puts the offer away on «Закрыть» for this page, also after the answer screen', async () => {
    renderAt('/exams/abc');
    registered();
    await release([NEW_FILE]);
    expect(await screen.findByText(OFFER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    act(() => navigate('/exams/abc/ticket'));
    act(() => navigate('/exams/abc'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
    });
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    // The update still comes when nobody is looking.
    goOutOfSight();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows no offer on the answer screen, and shows it once the student has left it', async () => {
    renderAt('/exams/abc/ticket');
    registered();
    await release([NEW_FILE]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();
    act(() => navigate('/exams/abc'));
    expect(await screen.findByText(OFFER)).toBeInTheDocument();
  });

  it('reloads a page of an older release when it goes out of sight on an ordinary screen', async () => {
    renderAt('/library');
    registered();
    await release([NEW_FILE]);
    goOutOfSight();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload out of sight on the answer screen', async () => {
    renderAt('/exams/abc/ticket');
    registered();
    await release([NEW_FILE]);
    goOutOfSight();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload out of sight while a field on the page holds typed text', async () => {
    renderAt('/library');
    const field = document.createElement('input');
    field.value = 'Нормальные формы';
    document.body.append(field);
    registered();
    await release([NEW_FILE]);
    goOutOfSight();
    expect(reload).not.toHaveBeenCalled();
    field.remove();
  });

  it('asks a waiting worker of its own release to take over, and offers nothing', async () => {
    renderAt('/library');
    registered();
    const worker = await release([PAGE_FILE]);
    expect(worker.messages).toEqual([UPDATE_MESSAGE.precaches, UPDATE_MESSAGE.skipWaiting]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
