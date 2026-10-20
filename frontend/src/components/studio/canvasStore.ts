import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react';

/**
 * The canvas's own facts that change often and concern one or two blocks: which block is chosen, which text is being
 * typed in, where a dragged block or a file would land, which block asks «Удалить вопрос?», which one the mouse is over.
 * Kept outside React state (owner, 2026-10-20: «в конструкторе тоже пролагивание с телефона… никаких пролагиваний»):
 * a frame or a gap reads only its own answer (useCanvas with a selector that returns a primitive), so choosing a block
 * re-renders the two frames and the two gaps it concerns — not the page, not the thirty blocks (smoothness audit 20.10:
 * every such change re-rendered the whole canvas).
 */
export interface CanvasState {
  /** The chosen block. */
  selected: string | null;
  /** The text being typed in on the page: `${blockId}:${field}`. */
  editing: string | null;
  /** The gap a dragged block or a palette entry would land in (the line), or null. */
  slot: number | null;
  /** The gap a file from the computer would land in. */
  fileSlot: number | null;
  /** A question block asking before it goes (its number on the page). */
  confirm: { blockId: string; number: number } | null;
  /** The block the mouse is over (its bar shows, as on hover before): never set by a finger. */
  hovered: string | null;
}

export interface CanvasStore {
  get: () => CanvasState;
  set: (patch: Partial<CanvasState> | ((state: CanvasState) => Partial<CanvasState>)) => void;
  subscribe: (listener: () => void) => () => void;
}

export const CANVAS_START: CanvasState = { selected: null, editing: null, slot: null, fileSlot: null, confirm: null, hovered: null };

export function createCanvasStore(initial: Partial<CanvasState> = {}): CanvasStore {
  let state: CanvasState = { ...CANVAS_START, ...initial };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch) => {
      const next = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const key of Object.keys(next) as Array<keyof CanvasState>) {
        if (!Object.is(state[key], next[key])) changed = true;
      }
      if (!changed) return;
      state = { ...state, ...next };
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * One answer from the canvas's facts. `select` must return a primitive (or a value that stays the same object while
 * nothing it depends on changed): the component re-renders only when that answer changes.
 */
export function useCanvas<T>(store: CanvasStore, select: (state: CanvasState) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const read = useCallback(() => selectRef.current(store.get()), [store]);
  return useSyncExternalStore(store.subscribe, read, read);
}

/** The store of the studio page (StudioPage makes it; the canvas and the settings read it). */
export const CanvasStoreContext = createContext<CanvasStore | null>(null);

export function useCanvasStore(): CanvasStore {
  const store = useContext(CanvasStoreContext);
  if (!store) throw new Error('useCanvasStore outside the studio');
  return store;
}
