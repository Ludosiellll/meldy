import { useSyncExternalStore } from 'react';

/**
 * A computer, the way containers.css says it: `(min-width: 1024px)`. There the one blue pill sits in the plan card on
 * the right (as on today's desktop exam page); below it the pill rides in the bar at the bottom. Without matchMedia
 * (tests, old engines) the answer is «a computer», as usePhone answers «not a phone».
 */
export const WIDE_QUERY = '(min-width: 1024px)';

function media(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY) : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const list = media();
  if (!list) return () => undefined;
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  list.addListener?.(onChange);
  return () => list.removeListener?.(onChange);
}

function snapshot(): boolean {
  const list = media();
  return list ? list.matches : true;
}

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
