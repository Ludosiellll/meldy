import { useLayoutEffect, useRef, useState } from 'react';
import { observeSize } from '../../lib/observeSize';

type Side = 'width' | 'height';

/**
 * The last width seen at this window width: the sheet's pictures share one width, so the next one starts from it and
 * is not drawn twice (smoothness audit 20.10: every picture of the podcast tab was drawn at 560 px, then again).
 */
const lastWidth = new Map<number, number>();
const windowWidth = () => (typeof window !== 'undefined' ? window.innerWidth : 0);
/** Only where sizes are observed (a browser): a test's page has no layout to remember. */
const observed = () => typeof ResizeObserver !== 'undefined';

/**
 * A side of the element in px (its box as drawn, transforms included). It is read when the size observer reports
 * (lib/observeSize: after the browser's layout, before the paint — no layout of its own), not in a layout effect.
 */
function useElementSide<T extends HTMLElement>(side: Side, fallback: number) {
  const ref = useRef<T | null>(null);
  const [value, setValue] = useState(() => (side === 'width' && observed() ? lastWidth.get(windowWidth()) ?? fallback : fallback));

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    return observeSize(element, () => {
      const rect = element.getBoundingClientRect();
      const next = Math.round(side === 'width' ? rect.width : rect.height);
      if (next <= 0) return;
      if (side === 'width' && observed()) lastWidth.set(windowWidth(), next);
      setValue(previous => (Math.abs(previous - next) >= 1 ? next : previous));
    });
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
