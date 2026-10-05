/**
 * Meldy's own statistics and error reports (2026-10-05). Events go to POST /api/telemetry on this site
 * (backend/telemetry_api.py), which keeps them in the project's own database (public.app_events); nothing
 * is sent to a third party. An event carries its name, a few short props, the route pattern
 * (/exams/:id/ticket — never ids or query strings), a random id of the browser tab, the device class
 * (mobile / tablet / desktop) and the build version. Never the IP address or the user-agent string, never
 * the text of a lecture or an answer. A signed-in student's events are tied to the account by the server,
 * from the session token; this code never names the user. What is recorded: docs/analytics.md.
 *
 * - track(name, props): a product event. Skipped when the browser sends Do Not Track.
 * - captureError(error, context): an error report. Sent with Do Not Track too: it says nothing about use.
 * - Page views on every route change; window 'error' and 'unhandledrejection'; API failures from the fetch
 *   wrapper in lib/apiAuth.ts (status 500 and above, or no answer at all).
 *
 * Nothing is sent before installTelemetry() (main.tsx), so tests of pages stay quiet. Events are batched:
 * a request at most every 5 s, at once when 50 are waiting, and everything left when the tab is hidden or
 * closed (fetch with keepalive, through the lib/apiAuth wrapper so the session token goes along). Nothing
 * here throws, and it works when sessionStorage is blocked.
 */

export type TelemetryValue = string | number | boolean | null | undefined;
export type TelemetryProps = Record<string, TelemetryValue>;

type Kind = 'event' | 'client_error';
type Device = 'mobile' | 'tablet' | 'desktop';

export interface TelemetryEvent {
  kind: Kind;
  name: string;
  route?: string;
  session?: string;
  device?: Device;
  app_version?: string;
  props?: Record<string, string | number | boolean | null>;
  message?: string;
  stack?: string;
}

export interface ErrorContext {
  /** A short identifier of where it happened: window_error, react_render, api_failure… */
  name?: string;
  props?: TelemetryProps;
  /** React's component stack (component names only), added to the stack. */
  componentStack?: string | null;
}

declare const __MELDY_BUILD__: string | undefined;

export const TELEMETRY_ENDPOINT = '/api/telemetry';
/** The one sentence the app says about it (the landing footer and the profile). */
export const TELEMETRY_NOTE =
  'Чтобы улучшать сервис, Meldy записывает статистику использования и отчёты об ошибках — без текстов лекций и ответов.';
export const FLUSH_MS = 5_000;
export const MAX_BATCH = 50;
/** Under the server's 32 KB per request. */
export const MAX_BODY_BYTES = 30 * 1024;
const MAX_QUEUE = 200;
const PAGE_VIEW_SETTLE_MS = 300;
const MAX_SAME_ERROR = 3;
const MAX_ERRORS_PER_PAGE = 30;
const MESSAGE_MAX = 500;
const STACK_MAX = 4000;
const PROPS_MAX_KEYS = 12;
const PROP_TEXT_MAX = 80;
const SESSION_KEY = 'meldy_telemetry_session';
const SESSION_HEADER = 'X-Meldy-Session';

const NAME_RE = /^[a-z0-9_.:-]{1,60}$/;
const PROP_KEY_RE = /^[a-z0-9_]{1,40}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{8,40}$/;
const VERSION_RE = /^[A-Za-z0-9._+-]{1,40}$/;
/** A path segment kept as it is: a lowercase word (dashboard, knowledge-map, code_diagnostics); anything else is an id. */
const WORD_SEGMENT_RE = /^[a-z][a-z_-]{0,39}$/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const state = {
  installed: false,
  queue: [] as TelemetryEvent[],
  timer: null as ReturnType<typeof setTimeout> | null,
  pageTimer: null as ReturnType<typeof setTimeout> | null,
  lastPath: null as string | null,
  session: null as string | null,
  device: null as Device | null,
  errorCounts: new Map<string, number>(),
  errorsQueued: 0,
  cleanup: [] as Array<() => void>,
};

// ── Small helpers (exported for tests and for the one-line calls in pages) ─────

