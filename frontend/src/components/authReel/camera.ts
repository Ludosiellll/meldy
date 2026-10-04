/** The camera of the sign-in reels' beats (film style). */
import { opacity, put } from '../reel/engine';
import { clamp, ease, seg } from '../reel/timeline';
import { keyed } from '../film/kit';

/** A beat's words and screen leave from here (its own time), unless it says otherwise. */
export const LEAVE = 3360;

/**
 * The camera on a beat's screen: in from the right out of focus, a slow push while it plays, out
 * to the left with motion blur. `tilt` turns the screen in depth (e.g. «rotateX(16deg)»).
 */
export function shot(el: Element | null | undefined, l: number, leave = LEAVE, tilt = '') {
  const x = keyed(l, [
    [0, 300],
    [900, 0],
    [leave, -40],
  ]);
  const s = keyed(l, [
    [0, 0.97],
    [leave, 1.03],
  ], ease.linear);
  const out = ease.in(seg(l, leave, 440));
  put(el, 'transform', `perspective(2800px) translate3d(${(x - 1200 * out).toFixed(1)}px,0,0) ${tilt} scale(${s.toFixed(4)})`);
  opacity(el, clamp(seg(l, 0, 260) * 4) * (1 - clamp((out - 0.5) / 0.5)));
  put(el, 'filter', `blur(${(14 * (1 - ease.out(seg(l, 0, 700))) + 22 * out).toFixed(2)}px)`);
}
