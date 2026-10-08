import { useSyncExternalStore } from 'react';

/**
 * A phone, the way the stylesheets say it: `@media (max-width: 639px)`. The phone layout keeps one action
 * per screen and moves the rest behind «Ещё» (10_Project/Phone_Declutter_2026-10-08); a page that has to
 * render something else on a phone (not only hide it) asks here. Without matchMedia (tests, old engines)
 * the answer is «not a phone», so the computer layout is the default.
 */
export const PHONE_QUERY = '(max-width: 639px)';

function media(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(PHONE_QUERY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const list = media();
  if (!list) return () => {};
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  // Safari before 14.
  list.addListener?.(onChange);
  return () => list.removeListener?.(onChange);
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