/** The route pattern of a path: /exams/0f8c…/ticket → /exams/:id/ticket. No ids, no query, no hash. */
export function routePattern(path: string): string {
  try {
    const bare = String(path || '/').split(/[?#]/)[0];
    const segments = bare.split('/').filter(Boolean).slice(0, 8);
    const pattern = '/' + segments.map((segment) => (WORD_SEGMENT_RE.test(segment) ? segment : ':id')).join('/');
    return pattern.slice(0, 120);
  } catch {
    return '/';
  }
}

/** «0», «1-2», «3-5»… for a count; tiny props instead of exact numbers. */
export function countBucket(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  const edges = [2, 5, 10, 20, 40, 80, 150, 300];
  let low = 1;
  for (const edge of edges) {
    if (count <= edge) return low === edge ? String(edge) : `${low}-${edge}`;
    low = edge + 1;
  }
  return `${low}+`;
}

/** «<30s», «30-60s», «1-2m»… for a duration in milliseconds. */
export function secondsBucket(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, ms) / 1000 : 0;
  if (seconds < 30) return '<30s';
  if (seconds < 60) return '30-60s';
  if (seconds < 120) return '1-2m';
  if (seconds < 300) return '2-5m';
  if (seconds < 600) return '5-10m';
  return '10m+';
}

/** «<1s», «1-2s», «2-3s», «3s+» for a short wait in milliseconds (a reply of the voice tutor). */
export function waitBucket(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, ms) / 1000 : 0;
  if (seconds < 1) return '<1s';
  if (seconds < 2) return '1-2s';
  if (seconds < 3) return '2-3s';
  return '3s+';
}

/** «<1m», «1-2m», «2-5m», «5-10m», «10-20m», «20m+» for a longer stretch (a conversation with the tutor). */
export function minutesBucket(ms: number): string {
  const minutes = Number.isFinite(ms) ? Math.max(0, ms) / 60_000 : 0;
  if (minutes < 1) return '<1m';
  if (minutes < 2) return '1-2m';
  if (minutes < 5) return '2-5m';
  if (minutes < 10) return '5-10m';
  if (minutes < 20) return '10-20m';
  return '20m+';
}

/** Takes out what could quote a person or their text: e-mails, ids, query strings, long quoted fragments. */
export function scrub(text: string, max: number): string {
  return String(text)
    .replace(/\b(https?:\/\/[^\s?#'")]+)[?#][^\s'")]*/g, '$1')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(UUID_RE, ':id')
    .replace(/(["'«“])[^"'»”\n]{16,}(["'»”])/g, '$1…$2')
    .slice(0, max);
}

function doNotTrack(): boolean {
  try {
    const nav = navigator as Navigator & { msDoNotTrack?: string };
    const win = window as Window & { doNotTrack?: string };
    return nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || win.doNotTrack === '1' || nav.msDoNotTrack === '1';
  } catch {
    return false;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(20);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from(bytes, (byte) => alphabet[byte % 64]).join('');
}

/** A random id of this browser tab (sessionStorage); a new one per page load when storage is blocked. */
function sessionId(): string {
  if (state.session) return state.session;
  let id: string | null = null;
  try {
    id = window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    id = null;
  }
  if (!id || !SESSION_RE.test(id)) {
    id = randomId();
    try {
      window.sessionStorage.setItem(SESSION_KEY, id);
    } catch {
      // blocked storage: the id lives as long as this page
    }
  }
  state.session = id;
  return id;
}

/** mobile / tablet / desktop from the viewport and the pointer; no model names, no user-agent string. */
export function deviceClass(): Device | undefined {
  try {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const width = window.innerWidth || 0;
    const screenShort = Math.min(window.screen?.width || width, window.screen?.height || width) || width;
    if (coarse) return screenShort < 600 ? 'mobile' : 'tablet';
    return width > 0 && width < 640 ? 'mobile' : 'desktop';
  } catch {
    return undefined;
  }
}

/** The build's version (vite.config.ts); «dev» on the development server, so its events are easy to leave out. */
function appVersion(): string | undefined {
  const build = !import.meta.env.DEV && typeof __MELDY_BUILD__ === 'string' ? __MELDY_BUILD__ : 'dev';
  return VERSION_RE.test(build) ? build : undefined;
}

function cleanProps(props: TelemetryProps | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!props || typeof props !== 'object') return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  let count = 0;
  for (const [key, value] of Object.entries(props)) {
    if (count >= PROPS_MAX_KEYS) break;
    if (!PROP_KEY_RE.test(key) || value === undefined) continue;
    if (value === null || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      out[key] = value;
    } else if (typeof value === 'string') out[key] = value.slice(0, PROP_TEXT_MAX);
    else continue;
    count += 1;
  }
  return count > 0 ? out : undefined;
}

function currentRoute(): string | undefined {
  try {
    return routePattern(window.location.pathname);
  } catch {
    return undefined;
  }
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

// ── The queue ─────────────────────────────────────────────────────────────────

function enqueue(event: Omit<TelemetryEvent, 'route' | 'session' | 'device' | 'app_version'>): void {
  if (state.queue.length >= MAX_QUEUE) return;
  const full: TelemetryEvent = { ...event, session: sessionId() };
  const route = currentRoute();
  if (route) full.route = route;
  if (state.device) full.device = state.device;
  const version = appVersion();
  if (version) full.app_version = version;
  state.queue.push(full);
  if (state.queue.length >= MAX_BATCH) flushTelemetry();
  else scheduleFlush();
}

function scheduleFlush(): void {
  if (state.timer !== null || state.queue.length === 0) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    flushTelemetry();
  }, FLUSH_MS);
}

/** Up to 50 events and 30 KB from the head of the queue. */
function takeBatch(): TelemetryEvent[] {
  const batch: TelemetryEvent[] = [];
  let bytes = 16; // {"events":[]}
  while (state.queue.length > 0 && batch.length < MAX_BATCH) {
    const size = utf8Length(JSON.stringify(state.queue[0])) + 1;
    if (batch.length > 0 && bytes + size > MAX_BODY_BYTES) break;
    if (size > MAX_BODY_BYTES) {
      state.queue.shift(); // cannot be sent at all
      continue;
    }
    bytes += size;
    batch.push(state.queue.shift()!);
  }
  return batch;
}

function send(batch: TelemetryEvent[]): void {
  try {
    if (typeof window.fetch !== 'function') return;
    const body = JSON.stringify({ events: batch });
    void window
      .fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [SESSION_HEADER]: sessionId() },
        body,
        keepalive: true,
        credentials: 'same-origin',
      })
      .catch(() => undefined);
  } catch {
    // statistics never break the page
  }
}

