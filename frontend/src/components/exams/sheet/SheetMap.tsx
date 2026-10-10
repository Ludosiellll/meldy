import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import type { LineState, SheetBlock } from '../../../lib/exams/cheatSheet';
import { mapGeometry } from './layout';
import { MapLegend } from './SheetLegend';

/**
 * The map of the sheet's lines (notes: 40_Decisions/2026-10-10_cheat-sheet-native-look): one small square per
 * line, in the sheet's order, in one even grid on the canvas' colour — ink while the line is there, yellow once
 * it was named once (the yellow of the logo's dot), an empty outline once it is erased; a yellow outline while
 * an erased line is due for its check. The whole sheet at a glance, on a few dozen lines and on hundreds; day by
 * day it empties. It mirrors what the paper draws: during a show it changes square by square with the lines.
 * For the eye only (the count beside it says it in words).
 */

/** How a square stands: a line there, named once, due for its check, erased. */
export type SquareState = 'left' | 'half' | 'due' | 'gone';

export function squareState(state: LineState): SquareState {
  switch (state) {
    case 'rubbed':
      return 'half';
    case 'due':
      return 'due';
    case 'erased':
      return 'gone';
    default:
      return 'left';
  }
}

/** A line moving on the paper now, with the paper's own timing (ms after the change). */
export interface DrawnMotion {
  anim: string;
  delay: number;
  ms: number;
}

/** What the paper draws when it is not the sheet as it is: a show draws lines as they were before an answer, then moves them. */
export interface DrawnLines {
  states: ReadonlyMap<string, LineState>;
  motions: ReadonlyMap<string, DrawnMotion>;
}

export interface DrawnStore {
  get: () => DrawnLines;
  set: (next: DrawnLines) => void;
  subscribe: (listener: () => void) => () => void;
}

const NOTHING_DRAWN: DrawnLines = { states: new Map(), motions: new Map() };

/** The paper tells the map what it draws; the map follows without the page drawing itself again. */
export function createDrawnStore(): DrawnStore {
  let current = NOTHING_DRAWN;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (next.states.size === 0 && next.motions.size === 0 && current.states.size === 0 && current.motions.size === 0) return;
      current = next.states.size === 0 && next.motions.size === 0 ? NOTHING_DRAWN : next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const NO_STORE = {
  get: () => NOTHING_DRAWN,
  subscribe: () => () => undefined,
};

/** The sheet's lines in its order, each line once (two questions of the same text share their lines, as the count does). */
export function mapLines(blocks: readonly SheetBlock[]): Array<{ key: string; state: LineState }> {
  const seen = new Set<string>();
  const out: Array<{ key: string; state: LineState }> = [];
  for (const block of blocks) {
    for (const line of block.lines) {
      if (seen.has(line.key)) continue;
      seen.add(line.key);
      out.push({ key: line.key, state: line.status.state });
    }
  }
  return out;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/** Marks the paper's line(s) of `key` as the one the map points at (or no longer). */
export function markLine(key: string, on: boolean): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLElement>(`.cs-line[data-key="${cssEscape(key)}"]`).forEach((line) => {
    if (on) line.setAttribute('data-hot', '');
    else line.removeAttribute('data-hot');
  });
}

/** Marks the map's square of `key` as the one the paper points at (a line under the pointer or the keyboard). */
export function markSquare(key: string, on: boolean): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLElement>(`.cs-sq[data-k="${cssEscape(key)}"]`).forEach((square) => {
    if (on) square.setAttribute('data-hot', '');
    else square.removeAttribute('data-hot');
  });
}

/** A new square (a question just written) fades in this long, ms. */
const NEW_MS = 600;
/** Where the map is not measured yet (and in tests): the inner width of the column's card and of a phone's card, px. */
const DEFAULT_WIDTH = 280;
const DEFAULT_WIDTH_COMPACT = 296;

export interface SheetMapProps {
  /** The lines as the paper shows them (the history's day while it plays). */
  blocks: readonly SheetBlock[];
  /** What the paper draws during a show (null: the sheet as it is). */
  drawn?: DrawnStore | null;
  /** A phone: smaller squares, the map kept low over the list. */
  compact?: boolean;
}

export function SheetMap({ blocks, drawn = null, compact = false }: SheetMapProps) {
  const store = drawn ?? NO_STORE;
  const shown = useSyncExternalStore(store.subscribe, store.get, store.get);
  const lines = useMemo(() => mapLines(blocks), [blocks]);
  const mapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(compact ? DEFAULT_WIDTH_COMPACT : DEFAULT_WIDTH);
  useLayoutEffect(() => {
    const element = mapRef.current;
    if (!element) return undefined;
    const measure = () => {
      const style = getComputedStyle(element);
      const inner = element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      if (inner > 0) setWidth((previous) => (Math.abs(previous - inner) < 0.5 ? previous : inner));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const geometry = mapGeometry(lines.length, width, compact ? { maxHeight: 56, maxSize: 8 } : { maxHeight: 150 });

  // Squares that come while the map is on screen (a question written now) fade in; the first ones just stand.
  const born = useRef<Map<string, number> | null>(null);
  const now = Date.now();
  if (born.current === null) born.current = new Map(lines.map((line) => [line.key, 0]));
  for (const line of lines) if (!born.current.has(line.key)) born.current.set(line.key, now);

  const hot = useRef<string | null>(null);
  const point = (key: string | null) => {
    if (hot.current === key) return;
    if (hot.current) markLine(hot.current, false);
    hot.current = key;
    if (key) markLine(key, true);
  };
  const keyOf = (event: ReactMouseEvent) => (event.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k ?? null;
  // A square shows its line: under the pointer it lights the line up; a click brings the line into view.
  const onClick = (event: ReactMouseEvent) => {
    const key = keyOf(event);
    if (!key) return;
    const line = document.querySelector<HTMLElement>(`.cs-line[data-key="${cssEscape(key)}"]`);
    if (!line) return;
    if (typeof line.scrollIntoView === 'function') line.scrollIntoView({ block: 'center', behavior: 'smooth' });
    markLine(key, true);
    window.setTimeout(() => {
      if (hot.current !== key) markLine(key, false);
    }, 1400);
  };

  const due = lines.some((line) => (shown.states.get(line.key) ?? line.state) === 'due');
  const style = {
    '--cs-sq': `${geometry.size}px`,
    '--cs-sq-gap': `${geometry.gap}px`,
    gridTemplateColumns: `repeat(${geometry.columns}, var(--cs-sq))`,
  } as CSSProperties;
  return (
    <div className="cs-mapbox" data-compact={compact ? '' : undefined}>
      <div
        ref={mapRef}
        className="cs-map"
        aria-hidden="true"
        style={style}
        onMouseOver={(event) => point(keyOf(event))}
        onMouseLeave={() => point(null)}
        onClick={onClick}
      >
        {lines.map((line) => {
          const state = shown.states.get(line.key) ?? line.state;
          const motion = shown.motions.get(line.key);
          const since = born.current?.get(line.key) ?? 0;
          const fresh = since > 0 && now - since < NEW_MS;
          return (
            <i
              key={line.key}
              className="cs-sq"
              data-k={line.key}
              data-s={squareState(state)}
              data-anim={motion ? motion.anim : undefined}
              data-new={fresh ? '' : undefined}
              style={motion ? ({ '--cs-delay': `${motion.delay}ms`, '--cs-ms': `${motion.ms}ms` } as CSSProperties) : undefined}
            />
          );
        })}
      </div>
      <MapLegend due={due} />
    </div>
  );
}
