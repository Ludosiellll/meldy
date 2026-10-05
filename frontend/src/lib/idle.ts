/** After the page has loaded: a moment for its own late requests, then the browser's first idle time. */
const AFTER_LOAD_MS = 1000;
const IDLE_TIMEOUT_MS = 4000;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Runs `run` once the first screen is done: after the window's load event, a moment later, when the
 * browser is idle (at the latest a few seconds later). Returns the cancel.
 */
export function whenIdleAfterLoad(run: () => void): () => void {
  const win = window as IdleWindow;
  let timer = 0;
  let idle = 0;
  let cancelled = false;
  const onIdle = () => {
    if (!cancelled) run();
  };
  const schedule = () => {
    timer = window.setTimeout(() => {
      if (cancelled) return;
      if (win.requestIdleCallback) idle = win.requestIdleCallback(onIdle, { timeout: IDLE_TIMEOUT_MS });
      else onIdle();
    }, AFTER_LOAD_MS);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', schedule);
    window.clearTimeout(timer);
    if (idle && win.cancelIdleCallback) win.cancelIdleCallback(idle);
  };
}
