import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { shape, type MarkKind } from './geometry';
import { PencilSvg, type PencilHand } from './PencilSvg';

/**
 * Marks that sit on a piece of text: the readiness marks of a number, the oval of «Засчитано» and
 * the strike across a figure that is replaced by another one («60 %» of peak 1).
 */
export type TextMarkKind = 'ring' | 'under' | 'wave' | 'oval' | 'strike';

interface Size {
  w: number;
  h: number;
}

/** A rough size from the text, used until (and where) layout gives the real one (jsdom, first paint). */
function estimate(children: ReactNode): Size {
  const text = typeof children === 'string' || typeof children === 'number' ? String(children) : '';
  return { w: Math.max(10, text.length * 9), h: 22 };
}

function useElementSize(fallback: Size) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<Size>(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const w = Math.round(element.offsetWidth);
      const h = Math.round(element.offsetHeight);
      if (w > 0 && h > 0) setSize((previous) => (previous.w === w && previous.h === h ? previous : { w, h }));
    };
    measure();
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    let alive = true;
    fonts?.ready?.then(() => {
      if (alive) measure();
    });
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        alive = false;
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, []);
  return { ref, size };
}

export interface TextMarkProps {
  kind: TextMarkKind;
  seed: number;
  children: ReactNode;
  hand?: PencilHand;
  animate?: boolean;
  delayMs?: number;
  weight?: number;
  /** Room around the text for a ring or an oval (spec: number +7/+3, word +10/+7); a strike's overshoot. */
  padX?: number;
  padY?: number;
  /** Extra drop of an underline or a wave below the text box. */
  dy?: number;
  className?: string;
}

const DEFAULT_PAD: Record<TextMarkKind, { x: number; y: number }> = {
  ring: { x: 7, y: 3 },
  oval: { x: 10, y: 7 },
  under: { x: 2, y: 0 },
  wave: { x: 1, y: 0 },
  // Past both ends of the figure; the line box of a big figure already has room above and below.
  strike: { x: 9, y: -2 },
};

/**
 * A one-line piece of text with a pencil mark on it: a ring around a question number
 * (подтверждено), a line under it (засчитано, не подтверждено), a wavy line (не засчитано), an oval
 * around a word («Засчитано»), a strike across a figure. The text keeps its place in the line; the
 * mark is aria-hidden, so say its meaning next to it in words.
 */
export function TextMark({
  kind,
  seed,
  children,
  hand = 'pencil',
  animate = false,
  delayMs = 0,
  weight,
  padX,
  padY,
  dy = 1,
  className = '',
}: TextMarkProps) {
  const { ref, size } = useElementSize(estimate(children));
  const px = padX ?? DEFAULT_PAD[kind].x;
  const py = padY ?? DEFAULT_PAD[kind].y;
  const box = useMemo(() => {
    if (kind === 'ring' || kind === 'oval' || kind === 'strike') {
      return { left: -px, top: -py, width: size.w + px * 2, height: Math.max(4, size.h + py * 2) };
    }
    const lineHeight = 6;
    return { left: -px, top: size.h - (kind === 'under' ? 2 : 1) + dy, width: size.w + px * 2, height: lineHeight };
  }, [kind, px, py, size.w, size.h, dy]);
  const paths = useMemo(() => {
    const shapeKind: MarkKind = kind;
    const options = kind === 'wave' ? { weight: weight ?? 2.4, period: 8 } : { weight };
    return shape(shapeKind, box.width, box.height, seed, options);
  }, [kind, box.width, box.height, seed, weight]);
  return (
    <span ref={ref} className={`sf-textmark ${className}`.trim()} data-mark={kind}>
      {children}
      <PencilSvg
        width={box.width}
        height={box.height}
        paths={paths}
        hand={hand}
        animate={animate}
        delayMs={delayMs}
        className="sf-textmark-ink"
        style={{ left: box.left, top: box.top }}
        kind={kind}
      />
    </span>
  );
}

/**
 * «Засчитано» in a pencil oval (protocol). `delayMs` lets the protocol draw it after its last point mark;
 * padX / padY widen the oval around the word (spec 3.8: word +10/+7).
 */
export function PencilOval({
  seed,
  children,
  animate,
  delayMs,
  padX,
  padY,
  className,
}: {
  seed: number;
  children: ReactNode;
  animate?: boolean;
  delayMs?: number;
  padX?: number;
  padY?: number;
  className?: string;
}) {
  return (
    <TextMark kind="oval" seed={seed} animate={animate} delayMs={delayMs} padX={padX} padY={padY} className={className}>
      {children}
    </TextMark>
  );
}

interface LineRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function sameRects(a: LineRect[], b: LineRect[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((rect, index) => {
    const other = b[index];
    return Math.abs(rect.x - other.x) < 0.5 && Math.abs(rect.y - other.y) < 0.5 && Math.abs(rect.w - other.w) < 0.5 && Math.abs(rect.h - other.h) < 0.5;
  });
}

export interface PencilUnderProps {
  seed: number;
  children: ReactNode;
  hand?: PencilHand;
  animate?: boolean;
  delayMs?: number;
  weight?: number;
  /** Extra drop below the line box. */
  dy?: number;
  /** A straight line (default) or a wavy one (a point the answer missed, on the cheat sheet). */
  kind?: 'under' | 'wave';
  className?: string;
}

/**
 * Words underlined by pencil, one SVG per line the words occupy (never text-decoration). The
 * strokes are positioned in the nearest positioned ancestor (the sheet or the row), so the words
 * may wrap; they are measured again on resize and when the fonts arrive.
 */
export function PencilUnder({ seed, children, hand = 'pencil', animate = false, delayMs = 0, weight = 2.2, dy = 0, kind = 'under', className = '' }: PencilUnderProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [rects, setRects] = useState<LineRect[]>([]);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const host = element.offsetParent as HTMLElement | null;
      if (!host) return;
      const hostBox = host.getBoundingClientRect();
      // A scaled ancestor (the cheat sheet's «Весь лист») scales the rects too: back to the host's own px.
      const scale = host.offsetWidth > 0 && hostBox.width > 0 ? hostBox.width / host.offsetWidth : 1;
      const next = Array.from(element.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          x: (rect.left - hostBox.left) / scale - host.clientLeft + host.scrollLeft,
          y: (rect.top - hostBox.top) / scale - host.clientTop + host.scrollTop,
          w: rect.width / scale,
          h: rect.height / scale,
        }));
      setRects((previous) => (sameRects(previous, next) ? previous : next));
    };
    const schedule = () => {
      if (typeof requestAnimationFrame !== 'function') {
        measure();
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('resize', schedule);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    let alive = true;
    fonts?.ready?.then(() => {
      if (alive) schedule();
    });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observer.observe(element.offsetParent ?? element);
    }
    return () => {
      alive = false;
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [children]);

  return (
    <span className={`sf-under ${className}`.trim()} data-mark={kind}>
      <span ref={textRef}>{children}</span>
      {rects.map((rect, index) => {
        const w = rect.w + 4;
        const h = 6;
        // The cheat sheet's wave under a missed point: long and calm, not a spell-checker's squiggle.
        const options = kind === 'wave' ? { weight, period: 13 } : { weight };
        return (
          <PencilSvg
            key={index}
            width={w}
            height={h}
            paths={shape(kind, w, h, seed + index * 13, options)}
            hand={hand}
            animate={animate}
            delayMs={delayMs + index * 60}
            className="sf-under-ink"
            style={{ left: rect.x - 2, top: rect.y + rect.h - 2 + dy }}
            kind={kind}
          />
        );
      })}
    </span>
  );
}
