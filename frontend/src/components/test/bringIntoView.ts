/**
 * Scrolls the window the least so that everything from the top of `first` to the bottom of `last` is in view, between
 * the bar at the top (the menu's line, or a room's own line) and whatever stands at the bottom (the tab bar, the page's
 * sticky bar, a room's pinned bar with its verdict); when it does not fit, the bottom of `last` wins (it holds the
 * focus), or the top of `first` when the caller says so. Nothing moves when it is in view already; no animation for
 * those who asked for less motion. A saved card of «Конструктор» stays where the author can see it (release 47, M2);
 * the links under an answer of «занятие» come out from under the verdict's bar (phone audit 47.3).
 */
const GAP = 12;

function bottomEdge(view: number): number {
  let edge = view;
  for (const selector of ['.sf-tabbar', '.ex-cta', '.ct-bar']) {
    const bar = document.querySelector(selector);
    if (!bar) continue;
    const rect = bar.getBoundingClientRect();
    if (rect.height > 0 && rect.top < view && rect.bottom >= view - 1) edge = Math.min(edge, rect.top);
  }
  return edge - GAP;
}

function topEdge(): number {
  let edge = 0;
  for (const selector of ['.sf-bar', '.sf-room-bar']) {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    if (rect && rect.height > 0 && rect.bottom > 0) edge = Math.max(edge, rect.bottom);
  }
  return edge + GAP;
}

export function bringIntoView(first: Element, last: Element, wins: 'first' | 'last' = 'last'): void {
  if (typeof window === 'undefined') return;
  const a = first.getBoundingClientRect();
  const b = last.getBoundingClientRect();
  // Not laid out (a test's document): nothing to measure.
  if (a.height === 0 && b.height === 0) return;
  const view = window.innerHeight || document.documentElement.clientHeight;
  const top = topEdge();
  const bottom = bottomEdge(view);
  if (a.top >= top && b.bottom <= bottom) return;
  // The least move: the end up to the bottom edge, the start no higher than the top edge, the end once more if both
  // do not fit.
  let delta = b.bottom > bottom ? b.bottom - bottom : 0;
  if (a.top - delta < top) delta = a.top - top;
  if (wins === 'last' && b.bottom - delta > bottom) delta = b.bottom - bottom;
  const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: window.scrollY + delta, behavior: calm ? 'auto' : 'smooth' });
}
