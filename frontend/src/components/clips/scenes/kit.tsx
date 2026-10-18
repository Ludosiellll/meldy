/**
 * What the how-to clips share: the loop's fade from and to empty paper, the screens that give way to each other, a
 * press, a row that comes into focus. The film kit's motion (components/film/kit): calm, monochrome, no particles,
 * glows, gradients or labels in the corners; blue only where Meldy's own screen is blue.
 */
import { useRef, type ReactNode } from 'react';
import { blur, opacity, put, text as setText, useEls, useFrame } from '../../reel/engine';
import { clamp, ease, mix, seg } from '../../reel/timeline';
import { slideIn } from '../../film/kit';

/** The loop opens from empty paper and closes into it, so the seam never shows. */
export const FADE_IN = 380;
export const FADE_OUT = 520;

/** The scene's whole picture: in from paper at the start of the loop, out to paper at its end. */
export function Loop({ total, children, className }: { total: number; children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    const into = ease.out(seg(l, 0, FADE_IN));
    const out = ease.in(seg(l, total - FADE_OUT, FADE_OUT - 40));
    const ui = one('loop');
    opacity(ui, into * (1 - out));
    put(ui, 'transform', `scale(${(mix(1.012, 1, into) * mix(1, 0.985, out)).toFixed(4)})`);
    blur(ui, 10 * (1 - into) + 12 * out);
  });
  return (
    <div ref={root} className={`mr-scene sx-scene ${className ?? ''}`}>
      <div data-a="loop" className="sx-loop" style={{ opacity: 0 }}>
        {children}
      </div>
    </div>
  );
}

/** Shown from `from` to `to`, faded in and out over `fade` ms at its edges. */
export const between = (l: number, from: number, to: number, fade = 180) => seg(l, from, fade) * (1 - seg(l, to, fade));

/** A pressed control: a short dip of `depth` at `at`. */
export function press(el: Element | null | undefined, l: number, at: number, depth = 0.06) {
  const p = seg(l, at - 60, 300);
  const dip = p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p);
  put(el, 'transform', `scale(${(1 - depth * dip).toFixed(4)})`);
}

/**
 * A screen that gives way to the next one: it slides aside, out of focus, and is gone within a third of a second, so
 * the next screen never lands on its words. It owns the element's transform, opacity and filter.
 */
export function leave(el: HTMLElement | undefined, l: number, at: number, dx = -240) {
  const p = seg(l, at, 420);
  if (p <= 0) {
    put(el, 'transform', 'none');
    opacity(el, 1);
    blur(el, 0);
    return;
  }
  put(el, 'transform', `translate3d(${(dx * ease.in(p)).toFixed(1)}px,0,0)`);
  opacity(el, 1 - ease.out(seg(l, at, 300)));
  blur(el, 18 * ease.out(p));
}

/** The next screen comes in from the right as the previous one leaves. */
export const arrive = (el: HTMLElement | undefined, l: number, at: number, dx = 220) => slideIn(el, l, at + 160, { dx, dur: 640, smear: 14 });

/** A row in focus from `at`. */
export function focusRow(el: HTMLElement | undefined, l: number, at: number, dur = 380) {
  const p = ease.out(seg(l, at, dur));
  opacity(el, clamp(seg(l, at, dur) * 2.5));
  put(el, 'filter', p >= 1 ? 'none' : `blur(${(8 * (1 - p)).toFixed(2)}px)`);
}

/** Words typed into a field from `at`, `cps` characters a second; the caret blinks while the field is the one typed in. */
export function typeInto(el: HTMLElement | undefined, caret: HTMLElement | undefined, words: string, l: number, at: number, cps = 22, until = Infinity) {
  const shown = clamp(Math.floor(((l - at) * cps) / 1000), 0, words.length);
  setText(el, words.slice(0, shown));
  const done = at + (words.length / cps) * 1000;
  const on = l >= at - 300 && l < until;
  const blink = l < done ? 1 : Math.floor((l - done) / 420) % 2 === 0 ? 1 : 0;
  opacity(caret, on ? blink : 0);
}

/** The arrow of Meldy's pills. */
export function Arrow() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** «←» of a back pill. */
export function BackArrow() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16 10H5M9 5.5 4.5 10 9 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** «+» in the dark circle of «Новый экзамен» / «Новый тест». */
export function Plus() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** The blue pill of Meldy (the label, the darker circle with the arrow). */
export function Pill({ children, name, className }: { children: ReactNode; name?: string; className?: string }) {
  return (
    <span data-a={name} className={`fm-btn fm-btn--blue sx-pill ${className ?? ''}`}>
      <span className="sx-pill-t">{children}</span>
      <i>
        <Arrow />
      </i>
    </span>
  );
}
