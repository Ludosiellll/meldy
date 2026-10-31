import { useEffect, type RefObject } from 'react';

/**
 * No hover while the window scrolls (owner, 31.10: «Сегодня» on a computer stutters and flickers on scroll).
 *
 * Measured on «Сегодня» (dark, 1436 × 726 at 125 %, the wheel over the page, GPU raster): the cards under the pointer
 * changed their hover state as they passed it, about 50 times in a scroll down and up, and each change ran the card's
 * box-shadow transition (0.9 s) — the whole card, 860 × 830 px with its 60 px shadow, painted and rastered again on every
 * frame of the scroll. GPU work 2.0 s per 5 s of scrolling, 90 frames of 245 over 20 ms. With the page's pointer events
 * off while it scrolls: 0.2 s and a handful of slow frames, and nothing lights up or lifts as it slides under the pointer.
 *
 * While the window scrolls, the shell's <main> carries data-scrolling (layout.css: no pointer events in it), taken off
 * SCROLL_IDLE_MS after the last scroll event; the hover comes back to whatever is under the pointer then. Only where
 * there is a hovering pointer (a mouse or a trackpad): a touch screen has no hover to change, and a tap there stops a
 * fling as it always did.
 */
export const SCROLL_IDLE_MS = 150;
export const SCROLLING_ATTR = 'data-scrolling';
export const HOVER_POINTER = '(hover: hover) and (pointer: fine)';

function hasHoverPointer(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(HOVER_POINTER).matches;
  } catch {
    return false;
  }
}

export function useNoHoverWhileScrolling(target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !hasHoverPointer()) return undefined;
    let timer = 0;
    let marked: HTMLElement | null = null;
    const settle = () => {
      timer = 0;
      marked?.removeAttribute(SCROLLING_ATTR);
      marked = null;
    };
    const onScroll = () => {
      if (timer) window.clearTimeout(timer);
      else {
        marked = target.current;
        marked?.setAttribute(SCROLLING_ATTR, '');
      }
      timer = window.setTimeout(settle, SCROLL_IDLE_MS);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) window.clearTimeout(timer);
      settle();
    };
  }, [target]);
}
