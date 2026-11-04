import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * The studio's changes that are not saved yet beside the page (owner, 04.11: «нет кнопки сохранить… если выйти по
 * стрелке, ничего не меняется»): the canvas's question editor, the open editor of «Список» and the text of «Текст» not
 * applied tell the page here while they hold changes, with a way to save them as their own button does («Сохранить»,
 * «Применить»). The page reads the list for its «Сохранить», its status («Вопрос 3 не сохранён», «Текст не применён»)
 * and the question it asks before anything is left.
 *
 * The store also keeps the draft of the canvas's question editor while it holds changes (`keep`): the settings move
 * between the right column and a phone's sheet when the window narrows or a tablet turns, and the editor mounted anew
 * there takes the draft back instead of losing it.
 */

export type UnsavedKind = 'question' | 'text';

export interface UnsavedEditor {
  kind: UnsavedKind;
  /** The question's number on the page; null — a new question not added yet, or the text. */
  number: number | null;
  /** Its save is on its way. */
  busy: boolean;
  /** Its own «Сохранить» / «Применить» (its checks, its lines): true once nothing of it is left unsaved. */
  save: () => Promise<boolean>;
}

export interface UnsavedStore {
  put: (key: string, editor: UnsavedEditor | null) => void;
  list: () => readonly UnsavedEditor[];
  subscribe: (listener: () => void) => () => void;
  /** A draft kept for an editor mounted again (null forgets it). */
  keep: (key: string, value: unknown) => void;
  kept: (key: string) => unknown;
  /** «Не сохранять»: no kept draft comes back. */
  forgetKept: () => void;
}

export function createUnsavedStore(): UnsavedStore {
  let entries = new Map<string, UnsavedEditor>();
  let snapshot: readonly UnsavedEditor[] = [];
  const drafts = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  return {
    put(key, editor) {
      const was = entries.get(key);
      if (!editor && !was) return;
      if (editor && was && was.kind === editor.kind && was.number === editor.number && was.busy === editor.busy && was.save === editor.save) return;
      entries = new Map(entries);
      if (editor) entries.set(key, editor);
      else entries.delete(key);
      snapshot = [...entries.values()];
      listeners.forEach((listener) => listener());
    },
    list: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    keep(key, value) {
      if (value === null || value === undefined) drafts.delete(key);
      else drafts.set(key, value);
    },
    kept: (key) => drafts.get(key),
    forgetKept: () => drafts.clear(),
  };
}

export const UnsavedContext = createContext<UnsavedStore | null>(null);

const NONE: readonly UnsavedEditor[] = [];
const quiet = () => () => undefined;

/** What is not saved now (re-renders when the list changes). */
export function useUnsavedEditors(store: UnsavedStore | null): readonly UnsavedEditor[] {
  return useSyncExternalStore(store?.subscribe ?? quiet, store?.list ?? (() => NONE), store?.list ?? (() => NONE));
}

/** A part holding changes of its own (a question editor's host, «Текст») tells the page while it does. */
export function useUnsaved(key: string, dirty: boolean, kind: UnsavedKind, number: number | null, busy: boolean, save: () => Promise<boolean>) {
  const store = useContext(UnsavedContext);
  const saveRef = useRef(save);
  saveRef.current = save;
  const stable = useCallback(() => saveRef.current(), []);
  useEffect(() => {
    store?.put(key, dirty ? { kind, number, busy, save: stable } : null);
  }, [store, key, dirty, kind, number, busy, stable]);
  useEffect(() => () => store?.put(key, null), [store, key]);
}
