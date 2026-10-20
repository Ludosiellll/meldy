import { useEffect, useState, type RefObject } from 'react';

/**
 * A row that scrolls sideways (a phone's tabs): whether there is more of it before and after what is shown, so the page
 * can fade that edge as a hint (phone audit 47.3, the lecture's tabs), and the scroll that brings one of its items fully
 * into view past that fade.
 */

export interface StripEdges {
  start: boolean;
  end: boolean;
}

const NONE: StripEdges = { start: false, end: false };

/** More to the left and to the right of what the row shows (a pixel of rounding is not more). */
export function stripEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): StripEdges {
  if (scrollWidth <= clientWidth + 1) return NONE;
  return { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 };
}

/**
 * The row's scrollLeft that shows the item [left, left + width] whole, `room` px clear of either faded edge; the
 * current one when it already does.
 */
export function stripScrollFor(item: { left: number; width: number }, row: { scrollLeft: number; clientWidth: number; scrollWidth: number }, room = 32): number {
  const max = Math.max(0, row.scrollWidth - row.clientWidth);
  let next = row.scrollLeft;
  if (item.left + item.width > row.scrollLeft + row.clientWidth - room) next = item.left + item.width - row.clientWidth + room;
  if (item.left < next + room) next = item.left - room;
  return Math.min(max, Math.max(0, Math.round(next)));
}

export function useStripEdges(ref: RefObject<HTMLElement | null>, active = true): StripEdges {
  const [edges, setEdges] = useState<StripEdges>(NONE);
  useEffect(() => {
    const row = ref.current;
    if (!active || !row) {
      setEdges(NONE);
      return undefined;
    }
    let frame = 0;
    const read = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = stripEdges(row.scrollLeft, row.clientWidth, row.scrollWidth);
        setEdges((current) => (current.start === next.start && current.end === next.end ? current : next));
      });
    };
    read();
    row.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    observer?.observe(row);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    void fonts?.ready?.then(read).catch(() => undefined);
    return () => {
      window.cancelAnimationFrame(frame);
      row.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
      observer?.disconnect();
    };
  }, [ref, active]);
  return edges;
}
