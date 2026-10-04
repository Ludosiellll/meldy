/**
 * The film kit: the motion language of Meldy's short videos (sign-in, sign-up, the guide). Calm and
 * monochrome — real screens of Meldy, heavy two-line statements, a camera that drifts and tilts,
 * depth of field and motion blur. One brand mark: the yellow dot of the wordmark (it opens and
 * closes every loop and ends the statements). Blue only where the app itself is blue (the main
 * button, «сейчас»). No particles, rings, glows, gradients or corner labels.
 */
import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { blur, opacity, put, text as setText, useEls, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import './film.css';

// ---------------------------------------------------------------------------------------------
// Motion

/** Piecewise value over key moments: [[t0, v0], [t1, v1], …], eased between keys. */
export function keyed(t: number, keys: ReadonlyArray<readonly [number, number]>, curve: (p: number) => number = ease.inOut): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i += 1) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t < t1) return mix(v0, v1, curve(seg(t, t0, t1 - t0)));
  }
  return keys[keys.length - 1][1];
}

interface Slide {
  /** Offset it comes from (px). */
  dx?: number;
  dy?: number;
  dur?: number;
  /** Blur at the fastest moment (px): the motion blur of a quick move. */
  smear?: number;
  scale?: number;
}

/**
 * Comes in from an offset with motion blur: fast at first, settling softly (the brand curve).
 * The blur follows the speed, so it is strongest at the start and gone when it lands.
 */
export function slideIn(el: Element | null | undefined, l: number, at: number, { dx = 0, dy = 0, dur = 760, smear = 16, scale = 1 }: Slide = {}) {
  const p = seg(l, at, dur);
  const e = ease.brand(p);
  const speed = 1 - e;
  put(el, 'transform', `translate3d(${(dx * (1 - e)).toFixed(1)}px,${(dy * (1 - e)).toFixed(1)}px,0) scale(${mix(scale, 1, e).toFixed(4)})`);
  opacity(el, clamp(p * 4));
  blur(el, p > 0 && p < 1 ? smear * speed * speed : 0);
}

/** Leaves towards an offset, accelerating, with motion blur. */
export function slideOut(el: Element | null | undefined, l: number, at: number, { dx = 0, dy = 0, dur = 520, smear = 18, scale = 1 }: Slide = {}) {
  const p = seg(l, at, dur);
  if (p <= 0) return;
  const e = ease.in(p);
  put(el, 'transform', `translate3d(${(dx * e).toFixed(1)}px,${(dy * e).toFixed(1)}px,0) scale(${mix(1, scale, e).toFixed(4)})`);
  opacity(el, 1 - clamp((p - 0.55) / 0.45));
  blur(el, smear * e);
}

/** A focus pull: from `from` px of blur to sharp. */
export function focusIn(el: Element | null | undefined, l: number, at: number, dur = 700, from = 18) {
  const p = ease.inOut(seg(l, at, dur));
  blur(el, from * (1 - p));
  opacity(el, clamp(seg(l, at, dur) * 2.5));
}

/** A pressed button: a short dip at `at` (returns 0 → 1 → 0). */
export function pressDepth(l: number, at: number): number {
  const p = seg(l, at - 60, 300);
  return p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p);
}

// ---------------------------------------------------------------------------------------------
// Statements: heavy words that slide in from the right with motion blur; a yellow dot as the period.

interface StatementProps {
  lines: readonly string[];
  /** Scene time of the first word. */
  at: number;
  /** Between words (ms). */
  stagger?: number;
  /** Ends with the yellow dot of the wordmark instead of a period. */
  dot?: boolean;
  /** Leaves (blur and slide left) from this moment. */
  out?: number;
  className?: string;
  style?: CSSProperties;
}

export function Statement({ lines, at, stagger = 90, dot = false, out, className, style }: StatementProps) {
  const root = useRef<HTMLParagraphElement>(null);
  const { all, one } = useEls(root);
  const words = useMemo(() => lines.map((line) => line.split(' ')), [lines]);
  const count = words.reduce((sum, line) => sum + line.length, 0);
  useFrame((l) => {
    all('w').forEach((word, index) => slideIn(word, l, at + index * stagger, { dx: 120, dur: 720, smear: 20 }));
    if (dot) {
      const p = seg(l, at + count * stagger + 260, 420);
      put(one('dot'), 'transform', `scale(${ease.back(p).toFixed(3)})`);
      opacity(one('dot'), p > 0 ? 1 : 0);
    }
    if (out !== undefined) slideOut(root.current, l, out, { dx: -180, dur: 420, smear: 24 });
  });
  let index = 0;
  return (
    <p ref={root} className={`fm-say ${className ?? ''}`} style={style}>
      {words.map((line, lineIndex) => (
        <span key={lineIndex} className="fm-say-line">
          {line.map((word, wordIndex) => {
            index += 1;
            return (
              <span key={wordIndex} data-a="w" className="fm-say-w" style={{ opacity: 0 }}>
                {word}
                {dot && lineIndex === words.length - 1 && wordIndex === line.length - 1 ? <i data-a="dot" className="fm-dot fm-dot--period" style={{ opacity: 0 }} /> : null}
              </span>
            );
          })}
        </span>
      ))}
      <span hidden>{index}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Typing into a field, with a blinking caret.

export function Typed({ text, at, cps = 26, className }: { text: string; at: number; cps?: number; className?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const { one } = useEls(root);
  const done = at + (text.length / cps) * 1000;
  useFrame((l) => {
    const shown = clamp(Math.floor(((l - at) * cps) / 1000), 0, text.length);
    setText(one('t'), text.slice(0, shown));
    const blink = l < done ? 1 : Math.floor((l - done) / 420) % 2 === 0 ? 1 : 0;
    opacity(one('caret'), l >= at - 400 ? blink : 0);
  });
  return (
    <span ref={root} className={`fm-typed ${className ?? ''}`}>
      <span data-a="t" />
      <i data-a="caret" className="fm-caret" />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// The wordmark: «Meldy» and its yellow dot.

export function Wordmark({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <span className={`fm-wordmark ${className ?? ''}`}>
      <span data-a="wm" className="fm-wordmark-t">
        Meldy
      </span>
      <i data-a="wmdot" className="fm-dot fm-dot--mark" />
      {children}
    </span>
  );
}

export function Arrow() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path data-a="tick" pathLength={1} d="M5.5 12.5l4.2 4.2L18.5 7.8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
