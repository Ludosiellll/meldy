/**
 * The sheet's own motion: ease-in-out only (no bounce, no overshoot), a quick move with motion blur at its
 * fastest moment, and fades. Every function writes the element's transform, opacity or filter for the
 * reel time `l`; nothing is animated in CSS.
 */
import { blur, opacity, put } from '../engine';
import { clamp, ease, seg } from '../timeline';

/** Comes in from an offset (px), settling with ease-in-out; the blur follows the speed. */
export function glideIn(el: Element | null | undefined, l: number, at: number, { dx = 0, dy = 0, dur = 720, smear = 14 } = {}) {
  const p = seg(l, at, dur);
  const e = ease.inOut(p);
  const speed = Math.sin(Math.PI * p);
  put(el, 'transform', `translate3d(${(dx * (1 - e)).toFixed(1)}px,${(dy * (1 - e)).toFixed(1)}px,0)`);
  opacity(el, clamp(p * 3));
  blur(el, p > 0 && p < 1 ? smear * speed : 0);
}

/** Leaves towards an offset (px) with ease-in-out and motion blur, and is gone at the end. */
export function glideOut(el: Element | null | undefined, l: number, at: number, { dx = 0, dy = 0, dur = 480, smear = 18 } = {}) {
  const p = seg(l, at, dur);
  const e = ease.inOut(p);
  const speed = Math.sin(Math.PI * p);
  put(el, 'transform', `translate3d(${(dx * e).toFixed(1)}px,${(dy * e).toFixed(1)}px,0)`);
  opacity(el, 1 - clamp((p - 0.5) / 0.5));
  blur(el, p > 0 && p < 1 ? smear * speed : 0);
}

/** A fade in ease-in-out over `dur` ms from `at`. */
export function fadeIn(el: Element | null | undefined, l: number, at: number, dur: number) {
  opacity(el, ease.inOut(seg(l, at, dur)));
}
