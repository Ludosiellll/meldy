import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether the element is on screen. `once`: true from the first time it is seen (a card's entrance); otherwise it
 * follows the element in and out (a loop that pauses off-screen). Without IntersectionObserver it is simply true.
 */
export function useInView(ref: RefObject<Element>, { once = true, margin = '0px 0px -12% 0px' } = {}): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const on = entries.some((entry) => entry.isIntersecting);
        if (once && on) {
          setSeen(true);
          observer.disconnect();
        } else if (!once) setSeen(on);
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, once, margin]);
  return seen;
}

/** The visitor asked for less motion (read once; the landing does not follow a change mid-visit). */
export function prefersStill(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
