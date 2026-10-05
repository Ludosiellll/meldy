import { supabase } from './supabase';
import { aiLimitFromBody, reportAILimit } from '../api/limits';
import { captureApiFailure, TELEMETRY_ENDPOINT } from './telemetry';

let installed = false;
/** The access token as the last auth event left it; undefined until the first event (then null when signed out). */
let knownToken: string | null | undefined;

/**
 * A backend answer 429 with code ai_limit (the daily AI limit, checked by the server) opens the
 * limit dialog wherever the call was made. The caller still gets the untouched response and shows
 * its own error line; this reads a clone, so nothing is consumed.
 */
async function reportLimitRefusal(response: Response): Promise<void> {
  if (response.status !== 429 || typeof response.clone !== 'function') return;
  try {
    const info = aiLimitFromBody(await response.clone().json());
    if (info) reportAILimit(info);
  } catch {
    // Not JSON (the rate limiter or a proxy): not the daily limit.
  }
}

/** Keeps knownToken current, so a keepalive request (statistics as the tab closes) needs no await first. */
function watchSession() {
  try {
    const auth = supabase.auth as Partial<typeof supabase.auth>;
    if (typeof auth.onAuthStateChange !== 'function') return;
    auth.onAuthStateChange((_event, session) => {
      knownToken = session?.access_token ?? null;
    });
  } catch {
    // Every request still reads the session itself.
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Add the current Supabase access token to same-origin backend requests. A backend failure (status 500 and
 * above, or no answer) is reported to the statistics with its path pattern and status only (lib/telemetry).
 */
export function installApiAuth() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  watchSession();

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;
    const isBackendRequest = requestUrl.startsWith('/api/');
    const isPublicRequest = requestUrl.startsWith('/api/health');
    const isTelemetry = requestUrl.startsWith(TELEMETRY_ENDPOINT);

    if (!isBackendRequest || isPublicRequest) {
      return originalFetch(input, init);
    }

    const headers = new Headers(
      input instanceof Request ? input.headers : (init?.headers || undefined),
    );
    if (!headers.has('Authorization')) {
      // A keepalive request may be sent as the page goes away: the token it needs is read without waiting.
      const token = init?.keepalive && knownToken !== undefined
        ? knownToken
        : (await supabase.auth.getSession()).data.session?.access_token;
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await originalFetch(input, { ...init, headers });
    } catch (error) {
      if (!isTelemetry && !isAbort(error)) captureApiFailure(requestUrl, 0);
      throw error;
    }
    if (response.status >= 500 && !isTelemetry) captureApiFailure(requestUrl, response.status);
    void reportLimitRefusal(response);
    return response;
  };
}

/** For tests: the next installApiAuth() wraps window.fetch again. */
export function resetApiAuthForTests() {
  installed = false;
  knownToken = undefined;
}
