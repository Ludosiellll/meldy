import { createContext, useCallback, useContext, useLayoutEffect, useRef, type RefObject } from 'react';
import type { ReelClock } from './clock';

const ClockContext = createContext<ReelClock | null>(null);
const SceneContext = createContext<{ from: number; to: number }>({ from: 0, to: Number.POSITIVE_INFINITY });
/** The stage's scale on the page (its width / 1920): a canvas draws only as many pixels as are shown. */
const StageScaleContext = createContext(1);

export const ClockProvider = ClockContext.Provider;
export const SceneProvider = SceneContext.Provider;
export const StageScaleProvider = StageScaleContext.Provider;

export function useStageScale(): number {
  return useContext(StageScaleContext);
}

export function useClock(): ReelClock {
  const clock = useContext(ClockContext);
  if (!clock) throw new Error('The reel clock is missing');
  return clock;
}

/**
 * Runs `frame` on every frame of the clock with the scene's own time (0 = the scene's first moment)
 * and the reel time. It also runs at once when the component appears, before the browser paints.
 */
export function useFrame(frame: (local: number, t: number) => void): void {
  const clock = useClock();
  const scene = useContext(SceneContext);
  const latest = useRef(frame);
  latest.current = frame;
  useLayoutEffect(() => clock.addFrame((t) => latest.current(t - scene.from, t)), [clock, scene.from]);
}

/**
 * The scene's animated elements by their `data-a` name, looked up once: `all('row')` gives every
 * element named «row» in document order, `one('card')` the first one.
 */
export function useEls(root: RefObject<Element>) {
  const cache = useRef(new Map<string, HTMLElement[]>());
  const all = useCallback(
    (name: string): HTMLElement[] => {
      const known = cache.current.get(name);
      if (known) return known;
      const found = root.current ? Array.from(root.current.querySelectorAll<HTMLElement>(`[data-a="${name}"]`)) : [];
      if (found.length) cache.current.set(name, found);
      return found;
    },
    [root],
  );
  const one = useCallback((name: string): HTMLElement | undefined => all(name)[0], [all]);
  return { all, one };
}

// ---------------------------------------------------------------------------------------------
// Writing styles: only what changed, so a still element costs nothing.

const written = new WeakMap<Element, Map<string, string>>();

export function put(el: Element | null | undefined, prop: string, value: string): void {
  if (!el) return;
  let props = written.get(el);
  if (!props) {
    props = new Map();
    written.set(el, props);
  }
  if (props.get(prop) === value) return;
  props.set(prop, value);
  (el as HTMLElement).style.setProperty(prop, value);
}

/** A number for CSS, rounded to hundredths (never in exponent notation at that precision). */
export const n2 = (value: number) => String(Math.round(value * 100) / 100 || 0);

export function opacity(el: Element | null | undefined, value: number): void {
  const v = Math.min(1, Math.max(0, value));
  put(el, 'opacity', v >= 0.999 ? '1' : v <= 0.001 ? '0' : v.toFixed(3));
  put(el, 'visibility', v <= 0.001 ? 'hidden' : 'visible');
}

export function blur(el: Element | null | undefined, px: number): void {
  put(el, 'filter', px > 0.15 ? `blur(${n2(px)}px)` : 'none');
}

/** translate3d + scale + rotate, the usual transform of a moving element. */
export function place(el: Element | null | undefined, x: number, y: number, scale = 1, rotate = 0): void {
  put(el, 'transform', `translate3d(${n2(x)}px,${n2(y)}px,0) scale(${n2(scale)}) rotate(${n2(rotate)}deg)`);
}

export function text(el: Element | null | undefined, value: string): void {
  if (!el) return;
  if (el.textContent !== value) el.textContent = value;
}

export function flag(el: Element | null | undefined, name: string, on: boolean): void {
  if (!el) return;
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}
