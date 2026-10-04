import { supabase } from './supabase';
import { aiLimitFromBody, reportAILimit } from '../api/limits';

let installed = false;

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

/** Add the current Supabase access token to same-origin backend requests. */
export function installApiAuth() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;
    const isBackendRequest = requestUrl.startsWith('/api/');
    const isPublicRequest = requestUrl.startsWith('/api/health');

    if (!isBackendRequest || isPublicRequest) {
      return originalFetch(input, init);
    }

    const { data: { session } } = await supabase.auth.getSession();
    const headers = new Headers(
      input instanceof Request ? input.headers : (init?.headers || undefined),
    );
    if (session?.access_token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
    }

    const response = await originalFetch(input, { ...init, headers });
    void reportLimitRefusal(response);
    return response;
  };
}

/** For tests: the next installApiAuth() wraps window.fetch again. */
export function resetApiAuthForTests() {
  installed = false;
}
