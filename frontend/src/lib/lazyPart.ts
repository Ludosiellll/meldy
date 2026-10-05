import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * A part of the app that lives in its own file and is fetched only when it is needed: the first
 * time it is asked for, or earlier, when the browser is idle (lib/prefetch.ts). Until then the
 * first screen does not carry it.
 */
export interface LazyPart<T> {
  /** The loaded export, or null while its file has not arrived. */
  current(): T | null;
  /** Fetches the file once (again after a failure) and resolves with the export. */
  load(): Promise<T>;
  /** Calls `listener` when the file arrives (not when it has already arrived); returns the unsubscribe. */
  subscribe(listener: (value: T) => void): () => void;
}

export function lazyPart<T>(loader: () => Promise<T>): LazyPart<T> {
  let value: T | null = null;
  let pending: Promise<T> | null = null;
  const listeners = new Set<(value: T) => void>();
  return {
    current: () => value,
    load() {
      if (value !== null) return Promise.resolve(value);
      if (!pending) {
        pending = loader().then(
          (loaded) => {
            value = loaded;
            const waiting = Array.from(listeners);
            listeners.clear();
            for (const listener of waiting) {
              try {
                listener(loaded);
              } catch (error) {
                // A failure while showing the part is not a failure to load it.
                window.setTimeout(() => {
                  throw error;
                });
              }
            }
            return loaded;
          },
          (error: unknown) => {
            pending = null;
            throw error;
          },
        );
      }
      return pending;
    },
    subscribe(listener) {
      if (value !== null) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface LazyPartOptions {
  /** A failed fetch; the part is fetched again the next time it is wanted. */
  onError?: (error: unknown) => void;
  /**
   * Show the part in one synchronous pass when its file arrives, so its effects (the focus moving
   * in, the page held still) have run by the time it can be seen — as when the click that asked
   * for it shows it. For dialogs; a page part renders like any other update.
   */
  immediate?: boolean;
}

/**
 * The part's export for rendering: null until its file has arrived (render a placeholder then). While
 * `wanted` is true the file is fetched; once it has arrived (asked for here or fetched by the idle
 * prefetch) it stays. Unlike React.lazy it never suspends: a screen that holds a part does not wait
 * for it, and React does not hold the screen back to space out loading states.
 */
export function useLazyPart<T>(part: LazyPart<T>, wanted: boolean, options: LazyPartOptions = {}): T | null {
  const { onError, immediate = false } = options;
  // A function in state would be called as an updater: keep the export in a box.
  const [box, setBox] = useState<{ value: T } | null>(() => {
    const value = part.current();
    return value === null ? null : { value };
  });

  useEffect(() => {
    if (box) return undefined;
    const value = part.current();
    if (value !== null) {
      setBox({ value });
      return undefined;
    }
    return part.subscribe((loaded) => {
      if (immediate) flushSync(() => setBox({ value: loaded }));
      else setBox({ value: loaded });
    });
  }, [part, box, immediate]);

  useEffect(() => {
    if (!wanted || box) return undefined;
    let live = true;
    part.load().catch((error: unknown) => {
      if (live) onError?.(error);
    });
    return () => {
      live = false;
    };
    // onError is read when the fetch fails; a new callback each render must not fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part, wanted, box]);

  return box ? box.value : part.current();
}
