import { supabase } from './supabase';

let installed = false;

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

    return originalFetch(input, { ...init, headers });
  };
}
