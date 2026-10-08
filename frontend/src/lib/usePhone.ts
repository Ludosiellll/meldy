import { useSyncExternalStore } from 'react';

/**
 * A phone, the way the stylesheets say it: `@media (max-width: 639px)`. The phone layout keeps one action
 * per screen and moves the rest behind «Ещё» (10_Project/Phone_Declutter_2026-10-08); a page that has to
 * render something else on a phone (not only hide it) asks here. Without matchMedia (tests, old engines)
 * the answer is «not a phone», so the computer layout is the default.
 *
 * One MediaQueryList and one listener serve every component that asks (a lecture has one per fragment link); a new
 * `window.matchMedia` (a test that installs its own) starts over.
 */
export const PHONE_QUERY = '(max-width: 639px)';

let source: typeof window.matchMedia | null = null;
let list: MediaQueryList | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function detach() {
  if (!list) return;
  if (typeof list.removeEventListener === 'function') list.removeEventListener('change', notify);
  else list.removeListener?.(notify);
}

function media(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    if (list) detach();
    source = null;
    list = null;
    return null;
  }
  if (source === window.matchMedia && list) return list;
  if (list) detach();
  source = window.matchMedia;
  try {
    list = window.matchMedia(PHONE_QUERY);
  } catch {
    list = null;
    return null;
  }
  if (listeners.size > 0) attach();
  return list;
}

function attach() {
  if (!list) return;
  if (typeof list.addEventListener === 'function') list.addEventListener('change', notify);
  // Safari before 14.
  else list.addListener?.(notify);
}

function subscribe(onChange: () => void): () => void {
  const first = listeners.size === 0;
  listeners.add(onChange);
  const current = media();
  if (first && current) attach();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) detach();
  };
}

function snapshot(): boolean {
  return media()?.matches ?? false;
}

export function isPhone(): boolean {
  return snapshot();
}

export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
