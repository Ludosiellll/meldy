import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Where a page keeps its place across a reload and «Назад» (owner, 21.10: a reload lost the place «даже в контрольных,
 * в целом везде»). Two homes, by what the state is:
 * - the address — a choice worth sharing or coming back to (a tab, a filter, a step, a question's number) as
 *   ?key=value: useUrlState, or setAddressParams for a page that keeps the value itself. The entry is changed in place
 *   (history.replaceState): no new step for «Назад», no navigation, so the page neither scrolls to the top nor starts
 *   again (the rooms StudyPage and MockPage are keyed by location.key). The address is read when the page opens —
 *   a reload, «Назад» to it, a link to it. The default value leaves the address clean. useListPlace keeps the item of
 *   a long list on screen the same way.
 * - this tab (sessionStorage) — what was typed and not sent yet: useSessionDraft, under the item's own key, until it
 *   is sent (clear). Never in the address.
 * The server keeps what is already its own (a quiz attempt's answers and clock, a study session's answers): a page
 * reads that back and goes on; nothing here starts anything again.
 */

/** The value of ?key= when it is one of `allowed` (any value without the list), else the fallback. */
export function paramValue<T extends string>(params: URLSearchParams, key: string, fallback: T, allowed?: readonly T[]): T {
  const raw = params.get(key);
  if (raw === null || raw === '') return fallback;
  if (allowed && !allowed.includes(raw as T)) return fallback;
  return raw as T;
}

/**
 * Writes ?key=value into the address in place (null takes the key out); the router's own state on the history entry
 * is kept. Nothing happens when the address already says so, or when the browser refuses.
 */
export function setAddressParams(changes: Record<string, string | null>): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) {
        if (!url.searchParams.has(key)) continue;
        url.searchParams.delete(key);
      } else {
        if (url.searchParams.get(key) === value) continue;
        url.searchParams.set(key, value);
      }
      changed = true;
    }
    if (!changed) return;
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // The address stays as it was: a reload starts this screen from its beginning, as before.
  }
}

/** ?key= of the address as the browser has it now (the writes in place included). */
export function addressParam(key: string): string | null {
  try {
    return new URL(window.location.href).searchParams.get(key);
  } catch {
    return null;
  }
}

/**
 * A choice kept in the address: `[value, set]`. The value is read when the page opens and again on each navigation
 * the router makes to it (a link with another ?key=); `set` changes it at once and writes it in place.
 * `set(fallback)` takes the key out of the address.
 */
export function useUrlState<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (next: T) => void] {
  const location = useLocation();
  const [value, setValue] = useState<T>(() => paramValue(new URLSearchParams(location.search), key, fallback, allowed));
  const seen = useRef(location.key);
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  useEffect(() => {
    if (seen.current === location.key) return;
    seen.current = location.key;
    setValue(paramValue(new URLSearchParams(location.search), key, fallback, allowedRef.current));
  }, [location.key, location.search, key, fallback]);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      setAddressParams({ [key]: next === fallback ? null : next });
    },
    [key, fallback],
  );
  return [value, set];
}

/**
 * The item of a long list on screen — the one across the middle of the window — kept in the address as ?key=N (1-based;
 * the first item leaves the address clean) as the list is scrolled. A list opened with ?key=N (a reload, its tab opened
 * again) brings item N to the middle of the window once; N outside the list is ignored. `key` null: nothing is kept.
 * Returns the ref for the list's element, whose children are the items.
 */
export function useListPlace<E extends HTMLElement>(key: string | null, count: number): RefObject<E> {
  const list = useRef<E>(null);
  const countRef = useRef(count);
  countRef.current = count;
  useEffect(() => {
    if (!key) return undefined;
    const kept = Number(addressParam(key));
    if (Number.isInteger(kept) && kept > 1 && kept <= countRef.current) {
      list.current?.children[kept - 1]?.scrollIntoView?.({ block: 'center' });
    }
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const items = list.current ? Array.from(list.current.children) : [];
        if (items.length === 0) return;
        const middle = window.innerHeight / 2;
        const across = items.findIndex((item) => item.getBoundingClientRect().bottom >= middle);
        const index = across < 0 ? items.length - 1 : across;
        setAddressParams({ [key]: index === 0 ? null : String(index + 1) });
      });
    };
    // Any scroll, the window's or a box's: the capture phase sees them all.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);
  return list;
}

const DRAFT_PREFIX = 'meldy_draft:';

/** A draft kept in this tab: its value, or null when there is none (or storage is closed, or the copy is unreadable). */
export function readDraftValue<T>(key: string, valid: (value: unknown) => value is T): T | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_PREFIX + key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeDraftValue(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(value));
  } catch {
    // Full or closed storage: the draft simply does not outlive a reload.
  }
}

export function clearDraftValue(key: string): void {
  try {
    window.sessionStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Nothing to clear.
  }
}

export const isText = (value: unknown): value is string => typeof value === 'string';

/**
 * Typed text (or a small form) kept in this tab until it is sent: `[value, set, clear]`. `key` names the item it
 * belongs to (null: nothing is kept). A value equal to `initial` is not kept. `clear` (after sending) forgets the draft
 * and goes back to `initial`.
 */
export function useSessionDraft<T>(
  key: string | null,
  initial: T,
  valid: (value: unknown) => value is T,
): [T, (next: T | ((previous: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => (key ? readDraftValue(key, valid) ?? initial : initial));
  const keyRef = useRef(key);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const validRef = useRef(valid);
  validRef.current = valid;
  // Another item on the same screen: its own draft.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    setValue(key ? readDraftValue(key, validRef.current) ?? initialRef.current : initialRef.current);
  }, [key]);
  const set = useCallback((next: T | ((previous: T) => T)) => {
    setValue((previous) => {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
      const at = keyRef.current;
      if (at) {
        if (JSON.stringify(resolved) === JSON.stringify(initialRef.current)) clearDraftValue(at);
        else writeDraftValue(at, resolved);
      }
      return resolved;
    });
  }, []);
  const clear = useCallback(() => {
    if (keyRef.current) clearDraftValue(keyRef.current);
    setValue(initialRef.current);
  }, []);
  return [value, set, clear];
}
