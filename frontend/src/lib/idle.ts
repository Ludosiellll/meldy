/** After the page has loaded: a moment for its own late requests, then the browser's first idle time. */
const AFTER_LOAD_MS = 1000;
const IDLE_TIMEOUT_MS = 4000;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Files of the first screen still on their way (screenFile); idle work waits for them. */
let screenFiles = 0;
const afterScreen = new Set<() => void>();

/**
 * Marks the file of a page's first screen (a lazy route, App.tsx): work kept for idle time (whenIdleAfterLoad) starts
 * only once it has arrived, or failed. On a slow line the window's load event comes before the page's own files are
 * even asked for (the code the load brought asks for them), so «a moment after load» fell in the middle of them: on
 * Slow 4G /try's sheet shared the line with the Supabase client and the next steps' files (jury QA, 2026-10-11).
 */
export function screenFile<T>(file: Promise<T>): Promise<T> {
  screenFiles += 1;
  const arrived = () => {
    screenFiles -= 1;
    if (screenFiles > 0) return;
    const waiting = Array.from(afterScreen);
    afterScreen.clear();
    for (const run of waiting) run();
  };
  file.then(arrived, arrived);
  return file;
}

/**
 * Runs `run` once the first screen is done: after the window's load event, a moment later, once the files of the
 * first screen marked with screenFile have arrived, when the browser is idle (at the latest a few seconds later).
 * Returns the cancel.
 */
export function whenIdleAfterLoad(run: () => void): () => void {
  const win = window as IdleWindow;
  let timer = 0;
  let idle = 0;
  let cancelled = false;
  const onIdle = () => {
    if (!cancelled) run();
  };
  const askIdle = () => {
    if (cancelled) return;
    if (win.requestIdleCallback) idle = win.requestIdleCallback(onIdle, { timeout: IDLE_TIMEOUT_MS });
    else onIdle();
  };
  const schedule = () => {
    timer = window.setTimeout(() => {
      if (cancelled) return;
      if (screenFiles > 0) afterScreen.add(askIdle);
      else askIdle();
    }, AFTER_LOAD_MS);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    cancelled = true;
    afterScreen.delete(askIdle);
    window.removeEventListener('load', schedule);
    window.clearTimeout(timer);
    if (idle && win.cancelIdleCallback) win.cancelIdleCallback(idle);
  };
}

/**
 * Gives the main thread back between pieces of a long job (a tap or a frame can go in between): scheduler.yield where
 * the browser has it, else a task of its own.
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
