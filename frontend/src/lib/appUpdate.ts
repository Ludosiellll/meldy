/**
 * How a new release reaches a page that is already open (the service worker src/sw.js, the page side
 * components/PWAUpdater.tsx). A release must never reload a page in front of the student.
 *
 * Until 2026-10-07 a new service worker took over the moment it installed, and vite-plugin-pwa
 * (autoUpdate) reloaded every open page a second later, in the middle of a click or of an answer
 * (owner: «захожу например в экзамены (а через секунду у меня обновляется сайт как будто нажали f5)»).
 * Now the new worker installs next to the old one and waits, and:
 *
 * - a page of an older release keeps working: the old worker still serves its files (the waiting worker
 *   only adds its own to the cache; the old ones go when it takes over). The page offers «Есть новая
 *   версия Meldy · Обновить» and reloads itself into the new release when nobody is looking (unnoticed:
 *   hidden, not a screen where work is in progress, no typed text on it), or on the button. Pages always
 *   come from the network, so the reload brings the new release even while the old worker serves;
 * - a page of the new release (opened or reloaded after the release reached the browser) asks the
 *   waiting worker to take over (SKIP_WAITING). The worker first asks every other window (MAY_ACTIVATE)
 *   and takes over only if each is of its release or could reload unnoticed. A window that cannot answer
 *   (a Meldy from before this change, or a frozen tab) keeps it waiting until it is gone;
 * - once the new worker has taken over, a page of an older release reloads at its next unnoticed moment
 *   (the files it has not loaded yet left the cache with the old worker), at once if it is hidden.
 *
 * Checks for a release: 60 s after the page opened, every 30 minutes, and when the page comes back to
 * the front after 5 minutes without a check.
 */

/** Messages between the pages and the service worker (src/sw.js imports these names). */
export const UPDATE_MESSAGE = {
  /**
   * Page → waiting worker: take over. The worker asks the other windows first. It is the message
   * workbox-window's messageSkipWaiting sends.
   */
  skipWaiting: 'SKIP_WAITING',
  /** Page → worker, `{ url }`: is this file part of your release? The answer is `{ precached }`. */
  precaches: 'PRECACHES',
  /** Waiting worker → page: may I take over now? The answer is `{ url, free }` (see answerFor). */
  mayActivate: 'MAY_ACTIVATE',
} as const;

/** The first check for a release after the page opened (as before). */
export const FIRST_CHECK_MS = 60_000;
/** A page left open for hours checks again this often. */
export const CHECK_EVERY_MS = 30 * 60_000;
/** A page that comes back to the front checks again when its last check is older than this. */
export const CHECK_ON_RETURN_AFTER_MS = 5 * 60_000;
/** How long a page waits for the worker's answer before taking it as «no». */
export const ANSWER_MS = 2_000;
/** The worker asks every other window before it takes over (src/sw.js waits 1.5 s for each), so this answer takes longer. */
export const TAKEOVER_ANSWER_MS = 5_000;
/**
 * A refused takeover is asked again a few times: a window that is between two pages (reloading
 * into the new release itself) cannot answer for a moment. Beyond that, the next visibility change asks.
 */
export const TAKEOVER_RETRIES = 3;
export const TAKEOVER_RETRY_MS = 5_000;

/**
 * Screens where an update waits, because work may be in progress there and a reload would lose it:
 * the rooms of components/Layout.tsx (isRoomPath: the draw, the answer, the talk about a lecture, the
 * report for the teacher), the draw and the answer of the example (/try, pages/TryExample.tsx), a
 * lecture being analysed (the file and the run would be lost: «Материал не сохранён») and the exam
 * editor (questions not saved yet). So are an exam container's «занятие» and «Как на экзамене» (an unfinished
 * session or run, also rooms of Layout) and the import page /exams/import (the parsed preview of the files would be
 * lost). There the offer is not shown either. The rooms are repeated here, not imported: Layout is a file of its own
 * that the first screen does not carry (appUpdate.test.ts keeps the two lists together).
 */
