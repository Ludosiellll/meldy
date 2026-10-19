import { Fragment, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { blur, opacity, put, text as setText, useEls, useFrame, useStageScale } from './engine';
import { beginFrame } from './particles';
import { clamp, ease, mix, pulse, seg, STAGE_H, STAGE_W } from './timeline';

// ---------------------------------------------------------------------------------------------
// Kinetic text: words or letters arriving one after another.

type KineticVariant = 'rise' | 'drop' | 'zoom';

interface KineticProps {
  text: string;
  /** Scene time of the first unit's start (ms). */
  at: number;
  unit?: 'word' | 'letter';
  stagger?: number;
  dur?: number;
  variant?: KineticVariant;
  /** Words from this index on get the accent colour. */
  accentFrom?: number;
  /** Leaves: everything blurs and fades from `at` over `dur`, moving by `dy` px. */
  out?: { at: number; dur: number; dy?: number };
  className?: string;
  style?: CSSProperties;
  /** Extra content after the words (a marker, a dot). */
  children?: ReactNode;
}

const isSpace = (value: string) => /^\s+$/.test(value);

export function Kinetic({
  text,
  at,
  unit = 'word',
  stagger,
  dur = 760,
  variant = 'rise',
  accentFrom,
  out,
  className,
  style,
  children,
}: KineticProps) {
  const root = useRef<HTMLSpanElement>(null);
  const { all } = useEls(root);
  const words = useMemo(() => text.split(/(\s+)/).filter((part) => part.length > 0), [text]);
  const step = stagger ?? (unit === 'letter' ? 34 : 90);

  useFrame((lt) => {
    const units = all('k');
    units.forEach((el, index) => {
      const p = seg(lt, at + index * step, dur);
      if (variant === 'drop') {
        const e = ease.back(p);
        const turn = (index % 2 === 0 ? -1 : 1) * 14;
        put(el, 'transform', `translate3d(0,${mix(-0.75, 0, e).toFixed(3)}em,0) rotate(${mix(turn, 0, e).toFixed(2)}deg)`);
        opacity(el, clamp(p * 3));
        blur(el, (1 - ease.out(p)) * 10);
      } else if (variant === 'zoom') {
        const e = ease.brand(p);
        put(el, 'transform', `translate3d(0,0,0) scale(${mix(1.9, 1, e).toFixed(3)})`);
        opacity(el, clamp(p * 2.2));
        blur(el, (1 - e) * 26);
      } else {
        const e = ease.brand(p);
        const ghost = (1 - e) * 0.9;
        put(el, 'transform', `translate3d(${mix(-0.18, 0, e).toFixed(3)}em,${mix(0.42, 0, e).toFixed(3)}em,0) scale(${mix(1.08, 1, e).toFixed(3)})`);
        opacity(el, clamp(p * 2.4));
        blur(el, (1 - e) * 16);
        put(
          el,
          'text-shadow',
          ghost > 0.02
            ? `${(-ghost * 0.5).toFixed(3)}em 0 ${(ghost * 0.2).toFixed(3)}em var(--mr-ghost), var(--mr-rest, 0 0 0 transparent)`
            : 'var(--mr-rest, none)',
        );
      }
    });
    if (out && root.current) {
      const p = ease.inOut(seg(lt, out.at, out.dur));
      put(root.current, 'transform', `translate3d(0,${((out.dy ?? -30) * p).toFixed(2)}px,0)`);
      opacity(root.current, 1 - p);
      blur(root.current, p * 14);
    }
  });

  let wordIndex = 0;
  return (
    <span ref={root} className={`mr-kin ${className ?? ''}`} style={style}>
      {words.map((word, position) => {
        if (isSpace(word)) return <Fragment key={position}>{' '}</Fragment>;
        const accent = accentFrom !== undefined && wordIndex >= accentFrom;
        wordIndex += 1;
        if (unit === 'word') {
          return (
            <span key={position} data-a="k" className={`mr-kin-u${accent ? ' mr-accent' : ''}`}>
              {word}
            </span>
          );
        }
        return (
          <span key={position} className={`mr-kin-w${accent ? ' mr-accent' : ''}`}>
            {Array.from(word).map((letter, letterIndex) => (
              <span key={letterIndex} data-a="k" className="mr-kin-u">
                {letter}
              </span>
            ))}
          </span>
        );
      })}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// A small label typed letter by letter with an underscore caret («БИЛЕТЫ_»).

export function TypeLabel({ text, at, cps = 24, className }: { text: string; at: number; cps?: number; className?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const { one } = useEls(root);
  const typedFor = (text.length / cps) * 1000;
  useFrame((lt) => {
    const shown = clamp(Math.floor(((lt - at) * cps) / 1000), 0, text.length);
    setText(one('t'), text.slice(0, shown));
    opacity(root.current, lt >= at ? 1 : 0);
    const typing = lt < at + typedFor;
    const blink = Math.floor((lt - at - typedFor) / 380) % 2 === 0;
    opacity(one('caret'), lt >= at && lt < at + typedFor + 1500 && (typing || blink) ? 1 : 0);
  });
  return (
    <span ref={root} className={`mr-label ${className ?? ''}`}>
      <span data-a="t" />
      <span data-a="caret" className="mr-label-caret">
        _
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// A counter with rolling digits (up to two digits), blurred while it runs fast.

const STRIP = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export function Counter({
  from,
  to,
  at,
  dur,
  className,
  value,
}: {
  from: number;
  to: number;
  at: number;
  dur: number;
  className?: string;
  /** Overrides the eased count: the value at scene time `lt`. */
  value?: (lt: number) => number;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const { all } = useEls(root);
  const read = (lt: number) => (value ? value(lt) : mix(from, to, ease.inOut(seg(lt, at, dur))));
  useFrame((lt) => {
    const v = Math.max(0, read(lt));
    const speed = Math.abs(v - read(lt - 16));
    const [tensCell, onesCell] = all('cell');
    const [tensStrip, onesStrip] = all('strip');
    const ones = v % 10;
    const tens = Math.floor(v / 10) + Math.max(0, (v % 10) - 9);
    put(onesStrip, 'transform', `translate3d(0,${(-ones).toFixed(3)}em,0)`);
    put(tensStrip, 'transform', `translate3d(0,${(-(tens % 10)).toFixed(3)}em,0)`);
    blur(onesStrip, Math.min(7, speed * 22));
    blur(tensStrip, Math.min(5, speed * 2.2));
    const showTens = clamp((v - 9) / 0.6);
    put(tensCell, 'width', `${(0.6 * showTens).toFixed(3)}em`);
    opacity(tensCell, showTens);
    put(onesCell, 'width', '0.6em');
  });
  return (
    <span ref={root} className={`mr-count ${className ?? ''}`} aria-hidden="true">
      {[0, 1].map((cell) => (
        <span key={cell} data-a="cell" className="mr-count-cell">
          <span data-a="strip" className="mr-count-strip">
            {STRIP.map((digit, position) => (
              <span key={position}>{digit}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// A number of several digits rolling to its value (960, 147): transforms only. The digits above the value's
// own are hidden and the number slides left by their width, so it stays left-aligned without a width change.
// Its `data-a` names are its own («rl-…»): a scene's useEls looks through everything under the scene's root.

export function Roller({ value, digits = 3, className }: { value: (lt: number) => number; digits?: number; className?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const { all, one } = useEls(root);
  useFrame((lt) => {
    const v = Math.max(0, value(lt));
    const speed = Math.abs(v - Math.max(0, value(lt - 16)));
    const cells = all('rl-cell');
    const strips = all('rl-strip');
    let hidden = 0;
    for (let i = 0; i < digits; i += 1) {
      // Cell 0 is the leftmost: its place is 10^(digits − 1).
      const power = digits - 1 - i;
      const place = 10 ** power;
      const below = v % place;
      // A digit turns with the fraction of the last unit below it (…9 → …0), the ones all the time.
      const position = power === 0 ? v % 10 : (Math.floor(v / place) % 10) + Math.max(0, below - (place - 1));
      put(strips[i], 'transform', `translate3d(0,${(-position).toFixed(3)}em,0)`);
      blur(strips[i], power === 0 ? Math.min(7, speed * 22) : Math.min(5, (speed / place) * 2.2));
      const show = power === 0 ? 1 : clamp((v - (place - 1)) / 0.6);
      opacity(cells[i], show);
      hidden += 1 - show;
    }
    put(one('rl-row'), 'transform', `translate3d(${(-0.6 * hidden).toFixed(3)}em,0,0)`);
  });
  return (
    <span ref={root} className={`mr-count ${className ?? ''}`} aria-hidden="true">
      <span data-a="rl-row" className="mr-count-row">
        {Array.from({ length: digits }, (_, cell) => (
          <span key={cell} data-a="rl-cell" className="mr-count-cell">
            <span data-a="rl-strip" className="mr-count-strip">
              {STRIP.map((digit, position) => (
                <span key={position}>{digit}</span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// The yellow hand-drawn underline of the brand, drawn under a phrase.

const MARKER_PATHS = [
  'M4 15 C 80 7, 170 5, 250 9 S 360 16, 396 8',
  'M4 14 C 90 6, 190 6, 280 10 S 370 15, 396 9',
  'M3 12 C 70 16, 160 6, 240 9 S 350 14, 397 10',
];

export function Marker({ at, dur = 700, variant = 0, className }: { at: number; dur?: number; variant?: number; className?: string }) {
  const path = useRef<SVGPathElement>(null);
  useFrame((lt) => {
    const p = ease.inOut(seg(lt, at, dur));
    put(path.current, 'stroke-dashoffset', (1 - p).toFixed(4));
    opacity(path.current, p > 0 ? 1 : 0);
  });
  return (
    <svg className={`mr-marker ${className ?? ''}`} viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true">
      <path ref={path} pathLength={1} d={MARKER_PATHS[variant % MARKER_PATHS.length]} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// The pointer: moves along key points, presses on clicks and leaves a ripple.

export interface CursorKey {
  at: number;
  x: number;
  y: number;
}

/** Where a pointer moving along `keys` is at `lt`: eased from key to key on a slight arc. */
export function pathAt(keys: readonly CursorKey[], lt: number): { x: number; y: number } {
  if (lt <= keys[0].at) return { x: keys[0].x, y: keys[0].y };
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (lt < b.at) {
      const p = ease.inOut(seg(lt, a.at, b.at - a.at));
      const bend = Math.sin(Math.PI * p) * Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: mix(a.x, b.x, p) + ((b.y - a.y) / len) * bend, y: mix(a.y, b.y, p) - ((b.x - a.x) / len) * bend };
    }
  }
  const last = keys[keys.length - 1];
  return { x: last.x, y: last.y };
}

export function Cursor({ keys, clicks = [], from, to }: { keys: readonly CursorKey[]; clicks?: readonly number[]; from: number; to: number }) {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const positionAt = (lt: number) => pathAt(keys, lt);
  useFrame((lt) => {
    const visible = lt >= from && lt < to;
    const show = Math.min(seg(lt, from, 200), 1 - seg(lt, to - 250, 250));
    opacity(root.current, visible ? show : 0);
    if (!visible) return;
    const { x, y } = positionAt(lt);
    const press = clicks.reduce((sum, click) => Math.max(sum, pulse(lt, click - 70, 240)), 0);
    put(one('arrow'), 'transform', `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${(1 - 0.16 * press).toFixed(3)})`);
    all('ripple').forEach((ripple, index) => {
      const click = clicks[index];
      const p = seg(lt, click, 620);
      const at = positionAt(click);
      put(ripple, 'transform', `translate3d(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px,0) scale(${mix(0.2, 1.5, ease.out(p)).toFixed(3)})`);
      opacity(ripple, p > 0 && p < 1 ? (1 - p) * 0.9 : 0);
    });
  });
  return (
    <div ref={root} className="mr-cursor" aria-hidden="true">
      {clicks.map((click) => (
        <span key={click} data-a="ripple" className="mr-ripple" />
      ))}
      <svg data-a="arrow" className="mr-arrow" viewBox="0 0 32 32" width="44" height="44">
        <path d="M6 3.5 L6 25 L11.6 19.7 L15.4 28.4 L19.4 26.7 L15.7 18.1 L23.5 18.1 Z" fill="#fff" stroke="#0B121C" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// A full-stage canvas drawn every frame.

const IN_JSDOM = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

/**
 * Backing pixels per stage pixel of a full-stage canvas: as many as the screen shows of it (the stage's scale × the
 * device's pixel ratio), never more than one, in steps of 1/8 so that a small resize keeps the canvas. A phone shows
 * the 1920 × 1080 stage some 360 px wide: its canvases cleared, drew and handed over two million pixels a frame where
 * the screen shows about a sixth of them (phone measurement 2026-10-19: the opening ran at 23–29 frames a second with
 * the canvases, at 41 without). The particles are drawn in stage units at that density, so they look the same.
 */
export function canvasDensity(scale: number, pixelRatio: number): number {
  const shown = scale * (pixelRatio > 0 ? pixelRatio : 1);
  return Math.min(1, Math.max(1 / 8, Math.ceil(shown * 8 - 1e-6) / 8));
}

export function ParticleCanvas({ draw, className }: { draw: (ctx: CanvasRenderingContext2D, lt: number) => void; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const context = useRef<CanvasRenderingContext2D | null>(null);
  const density = canvasDensity(useStageScale(), typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  const width = Math.round(STAGE_W * density);
  const height = Math.round(STAGE_H * density);
  /** The scene time last drawn, and at which width: a resized canvas loses its pixels and is drawn again at once. */
  const shown = useRef<{ lt: number; width: number } | null>(null);
  const paint = (lt: number) => {
    const el = canvas.current;
    if (IN_JSDOM || !el) return;
    if (!context.current) {
      // Made at once, while a scene mounted ahead may still be hidden: its first frame only draws.
      context.current = el.getContext('2d');
      if (context.current) beginFrame(context.current, el.width, el.height);
    }
    // A scene mounted ahead of its time is hidden: nothing to draw until it starts.
    if (lt < 0) return;
    const ctx = context.current;
    if (!ctx) return;
    beginFrame(ctx, el.width, el.height);
    ctx.setTransform(el.width / STAGE_W, 0, 0, el.height / STAGE_H, 0, 0);
    draw(ctx, lt);
    shown.current = { lt, width: el.width };
  };
  useFrame(paint);
  // The stage was resized: the canvas got its new size (and lost its pixels), the reel may be paused.
  useLayoutEffect(() => {
    if (shown.current && shown.current.width !== width) paint(shown.current.lt);
  });
  return <canvas ref={canvas} className={`mr-canvas ${className ?? ''}`} width={width} height={height} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------------------------
// Static pieces of the brand: the pill with the circle arrow.

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Pill({ children, tone = 'blue', name, className }: { children: ReactNode; tone?: 'blue' | 'ink' | 'white'; name?: string; className?: string }) {
  return (
    <span className={`mr-pill mr-pill--${tone} ${className ?? ''}`} data-a={name}>
      <span className="mr-pill-t">{children}</span>
      <i className="mr-pill-dot" data-a={name ? `${name}-dot` : undefined}>
        <ArrowIcon />
      </i>
    </span>
  );
}
