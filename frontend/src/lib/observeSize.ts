import { flushSync } from 'react-dom';

/**
 * One ResizeObserver for the boxes the app measures, instead of a measure in a layout effect. A layout effect that
 * reads a size makes the browser lay the page out before its own layout of the frame (a forced layout: the
 * smoothness audit of 20.10 found them behind the slow opening of the lecture, the exam's sheet, the podcast and
 * /try). The observer reports after the browser's layout and before its paint, where reading a box costs nothing.
 *
 * The first report of a box comes in the same frame as its first layout, and what the listeners set then is drawn at
 * once (flushSync): the first frame painted already has the measured size, as it had with the layout effect. Later
 * reports (a phone turned, fonts in) go through React's usual batching. Listeners only read and set state; they do
 * not write to the page, so the reads of one report do not lay it out again.
 *
 * Without ResizeObserver (an old browser, tests) the box is read once when it is first observed, as before.
 */
export type SizeListener = (entry: ResizeObserverEntry) => void;

const listeners = new Map<Element, Set<SizeListener>>();
/** Listeners that have not had their first report yet. */
const fresh = new WeakSet<SizeListener>();
let observer: ResizeObserver | null = null;
let observerClass: typeof ResizeObserver | null = null;

function report(entries: ResizeObserverEntry[]) {
  const calls: Array<[SizeListener, ResizeObserverEntry]> = [];
  let first = false;
  for (const entry of entries) {
    const set = listeners.get(entry.target);
    if (!set) continue;
    for (const listener of set) {
      calls.push([listener, entry]);
      if (fresh.has(listener)) {
        fresh.delete(listener);
        first = true;
      }
    }
  }
  if (calls.length === 0) return;
  const run = () => {
    for (const [listener, entry] of calls) listener(entry);
  };
  if (first) flushSync(run);
  else run();
}

/** Starts reporting the size of `element` to `listener`; returns the function that stops it. */
export function observeSize(element: Element, listener: SizeListener): () => void {
  if (typeof ResizeObserver === 'undefined') {
    // No observer (an old browser, tests): the box is read once, at once, as the layout effects did.
    listener({ target: element } as ResizeObserverEntry);
    return () => undefined;
  }
  if (!observer || observerClass !== ResizeObserver) {
    // The first box, or a test installed an observer of its own: every box observed so far goes to the new one.
    observer?.disconnect();
    observerClass = ResizeObserver;
    observer = new ResizeObserver(report);
    for (const target of listeners.keys()) observer.observe(target);
  }
  let set = listeners.get(element);
  if (!set) {
    set = new Set();
    listeners.set(element, set);
  } else {
    // Observed already: observed anew, so the box is reported again and the new listener has its first report.
    observer.unobserve(element);
  }
  fresh.add(listener);
  set.add(listener);
  observer.observe(element);
  return () => {
    const current = listeners.get(element);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(element);
      observer?.unobserve(element);
    }
  };
}

/** For tests: forget the observer (a test may install a ResizeObserver of its own). */
export function resetObserveSizeForTests(): void {
  observer?.disconnect();
  observer = null;
  observerClass = null;
  listeners.clear();
}