const HOLD_SCREENS: readonly RegExp[] = [
  /^\/exams\/[^/]+\/(draw|ticket|report)\/?$/,
  /^\/library\/[^/]+\/talk\/?$/,
  /^\/try\/(draw|ticket)\/?$/,
  /^\/analyze\/?$/,
  /^\/exams\/(new|[^/]+\/edit)\/?$/,
  /^\/exams\/c\/[^/]+\/(study|mock)\/?$/,
  /^\/exams\/import\/?$/,
];

export function holdsUpdate(pathname: string): boolean {
  return HOLD_SCREENS.some((screen) => screen.test(pathname));
}

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password']);

/** Text a reload would lose: a text field or text area that holds something, or a chosen file. */
export function hasTypedText(root: ParentNode): boolean {
  for (const field of Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))) {
    if (field.disabled || field.readOnly) continue;
    if (field instanceof HTMLInputElement) {
      if (field.type === 'file') {
        if (field.files && field.files.length > 0) return true;
        continue;
      }
      if (!TEXT_INPUTS.has(field.type)) continue;
    }
    if (field.value.trim() !== '') return true;
  }
  return false;
}

/** What a page answers a worker that asks to take over (MAY_ACTIVATE). */
export interface TakeoverAnswer {
  /** A file of the page's release: the worker knows whether it precaches it, so whether the page is its release. */
  url: string;
  /** The page could reload right now without anyone noticing. */
  free: boolean;
}

/** Sends a message to a worker and waits for its answer on a channel of its own; null when none comes in time. */
export function askWorker<T>(worker: ServiceWorker, message: { type: string; url?: string }, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const channel = new MessageChannel();
    const finish = (answer: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.port1.onmessage = null;
      channel.port1.close();
      resolve(answer);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => finish((event.data ?? null) as T | null);
    try {
      worker.postMessage(message, [channel.port2]);
    } catch {
      // The worker is gone (a newer one replaced it).
      finish(null);
    }
  });
}

/** Asks a worker whether `url` is part of its release; no answer in time counts as no. */
export async function askPrecaches(worker: ServiceWorker, url: string, timeoutMs: number = ANSWER_MS): Promise<boolean> {
  const answer = await askWorker<{ precached?: unknown }>(worker, { type: UPDATE_MESSAGE.precaches, url }, timeoutMs);
  return answer?.precached === true;
}

type WorkerContainer = Pick<ServiceWorkerContainer, 'controller' | 'addEventListener' | 'removeEventListener'> & {
  startMessages?: () => void;
};

/** What the update logic needs from the page (the browser's, or a test's). */
export interface AppUpdateHost {
  container: WorkerContainer;
  /** A file of this page's release (PWAUpdater passes its own module's URL). */
  pageFile: string;
  pathname(): string;
  hidden(): boolean;
  typedText(): boolean;
  online(): boolean;
  now(): number;
  reload(): void;
  /** Show (true) or take away (false) the offer «Есть новая версия Meldy · Обновить». */
  offer(shown: boolean): void;
}

export interface AppUpdate {
  /** The registration, once vite-plugin-pwa has registered the worker. */
  attach(registration: ServiceWorkerRegistration): void;
  /** visibilitychange. */
  visibilityChanged(): void;
  /** «Обновить»: this page reloads into the new release. */
  reloadNow(): void;
  dispose(): void;
}

