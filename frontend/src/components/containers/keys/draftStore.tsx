import { useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ChangeEvent, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { fieldText, typedDraft, type Draft, type FieldPath } from './editorModel';

/**
 * The question editor's draft outside React state (owner, 2026-11-05: typing in «Вопросы и ключи» was not smooth; the
 * studio's canvasStore did the same for its blocks). A key typed in a field changes the draft here and nothing else:
 * the field keeps its words itself (the browser's, not React's: a React textarea rewrote its text node at every key and
 * the page's :has() rules were looked at again), and only what reads the words — a problem's line, «Сохранить» on or
 * off, the range of a number, the gaps of a cloze — renders, and only when its answer changes (useDraft with a
 * selector that returns a primitive). A change the editor draws (a tick, a kind, an option added, moved or taken out, a
 * picture, words a button put in) is an `update`: the editor renders again and every field takes its words from here.
 */
export interface DraftStore {
  get: () => Draft;
  /** How many changes the editor has drawn (`update`s): it renders again when this moves, never for words typed. */
  drawn: () => number;
  update: (change: (draft: Draft) => Draft) => void;
  /** Words typed into a field, which shows them already. */
  type: (path: FieldPath, text: string) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createDraftStore(initial: Draft): DraftStore {
  let draft = initial;
  let drawn = 0;
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => draft,
    drawn: () => drawn,
    update: (change) => {
      const next = change(draft);
      if (next === draft) return;
      draft = next;
      drawn += 1;
      tell();
    },
    type: (path, text) => {
      if (fieldText(draft, path) === text) return;
      draft = typedDraft(draft, path, text);
      tell();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * One answer from the draft. `select` must return a primitive (or a value that stays the same while nothing it reads
 * changed): the component renders again only when that answer changes.
 */
export function useDraft<T>(store: DraftStore, select: (draft: Draft) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const read = useCallback(() => selectRef.current(store.get()), [store]);
  return useSyncExternalStore(store.subscribe, read, read);
}

/** The editor renders again on every change it draws (not on words typed). */
export function useDrawn(store: DraftStore): number {
  return useSyncExternalStore(store.subscribe, store.drawn, store.drawn);
}

interface FieldOwn {
  store: DraftStore;
  path: FieldPath;
  /** Told of a key typed, before the draft hears of it (the editor grows its fields here). */
  onTyped?: (field: HTMLTextAreaElement) => void;
}

/**
 * The words of a field follow the draft when the editor draws a change (an option taken out moves the words of the
 * ones after it up): put in on each render where they differ, before the paint. A key typed changes nothing here.
 */
function useFieldWords(field: { current: HTMLInputElement | HTMLTextAreaElement | null }, store: DraftStore, path: FieldPath) {
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    const text = fieldText(store.get(), path);
    if (node.value !== text) node.value = text;
  });
}

/** A textarea of the draft (the browser holds its words). */
export function DraftText({ store, path, onTyped, ...rest }: FieldOwn & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useFieldWords(ref, store, path);
  const typed = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onTyped?.(event.currentTarget);
    store.type(path, event.currentTarget.value);
  };
  return <textarea ref={ref} {...rest} onChange={typed} />;
}

/** An input of the draft (the browser holds its words). */
export function DraftInput({ store, path, ...rest }: Omit<FieldOwn, 'onTyped'> & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'>) {
  const ref = useRef<HTMLInputElement>(null);
  useFieldWords(ref, store, path);
  return <input ref={ref} {...rest} onChange={(event) => store.type(path, event.currentTarget.value)} />;
}
