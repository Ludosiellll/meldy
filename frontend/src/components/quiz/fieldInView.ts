import { useEffect } from 'react';

/**
 * The field a participant types into stays in sight (phone audit 47.3: a phone turned sideways, the keyboard up, and the
 * short answer's field under the bar at the bottom). When a text field takes the focus, and again when the keyboard
 * changes the visible part of the page (visualViewport resize), the window scrolls the least so the field stands between
 * the room's top line and whatever is pinned at the bottom of what is visible — the browser's own scroll knows neither.
 */

const GAP = 8;
const FIELDS = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea';
const BOTTOM_BARS = '.ct-bar, .dv-nav[data-pinned]';

export interface Edges {
  top: number;
  bottom: number;
}

/** How far to scroll so the box stands between the edges: its bottom above the lower one, its top under the upper one (the top wins). */
export function fieldDelta(box: { top: number; bottom: number }, edges: Edges): number {
  let delta = box.bottom > edges.bottom ? box.bottom - edges.bottom : 0;
  if (box.top - delta < edges.top) delta = box.top - edges.top;
  return Math.round(delta);
}

function pinned(element: Element): boolean {
  const position = window.getComputedStyle(element).position;
  return position === 'sticky' || position === 'fixed';
}

/** The visible part of the page in the layout's coordinates, less the room's top line and the bars pinned at its bottom. */
export function visibleEdges(): Edges {
  const view = window.visualViewport;
  const shownTop = view ? view.offsetTop : 0;
  const shownBottom = view ? view.offsetTop + view.height : window.innerHeight;
  let top = shownTop;
  const bar = document.querySelector('.sf-room-bar');
  const barBox = bar?.getBoundingClientRect();
  if (barBox && barBox.height > 0 && barBox.bottom > top) top = barBox.bottom;
  let bottom = shownBottom;
  document.querySelectorAll(BOTTOM_BARS).forEach((element) => {
    if (!pinned(element)) return;
    const box = element.getBoundingClientRect();
    if (box.height > 0 && box.top < shownBottom && box.bottom >= shownBottom - 1) bottom = Math.min(bottom, box.top);
  });
  return { top: top + GAP, bottom: bottom - GAP };
}

export function useFieldInView(active = true): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    let field: HTMLElement | null = null;
    let timer = 0;
    const bring = () => {
      if (!field || document.activeElement !== field || !field.isConnected) return;
      const box = field.getBoundingClientRect();
      if (box.height === 0) return;
      const delta = fieldDelta(box, visibleEdges());
      if (delta !== 0) window.scrollBy({ top: delta, left: 0, behavior: 'instant' as ScrollBehavior });
    };
    const later = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(bring, ms);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(FIELDS)) return;
      field = target;
      // The keyboard takes a moment to come up; the resize below brings it again once it has.
      later(300);
    };
    const onResize = () => later(80);
    const view = window.visualViewport;
    document.addEventListener('focusin', onFocus);
    view?.addEventListener('resize', onResize);
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', onFocus);
      view?.removeEventListener('resize', onResize);
      window.removeEventListener('resize', onResize);
    };
  }, [active]);
}
