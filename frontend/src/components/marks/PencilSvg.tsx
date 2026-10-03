import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { MARK_PAD, MARK_SIZE, shape, type MarkKind, type MarkPath, type ShapeOptions } from './geometry';
import './marks.css';

/** A pencil stroke appears in 250 ms; marks of one batch start 60 ms apart (spec 3.7). */
export const MARK_DRAW_MS = 250;
export const MARK_STAGGER_MS = 60;

export type PencilHand = 'pencil' | 'graphite';

export interface PencilSvgProps {
  /** The mark's own box; the SVG is larger by `pad` on every side and pulled back by a negative margin. */
  width: number;
  height: number;
  paths: MarkPath[];
  pad?: number;
  /** Blue pencil is Meldy; graphite is the student's own hand. */
  hand?: PencilHand;
  /** Draw the stroke in: only for a new judgement (live mapping, a fresh answer). */
  animate?: boolean;
  delayMs?: number;
  className?: string;
  style?: CSSProperties;
  /** Written to data-mark (tests, CSS hooks). */
  kind?: string;
}

const MASK_STROKE = 9;

/**
 * A pencil mark as an aria-hidden SVG. Its meaning is always written next to it for screen
 * readers. Filled with --ph-pencil-desk, which the paper area points at the paper pencil, so the
 * same mark is readable on the desk (legend) and on paper in both themes. Under
 * prefers-reduced-motion nothing is drawn in: the mark is simply there.
 */
export function PencilSvg({
  width,
  height,
  paths,
  pad = MARK_PAD,
  hand = 'pencil',
  animate = false,
  delayMs = 0,
  className = '',
  style,
  kind,
}: PencilSvgProps) {
  const reactId = useId();
  const reduced = usePrefersReducedMotion();
  const draw = animate && !reduced;
  const boxW = width + pad * 2;
  const boxH = height + pad * 2;
  const baseId = `sf-mk-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const classes = ['sf-mark', hand === 'graphite' ? 'sf-mark-graphite' : '', className].filter(Boolean).join(' ');
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={classes}
      width={boxW}
      height={boxH}
      viewBox={`${-pad} ${-pad} ${boxW} ${boxH}`}
      style={{ margin: -pad, ...style }}
      data-mark={kind}
      data-drawn={draw ? 'live' : 'still'}
    >
      {paths.map((path, index) => {
        const shade = path.center === null;
        const inkClass = shade ? 'sf-ink sf-ink-shade' : 'sf-ink';
        if (!draw) return <path key={index} d={path.d} className={inkClass} />;
        const delay = Math.max(0, delayMs) + index * 80;
        if (shade || !path.center) {
          return <path key={index} d={path.d} className={`${inkClass} sf-mark-fade`} style={{ animationDelay: `${delay}ms` }} />;
        }
        const maskId = `${baseId}-${index}`;
        return (
          <g key={index}>
            <mask id={maskId} maskUnits="userSpaceOnUse" x={-pad} y={-pad} width={boxW} height={boxH}>
              <path
                d={path.center}
                fill="none"
                stroke="#fff"
                strokeWidth={MASK_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                className="sf-mark-draw"
                style={{ animationDelay: `${delay}ms` }}
              />
            </mask>
            <path d={path.d} className={inkClass} mask={`url(#${maskId})`} />
          </g>
        );
      })}
    </svg>
  );
}

export interface MarkProps extends ShapeOptions {
  kind: MarkKind;
  seed: number;
  /** Defaults to the size of the spec's table for margin marks. */
  width?: number;
  height?: number;
  hand?: PencilHand;
  animate?: boolean;
  delayMs?: number;
  className?: string;
  style?: CSSProperties;
}

function defaultSize(kind: MarkKind): { width: number; height: number } {
  if (kind in MARK_SIZE) return MARK_SIZE[kind as keyof typeof MARK_SIZE];
  return { width: 24, height: 20 };
}

/** One mark of the vocabulary in a fixed box: `<Mark kind="tick" seed={seedFrom(examId, 7)} />`. */
export function Mark({ kind, seed, width, height, weight, period, hand, animate, delayMs, className, style }: MarkProps) {
  const size = defaultSize(kind);
  const w = width ?? size.width;
  const h = height ?? size.height;
  const paths = useMemo(() => shape(kind, w, h, seed, { weight, period }), [kind, w, h, seed, weight, period]);
  return (
    <PencilSvg
      width={w}
      height={h}
      paths={paths}
      hand={hand}
      animate={animate}
      delayMs={delayMs}
      className={className}
      style={style}
      kind={kind}
    />
  );
}

/** The curly bracket by a rubric line: «об этом спросил экзаменатор» (14 × 40). */
export function PencilBrace({ seed, height = 40, animate, className }: { seed: number; height?: number; animate?: boolean; className?: string }) {
  return <Mark kind="brace" seed={seed} width={14} height={height} animate={animate} className={className} />;
}

/**
 * The stroke down the left margin of a selected line (no tint, no coloured bar). Place it inside a
 * positioned row; it stretches to the row's height (class sf-margin-stroke).
 */
export function MarginStroke({ seed, animate, className = '' }: { seed: number; animate?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [height, setHeight] = useState(40);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = Math.round(element.offsetHeight);
      if (next > 0) setHeight((previous) => (previous === next ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <span ref={ref} className={`sf-margin-stroke ${className}`.trim()} aria-hidden="true">
      <Mark kind="vline" seed={seed} width={8} height={height} animate={animate} />
    </span>
  );
}
