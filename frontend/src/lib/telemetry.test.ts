import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: { access_token: string } | null) => void),
  session: { access_token: 'token-a' } as { access_token: string } | null,
  hangGetSession: false,
}));

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        auth.hangGetSession ? new Promise(() => undefined) : Promise.resolve({ data: { session: auth.session } }),
      onAuthStateChange: (listener: (event: string, session: { access_token: string } | null) => void) => {
        auth.listener = listener;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  },
}));

import {
  FLUSH_MS,
  MAX_BATCH,
  captureApiFailure,
  captureError,
  countBucket,
  flushTelemetry,
  installTelemetry,
  minutesBucket,
  queuedTelemetryForTests,
  resetTelemetryForTests,
  routePattern,
  scrub,
  secondsBucket,
  track,
  waitBucket,
  type TelemetryEvent,
} from './telemetry';
import { installApiAuth, resetApiAuthForTests } from './apiAuth';

const UUID = '0f8c3c1e-5d2a-4a3b-9c1d-2e3f4a5b6c7d';
const originalFetch = window.fetch;
let sent: Array<{ url: string; init: RequestInit; events: TelemetryEvent[] }> = [];

function mockFetch(answer: (url: string) => Response | Promise<Response> = () => new Response(null, { status: 204 })) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (url === '/api/telemetry') sent.push({ url, init: init ?? {}, events: JSON.parse(String(init?.body)).events });
    return answer(url);
  });
  window.fetch = fn as typeof window.fetch;
  return fn;
}

