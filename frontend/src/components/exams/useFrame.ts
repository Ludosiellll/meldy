import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Size class of a page frame: the spec's breakpoints (1280 / 1024 / 640) applied to the width the
 * page actually has. Until the shell redesign the exam pages sit next to the old sidebar, so the
 * window width would pick a two-column layout that does not fit.
 */
export type FrameSize = 'xl' | 'l' | 'm' | 's';

export function frameSizeOf(width: number): FrameSize {
  if (width >= 1280) return 'xl';
  if (width >= 1024) return 'l';
  if (width >= 640) return 'm';
  return 's';
}

/** True when Meldy's column stands next to the sheet (otherwise it goes above it). */
export function hasSideColumn(size: FrameSize): boolean {
  return size === 'xl' || size === 'l';
}

export interface FrameBox {
  left: number;
  right: number;
}

function windowWidth(): number {
  return typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280;
}

/**
 * Measures the page frame (the .sf-page root): its width class and its left/right edges in the
 * window (a bottom sheet spans exactly the page, not the sidebar next to it).
 */
export function useFrame<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(windowWidth);
  const [box, setBox] = useState<FrameBox>(() => ({ left: 0, right: 0 }));

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const measured = element.clientWidth;
      const next = measured > 0 ? measured : windowWidth();
      setWidth((previous) => (previous === next ? previous : next));
      const rect = element.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth || window.innerWidth || 0;
      const left = Math.max(0, Math.round(rect.left));
      const right = rect.width > 0 ? Math.max(0, Math.round(viewport - rect.right)) : 0;
      setBox((previous) => (previous.left === left && previous.right === right ? previous : { left, right }));
    };
    measure();
    window.addEventListener('resize', measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    }
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  const size = frameSizeOf(width);
  return { ref, size, width, box, side: hasSideColumn(size) };
}
