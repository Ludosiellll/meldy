import { useLayoutEffect, useRef, useState } from 'react';

type Side = 'width' | 'height';

function useElementSide<T extends HTMLElement>(side: Side, fallback: number) {
  const ref = useRef<T | null>(null);
  const [value, setValue] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const next = Math.round(side === 'width' ? rect.width : rect.height);
      if (next > 0) setValue(previous => (Math.abs(previous - next) >= 1 ? next : previous));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [side]);

  return [ref, value] as const;
}

/** Ширина элемента в пикселях; без ResizeObserver (тесты) — fallback. */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  return useElementSide<T>('width', fallback);
}

/** Высота элемента в пикселях; без ResizeObserver (тесты) — fallback. */
export function useElementHeight<T extends HTMLElement>(fallback: number) {
  return useElementSide<T>('height', fallback);
}