function setDoNotTrack(value: string | null) {
  Object.defineProperty(window.navigator, 'doNotTrack', { value, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  auth.session = { access_token: 'token-a' };
  auth.hangGetSession = false;
  auth.listener = null;
  setDoNotTrack(null);
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  resetTelemetryForTests();
  resetApiAuthForTests();
  mockFetch();
});

afterEach(() => {
  delete (document as { visibilityState?: unknown }).visibilityState;
  resetTelemetryForTests();
  resetApiAuthForTests();
  window.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('route patterns and buckets', () => {
  it('keeps words and turns everything else into :id, without query or hash', () => {
    expect(routePattern(`/exams/${UUID}/ticket`)).toBe('/exams/:id/ticket');
    expect(routePattern('/exams/new')).toBe('/exams/new');
    expect(routePattern(`/library/${UUID}?section=quiz#cards`)).toBe('/library/:id');
    expect(routePattern('/try/ticket?q=macro-12')).toBe('/try/ticket');
    expect(routePattern('/profile/12345')).toBe('/profile/:id');
    expect(routePattern(`/api/exams/${UUID}/map`)).toBe('/api/exams/:id/map');
    expect(routePattern('/api/career/code_diagnostics')).toBe('/api/career/code_diagnostics');
    expect(routePattern('/shared/AbC9xYz')).toBe('/shared/:id');
    expect(routePattern('/')).toBe('/');
    expect(routePattern('')).toBe('/');
  });

  it('always masks the code of a group link, even one made only of letters', () => {
    // Codes are 12 characters of 0-9a-hjkmnp-tv-z: «abcdefghjkmn» would otherwise pass as a word and be recorded.
    expect(routePattern('/join/abcdefghjkmn')).toBe('/join/:id');
    expect(routePattern('/g/abcdefghjkmn')).toBe('/g/:id');
    expect(routePattern('/g/abcdefghjkmn/')).toBe('/g/:id');
    expect(routePattern('/g/ab12cd34ef56?next=/exams')).toBe('/g/:id');
    expect(routePattern('/join/ABC-def')).toBe('/join/:id');
    expect(routePattern('/join')).toBe('/join');
    expect(routePattern('/g')).toBe('/g');
    expect(routePattern('/api/exam-shares/join')).toBe('/api/exam-shares/join');
    expect(routePattern(`/exams/c/${UUID}/study`)).toBe('/exams/c/:id/study');
    expect(routePattern('/exams/import')).toBe('/exams/import');
  });

  it('gives sizes and times as small buckets', () => {
    expect([0, 1, 2, 3, 5, 6, 40, 41, 300, 301].map(countBucket)).toEqual(['0', '1-2', '1-2', '3-5', '3-5', '6-10', '21-40', '41-80', '151-300', '301+']);
    expect([1_000, 45_000, 90_000, 200_000, 400_000, 900_000].map(secondsBucket)).toEqual(['<30s', '30-60s', '1-2m', '2-5m', '5-10m', '10m+']);
  });

  it('gives the tutor’s waits and conversations as small buckets', () => {
    expect([0, 999, 1_000, 1_999, 2_000, 2_999, 3_000, 25_000, Number.NaN, -5].map(waitBucket)).toEqual([
      '<1s',
      '<1s',
      '1-2s',
      '1-2s',
      '2-3s',
      '2-3s',
      '3s+',
      '3s+',
      '<1s',
      '<1s',
    ]);
    expect([0, 59_999, 60_000, 150_000, 300_000, 700_000, 1_200_000, Number.POSITIVE_INFINITY].map(minutesBucket)).toEqual([
      '<1m',
      '<1m',
      '1-2m',
      '2-5m',
      '5-10m',
      '10-20m',
      '20m+',
      '<1m',
    ]);
  });

  it('records the tutor’s events with their small props', () => {
    installTelemetry();
    track('tutor_started', { cards: 4 });
    track('tutor_turn', { move: 'nudge', status: 'missing', wait: waitBucket(1_500) });
    track('tutor_finished', { cards: 3, self: 1, assisted: 2, minutes: minutesBucket(200_000), reason: 'left' });
    const events = queuedTelemetryForTests().filter((event) => event.name.startsWith('tutor_'));
    expect(events.map((event) => [event.name, event.props])).toEqual([
      ['tutor_started', { cards: 4 }],
      ['tutor_turn', { move: 'nudge', status: 'missing', wait: '1-2s' }],
      ['tutor_finished', { cards: 3, self: 1, assisted: 2, minutes: '2-5m', reason: 'left' }],
    ]);
  });

  it('takes out e-mails, ids, query strings and long quotes', () => {
    const text = scrub(
      `Unexpected token 'П', "Привет, это мой конспект по макроэкономике" is not valid JSON at https://meldy.app/exams/${UUID}/ticket?q=секрет for anna@example.com`,
      500,
    );
    expect(text).toBe(`Unexpected token 'П', "…" is not valid JSON at https://meldy.app/exams/:id/ticket for <email>`);
    expect(scrub('x'.repeat(900), 500)).toHaveLength(500);
  });
});

describe('track and the queue', () => {
  it('sends nothing before installTelemetry()', () => {
    track('page_view');
    captureError(new Error('early'));
    vi.advanceTimersByTime(FLUSH_MS * 2);
    expect(queuedTelemetryForTests()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('batches events and sends them every five seconds with the route pattern, session and device', () => {
    installTelemetry();
    window.history.replaceState(null, '', `/exams/${UUID}/ticket?q=1`);
    track('answer_started', { mode: 'voice', engine: 'browser', long: 'x'.repeat(200), nested: { a: 1 } as never, 'Bad Key': 1, n: Number.NaN });
    track('answer_finished', { checked: true, time: '<30s' });
    track('Not A Name');
    vi.advanceTimersByTime(FLUSH_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
    const [{ init, events }] = sent;
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    const session = new Headers(init.headers).get('X-Meldy-Session');
    expect(session).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(window.sessionStorage.getItem('meldy_telemetry_session')).toBe(session);
    // The two events, then the page view once the route settled (300 ms), as its pattern.
    const names = events.map((event) => event.name);
    expect(names).toEqual(['answer_started', 'answer_finished', 'page_view']);
    expect(events[2].route).toBe('/exams/:id/ticket');
    expect(events[0]).toEqual({
      kind: 'event',
      name: 'answer_started',
      props: { mode: 'voice', engine: 'browser', long: 'x'.repeat(80) },
      session,
      route: '/exams/:id/ticket',
      device: 'desktop',
      app_version: 'dev',
    });
    expect(JSON.stringify(events)).not.toContain(UUID);
  });

  it('sends at once when fifty are waiting, and at most fifty in one request', () => {
    installTelemetry();
    for (let i = 0; i < MAX_BATCH + 5; i += 1) track('bulk', { i });
    expect(sent).toHaveLength(1);
    expect(sent[0].events).toHaveLength(MAX_BATCH);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(sent).toHaveLength(2);
    const rest = sent[1].events.filter((event) => event.name === 'bulk');
    expect(rest.map((event) => event.props?.i)).toEqual([50, 51, 52, 53, 54]);
  });

  it('sends everything left when the tab is hidden or closed', () => {
    installTelemetry();
    track('review_done', { cards: '1-2' });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toHaveLength(1);
    expect(sent[0].init.keepalive).toBe(true);
    track('pro_window_open', { reason: 'limit' });
    window.dispatchEvent(new Event('pagehide'));
    expect(sent).toHaveLength(2);
    expect(flushTelemetry()).toBe(0);
  });

  it('counts a page view per path once the route settles, never ids or query strings', () => {
    installTelemetry();
    vi.advanceTimersByTime(400);
    window.history.pushState(null, '', '/planner');
    window.history.replaceState(null, '', '/courses'); // a redirect: only the page that stays
    vi.advanceTimersByTime(400);
    window.history.pushState(null, '', '/courses?tab=2'); // the same page
    vi.advanceTimersByTime(400);
    window.history.pushState(null, '', `/exams/${UUID}/draw`);
    vi.advanceTimersByTime(400);
    window.dispatchEvent(new PopStateEvent('popstate'));
    vi.advanceTimersByTime(400);
    flushTelemetry();
    const views = sent.flatMap((batch) => batch.events).filter((event) => event.name === 'page_view');
    expect(views.map((event) => event.route)).toEqual(['/', '/courses', '/exams/:id/draw']);
  });

  it('a page view of a group link never carries its code', () => {
    installTelemetry();
    vi.advanceTimersByTime(400);
    window.history.pushState(null, '', '/g/abcdefghjkmn');
    vi.advanceTimersByTime(400);
    window.history.pushState(null, '', '/join/kmnpqrstvwxy');
    vi.advanceTimersByTime(400);
    track('group_join_view', { inapp: 'none' });
    flushTelemetry();
    const events = sent.flatMap((batch) => batch.events);
    expect(events.filter((event) => event.name === 'page_view').map((event) => event.route)).toEqual(['/', '/g/:id', '/join/:id']);
    expect(events[events.length - 1].route).toBe('/join/:id');
    expect(JSON.stringify(events)).not.toMatch(/abcdefghjkmn|kmnpqrstvwxy/);
  });

  it('respects Do Not Track for product events and still reports errors', () => {
    setDoNotTrack('1');
    installTelemetry();
    vi.advanceTimersByTime(400);
    track('lecture_ready');
    captureError(new TypeError('a is undefined'), { name: 'window_error' });
    flushTelemetry();
    expect(sent).toHaveLength(1);
    expect(sent[0].events.map((event) => [event.kind, event.name])).toEqual([['client_error', 'window_error']]);
  });

  it('works when sessionStorage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    installTelemetry();
    track('try_opened');
    track('try_ticket_drawn');
    flushTelemetry();
    const [first, second] = sent[0].events;
    expect(first.session).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(second.session).toBe(first.session);
  });

  it('never throws, even when fetch does', () => {
    window.fetch = (() => {
      throw new TypeError('fetch is broken');
    }) as typeof window.fetch;
    installTelemetry();
    expect(() => {
      track('signup_view');
      captureError(undefined);
      captureError({ weird: true });
      flushTelemetry({ all: true });
    }).not.toThrow();
  });
});

describe('errors', () => {
  it('reports window errors and unhandled rejections, once a few times per message', () => {
    installTelemetry();
    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('a is undefined'), message: 'a is undefined' }));
    }
    const rejection = new Event('unhandledrejection');
    Object.assign(rejection, { reason: new Error(`Не удалось загрузить ${UUID}`) });
    window.dispatchEvent(rejection);
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    const fromExtension = new Error('boom');
    fromExtension.stack = 'Error: boom\n    at chrome-extension://abc/content.js:1:2';
    captureError(fromExtension, { name: 'window_error' });
    captureError(new DOMException('aborted', 'AbortError'));
    window.dispatchEvent(new Event('error')); // a broken image: not an error of the app
    const queued = queuedTelemetryForTests();
    expect(queued.map((event) => [event.name, event.message])).toEqual([
      ['window_error', 'TypeError: a is undefined'],
      ['window_error', 'TypeError: a is undefined'],
      ['window_error', 'TypeError: a is undefined'],
      ['unhandled_rejection', 'Error: Не удалось загрузить :id'],
    ]);
    expect(queued[0].kind).toBe('client_error');
    expect(queued[0].stack).toContain('TypeError: a is undefined');
  });

  it('adds React’s component stack to the stack', () => {
    installTelemetry();
    captureError(new Error('render failed'), { name: 'react_render', componentStack: '\n    at Dashboard\n    at Layout' });
    const [event] = queuedTelemetryForTests();
    expect(event.name).toBe('react_render');
    expect(event.stack).toContain('--- components ---\n    at Dashboard\n    at Layout');
  });
});

describe('API failures through the fetch wrapper', () => {
  it('reports status 500 and above and network errors with the path pattern and status only', async () => {
    let status = 503;
    mockFetch((url) => {
      if (url.startsWith('/api/network')) throw new TypeError('Failed to fetch');
      if (url.startsWith('/api/aborted')) throw new DOMException('aborted', 'AbortError');
      return new Response('{"detail": "secret detail"}', { status: url === '/api/telemetry' ? 500 : status });
    });
    installApiAuth();
    installTelemetry();
    await window.fetch(`/api/exams/${UUID}/map?force=1`, { method: 'POST', body: 'lecture text' });
    status = 404;
    await window.fetch('/api/oral/check');
    await expect(window.fetch('/api/network/check')).rejects.toThrow('Failed to fetch');
    await expect(window.fetch('/api/aborted')).rejects.toThrow('aborted');
    flushTelemetry();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const failures = queuedTelemetryForTests();
    expect(failures).toEqual([]);
    const reported = sent.flatMap((batch) => batch.events).filter((event) => event.name === 'api_failure');
    expect(reported.map((event) => [event.message, event.props])).toEqual([
      ['503 /api/exams/:id/map', { api: '/api/exams/:id/map', status: 503 }],
      ['network /api/network/check', { api: '/api/network/check', status: 0 }],
    ]);
    expect(JSON.stringify(reported)).not.toContain('secret');
    // The telemetry request itself failed (500) and is not reported again.
    flushTelemetry();
    expect(sent.flatMap((batch) => batch.events).filter((event) => event.name === 'api_failure')).toHaveLength(2);
  });

  it('sends the statistics with the session token, without waiting for the session when the tab closes', async () => {
    const fetchMock = mockFetch();
    installApiAuth();
    installTelemetry();
    track('lecture_ready');
    flushTelemetry();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer token-a');

    // On page hide the session may never be read again: the token from the last auth event is used at once.
    auth.listener?.('TOKEN_REFRESHED', { access_token: 'token-b' });
    auth.hangGetSession = true;
    track('review_done');
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer token-b');

    // Signed out: nothing to attach, the statistics still go (anonymous).
    auth.listener?.('SIGNED_OUT', null);
    track('signup_view');
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('Authorization')).toBeNull();
  });

  it('reports a failure directly with captureApiFailure, but never for the statistics endpoint', () => {
    installTelemetry();
    captureApiFailure('https://meldy.app/api/tts?text=Привет', 502);
    captureApiFailure('/api/telemetry', 500);
    captureApiFailure('/not-api', 500);
    expect(queuedTelemetryForTests().map((event) => event.message)).toEqual(['502 /api/tts']);
  });
});