/**
 * Sends what is waiting: one batch, or with `all` (the tab is hidden or closing) up to two, which is what
 * the browser lets keepalive requests carry (64 KB in all). Returns the number of events handed to fetch.
 */
export function flushTelemetry(options: { all?: boolean } = {}): number {
  try {
    if (!state.installed) return 0;
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    let sent = 0;
    let rounds = options.all ? 2 : 1;
    while (rounds > 0 && state.queue.length > 0) {
      const batch = takeBatch();
      if (batch.length === 0) break;
      send(batch);
      sent += batch.length;
      rounds -= 1;
    }
    scheduleFlush();
    return sent;
  } catch {
    return 0;
  }
}

// ── Public calls ──────────────────────────────────────────────────────────────

/** A product event (see docs/analytics.md for the names); props are a few short values, never content. */
export function track(name: string, props?: TelemetryProps): void {
  try {
    if (!state.installed || doNotTrack() || !NAME_RE.test(name)) return;
    const cleaned = cleanProps(props);
    enqueue(cleaned ? { kind: 'event', name, props: cleaned } : { kind: 'event', name });
  } catch {
    // never throws
  }
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    const message = error.message ? `${error.name || 'Error'}: ${error.message}` : error.name || 'Error';
    return { message, stack: typeof error.stack === 'string' ? error.stack : undefined };
  }
  if (typeof error === 'string') return { message: error };
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return { message: (error as { message: string }).message };
  }
  return { message: `Non-error thrown: ${error === null ? 'null' : typeof error}` };
}

function isNoise(message: string, stack: string | undefined, error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (/^(Script error\.?|ResizeObserver loop)/.test(message)) return true;
  return /(chrome|moz|safari|safari-web)-extension:\/\//.test(`${message}\n${stack ?? ''}`);
}

