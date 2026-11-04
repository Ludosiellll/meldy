import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type RefObject } from 'react';
import type { EditorHandle } from '../containers/keys/QuestionEditor';

/**
 * The studio's question editors that hold changes not saved (owner, 04.11: «нет кнопки сохранить… если выйти по стрелке,
 * ничего не меняется»): the canvas's panel and the open editor of «Список» tell the page here while their draft differs
 * from the question, with a way to save it as their own «Сохранить» does. The page reads the list for its «Сохранить»,
 * its status («Вопрос 3 не сохранён») and the question it asks before anything is left.
 */

export interface UnsavedEditor {
  /** The question's number on the page; null — a new question not added yet. */
  number: number | null;
  /** Its save is on its way. */
  busy: boolean;
  /** The editor's own «Сохранить» (its checks, its error line): true once nothing of it is left unsaved. */
  save: () => Promise<boolean>;
}

export interface UnsavedStore {
  put: (key: string, editor: UnsavedEditor | null) => void;
  list: () => readonly UnsavedEditor[];
  subscribe: (listener: () => void) => () => void;
}

export function createUnsavedStore(): UnsavedStore {
  let entries = new Map<string, UnsavedEditor>();
  let snapshot: readonly UnsavedEditor[] = [];
  const listeners = new Set<() => void>();
  return {
    put(key, editor) {
      const was = entries.get(key);
      if (!editor && !was) return;
      if (editor && was && was.number === editor.number && was.busy === editor.busy && was.save === editor.save) return;
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
  };
}

export const UnsavedContext = createContext<UnsavedStore | null>(null);

const NONE: readonly UnsavedEditor[] = [];
const quiet = () => () => undefined;

/** The editors holding changes now (re-renders when the list changes). */
export function useUnsavedEditors(store: UnsavedStore | null): readonly UnsavedEditor[] {
  return useSyncExternalStore(store?.subscribe ?? quiet, store?.list ?? (() => NONE), store?.list ?? (() => NONE));
}

/** A host of a question editor (the canvas's panel, «Список») tells the page while its editor holds changes. */
export function useUnsavedEditor(key: string, dirty: boolean, number: number | null, busy: boolean, handle: RefObject<EditorHandle | null>) {
  const store = useContext(UnsavedContext);
  const save = useCallback(() => handle.current?.save() ?? Promise.resolve(true), [handle]);
  useEffect(() => {
    store?.put(key, dirty ? { number, busy, save } : null);
  }, [store, key, dirty, number, busy, save]);
  useEffect(() => () => store?.put(key, null), [store, key]);
}
