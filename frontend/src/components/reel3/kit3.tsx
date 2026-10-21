/**
 * The reel v3's small parts. Every frame writes only transform and opacity (and the text of a counter): no filter,
 * clip-path, box-shadow or canvas changes, and no layout read in the frame loop (reel3 budget, landing v3 spec).
 */
import { useMemo, useRef, type ReactNode } from 'react';
import { opacity, put, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { bind } from '../home3/copy3';

export { clamp, ease, mix, seg };

const n2 = (value: number) => String(Math.round(value * 100) / 100 || 0);

/**
 * translate + scale, rounded, as one transform. A 2D one: a word or a row that moves is drawn into the layer of its
 * card or statement (those are layers of their own, will-change in reel3.css), so the stage keeps a dozen layers
 * instead of one per moving word (phone check: 23 layers with translate3d).
 */
export function move(el: Element | null | undefined, x: number, y: number, scale = 1): void {
  put(el, 'transform', scale === 1 ? `translate(${n2(x)}px,${n2(y)}px)` : `translate(${n2(x)}px,${n2(y)}px) scale(${n2(scale)})`);
}

/**
 * Shows an element from `at` (rising `dy` px and fading in over `dur`) and, with `until`, hides it again (fading out
 * over 260 ms, drifting `-dy/2`).
 */
export function appear(el: Element | null | undefined, l: number, at: number, dur = 420, dy = 14, until?: number, dx = 0): void {
  if (!el) return;
  const p = ease.brand(seg(l, at, dur));
  const q = until === undefined ? 0 : ease.inOut(seg(l, until, 260));
  opacity(el, p * (1 - q));
  if (p <= 0) return;
  move(el, dx * (1 - p) - q * dx * 0.5, dy * (1 - p) - (q * dy) / 2);
}

/** A statement: its words slide in from the right one after another; the yellow dot of the wordmark ends it. */
export function Say({ text, at, until, className }: { text: string; at: number; until?: number; className?: string }) {
  const root = useRef<HTMLParagraphElement>(null);
  // Short words and numbers keep to the word after them («на 82 минуты»), so a line never ends on them.
  const words = useMemo(() => bind(text).replace(/(\d) /g, '$1\u00a0').split(/ +/).filter(Boolean), [text]);
  const spans = useRef<Array<HTMLSpanElement | null>>([]);
  useFrame((l) => {
    const out = until === undefined ? 0 : ease.inOut(seg(l, until, 320));
    opacity(root.current, l < at - 20 ? 0 : 1 - out);
    move(root.current, -28 * out, 0);
    words.forEach((_, index) => {
      const el = spans.current[index];
      const p = ease.brand(seg(l, at + index * 55, 560));
      opacity(el, p);
      move(el, 40 * (1 - p), 0);
    });
  });
  return (
    <p ref={root} className={`r3-say ${className ?? ''}`} style={{ opacity: 0 }}>
      {words.map((word, index) => (
        <span key={`${word}-${index}`} ref={(el) => (spans.current[index] = el)} className="r3-w">
          {word}
          {index === words.length - 1 ? <i className="r3-dot" aria-hidden="true" /> : null}
        </span>
      ))}
    </p>
  );
}

/** A number that rolls from `from` to `to` between `at` and `at + dur` (only its text changes). */
export function Count({ from, to, at, dur, format }: { from: number; to: number; at: number; dur: number; format?: (n: number) => string }) {
  const root = useRef<HTMLSpanElement>(null);
  useFrame((l) => {
    const value = Math.round(mix(from, to, ease.out(seg(l, at, dur))));
    const text = format ? format(value) : String(value);
    if (root.current && root.current.textContent !== text) root.current.textContent = text;
  });
  return <span ref={root}>{format ? format(from) : from}</span>;
}

/** A voice line: bars that move while someone speaks (from `at` until `until`). */
export function Wave({ at, until, bars = 14, className }: { at: number; until: number; bars?: number; className?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const heights = useMemo(() => Array.from({ length: bars }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + 0.4))), [bars]);
  useFrame((l) => {
    const on = l >= at && l < until;
    const kids = root.current?.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i += 1) {
      const level = on ? 0.3 + 0.7 * Math.abs(Math.sin(l / 140 + i * 0.9)) * heights[i] : 0.25;
      put(kids[i], 'transform', `scaleY(${level.toFixed(2)})`);
    }
  });
  return (
    <span ref={root} className={`r3-wave ${className ?? ''}`} aria-hidden="true">
      {heights.map((_, i) => (
        <b key={i} />
      ))}
    </span>
  );
}

/** The arrow of a pill button. */
export function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** The statement column and the product column of a scene. */
export function Scene({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`r3-scene ${className ?? ''}`}>{children}</div>;
}