/** An error report: the error's class and message (scrubbed), its stack and where it happened. */
export function captureError(error: unknown, context: ErrorContext = {}): void {
  try {
    if (!state.installed) return;
    const { message: rawMessage, stack: rawStack } = describe(error);
    if (isNoise(rawMessage, rawStack, error)) return;
    const name = context.name && NAME_RE.test(context.name) ? context.name : 'error';
    const message = scrub(rawMessage, MESSAGE_MAX).trim() || 'Error';
    const signature = `${name}|${message}`;
    const seen = state.errorCounts.get(signature) ?? 0;
    if (seen >= MAX_SAME_ERROR || state.errorsQueued >= MAX_ERRORS_PER_PAGE) return;
    state.errorCounts.set(signature, seen + 1);
    state.errorsQueued += 1;
    const components = context.componentStack ? `\n--- components ---${context.componentStack}` : '';
    const stack = rawStack || components ? scrub(`${rawStack ?? ''}${components}`, STACK_MAX) : undefined;
    const event: Omit<TelemetryEvent, 'route' | 'session' | 'device' | 'app_version'> = { kind: 'client_error', name, message };
    if (stack) event.stack = stack;
    const props = cleanProps(context.props);
    if (props) event.props = props;
    enqueue(event);
  } catch {
    // never throws
  }
}

/** lib/apiAuth: a backend call failed (status 500+, or 0 when no answer came). Path pattern and status only. */
export function captureApiFailure(url: string, status: number): void {
  try {
    const path = String(url || '').replace(/^https?:\/\/[^/]+/, '');
    if (!path.startsWith('/api/') || path.startsWith(TELEMETRY_ENDPOINT)) return;
    const api = routePattern(path);
    const code = Number.isFinite(status) ? Math.trunc(status) : 0;
    captureError(`${code || 'network'} ${api}`, { name: 'api_failure', props: { api, status: code } });
  } catch {
    // never throws
  }
}

// ── Page views and global handlers ────────────────────────────────────────────

function recordPageView(): void {
  try {
    const path = window.location.pathname;
    if (path === state.lastPath) return;
    state.lastPath = path;
    track('page_view');
  } catch {
    // never throws
  }
}

/** A redirect (a signed-out /dashboard → /login) settles first: only the page that stays is counted. */
function schedulePageView(): void {
  if (state.pageTimer !== null) clearTimeout(state.pageTimer);
  state.pageTimer = setTimeout(() => {
    state.pageTimer = null;
    recordPageView();
  }, PAGE_VIEW_SETTLE_MS);
}

function patchHistory(): void {
  const history = window.history;
  if (!history || typeof history.pushState !== 'function') return;
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function pushState(this: History, ...args: Parameters<History['pushState']>) {
    const result = push.apply(this, args);
    schedulePageView();
    return result;
  };
  history.replaceState = function replaceState(this: History, ...args: Parameters<History['replaceState']>) {
    const result = replace.apply(this, args);
    schedulePageView();
    return result;
  };
  state.cleanup.push(() => {
    history.pushState = push;
    history.replaceState = replace;
  });
}

function listen<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void) {
  window.addEventListener(type, handler);
  state.cleanup.push(() => window.removeEventListener(type, handler));
}

/** Starts the statistics once (main.tsx): page views, the global error handlers, the flush on hide. */
export function installTelemetry(): void {
  if (state.installed || typeof window === 'undefined') return;
  state.installed = true;
  try {
    state.device = deviceClass() ?? null;
    listen('error', (event) => {
      // Resource errors (a broken image) have no ErrorEvent and are not errors of the app.
      if (!(event instanceof ErrorEvent)) return;
      captureError(event.error ?? event.message, { name: 'window_error' });
    });
    listen('unhandledrejection', (event) => captureError(event.reason, { name: 'unhandled_rejection' }));
    listen('pagehide', () => flushTelemetry({ all: true }));
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushTelemetry({ all: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    state.cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility));
    listen('popstate', () => schedulePageView());
    patchHistory();
    schedulePageView();
  } catch {
    // a browser without one of these still gets the rest
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/** For tests: undo installTelemetry() and forget everything queued. */
export function resetTelemetryForTests(): void {
  for (const undo of state.cleanup.splice(0).reverse()) {
    try {
      undo();
    } catch {
      // ignore
    }
  }
  if (state.timer !== null) clearTimeout(state.timer);
  if (state.pageTimer !== null) clearTimeout(state.pageTimer);
  state.installed = false;
  state.queue = [];
  state.timer = null;
  state.pageTimer = null;
  state.lastPath = null;
  state.session = null;
  state.device = null;
  state.errorCounts = new Map();
  state.errorsQueued = 0;
}

/** For tests: the events waiting to be sent. */
export function queuedTelemetryForTests(): TelemetryEvent[] {
  return state.queue.map((event) => ({ ...event }));
}
