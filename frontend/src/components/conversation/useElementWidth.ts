import { useLayoutEffect, useRef, useState } from 'react';

/** Ширина элемента в пикселях; без ResizeObserver (тесты) — fallback. */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) setWidth(previous => (Math.abs(previous - next) >= 1 ? next : previous));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