export function createAppUpdate(host: AppUpdateHost): AppUpdate {
  let registration: ServiceWorkerRegistration | null = null;
  /** A newer release than this page waits or already serves: the offer is out, a reload is due. */
  let newer = false;
  /** A waiting worker of this page's own release: this page asks it to take over. */
  let mine: ServiceWorker | null = null;
  let controller = host.container.controller;
  let lastCheck = host.now();
  let reloading = false;
  let disposed = false;
  const timeouts: number[] = [];
  const intervals: number[] = [];

  const unnoticed = () => host.hidden() && !holdsUpdate(host.pathname()) && !host.typedText();

  function reload() {
    if (reloading || disposed) return;
    reloading = true;
    host.reload();
  }

  function becomeNewer() {
    mine = null;
    if (!newer) {
      newer = true;
      host.offer(true);
    }
    if (unnoticed()) reload();
  }

  let retry = 0;
  let asking = false;
  async function askToTakeOver(retries: number = TAKEOVER_RETRIES) {
    const worker = mine;
    // One question at a time: an answer still on its way decides about the next one.
    if (!worker || disposed || asking) return;
    window.clearTimeout(retry);
    asking = true;
    const answer = await askWorker<{ activating?: unknown }>(worker, { type: UPDATE_MESSAGE.skipWaiting }, TAKEOVER_ANSWER_MS);
    asking = false;
    if (answer?.activating === true || disposed || mine !== worker || retries <= 0) return;
    // Refused, or no answer: another window was busy, or between two pages for a moment.
    retry = window.setTimeout(() => void askToTakeOver(retries - 1), TAKEOVER_RETRY_MS);
  }

  async function workerWaits(worker: ServiceWorker) {
    const precached = await askPrecaches(worker, host.pageFile);
    if (disposed || registration?.waiting !== worker) return;
    if (precached) {
      // This page already is the waiting release (it came from the network after the release).
      mine = worker;
      void askToTakeOver();
    } else {
      becomeNewer();
    }
  }

  function check() {
    const current = registration;
    if (!current || disposed || current.installing || !host.online()) return;
    lastCheck = host.now();
    // Offline or a server error: the next check tries again; the rejection is not an app error.
    current.update().catch(() => undefined);
  }

  async function controllerChanged() {
    const previous = controller;
    controller = host.container.controller;
    // The first worker took the page (a first visit), or the worker was unregistered: nothing older to leave.
    if (!previous || !controller) return;
    mine = null;
    window.clearTimeout(retry);
    if (await askPrecaches(controller, host.pageFile)) {
      if (newer) {
        newer = false;
        host.offer(false);
      }
      return;
    }
    if (!disposed) becomeNewer();
  }

  function answerFor(event: MessageEvent) {
    if (event.data?.type !== UPDATE_MESSAGE.mayActivate) return;
    const answer: TakeoverAnswer = { url: host.pageFile, free: unnoticed() };
    event.ports?.[0]?.postMessage(answer);
  }

  const onControllerChange = () => void controllerChanged();
  host.container.addEventListener('controllerchange', onControllerChange);
  host.container.addEventListener('message', answerFor as EventListener);
  // Messages from a worker reach the page once its queue is open (it opens by itself after the page loads).
  host.container.startMessages?.();

  return {
    attach(next) {
      if (disposed || registration) return;
      registration = next;
      const watched = new WeakSet<ServiceWorker>();
      const watch = (worker: ServiceWorker | null) => {
        if (!worker || watched.has(worker)) return;
        watched.add(worker);
        worker.addEventListener('statechange', () => {
          // Installed while another worker serves: it waits (a first install goes on to activate).
          if (worker.state === 'installed' && next.waiting === worker && next.active) void workerWaits(worker);
        });
      };
      if (next.waiting && next.active) void workerWaits(next.waiting);
      // An update the browser started before this page registered (the check on navigating here).
      watch(next.installing);
      next.addEventListener('updatefound', () => watch(next.installing));
      timeouts.push(window.setTimeout(check, FIRST_CHECK_MS));
      intervals.push(window.setInterval(check, CHECK_EVERY_MS));
    },
    visibilityChanged() {
      if (newer && unnoticed()) {
        reload();
        return;
      }
      // The other windows may have gone out of sight: ask again.
      if (mine) void askToTakeOver();
      if (!host.hidden() && host.now() - lastCheck >= CHECK_ON_RETURN_AFTER_MS) check();
    },
    reloadNow() {
      // Asked for: even if an earlier reload was held up (a «leave the page?» question answered «stay»).
      reloading = true;
      host.reload();
    },
    dispose() {
      disposed = true;
      window.clearTimeout(retry);
      timeouts.forEach((id) => window.clearTimeout(id));
      intervals.forEach((id) => window.clearInterval(id));
      host.container.removeEventListener('controllerchange', onControllerChange);
      host.container.removeEventListener('message', answerFor as EventListener);
    },
  };
}
